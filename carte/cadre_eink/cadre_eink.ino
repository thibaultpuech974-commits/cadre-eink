// =====================================================================
//  Cadre e-ink - programme de la carte (Adafruit Feather ESP32-S3, 4 Mo flash / 2 Mo PSRAM)
//
//  A chaque reveil :
//   1. connexion Wi-Fi, puis demande au serveur ce qu'il faut afficher
//   2. si quelque chose a change : dessin, envoi d'une copie de l'image au serveur (apercu web),
//      qui repond comment rafraichir l'ecran, puis affichage. Tout passe par une seule connexion
//      securisee, et une image identique a celle de l'ecran n'est ni envoyee ni reaffichee
//   3. veille profonde jusqu'au prochain reveil
//
//  Ce fichier : reglages, Wi-Fi, ecran, veille. Dans le meme dossier (autres onglets de l'IDE) :
//  dessin.h (dessin de l'image), certificats.h (verification du serveur) et secrets.h (tes
//  identifiants, a creer depuis secrets.exemple.h).
//
//  Bibliotheques (gestionnaire de bibliotheques de l'IDE Arduino) :
//    GxEPD2, U8g2_for_Adafruit_GFX, ArduinoJson, JPEGDEC (bitbank2)
//
//  Carte a choisir dans l'IDE : "Adafruit Feather ESP32-S3 2MB PSRAM"
//  (la PSRAM, indispensable pour les pochettes, est alors activee d'office)
//  Pour la mise a jour par Wi-Fi : Outils -> Partition Scheme -> "Minimal SPIFFS
//  (1.9MB APP with OTA/128KB SPIFFS)" (le programme ne tient pas dans celui par
//  defaut, et un schema "No OTA" ou "Huge APP" empeche la mise a jour par Wi-Fi)
// =====================================================================

// ======================= A PERSONNALISER ==============================
// Identifiants (Wi-Fi, adresse du serveur, mot de passe, jeton Access) : dans secrets.h, a cote de
// ce fichier, jamais envoye sur GitHub. La premiere fois : copier secrets.exemple.h en secrets.h,
// puis le remplir.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Fichier secrets.h introuvable : copie secrets.exemple.h en secrets.h (meme dossier) et remplis-le"
#endif
#define ECRAN_PRESENT 1   // 0 = pas d'ecran branche : on dessine quand meme et on envoie l'apercu
// 1 = la carte verifie le certificat du serveur (voir certificats.h). 0 = sans verification, comme
// avant : seulement pour depanner (Cloudflare passe a une autorite absente de certificats.h).
#define VERIFIER_CERTIFICAT 1
// =====================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>
#include <GxEPD2_BW.h>
#include <Wire.h>
#include <driver/gpio.h>
#include <esp_sleep.h>
#include <esp_heap_caps.h>
#include <esp_ota_ops.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <Preferences.h>

// --- Broches (Feather ESP32-S3) ---
// Ecran : DIN -> MO, CLK -> SCK, VCC -> 3V, GND -> GND
#define EPD_CS        5           // broche 5
#define EPD_DC        6           // broche 6 (sera partagee avec le 2e ecran)
#define EPD_RST       9           // broche 9
#define EPD_BUSY      10          // broche 10
#define EPD_PWR       A2          // (sera partagee avec le 2e ecran)
// Reserve pour le 2e ecran : CS -> 12, RST -> A0, BUSY -> A1
// Batterie : lue par la jauge MAX17048 integree a la Feather (I2C, adresse 0x36)

// Dessin de l'image (dimensions, polices, blocs du tableau de bord, pochette...) : voir dessin.h
#include "dessin.h"
// Certificats racine des autorites qu'utilise Cloudflare (verification du serveur)
#include "certificats.h"

// =====================================================================
//  PARTIE CARTE ESP32 (reseau, ecran, veille)
// =====================================================================

