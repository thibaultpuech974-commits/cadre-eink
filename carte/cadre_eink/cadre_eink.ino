// =====================================================================
//  Cadre e-ink - programme de la carte (XIAO ESP32S3)
//
//  A chaque reveil :
//   1. connexion Wi-Fi, puis demande au serveur ce qu'il faut afficher
//   2. si quelque chose a change : dessin, affichage sur l'ecran,
//      envoi d'une copie de l'image au serveur (apercu web)
//   3. veille profonde jusqu'au prochain reveil
//
//  Bibliotheques (gestionnaire de bibliotheques de l'IDE Arduino) :
//    GxEPD2, U8g2_for_Adafruit_GFX, ArduinoJson, JPEGDEC (bitbank2)
//
//  Reglage obligatoire dans l'IDE : Outils -> PSRAM -> "OPI PSRAM"
//  Pour la mise a jour par Wi-Fi : Outils -> Partition Scheme -> un schema
//  avec OTA (celui par defaut convient ; pas "Huge APP (no OTA)")
// =====================================================================

// ======================= A PERSONNALISER ==============================
const char* WIFI_SSID   = "NOM_DE_TA_BOX";
const char* WIFI_MDP    = "MOT_DE_PASSE";
const char* SERVEUR     = "https://cadre.TON-NOM.workers.dev";   // sans / a la fin
const char* CLE         = "TON_MOT_DE_PASSE";                    // la meme que dans Cloudflare
#define ECRAN_PRESENT 1   // 0 = pas d'ecran branche : on dessine quand meme et on envoie l'apercu
// =====================================================================

#ifndef HOTE   // (HOTE n'est defini que pour les tests sur ordinateur)
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>
#include <GxEPD2_BW.h>
#include <driver/gpio.h>
#include <esp_sleep.h>
#endif
#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <ArduinoJson.h>
#include <JPEGDEC.h>
#include <math.h>

// --- Broches (cf. schema) ---
#define EPD_CS        D1
#define EPD_DC        D2
#define EPD_RST       D3
#define EPD_BUSY      D7
#define EPD_PWR       D6
#define PIN_BATTERIE  D9          // milieu du pont diviseur 470k / 470k
// DIN -> D10, CLK -> D8

#define LARGEUR 960
#define HAUTEUR 680
#define OCTETS  ((LARGEUR / 8) * HAUTEUR)   // 81 600
#define NOIR  1
#define BLANC 0

// Rectangle dans lequel un widget se dessine (defini ici, tout en haut,
// pour que l'IDE Arduino le connaisse avant ses declarations automatiques)
struct Boite { int x, y, w, h; };
// Style du texte du bloc en cours de dessin : e = echelle (0,8 a 1,5), f = famille de police
struct Style { float e; int f; };

GFXcanvas1 canvas(LARGEUR, HAUTEUR);      // l'image est d'abord dessinee ici
U8G2_FOR_ADAFRUIT_GFX u8g2;

// =====================================================================
//  OUTILS DE DESSIN
// =====================================================================
// Attention : la bibliotheque remet le texte en mode "fond opaque" a chaque changement de police,
// on repasse donc en mode transparent a chaque fois (sinon le texte efface ce qu'il y a dessous).
void police(const uint8_t* f) { u8g2.setFont(f); u8g2.setFontMode(1); }

int largeurTexte(const char* s) { return u8g2.getUTF8Width(s); }

void texte(int x, int y, const char* s) { u8g2.drawUTF8(x, y, s); }
void texteDroite(int xDroite, int y, const char* s) { u8g2.drawUTF8(xDroite - largeurTexte(s), y, s); }
void texteCentre(int xCentre, int y, const char* s) { u8g2.drawUTF8(xCentre - largeurTexte(s) / 2, y, s); }

// Coupe le texte (proprement, sur un caractere UTF-8) pour qu'il tienne dans la largeur
void texteTronque(int x, int y, const char* s, int largeurMax) {
  if (largeurTexte(s) <= largeurMax) { texte(x, y, s); return; }
  char tampon[160];
  strncpy(tampon, s, sizeof(tampon) - 4);
  tampon[sizeof(tampon) - 4] = 0;
  int n = strlen(tampon);
  while (n > 0) {
    do { n--; } while (n > 0 && (tampon[n] & 0xC0) == 0x80);   // recule d'un caractere
    strcpy(tampon + n, "...");
    if (largeurTexte(tampon) <= largeurMax) break;
  }
  texte(x, y, tampon);
}

// Texte sur plusieurs lignes (coupure aux espaces). Renvoie le y de la ligne suivante.
int texteMultiligne(int x, int y, const char* s, int largeurMax, int interligne, int lignesMax) {
  char ligne[160] = "";
  const char* p = s;
  int lignes = 0;
  while (*p && lignes < lignesMax) {
    while (*p == ' ') p++;
    const char* fin = p;
    while (*fin && *fin != ' ') fin++;
    char essai[160];
    snprintf(essai, sizeof essai, "%s%s%.*s", ligne, ligne[0] ? " " : "", (int)(fin - p), p);
    if (ligne[0] && largeurTexte(essai) > largeurMax) {
      lignes++;
      if (lignes == lignesMax) {
        char reste[200];
        snprintf(reste, sizeof reste, "%s %s", ligne, p);
        texteTronque(x, y, reste, largeurMax);
        return y + interligne;
      }
      texte(x, y, ligne);
      y += interligne;
      ligne[0] = 0;
      continue;
    }
    strncpy(ligne, essai, sizeof ligne - 1);
    p = fin;
  }
  if (ligne[0] && lignes < lignesMax) { texteTronque(x, y, ligne, largeurMax); y += interligne; }
  return y;
}

// Trait epais entre deux points
void trait(float x0, float y0, float x1, float y1, float e) {
  const uint16_t c = NOIR;
  float dx = x1 - x0, dy = y1 - y0, l = sqrtf(dx * dx + dy * dy);
  if (l < 0.1f) return;
  float nx = -dy / l * e / 2, ny = dx / l * e / 2;
  canvas.fillTriangle(x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 + nx, y1 + ny, c);
  canvas.fillTriangle(x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, c);
  canvas.fillCircle(x0, y0, e / 2, c);
  canvas.fillCircle(x1, y1, e / 2, c);
}

void formeNuage(float cx, float cy, float s, uint16_t c) {
  canvas.fillCircle(cx - 0.22f * s, cy + 0.05f * s, 0.18f * s, c);
  canvas.fillCircle(cx + 0.02f * s, cy - 0.08f * s, 0.25f * s, c);
  canvas.fillCircle(cx + 0.25f * s, cy + 0.06f * s, 0.17f * s, c);
  canvas.fillRect(cx - 0.22f * s, cy + 0.05f * s, 0.47f * s, 0.18f * s + 1, c);
}
// Nuage dessine en contour
void nuage(float cx, float cy, float s) {
  float e = s > 80 ? s * 0.06f : 3;
  formeNuage(cx, cy, s, NOIR);
  formeNuage(cx, cy + e * 0.15f, s - 2.4f * e, BLANC);
}
void soleil(float cx, float cy, float r) {
  canvas.fillCircle(cx, cy, r, NOIR);
  float e = r > 20 ? r * 0.22f : 3;
  for (int i = 0; i < 8; i++) {
    float a = i * PI / 4;
    trait(cx + cosf(a) * r * 1.45f, cy + sinf(a) * r * 1.45f, cx + cosf(a) * r * 1.95f, cy + sinf(a) * r * 1.95f, e);
  }
}
void lune(float cx, float cy, float r) {
  canvas.fillCircle(cx, cy, r, NOIR);
  canvas.fillCircle(cx + r * 0.55f, cy - r * 0.35f, r * 0.85f, BLANC);
}

