#!/bin/bash
set -eu
curl -fL --retry 2 https://codeload.github.com/tangobattle/mgba/tar.gz/81067250ed62f206737b96297fd7693c5295101d -o /tmp/mgba-core.tar.gz
mkdir -p vendor/mgba
tar -xzf /tmp/mgba-core.tar.gz --strip-components=1 -C vendor/mgba