// L'ecran recoit l'image par quarts (170 lignes a la fois) : un tampon de 20 Ko au lieu
// de 81,6 Ko en memoire interne, sinon il n'en reste plus assez pour la connexion securisee
GxEPD2_BW<GxEPD2_1330_GDEM133T91, GxEPD2_1330_GDEM133T91::HEIGHT / 4> display(
  GxEPD2_1330_GDEM133T91(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// Version du programme = date de compilation. La page web la relit dans le fichier .bin
// envoye, et la carte se met a jour si ce fichier est plus recent qu'elle.
const char MARQUEUR_VERSION[] = "CADRE_FW:" __DATE__ " " __TIME__;
char versionCarte[16];   // "AAAAMMJJ-hhmmss"
void calculerVersion() {
  const char* d = MARQUEUR_VERSION + 9;          // "Oct 24 2026 14:03:22"
  const char* mois = "JanFebMarAprMayJunJulAugSepOctNovDec";
  char m3[4] = { d[0], d[1], d[2], 0 };
  const char* p = strstr(mois, m3);
  int m = p ? (p - mois) / 3 + 1 : 0;
  snprintf(versionCarte, sizeof versionCarte, "%.4s%02d%02d-%c%c%c%c%c%c",
           d + 7, m, atoi(d + 4), d[12], d[13], d[15], d[16], d[18], d[19]);
}

// Conserve pendant la veille profonde
RTC_DATA_ATTR char     derniereSig[16] = "";
RTC_DATA_ATTR uint32_t reveilSecondes = 600;
RTC_DATA_ATTR bool     alerteBatterieAffichee = false;
// Rafraichissement commande par le serveur et temps d'eveil (envoyes au serveur a chaque reveil)
RTC_DATA_ATTR uint32_t empreinteAffichee = 0;       // image vraiment a l'ecran (0 = inconnue)
RTC_DATA_ATTR uint32_t empreinteEnvoyee = 0;        // derniere image recue par le serveur (apercu de la page web)
RTC_DATA_ATTR uint32_t secondesDepuisComplet = 0;   // depuis le dernier rafraichissement complet
RTC_DATA_ATTR uint32_t partielsDepuisComplet = 0;   // mises a jour partielles depuis le dernier complet
RTC_DATA_ATTR uint32_t eveilTotalMs = 0;            // temps passe hors veille, cumule
RTC_DATA_ATTR uint32_t ecranTotalMs = 0;            // dont temps de rafraichissement de l'ecran
RTC_DATA_ATTR char     versionRtc[16] = "";         // programme qui a ecrit ces valeurs
// Garde-fou contre les plantages (voir setup). Les variables RTC_DATA_ATTR reprennent leur valeur de
// depart a chaque redemarrage (sauf au reveil de veille) : ces compteurs sont donc dans la memoire RTC
// "non initialisee", qui survit a un plantage. Au branchement de la batterie elle contient n'importe quoi :
// 'magie' et 'version' disent si son contenu est valable.
struct GardeFou {
  uint32_t magie;
  char     version[16];   // programme qui a ecrit ces valeurs
  uint8_t  dAffilee;      // redemarrages anormaux sans cycle termine entre eux
  uint16_t total;         // depuis la mise sous tension (envoye au serveur)
  char     dernier;       // 'P' plantage, 'W' chien de garde, 'B' tension trop basse, 'L' cycle trop long
  bool     tropLong;      // le dernier redemarrage vient du garde-fou de duree
};
RTC_NOINIT_ATTR GardeFou gf;
const uint32_t MAGIE_GF = 0x6A4D0F11;
// Hors ligne : temps passe sans reponse du serveur, et ecran "Hors ligne" (voir echecContact)
RTC_DATA_ATTR uint32_t secondesSansContact = 0;     // depuis la derniere reponse du serveur
RTC_DATA_ATTR uint8_t  echecsDAffilee = 0;
RTC_DATA_ATTR bool     horsLigneAffiche = false;
RTC_DATA_ATTR char     dernieresNouvelles[40] = ""; // date de la derniere reponse (ecrite par le serveur)
RTC_DATA_ATTR int8_t   rotationEcran = 0;           // orientation de la derniere image
RTC_DATA_ATTR char     dernierMode = 0;             // 't' tableau, 'p' photo, 'c' pochette, 'b' blanc (0 : inconnu)

// Jauge de batterie MAX17048 de la Feather. On lit ses registres directement, sans
// bibliotheque : la puce reste alimentee par la batterie pendant la veille et suit la
// charge en continu, il ne faut surtout pas la reinitialiser a chaque reveil.
const uint8_t JAUGE = 0x36;
bool lireJauge(uint8_t reg, uint16_t& val) {
  Wire.beginTransmission(JAUGE);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(JAUGE, (uint8_t)2) != 2) return false;
  uint8_t fort = Wire.read();
  uint8_t faible = Wire.read();
  val = (fort << 8) | faible;
  return true;
}

// Mesures de la jauge envoyees au serveur (historique de la page web)
float pctJauge = -1;          // pourcentage au 1/256 pres (-1 : pas de mesure)
float vitesseJauge = 0;       // registre CRATE : vitesse de charge (+) ou de decharge (-), en % par heure
bool  vitesseLue = false;

// Renvoie la tension (V) et met a jour pctMesure, pctJauge et vitesseJauge. 0 si la jauge ne repond pas.
float lireBatterie() {
#ifdef PIN_I2C_POWER
  gpio_hold_dis((gpio_num_t)PIN_I2C_POWER);   // tenue a LOW pendant la veille (voir dormir)
  pinMode(PIN_I2C_POWER, OUTPUT);   // alimente les resistances de tirage du bus I2C
  digitalWrite(PIN_I2C_POWER, HIGH);
  delay(10);
#endif
  Wire.begin();
  pctMesure = -1; pctJauge = -1; vitesseLue = false;
  uint16_t brut = 0, soc = 0, crate = 0;
  float v = 0;
  for (int i = 0; i < 20; i++) {
    if (!lireJauge(0x02, brut)) return 0;   // registre VCELL
    v = brut * 78.125e-6f;                  // 78,125 uV par unite
    if (v > 1.0f) break;
    delay(50);   // juste apres le branchement de la batterie, la 1re mesure n'est pas prete
  }
  if (v > 2.5f && lireJauge(0x04, soc)) {   // registre SOC : % dans l'octet de poids fort, 1/256 % dans l'autre
    pctJauge = soc / 256.0f;
    pctMesure = min(100, (soc + 128) >> 8);
  }
  // Registre CRATE : entier signe, 0,208 % par heure par unite. Assez fin pour voir une charge
  // (plusieurs % par heure), pas pour la consommation du cadre (~ 0,04 % par heure, sous une unite).
  if (v > 2.5f && lireJauge(0x16, crate)) { vitesseJauge = (int16_t)crate * 0.208f; vitesseLue = true; }
  return v;
}

// Connexion rapide : on garde en memoire (pendant la veille) le canal, la borne et
// l'adresse IP obtenus a la derniere connexion. Cela evite de scanner les canaux et
// d'attendre la box (DHCP) : environ 1 s au lieu de 3 a 5 s, donc moins de batterie.
// Toutes les 12 h (ou en cas d'echec), on refait une connexion normale.
struct MemoWifi { uint32_t magie; uint8_t borne[6]; int32_t canal; uint32_t ip, passerelle, masque, dns; uint32_t age; };
RTC_DATA_ATTR MemoWifi memoWifi = { 0 };
const uint32_t MAGIE_WIFI = 0xCAD3E1A7;

bool attendreWifi(uint32_t ms) {
  unsigned long debut = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - debut > ms) return false;
    delay(20);
  }
  return true;
}

bool connecterWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;   // deja connecte (mode developpement)
  unsigned long t0 = millis();
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  if (memoWifi.magie == MAGIE_WIFI && memoWifi.age < 12 * 3600) {
    WiFi.config(IPAddress(memoWifi.ip), IPAddress(memoWifi.passerelle), IPAddress(memoWifi.masque), IPAddress(memoWifi.dns));
    WiFi.begin(WIFI_SSID, WIFI_MDP, memoWifi.canal, memoWifi.borne);
    if (attendreWifi(5000)) {
      Serial.printf("Wi-Fi : connecte (rapide, %lu ms)\n", millis() - t0);
      return true;
    }
    Serial.println("Wi-Fi : connexion rapide impossible, connexion normale");
    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.config(IPAddress(), IPAddress(), IPAddress());   // retour au DHCP
  }
  memoWifi.magie = 0;
  WiFi.begin(WIFI_SSID, WIFI_MDP);
  if (!attendreWifi(15000)) { Serial.println("Wi-Fi : echec"); return false; }
  // On retient tout pour la prochaine fois
  memcpy(memoWifi.borne, WiFi.BSSID(), 6);
  memoWifi.canal = WiFi.channel();
  memoWifi.ip = (uint32_t)WiFi.localIP();
  memoWifi.passerelle = (uint32_t)WiFi.gatewayIP();
  memoWifi.masque = (uint32_t)WiFi.subnetMask();
  memoWifi.dns = (uint32_t)WiFi.dnsIP(0);
  memoWifi.age = 0;
  memoWifi.magie = MAGIE_WIFI;
  Serial.printf("Wi-Fi : connecte (%lu ms)\n", millis() - t0);
  return true;
}