// Icone meteo (code WMO) dans un carre de cote s, coin haut-gauche (x, y)
void icone(int x, int y, int s, int code, bool nuit) {
  float cx = x + s / 2.0f, cy = y + s / 2.0f, e = s > 80 ? s * 0.055f : 3;
  if (code <= 1) {
    if (nuit) lune(cx, cy, s * 0.30f); else soleil(cx, cy, s * 0.21f);
  } else if (code == 2) {
    if (nuit) lune(x + s * 0.36f, y + s * 0.34f, s * 0.20f); else soleil(x + s * 0.36f, y + s * 0.34f, s * 0.14f);
    nuage(x + s * 0.56f, y + s * 0.58f, s * 0.78f);
  } else if (code == 3) {
    nuage(cx, cy, s * 0.95f);
  } else if (code == 45 || code == 48) {
    for (int i = 0; i < 4; i++) trait(x + s * (0.12f + 0.06f * (i % 2)), y + s * (0.3f + 0.15f * i), x + s * (0.82f + 0.06f * (i % 2)), y + s * (0.3f + 0.15f * i), e);
  } else if (code >= 95) {
    nuage(cx, y + s * 0.38f, s * 0.92f);
    float bx = x + s * 0.5f, by = y + s * 0.58f;
    canvas.fillTriangle(bx + s * 0.06f, by, bx - s * 0.12f, by + s * 0.22f, bx + s * 0.02f, by + s * 0.22f, NOIR);
    canvas.fillTriangle(bx + s * 0.02f, by + s * 0.16f, bx + s * 0.10f, by + s * 0.16f, bx - s * 0.06f, by + s * 0.42f, NOIR);
  } else if ((code >= 71 && code <= 77) || code == 85 || code == 86) {
    nuage(cx, y + s * 0.38f, s * 0.92f);
    for (int i = 0; i < 3; i++) {
      float fx = x + s * (0.3f + 0.2f * i), fy = y + s * (0.75f + (i % 2) * 0.1f), r = s * 0.06f;
      trait(fx - r, fy, fx + r, fy, e * 0.8f);
      trait(fx - r * 0.5f, fy - r * 0.87f, fx + r * 0.5f, fy + r * 0.87f, e * 0.8f);
      trait(fx - r * 0.5f, fy + r * 0.87f, fx + r * 0.5f, fy - r * 0.87f, e * 0.8f);
    }
  } else {   // bruine, pluie, averses
    nuage(cx, y + s * 0.38f, s * 0.92f);
    int gouttes = (code == 51 || code == 61 || code == 80) ? 2 : 3;
    for (int i = 0; i < gouttes; i++) {
      float gx = x + s * (gouttes == 2 ? 0.4f + 0.2f * i : 0.32f + 0.18f * i);
      trait(gx + s * 0.05f, y + s * 0.68f, gx - s * 0.03f, y + s * 0.88f, e);
    }
  }
}

// =====================================================================
//  POLICES : taille et famille reglables bloc par bloc (page web)
// =====================================================================
Style st = {1.0f, 0};

// Familles : 0 Moderne, 1 Helvetica, 2 Classique (a empattements), 3 Machine a ecrire
const uint8_t* const POLICES_R[4][9] = {
  {u8g2_font_fur11_tf, u8g2_font_fur14_tf, u8g2_font_fur17_tf, u8g2_font_fur20_tf, u8g2_font_fur25_tf, u8g2_font_fur30_tf, u8g2_font_fur35_tf, u8g2_font_fur42_tf, nullptr},
  {u8g2_font_helvR08_tf, u8g2_font_helvR10_tf, u8g2_font_helvR12_tf, u8g2_font_helvR14_tf, u8g2_font_helvR18_tf, u8g2_font_helvR24_tf, nullptr},
  {u8g2_font_ncenR08_tf, u8g2_font_ncenR10_tf, u8g2_font_ncenR12_tf, u8g2_font_ncenR14_tf, u8g2_font_ncenR18_tf, u8g2_font_ncenR24_tf, nullptr},
  {u8g2_font_courR08_tf, u8g2_font_courR10_tf, u8g2_font_courR12_tf, u8g2_font_courR14_tf, u8g2_font_courR18_tf, u8g2_font_courR24_tf, nullptr},
};
const uint8_t* const POLICES_B[4][9] = {
  {u8g2_font_fub11_tf, u8g2_font_fub14_tf, u8g2_font_fub17_tf, u8g2_font_fub20_tf, u8g2_font_fub25_tf, u8g2_font_fub30_tf, u8g2_font_fub35_tf, u8g2_font_fub42_tf, nullptr},
  {u8g2_font_helvB08_tf, u8g2_font_helvB10_tf, u8g2_font_helvB12_tf, u8g2_font_helvB14_tf, u8g2_font_helvB18_tf, u8g2_font_helvB24_tf, nullptr},
  {u8g2_font_ncenB08_tf, u8g2_font_ncenB10_tf, u8g2_font_ncenB12_tf, u8g2_font_ncenB14_tf, u8g2_font_ncenB18_tf, u8g2_font_ncenB24_tf, nullptr},
  {u8g2_font_courB08_tf, u8g2_font_courB10_tf, u8g2_font_courB12_tf, u8g2_font_courB14_tf, u8g2_font_courB18_tf, u8g2_font_courB24_tf, nullptr},
};
const uint8_t* const CHIFFRES[] = {
  u8g2_font_logisoso16_tn, u8g2_font_logisoso20_tn, u8g2_font_logisoso24_tn, u8g2_font_logisoso28_tn, u8g2_font_logisoso32_tn,
  u8g2_font_logisoso38_tn, u8g2_font_logisoso42_tn, u8g2_font_logisoso50_tn, u8g2_font_logisoso58_tn, u8g2_font_logisoso62_tn,
  u8g2_font_logisoso78_tn, u8g2_font_logisoso92_tn, nullptr};

int asc() { return u8g2.getFontAscent(); }

// Choisit la plus grande police de la liste dont la hauteur ne depasse pas 'cible' pixels
void choisirDans(const uint8_t* const* liste, float cible) {
  const uint8_t* choix = liste[0];
  for (int i = 0; liste[i]; i++) {
    police(liste[i]);
    if (asc() <= cible * 1.08f) choix = liste[i];
  }
  police(choix);
}
// Police de texte d'une taille "nominale" (hauteur des majuscules en pixels), selon le style du bloc
void policeT(int taille, bool gras) {
  int f = (st.f >= 0 && st.f < 4) ? st.f : 0;
  choisirDans(gras ? POLICES_B[f] : POLICES_R[f], taille * st.e);
}
void policeChiffres(float taille) { choisirDans(CHIFFRES, taille); }

int pourcentBatterie(float v) {
  const float T[] = {3.30, 3.50, 3.60, 3.65, 3.70, 3.75, 3.80, 3.90, 4.00, 4.10, 4.20};
  const int   P[] = {   0,    5,   10,   20,   30,   40,   50,   65,   80,   90,  100};
  if (v <= T[0]) return 0;
  for (int i = 0; i < 10; i++) if (v < T[i + 1]) return P[i] + (int)((v - T[i]) / (T[i + 1] - T[i]) * (P[i + 1] - P[i]));
  return 100;
}

