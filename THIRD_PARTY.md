# Third-party sources

## mGBA

- Repository: https://github.com/tangobattle/mgba (fork of https://github.com/mgba-emu/mgba)
- Exact source commit: 81067250ed62f206737b96297fd7693c5295101d
- This is the submodule revision selected by tangobattle/mgba-rs main at implementation time.
- License: Mozilla Public License 2.0. Original notices and LICENSE are retained under vendor/mgba.
- Source is unmodified. CMake selects the GBA-only minimal core and adds the lockstep SIO driver; native/link.c is the browser-facing adapter.

## mgba-rollback / mgba-rs

- https://github.com/tangobattle/mgba-rollback
- Reference source commit: ec6c1364ef02ba2738664bc73999ca19f92cdfd8
- https://github.com/tangobattle/mgba-rs
- native/link.c adapts the cooperative sleep/wake user glue and Link::try_tick scheduler to C/Emscripten.
- test/sio-rom.cjs adapts the SIO ping-pong assembly from mgba-rollback/src/testrom.rs, with an optional PSG reference tone used to test nonzero audio output.
- License: MPL-2.0. Reference source and original license remain under reference/mgba-rollback.
- The Rust rollback session/getgud engine is not compiled into this project. Network synchronization here waits for confirmed inputs.

## Node.js

- Portable Node runtime copied from the installed development runtime to runtime/node.exe.
- License: runtime/LICENSE-node.txt, including Node's bundled third-party notices.
- Browser testing uses pinned playwright-core 1.65.1 (development only, not served), with package-lock.json recording its registry integrity. The initial workstation cache under .tools/browser remains supported.

## ROM

- data/roms/kirby-amazing-mirror-cn.gba is the user's existing local file, moved without modifying its contents.
- It is not part of the source license and must not be committed or redistributed with the code.
