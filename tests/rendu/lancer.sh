#!/bin/bash
# Compile le dessin de la carte sur ordinateur (comme l'IDE Arduino) et produit des images de test.
set -e
cd "$(dirname "$0")"
mkdir -p libs
for r in adafruit/Adafruit-GFX-Library olikraus/U8g2_for_Adafruit_GFX bblanchon/ArduinoJson bitbank2/JPEGDEC; do
  [ -d "libs/$(basename $r)" ] || git clone -q --depth 1 "https://github.com/$r.git" "libs/$(basename $r)"
done
L=libs
# Adafruit GFX range ses sources dans src/ depuis ses dernieres versions
G=$L/Adafruit-GFX-Library; [ -d $G/src ] && G=$G/src
g++ -std=gnu++17 -O1 -w -DHOTE -D__LINUX__ -DARDUINO=100 -DARDUINOJSON_ENABLE_ARDUINO_STRING=0 -DARDUINOJSON_ENABLE_ARDUINO_STREAM=0 \
  -DARDUINOJSON_ENABLE_ARDUINO_PRINT=0 -DARDUINOJSON_ENABLE_PROGMEM=0 -Istubs -I../../carte/cadre_eink -I$G -I$L/U8g2_for_Adafruit_GFX/src \
  -I$L/ArduinoJson/src -I$L/JPEGDEC/src harness3.cpp $G/Adafruit_GFX.cpp $L/U8g2_for_Adafruit_GFX/src/U8g2_for_Adafruit_GFX.cpp \
  -x c $L/U8g2_for_Adafruit_GFX/src/u8g2_fonts.c -x c++ $L/JPEGDEC/src/JPEGDEC.cpp -o rendu
./rendu
python3 - <<'PY'
from PIL import Image
import glob
for f in glob.glob('r3_*.pbm'):
    im = Image.open(f).convert('L'); r = int(open(f[:-4] + '.rot').read())
    if r == 1: im = im.transpose(Image.Transpose.ROTATE_90)
    if r == 3: im = im.transpose(Image.Transpose.ROTATE_270)
    im.save(f[:-4] + '.png')
print('Images produites :', sorted(glob.glob('r3_*.png')))
PY