// Connexion securisee : la carte verifie que le serveur est bien le sien (certificat signe par une
// autorite de certificats.h, au nom du serveur). Sans cela, une fausse borne Wi-Fi au meme nom pourrait
// lire ses jetons et lui envoyer un faux programme.
void securiser(WiFiClientSecure& client) {
#if VERIFIER_CERTIFICAT
  client.setCACert(RACINES);
#else
  client.setInsecure();
#endif
}

// ---------------------------------------------------------------------
//  Une seule connexion securisee par reveil
//
//  Ouvrir une connexion securisee (TLS) coute environ une seconde d'eveil. Un reveil ou l'image change
//  fait deux ou trois requetes (etat, photo, envoi de l'apercu) : elles passent toutes par la meme
//  connexion, ouverte a la premiere et fermee apres la derniere (ou avant un travail gourmand en
//  memoire : decodage d'une pochette, mise a jour du programme, rafraichissement de l'ecran).
//  Ces deux objets vivent donc tout le long du programme, et non le temps d'une requete.
// ---------------------------------------------------------------------
WiFiClientSecure clientServeur;
HTTPClient httpServeur;

void fermerConnexion() {
  httpServeur.end();
  clientServeur.stop();
}

// Identifie la carte aupres du serveur : jeton de service Cloudflare Access s'il est rempli,
// et mot de passe CLE (utilise seulement si Access n'est pas active).
// (static : les tests sur ordinateur, sans HTTPClient, ne generent pas son prototype)
static void identifier(HTTPClient* http) {
  http->addHeader("X-Cle", CLE);
  if (ACCES_ID[0]) {
    http->addHeader("CF-Access-Client-Id", ACCES_ID);
    http->addHeader("CF-Access-Client-Secret", ACCES_SECRET);
  }
}

// Encode le mot de passe pour le mettre dans une adresse
String encoderURL(const char* s) {
  String r;
  for (; *s; s++) {
    char c = *s;
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') r += c;
    else { char h[4]; snprintf(h, sizeof h, "%%%02X", (unsigned char)c); r += h; }
  }
  return r;
}

// ---------------------------------------------------------------------
//  Retour arriere apres une mise a jour par Wi-Fi
//
//  Un nouveau programme demarre "a l'essai" : il n'est garde qu'une fois qu'il a joint le serveur (il
//  pourra donc recevoir un correctif par Wi-Fi). S'il plante avant, ou n'arrive pas a joindre le serveur,
//  la carte revient toute seule au programme precedent, qui ne l'installera plus (version refusee,
//  signalee a la page web). La version a l'essai et la version refusee sont gardees en memoire flash
//  (Preferences) : elles doivent survivre au changement de programme.
// ---------------------------------------------------------------------
// Sans cette fonction, le coeur Arduino validerait le nouveau programme des son demarrage
bool verifyRollbackLater() { return true; }

bool enEssai = false;            // ce programme vient d'etre installe et n'a pas encore fait ses preuves
char versionRefusee[16] = "";    // programme essaye qui n'a pas fonctionne (a ne plus installer)

void verifierProgramme() {
  Preferences p;
  p.begin("cadre", false);
  String essai = p.getString("essai", "");
  if (essai.length() && essai != versionCarte) {
    // Le programme a l'essai n'a pas tenu : la carte est revenue a celui-ci
    Serial.printf("Le programme %s n'a pas fonctionne : retour au programme %s\n", essai.c_str(), versionCarte);
    p.putString("refuse", essai);
    p.remove("essai");
    essai = "";
  }
  String refuse = p.getString("refuse", "");
  p.end();
  strncpy(versionRefusee, refuse.c_str(), sizeof versionRefusee - 1);
  esp_ota_img_states_t etatImage;
  bool aVerifier = esp_ota_get_state_partition(esp_ota_get_running_partition(), &etatImage) == ESP_OK &&
                   etatImage == ESP_OTA_IMG_PENDING_VERIFY;
  enEssai = aVerifier || essai == versionCarte;
  if (enEssai) Serial.println("Nouveau programme a l'essai : il sera garde quand il aura joint le serveur");
}

// Le serveur a repondu : le programme fonctionne, on le garde
void validerProgramme() {
  if (!enEssai) return;
  esp_ota_mark_app_valid_cancel_rollback();
  Preferences p;
  p.begin("cadre", false);
  p.remove("essai");
  p.end();
  enEssai = false;
  Serial.println("Nouveau programme confirme");
}

// Retour au programme precedent (redemarre la carte ; ne revient que si c'est impossible)
void revenirAuPrecedent(const char* pourquoi) {
  Serial.printf("Nouveau programme en echec (%s) : retour au programme precedent\n", pourquoi);
  Serial.flush();
  esp_ota_mark_app_invalid_rollback_and_reboot();
  Serial.println("Retour impossible : pas d'autre programme valide");
  enEssai = false;
}

