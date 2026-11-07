// =====================================================================
//  Cadre e-ink - programme de la carte (Adafruit Feather ESP32-S3, 4 Mo flash / 2 Mo PSRAM)
//
//  A chaque reveil :
//   1. connexion Wi-Fi, puis demande au serveur ce qu'il faut afficher
//   2. si quelque chose a change : dessin, affichage sur l'ecran,
//      envoi d'une copie de l'image au serveur (apercu web)
//   3. veille profonde jusqu'au prochain reveil
//
//  Ce fichier : reglages, Wi-Fi, ecran, veille. Le dessin de l'image est dans dessin.h
//  (meme dossier, second onglet de l'IDE Arduino).
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
const char* WIFI_SSID   = "NOM_DE_TA_BOX";
const char* WIFI_MDP    = "MOT_DE_PASSE";
const char* SERVEUR     = "https://cadre.TON-NOM.workers.dev";   // sans / a la fin
const char* CLE         = "TON_MOT_DE_PASSE";                    // la meme que dans Cloudflare (secours sans Access)
// Jeton de service Cloudflare Access du cadre (Zero Trust -> Access -> Service credentials).
// Laisser vide tant qu'Access n'est pas active sur le Worker.
const char* ACCES_ID     = "";   // CF-Access-Client-Id     (se termine par .access)
const char* ACCES_SECRET = "";   // CF-Access-Client-Secret
#define ECRAN_PRESENT 1   // 0 = pas d'ecran branche : on dessine quand meme et on envoie l'apercu
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
RTC_DATA_ATTR uint32_t secondesDepuisComplet = 0;   // depuis le dernier rafraichissement complet
RTC_DATA_ATTR uint32_t partielsDepuisComplet = 0;   // mises a jour partielles depuis le dernier complet
RTC_DATA_ATTR uint32_t eveilTotalMs = 0;            // temps passe hors veille, cumule
RTC_DATA_ATTR uint32_t ecranTotalMs = 0;            // dont temps de rafraichissement de l'ecran
RTC_DATA_ATTR char     versionRtc[16] = "";         // programme qui a ecrit ces valeurs

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

// Mise a jour du programme par Wi-Fi. Un echec est retente au plus 3 fois par version.
RTC_DATA_ATTR char versionEchouee[16] = "";
RTC_DATA_ATTR uint8_t echecsMaj = 0;
void mettreAJourProgramme(const char* version) {
  if (strcmp(version, versionEchouee) == 0 && echecsMaj >= 3) return;
  Serial.printf("Mise a jour du programme : %s -> %s\n", versionCarte, version);
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(30);
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.setLedPin(LED_BUILTIN, HIGH);  // la LED rouge s'allume pendant l'ecriture
  // le 4e argument ajoute les en-tetes d'identification a la requete de telechargement
  t_httpUpdate_return r = httpUpdate.update(client, String(SERVEUR) + "/api/firmware.bin?cle=" + encoderURL(CLE), "",
                                            [](HTTPClient* h) { identifier(h); });
  if (r == HTTP_UPDATE_OK) {
    Serial.println("Mise a jour terminee : redemarrage");
    Serial.flush();
    derniereSig[0] = 0;          // redessiner apres le redemarrage
    ESP.restart();
  }
  Serial.printf("Mise a jour : echec (%d) %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
  if (strcmp(version, versionEchouee) != 0) { strncpy(versionEchouee, version, sizeof versionEchouee - 1); echecsMaj = 0; }
  echecsMaj++;
}

// Telecharge une ressource du serveur. Renvoie la taille lue (0 si erreur).
// Si 'dest' est fourni, on y ecrit au plus 'max' octets ; sinon on alloue en PSRAM.
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

int telecharger(const String& chemin, uint8_t** dest, int max) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(SERVEUR) + chemin)) return 0;
  identifier(&http);
  http.setTimeout(20000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("GET %s : HTTP %d\n", chemin.c_str(), code);
    if (code < 0) {   // pas de reponse du serveur : on detaille la cause
      Serial.printf("  erreur : %s\n", http.errorToString(code).c_str());
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
      int n = client.lastError(e, sizeof e);
      Serial.printf("  connexion securisee : %d %s\n", n, e);
    }
    http.end();
    return 0;
  }
  int lu = lireCorps(http, dest, max);
  http.end();
  return lu;
}