// Batterie : icone + pourcentage, alignes a droite sur xDroite et centres sur yCentre
void dessinerBatterie(float v, int xDroite, int yCentre) {
  if (v < 2.5) return;                    // pas de batterie mesuree (pont non cable)
  int w = 52, h = 28, x = xDroite - w - 5, y = yCentre - h / 2;
  canvas.drawRect(x, y, w, h, NOIR);
  canvas.drawRect(x + 1, y + 1, w - 2, h - 2, NOIR);
  canvas.fillRect(x + w, y + 8, 5, h - 16, NOIR);
  int p = pourcentBatterie(v);
  canvas.fillRect(x + 4, y + 4, (w - 8) * p / 100, h - 8, NOIR);
  policeT(20, false);
  char txt[32];
  if (v < 3.5) snprintf(txt, sizeof txt, "Recharger ! %d %%", p);
  else         snprintf(txt, sizeof txt, "%d %%", p);
  texteDroite(x - 14, yCentre + asc() / 2, txt);
}

void degre(int x, int y, int r, int e) {
  for (int i = 0; i < e; i++) canvas.drawCircle(x, y, r - i, NOIR);
}

// =====================================================================
//  ECRAN 1 : TABLEAU DE BORD
//  Chaque widget se dessine dans la "boite" que lui donne la disposition
//  choisie sur la page web, et adapte son contenu a la taille disponible.
// =====================================================================
// y de depart pour centrer verticalement un bloc de hauteur 'haut'
int centrerV(Boite b, int haut) { return b.y + max(0, (b.h - haut) / 2); }

void widgetDate(JsonVariant e, Boite b, float vBat) {
  const char* date = e["date"] | "";
  policeT(20, false);
  int largBat = largeurTexte("Recharger ! 100 %") / 2 + 120;
  bool bat = vBat >= 2.5 && b.w >= 360 + largBat;
  int dispo = b.w - (bat ? largBat : 0);
  // La plus grande taille qui tient en hauteur et en largeur
  const int tailles[] = {42, 35, 30, 25, 20, 17, 14, 11};
  for (int i = 0; i < 8; i++) {
    policeT(tailles[i], true);
    if (asc() <= b.h * 0.62f && largeurTexte(date) <= dispo) break;
  }
  int base = b.y + (b.h + asc()) / 2;
  texteTronque(b.x, base, date, dispo);
  if (bat) dessinerBatterie(vBat, b.x + b.w, b.y + b.h / 2);
}

void widgetMeteo(JsonVariant m, Boite b) {
  char t[64];
  if (m.isNull() || m["erreur"].is<const char*>()) {
    policeT(25, true);
    texteTronque(b.x, b.y + (b.h + asc()) / 2, "Météo indisponible", b.w);
    return;
  }
  // Hauteurs des lignes de texte selon le style du bloc
  policeT(25, true);  int aD = asc(), ligneD = aD * 8 / 5;
  policeT(20, false); int aM = asc(), ligneM = aM * 8 / 5;

  int largDetails = min((int)(360 * st.e), b.w * 45 / 100);
  bool details = b.w >= 760 && b.w - largDetails >= 420;
  if (!details) largDetails = 0;
  int s = min(min(b.h - 4, 160), (b.w - largDetails) / 3);
  icone(b.x, b.y + (b.h - s) / 2, s, m["c"] | 0, (m["n"] | 0) == 1);
  int xt = b.x + s + 22;
  int largTexte = b.x + b.w - largDetails - xt - (details ? 20 : 0);

  // Temperature : la plus grande qui laisse la place aux lignes de texte
  float cible = (b.h >= 175 ? 78 : (b.h >= 125 ? 62 : 42)) * st.e;
  policeChiffres(cible);
  int aT = asc();
  while (aT > 16 && aT + ligneD > b.h && cible > 16) { cible -= 4; policeChiffres(cible); aT = asc(); }
  bool avecDesc = b.h >= aT + ligneD;
  bool avecMinMax = b.h >= aT + ligneD + ligneM;
  int y = centrerV(b, aT + (avecDesc ? ligneD : 0) + (avecMinMax ? ligneM : 0));

  snprintf(t, sizeof t, "%d", (int)(m["t"] | 0));
  texte(xt, y + aT, t);
  int r = max(4, aT / 7);
  int xd = xt + largeurTexte(t) + r + 6;
  degre(xd, y + r + 2, r, max(2, r / 3));
  policeT(aT >= 60 ? 30 : 20, true);
  texte(xd + r + 4, y + asc() + 2, "C");
  y += aT;
  if (avecDesc) {
    policeT(largTexte >= 330 * st.e ? 25 : 20, true);
    y += ligneD;
    texteTronque(xt, y, m["desc"] | "", largTexte);
  }
  if (avecMinMax) {
    policeT(20, false);
    y += ligneM;
    if (m["ressenti"].is<int>())
      snprintf(t, sizeof t, "Min %d°  ·  Max %d°  ·  Ressenti %d°", (int)m["min"], (int)m["max"], (int)m["ressenti"]);
    if (!m["ressenti"].is<int>() || largeurTexte(t) > largTexte)
      snprintf(t, sizeof t, "Min %d°  ·  Max %d°", (int)(m["min"] | 0), (int)(m["max"] | 0));
    texteTronque(xt, y, t, largTexte);
  }

  if (details) {
    char l[5][48];
    int n = 0;
    int pas = aM * 7 / 5;
    int maxLignes = max(0, (b.h - aD - 4) / pas);
    if (m["vent"].is<JsonObject>())
      snprintf(l[n++], 48, "Vent %d km/h %s (raf. %d)", (int)m["vent"]["v"], (const char*)(m["vent"]["dir"] | ""), (int)m["vent"]["raf"]);
    if (m["hum"].is<int>()) {
      snprintf(l[n++], 48, "Humidité %d %%", (int)m["hum"]);
      snprintf(l[n++], 48, "Pluie d'ici 12 h : %d %%", (int)(m["pluie"] | 0));
    }
    if (m["soleil"].is<JsonObject>()) {
      const char* lev = m["soleil"]["lever"] | "";
      const char* cou = m["soleil"]["coucher"] | "";
      if (n + 2 <= maxLignes) {            // assez de place : deux lignes claires
        snprintf(l[n++], 48, "Lever du soleil %s", lev);
        snprintf(l[n++], 48, "Coucher du soleil %s", cou);
      } else {                             // sinon une ligne compacte (sans le zero initial)
        snprintf(l[n++], 48, "Lever %s · Coucher %s", lev[0] == '0' ? lev + 1 : lev, cou);
      }
    }
    n = min(n, maxLignes);
    int yd = centrerV(b, aD + 4 + n * pas) + aD;
    int xr = b.x + b.w;
    policeT(25, true);
    texteTronque(xr - min(largeurTexte(m["ville"] | ""), largDetails), yd, m["ville"] | "", largDetails);
    yd += 4;
    policeT(20, false);
    for (int i = 0; i < n; i++) {
      yd += pas;
      if (largeurTexte(l[i]) <= largDetails) texteDroite(xr, yd, l[i]);
      else texteTronque(xr - largDetails, yd, l[i], largDetails);
    }
  }
}

