// =====================================================================
//  Cadre e-ink - dessin de l'image (inclus par cadre_eink.ino)
//
//  Tout ce qui fabrique l'image 960 x 680, sans rien de propre a la carte (ni Wi-Fi,
//  ni ecran, ni veille) : le meme fichier est compile
//   - pour la carte, par l'IDE Arduino (cadre_eink.ino fait #include "dessin.h")
//   - pour l'apercu de la page web, en WebAssembly (outils/apercu/construire.sh)
//   - pour les tests sur ordinateur (tests/rendu/lancer.sh)
//
//  Apres une modification : relancer outils/apercu/construire.sh (les tests du serveur
//  verifient que l'apercu web correspond a ce fichier).
// =====================================================================
#pragma once

#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <ArduinoJson.h>
#include <JPEGDEC.h>
#include <math.h>
#include <string.h>

#define LARGEUR 960
#define HAUTEUR 680
#define OCTETS  ((LARGEUR / 8) * HAUTEUR)   // 81 600
#define NOIR  1
#define BLANC 0

// Types communs (definis tout en haut : cadre_eink.ino s'en sert aussi, dans ses declarations
// automatiques ecrites par l'IDE Arduino juste apres #include "dessin.h")
// Rectangle dans lequel un widget se dessine
struct Boite { int x, y, w, h; };
// Style du texte du bloc en cours de dessin : e = echelle (0,8 a 1,5), f = famille de police
struct Style { float e; int f; };
// Place prise par le texte du bloc F1
struct MesureF1 { int aT, aP, aQ, ligneS, lJ, lH, h; bool tient; };
// Zone d'une mise a jour partielle envoyee par le serveur : rectangle et ancien contenu
struct ZonePlan { int x, y, w, h; const uint8_t* ancien; };

GFXcanvas1 canvas(LARGEUR, HAUTEUR);      // l'image est d'abord dessinee ici
U8G2_FOR_ADAFRUIT_GFX u8g2;

// Declarations des fonctions de ce fichier : l'IDE Arduino ne les ecrit pas lui-meme pour un .h.
// Une fonction appelee plus haut que l'endroit ou elle est ecrite doit figurer ici
// (sinon la compilation s'arrete sur "was not declared in this scope").
void police(const uint8_t* f);
int largeurTexte(const char* s);
void texte(int x, int y, const char* s);
void texteDroite(int xDroite, int y, const char* s);
void texteCentre(int xCentre, int y, const char* s);
void texteTronque(int x, int y, const char* s, int largeurMax);
int texteMultiligne(int x, int y, const char* s, int largeurMax, int interligne, int lignesMax);
void trait(float x0, float y0, float x1, float y1, float e);
void formeNuage(float cx, float cy, float s, uint16_t c);
void nuage(float cx, float cy, float s);
void soleil(float cx, float cy, float r);
void lune(float cx, float cy, float r);
void icone(int x, int y, int s, int code, bool nuit);
int asc();
void choisirDans(const uint8_t* const* liste, float cible);
int cranTaille();
void policeT(int taille, bool gras);
void policeAjustee(int taille, bool gras, const char* texte, int lMax);
void policeQuiTient(bool gras, float hMax, const char* texte, int lMax);
void policeChiffres(float taille);
int pourcentBatterie(float v);
void dessinerBatterie(float v, int xDroite, int yCentre);
void degre(int x, int y, int r, int e);
int centrerV(Boite b, int haut);
void widgetDate(JsonVariant e, Boite b, float vBat);
void widgetMeteo(JsonVariant m, Boite b);
void widgetColonnes(JsonArray liste, Boite b, bool jours);
void widgetAgenda(JsonVariant ag, Boite b);
void widgetRebours(JsonVariant r, Boite b);
void widgetBus(JsonVariant bus, Boite b);
void trame(int x0, int y0, int w, int h, int pas);
void ligneHPointillee(int x0, int x1, int y);
void ligneVPointillee(int x, int y0, int y1);
void widgetCourbe(JsonVariant g, Boite b);
void dessinerCircuit(JsonVariant tr, int x, int y, int w, int h);
MesureF1 mesurerF1(JsonArray S, const char* gp, int largeur, int decalage);
void widgetF1(JsonVariant f, Boite b);
void dessinerTableau(JsonVariant e, float vBat);
int rappelJPEG(JPEGDRAW* d);
bool tramer(const uint8_t* g, int gl, int gh, int x0, int y0, int w, int h, float contraste);
bool dessinerPochette(uint8_t* jpg, int taille, const char* titre, const char* artiste, const char* album);
void dessinerMessage(const char* titre, const char* detail);
void dessinerHorsLigne(const char* raison, const char* dernieres);
void preparerDessin();
uint32_t empreinteImage(const uint8_t* p, size_t n);
int zonesDuPlan(const uint8_t* plan, int taille, ZonePlan* zones, int max);

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

