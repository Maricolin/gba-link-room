#!/bin/bash
set -eu
id
for t in gcc cmake cargo rustc emcc node npm python3; do command -v "$t" || true; done
curl -fL --retry 2 https://codeload.github.com/tangobattle/mgba-rollback/tar.gz/refs/heads/main -o /tmp/mgba-rollback.tar.gz
mkdir -p reference/mgba-rollback
tar -xzf /tmp/mgba-rollback.tar.gz --strip-components=1 -C reference/mgba-rollback
