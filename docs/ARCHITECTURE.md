# 项目架构与修改位置

本轮目录整理保持根 server.mjs 和 Windows 双击入口兼容。浏览器静态文件、服务端协议、模拟器源代码、私人数据、部署配置和生成物分开管理。

~~~text
项目根/
├─ server.mjs                  # 正式服务入口；读取环境，导出 createApp 供测试
├─ src/server/
│  ├─ games.mjs                # JSON 游戏目录、ROM 约束、流式哈希与受控下载
│  ├─ app.mjs                  # HTTP 路由、静态文件、ROM 读取、进程资源生命周期
│  ├─ config.mjs               # 根目录、版本、环境解析、启动前生产配置校验
│  ├─ security.mjs             # 会话、Host/Origin、安全响应头和有界限流器
│  ├─ websocket.mjs            # WebSocket 握手、分片、限额、读取截止时间、心跳
│  └─ rooms.mjs                # 房间、角色权限、确认帧、校验、聊天、内存存档副本
├─ public/                     # 唯一可经静态路由访问的目录
│  ├─ index.html               # 页面 DOM 与无内联脚本的入口
│  ├─ css/                     # base / features / auth
│  ├─ js/
│  │  ├─ app.js                # 界面协调、键盘触屏手柄、Canvas、WebAudio、存档
│  │  ├─ controls.js           # 纯按键映射、存储校验及按键互换
│  │  ├─ chat.js               # 房间聊天渲染、输入法及发送交互
│  │  ├─ games.js              # 选择游戏、人数、说明与兼容状态显示
│  │  ├─ game-storage.js       # 分游戏存档/按键与旧卡比迁移
│  │  ├─ auth.js               # 口令界面、会话查询与退出；不保存访问口令
│  │  └─ emulator/
│  │     ├─ worker.js          # WebSocket、确认帧队列和完整 GBA 通信线
│  │     └─ hash.js            # 无 WebCrypto 的 LAN HTTP 下 SHA-256 降级
│  └─ core/                    # 已编译 JS/WASM；不要手工修改生成文件
├─ native/link.c               # mGBA 的 C 接口、协作调度、音画和电池存档
├─ CMakeLists.txt              # 可复现核心构建入口
├─ vendor/mgba/                # 固定版本上游核心完整源代码与许可
├─ reference/mgba-rollback/    # 原始算法与测试参考，不参与正式服务
├─ config/games.json           # 默认游戏与游戏配置白名单
├─ data/roms/                  # 用户 ROM；忽略 Git 与镜像
├─ scripts/                    # launcher、测试发现、核心构建和供应商下载工具
├─ tools/launcher.mjs          # 旧路径兼容桥，仅转入 scripts/launcher.mjs
├─ test/                       # Node 单元/集成/协议/安全测试
│  └─ browser/                 # LAN、按键聊天、公网模式 HTTPS/WSS 验收
├─ deploy/                     # Compose、Caddy 和 systemd 模板
├─ docs/                       # 使用、开发、协议、部署及安全边界
├─ archive/setup-tools/        # 首次机器环境排查历史，不参与运行
├─ runtime/                    # 本机 Windows Node；不进源码和镜像
├─ .tools/                     # 本机 SDK/浏览器测试缓存；不进源码和镜像
├─ build/                      # CMake 中间产物；不参与正式服务
└─ artifacts/                  # 测试截图等生成物；不参与正式服务
~~~

## 运行边界

公网数据流为「浏览器 HTTPS/WSS → Caddy → Node 房间服务」。Node 不运行模拟器、不调用用户命令、不接收 ROM 上传，也不把存档写成服务器文件。浏览器 Worker 中的 WASM 同时模拟房间里全部 GBA；服务端只按座位收集和转发输入、验证权限和摘要。

准备流程：HTTP 会话检查 → 必要时口令登录 → WebSocket hello → 创建/加入 → prepare（ROM 哈希与各座位电池存档）→ 所有浏览器 ready → begin → 确认 tick。每帧由游戏 0 号核心的帧号作参照，依 mGBA sleep/wake 协作推进，不能将每个核心独立 runFrame 当作通信线实现。

浏览器主线程负责 DOM/输入和音画输出；Worker 负责网络与模拟，避免聊天或页面布局阻塞核心。主线程向 Worker 发送 command/keys，Worker 发回 room/video/audio/chat/stats。HTTP HttpOnly Cookie 由浏览器自动携带；主线程和 Worker 都不读取口令 Cookie。

## 后续功能在哪改

| 功能 | 优先修改位置 | 要补的验证 |
| --- | --- | --- |
| 新游戏与人数 | config/games.json + scripts/catalog.mjs | 目录校验后逐游戏验证；不要改通用核心冒充兼容 |
| 主题、布局、触屏 | public/index.html、public/css、public/js/app.js | 手机无横向溢出、触控组合键、焦点释放 |
| 键盘/手柄映射 | public/js/controls.js、app.js | 映射有效性、持久化、输入隔离 |
| 聊天增强 | public/js/chat.js + src/server/rooms.mjs | 同房隔离、textContent 输出、IME、频控 |
| 房间邀请/权限 | rooms.mjs + security.mjs + app.js | 伪造身份、过期/撤销、跨房间访问 |
| 公网认证 | security.mjs + auth.js + HTTP 路由 | Cookie/Origin/会话撤销和登录限额 |
| 网络延迟/同步 | rooms.mjs + emulator/worker.js | 帧顺序、慢设备、漂移、不同步恢复 |
| 模拟器/音频/存档 | native/link.c，再运行构建脚本 | 2–4 核 SIO、确定性、音频、存档兼容 |
| 扩容/持久化 | 独立设计会话与房间路由服务 | 不能只把当前 Node 副本数改成多个 |

## 保持的约束

- 不把私人 ROM、访问口令、浏览器存档放进 public、镜像或源码提交。
- 不让 HTTP 参数决定文件路径以外的执行行为；没有上传、远程脚本执行或管理命令端点。
- app.mjs 不实现游戏规则；rooms.mjs 不操作 DOM；WebSocket 模块不混入房间业务。
- 改网络协议同时改两端，并保留旧 session/frame 拒绝校验；协议见 PROTOCOL.md。
- 浏览器存档按网站来源 + 游戏 ID + ROM 哈希 + 昵称保存，按键按游戏 ID 区分。默认卡比兼容旧命名空间；Worker 导出时携带原游戏、ROM 哈希、座位和昵称，避免切换中的延迟消息串档。文件夹重组不改变网站来源，因此不会主动迁移或清除原有浏览器存档。
- 当前为单实例内存服务。账号系统、高熵房间邀请、审计指标、房间分片/断线续传与真正 rollback 仍属于后续设计，不能假定已经存在。
