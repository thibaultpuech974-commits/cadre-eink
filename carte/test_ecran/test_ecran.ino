// =====================================================================
//  Tests de l'ecran (programme a part, pas de Wi-Fi)
//
//  Utilisation : choisir le test ci-dessous, televerser (meme carte et meme Partition Scheme que le
//  cadre), ouvrir le moniteur serie (115200 bauds) et suivre les etapes en regardant l'ecran.
//  Puis remettre le programme du cadre.
//
//  TEST 1 - memoires du controleur. Le controleur a deux memoires : "precedente" et "courante".
//  Une mise a jour partielle ne fait bouger que les pixels qui different entre les deux. Ce test
//  montre ce que deviennent ces memoires apres une mise a jour partielle : intactes, recopiees ou
//  echangees. Resultat sur la dalle du cadre (7 nov. 2026) : etape 1 = B, etape 2 = A revient,
//  etape 3 = C. Le controleur ECHANGE donc le role de ses deux memoires apres chaque mise a jour
//  partielle (voir afficherZones dans cadre_eink.ino).
//
//  TEST 2 - comparaison des methodes de mise a jour partielle. L'ecran est coupe en 5 colonnes :
//  1, 2, 3 et 4 passes, et inversion des zones. Les memes changements (temperature, barre qui se
//  deplace, texte, trait) y sont affiches 24 fois de suite, chaque colonne avec sa methode, dans les
//  memes mises a jour. A la fin, la colonne avec le moins de traces des anciennes images est la
//  meilleure methode pour cette dalle (methode a choisir ensuite dans la page web, menu Reveil).
// =====================================================================
#define TEST 2

#include <GxEPD2_BW.h>
#include <Adafruit_GFX.h>

#define EPD_CS   5
#define EPD_DC   6
#define EPD_RST  9
#define EPD_BUSY 10
#define EPD_PWR  A2
#define LARGEUR 960
#define HAUTEUR 680
#define OCTETS  (LARGEUR / 8 * HAUTEUR)

