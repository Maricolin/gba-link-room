#!/bin/bash
set -eu
mkdir -p .tools/emscripten-deb .tools/tmp
export TMPDIR="$PWD/.tools/tmp"
dpkg-deb -x /var/cache/apt/archives/emscripten_3.1.69+dfsg-4_all.deb .tools/emscripten-deb
EM_CONFIG="$PWD/.tools/emscripten-config"
printf "LLVM_ROOT = '/usr/lib/llvm-19/bin'\nBINARYEN_ROOT = '/usr'\nNODE_JS = ['/usr/bin/node']\nEMSCRIPTEN_ROOT = '%s/.tools/emscripten-deb/usr/share/emscripten'\nCACHE = '%s/.tools/em-cache'\nFROZEN_CACHE = False\n" "$PWD" "$PWD" > "$EM_CONFIG"
export EM_CONFIG
python3 .tools/emscripten-deb/usr/share/emscripten/emcc.py --version
