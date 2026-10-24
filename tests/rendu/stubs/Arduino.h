#pragma once
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <string>
#include <algorithm>
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
#define radians(d) ((d)*0.017453292519943f)
#define degrees(r) ((r)*57.29577951308232f)
typedef uint8_t byte;
using std::min; using std::max;
class __FlashStringHelper;
#define F(s) ((const __FlashStringHelper*)(s))
class String : public std::string { public: using std::string::string; String(const std::string& s):std::string(s){} unsigned int length() const {return size();} };
#define D1 1
#define D2 2
#define D3 3
#define D6 43
#define D7 44
#define D9 8
#include "Print.h"