// Mise a jour du programme par Wi-Fi. Un echec est retente au plus 3 fois par version.
RTC_DATA_ATTR char versionEchouee[16] = "";
RTC_DATA_ATTR uint8_t echecsMaj = 0;
void mettreAJourProgramme(const char* version) {
  if (strcmp(version, versionEchouee) == 0 && echecsMaj >= 3) return;
  if (strcmp(version, versionRefusee) == 0) {
    Serial.printf("Programme %s deja essaye sans succes : ignore\n", version);
    return;
  }
  Serial.printf("Mise a jour du programme : %s -> %s\n", versionCarte, version);
  fermerConnexion();             // la mise a jour ouvre sa propre connexion : on lui laisse la memoire
  WiFiClientSecure client;
  securiser(client);
  client.setTimeout(30);
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.setLedPin(LED_BUILTIN, HIGH);  // la LED rouge s'allume pendant l'ecriture
  // le 4e argument ajoute les en-tetes d'identification a la requete de telechargement
  t_httpUpdate_return r = httpUpdate.update(client, String(SERVEUR) + "/api/firmware.bin?cle=" + encoderURL(CLE), "",
                                            [](HTTPClient* h) { identifier(h); });
  if (r == HTTP_UPDATE_OK) {
    Preferences p;               // le nouveau programme demarre a l'essai
    p.begin("cadre", false);
    p.putString("essai", version);
    p.end();
    Serial.println("Mise a jour terminee : redemarrage");
    Serial.flush();
    derniereSig[0] = 0;          // redessiner apres le redemarrage
    ESP.restart();
  }
  Serial.printf("Mise a jour : echec (%d) %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
  if (strcmp(version, versionEchouee) != 0) { strncpy(versionEchouee, version, sizeof versionEchouee - 1); echecsMaj = 0; }
  echecsMaj++;
}

// Lit le corps d'une reponse (sa taille doit etre annoncee). Renvoie la taille lue (0 si erreur).
// Si 'dest' est fourni, on y ecrit au plus 'max' octets ; sinon on alloue en PSRAM.
static int lireCorps(HTTPClient& http, uint8_t** dest, int max) {
  int taille = http.getSize();
  if (taille <= 0 || taille > max) { Serial.println("Taille inattendue"); return 0; }
  if (!*dest) *dest = (uint8_t*)ps_malloc(taille);
  if (!*dest) { Serial.println("Pas assez de memoire (PSRAM activee ?)"); return 0; }
  WiFiClient* flux = http.getStreamPtr();
  int lu = 0;
  unsigned long debut = millis();
  while (lu < taille && millis() - debut < 20000) {
    int dispo = flux->available();
    if (dispo > 0) lu += flux->readBytes(*dest + lu, min(dispo, taille - lu));
    else delay(5);
  }
  return lu == taille ? taille : 0;
}

// Telecharge une ressource du serveur. Renvoie la taille lue (0 si erreur).
// Si 'dest' est fourni, on y ecrit au plus 'max' octets ; sinon on alloue en PSRAM.
// Cause du dernier echec de telecharger() : 'S' serveur injoignable ou en erreur, 'A' acces refuse,
// 'C' certificat du serveur refuse
char causeEchec = 'S';

// Envoie une requete au serveur par la connexion du reveil : GET, ou POST si 'corps' est fourni.
// Renvoie le code HTTP (negatif : pas de reponse ; 0 : adresse du serveur invalide).
// Si la connexion gardee ne repond plus (coupee entre deux requetes), un second essai en ouvre une neuve.
static int requete(const String& chemin, uint8_t* corps, size_t taille) {
  int code = 0;
  for (int essai = 0; essai < 2; essai++) {
    bool gardee = clientServeur.connected();
    if (!gardee) securiser(clientServeur);
    httpServeur.setReuse(true);
    if (!httpServeur.begin(clientServeur, String(SERVEUR) + chemin)) return 0;
    identifier(&httpServeur);
    httpServeur.setTimeout(20000);
    if (corps) {
      httpServeur.addHeader("Content-Type", "application/octet-stream");
      code = httpServeur.POST(corps, taille);
    } else {
      code = httpServeur.GET();
    }
    if (code > 0 || !gardee) break;
    Serial.printf("Connexion gardee perdue (%s) : nouvel essai sur une connexion neuve\n", httpServeur.errorToString(code).c_str());
    fermerConnexion();
  }
  return code;
}

int telecharger(const String& chemin, uint8_t** dest, int max) {
  causeEchec = 'S';
  int code = requete(chemin, nullptr, 0);
  if (code != 200) {
    Serial.printf("GET %s : HTTP %d\n", chemin.c_str(), code);
    if (code == 401 || code == 403) causeEchec = 'A';
    if (code < 0) {   // pas de reponse du serveur : on detaille la cause
      Serial.printf("  erreur : %s\n", httpServeur.errorToString(code).c_str());
      Serial.printf("  Wi-Fi : IP %s, passerelle %s, DNS %s, signal %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
                    WiFi.dnsIP().toString().c_str(), WiFi.RSSI());
      String hote = String(SERVEUR);
      hote.replace("https://", "");
      int s = hote.indexOf('/');
      if (s >= 0) hote = hote.substring(0, s);
      IPAddress ip;
      if (WiFi.hostByName(hote.c_str(), ip)) Serial.printf("  %s -> %s\n", hote.c_str(), ip.toString().c_str());
      else Serial.printf("  %s : nom introuvable (DNS)\n", hote.c_str());
      char e[120] = "";
      int n = clientServeur.lastError(e, sizeof e);
      Serial.printf("  connexion securisee : %d %s\n", n, e);
      if (strstr(e, "X509") || strstr(e, "erif")) causeEchec = 'C';
    }
    fermerConnexion();              // reponse d'erreur non lue : on ne reutilise pas cette connexion
    return 0;
  }
  int lu = lireCorps(httpServeur, dest, max);
  httpServeur.end();                // reponse lue en entier : la connexion reste ouverte pour la suite
  if (!lu) fermerConnexion();       // reponse incomplete : la suivante ne serait plus lisible
  return lu;
}

// Envoie l'image dessinee (apercu de la page web) et recoit du serveur comment rafraichir l'ecran :
// 'R' rien (image identique), 'P', 'D', 'T', 'Q' ou 'I' partiel (zones dans *plan, voir afficherZones),
// 'C' complet, 'N' complet avec nettoyage.
// Sans reponse lisible (serveur ancien, erreur) : 'C', sans risque.
// C'est la derniere requete d'un reveil : la connexion est fermee ensuite.
static char envoyerApercu(int rotation, uint8_t** plan, int* taillePlan) {
  *plan = nullptr;
  *taillePlan = 0;
  char chemin[160];
  snprintf(chemin, sizeof chemin, "/api/apercu?r=%d&plan=1&crc=%08lx&dc=%lu&pr=%lu&np=%lu", rotation, (unsigned long)empreinteAffichee,
           (unsigned long)secondesDepuisComplet, (unsigned long)reveilSecondes, (unsigned long)partielsDepuisComplet);
  int code = requete(chemin, canvas.getBuffer(), OCTETS);
  char type = 'C';
  if (code == 200) {
    int t = lireCorps(httpServeur, plan, 60000);
    if (t >= 1 && (*plan)[0] && strchr("RPDTQICN", (*plan)[0])) { type = (char)(*plan)[0]; *taillePlan = t; }
    empreinteEnvoyee = empreinteImage(canvas.getBuffer(), OCTETS);   // le serveur a cette image
  }
  fermerConnexion();
  if (!strchr("PDTQI", type)) { free(*plan); *plan = nullptr; *taillePlan = 0; }
  Serial.printf("Apercu envoye : HTTP %d, plan %c (%d octets)\n", code, type, *taillePlan);
  return type;
}

void allumerEcran(bool nettoyage) {
  gpio_hold_dis((gpio_num_t)EPD_PWR);
  pinMode(EPD_PWR, OUTPUT);
  digitalWrite(EPD_PWR, HIGH);
  delay(100);
  // 2e argument ("initial") a true : la bibliotheque passe d'abord tout l'ecran au blanc, avec un
  // rafraichissement complet de plus (nettoyage). A false : un seul rafraichissement.
  display.init(115200, nettoyage, 2, false);
  display.setRotation(0);
}

void eteindreEcran() {
  display.hibernate();
  digitalWrite(EPD_PWR, LOW);
  gpio_hold_en((gpio_num_t)EPD_PWR);
  gpio_deep_sleep_hold_en();
}

// Rafraichissement complet (~4,5 s ; ~9 s avec nettoyage)
void afficherComplet(bool nettoyage) {
#if ECRAN_PRESENT
  allumerEcran(nettoyage);
  display.setFullWindow();
  display.firstPage();          // un quart d'image a la fois, puis rafraichissement complet
  do {
    display.fillScreen(GxEPD_WHITE);
    display.drawBitmap(0, 0, canvas.getBuffer(), LARGEUR, HAUTEUR, GxEPD_BLACK);
  } while (display.nextPage());
  eteindreEcran();
#endif
}

// Mise a jour partielle (~0,5 s par passe). Le controleur fait bouger les pixels qui different entre sa
// memoire "precedente" (l'image a l'ecran) et sa memoire "courante" (la nouvelle). Ces memoires sont perdues
// pendant la veille : on met la nouvelle image dans les deux, puis on prepare les zones selon la methode.
// Le canvas a 1 = noir, l'ecran 1 = blanc : "true" inverse a l'ecriture, "false" donne le negatif.
//
// Attention : apres chaque mise a jour partielle, ce controleur ECHANGE le role de ses deux memoires
// (constate avec le programme test_ecran, nov. 2026) : la memoire 0x24 (ecrite par writeImage, "courante")
// devient la "precedente", et la 0x26 (writeImageToPrevious) la "courante". Une seconde passe doit en tenir
// compte. Au rallumage de l'ecran, les roles reviennent a la normale.
//  P (simple)    : ancien contenu des zones (envoye par le serveur) dans la "precedente", une passe ;
//                  seuls les pixels qui changent bougent, sans clignotement.
//  D, T, Q       : pareil en 2, 3 ou 4 passes. Avant chaque passe, les memoires sont rechargees (selon
//                  l'echange) pour refaire le meme trajet ancien -> nouveau : les pixels qui changent
//                  recoivent plusieurs impulsions dans le meme sens (~0,5 s chacune).
//  I (inversion) : chaque zone passe en negatif, puis revient a la nouvelle image : tous ses pixels font
//                  un aller-retour complet (moins de traces, petit clignotement des seules zones).
bool afficherZones(const uint8_t* plan, int taille) {
  ZonePlan zones[16];
  int n = zonesDuPlan(plan, taille, zones, 16);
  if (n < 0) { Serial.println("Plan partiel illisible : rafraichissement complet"); return false; }
#if ECRAN_PRESENT
  uint8_t* img = canvas.getBuffer();
  allumerEcran(false);             // controleur remis a zero : roles normaux des memoires
  display.epd2.writeImageAgain(img, 0, 0, LARGEUR, HAUTEUR, true);
  if (plan[0] == 'I') {
    // 0x24 (courante) : zones en negatif ; 0x26 (precedente) : nouvelle image
    for (int k = 0; k < n; k++) display.epd2.writeImagePart(img, zones[k].x, zones[k].y, LARGEUR, HAUTEUR, zones[k].x, zones[k].y, zones[k].w, zones[k].h, false);
    display.epd2.refresh(true);    // nouvelle image -> zones en negatif
    // Echange : 0x24 (le negatif) est maintenant la precedente, 0x26 (la nouvelle image) la courante :
    // les memoires sont deja comme il faut pour le retour
    display.epd2.refresh(true);    // negatif -> nouvelle image
  } else {
    int passes = plan[0] == 'Q' ? 4 : plan[0] == 'T' ? 3 : plan[0] == 'D' ? 2 : 1;
    // 0x26 (precedente) : ancien contenu des zones ; 0x24 (courante) : nouvelle image
    for (int k = 0; k < n; k++) display.epd2.writeImageToPrevious(zones[k].ancien, zones[k].x, zones[k].y, zones[k].w, zones[k].h, true);
    display.epd2.refresh(true);    // partiel sur tout l'ecran : seuls les pixels differents bougent
    for (int p = 1; p < passes; p++) {
      // Apres un nombre impair de passes, 0x24 est la precedente et 0x26 la courante ; apres un nombre
      // pair, roles normaux. On y remet l'ancien contenu et la nouvelle image selon ces roles.
      bool echange = p % 2 == 1;
      for (int k = 0; k < n; k++) {
        const ZonePlan& z = zones[k];
        if (echange) {
          display.epd2.writeImage(z.ancien, z.x, z.y, z.w, z.h, true);
          display.epd2.writeImagePartToPrevious(img, z.x, z.y, LARGEUR, HAUTEUR, z.x, z.y, z.w, z.h, true);
        } else {
          display.epd2.writeImageToPrevious(z.ancien, z.x, z.y, z.w, z.h, true);
          display.epd2.writeImagePart(img, z.x, z.y, LARGEUR, HAUTEUR, z.x, z.y, z.w, z.h, true);
        }
      }
      display.epd2.refresh(true);  // impulsion suivante, dans le meme sens
    }
  }
  eteindreEcran();
#endif
  return true;
}

bool modeDev = false;                 // envoye par le serveur (menu Reveil de la page web)
unsigned long dernierAffichageMs = 0;  // pour respecter 3 min entre deux rafraichissements
bool ecranEnAttente = false;

void dormir(uint32_t secondes) {
  fermerConnexion();
  if (WiFi.getMode() != WIFI_OFF) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }
#ifdef PIN_I2C_POWER
  // Bus I2C (resistances de tirage, prise STEMMA QT) coupe pendant la veille. Sans cela, la broche
  // restait a HIGH, et gpio_deep_sleep_hold_en (voir eteindreEcran) pouvait la figer ainsi toute la nuit.
  // La jauge MAX17048 n'en depend pas : elle est alimentee directement par la batterie.
  Wire.end();
  pinMode(PIN_I2C_POWER, OUTPUT);
  digitalWrite(PIN_I2C_POWER, LOW);
  gpio_hold_en((gpio_num_t)PIN_I2C_POWER);
  gpio_deep_sleep_hold_en();
#endif
  Serial.printf("Veille profonde pendant %u s\n", secondes);
  Serial.flush();
  memoWifi.age += secondes;
  esp_sleep_enable_timer_wakeup((uint64_t)secondes * 1000000ULL);
  esp_deep_sleep_start();
}

