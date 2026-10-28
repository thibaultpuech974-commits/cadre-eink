#pragma once
#include <stdint.h>
#include <string.h>
#include <stdio.h>
class __FlashStringHelper;
class String;
class Print {
public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t* b, size_t n) { size_t k = 0; while (n--) k += write(*b++); return k; }
  size_t write(const char* s) { return s ? write((const uint8_t*)s, strlen(s)) : 0; }
  size_t print(const char* s) { return write(s); }
  size_t print(int v) { char b[16]; snprintf(b, 16, "%d", v); return write(b); }
};
#include "Arduino.h"
