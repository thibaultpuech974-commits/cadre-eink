#include "dessin.h"
#include <fstream>
#include <sstream>
static std::string lire(const char* n) { std::ifstream f(n, std::ios::binary); std::stringstream s; s << f.rdbuf(); return s.str(); }
static void sauver(const std::string& nom, int rot) {
  FILE* f = fopen((nom + ".pbm").c_str(), "wb"); fprintf(f, "P4\n%d %d\n", LARGEUR, HAUTEUR);
  fwrite(canvas.getBuffer(), 1, OCTETS, f); fclose(f);
  FILE* r = fopen((nom + ".rot").c_str(), "w"); fprintf(r, "%d", rot); fclose(r);
}
int main() {
  preparerDessin();
  const char* noms[] = {"defaut", "styles", "portrait", "courbe_f1", "courbe_f1_portrait", "courbe_petite", "agenda_long"};
  for (int i = 0; i < 7; i++) {
    JsonDocument d; deserializeJson(d, lire((std::string("d_") + noms[i] + ".json").c_str()));
    int rot = d["rotation"] | 0;
    canvas.setRotation(rot);
    dessinerTableau(d.as<JsonVariant>(), 4.02f);
    sauver(std::string("r3_") + noms[i], rot);
  }
  std::string b = lire("pochette640.jpg");
  canvas.setRotation(1);
  printf("pochette portrait %d\n", dessinerPochette((uint8_t*)b.data(), b.size(), "Blue in Green (feat. John Coltrane & Bill Evans)", "Miles Davis", "Kind of Blue (Legacy Edition)"));
  sauver("r3_pochette_portrait", 1);
  canvas.setRotation(3);
  dessinerMessage("Batterie vide", "Rechargez le cadre"); sauver("r3_message_portrait3", 3);
  canvas.setRotation(0);
  dessinerHorsLigne("Serveur injoignable", "sam. 7 novembre à 14:05"); sauver("r3_hors_ligne", 0);
  canvas.setRotation(1);
  dessinerHorsLigne("Wi-Fi introuvable", ""); sauver("r3_hors_ligne_portrait", 1);
  return 0;
}
