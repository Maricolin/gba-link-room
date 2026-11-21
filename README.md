# GBA Link Room · GBA 网页联机小站

基于 mGBA/WebAssembly 的私有 GBA 网页联机项目。浏览器在本地运行房间内的完整模拟通信线，每位玩家有独立的 GBA 核心与画面；Node 服务负责房间、确认输入、聊天和会话，不用共享视频模拟多人。

当前快照：**1.4.0**。支持局域网运行，也提供访问口令保护的同源 HTTPS/WSS 公网部署模板。当前采用确认帧同步，**尚未实现预测回滚**。

## 功能

- 配置式游戏目录、ROM 版本选择、各游戏支持人数及联机说明。
- 1 人游戏和最多 4 台 GBA 的通信线核心调度；实际联机能力以各 ROM 的配置与实测为准。
- 每人独立输入与画面；键盘重绑、触屏控制和标准手柄。
- 房间文字聊天、最近消息、中文输入法与游戏按键隔离。
- 按游戏 ID、ROM SHA-256、昵称和网站来源隔离电池存档，支持导入/导出。
- 私服访问口令、HttpOnly/Secure/SameSite 会话、Origin/Host 校验、消息限额与超时。

## 从 GitHub 克隆后启动

需要 **Node.js 22 或更高版本**。正式服务没有 npm 运行时依赖，也不需要重新编译已附带的 WASM。

~~~bash
git clone https://github.com/Maricolin/gba-link-room.git
cd gba-link-room
node --version
node scripts/launcher.mjs
~~~

这是私有仓库，克隆需要你的 GitHub 账号具有访问权限。不要将访问令牌放入克隆 URL、脚本或聊天记录。

启动器默认打开 http://127.0.0.1:8765，并打印本机实际局域网地址。其他设备使用该局域网地址加入同一房间；不能在另一台设备上使用 127.0.0.1。重复启动会复用同一项目的现有服务。

Windows 也可双击 [启动联机.cmd](<启动联机.cmd>)。本机工作目录可能保留 runtime/node.exe；**Git 仓库不包含该本机运行时**，克隆后请安装 Node.js 并确保 node 在 PATH 中，脚本会自动使用它。

无浏览器弹窗、供服务管理器使用的正式入口：

~~~bash
node server.mjs
~~~

浏览器建房只连接模拟通信线，不会替你操作游戏内多人菜单。完整操作见 [使用说明](<docs/USAGE.md>)。

## 本私有快照中的游戏资源

按仓库所有者的明确授权，本次私有快照包含游戏目录所需的 **9 个运行 ROM**：原有卡比，以及用户提供的8项输入所对应的游戏/版本。运行文件位于 data/roms 及其 imported 子目录，与 [config/games.json](<config/games.json>) 对应；不重复收录原始 ROM/ 目录。光明力量的原输入是改名为 .gba 的 ZIP，运行目录保存经路径、大小和 CRC 校验后提取的实际 GBA 文件。

ROM 不属于项目源码的 MPL-2.0 许可。本仓库的资源纳入范围只描述此次私有快照；Docker 镜像仍不包含 ROM，部署时通过只读目录外置挂载。后续新增 ROM 默认受 .gitignore 保护，不会因为运行导入工具就自动提交或上传。

[逐 ROM 兼容清单](<docs/ROM_COMPATIBILITY.md>) 区分了核心通过与完整玩法验收。现有条目没有据此宣称宝可梦交换、对战、四人之剑关卡等完整流程均已验证。

切换时先点击“退出房间并切换 ROM”，再选择另一游戏。两个剑盾版本有独立指纹和存档空间，不能混房或自动互相迁移进度。

## 检查与测试

~~~bash
npm run check
npm run games:check
npm test
~~~

以上命令无需 npm install。浏览器开发测试才需要安装固定版本的开发依赖和系统 Chrome：

~~~bash
npm ci --ignore-scripts
npm run test:browser
npm run test:roms
~~~

