// Arduino minimal pour compiler le dessin du cadre en WebAssembly (sans bibliotheque C++ standard)
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#define PROGMEM
#define pgm_read_byte(a) (*(const uint8_t*)(a))
#define pgm_read_word(a) (*(const uint16_t*)(a))
#define pgm_read_dword(a) (*(const uint32_t*)(a))
#define pgm_read_pointer(a) (*(void* const*)(a))
#define memcpy_P memcpy
#ifndef PI
#define PI 3.14159265358979f
#endif
typedef bool boolean;
typedef uint8_t byte;
#define radians(d) ((d)*0.017453292519943f)
#define degrees(r) ((r)*57.29577951308232f)
// (type de retour deduit "par valeur" : surtout pas une reference vers un parametre)
template <class A, class B> inline auto min(A a, B b) { return a < b ? a : b; }
template <class A, class B> inline auto max(A a, B b) { return a > b ? a : b; }
class __FlashStringHelper;
#define F(s) ((const __FlashStringHelper*)(s))
class String { public: String() {} String(const char*) {} const char* c_str() const { return ""; } unsigned int length() const { return 0; } char operator[](unsigned int) const { return 0; } };
inline void* operator new(size_t, void* p) noexcept { return p; }
#define D1 1
#define D2 2
#define D3 3
#define D6 43
#define D7 44
#define D9 8
#include "Print.h"