// Rafraichit l'ecran selon le plan du serveur ('R', 'P', 'C' ou 'N').
// L'ecran demande au moins 3 minutes entre deux rafraichissements : en mode developpement, l'apercu web
// est a jour tout de suite, mais l'ecran attend si besoin le cycle suivant (rafraichissement complet alors).
void mettreEcranAJour(char type, const uint8_t* plan, int taille) {
  fermerConnexion();                            // plus de requete avant la veille : memoire rendue a l'ecran
  if (empreinteAffichee == 0) type = 'N';       // image a l'ecran inconnue (demarrage) : nettoyage
  if (type == 'R') { ecranEnAttente = false; Serial.println("Ecran : image identique, rien a rafraichir"); return; }
  bool demandePartiel = strchr("PDTQI", type) != nullptr;
  if (dernierAffichageMs && millis() - dernierAffichageMs < 180000UL) {
    Serial.println("Ecran : rafraichissement reporte (3 min minimum entre deux)");
    ecranEnAttente = true;
    return;
  }
  unsigned long t0 = millis();
  bool partiel = demandePartiel && afficherZones(plan, taille);
  if (!partiel) afficherComplet(type == 'N');
  unsigned long duree = millis() - t0;
  ecranTotalMs += duree;
  if (partiel) Serial.printf("Ecran : mise a jour partielle (%s) en %lu ms\n", type == 'I' ? "inversion" : type == 'Q' ? "4 passes" :
                             type == 'T' ? "3 passes" : type == 'D' ? "2 passes" : "simple", duree);
  else Serial.printf("Ecran : %s en %lu ms\n", type == 'N' ? "complet avec nettoyage" : "complet", duree);
  empreinteAffichee = empreinteImage(canvas.getBuffer(), OCTETS);
  if (partiel) partielsDepuisComplet++;
  else { secondesDepuisComplet = 0; partielsDepuisComplet = 0; }
  dernierAffichageMs = millis();
  ecranEnAttente = false;
}

