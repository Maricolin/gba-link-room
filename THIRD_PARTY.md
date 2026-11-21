# 代码来源、第三方许可与使用方式

本项目维护代码延续根 [LICENSE](<LICENSE>) 的 MPL-2.0；第三方文件原有版权、许可证和例外条款优先，不能把本表理解为把整个仓库、所有依赖或用户 ROM 重新许可为 MPL。分发指引见 [LICENSING](<docs/LICENSING.md>)，便于随制品保留的摘要见 [NOTICE](<NOTICE>)。

## 1. 实际核心与移植参考

| 仓库 | 本项目使用方式 | 版本/来源证据 | 协议与保留材料 |
| --- | --- | --- | --- |
| [mgba-emu/mgba](<https://github.com/mgba-emu/mgba>) | 原始 mGBA 项目；实际使用下列 fork 的核心实现，不另编译第二份上游核心 | fork 的来源关系；源码保留上游 Jeffrey Pfau 等作者声明 | MPL-2.0；[vendor 许可](<vendor/mgba/LICENSE>)及各文件头 |
| [tangobattle/mgba](<https://github.com/tangobattle/mgba>) | 直接纳入 vendor/mgba 并编译进 GBA WASM，使用 SIO lockstep 驱动 | commit 81067250ed62f206737b96297fd7693c5295101d | MPL-2.0，内嵌第三方另见下表；vendor 本体未做功能修改，裁剪/宏开关在本项目 CMake 中 |
| [tangobattle/mgba-rollback](<https://github.com/tangobattle/mgba-rollback>) | Link::try_tick 的确定性协作调度思路移植到 native/link.c；testrom.rs 的 SIO 测试程序改写到 test/sio-rom.cjs | 参考源码 ec6c1364ef02ba2738664bc73999ca19f92cdfd8；[本地参考](<reference/mgba-rollback/>) | MPL-2.0；[原始 LICENSE](<reference/mgba-rollback/LICENSE>)、适配文件中的出处标识 |
| [tangobattle/mgba-rs](<https://github.com/tangobattle/mgba-rs>) | src/sio.rs 的 sleep/wake/requestedId/playerIdChanged 协作用户胶水参考后改写成 C；Rust crate 没有链接进浏览器 | reference 的 Cargo.lock 记录 3a4621b158adef0ca1d82cde79d54ea52a795587；开发时另读取 main 接口，未为当时 main 单独保存源码快照 | MPL-2.0；[已核对的绑定许可](<licenses/mgba-rs-LICENSE.txt>) |

本项目网络采用收齐确认输入再推进的方式，**没有编译或接入 Rust getgud 会话引擎，也没有实现预测回滚**。reference 目录中的 session、throttler、Cargo.lock 等为参考存档；其中出现的 getgud/tango、crc32fast 等依赖不能直接算成本项目正式服务或 WASM 的已链接依赖。若以后复制或启用其实现，须重新核对相应仓库和依赖许可。

另需区分：[公开 tangobattle/tango](<https://github.com/tangobattle/tango>) 具有其自身的 [GPLv3 许可文本](<https://github.com/tangobattle/tango/blob/084e04c6124635e8e0fec78145e1a1ac9c1a1255/LICENSE>)，未编译进本项目。reference/mgba-rollback/src/throttler.rs 的原头说明复制自非公开 tango-pvp；这不等同于该公开 Tango 仓库，本次无法独立核验更上游许可链。当前仅保留参考仓库原始副本及其 MPL 声明，不将其解释为任意 Tango/getgud 代码均可按 MPL 直接接入；未来启用须专门核查。

适配改动包括 C 导出接口、浏览器 Worker、JS 房间协议与存档边界，以及原参考测试音调/音频断言的接入；不声称这些改动由上游维护者提供或背书。

## 2. mGBA 随仓第三方源码

当前本地 CMake 构建清单中，vendor 第三方对象仅见 inih/ini.c.o；未见 libpng、zlib、sqlite3、lzma、discord-rpc 的对象或外部链接项。此为该次构建配置的证据，不是所有未来构建或每个二进制符号的完整 SBOM。

| 组件 | 本仓库原文位置 | 许可与当前范围 |
| --- | --- | --- |
| [inih / Ben Hoyt](<https://github.com/benhoyt/inih>) | [LICENSE.txt](<vendor/mgba/src/third-party/inih/LICENSE.txt>)；[制品副本](<licenses/inih-LICENSE.txt>) | BSD-3-Clause；本次核心编译包含该配置解析对象，保留作者、条件和免责声明 |
| [libpng](<https://github.com/pnggroup/libpng>) | [LICENSE](<vendor/mgba/src/third-party/libpng/LICENSE>) | libpng 原许可及历史条款；仅随 vendor 保留，未见本次核心链接 |
| libpng contrib 示例 | [gregbook/LICENSE](<vendor/mgba/src/third-party/libpng/contrib/gregbook/LICENSE>)、[COPYING](<vendor/mgba/src/third-party/libpng/contrib/gregbook/COPYING>)，以及具体文件头 | 不能套用 libpng 主库许可：部分示例包含不同许可选项及 GPL 文本；仅存档，不纳入当前 WASM。若启用，逐文件检查 |
| [zlib](<https://github.com/madler/zlib>) | [zlib.h](<vendor/mgba/src/third-party/zlib/zlib.h>)、[README](<vendor/mgba/src/third-party/zlib/README>) | zlib 主库许可；contrib 可能另有声明。仅随源码保留，未见本次链接；Node 的 zlib 模块也不是这个目录的直接运行依赖 |
| [SQLite](<https://sqlite.org/copyright.html>) | [sqlite3.c](<vendor/mgba/src/third-party/sqlite3/sqlite3.c>)、[sqlite3.h](<vendor/mgba/src/third-party/sqlite3/sqlite3.h>) 的原始声明 | public-domain 奉献声明；未见本次链接，不据此概括 Node/Docker 或其他文件 |
| zlib dotzlib / MiniZip 附带代码 | [Boost 文本](<vendor/mgba/src/third-party/zlib/contrib/dotzlib/LICENSE_1_0.txt>)；[unzip.c 头](<vendor/mgba/src/third-party/zlib/contrib/minizip/unzip.c>) | dotzlib 为 Boost-1.0；MiniZip 还引用历史 Info-ZIP 解密代码许可，仓库内未找到该历史单独 LICENSE，启用/再分发前补核；当前未链接 |
| [LZMA SDK](<https://7-zip.org/sdk.html>) | [lzma 目录](<vendor/mgba/src/third-party/lzma/>)的具体文件头 | 以各 C/H 文件原始 public-domain 等声明为准；未见本次链接，不等同于宣称所有 7-Zip 产品代码同一许可 |
| [discord-rpc](<https://github.com/discord/discord-rpc>) | [LICENSE](<vendor/mgba/src/third-party/discord-rpc/LICENSE>)；内嵌 [mingw-std-threads/LICENSE](<vendor/mgba/src/third-party/discord-rpc/include/mingw-std-threads/LICENSE>) | MIT 主许可，内嵌子组件各自保留；本次未编译 Discord 集成 |

Discord 内嵌 [RapidJSON license.txt](<vendor/mgba/src/third-party/discord-rpc/include/rapidjson/license.txt>) 保留 MIT 与 msinttypes 的 BSD 声明；文件也列出 JSON_checker 的特殊 JSON 条款，但本次未发现该目录，不能把它推定为当前构建依赖。

第三方目录中的图片、工具、示例和字体也应按其具体声明处理；本表不是对全部附带素材的重新授权。

## 3. 生成 JS/WASM 的工具链与运行库

当前构建使用 Emscripten 3.1.69。生成的 JS 胶水及编入 WASM 的 SDK 运行库不能一概标成 MPL；对应原文副本保留在 licenses/，部署页面也提供 [许可与来源](<public/legal/notices.html>)。

| 组件 | 来源与许可 | 本仓库材料 |
| --- | --- | --- |
| [Emscripten](<https://github.com/emscripten-core/emscripten/tree/3.1.69>) | SDK 总许可提供 MIT / University of Illinois-NCSA 选项；实际 preamble.js 标 SPDX MIT | [LICENSE](<licenses/emscripten-LICENSE.txt>) |
| [musl](<https://musl.libc.org/>) | 主体 MIT，另有文件级版权/许可说明；不能只保留第一段而丢弃例外 | [完整 COPYRIGHT](<licenses/musl-COPYRIGHT.txt>) |
| [LLVM/compiler-rt](<https://github.com/llvm/llvm-project>) | 当前 SDK builtins 头标 Apache-2.0 WITH LLVM-exception；该例外及原文一并保留 | [官方 LLVM 许可文本](<licenses/llvm-compiler-rt-LICENSE.txt>) |
| Doug Lea dlmalloc | SDK 中 dlmalloc 2.8.6 原文为 public-domain/CC0 释放声明；Emscripten 修改同时参考 SDK 许可 | [原始归属摘录](<licenses/dlmalloc-NOTICE.txt>) |

本次不是对所有 LLVM/libc 对象的逐符号审计；升级 SDK、启用其他端口、线程、解码器或静态库后，应重新生成与实际制品对应的许可清单。

## 4. 开发和部署依赖，不混作核心代码

- [microsoft/playwright](<https://github.com/microsoft/playwright>)：playwright-core 1.65.1，仅开发浏览器测试，Apache-2.0；保留 [LICENSE](<licenses/playwright-LICENSE.txt>) 和 [NOTICE](<licenses/playwright-NOTICE.txt>)，其中声明源自 Puppeteer 的部分。node_modules 不提交，package-lock.json 记录版本与完整性。
- [nodejs/node](<https://github.com/nodejs/node>)：Node.js 22+ 是外部运行时，主许可 MIT，发行版包含自己的第三方声明。Windows 本机 runtime/node.exe 不在 Git 上传清单；若另外分发该二进制，须连同该发行版完整 LICENSE/第三方声明，不可只带项目 MPL。
- [caddyserver/caddy](<https://github.com/caddyserver/caddy>)：部署模板使用外部 Caddy 镜像，项目主许可 Apache-2.0。未把 Caddy 实现复制为本项目自有源码；镜像中的 Go 依赖等以相应发行版材料为准。
- GitHub Actions 的 checkout/setup-node 仅在 CI 运行，镜像与 action 引用不是把它们所有代码并入本项目许可的声明。
- Libretro 序列号数据库、任天堂旧产品页和 OWASP/Caddy/Node 文档仅用于识别/功能或安全资料核对；没有将整套数据库或说明书复制为运行代码。引用链接见对应文档，不据此宣称得到商标、游戏或素材许可。

## 5. ROM、私有上传和来源权限

用户本次明确授权把九个运行 ROM 纳入拟创建的私有 GitHub 快照；该授权只是本次工作流的内容选择，不是游戏、汉化、修改版等权利人的分发授权证明。ROM/ 原始重复文件、存档和密钥不在上传范围。

ROM、存档和第三方商标不属于根 MPL-2.0。私有仓库或来源署名不会自动解决游戏内容的复制/分发权利。公开仓库、发 Release、提供 ROM 下载或商业化之前，应单独确认相应权利；不能以开源模拟器的许可证代替 ROM 授权。技术访问保护和哈希校验也不是 DRM 或权利证明。

## 核对依据

- 现有 root/vendor/reference LICENSE、Cargo.toml、Cargo.lock、具体 C/H 文件头。
- CMakeLists.txt 与本次本机 build/wasm 的对象清单/链接命令；这些中间产物不进仓库。
- [Mozilla MPL 2.0 正文](<https://www.mozilla.org/en-US/MPL/2.0/>)与[官方 FAQ](<https://www.mozilla.org/en-US/MPL/2.0/FAQ/>)。

这份清单用于工程归属和分发准备，不是完整法律审计、权利担保或最终适配所有分发场景的结论。