// Envoie l'image dessinee (apercu de la page web) et recoit du serveur comment rafraichir l'ecran :
// 'R' rien (image identique), 'P', 'D' ou 'I' partiel (zones dans *plan, voir afficherZones),
// 'C' complet, 'N' complet avec nettoyage.
// Sans reponse lisible (serveur ancien, erreur) : 'C', sans risque.
static char envoyerApercu(int rotation, uint8_t** plan, int* taillePlan) {
  *plan = nullptr;
  *taillePlan = 0;
  char chemin[160];
  snprintf(chemin, sizeof chemin, "/api/apercu?r=%d&plan=1&crc=%08lx&dc=%lu&pr=%lu&np=%lu", rotation, (unsigned long)empreinteAffichee,
           (unsigned long)secondesDepuisComplet, (unsigned long)reveilSecondes, (unsigned long)partielsDepuisComplet);
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(SERVEUR) + chemin)) return 'C';
  identifier(&http);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "application/octet-stream");
  int code = http.POST(canvas.getBuffer(), OCTETS);
  char type = 'C';
  if (code == 200) {
    int t = lireCorps(http, plan, 60000);
    if (t >= 1 && (*plan)[0] && strchr("RPDICN", (*plan)[0])) { type = (char)(*plan)[0]; *taillePlan = t; }
  }
  http.end();
  if (!strchr("PDI", type)) { free(*plan); *plan = nullptr; *taillePlan = 0; }
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
//  P (simple)    : ancien contenu des zones (envoye par le serveur) dans la "precedente", une passe ;
//                  seuls les pixels qui changent bougent, sans clignotement.
//  D (double)    : pareil, en deux passes : les pixels qui changent recoivent deux impulsions.
//  I (inversion) : chaque zone passe en negatif, puis revient a la nouvelle image : tous ses pixels font
//                  un aller-retour complet (moins de traces, petit clignotement des seules zones).
bool afficherZones(const uint8_t* plan, int taille) {
  ZonePlan zones[16];
  int n = zonesDuPlan(plan, taille, zones, 16);
  if (n < 0) { Serial.println("Plan partiel illisible : rafraichissement complet"); return false; }
#if ECRAN_PRESENT
  uint8_t* img = canvas.getBuffer();
  allumerEcran(false);
  display.epd2.writeImageAgain(img, 0, 0, LARGEUR, HAUTEUR, true);
  if (plan[0] == 'I') {
    for (int k = 0; k < n; k++) display.epd2.writeImagePart(img, zones[k].x, zones[k].y, LARGEUR, HAUTEUR, zones[k].x, zones[k].y, zones[k].w, zones[k].h, false);
    display.epd2.refresh(true);    // zones en negatif
    for (int k = 0; k < n; k++) {
      display.epd2.writeImagePartToPrevious(img, zones[k].x, zones[k].y, LARGEUR, HAUTEUR, zones[k].x, zones[k].y, zones[k].w, zones[k].h, false);
      display.epd2.writeImagePart(img, zones[k].x, zones[k].y, LARGEUR, HAUTEUR, zones[k].x, zones[k].y, zones[k].w, zones[k].h, true);
    }
    display.epd2.refresh(true);    // retour a la nouvelle image
  } else {
    for (int k = 0; k < n; k++) display.epd2.writeImageToPrevious(zones[k].ancien, zones[k].x, zones[k].y, zones[k].w, zones[k].h, true);
    display.epd2.refresh(true);    // partiel sur tout l'ecran : seuls les pixels differents bougent
    if (plan[0] == 'D') display.epd2.refresh(true);   // memoires inchangees : memes pixels, 2e impulsion
  }
  eteindreEcran();
#endif
  return true;
}

bool modeDev = false;                 // envoye par le serveur (menu Reveil de la page web)
unsigned long dernierAffichageMs = 0;  // pour respecter 3 min entre deux rafraichissements
bool ecranEnAttente = false;