// Prochaines heures (jours = false) ou prochains jours (jours = true), en colonnes
void widgetColonnes(JsonArray liste, Boite b, bool jours) {
  int n = liste.size();
  if (!n) return;
  policeT(17, jours); int aL = asc();
  if (jours) policeT(17, false); else policeT(20, true);
  int aV = asc();
  policeT(14, false); int aP = asc();

  int nb = min(n, max(1, (int)(b.w / ((jours ? 100 : 72) * st.e))));
  float l = (float)b.w / nb;
  int fixe = aL + 8 + 6 + aV;                // libelle + espaces + valeur
  bool pluie = b.h >= fixe + 30 + 8 + aP;
  int s = b.h - fixe - (pluie ? 8 + aP : 0) - 4;
  s = max(20, min(s, min((int)(72 * st.e), (int)l - 14)));
  int y = centrerV(b, fixe + s + (pluie ? 8 + aP : 0));
  int i = 0;
  char t[24];
  for (JsonObject o : liste) {
    if (i >= nb) break;
    int cx = b.x + l * i + l / 2;
    policeT(17, jours);
    texteCentre(cx, y + aL, o[jours ? "j" : "h"] | "");
    icone(cx - s / 2, y + aL + 8, s, o["c"] | 0, !jours && (o["n"] | 0) == 1);
    int yv = y + aL + 8 + s + 6 + aV;
    if (jours) { policeT(17, false); snprintf(t, sizeof t, "%d° / %d°", (int)(o["min"] | 0), (int)(o["max"] | 0)); }
    else       { policeT(20, true);  snprintf(t, sizeof t, "%d°", (int)(o["t"] | 0)); }
    if (jours && largeurTexte(t) > l * 0.85f) {      // trop large (grosse police) : version courte
      snprintf(t, sizeof t, "%d°/%d°", (int)(o["min"] | 0), (int)(o["max"] | 0));
      if (largeurTexte(t) > l * 0.85f) policeT(14, false);
    }
    texteCentre(cx, yv, t);
    if (pluie) {
      policeT(14, false);
      snprintf(t, sizeof t, "pluie %d %%", (int)(o["p"] | 0));
      if (largeurTexte(t) > l - 6) snprintf(t, sizeof t, "%d %%", (int)(o["p"] | 0));
      texteCentre(cx, yv + 8 + aP, t);
    }
    i++;
  }
}

void widgetAgenda(JsonVariant ag, Boite b) {
  if (ag.isNull()) return;
  policeT(20, false);
  if (ag["erreur"].is<const char*>()) { texteTronque(b.x, b.y + asc() + 6, ag["erreur"].as<const char*>(), b.w); return; }
  JsonArray evts = ag.as<JsonArray>();
  if (evts.size() == 0) { texte(b.x, b.y + asc() + 6, "Rien de prévu"); return; }
  policeT(17, false);
  int aE = asc();
  int pas = aE * 17 / 10 + 1;
  int lignes = max(1, (b.h - aE / 2) / pas + 1);
  // Colonne des jours : aussi large que le libelle le plus long ("Aujourd'hui"...), dans la limite de 35 %
  policeT(17, true);
  int colJour = 0, kj = 0;
  for (JsonObject e : evts) {
    if (kj++ >= lignes) break;
    colJour = max(colJour, (int)largeurTexte(e["j"] | ""));
  }
  colJour = min(colJour + 16, b.w * 35 / 100);
  policeT(17, false);
  // Colonne des heures assez large pour le texte le plus long affiche ("00:00", "en cours"...)
  int largHeure = largeurTexte("00:00");
  int k = 0;
  for (JsonObject e : evts) {
    if (k++ >= lignes) break;
    largHeure = max(largHeure, (int)largeurTexte(e["h"] | ""));
  }
  largHeure = min(largHeure + 14, b.w * 3 / 10);
  bool colHeure = b.w >= colJour + largHeure + 120;
  int xHeure = b.x + colJour, xTitre = xHeure + largHeure;
  int i = 0;
  char tampon[160];
  for (JsonObject e : evts) {
    if (i >= lignes) break;
    int yy = b.y + aE + 4 + i * pas;
    if (yy > b.y + b.h) break;
    policeT(17, true);
    texteTronque(b.x, yy, e["j"] | "", colJour - 8);
    policeT(17, false);
    const char* h = e["h"] | "";
    const char* titre = e["t"] | "";
    if (h[0] && colHeure) {
      texteTronque(xHeure, yy, h, largHeure - 8);
      texteTronque(xTitre, yy, titre, b.x + b.w - xTitre);
    } else {
      if (h[0]) { snprintf(tampon, sizeof tampon, "%s %s", h, titre); titre = tampon; }
      texteTronque(xHeure, yy, titre, b.x + b.w - xHeure);
    }
    i++;
  }
}

void widgetBus(JsonVariant bus, Boite b) {
  if (bus.isNull()) return;
  policeT(20, false);
  if (bus["erreur"].is<const char*>()) { texteTronque(b.x, b.y + asc() + 6, bus["erreur"].as<const char*>(), b.w); return; }
  if (bus["hors"].is<const char*>()) {     // en dehors du creneau choisi
    policeT(17, false);
    texteTronque(b.x, b.y + asc() + 6, bus["hors"].as<const char*>(), b.w);
    return;
  }
  JsonArray ps = bus["passages"];
  int y = b.y;
  // Nom de l'arret en petit, si la place le permet
  const char* arrets = bus["arrets"] | "";
  policeT(14, false);
  int aA = asc();
  if (arrets[0] && b.h >= 4 * aA + 30) {
    char t[120];
    snprintf(t, sizeof t, "Bus - %s", arrets);
    texteTronque(b.x, y + aA, t, b.w);
    y += aA + 10;
  }
  if (ps.isNull() || ps.size() == 0) { policeT(20, false); texte(b.x, y + asc() + 4, "Aucun bus prévu"); return; }

  policeT(17, true);  int aL = asc();
  policeT(20, true);  int aH = asc();
  int hBadge = aL + 12;
  int ligne = max(hBadge, aH) + max(8, aH / 2);
  policeT(20, true);
  int largHeure = largeurTexte("à 88h88") + 6;
  int i = 0;
  char t[48];
  for (JsonObject p : ps) {
    int cy = y + i * ligne + ligne / 2;
    if (cy + ligne / 2 > b.y + b.h + 4) break;
    // Pastille noire avec le numero de ligne
    policeT(17, true);
    const char* l = p["l"] | "";
    int wb = max(largeurTexte(l) + 14, hBadge * 3 / 2);
    canvas.fillRoundRect(b.x, cy - hBadge / 2, wb, hBadge, 6, NOIR);
    u8g2.setForegroundColor(BLANC);
    texteCentre(b.x + wb / 2, cy + aL / 2, l);
    u8g2.setForegroundColor(NOIR);
    // Heure de passage a droite : "a 18h42" (temps reel) ou "vers 18h42" (horaire theorique)
    int xr = b.x + b.w;
    if ((p["x"] | 0) == 1) { policeT(17, false); strcpy(t, "supprimé"); }
    else {
      policeT(20, true);
      snprintf(t, sizeof t, "%s %s", (p["tr"] | 0) == 1 ? "à" : "vers", (const char*)(p["h"] | ""));
    }
    int wh = max(largHeure, (int)largeurTexte(t));
    texteDroite(xr, cy + asc() / 2, t);
    int xFinDest = xr - wh - 10;
    // Destination
    policeT(17, false);
    int largDest = xFinDest - (b.x + wb + 10);
    if (largDest >= 50) texteTronque(b.x + wb + 10, cy + asc() / 2, p["d"] | "", largDest);   // sinon pas la place
    i++;
  }
}