// ---------------------------------------------------------------------
//  Garde-fou : un cycle qui dure plus de 4 min (programme bloque) relance la carte. Les redemarrages
//  anormaux sont comptes (voir setup) : apres 3 d'affilee, la carte se repose une heure.
// ---------------------------------------------------------------------
const uint32_t DUREE_MAX_CYCLE_S = 240;   // une mise a jour par Wi-Fi prend jusqu'a ~1 min
esp_timer_handle_t minuterieCycle = nullptr;

void cycleBloque(void*) {
  gf.tropLong = true;
  esp_restart();
}
void armerGardeFou() {
  if (!minuterieCycle) {
    esp_timer_create_args_t a = {};
    a.callback = cycleBloque;
    a.name = "garde-fou";
    if (esp_timer_create(&a, &minuterieCycle) != ESP_OK) return;
  }
  esp_timer_stop(minuterieCycle);
  esp_timer_start_once(minuterieCycle, (uint64_t)DUREE_MAX_CYCLE_S * 1000000ULL);
}
void desarmerGardeFou() {
  if (minuterieCycle) esp_timer_stop(minuterieCycle);
}

// Raison du demarrage, si elle est anormale : 'P' plantage, 'W' chien de garde, 'B' tension trop basse,
// 'L' cycle trop long (garde-fou ci-dessus). 0 : demarrage normal (reveil, mise sous tension, RESET...).
char demarrageAnormal() {
  switch (esp_reset_reason()) {
    case ESP_RST_PANIC: return 'P';
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return 'W';
    case ESP_RST_BROWNOUT: return 'B';
    case ESP_RST_SW: return gf.tropLong ? 'L' : 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------------
//  Hors ligne : sans reponse du serveur depuis plus de 3 h (et 2 echecs d'affilee), le tableau de bord
//  affiche est perime : la carte le remplace par un ecran "Hors ligne" (une seule fois ; pas sur une
//  photo ni sur l'ecran blanc), et espace ses essais (30 min) pour menager la batterie. Au retour du
//  serveur, l'affichage normal revient.
// ---------------------------------------------------------------------
const uint32_t HORS_LIGNE_S = 3 * 3600;
bool contactOk = false;       // le serveur a repondu pendant ce cycle
bool contactTente = false;    // ce cycle a essaye de le joindre

// Renvoie le nombre de secondes avant le prochain essai
uint32_t echecContact(char cause) {
  echecsDAffilee++;
  bool longtemps = echecsDAffilee >= 2 && secondesSansContact >= HORS_LIGNE_S;
  if (longtemps && !horsLigneAffiche && dernierMode != 'p' && dernierMode != 'b') {
    const char* raison = cause == 'W' ? "Wi-Fi introuvable" : cause == 'A' ? "Accès refusé par le serveur" :
                         cause == 'C' ? "Certificat du serveur refusé" : cause == 'R' ? "Réponse du serveur illisible" :
                         "Serveur injoignable";
    Serial.printf("Hors ligne depuis %u min : %s\n", secondesSansContact / 60, raison);
    fermerConnexion();
    canvas.setRotation(rotationEcran);
    dessinerHorsLigne(raison, dernieresNouvelles);
    afficherComplet(false);
    // le serveur n'a pas cette image : la prochaine mise a jour sera complete
    empreinteAffichee = empreinteImage(canvas.getBuffer(), OCTETS);
    secondesDepuisComplet = 0;
    partielsDepuisComplet = 0;
    derniereSig[0] = 0;
    horsLigneAffiche = true;
  }
  // Un echec est vite retente (meme la nuit), puis toutes les 30 min quand la panne dure
  return longtemps ? 1800 : min(reveilSecondes, (uint32_t)600);
}

// Un cycle complet. Renvoie le nombre de secondes avant le suivant.
uint32_t cycle() {
  contactOk = false;
  contactTente = false;
  float vBat = lireBatterie();
  Serial.printf("Batterie : %.2f V", vBat);
  if (pctJauge >= 0) Serial.printf(", jauge %.1f %%", pctJauge);
  if (vitesseLue) Serial.printf(", %+.1f %%/h", vitesseJauge);
  Serial.println();
  Serial.printf("Memoire libre : interne %u Ko (plus grand bloc %u Ko), PSRAM %u Ko\n",
                heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024,
                heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL) / 1024, ESP.getFreePsram() / 1024);

  // Batterie presque vide : on le signale une fois, puis on dort longtemps
  if (vBat > 2.5 && vBat < 3.4) {
    if (!alerteBatterieAffichee) {
      dessinerMessage("Batterie vide", "Rechargez le cadre");
      afficherComplet(false);
      // le serveur n'a pas cette image : la prochaine mise a jour sera complete
      empreinteAffichee = empreinteImage(canvas.getBuffer(), OCTETS);
      secondesDepuisComplet = 0;
      partielsDepuisComplet = 0;
      alerteBatterieAffichee = true;
      derniereSig[0] = 0;
    }
    return 6 * 3600;
  }
  alerteBatterieAffichee = false;

  contactTente = true;
  if (!connecterWifi()) return echecContact('W');

  // 1. Que faut-il afficher ?
  uint8_t* brut = nullptr;
  char chemin[200];
  int lg = snprintf(chemin, sizeof chemin, "/api/etat?bat=%.2f&fw=%s", vBat, versionCarte);
  if (pctJauge >= 0) lg += snprintf(chemin + lg, sizeof chemin - lg, "&pct=%.1f", pctJauge);
  if (vitesseLue) lg += snprintf(chemin + lg, sizeof chemin - lg, "&crate=%.1f", vitesseJauge);
  lg += snprintf(chemin + lg, sizeof chemin - lg, "&ev=%lu&ee=%lu", (unsigned long)eveilTotalMs, (unsigned long)ecranTotalMs);
  // Redemarrages anormaux depuis la mise sous tension, et programme refuse (retour arriere)
  if (gf.total) lg += snprintf(chemin + lg, sizeof chemin - lg, "&pa=%u&ra=%c", gf.total, gf.dernier ? gf.dernier : 'P');
  if (versionRefusee[0]) snprintf(chemin + lg, sizeof chemin - lg, "&fwko=%s", versionRefusee);
  int n = telecharger(chemin, &brut, 32768);
  if (!n) { free(brut); return echecContact(causeEchec); }
  JsonDocument etat;
  DeserializationError err = deserializeJson(etat, (const char*)brut, n);
  free(brut);
  if (err) { Serial.println("Reponse illisible"); return echecContact('R'); }

  // Le serveur a repondu
  contactOk = true;
  echecsDAffilee = 0;
  if (horsLigneAffiche) { horsLigneAffiche = false; derniereSig[0] = 0; }   // redessiner le tableau de bord
  validerProgramme();
  strncpy(dernieresNouvelles, etat["quand"] | "", sizeof dernieresNouvelles - 1);

  modeDev = (etat["dev"] | 0) == 1;
  // Intervalle borne : 1 min a 24 h (10 s au moins en mode developpement), quoi que dise le serveur
  reveilSecondes = constrain((uint32_t)(etat["reveil"] | 600), modeDev ? (uint32_t)10 : (uint32_t)60, (uint32_t)86400);
  const char* sig = etat["sig"] | "";
  const char* mode = etat["mode"] | "tableau";
  int rotation = etat["rotation"] | 0;      // 0 = paysage, 1 ou 3 = portrait
  dernierMode = strcmp(mode, "photo") == 0 ? 'p' : strcmp(mode, "pochette") == 0 ? 'c' : strcmp(mode, "blanc") == 0 ? 'b' : 't';
  rotationEcran = dernierMode == 'p' ? 0 : rotation;
  Serial.printf("Mode %s, signature %s%s\n", mode, sig, modeDev ? " (developpement)" : "");

  // Nouveau programme disponible ? (seulement si la batterie est assez chargee :
  // l'ecriture dure environ 30 s. Sur USB sans batterie, la mesure est ignoree.)
  const char* fw = etat["fw"] | "";
  if (fw[0] && (vBat > 3.6 || vBat < 2.5)) mettreAJourProgramme(fw);

  // 2. Rien de nouveau ? On redessine quand meme avant que le dernier rafraichissement complet ait
  //    plus de 'cp' secondes (24 h par defaut) : le serveur commande alors le rafraichissement complet
  //    du jour, conseille par le fabricant
  uint32_t cp = etat["cp"] | 86400;
  bool nouveau = strcmp(sig, derniereSig) != 0;
  bool rafraichirQuandMeme = secondesDepuisComplet + reveilSecondes > cp && strcmp(mode, "blanc") != 0;
  if (!nouveau && !rafraichirQuandMeme) {
    if (ecranEnAttente) mettreEcranAJour('C', nullptr, 0);
    return reveilSecondes;
  }

  // 3. Dessin (dans le bon sens : la bibliotheque fait la rotation)
  canvas.setRotation(strcmp(mode, "photo") == 0 ? 0 : rotation);
  bool ok = true;
  if (strcmp(mode, "photo") == 0) {
    uint8_t* tampon = canvas.getBuffer();
    ok = telecharger("/api/photo", &tampon, OCTETS) == OCTETS;
  } else if (strcmp(mode, "pochette") == 0) {
    uint8_t* jpg = nullptr;
    int t = telecharger("/api/pochette.jpg", &jpg, 3000000);
    fermerConnexion();           // le decodage de la pochette a besoin de la memoire de la connexion
    ok = t && dessinerPochette(jpg, t, etat["titre"] | "", etat["artiste"] | "", etat["album"] | "");
    free(jpg);
  } else if (strcmp(mode, "blanc") == 0) {
    canvas.fillScreen(BLANC);
  } else {
    dessinerTableau(etat.as<JsonVariant>(), vBat);
  }
  if (!ok) { Serial.println("Echec du telechargement / decodage"); return reveilSecondes; }

  // 4. Image identique a celle de l'ecran, que le serveur a deja : seule une donnee invisible a change
  //    (le vent quand le bloc meteo est etroit, un evenement au-dela des lignes affichees...).
  //    Ni envoi (81 600 octets), ni rafraichissement. Sauf si le rafraichissement complet du jour est du :
  //    c'est le serveur qui le commande.
  uint32_t empreinte = empreinteImage(canvas.getBuffer(), OCTETS);
  if (empreinte == empreinteAffichee && empreinte == empreinteEnvoyee && !rafraichirQuandMeme) {
    Serial.println("Image identique a celle de l'ecran : pas d'envoi");
    strncpy(derniereSig, sig, sizeof derniereSig - 1);
    ecranEnAttente = false;
    return reveilSecondes;
  }

  // 5. Apercu web, plan du serveur, puis ecran
  uint8_t* plan = nullptr;
  int taillePlan = 0;
  char type = envoyerApercu(rotation, &plan, &taillePlan);
  strncpy(derniereSig, sig, sizeof derniereSig - 1);
  // Le Wi-Fi ne sert plus : coupe pendant le rafraichissement (sauf en mode developpement)
  if (!modeDev) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }
  mettreEcranAJour(type, plan, taillePlan);
  free(plan);
  return reveilSecondes;
}