void dormir(uint32_t secondes) {
  if (WiFi.getMode() != WIFI_OFF) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }
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
  if (empreinteAffichee == 0) type = 'N';       // image a l'ecran inconnue (demarrage) : nettoyage
  if (type == 'R') { ecranEnAttente = false; Serial.println("Ecran : image identique, rien a rafraichir"); return; }
  bool demandePartiel = strchr("PDI", type) != nullptr;
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
  if (partiel) Serial.printf("Ecran : mise a jour partielle (%s) en %lu ms\n", type == 'I' ? "inversion" : type == 'D' ? "double" : "simple", duree);
  else Serial.printf("Ecran : %s en %lu ms\n", type == 'N' ? "complet avec nettoyage" : "complet", duree);
  empreinteAffichee = empreinteImage(canvas.getBuffer(), OCTETS);
  if (partiel) partielsDepuisComplet++;
  else { secondesDepuisComplet = 0; partielsDepuisComplet = 0; }
  dernierAffichageMs = millis();
  ecranEnAttente = false;
}

// Un cycle complet. Renvoie le nombre de secondes avant le suivant.
uint32_t cycle() {
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

  if (!connecterWifi()) return reveilSecondes;

  // 1. Que faut-il afficher ?
  uint8_t* brut = nullptr;
  char chemin[128];
  int lg = snprintf(chemin, sizeof chemin, "/api/etat?bat=%.2f&fw=%s", vBat, versionCarte);
  if (pctJauge >= 0) lg += snprintf(chemin + lg, sizeof chemin - lg, "&pct=%.1f", pctJauge);
  if (vitesseLue) lg += snprintf(chemin + lg, sizeof chemin - lg, "&crate=%.1f", vitesseJauge);
  snprintf(chemin + lg, sizeof chemin - lg, "&ev=%lu&ee=%lu", (unsigned long)eveilTotalMs, (unsigned long)ecranTotalMs);
  int n = telecharger(chemin, &brut, 32768);
  if (!n) { free(brut); return reveilSecondes; }
  JsonDocument etat;
  DeserializationError err = deserializeJson(etat, (const char*)brut, n);
  free(brut);
  if (err) { Serial.println("Reponse illisible"); return reveilSecondes; }

  reveilSecondes = etat["reveil"] | 600;
  modeDev = (etat["dev"] | 0) == 1;
  const char* sig = etat["sig"] | "";
  const char* mode = etat["mode"] | "tableau";
  int rotation = etat["rotation"] | 0;      // 0 = paysage, 1 ou 3 = portrait
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
    ok = t && dessinerPochette(jpg, t, etat["titre"] | "", etat["artiste"] | "", etat["album"] | "");
    free(jpg);
  } else if (strcmp(mode, "blanc") == 0) {
    canvas.fillScreen(BLANC);
  } else {
    dessinerTableau(etat.as<JsonVariant>(), vBat);
  }
  if (!ok) { Serial.println("Echec du telechargement / decodage"); return reveilSecondes; }

  // 4. Apercu web, plan du serveur, puis ecran
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
    empreinteAffichee = 0; secondesDepuisComplet = 0; partielsDepuisComplet = 0; eveilTotalMs = 0; ecranTotalMs = 0;
    strncpy(versionRtc, versionCarte, sizeof versionRtc - 1);
    versionRtc[sizeof versionRtc - 1] = 0;
  }
  preparerDessin();
  unsigned long compte = 0;      // part de millis() deja comptee dans le temps d'eveil
  while (true) {
    uint32_t s = cycle();
    eveilTotalMs += millis() - compte;   // envoye au serveur au reveil suivant
    compte = millis();
    secondesDepuisComplet += s;
    if (!modeDev) dormir(s);   // fonctionnement normal : veille profonde
    // Mode developpement : la carte reste allumee (le televersement marche sans le bouton BOOT)
    Serial.printf("Mode developpement : prochain cycle dans %u s\n", s);
    delay(s * 1000UL);
  }
}

void loop() {}
