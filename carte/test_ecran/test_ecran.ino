// =====================================================================
//  Test des memoires de l'ecran (programme a part, pas de Wi-Fi)
//
//  Le controleur de l'ecran a deux memoires : "precedente" et "courante". Une mise a jour partielle
//  ne fait bouger que les pixels qui different entre les deux. Ce test montre ce que deviennent
//  ces memoires apres une mise a jour partielle : intactes, recopiees ou echangees.
//
//  Utilisation : televerser (meme carte et meme Partition Scheme que le cadre), ouvrir le moniteur
//  serie (115200 bauds) et suivre les etapes en regardant l'ecran. Puis remettre le programme
//  du cadre.
//
//  Resultat sur la dalle du cadre (7 nov. 2026) : etape 1 = B, etape 2 = A revient, etape 3 = C.
//  Le controleur ECHANGE donc le role de ses deux memoires apres chaque mise a jour partielle
//  (voir afficherZones dans cadre_eink.ino).
// =====================================================================
#include <GxEPD2_BW.h>
#include <Adafruit_GFX.h>

#define EPD_CS   5
#define EPD_DC   6
#define EPD_RST  9
#define EPD_BUSY 10
#define EPD_PWR  A2
#define LARGEUR 960
#define HAUTEUR 680

GxEPD2_BW<GxEPD2_1330_GDEM133T91, GxEPD2_1330_GDEM133T91::HEIGHT / 4> display(
  GxEPD2_1330_GDEM133T91(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
GFXcanvas1 canvas(LARGEUR, HAUTEUR);   // 1 = noir
uint8_t *imgA, *imgB, *imgC, *imgBlanc;

// Une image : un grand carre noir avec sa lettre en blanc, a la place de la lettre (A a gauche,
// B au milieu, C a droite), et les trois emplacements entoures d'un cadre fin.
uint8_t* image(int n) {
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
  uint8_t* copie = (uint8_t*)ps_malloc(LARGEUR / 8 * HAUTEUR);
  memcpy(copie, canvas.getBuffer(), LARGEUR / 8 * HAUTEUR);
  return copie;
}

void attendre(const char* quoi) {
  Serial.println(quoi);
  for (int s = 20; s > 0; s -= 5) { Serial.printf("  (suite dans %d s)\n", s); delay(5000); }
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 10000) delay(10);
  delay(500);
  imgA = image(0); imgB = image(1); imgC = image(2); imgBlanc = image(-1);
  pinMode(EPD_PWR, OUTPUT);
  digitalWrite(EPD_PWR, HIGH);
  delay(100);
  display.init(115200, false, 2, false);

  Serial.println("\n=== Test des memoires de l'ecran ===");
  // Etape 0 : depart propre, A affiche (rafraichissement complet)
  display.epd2.writeImageAgain(imgA, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(false);
  attendre("Etape 0 : l'ecran doit montrer le carre A seul (a gauche).");

  // Etape 1 : memoire precedente = A, courante = B, une mise a jour partielle
  display.epd2.writeImageToPrevious(imgA, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.writeImage(imgB, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(true);
  attendre("Etape 1 : le carre B seul (au milieu) doit etre affiche. NOTE CE QUE TU VOIS.");

  // Etape 2 : une seconde mise a jour partielle, sans rien ecrire (comme la methode double)
  display.epd2.refresh(true);
  attendre("Etape 2 : seconde passe sans rien ecrire. NOTE CE QUE TU VOIS (A ? B ? les deux ?).");

  // Etape 3 : on n'ecrit que la memoire courante = C, puis une mise a jour partielle
  display.epd2.writeImage(imgC, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(true);
  attendre("Etape 3 : courante = C seulement. NOTE CE QUE TU VOIS (C seul ? B et C ? autre ?).");

  // Fin : ecran blanc propre
  display.epd2.writeImageAgain(imgBlanc, 0, 0, LARGEUR, HAUTEUR, true);
  display.epd2.refresh(false);
  display.hibernate();
  Serial.println("Fin du test : ecran nettoye. Remets le programme du cadre.");
}

void loop() {}
