#!/bin/bash
# Prepare (une seule fois) ce qu'il faut pour compiler l'apercu en WebAssembly, dans /tmp/wasi :
# la bibliotheque C WASI (wasi-libc) et les fonctions de base de LLVM (compiler-rt) pour wasm32.
# Il faut clang, llvm-ar, wasm-ld, cmake et ninja (paquets clang, lld, llvm, cmake, ninja-build).
set -e
D=${1:-/tmp/wasi}
mkdir -p $D
[ -d $D/wasi-libc ] || git clone -q --depth 1 https://github.com/WebAssembly/wasi-libc.git $D/wasi-libc
cmake -S $D/wasi-libc -B $D/wasi-libc/build -G Ninja -DCMAKE_C_COMPILER=clang -DCMAKE_AR=llvm-ar \
  -DCMAKE_INSTALL_PREFIX=$D/sysroot -DTARGET_TRIPLE=wasm32-wasip1 > /dev/null
ninja -C $D/wasi-libc/build install > /dev/null
V=$(clang --version | grep -o 'version [0-9.]*' | cut -d' ' -f2)
[ -d $D/llvm ] || git clone -q --depth 1 --filter=blob:none --sparse --branch llvmorg-$V https://github.com/llvm/llvm-project.git $D/llvm
(cd $D/llvm && git sparse-checkout set compiler-rt/lib/builtins)
mkdir -p $D/crt
for f in $D/llvm/compiler-rt/lib/builtins/*.c; do
  case $(basename $f) in atomic*|emutls*|gcc_personality*|clear_cache*|enable_execute_stack*|os_version_check*|trampoline_setup*|cpu_model*|eprintf*) continue;; esac
  clang --target=wasm32-wasip1 --sysroot=$D/sysroot -O2 -w -fno-builtin -c $f -o $D/crt/$(basename ${f%.c}).o 2>/dev/null || true
done
llvm-ar rcs $D/libclang_rt.builtins-wasm32.a $D/crt/*.o
echo "Outils prets dans $D"