// Trame "gris clair" ou "gris moyen" dans un rectangle (l'ecran n'a que du noir et blanc)
void trame(int x0, int y0, int w, int h, int pas) {
  for (int y = y0; y < y0 + h; y++)
    for (int x = x0; x < x0 + w; x++)
      if (pas == 4 ? ((x % 4 == 0) && (y % 4 == 0)) : ((x + y) % pas == 0)) canvas.drawPixel(x, y, NOIR);
}
void ligneHPointillee(int x0, int x1, int y) { for (int x = x0; x < x1; x += 6) canvas.drawFastHLine(x, y, 2, NOIR); }
void ligneVPointillee(int x, int y0, int y1) { for (int y = y0; y < y1; y += 6) canvas.drawFastVLine(x, y, 3, NOIR); }

// Graphique de temperature : courbe heure par heure, risque de pluie (barres hachurees), nuit (fond grise)
void widgetCourbe(JsonVariant g, Boite b) {
  JsonArray T = g["t"], P = g["p"], N = g["n"], J = g["j"];
  int n = T.size();
  if (n < 2) return;
  float tMin = 1e9, tMax = -1e9; int iMin = 0, iMax = 0;
  for (int i = 0; i < n; i++) {
    float t = T[i].as<int>() / 10.0f;
    if (t < tMin) { tMin = t; iMin = i; }
    if (t > tMax) { tMax = t; iMax = i; }
  }
  policeT(14, false); int aL = asc();
  int lg = largeurTexte("-88°") + 8;                     // colonne des graduations
  int x0 = b.x + lg, x1 = b.x + b.w - 6;
  int y0 = b.y + aL + 14, y1 = b.y + b.h - aL - 10;     // place pour les etiquettes min/max et les heures
  if (y1 - y0 < 30) return;
  // Echelle : pas "rond" de 1, 2, 5 ou 10 degres, 2 a 5 graduations
  float plage = max(2.0f, tMax - tMin);
  int pasT = plage <= 4 ? 1 : plage <= 9 ? 2 : plage <= 20 ? 5 : 10;
  if ((y1 - y0) / (plage / pasT) < aL * 1.6f && pasT < 10) pasT = pasT == 1 ? 2 : pasT == 2 ? 5 : 10;
  float bas = floorf(tMin / pasT) * pasT, haut = ceilf(tMax / pasT) * pasT;
  if (haut - bas < pasT) haut = bas + pasT;
  auto X = [&](float i) { return x0 + i * (x1 - x0) / (n - 1); };
  auto Y = [&](float t) { return y1 - (t - bas) * (y1 - y0) / (haut - bas); };
  float dx = (float)(x1 - x0) / (n - 1);
  // Nuit : fond grise
  for (int i = 0; i < n - 1; i++)
    if (N[i].as<int>() == 1) { int xa = X(i), xb = X(i + 1); trame(xa, y0, xb - xa, y1 - y0, 4); }
  // Risque de pluie : barres hachurees (100 % = 45 % de la hauteur)
  bool pluie = false;
  for (int i = 0; i < n; i++) {
    int p = P[i] | 0;
    if (p < 5) continue;
    pluie = true;
    int hb = p * (y1 - y0) * 45 / 10000, lb = max(3, (int)(dx * 0.6f));
    int xb = X(i) - lb / 2;
    xb = max(x0, min(xb, x1 - lb));
    trame(xb, y1 - hb, lb, hb, 3);
    canvas.drawFastHLine(xb, y1 - hb, lb, NOIR);
  }
  // Graduations
  char t[24];
  for (float v = bas; v <= haut + 0.01f; v += pasT) {
    int y = Y(v);
    ligneHPointillee(x0, x1, y);
    snprintf(t, sizeof t, "%d°", (int)v);
    texteDroite(x0 - 6, y + aL / 2, t);
  }
  canvas.fillRect(x0, y1, x1 - x0 + 1, 2, NOIR);
  // Heures en bas : une etiquette toutes les k heures, minuit ("0h") compris, pour un pas constant ;
  // a minuit, un pointille vertical marque le changement de jour ; au-dela de 24 h (36 ou 48 h),
  // le nom du jour est ecrit en petit en haut, pour savoir de quel minuit il s'agit
  int h0 = g["h0"] | 0;
  const int pas[] = {1, 2, 3, 4, 6, 12};
  int k = 12;
  for (int i = 0; i < 6; i++) if (dx * pas[i] >= largeurTexte("88h") + 14) { k = pas[i]; break; }
  int jour = 0;
  Boite occ[8]; int nOcc = 0;       // places deja prises par du texte (noms des jours, etiquettes)
  for (int i = 0; i < n; i++) {
    int h = (h0 + i) % 24;
    int x = X(i);
    if (h == 0 && i > 0) {
      ligneVPointillee(x, y0, y1);
      if (n - 1 > 24) {
        const char* nom = J[jour++] | "";
        int lt = largeurTexte(nom), xn = min(x + 4, b.x + b.w - lt);
        texte(xn, y0 - 6, nom);
        if (nOcc < 8) occ[nOcc++] = { xn, y0 - 6 - aL, lt, aL + 2 };
      }
    }
    if (h % k) continue;
    snprintf(t, sizeof t, "%dh", h);
    int lt = largeurTexte(t);
    canvas.drawFastVLine(x, y1, 5, NOIR);
    texte(max(b.x + lg - lt / 2, min(x - lt / 2, b.x + b.w - lt)), y1 + 8 + aL, t);
  }
  // Courbe epaisse
  float e = max(3.0f, b.h / 70.0f);
  for (int i = 0; i < n - 1; i++) trait(X(i), Y(T[i].as<int>() / 10.0f), X(i + 1), Y(T[i + 1].as<int>() / 10.0f), e);
  // Minimum, maximum et legende : chaque etiquette va a la premiere place libre
  // (au-dessus ou en dessous du point, puis a droite, puis a gauche)
  auto chevauche = [&](Boite r) {
    for (int q = 0; q < nOcc; q++)
      if (r.x < occ[q].x + occ[q].w + 4 && occ[q].x < r.x + r.w + 4 && r.y < occ[q].y + occ[q].h + 2 && occ[q].y < r.y + r.h + 2) return true;
    return false;
  };
  auto dedans = [&](Boite r) { return r.x >= b.x && r.x + r.w <= b.x + b.w && r.y >= b.y && r.y + r.h <= y1 - 2; };
  policeT(17, true);
  int aV = asc();
  int idx[2] = {iMax, iMin};
  for (int k2 = 0; k2 < 2; k2++) {
    int i = idx[k2];
    float v = T[i].as<int>() / 10.0f;
    int x = X(i), y = Y(v);
    canvas.fillCircle(x, y, e * 1.4f, NOIR);
    canvas.fillCircle(x, y, e * 0.6f, BLANC);
    snprintf(t, sizeof t, "%d°", (int)lroundf(v));
    int lt = largeurTexte(t), r = e * 1.4f + 6;
    int xc = max(x0 + 2, min(x - lt / 2, x1 - lt));
    Boite essais[4] = {
      { xc, k2 == 0 ? y - r - aV : y + r, lt, aV },            // au-dessus (max) / en dessous (min)
      { xc, k2 == 0 ? y + r : y - r - aV, lt, aV },            // de l'autre cote
      { x + r, y - aV / 2, lt, aV },                           // a droite
      { x - r - lt, y - aV / 2, lt, aV },                      // a gauche
    };
    for (int q = 0; q < 4; q++) {
      if (!dedans(essais[q]) || chevauche(essais[q])) continue;
      Boite z = essais[q];
      canvas.fillRect(z.x - 3, z.y - 2, z.w + 6, z.h + 5, BLANC);     // fond blanc sous le chiffre
      texte(z.x, z.y + aV, t);
      if (nOcc < 8) occ[nOcc++] = z;
      break;
    }
  }
  // Legende de la pluie : en haut a droite, sinon en haut a gauche, sinon rien
  if (pluie) {
    policeT(14, false);
    int lt = largeurTexte("pluie"), lw = lt + 26;
    Boite essais[2] = { { b.x + b.w - lw, b.y + 2, lw, aL }, { x0 + 4, b.y + 2, lw, aL } };
    for (int q = 0; q < 2; q++) {
      if (chevauche(essais[q])) continue;
      Boite z = essais[q];
      trame(z.x, z.y, 16, aL, 3);
      canvas.drawRect(z.x, z.y, 16, aL, NOIR);
      texte(z.x + 26, z.y + aL, "pluie");
      break;
    }
  }
}