HTTPS 浏览器测试还需要 OpenSSL。详细环境、临时目录及 SDK 构建方法见 [开发文档](<docs/DEVELOPMENT.md>)。测试截图和临时产物保留在本机 artifacts，不随源码提交。

功能阶段验证摘要：Windows/Linux 各51项自动测试；许可补充后 Windows 完整53项、Linux 新增2项许可测试通过；九个实际 ROM 的全部声明人数形成23个基础核心用例，另有6个延长音频用例；同一浏览器连续切换九项并运行渲染通过。该摘要不是完整游戏玩法或公网渗透测试证明，范围见 [验证记录](<docs/VERIFICATION.md>)。

## 扩展其他自备游戏

1. 将有权提供的 .gba 放入本机 data/roms。
2. 在 [游戏目录](<config/games.json>) 中增加稳定 ID、相对文件名、人数、模式与说明。
3. 运行 npm run games:check，通过后重启服务并刷新页面。新条目先标 untested，再按实际证据更新兼容状态。

~~~bash
npm run roms:import          # 本机管理员导入 ROM/，不自动 stage/commit/push
npm run probe:roms           # 选跑配置目录的核心探测
~~~

普通目录接入不需要修改服务端或重新编译 WASM。当前支持同一房间同一份 ROM 的 cable 通信线配置，或仅人数1的 none 单人配置；不支持不同版本混联、无线适配器和单卡多机下载。参见 [新增游戏指南](<docs/ADDING_GAMES.md>) 与 [配置模板](<config/games.example.json>)。

## 文件架构

~~~text
server.mjs                  正式服务入口
src/server/                 配置、游戏目录、HTTP、安全、WebSocket、房间协议
public/js/                  页面、输入、聊天、认证、游戏选择与存档
public/js/emulator/         网络/模拟工作线程与哈希校验
public/core/                已构建的 JS/WASM 核心
native/                     mGBA C 接口与协作调度
config/                     游戏目录及示例
data/roms/                  本私有快照明确纳入的运行 ROM
scripts/                    启动、检查、构建与导入工具
test/                       单元、协议、安全与浏览器验证
deploy/                     Compose、Caddy、systemd 模板
docs/                       使用、架构、协议、部署、安全和迭代记录
vendor/、reference/         上游源代码、原始参考与许可
~~~

缓存、编译中间文件、本机运行时、真实环境配置、口令、私钥、存档及原始重复 ROM 不提交。只保留编译与运行所需的源码、资源和明确授权的运行文件。

## 公网部署

推荐「浏览器 HTTPS/WSS → Caddy → 内部 Node 服务」。按 [部署指南](<docs/DEPLOYMENT.md>) 配置域名、随机访问口令、部署游戏目录及只读 ROM 目录，再启动 Compose；模板只发布 TCP 80/443，不直接发布 Node 8765。

公网适合少量可信好友。确认帧要等待所有人的输入，延迟抖动和最慢设备会影响全房间，不承诺公网60 FPS。房间、聊天和会话保存在单进程内存中，不能仅增加副本数量就完成负载均衡。

共享站点口令不是账号或逐房强授权，已授权浏览器能够保存收到的 ROM。应用限额和容器隔离不能保证防渗透或抗 DDoS。尚未完成真实公网部署、外网容量验证或完整渗透测试，详见 [安全边界](<docs/SECURITY.md>)。

## 文档与迭代

- [许可与分发指引](<docs/LICENSING.md>)、[第三方来源](<THIRD_PARTY.md>)、[NOTICE](<NOTICE>)。
- [CHANGELOG](<CHANGELOG.md>)：各版本功能、修复与验证摘要。
- [迭代历史](<docs/ITERATION_HISTORY.md>)：阶段目标、取舍和后续方向；历史开发版本不伪装成已有 Git 提交。
- [架构与修改入口](<docs/ARCHITECTURE.md>)、[协议](<docs/PROTOCOL.md>)、[配置](<docs/CONFIGURATION.md>)。
- [使用说明](<docs/USAGE.md>)、[ROM兼容](<docs/ROM_COMPATIBILITY.md>)、[开发与测试](<docs/DEVELOPMENT.md>)。

