// Previsualisation dans la page web : le meme code de dessin que la carte, compile en WebAssembly.
// La page envoie l'etat (JSON, comme /api/etat) et recupere l'image 960 x 680 (1 bit par point).
#include "dessin.h"
void* operator new(size_t n) { return malloc(n); }
void* operator new[](size_t n) { return malloc(n); }
void operator delete(void* p) noexcept { free(p); }
void operator delete[](void* p) noexcept { free(p); }
void operator delete(void* p, size_t) noexcept { free(p); }
void operator delete[](void* p, size_t) noexcept { free(p); }
extern "C" void __cxa_pure_virtual() { abort(); }
static char* entree = nullptr;
static int tailleEntree = 0;
static bool pret = false;
extern "C" {
// Zone ou la page ecrit le JSON de l'etat
__attribute__((export_name("zone"))) char* zone(int n) {
  if (n > tailleEntree) { free(entree); entree = (char*)malloc(n); tailleEntree = n; }
  return entree;
}
// Dessine l'etat (n octets de JSON) ; renvoie l'image, ou 0 si le JSON est illisible
__attribute__((export_name("dessiner"))) uint8_t* dessiner(int n, float vBat) {
  if (!pret) { preparerDessin(); pret = true; }
  JsonDocument d;
  if (deserializeJson(d, entree, n)) return nullptr;
  const char* mode = d["mode"] | "tableau";
  canvas.setRotation(d["rotation"] | 0);
  if (!strcmp(mode, "blanc")) canvas.fillScreen(BLANC);
  else if (!strcmp(mode, "tableau")) dessinerTableau(d.as<JsonVariant>(), vBat);
  else dessinerMessage("Aperçu indisponible", "pour ce mode");
  return canvas.getBuffer();
}
}