// Trace d'un circuit (points 0..999, dans le sens de la course) dans le rectangle donne
void dessinerCircuit(JsonVariant tr, int x, int y, int w, int h) {
  JsonArray p = tr["p"];
  int n = p.size() / 2;
  if (n < 3) return;
  float l = tr["l"] | 999, ht = tr["h"] | 999;
  float e = max(4.0f, min(w, h) / 40.0f);
  float k = min((w - 3 * e) / l, (h - 3 * e) / ht);
  float ox = x + (w - l * k) / 2, oy = y + (h - ht * k) / 2;
  auto PX = [&](int i) { return ox + p[2 * (i % n)].as<int>() * k; };
  auto PY = [&](int i) { return oy + p[2 * (i % n) + 1].as<int>() * k; };
  for (int i = 0; i < n; i++) trait(PX(i), PY(i), PX(i + 1), PY(i + 1), e);
  // Ligne de depart : barre en travers de la piste, et fleche du sens de course
  float dx = PX(1) - PX(0), dy = PY(1) - PY(0), d = sqrtf(dx * dx + dy * dy);
  if (d < 1) return;
  dx /= d; dy /= d;
  float sx = PX(0), sy = PY(0);
  trait(sx - dy * e * 2.2f, sy + dx * e * 2.2f, sx + dy * e * 2.2f, sy - dx * e * 2.2f, e * 0.9f);
  float ax = sx + dx * e * 4 - dy * e * 3.2f, ay = sy + dy * e * 4 + dx * e * 3.2f;     // a cote de la piste
  float s = e * 1.6f;
  canvas.fillTriangle(ax + dx * s, ay + dy * s, ax - dx * s * 0.6f - dy * s * 0.8f, ay - dy * s * 0.6f + dx * s * 0.8f,
                      ax - dx * s * 0.6f + dy * s * 0.8f, ay - dy * s * 0.6f - dx * s * 0.8f, NOIR);
}

// Prochain Grand Prix de F1 : trace du circuit, compte a rebours, horaires des seances
void widgetF1(JsonVariant f, Boite b) {
  if (f.isNull()) return;
  policeT(20, false);
  if (f["erreur"].is<const char*>()) { texteTronque(b.x, b.y + asc() + 6, f["erreur"].as<const char*>(), b.w); return; }
  JsonArray S = f["sessions"];
  int ns = S.size();
  // Hauteur des textes
  policeT(14, false); int aP = asc();
  policeT(17, false); int aS = asc();
  int ligneS = aS + max(8, aS / 2);
  // Disposition : trace a gauche si le bloc est large, sinon au-dessus
  bool cote = b.w >= b.h * 1.35f;
  Boite txt = b, tr = b;
  if (cote) { tr.w = min(b.h, b.w * 45 / 100); txt.x = b.x + tr.w + 16; txt.w = b.w - tr.w - 16; }
  else {
    int hTexte = aP * 3 + 40 + ns * ligneS;            // titre, circuit, compte a rebours, seances
    tr.h = max(b.h * 35 / 100, b.h - hTexte);
    txt.y = b.y + tr.h + 12; txt.h = b.h - tr.h - 12;
  }
  if (!f["trace"].isNull() && tr.h >= 40 && tr.w >= 40) dessinerCircuit(f["trace"], tr.x, tr.y, tr.w, tr.h);
  else if (cote) { txt = b; }                       // pas de trace : tout le bloc pour le texte
  if (cote) {                                       // texte centre en hauteur a cote du trace
    const char* g0 = f["gp"] | "";
    const int tl[] = {30, 25, 20, 17, 14};
    for (int i = 0; i < 5; i++) { policeT(tl[i], true); if (largeurTexte(g0) <= txt.w) break; }
    int aT = asc();
    policeT(20, true); int aQ = asc();
    int hTexte = aT + aP + 10 + aQ + 20 + ns * ligneS;
    if (hTexte < txt.h) { int dec = (txt.h - hTexte) / 2; txt.y += dec; txt.h -= dec; }
  }
  // Titre : le plus grand qui tient
  const char* gp = f["gp"] | "";
  const int tailles[] = {30, 25, 20, 17, 14};
  for (int i = 0; i < 5; i++) { policeT(tailles[i], true); if (largeurTexte(gp) <= txt.w) break; }
  int y = txt.y + asc();
  texteTronque(txt.x, y, gp, txt.w);
  char t[96];
  policeT(14, false);
  int m = f["manche"] | 0;
  if (m) snprintf(t, sizeof t, "Manche %d - %s", m, (const char*)(f["circuit"] | ""));
  else snprintf(t, sizeof t, "%s", (const char*)(f["circuit"] | ""));
  y += aP + 10;
  if (y <= txt.y + txt.h) texteTronque(txt.x, y, t, txt.w);
  policeT(20, true);
  y += asc() + 12;
  if (y <= txt.y + txt.h) texte(txt.x, y, f["quand"] | "");
  y += 8;
  // Seances : on garde les prochaines si la place manque
  int place = (txt.y + txt.h - y) / ligneS;
  int premier = 0;
  if (place < ns) { premier = ns - max(0, place); for (int i = 0; i < ns && premier > 0; i++) if (!(S[i]["f"] | 0)) { premier = min(premier, i); break; } }
  policeT(17, true);  int lJ = largeurTexte("Mer 88") + 12;
  policeT(17, false); int lH = largeurTexte("88h88") + 14;
  for (int i = premier; i < ns && i - premier < place; i++) {
    JsonObject o = S[i];
    y += ligneS;
    bool fini = (o["f"] | 0) == 1, course = !strcmp(o["n"] | "", "Course");
    policeT(17, course);
    texte(txt.x, y, o["j"] | "");
    texte(txt.x + lJ, y, o["h"] | "");
    texteTronque(txt.x + lJ + lH, y, o["n"] | "", txt.w - lJ - lH);
    if (fini) canvas.fillRect(txt.x, y - aS / 2 - 1, min(txt.w, lJ + lH + (int)largeurTexte(o["n"] | "")), 2, NOIR);   // barre
  }
}