void setup() {
  Serial.begin(115200);
  // Apres un appui sur RESET (ou a la mise sous tension), on laisse jusqu'a 10 s au
  // moniteur serie pour se connecter. Les reveils de veille n'attendent pas (batterie).
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_UNDEFINED) {
    unsigned long t0 = millis();
    while (!Serial && millis() - t0 < 10000) delay(10);
    delay(500);
  } else {
    delay(300);
  }
  calculerVersion();
  Serial.printf("Cadre e-ink, programme du %s\n", versionCarte);
  // Valeurs gardees pendant la veille : remises a zero si elles viennent d'un autre programme (apres une
  // mise a jour, leur place en memoire a pu changer). L'ecran sera alors nettoye au prochain affichage.
  if (strncmp(versionRtc, versionCarte, sizeof versionRtc) != 0) {
    empreinteAffichee = 0; empreinteEnvoyee = 0; secondesDepuisComplet = 0; partielsDepuisComplet = 0; eveilTotalMs = 0; ecranTotalMs = 0;
    secondesSansContact = 0; echecsDAffilee = 0; horsLigneAffiche = false; dernieresNouvelles[0] = 0;
    rotationEcran = 0; dernierMode = 0;
    strncpy(versionRtc, versionCarte, sizeof versionRtc - 1);
    versionRtc[sizeof versionRtc - 1] = 0;
  }
  verifierProgramme();
  preparerDessin();

  // Garde-fou : redemarrage anormal (plantage, blocage, tension trop basse) ?
  if (gf.magie != MAGIE_GF || strncmp(gf.version, versionCarte, sizeof gf.version) != 0) {
    memset(&gf, 0, sizeof gf);            // batterie branchee, ou autre programme
    gf.magie = MAGIE_GF;
    strncpy(gf.version, versionCarte, sizeof gf.version - 1);
  }
  char anormal = demarrageAnormal();
  gf.tropLong = false;
  if (anormal) {
    gf.dAffilee++;
    gf.total++;
    gf.dernier = anormal;
    Serial.printf("Redemarrage anormal (%c), %u d'affilee\n", anormal, gf.dAffilee);
    // Nouveau programme qui plante : retour au precedent tout de suite
    if (enEssai) revenirAuPrecedent("plantage");
    // 3 d'affilee : on n'insiste pas, une heure de repos (puis nouvel essai)
    if (gf.dAffilee >= 3) {
      Serial.println("Garde-fou : 3 redemarrages anormaux d'affilee, pause d'une heure");
      dormir(3600);
    }
  }

  unsigned long compte = 0;      // part de millis() deja comptee dans le temps d'eveil
  uint8_t essaisSansContact = 0;
  while (true) {
    armerGardeFou();
    uint32_t s = cycle();
    fermerConnexion();                   // (deja fermee, sauf si le cycle s'est arrete en route)
    desarmerGardeFou();
    gf.dAffilee = 0;                     // cycle termine sans plantage
    eveilTotalMs += millis() - compte;   // envoye au serveur au reveil suivant
    compte = millis();
    // temps depuis la derniere reponse du serveur (la veille qui suit compte deja)
    if (contactOk) secondesSansContact = s;
    else if (contactTente) secondesSansContact += s;
    // Nouveau programme qui n'a pas encore joint le serveur : pas de veille (au reveil, la carte reviendrait
    // a l'ancien programme), mais 3 essais a 30 s d'intervalle, puis retour au programme precedent
    if (enEssai && !contactOk) {
      if (++essaisSansContact >= 3) revenirAuPrecedent("serveur injoignable");
      Serial.println("Nouveau programme a l'essai : nouvel essai dans 30 s");
      delay(30000);
      continue;
    }
    secondesDepuisComplet += s;
    if (!modeDev) dormir(s);   // fonctionnement normal : veille profonde
    // Mode developpement : la carte reste allumee (le televersement marche sans le bouton BOOT)
    Serial.printf("Mode developpement : prochain cycle dans %u s\n", s);
    delay(s * 1000UL);
  }
}

void loop() {}