// Familles : 0 Moderne, 1 Helvetica, 2 Classique (a empattements), 3 Machine a ecrire.
// Chaque liste monte par paliers reguliers (environ x 1,25), sans deux polices de meme hauteur :
// un cran de taille (Petite / Grande / Tres grande) change donc toujours de police.
// Helvetica et Classique n'existent pas au-dela de 25 px : on continue avec Moderne (42 px au plus).
// Machine a ecrire : Courier pour les petites tailles, puis Inconsolata (autre police a chasse fixe).
const uint8_t* const POLICES_R[4][12] = {
  {u8g2_font_fur11_tf, u8g2_font_fur14_tf, u8g2_font_fur17_tf, u8g2_font_fur20_tf, u8g2_font_fur25_tf, u8g2_font_fur30_tf, u8g2_font_fur35_tf, u8g2_font_fur42_tf, nullptr},
  {u8g2_font_helvR08_tf, u8g2_font_helvR10_tf, u8g2_font_helvR14_tf, u8g2_font_helvR18_tf, u8g2_font_helvR24_tf, u8g2_font_fur30_tf, u8g2_font_fur35_tf, u8g2_font_fur42_tf, nullptr},
  {u8g2_font_ncenR08_tf, u8g2_font_ncenR10_tf, u8g2_font_ncenR14_tf, u8g2_font_ncenR18_tf, u8g2_font_ncenR24_tf, u8g2_font_fur30_tf, u8g2_font_fur35_tf, u8g2_font_fur42_tf, nullptr},
  {u8g2_font_courR10_tf, u8g2_font_courR14_tf, u8g2_font_courR18_tf, u8g2_font_inr16_mf, u8g2_font_inr19_mf, u8g2_font_inr24_mf, u8g2_font_inr30_mf, u8g2_font_inr38_mf, u8g2_font_inr42_mf, u8g2_font_inr46_mf, u8g2_font_inr53_mf, nullptr},
};
const uint8_t* const POLICES_B[4][12] = {
  {u8g2_font_fub11_tf, u8g2_font_fub14_tf, u8g2_font_fub17_tf, u8g2_font_fub20_tf, u8g2_font_fub25_tf, u8g2_font_fub30_tf, u8g2_font_fub35_tf, u8g2_font_fub42_tf, nullptr},
  {u8g2_font_helvB08_tf, u8g2_font_helvB10_tf, u8g2_font_helvB14_tf, u8g2_font_helvB18_tf, u8g2_font_helvB24_tf, u8g2_font_fub30_tf, u8g2_font_fub35_tf, u8g2_font_fub42_tf, nullptr},
  {u8g2_font_ncenB08_tf, u8g2_font_ncenB10_tf, u8g2_font_ncenB14_tf, u8g2_font_ncenB18_tf, u8g2_font_ncenB24_tf, u8g2_font_fub30_tf, u8g2_font_fub35_tf, u8g2_font_fub42_tf, nullptr},
  {u8g2_font_courB10_tf, u8g2_font_courB14_tf, u8g2_font_courB18_tf, u8g2_font_inb16_mf, u8g2_font_inb19_mf, u8g2_font_inb24_mf, u8g2_font_inb30_mf, u8g2_font_inb38_mf, u8g2_font_inb42_mf, u8g2_font_inb46_mf, u8g2_font_inb53_mf, nullptr},
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
// Taille choisie sur la page web, en crans : Petite -1, Normale 0, Grande +1, Tres grande +2
int cranTaille() { return st.e < 0.9f ? -1 : st.e < 1.1f ? 0 : st.e < 1.4f ? 1 : 2; }
// Nombre de polices "de la famille" au debut de chaque liste (les suivantes sont celles de Moderne,
// utilisees seulement quand on demande Grande ou Tres grande)
const int NATIVES[4] = {8, 5, 5, 11};
int decalageCran = 0;      // reduction temporaire, quand un texte ne tient pas (bloc F1)
// Police de texte d'une taille "nominale" (hauteur des majuscules en pixels) : la police "Normale"
// est la plus grande qui ne depasse pas cette taille, puis on monte ou descend d'autant de paliers
// que la taille choisie pour le bloc.
void policeT(int taille, bool gras) {
  int f = (st.f >= 0 && st.f < 4) ? st.f : 0;
  const uint8_t* const* liste = gras ? POLICES_B[f] : POLICES_R[f];
  int n = 0, i0 = 0;
  while (liste[n]) n++;
  int nat = min(n, NATIVES[f]);
  for (int i = 0; i < nat; i++) { police(liste[i]); if (asc() <= taille * 1.08f) i0 = i; }
  int cran = cranTaille() + decalageCran;
  int i = max(0, min(cran > 0 ? n - 1 : nat - 1, i0 + cran));
  police(liste[i]);
}
// Comme policeT, mais descend d'un ou plusieurs paliers (3 au plus) si le texte ne tient pas en largeur :
// un texte un peu plus petit plutot que coupe par "..."
void policeAjustee(int taille, bool gras, const char* texte, int lMax) {
  for (decalageCran = 0; decalageCran > -3; decalageCran--) {
    policeT(taille, gras);
    if (largeurTexte(texte) <= lMax) break;
  }
  if (largeurTexte(texte) > lMax) policeT(taille, gras);   // decalageCran vaut -3 ici
  decalageCran = 0;
}
// La plus grande police de la famille du bloc qui tient en hauteur (hMax) et en largeur (texte dans lMax)
void policeQuiTient(bool gras, float hMax, const char* texte, int lMax) {
  int f = (st.f >= 0 && st.f < 4) ? st.f : 0;
  const uint8_t* const* liste = gras ? POLICES_B[f] : POLICES_R[f];
  const uint8_t* choix = liste[0];
  int nat = cranTaille() > 0 ? 99 : NATIVES[f];
  for (int i = 0; liste[i] && i < nat; i++) {
    police(liste[i]);
    if (asc() <= hMax && largeurTexte(texte) <= lMax) choix = liste[i];
  }
  police(choix);
}
void policeChiffres(float taille) { choisirDans(CHIFFRES, taille); }

// Pourcentage donne par la jauge MAX17048 de la carte (-1 = inconnu : on l'estime alors
// d'apres la tension, comme dans l'apercu web qui ne recoit que la tension)
int pctMesure = -1;
int pourcentBatterie(float v) {
  if (pctMesure >= 0) return pctMesure;
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
  // La plus grande taille qui tient en largeur et dans une part de la hauteur qui depend
  // de la taille choisie (Normale : 62 % de la hauteur du bloc, comme avant)
  const float part[] = {0.45f, 0.62f, 0.78f, 0.95f};
  policeQuiTient(true, b.h * part[cranTaille() + 1], date, dispo);
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
    policeAjustee(largTexte >= 330 * st.e ? 25 : 20, true, m["desc"] | "", largTexte);
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
    policeAjustee(20, false, t, largTexte);
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
    for (int i = 0; i < n; i++) {
      yd += pas;
      policeAjustee(20, false, l[i], largDetails);
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

// Agenda : les evenements sont regroupes par jour (le jour n'est ecrit qu'une fois, avec un peu d'espace
// avant le jour suivant), et le lieu suit le titre quand il y a la place ("Colle de maths · B12").
void widgetAgenda(JsonVariant ag, Boite b) {
  if (ag.isNull()) return;
  policeT(20, false);
  if (ag["erreur"].is<const char*>()) { texteTronque(b.x, b.y + asc() + 6, ag["erreur"].as<const char*>(), b.w); return; }
  JsonArray evts = ag.as<JsonArray>();
  if (evts.size() == 0) { texte(b.x, b.y + asc() + 6, "Rien de prévu"); return; }
  policeT(17, false);
  int aE = asc();
  int pas = aE * 17 / 10 + 1;
  int ecartJour = pas / 3;                    // espace en plus entre deux jours
  // Nombre de lignes qui tiennent, espaces entre les jours compris
  int lignes = 0;
  {
    int yy = b.y + aE + 4;
    const char* prec = nullptr;
    for (JsonObject e : evts) {
      const char* j = e["j"] | "";
      if (prec && strcmp(j, prec) != 0) yy += ecartJour;
      if (yy > b.y + b.h) break;
      lignes++; yy += pas; prec = j;
    }
  }
  lignes = max(1, lignes);
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
  int i = 0, yy = b.y + aE + 4;
  const char* prec = nullptr;
  char tampon[160], avecLieu[200];
  for (JsonObject e : evts) {
    const char* j = e["j"] | "";
    bool nouveauJour = !prec || strcmp(j, prec) != 0;
    if (prec && nouveauJour) yy += ecartJour;
    if (i >= lignes || yy > b.y + b.h) break;
    if (nouveauJour) { policeT(17, true); texteTronque(b.x, yy, j, colJour - 8); }
    policeT(17, false);
    const char* h = e["h"] | "";
    const char* titre = e["t"] | "";
    const char* lieu = e["l"] | "";
    int x = xHeure;
    if (h[0] && colHeure) { texteTronque(xHeure, yy, h, largHeure - 8); x = xTitre; }
    else if (h[0]) { snprintf(tampon, sizeof tampon, "%s %s", h, titre); titre = tampon; }
    int larg = b.x + b.w - x;
    // Le lieu suit le titre s'il reste au moins la place d'en lire le debut
    if (lieu[0] && largeurTexte(titre) + largeurTexte(" · ") + 48 <= larg) {
      snprintf(avecLieu, sizeof avecLieu, "%s · %s", titre, lieu);
      titre = avecLieu;
    }
    texteTronque(x, yy, titre, larg);
    prec = j; yy += pas; i++;
  }
}

// Compte a rebours : jours restants avant une date (vacances, concours...). La date la plus proche en
// grand ("J-12", puis son titre et sa date) ; les suivantes en liste, a droite si le bloc est large,
// sinon dessous, tant qu'il reste de la place.
void widgetRebours(JsonVariant r, Boite b) {
  JsonArray L = r.as<JsonArray>();
  if (r.isNull() || L.size() == 0) { policeT(20, false); texteTronque(b.x, b.y + asc() + 6, "Aucune date à venir", b.w); return; }
  JsonObject p = L[0];
  int n = p["n"] | 0;
  const char* titre = p["t"] | "";
  const char* date = p["d"] | "";
  char jr[16], t[160];
  if (n == 0) strcpy(jr, "Jour J"); else snprintf(jr, sizeof jr, "%d", n);

  // Bloc d'une seule rangee : tout sur une ligne
  if (b.h < 110) {
    snprintf(t, sizeof t, n == 0 ? "%s" : "J-%s", jr);
    policeQuiTient(true, b.h * 0.62f, t, b.w / 2);
    int base = b.y + (b.h + asc()) / 2;
    texte(b.x, base, t);
    int x = b.x + largeurTexte(t) + 18, larg = b.x + b.w - x;
    policeT(20, false);
    snprintf(t, sizeof t, "%s · %s", titre, date);
    if (largeurTexte(t) > larg) snprintf(t, sizeof t, "%s", titre);
    if (larg >= 60) texteTronque(x, b.y + (b.h + asc()) / 2, t, larg);
    return;
  }

  // Les dates suivantes : colonne de droite (bloc large) ou lignes sous la premiere
  int suivantes = L.size() - 1;
  bool aDroite = suivantes > 0 && b.w >= 620;
  int larg = aDroite ? b.w * 55 / 100 : b.w;
  policeT(17, false); int aS = asc(), ligneS = aS * 17 / 10 + 1;
  policeAjustee(25, true, titre, larg); int aT = asc();
  policeT(17, false); int aD = asc();
  int bas = 14 + aT + 12 + aD;                       // titre et date, sous le chiffre
  const int ecartListe = 30;                         // entre la date et la liste (trait de separation au milieu)
  // Le chiffre : le plus grand qui laisse la place au titre et a la date (et a deux des dates suivantes
  // quand elles vont dessous), et qui tient en largeur avec "J-"
  float cible = min(92.0f, (float)(b.h - bas - 4));
  if (!aDroite && suivantes > 0) cible = min(cible, max(42.0f, (float)(b.h - bas - ecartListe - min(suivantes, 2) * ligneS)));
  cible = max(24.0f, cible);
  int aC = 0, lC = 0, lJ = 0;
  for (;;) {
    if (n == 0) { policeQuiTient(true, cible, jr, larg); aC = asc(); lC = largeurTexte(jr); lJ = 0; break; }
    policeChiffres(cible); aC = asc(); lC = largeurTexte(jr);
    policeT(aC >= 60 ? 30 : aC >= 36 ? 25 : 20, true); lJ = largeurTexte("J-") + max(4, aC / 12);
    if (lJ + lC <= larg || cible <= 24) break;
    cible -= 6;
  }
  int haut = aC + bas;
  // Nombre de dates suivantes affichees, puis le tout est centre en hauteur
  int nb = 0;
  if (aDroite) nb = min(suivantes, max(1, (b.h + ligneS - aS) / ligneS));
  else if (suivantes > 0) nb = max(0, min(suivantes, (b.h - haut - ecartListe + (ligneS - aS)) / ligneS));
  int hautListe = nb > 0 ? nb * ligneS - (ligneS - aS) : 0;
  int y = centrerV(b, aDroite || !nb ? haut : haut + ecartListe + hautListe);
  if (n == 0) { policeQuiTient(true, cible, jr, larg); texte(b.x, y + aC, jr); }
  else {
    policeT(aC >= 60 ? 30 : aC >= 36 ? 25 : 20, true);
    texte(b.x, y + aC, "J-");
    policeChiffres(cible);
    texte(b.x + lJ, y + aC, jr);
  }
  y += aC + 14 + aT;
  policeAjustee(25, true, titre, larg);
  texteTronque(b.x, y, titre, larg);
  y += 12 + aD;
  policeT(17, false);
  texteTronque(b.x, y, date, larg);
  if (nb <= 0) return;

  // Liste des suivantes : "J-40" en gras, puis le titre
  int xl = aDroite ? b.x + larg + 28 : b.x, ll = b.x + b.w - xl;
  int yl = aDroite ? centrerV(b, hautListe) + aS : y + ecartListe + aS;
  if (aDroite) canvas.fillRect(xl - 15, b.y + 6, 2, b.h - 12, NOIR);
  else canvas.fillRect(b.x, y + ecartListe / 2, min(b.w, 120), 2, NOIR);
  policeT(17, true);
  int colJ = 0;
  for (int k = 1; k <= nb; k++) {
    int nk = L[k]["n"] | 0;
    if (nk == 0) strcpy(t, "Jour J"); else snprintf(t, sizeof t, "J-%d", nk);
    colJ = max(colJ, (int)largeurTexte(t));
  }
  colJ += 16;
  for (int k = 1; k <= nb; k++) {
    int nk = L[k]["n"] | 0;
    if (nk == 0) strcpy(t, "Jour J"); else snprintf(t, sizeof t, "J-%d", nk);
    policeT(17, true);
    texte(xl, yl, t);
    policeT(17, false);
    if (ll - colJ >= 40) texteTronque(xl + colJ, yl, L[k]["t"] | "", ll - colJ);
    yl += ligneS;
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
// Mesures du texte du bloc F1 pour une largeur donnee (decalage = paliers de police en moins)
MesureF1 mesurerF1(JsonArray S, const char* gp, int largeur, int decalage) {
  MesureF1 r;
  decalageCran = decalage;
  const int tl[] = {30, 25, 20, 17, 14};
  for (int i = 0; i < 5; i++) { policeT(tl[i], true); if (largeurTexte(gp) <= largeur) break; }
  r.aT = asc();
  policeT(14, false); r.aP = asc();
  policeT(20, true);  r.aQ = asc();
  policeT(17, false); int aS = asc();
  r.ligneS = aS + max(6, aS / 3);
  // Colonnes jour et heure : la plus large etiquette reelle (la course est en gras)
  r.lJ = 0; r.lH = 0;
  for (JsonObject o : S) {
    policeT(17, !strcmp(o["n"] | "", "Course"));
    r.lJ = max(r.lJ, (int)largeurTexte(o["j"] | ""));
    r.lH = max(r.lH, (int)largeurTexte(o["h"] | ""));
  }
  r.lJ += max(8, aS / 2); r.lH += max(10, aS * 2 / 3);
  r.h = r.aT + r.aP + 10 + r.aQ + 12 + 8 + S.size() * r.ligneS;
  r.tient = r.lJ + r.lH + largeurTexte("Qualifications") * 6 / 10 <= largeur;
  decalageCran = 0;
  return r;
}

// Prochain Grand Prix de F1 : trace du circuit, compte a rebours, horaires des seances.
// On mesure d'abord la place que prend tout le texte, et le trace prend le reste ; si le texte ne
// tient pas, la police descend d'un palier (deux au plus), puis les seances terminees sont omises.
void widgetF1(JsonVariant f, Boite b) {
  if (f.isNull()) return;
  policeT(20, false);
  if (f["erreur"].is<const char*>()) { texteTronque(b.x, b.y + asc() + 6, f["erreur"].as<const char*>(), b.w); return; }
  JsonArray S = f["sessions"];
  int ns = S.size();
  const char* gp = f["gp"] | "";
  bool avecTrace = !f["trace"].isNull();
  // Choix de la disposition : trace a gauche ou au-dessus, la plus grande qui laisse tout le texte
  bool cote = false; int dec = 0, taille = -1, dTrace = 0;
  for (int d = 0; d >= -2 && taille < 0; d--) {
    int twC = min(b.h, b.w * 45 / 100);                            // trace a gauche
    MesureF1 mc = mesurerF1(S, gp, b.w - twC - 16, d);
    if (mc.tient && mc.h <= b.h && twC >= 60) { cote = true; dec = d; taille = twC; dTrace = twC; }
    MesureF1 mh = mesurerF1(S, gp, b.w, d);                        // trace au-dessus
    int thH = b.h - mh.h - 12;
    if (mh.tient && thH >= max(60, b.h / 4) && min(b.w, thH) > taille) { cote = false; dec = d; taille = min(b.w, thH); dTrace = thH; }
  }
  if (taille < 0) { cote = false; dec = -2; dTrace = b.h / 4; }      // trop petit : trace reduit, seances omises
  if (!avecTrace) { cote = false; dTrace = 0; }
  MesureF1 m = mesurerF1(S, gp, cote ? b.w - dTrace - 16 : b.w, dec);
  Boite txt = b;
  if (avecTrace && cote) {
    dessinerCircuit(f["trace"], b.x, b.y, dTrace, b.h);
    txt.x = b.x + dTrace + 16; txt.w = b.w - dTrace - 16;
    if (m.h < txt.h) { txt.y += (txt.h - m.h) / 2; txt.h = m.h + 4; }    // texte centre en hauteur
  } else if (avecTrace) {
    dessinerCircuit(f["trace"], b.x, b.y, b.w, dTrace);
    txt.y = b.y + dTrace + 12; txt.h = b.h - dTrace - 12;
  }
  decalageCran = dec;
  // Titre : le plus grand qui tient
  const int tailles[] = {30, 25, 20, 17, 14};
  for (int i = 0; i < 5; i++) { policeT(tailles[i], true); if (largeurTexte(gp) <= txt.w) break; }
  int y = txt.y + asc();
  texteTronque(txt.x, y, gp, txt.w);
  char t[96];
  policeT(14, false);
  int mch = f["manche"] | 0;
  if (mch) snprintf(t, sizeof t, "Manche %d - %s", mch, (const char*)(f["circuit"] | ""));
  else snprintf(t, sizeof t, "%s", (const char*)(f["circuit"] | ""));
  y += m.aP + 10;
  if (y <= txt.y + txt.h) texteTronque(txt.x, y, t, txt.w);
  policeT(20, true);
  y += m.aQ + 12;
  if (y <= txt.y + txt.h) texteTronque(txt.x, y, f["quand"] | "", txt.w);
  y += 8;
  // Seances : si la place manque encore, on garde les prochaines
  int place = (txt.y + txt.h - y) / m.ligneS;
  int premier = 0;
  if (place < ns) { premier = ns - max(0, place); for (int i = 0; i < ns && premier > 0; i++) if (!(S[i]["f"] | 0)) { premier = min(premier, i); break; } }
  for (int i = premier; i < ns && i - premier < place; i++) {
    JsonObject o = S[i];
    y += m.ligneS;
    bool fini = (o["f"] | 0) == 1, course = !strcmp(o["n"] | "", "Course");
    policeT(17, course);
    texte(txt.x, y, o["j"] | "");
    texte(txt.x + m.lJ, y, o["h"] | "");
    texteTronque(txt.x + m.lJ + m.lH, y, o["n"] | "", txt.w - m.lJ - m.lH);
    if (fini) canvas.fillRect(txt.x, y - asc() / 2 - 1, min(txt.w, m.lJ + m.lH + (int)largeurTexte(o["n"] | "")), 2, NOIR);   // barre
  }
  decalageCran = 0;
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
    else if (!strcmp(id, "rebours")) widgetRebours(e["rebours"], b);
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

// Tramage Floyd-Steinberg d'une image en niveaux de gris vers le canvas.
// Il ne faut que deux lignes d'erreur (la courante et la suivante) : 2 x w flottants (5 Ko pour 640 px)
// au lieu de w x h (1,6 Mo, plus que ce qui reste des 2 Mo de PSRAM de la Feather).
// Renvoie false si la memoire manque.
bool tramer(const uint8_t* g, int gl, int gh, int x0, int y0, int w, int h, float contraste) {
  float* tampon = (float*)ps_malloc(sizeof(float) * w * 2);
  if (!tampon) return false;
  float* cour = tampon;
  float* suiv = tampon + w;
  auto ligne = [&](int y, float* dst) {          // redimensionnement bilineaire d'une ligne
    float sy = (y + 0.5f) * gh / h - 0.5f;
    int ya = max(0, (int)floorf(sy)), yb = min(gh - 1, ya + 1);
    float fy = sy - floorf(sy);
    for (int x = 0; x < w; x++) {
      float sx = (x + 0.5f) * gl / w - 0.5f;
      int xa = max(0, (int)floorf(sx)), xb = min(gl - 1, xa + 1);
      float fx = sx - floorf(sx);
      float v = (g[ya * gl + xa] * (1 - fx) + g[ya * gl + xb] * fx) * (1 - fy) +
                (g[yb * gl + xa] * (1 - fx) + g[yb * gl + xb] * fx) * fy;
      dst[x] = (v - 128) * contraste + 128;
    }
  };
  ligne(0, cour);
  for (int y = 0; y < h; y++) {
    if (y + 1 < h) ligne(y + 1, suiv);
    for (int x = 0; x < w; x++) {
      float ancien = cour[x];
      float nouveau = ancien < 128 ? 0 : 255;
      float q = ancien - nouveau;
      canvas.drawPixel(x0 + x, y0 + y, nouveau == 0 ? NOIR : BLANC);
      if (x + 1 < w) cour[x + 1] += q * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) suiv[x - 1] += q * 3 / 16;
        suiv[x] += q * 5 / 16;
        if (x + 1 < w) suiv[x + 1] += q / 16;
      }
    }
    float* t = cour; cour = suiv; suiv = t;
  }
  free(tampon);
  return true;
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
    if (portrait) ok = tramer(gris, grisL, grisH, 20 + (C - w) / 2, 20 + (C - h) / 2, w, h, 1.1f);
    else          ok = tramer(gris, grisL, grisH, 20 + (C - w) / 2, (canvas.height() - h) / 2, w, h, 1.1f);
  }
  free(gris); gris = nullptr;
  if (!ok) return false;     // decodage ou tramage impossible : pas de pochette a moitie dessinee

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

// Ecran "hors ligne" : le cadre n'arrive plus a joindre le serveur depuis longtemps, ce qu'il affichait
// (date, meteo...) est perime. 'raison' : ce qui coince ; 'dernieres' : date de la derniere reponse du
// serveur ("sam. 7 novembre a 14:05", ecrite par le serveur), vide si inconnue.
void dessinerHorsLigne(const char* raison, const char* dernieres) {
  canvas.fillScreen(BLANC);
  int cx = canvas.width() / 2, cy = canvas.height() / 2;
  police(u8g2_font_fub30_tf);
  texteCentre(cx, cy - 50, "Hors ligne");
  police(u8g2_font_fur20_tf);
  texteCentre(cx, cy + 5, raison);
  char t[96];
  if (dernieres && dernieres[0]) snprintf(t, sizeof t, "Dernières nouvelles le %s", dernieres);
  else snprintf(t, sizeof t, "Aucune nouvelle depuis le démarrage du cadre");
  texteCentre(cx, cy + 45, t);
  police(u8g2_font_fur11_tf);
  texteCentre(cx, cy + 100, "Le cadre réessaie toutes les 30 minutes.");
}

void preparerDessin() {
  u8g2.begin(canvas);
  u8g2.setFontMode(1);
  u8g2.setFontDirection(0);
  u8g2.setForegroundColor(NOIR);
  u8g2.setBackgroundColor(BLANC);
}

// =====================================================================
//  RAFRAICHISSEMENT COMMANDE PAR LE SERVEUR (voir planRafraichissement dans serveur/rafraichissement.js)
// =====================================================================
// Empreinte d'une image (FNV-1a 32 bits, comme le serveur). 0 est reserve a "image affichee inconnue".
uint32_t empreinteImage(const uint8_t* p, size_t n) {
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
  return h ? h : 1;
}

// Lit les zones d'un plan partiel (P simple, D/T/Q 2 a 4 passes, I inversion ; verifie tout : taille, bornes,
// x et largeur multiples de 8). Renvoie le nombre de zones, ou -1 si le plan est illisible.
int zonesDuPlan(const uint8_t* plan, int taille, ZonePlan* zones, int max) {
  if (taille < 2 || !strchr("PDTQI", plan[0]) || !plan[0] || plan[1] < 1 || plan[1] > max) return -1;
  int n = plan[1], pos = 2;
  for (int k = 0; k < n; k++) {
    if (pos + 8 > taille) return -1;
    ZonePlan& z = zones[k];
    z.x = plan[pos] | (plan[pos + 1] << 8);     z.y = plan[pos + 2] | (plan[pos + 3] << 8);
    z.w = plan[pos + 4] | (plan[pos + 5] << 8); z.h = plan[pos + 6] | (plan[pos + 7] << 8);
    pos += 8;
    if (z.w <= 0 || z.h <= 0 || z.x % 8 || z.w % 8 || z.x + z.w > LARGEUR || z.y + z.h > HAUTEUR) return -1;
    int octets = z.w / 8 * z.h;
    if (pos + octets > taille) return -1;
    z.ancien = plan + pos;
    pos += octets;
  }
  return pos == taille ? n : -1;
}