void dessinerTableau(JsonVariant e, float vBat) {
  canvas.fillScreen(BLANC);
  JsonArray dispo = e["disposition"];
  JsonDocument parDefaut;
  if (dispo.isNull()) {          // serveur ancien : disposition par defaut
    const char* ids[] = {"date", "meteo", "heures", "jours", "agenda"};
    const int G[5][4] = {{0, 0, 12, 1}, {0, 1, 12, 2}, {0, 3, 12, 2}, {0, 5, 5, 3}, {5, 5, 7, 3}};
    const float cl = (LARGEUR - 48 + 16) / 12.0f, ch = (HAUTEUR - 48 + 16) / 8.0f;
    dispo = parDefaut.to<JsonArray>();
    for (int i = 0; i < 5; i++) {
      JsonObject o = dispo.add<JsonObject>();
      o["id"] = ids[i];
      o["x"] = (int)lroundf(24 + G[i][0] * cl);  o["y"] = (int)lroundf(24 + G[i][1] * ch);
      o["w"] = (int)lroundf(G[i][2] * cl - 16);  o["h"] = (int)lroundf(G[i][3] * ch - 16);
    }
  }
  int g = e["gouttiere"] | 16;
  bool traits = (e["traits"] | 1) == 1;
  JsonVariant m = e["meteo"];
  bool meteoKO = m.isNull() || m["erreur"].is<const char*>();

  for (JsonObject d : dispo) {
    Boite b = { d["x"] | 0, d["y"] | 0, d["w"] | 0, d["h"] | 0 };
    const char* id = d["id"] | "";
    st.e = d["e"] | 1.0f;            // taille du texte choisie pour ce bloc
    st.f = d["f"] | 0;               // famille de police choisie pour ce bloc
    if (traits) {
      if (b.y > g + 30) canvas.fillRect(b.x, b.y - g / 2 - 1, b.w, 2, NOIR);
      if (b.x > g + 30) canvas.fillRect(b.x - g / 2 - 1, b.y, 2, b.h, NOIR);
    }
    if (!strcmp(id, "date")) widgetDate(e, b, vBat);
    else if (!strcmp(id, "meteo")) widgetMeteo(m, b);
    else if (!strcmp(id, "heures") || !strcmp(id, "jours")) {
      if (meteoKO) { policeT(20, false); texteTronque(b.x, b.y + asc() + 6, "Météo indisponible", b.w); }
      else widgetColonnes(m[id].as<JsonArray>(), b, id[0] == 'j');
    }
    else if (!strcmp(id, "agenda")) widgetAgenda(e["agenda"], b);
    else if (!strcmp(id, "bus")) widgetBus(e["bus"], b);
    else if (!strcmp(id, "f1")) widgetF1(e["f1"], b);
    else if (!strcmp(id, "courbe")) {
      if (meteoKO || m["courbe"].isNull()) { policeT(20, false); texteTronque(b.x, b.y + asc() + 6, "Météo indisponible", b.w); }
      else widgetCourbe(m["courbe"], b);
    }
  }
  st.e = 1.0f; st.f = 0;
}

// =====================================================================
//  ECRAN 2 : POCHETTE D'ALBUM (JPEG decode puis trame)
// =====================================================================
#ifdef HOTE
#define ps_malloc malloc
#endif
static uint8_t* gris = nullptr;     // image decodee en niveaux de gris
static int grisL = 0, grisH = 0;

int rappelJPEG(JPEGDRAW* d) {
  uint8_t* src = (uint8_t*)d->pPixels;
  for (int yy = 0; yy < d->iHeight; yy++) {
    int ty = d->y + yy;
    if (ty >= grisH) break;
    int w = min(d->iWidthUsed, grisL - d->x);
    if (w > 0) memcpy(gris + ty * grisL + d->x, src + yy * d->iWidth, w);
  }
  return 1;
}

// Tramage Floyd-Steinberg d'une image en niveaux de gris vers le canvas
void tramer(const uint8_t* g, int gl, int gh, int x0, int y0, int w, int h, float contraste) {
  float* err = (float*)ps_malloc(sizeof(float) * w * h);
  if (!err) return;
  for (int y = 0; y < h; y++) {
    float sy = (y + 0.5f) * gh / h - 0.5f;
    int ya = max(0, (int)floorf(sy)), yb = min(gh - 1, ya + 1);
    float fy = sy - floorf(sy);
    for (int x = 0; x < w; x++) {        // redimensionnement bilineaire
      float sx = (x + 0.5f) * gl / w - 0.5f;
      int xa = max(0, (int)floorf(sx)), xb = min(gl - 1, xa + 1);
      float fx = sx - floorf(sx);
      float v = (g[ya * gl + xa] * (1 - fx) + g[ya * gl + xb] * fx) * (1 - fy) +
                (g[yb * gl + xa] * (1 - fx) + g[yb * gl + xb] * fx) * fy;
      err[y * w + x] = (v - 128) * contraste + 128;
    }
  }
  for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
      float ancien = err[y * w + x];
      float nouveau = ancien < 128 ? 0 : 255;
      float q = ancien - nouveau;
      canvas.drawPixel(x0 + x, y0 + y, nouveau == 0 ? NOIR : BLANC);
      if (x + 1 < w) err[y * w + x + 1] += q * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) err[(y + 1) * w + x - 1] += q * 3 / 16;
        err[(y + 1) * w + x] += q * 5 / 16;
        if (x + 1 < w) err[(y + 1) * w + x + 1] += q / 16;
      }
    }
  }
  free(err);
}

bool dessinerPochette(uint8_t* jpg, int taille, const char* titre, const char* artiste, const char* album) {
  canvas.fillScreen(BLANC);
  static JPEGDEC jpeg;
  if (!jpeg.openRAM(jpg, taille, rappelJPEG)) return false;
  int W = jpeg.getWidth(), H = jpeg.getHeight();
  int echelle = 0, div = 1;               // le decodeur sait diviser par 2, 4 ou 8
  while (div < 8 && (W / div > 1280 || H / div > 1280)) div *= 2;
  if (div == 2) echelle = JPEG_SCALE_HALF;
  if (div == 4) echelle = JPEG_SCALE_QUARTER;
  if (div == 8) echelle = JPEG_SCALE_EIGHTH;
  grisL = W / div; grisH = H / div;
  gris = (uint8_t*)ps_malloc(grisL * grisH);
  if (!gris) { jpeg.close(); return false; }
  memset(gris, 255, grisL * grisH);
  jpeg.setPixelType(EIGHT_BIT_GRAYSCALE);
  bool ok = jpeg.decode(0, 0, echelle);
  jpeg.close();
  bool portrait = canvas.height() > canvas.width();
  if (ok) {
    // Pochette carree de 640 px : a gauche en paysage, en haut en portrait
    const int C = 640;
    float e = min((float)C / grisL, (float)C / grisH);
    int w = grisL * e, h = grisH * e;
    if (portrait) tramer(gris, grisL, grisH, 20 + (C - w) / 2, 20 + (C - h) / 2, w, h, 1.1f);
    else          tramer(gris, grisL, grisH, 20 + (C - w) / 2, (canvas.height() - h) / 2, w, h, 1.1f);
  }
  free(gris); gris = nullptr;
  if (!ok) return false;

  // Textes a droite de la pochette (paysage) ou dessous (portrait)
  int x = portrait ? 20 : 690, largeur = portrait ? 640 : 940 - x, y = portrait ? 712 : 90;
  police(u8g2_font_fur17_tf);
  texte(x, y, "En écoute");
  canvas.fillRect(x, y + 14, 60, 3, NOIR);
  y += portrait ? 56 : 70;
  police(u8g2_font_fub25_tf);
  y = texteMultiligne(x, y, titre, largeur, 36, portrait ? 2 : 4);
  y += portrait ? 8 : 16;
  police(u8g2_font_fur20_tf);
  y = texteMultiligne(x, y, artiste, largeur, 30, portrait ? 1 : 3);
  if (album && album[0]) {
    y += 22;
    police(u8g2_font_fur17_tf);
    texteMultiligne(x, y, album, largeur, 26, portrait ? 1 : 3);
  }
  return true;
}

