#!/bin/bash
set -u
printf 'compiler: '; /usr/bin/clang-19 --version 2>&1 | head -2
printf 'archives: '; ls -lh /var/cache/apt/archives/emscripten* 2>/dev/null
printf 'core: '; ls vendor/mgba/include/mgba/internal/gba/sio/lockstep.h 2>/dev/null
printf 'disk: '; /bin/busybox df -h / 2>/dev/null || true