## 来源与许可

本项目维护代码延续 **[MPL-2.0](<LICENSE>)**。第三方源码、运行库、依赖和素材保留各自原有许可，不能把整个仓库或生成的 JS/WASM 一概标为只有 MPL。归属摘要见 [NOTICE](<NOTICE>)，完整清单见 [THIRD_PARTY.md](<THIRD_PARTY.md>)。

| 来源仓库 | 实际使用方式 | 许可/版本说明 |
| --- | --- | --- |
| [mgba-emu/mgba](<https://github.com/mgba-emu/mgba>) | 原始 mGBA 项目及作者来源 | MPL-2.0；保留上游声明 |
| [tangobattle/mgba](<https://github.com/tangobattle/mgba>) | 本项目实际编译的核心 fork，位于 vendor/mgba | MPL-2.0；commit 81067250ed62f206737b96297fd7693c5295101d |
| [tangobattle/mgba-rollback](<https://github.com/tangobattle/mgba-rollback>) | 协作 Link 调度移植参考；SIO 测试ROM改写来源 | MPL-2.0；参考 ec6c1364ef02ba2738664bc73999ca19f92cdfd8 |
| [tangobattle/mgba-rs](<https://github.com/tangobattle/mgba-rs>) | SIO sleep/wake 用户胶水参考，改写为 C 接口 | MPL-2.0；未链接 Rust crate，版本证据见来源表 |
| [emscripten-core/emscripten](<https://github.com/emscripten-core/emscripten>) | 生成 JS/WASM 的工具链和运行库 | 3.1.69；MIT/NCSA，另含 musl、LLVM 等各自声明 |
| [benhoyt/inih](<https://github.com/benhoyt/inih>) | 核心配置解析对象 | BSD-3-Clause |
| [microsoft/playwright](<https://github.com/microsoft/playwright>) | 浏览器测试开发依赖 | playwright-core 1.65.1，Apache-2.0及原始NOTICE |
| [nodejs/node](<https://github.com/nodejs/node>) / [caddyserver/caddy](<https://github.com/caddyserver/caddy>) | 外部运行时/部署代理，不是本项目自有实现 | Node主许可MIT、Caddy主许可Apache-2.0；发行版附带依赖另依其原文 |

**没有接入 getgud 的 Rust 回滚会话引擎。** reference 中的 Cargo 依赖或 throttler 存档不等于当前运行依赖，不能因此宣称实现预测回滚。公开的 [tangobattle/tango](<https://github.com/tangobattle/tango>) 另有自身GPLv3许可文本，不能因参考仓库提到它就把其实现当成本项目MPL代码。mGBA 随仓的 libpng、zlib、SQLite、LZMA、Discord/RapidJSON及示例也不能一律套用MPL；实际构建范围和原许可路径在第三方清单中逐项说明。

MPL要求在分发受保护源码/可执行形式时保留通知，并按适用条件让接收者取得对应源码。仅在服务器运行未交付的代码，与发送给浏览器的JS/WASM不同。仓库可以保持私有，但应为相关接收者安排可访问的匹配源码或独立源码包，不能把无权限私库链接当作已经提供源码。详细做法与边界见 [许可与分发指引](<docs/LICENSING.md>)、[Mozilla正文](<https://www.mozilla.org/en-US/MPL/2.0/>)和[官方FAQ](<https://www.mozilla.org/en-US/MPL/2.0/FAQ/>)。

本次用户允许上传九项ROM到私有快照，不等于已经核验游戏、汉化/修改版等权利人允许复制或分发。ROM、存档、商标不适用本项目源码许可；私有仓库、署名或访问口令不会自动授予公开下载或商业化权利。对外开放或发布发行包前，须独立确认这些内容的权利范围。
