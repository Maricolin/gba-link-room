#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
export TMPDIR="$PWD/.tools/tmp"
mkdir -p "$TMPDIR"
if command -v emcc >/dev/null; then
  EMCC=$(command -v emcc)
  EMCMAKE=$(command -v emcmake)
else
  export EM_CONFIG="$PWD/.tools/emscripten-config"
  export PATH="$PWD/.tools/emscripten-deb/usr/share/emscripten:$PATH"
  EMCC="$PWD/.tools/emscripten-deb/usr/share/emscripten/emcc"
  EMCMAKE="$PWD/.tools/emscripten-deb/usr/share/emscripten/emcmake"
fi
"$EMCMAKE" cmake -S . -B build/wasm -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG"
cmake --build build/wasm -j 6
