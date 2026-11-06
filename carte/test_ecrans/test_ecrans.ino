// =====================================================================
//  Test des ecrans e-ink sur la Feather ESP32-S3 (etape 2 du cadre)
//
//  Dessine une mire (cadre, damier, texte) sur chaque ecran active
//  ci-dessous, et affiche dans le moniteur serie le temps de
//  rafraichissement, pour reperer un probleme de cablage ou de nappe.
//
//  Carte : "Adafruit Feather ESP32-S3 2MB PSRAM"
//  Bibliotheque : GxEPD2 (deja utilisee par le cadre)
// =====================================================================

#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Fonts/FreeSans12pt7b.h>

// ---------- Quels ecrans tester ? (1 = oui, 0 = non) ----------
#define TEST_A 1   // ecran branche sur le groupe A
#define TEST_B 0   // ecran branche sur le groupe B (etape 3)

// ---------- Brochage definitif ----------
// Partages par les deux ecrans : CLK -> SCK, DIN -> MO, VCC -> 3V, GND -> GND
#define EPD_DC     6    // D6  (partage)
#define EPD_PWR    A2   //     (partage)
// Ecran A
#define A_CS       5    // D5
#define A_RST      9    // D9
#define A_BUSY     10   // D10
// Ecran B
#define B_CS       12   // D12
#define B_RST      A0
#define B_BUSY     A1

// Tampon par pages (1/4 de l'ecran a la fois) : peu de memoire, meme avec deux ecrans
#define PAGE_H (GxEPD2_1330_GDEM133T91::HEIGHT / 4)

GxEPD2_BW<GxEPD2_1330_GDEM133T91, PAGE_H> ecranA(
  GxEPD2_1330_GDEM133T91(A_CS, EPD_DC, A_RST, A_BUSY));
GxEPD2_BW<GxEPD2_1330_GDEM133T91, PAGE_H> ecranB(
  GxEPD2_1330_GDEM133T91(B_CS, EPD_DC, B_RST, B_BUSY));

template <typename E>
void dessinerMire(E& e, const char* nom) {
  const int L = e.width(), H = e.height();
  e.setRotation(0);
  e.setFullWindow();
  e.firstPage();
  do {
    e.fillScreen(GxEPD_WHITE);

    // Trois cadres concentriques sur les bords : verifie qu'aucune ligne ne manque
    for (int i = 0; i < 3; i++) e.drawRect(i * 6, i * 6, L - i * 12, H - i * 12, GxEPD_BLACK);

    // Croix au centre
    e.drawLine(0, 0, L - 1, H - 1, GxEPD_BLACK);
    e.drawLine(L - 1, 0, 0, H - 1, GxEPD_BLACK);

    // Damier en bas a gauche
    const int c = 40;
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 8; x++)
        if ((x + y) % 2 == 0) e.fillRect(40 + x * c, H - 40 - (4 - y) * c, c, c, GxEPD_BLACK);

    // Bande noire pleine a droite
    e.fillRect(L - 200, H - 200, 160, 160, GxEPD_BLACK);

    // Texte (pas d'accents : les polices Adafruit GFX ne les ont pas)
    e.setTextColor(GxEPD_BLACK);
    e.setFont(&FreeSansBold24pt7b);
    e.fillRect(60, 60, 560, 150, GxEPD_WHITE);
    e.setCursor(80, 120);
    e.print("Ecran ");
    e.print(nom);
    e.setFont(&FreeSans12pt7b);
    e.setCursor(80, 170);
    e.printf("%d x %d - test cadre e-ink", L, H);
  } while (e.nextPage());
}

template <typename E>
void tester(E& e, const char* nom, int pinBusy) {
  Serial.printf("\n--- Ecran %s ---\n", nom);
  Serial.printf("BUSY avant init : %d\n", digitalRead(pinBusy));

  e.init(115200, true, 2, false);   // affiche aussi les messages de diagnostic GxEPD2

  unsigned long t0 = millis();
  dessinerMire(e, nom);
  unsigned long duree = millis() - t0;
  Serial.printf("Rafraichissement : %.1f s\n", duree / 1000.0);

  if (duree < 1500)
    Serial.println("-> Trop rapide : l'ecran n'a probablement pas repondu (BUSY ou cablage).");
  else if (duree > 20000)
    Serial.println("-> Trop long : delai depasse sur BUSY (cablage BUSY/RST ou nappe).");
  else
    Serial.println("-> Duree normale. Verifie la mire a l'oeil.");

  e.hibernate();
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 4000) delay(10);
  Serial.println("\n=== Test des ecrans e-ink ===");

  // Alimentation des cartes pilotes
  pinMode(EPD_PWR, OUTPUT);
  digitalWrite(EPD_PWR, HIGH);
  delay(50);

  // Les deux CS a l'etat haut avant tout : un ecran non teste ne doit pas ecouter le bus
  pinMode(A_CS, OUTPUT); digitalWrite(A_CS, HIGH);
  pinMode(B_CS, OUTPUT); digitalWrite(B_CS, HIGH);
  pinMode(A_BUSY, INPUT);
  pinMode(B_BUSY, INPUT);

#if TEST_A
  tester(ecranA, "A", A_BUSY);
#endif
#if TEST_B
  tester(ecranB, "B", B_BUSY);
#endif

  digitalWrite(EPD_PWR, LOW);
  Serial.println("\nTermine. L'image reste affichee sans alimentation.");
}

void loop() {}