GxEPD2_BW<GxEPD2_1330_GDEM133T91, GxEPD2_1330_GDEM133T91::HEIGHT / 4> display(
  GxEPD2_1330_GDEM133T91(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
GFXcanvas1 canvas(LARGEUR, HAUTEUR);   // 1 = noir

uint8_t* copie() {
  uint8_t* c = (uint8_t*)ps_malloc(OCTETS);
  memcpy(c, canvas.getBuffer(), OCTETS);
  return c;
}

void attendre(const char* quoi, int secondes) {
  Serial.println(quoi);
  for (int s = secondes; s > 0; s -= 5) { Serial.printf("  (suite dans %d s)\n", s); delay(5000); }
}

// Les memoires du controleur s'echangent apres chaque mise a jour partielle : on compte les passes
// pour savoir laquelle joue le role de "precedente"
int partielles = 0;
// Une mise a jour partielle : 'ancien' (precedente) -> 'nouveau' (courante), selon les roles du moment
void passe(const uint8_t* ancien, const uint8_t* nouveau) {
  if (partielles % 2 == 0) {
    display.epd2.writeImageToPrevious(ancien, 0, 0, LARGEUR, HAUTEUR, true);   // 0x26
    display.epd2.writeImage(nouveau, 0, 0, LARGEUR, HAUTEUR, true);            // 0x24
  } else {
    display.epd2.writeImage(ancien, 0, 0, LARGEUR, HAUTEUR, true);
    display.epd2.writeImageToPrevious(nouveau, 0, 0, LARGEUR, HAUTEUR, true);
  }
  display.epd2.refresh(true);
  partielles++;
}

// Rafraichissement complet propre (avec nettoyage)
void complet(const uint8_t* img) {
  display.epd2.writeImageAgain(img, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(false);
  display.epd2.refresh(false);
  partielles = 0;
}

// ---------------------------------------------------------------------
//  TEST 1 : memoires du controleur
// ---------------------------------------------------------------------
// Un grand carre noir avec sa lettre en blanc (A a gauche, B au milieu, C a droite)
uint8_t* carre(int n) {
  canvas.fillScreen(0);
  for (int k = 0; k < 3; k++) canvas.drawRect(40 + k * 310, 180, 260, 320, 1);
  if (n >= 0) {
    canvas.fillRect(40 + n * 310, 180, 260, 320, 1);
    canvas.setTextColor(0);
    canvas.setTextSize(28);
    canvas.setCursor(40 + n * 310 + 60, 230);
    canvas.print((char)('A' + n));
  }
  canvas.setTextColor(1);
  canvas.setTextSize(3);
  canvas.setCursor(40, 60);
  canvas.print("Test des memoires de l'ecran");
  return copie();
}

void testMemoires() {
  uint8_t *imgA = carre(0), *imgB = carre(1), *imgC = carre(2), *imgBlanc = carre(-1);
  Serial.println("\n=== Test des memoires de l'ecran ===");
  complet(imgA);
  attendre("Etape 0 : l'ecran doit montrer le carre A seul (a gauche).", 20);
  display.epd2.writeImageToPrevious(imgA, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.writeImage(imgB, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(true);
  attendre("Etape 1 : le carre B seul (au milieu) doit etre affiche. NOTE CE QUE TU VOIS.", 20);
  display.epd2.refresh(true);
  attendre("Etape 2 : seconde passe sans rien ecrire. NOTE CE QUE TU VOIS (A ? B ? les deux ?).", 20);
  display.epd2.writeImage(imgC, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(true);
  attendre("Etape 3 : courante = C seulement. NOTE CE QUE TU VOIS (C seul ? B et C ? autre ?).", 20);
  complet(imgBlanc);
  Serial.println("Fin du test : ecran nettoye. Remets le programme du cadre.");
}

// ---------------------------------------------------------------------
//  TEST 2 : comparaison des methodes, une par colonne
// ---------------------------------------------------------------------
const int COLONNES = 5, LCOL = LARGEUR / COLONNES;   // 192 px, multiple de 8
const int HAUT = 60;                                 // bandeau des titres, jamais modifie
const char* TITRES[COLONNES] = { "1 passe", "2 passes", "3 passes", "4 passes", "Inversion" };

// Image numero i : dans chaque colonne, les memes elements qui changent d'une image a l'autre
uint8_t* scene(int i) {
  canvas.fillScreen(0);
  canvas.cp437(true);
  canvas.setTextColor(1);
  for (int c = 0; c < COLONNES; c++) {
    int x = c * LCOL;
    canvas.setTextSize(2);
    canvas.setCursor(x + 12, 20);
    canvas.print(TITRES[c]);
    if (c) canvas.drawFastVLine(x, 0, HAUTEUR, 1);
    // une temperature en gros
    canvas.setTextSize(6);
    canvas.setCursor(x + 16, 90);
    char t[24];
    snprintf(t, sizeof t, "%d", 8 + (i * 7) % 13);
    canvas.print(t);
    canvas.print((char)248);
    // une barre noire qui descend
    canvas.fillRect(x + 20, 190 + (i % 8) * 34, 150, 22, 1);
    // du texte qui change
    canvas.setTextSize(2);
    canvas.setCursor(x + 12, 480);
    snprintf(t, sizeof t, "Bus %02d min", (i * 11) % 60);
    canvas.print(t);
    canvas.setCursor(x + 12, 510);
    canvas.print(i % 2 ? "Pluie 15 %" : "Soleil 3 %");
    // un trait en biais qui se decale, comme une courbe
    for (int e = 0; e < 3; e++) canvas.drawLine(x + 10, 600 + e + (i % 5) * 8, x + 180, 560 + e + (i % 3) * 12, 1);
  }
  return copie();
}

// Une mise a jour de toutes les colonnes : 'ancien' -> 'nouveau', chaque colonne avec sa methode.
// Passe p : les colonnes "N passes" refont le trajet ancien -> nouveau tant que p < N ; la colonne
// inversion passe ses zones changees en negatif (p = 0) puis revient (p = 1) ; sinon, memoires
// identiques : pas de mouvement.
uint8_t *prec, *cour;   // contenu des deux roles pour la passe en cours
void miseAJour(const uint8_t* ancien, const uint8_t* nouveau) {
  const int BL = LCOL / 8, CASE = 40;   // inversion : par cases de 192 x 40 px (comme des zones)
  const int L8 = LARGEUR / 8, c4 = 4 * BL;
  bool change[HAUTEUR / CASE + 1] = { false };   // cases de la colonne inversion qui changent
  for (int y = HAUT; y < HAUTEUR; y++)
    for (int b = 0; b < BL; b++) if (ancien[y * L8 + c4 + b] != nouveau[y * L8 + c4 + b]) change[(y - HAUT) / CASE] = true;
  for (int p = 0; p < 4; p++) {
    for (int y = 0; y < HAUTEUR; y++) {
      for (int c = 0; c < COLONNES; c++) {
        for (int b = 0; b < BL; b++) {
          int k = y * L8 + c * BL + b;
          uint8_t a = ancien[k], n = nouveau[k], pr = n, co = n;
          if (y >= HAUT && c < 4 && p <= c) pr = a;
          if (y >= HAUT && c == 4 && p < 2 && change[(y - HAUT) / CASE]) { pr = p == 0 ? n : (uint8_t)~n; co = p == 0 ? (uint8_t)~n : n; }
          prec[k] = pr; cour[k] = co;
        }
      }
    }
    passe(prec, cour);
  }
}

void testComparaison() {
  const int N = 24;
  prec = (uint8_t*)ps_malloc(OCTETS);
  cour = (uint8_t*)ps_malloc(OCTETS);
  Serial.println("\n=== Comparaison des methodes de mise a jour partielle ===");
  uint8_t* ancien = scene(0);
  complet(ancien);
  attendre("Depart : ecran nettoye, image 1. Les 24 mises a jour vont suivre (environ 2 min).", 10);
  for (int i = 1; i <= N; i++) {
    uint8_t* nouveau = scene(i);
    unsigned long t0 = millis();
    miseAJour(ancien, nouveau);
    Serial.printf("Mise a jour %d / %d (%lu ms)\n", i, N, millis() - t0);
    free(ancien);
    ancien = nouveau;
    delay(1000);
  }
  display.hibernate();
  Serial.println("Termine. Prends l'ecran en photo (de face, sans reflet) et compare les colonnes :");
  Serial.println("la meilleure est celle ou l'on voit le moins les anciennes temperatures, barres, textes et traits.");
  Serial.println("L'image reste affichee. Remets ensuite le programme du cadre (il nettoiera l'ecran).");
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 10000) delay(10);
  delay(500);
  pinMode(EPD_PWR, OUTPUT);
  digitalWrite(EPD_PWR, HIGH);
  delay(100);
  display.init(115200, false, 2, false);
#if TEST == 1
  testMemoires();
#else
  testComparaison();
#endif
}

void loop() {}