// Ecran de message simple (erreurs, batterie faible)
void dessinerMessage(const char* titre, const char* detail) {
  canvas.fillScreen(BLANC);
  police(u8g2_font_fub30_tf);
  texteCentre(canvas.width() / 2, canvas.height() / 2 - 10, titre);
  police(u8g2_font_fur20_tf);
  texteCentre(canvas.width() / 2, canvas.height() / 2 + 40, detail);
}

void preparerDessin() {
  u8g2.begin(canvas);
  u8g2.setFontMode(1);
  u8g2.setFontDirection(0);
  u8g2.setForegroundColor(NOIR);
  u8g2.setBackgroundColor(BLANC);
}

// =====================================================================
//  PARTIE CARTE ESP32 (reseau, ecran, veille)
// =====================================================================
#ifndef HOTE

GxEPD2_BW<GxEPD2_1330_GDEM133T91, GxEPD2_1330_GDEM133T91::HEIGHT> display(
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
RTC_DATA_ATTR uint32_t secondesDepuisAffichage = 0;
RTC_DATA_ATTR uint32_t reveilSecondes = 600;
RTC_DATA_ATTR bool     alerteBatterieAffichee = false;

float lireBatterie() {
  pinMode(PIN_BATTERIE, INPUT);
  uint32_t somme = 0;
  for (int i = 0; i < 16; i++) { somme += analogReadMilliVolts(PIN_BATTERIE); delay(2); }
  return (somme / 16.0f) * 2.0f / 1000.0f;   // x2 : pont diviseur
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
  httpUpdate.setLedPin(LED_BUILTIN, LOW);   // la petite LED s'allume pendant l'ecriture
  t_httpUpdate_return r = httpUpdate.update(client, String(SERVEUR) + "/api/firmware.bin?cle=" + encoderURL(CLE));
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
int telecharger(const String& chemin, uint8_t** dest, int max) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(SERVEUR) + chemin)) return 0;
  http.addHeader("X-Cle", CLE);
  http.setTimeout(20000);
  int code = http.GET();
  if (code != 200) { Serial.printf("GET %s : HTTP %d\n", chemin.c_str(), code); http.end(); return 0; }
  int taille = http.getSize();
  if (taille <= 0 || taille > max) { Serial.println("Taille inattendue"); http.end(); return 0; }
  if (!*dest) *dest = (uint8_t*)ps_malloc(taille);
  if (!*dest) { Serial.println("Pas assez de memoire (PSRAM activee ?)"); http.end(); return 0; }
  WiFiClient* flux = http.getStreamPtr();
  int lu = 0;
  unsigned long debut = millis();
  while (lu < taille && millis() - debut < 20000) {
    int dispo = flux->available();
    if (dispo > 0) lu += flux->readBytes(*dest + lu, min(dispo, taille - lu));
    else delay(5);
  }
  http.end();
  return lu == taille ? taille : 0;
}

void envoyerApercu(int rotation) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, String(SERVEUR) + "/api/apercu?r=" + String(rotation))) return;
  http.addHeader("X-Cle", CLE);
  http.addHeader("Content-Type", "application/octet-stream");
  int code = http.POST(canvas.getBuffer(), OCTETS);
  Serial.printf("Apercu envoye : HTTP %d\n", code);
  http.end();
}

void afficherSurEcran() {
#if ECRAN_PRESENT
  gpio_hold_dis((gpio_num_t)EPD_PWR);
  pinMode(EPD_PWR, OUTPUT);
  digitalWrite(EPD_PWR, HIGH);
  delay(100);
  display.init(115200, true, 2, false);
  display.setRotation(0);
  display.setFullWindow();
  display.fillScreen(GxEPD_WHITE);
  display.drawBitmap(0, 0, canvas.getBuffer(), LARGEUR, HAUTEUR, GxEPD_BLACK);
  display.display(false);       // rafraichissement complet
  display.hibernate();
  digitalWrite(EPD_PWR, LOW);
  gpio_hold_en((gpio_num_t)EPD_PWR);
  gpio_deep_sleep_hold_en();
#endif
}

bool modeDev = false;                 // envoye par le serveur (menu Reveil de la page web)
unsigned long dernierAffichageMs = 0;  // pour respecter 3 min entre deux rafraichissements
bool ecranEnAttente = false;

void dormir(uint32_t secondes) {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  Serial.printf("Veille profonde pendant %u s\n", secondes);
  Serial.flush();
  memoWifi.age += secondes;
  esp_sleep_enable_timer_wakeup((uint64_t)secondes * 1000000ULL);
  esp_deep_sleep_start();
}

// L'ecran demande au moins 3 minutes entre deux rafraichissements :
// en mode developpement, l'apercu web est mis a jour tout de suite,
// mais l'ecran attend si besoin le cycle suivant.
void mettreEcranAJour() {
  if (dernierAffichageMs && millis() - dernierAffichageMs < 180000UL) {
    Serial.println("Ecran : rafraichissement reporte (3 min minimum entre deux)");
    return;
  }
  afficherSurEcran();
  dernierAffichageMs = millis();
  ecranEnAttente = false;
}

// Un cycle complet. Renvoie le nombre de secondes avant le suivant.
uint32_t cycle() {
  float vBat = lireBatterie();
  Serial.printf("Batterie : %.2f V\n", vBat);

  // Batterie presque vide : on le signale une fois, puis on dort longtemps
  if (vBat > 2.5 && vBat < 3.4) {
    if (!alerteBatterieAffichee) {
      dessinerMessage("Batterie vide", "Rechargez le cadre");
      afficherSurEcran();
      alerteBatterieAffichee = true;
      derniereSig[0] = 0;
    }
    return 6 * 3600;
  }
  alerteBatterieAffichee = false;

  if (!connecterWifi()) return reveilSecondes;

  // 1. Que faut-il afficher ?
  uint8_t* brut = nullptr;
  char chemin[80];
  snprintf(chemin, sizeof chemin, "/api/etat?bat=%.2f&fw=%s", vBat, versionCarte);
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

  // 2. Rien de nouveau ? (on rafraichit quand meme au moins 1 fois par jour)
  bool nouveau = strcmp(sig, derniereSig) != 0;
  bool rafraichirQuandMeme = secondesDepuisAffichage + reveilSecondes > 24 * 3600 && strcmp(mode, "blanc") != 0;
  if (!nouveau && !rafraichirQuandMeme) {
    secondesDepuisAffichage += reveilSecondes;
    if (ecranEnAttente) mettreEcranAJour();
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

  // 4. Apercu web puis ecran
  envoyerApercu(rotation);
  strncpy(derniereSig, sig, sizeof derniereSig - 1);
  secondesDepuisAffichage = 0;
  ecranEnAttente = true;
  mettreEcranAJour();
  return reveilSecondes;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  calculerVersion();
  Serial.printf("Cadre e-ink, programme du %s\n", versionCarte);
  preparerDessin();
  while (true) {
    uint32_t s = cycle();
    if (!modeDev) dormir(s);   // fonctionnement normal : veille profonde
    // Mode developpement : la carte reste allumee (le televersement marche sans le bouton BOOT)
    Serial.printf("Mode developpement : prochain cycle dans %u s\n", s);
    delay(s * 1000UL);
  }
}

void loop() {}

#endif
