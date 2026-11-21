# HTTP、房间与工作线程协议

所有应用层 WebSocket 消息为 JSON 对象，使用 type 区分。传输只在同源 /ws；公网是 WSS，不能把站点口令或会话放到 query string。需要访问口令时，浏览器先通过 HTTP 登录，握手自动携带 HttpOnly Cookie。

## HTTP

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| / | GET、HEAD | 静态页面，允许匿名读取登录界面 |
| /api/session | GET、HEAD | 返回 required、authenticated |
| /api/session | POST | 仅 {password:string} 的 JSON，最大 1 KiB；成功写入会话 Cookie |
| /api/session | DELETE | 注销 Cookie 并关闭此会话关联的所有 WebSocket |
| /api/info | GET、HEAD | 默认 ROM 元信息、defaultGameId、gameCount；公网需登录，不含 projectId |
| /api/games | GET、HEAD | 受认证保护的游戏列表，返回 defaultGameId 和 games |
| /api/games/:id/rom | GET、HEAD | 白名单 ID 对应 ROM；与旧别名共用认证和下载限额 |
| /game.gba | GET、HEAD | ROM；需有效访问会话（若启用口令），private/no-store，GET 单独限流 |
| /healthz | GET、HEAD | 极简健康检查；公网仍检查正确 Host |

公网 Origin 必须与 PUBLIC_ORIGIN 完全一致。POST/DELETE 登录路由和 WebSocket 握手不能缺 Origin。普通 HTTP 错误使用 {error:string}，不返回堆栈、口令或文件绝对路径。

## 客户端到服务端

| type | 字段 | 约束/行为 |
| --- | --- | --- |
| create | name、count、gameId、syncSaves | count 必须属于游戏 players；不传 gameId 用默认游戏；现代客户端设置 syncSaves:true |
| join | name、code、可选 gameId、syncSaves | code 为六位字符串；显式 gameId 须匹配目标；现代客户端设置 syncSaves:true |
| leave | 无 | 退出；运行中的房间整体停止并释放全部输入 |
| start | 无 | 仅房主，人数必须到齐 |
| restart | session | 仅房主；停止旧 session，再准备新 session |
| saveReady | gameId、romSha256 | 先提交电池存档（无档用空串）再确认；开始前等待所有现代客户端确认 |
| ready | session | 本浏览器的整个通信线加载完成，不同于存档准备确认 |
| input | session、frame、keys | frame 从 0 连续递增；keys 是 0–1023 的 GBA 位掩码 |
| checksum | session、frame、digest | frame=300、600…（已执行帧数）；digest 为非空字符串 |
| fatal | session、message | 模拟器错误，停止此房间 |
| save | data、gameId、romSha256 | 严格 base64，解码不超过 128 KiB；只能更新当前房间游戏及同一 ROM 版本；空串表示无档 |
| chat | text | 单行文本 1–300 Unicode 码点；作者字段由服务器填入 |
| ping | time | 回显时间用于 RTT 展示 |

客户端不能用 slot、senderId、name 等附加字段假冒输入座位或聊天作者；以连接中持有的房间身份为准。输入最多预提交至服务端当前帧 +180，旧 session 和越序帧均被拒绝。

## 服务端到客户端

| type | 主要字段 | 用途 |
| --- | --- | --- |
| hello | id、romSha256、defaultGameId | 本连接 ID 与默认 ROM 标识，不能据此覆盖用户当前所选游戏 |
| room | gameId、game、code、count、host、players、running | game 为公开配置；players 为 id/name/slot/ready，slot 从 0 开始，ready 表示存档已提交 |
| left | 无 | 本连接退出完成 |
| prepare | session、count、gameId、game、romUrl、romSha256、saves | 每人按房间配置下载相同 ROM，saves 按座位排序；一个房间固定一个游戏 |
| begin | session、delay | 输入流水线宽度，不是输入预测；LAN 默认 3、公网默认 6，可配 1–12 |
| tick | session、frame、keys | 所有座位确认输入到齐后广播一帧 |
| stopped | reason | 停止模拟与输入；原座位可保留以便重新开始 |
| chat | room、id、senderId、name、text、time | 同房消息，服务端生成 ID、作者和时间 |
| chatHistory | room、messages | 只向新加入者给最近 50 条 |
| saved | size、gameId、romSha256 | 已接收该游戏的电池存档副本；每连接 LRU 最多 8 项、512 KiB（按 base64 存储大小） |
| pong | time | RTT 回显 |
| error | message | 应用错误，不一定终止 WebSocket |

运行中每 300 帧比较所有玩家给出的摘要，分歧则停止。prepare 等待 30 秒；运行期持续无确认输入 15 秒会停止。任何人断线也会停止，当前没有快照同步或原地续传。

游戏配置包含 id、title、players、defaultPlayers、link、compatibility、说明、按键显示标签和 ROM 哈希/大小/受控 URL，不包含磁盘路径。link 为 cable 或单人 none，后者只能人数1。房间创建后不能修改游戏；“退出房间并切换ROM”会先退出，换游戏必须新建。旧客户端省略游戏字段时按默认或当前房间解释，现代客户端应始终提交明确身份。

## 工作线程边界

主线程发 connect/disconnect、keys、command、videoAck、exportSave；其中 command.data 才是上表的客户端应用消息。Worker 发 connection/hello/room/loading/begin/stopped/video/audio/chat/chatHistory/save/stats/ping/error。

Worker 的 save 回调携带原 gameId、romSha256、nickname 和 slot；主线程必须使用这些字段持久化，不能使用回调到达时 UI 当前游戏或当前昵称。video/audio/stats 也携带游戏身份用于丢弃过期结果。ROM 缓存按游戏 ID 与哈希区分，切换时取消过期下载，不能复用另一游戏的字节。

video 是 240×160 RGBA 可转移 ArrayBuffer；audio 是立体声 Int16 PCM 与采样率。音画缓冲不是网络协议的一部分，网络不传视频。prepare 后每端必须使用同一 ROM 和相同座位存档；只模拟自己的 GBA 会破坏链路确定性。

## 必须区分的权限边界

共享站点口令只控制谁能进入服务，并非账号体系。六位房间码不等于高强度房间凭据。成员获取完整 ROM 和 prepare 中的座位存档是当前同步机制的一部分；不要向不可信的服务成员发送私人进度。详见 SECURITY.md。
