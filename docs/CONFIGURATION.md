# 运行配置

正式入口是 node server.mjs（或 npm start），从进程环境读取下表。应用不会隐式加载 .env。根 .env.example 用于 Compose 的域名/限额插值，Compose 才会生成 PUBLIC_ORIGIN 并挂载口令。不要把 Compose 示例直接当作 Node 的生产环境文件。

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| PUBLIC_MODE | false | 必须显式 true 才启用公网严格校验；只接受 true/false |
| PUBLIC_ORIGIN | 无 | 公网必填，精确 https://域名[:非默认端口]，无路径、尾斜杠、query、userinfo 或通配符 |
| HOST | LAN 0.0.0.0；公网 127.0.0.1 | 同机代理绑定回环，Compose 内部网络才用 0.0.0.0 |
| PORT | 8765 | Node 上游端口；不是公网 TLS 端口 |
| GAME_CATALOG_PATH | config/games.json | 游戏目录 JSON，默认项必须启用，最多 64 项、1 MiB |
| ROM_DIRECTORY | data/roms | 目录里所有 rom 相对路径的根，禁止逃逸 |
| ROM_PATH | 无 | 单 ROM 兼容模式；不能与显式 GAME_CATALOG_PATH 同时设置 |
| ACCESS_PASSWORD_FILE | 无 | 读取外部受限文件中的访问口令；推荐生产使用 |
| ACCESS_PASSWORD | 无 | 与文件配置二选一；公网至少 16 字符，推荐随机生成 |
| MAX_CONNECTIONS | 160 | 全服务同时 TCP 连接上限，1–2048 |
| MAX_TCP_PER_IP | 20 | 每直接对端 TCP 上限，1–2048；代理合并来源时示例为 128 |
| MAX_WS_PER_IP | 20 | 每直接对端 WS 上限，1–80；代理示例为 80 |
| WS_READ_TIMEOUT_MS | 5000 | 一个未完整读取的 WS 消息/分片的截止时间，25–30000 ms |
| INPUT_DELAY_FRAMES | LAN 3；公网 6 | 确认输入流水线深度，1–12；大一些可减轻 RTT 卡顿，也增加操控延迟 |

PUBLIC_MODE=true 缺 HTTPS Origin 或长口令会在启动时失败。公网 Host 必须是 PUBLIC_ORIGIN 的 host；反向代理须保留原始 Host，健康探针也必须带这个 Host。应用不信任客户端 X-Forwarded-For/Forwarded，所有按 IP 的限额只看 socket 对端；单反代后的玩家共享该 IP 额度，不要通过伪造不同 IP 来规避。

局域网启动器 scripts/launcher.mjs 用于桌面交互，不是生产入口；显式配置公网模式时会拒绝启动并提示使用正式入口。tools/launcher.mjs 仅保留旧路径兼容。

link 支持 cable（通信线候选）或 none（当前只开放单人，players 必须是 [1]）。每个启用 ROM 都必须是普通非空 .gba 文件且不超过 32 MiB。启动顺序流式计算 SHA-256，不将全部 ROM 常驻内存；下载前校验文件身份，变更后要求重启。只有管理员能配置路径，浏览器只传白名单游戏 ID。新增游戏见 ADDING_GAMES.md。

## 固定协议上限

- 同时最多 80 个 WebSocket、20 个房间，每房 1–4 台 GBA；当前是单实例，不是可横向扩容的共享房间服务。
- 一般应用消息不超过 64 KiB；电池存档消息最大 200 KiB，base64 解码后最大 128 KiB。
- 出站缓冲 2 MiB，入站字节/帧/消息令牌桶、心跳和读取截止时间共同约束慢连接。
- 准备 30 秒、确认输入无进展 15 秒停止房间；每 300 个已执行帧验证摘要。
- 聊天每连接每 5 秒突发 5 条，每条不超过 300 个 Unicode 码点，历史最多 50 条。
- 登录按直接 IP 突发 5 次/分钟，线性回填；会话最多 256 个，12 小时到期。共享口令不是账号认证。
- 建房/加入按直接 IP 突发 10 次/30 秒，另有全局预算。
- ROM 的 GET 独立限额为每会话突发 10 次/分钟、每直接 IP 20 次/分钟、全局 40 次/分钟，线性回填；HEAD 不扣下载额度。

限额只用于控制部分资源耗尽，不能保证抗 DDoS。若需调整这些固定策略，应修改对应安全/房间模块并增加边界测试，不要为了让某个代理测试通过而全部关闭。
