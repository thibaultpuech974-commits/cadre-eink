#!/bin/bash
# Compile le dessin du cadre (carte/cadre_eink/cadre_eink.ino) en WebAssembly pour la previsualisation
# de la page web : produit serveur/apercu.wasm.
# A lancer apres chaque modification du programme de la carte (les tests le rappellent) :
#   bash outils/apercu/preparer-outils.sh      (une seule fois : bibliotheques WebAssembly dans /tmp/wasi)
#   bash outils/apercu/construire.sh
set -e
cd "$(dirname "$0")"
W=${WASI:-/tmp/wasi}
SYS=$W/sysroot
R=../../tests/rendu
L=$R/libs
mkdir -p $L
for r in adafruit/Adafruit-GFX-Library olikraus/U8g2_for_Adafruit_GFX bblanchon/ArduinoJson bitbank2/JPEGDEC; do
  [ -d "$L/$(basename $r)" ] || git clone -q --depth 1 "https://github.com/$r.git" "$L/$(basename $r)"
done
(cd $R && python3 proto.py > /dev/null) && cp $R/ino_arduino.cpp .
O=obj; mkdir -p $O
CF="--target=wasm32-wasip1 --sysroot=$SYS -Os -ffunction-sections -fdata-sections -w"
DEF="-DHOTE -D__LINUX__ -DARDUINO=100 -DARDUINOJSON_ENABLE_ARDUINO_STRING=0 -DARDUINOJSON_ENABLE_ARDUINO_STREAM=0 \
 -DARDUINOJSON_ENABLE_ARDUINO_PRINT=0 -DARDUINOJSON_ENABLE_PROGMEM=0 -DARDUINOJSON_ENABLE_STD_STRING=0 \
 -DARDUINOJSON_ENABLE_STD_STREAM=0 -DARDUINOJSON_ENABLE_STRING_VIEW=0"
INC="-Istubs -I. -I$L/Adafruit-GFX-Library -I$L/U8g2_for_Adafruit_GFX/src -I$L/ArduinoJson/src -I$L/JPEGDEC/src"
CXX="clang++ $CF -std=c++17 -fno-exceptions -fno-rtti -nostdinc++ $DEF $INC"
$CXX -c apercu.cpp -o $O/apercu.o
$CXX -c $L/Adafruit-GFX-Library/Adafruit_GFX.cpp -o $O/gfx.o
$CXX -c $L/U8g2_for_Adafruit_GFX/src/U8g2_for_Adafruit_GFX.cpp -o $O/u8g2.o
clang $CF $DEF $INC -c $L/U8g2_for_Adafruit_GFX/src/u8g2_fonts.c -o $O/polices.o
$CXX -c $L/JPEGDEC/src/JPEGDEC.cpp -o $O/jpeg.o
clang++ $CF -nostdlib++ -nodefaultlibs -mexec-model=reactor -Wl,--gc-sections -Wl,-z,stack-size=1048576 \
  $O/*.o -lc $W/libclang_rt.builtins-wasm32.a -o ../../serveur/apercu.wasm
# Empreinte du programme de la carte : les tests verifient que l'apercu a ete recompile apres chaque modification
sha1sum ../../carte/cadre_eink/cadre_eink.ino | cut -c1-12 > ../../serveur/apercu.version
rm -rf $O ino_arduino.cpp
ls -l ../../serveur/apercu.wasm
