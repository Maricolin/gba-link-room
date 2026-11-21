# 开发与验证

## 运行前提

Node.js 22+；正式服务没有 npm 运行时依赖。Windows 工作站可使用本项目保留的 runtime/node.exe；Linux/容器使用其自身 Node。CMake、Emscripten、完整 vendor 与 reference 源码只在改动模拟器核心时需要，正常运行不需要编译器。

先读 ARCHITECTURE.md 找到功能模块，再读 PROTOCOL.md 理解座位、session 和 frame 的契约。不要手改 public/core 中的生成物来修复上层功能。

## 常用命令

在项目根目录：

~~~bash
npm start                  # 正式服务入口；读取 PUBLIC_MODE 等环境，不自动打开浏览器
npm run start:lan          # 本地交互启动器；重复启动会复用已知服务
npm run check              # 语法和 HTML 静态资源路径检查
npm run games:check        # 检查本机配置的 ROM 与目录，不监听端口
npm test                   # 自动发现 test 下的 .test.mjs/.test.cjs
~~~

无 npm 的本机也能直接运行：

~~~powershell
.\runtime\node.exe scripts/launcher.mjs
.\runtime\node.exe scripts/check.mjs
.\runtime\node.exe scripts/test.mjs
~~~

程序化 createApp({port:0,catalogPath,romDirectory,romPath,config:{...}}) 不隐式读取机器环境，便于并行测试；正式 server.mjs 才显式加载环境。局域网启动器不接受 PUBLIC_MODE=true，避免误用桌面启动流程作公网部署。不要在生产使用自动换端口的交互启动器。

## 浏览器回归

~~~bash
npm install --ignore-scripts
npm run test:browser
~~~

开发依赖锁定 playwright-core 1.65.1，需要系统已安装 Chrome。测试程序优先用正常 node_modules，当前工作站可继续使用最初 .tools/browser 缓存。浏览器临时目录和证书必须保持在忽略目录，不复制到镜像。若工作站系统临时盘不足，可将 TEMP/TMP 指向 .tools/tmp 后再运行。

- test/browser/features.cjs：独立房间、按键重绑/持久化、聊天、中文输入法、游戏输入隔离、手机布局。
- test/browser/multigame.cjs：用实际卡比与自制 SIO ROM 检查切换/缓存失效、旧档和按键迁移、分游戏导出、入房自动匹配游戏和存档准备屏障；不代表已测试其他商业游戏。
- test/browser/public.cjs：临时测试证书和本机 HTTPS 反代，验证访问口令、Secure/HttpOnly/SameSite Cookie、双人 WSS、聊天与注销连接。需要 OpenSSL；Windows 默认查 Git 附带路径，可用 OPENSSL 环境变量指定实际可执行文件。此证书只用于测试，不是生产信任方案。
- test/browser/smoke.cjs：连接已运行的 8765 服务，检查较长同步、重启与退出。用 BASE_URL 指定服务地址，LAN_URL 指定手机测试地址，默认均为 http://127.0.0.1:8765；用于无口令 LAN 实例。带口令生产模式使用独立的 public.cjs 测试。

Node 测试里的 SIO ROM 自包含，不需要游戏 ROM。真实卡比 ROM 回归在 data/roms 中无文件时会跳过，避免把用户 ROM 带入 CI；当前工作站有 ROM，因此会实际执行。截图输出在 artifacts/test-results。

## 修改和重新编译核心

保持 vendor/mgba 的固定上游版本；来源与许可证见 THIRD_PARTY.md。使用 Linux/WSL 和已安装 SDK：

~~~bash
bash scripts/build-core.sh
~~~

输出仍为 public/core/kirby-link.js 与 kirby-link.wasm。改了 native/link.c、核心编译开关或上游版本后，重跑 SIO、确定性、存档和浏览器测试，并记录新的核心哈希。build 与 .tools 缓存可在已具备标准 SDK 时重建；删它们不会影响已经生成的正式网页服务。

## 发布前

先 check、test、浏览器回归，再校验部署配置。Docker Compose 的 config 可在不启动引擎时做静态展开；镜像构建、Caddy 配置验证、实际 TLS、公网连通性、资源容量和漏洞扫描仍需要目标环境。不要把本机测试结果写成已经上线。

项目不包含自动远程部署凭据。单实例重启会中断房间，通知玩家导出电池存档。当前版本的已验证项目与待验证项目见验证记录，公网配置见 DEPLOYMENT.md。
