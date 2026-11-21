# 公网部署

本项目可以经同源 HTTPS/WSS 在公网联机，适合少量可信好友。**仅好友私用时，优先考虑 VPN/组网，并保持游戏端口不对公网开放。** 需要让好友不装 VPN 即可访问时，再按下文部署。不要把局域网启动器的 TCP 8765 直接转发到公网。

浏览器通过同一个域名加载页面、登录、下载 ROM，并连接 WSS 的 `/ws`；Caddy 终止 TLS 并自动转发 WebSocket 升级。不需要 WebRTC、STUN 或 UDP 打洞。服务器协调房间并转发游戏输入，不运行 GBA 核心；每个浏览器都在本地模拟房间内所有玩家的核心。确认帧要等所有人的输入，最慢设备、最远玩家、延迟抖动或丢包都可能让全房间等待。本版没有输入预测或 rollback，不承诺公网 60 FPS。建议从离所有玩家较近的节点、两人有线或稳定 Wi-Fi 连接开始测试。

房间、聊天、会话和服务端存档副本在单进程内存中；重启会清空，浏览器存档仍由浏览器保留。不要直接启动多个副本并做负载均衡：即使固定 WebSocket 后端，登录、建房和好友加入也可能落到不同实例。升级前通知玩家导出电池存档。更换域名也会改变浏览器存档的站点作用域。

当前默认目录已登记卡比和用户ROM目录导入的8个版本。部署时必须复制所有已启用项对应的ROM及 imported/ 相对结构；若只准备一部分，请先在部署使用的 games.json 中将缺失项 enabled:false，默认项不能停用。不要只复制卡比文件却保留其他8项启用。

上线前还需阅读 [许可与分发指引](<LICENSING.md>)：页面向浏览器发送JS/WASM时，相关接收者应能合理取得匹配的MPL覆盖源码。镜像保留许可材料和网页归属入口，不会自动提供对应源码包；私有仓库须对相应接收者实际开放访问，或另行提供不含ROM/密钥的源码包。

## 1. 域名、IP 与端口

1. 选一台有可达公网 IP 的 Linux 主机，或确认自家网络不是无法入站转发的 CGNAT。家用路由器需将 TCP 80/443 转发到 Caddy 主机；云主机需同时核对安全组和防火墙。公网游戏入口只用 TCP 443，以及 TCP 80（HTTP 跳转及 ACME 验证）；SSH 如需开放 TCP 22，限可信来源，优先走管理 VPN。
2. 给自有域名建立 A 记录指向公网 IPv4；仅在公网 IPv6 确实可达时添加 AAAA，删除错误或过期记录。从外网确认 DNS 已生效。示例使用 `play.example.com`，部署时换成自己的域名。裸 IP 不是本模板的部署方式。
3. 确认没有其他进程占用 TCP 80/443，Caddy 有出网 DNS 和 HTTPS 能力并可从公网接收 ACME 验证。默认不经 CDN；若加入额外代理，须重新验证 TLS、Host、Origin、WebSocket 及超时。默认禁用 HTTP/3，不需要 UDP 443。若明确要用，分别在 Compose 启用 UDP 443 映射、在 Caddy 的 protocols 加上 h3，并允许入口 UDP 443。

下列命令是供部署者在目标主机执行的示例，不会自动修改防火墙。两种方式任选一种，不同时启动。启动前先阅读 [安全边界](<SECURITY.md>)。

## 2. Docker Compose（推荐）

需要 Linux Docker Engine 与 Docker Compose v2+，推荐较新版本。使用项目根目录文件；只需构建运行镜像，不需要 npm 安装或重新编译 WASM。

~~~bash
cd deploy
cp ../.env.example .env
# 编辑 .env，将 SITE_DOMAIN 改成自己的域名：只填小写域名，不含协议、端口和斜杠。
install -d -m 0755 roms
install -m 0644 ../data/roms/kirby-amazing-mirror-cn.gba roms/kirby-amazing-mirror-cn.gba
install -d -m 0755 roms/imported
for file in ../data/roms/imported/*.gba; do
  [ -f "$file" ] || continue
  install -m 0644 "$file" roms/imported/
done
cp ../config/games.json games.json
install -d -m 0700 secrets
# 首次初始化：生成 64 字符随机口令，不打印、不传入命令行；如文件已存在则不覆盖。
(umask 077; set -C; openssl rand -hex 32 > secrets/access-password.txt)
chmod 600 secrets/access-password.txt
# 标准 Linux Docker（不使用 UID 重映射）中，官方 Node 镜像的 node 用户 UID/GID 为 1000。
sudo chown 1000:1000 secrets/access-password.txt

docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 web caddy
~~~

Compose 环境从 [样例](<../.env.example>) 复制；不要在 shell 导出冲突的 `SITE_DOMAIN`。Caddy 站点与 Node 的 `PUBLIC_ORIGIN=https://<域名>` 用同一个变量生成，生产 Origin 必须严格匹配，不能有尾斜杠。Compose 把 `deploy/games.json` 只读挂载到 `GAME_CATALOG_PATH=/app/config/games.json`，把 `deploy/roms/` 只读挂载到 `ROM_DIRECTORY=/roms`。ROM 文件名必须与目录中相对路径一致；随附配置使用 `kirby-amazing-mirror-cn.gba`，不是 `game.gba`。目录最多 64 项；每个启用游戏的 ROM 都必须存在、可读且是 1 字节至 32 MiB 的普通文件，否则服务启动失败。ROM 流式读取，Node 不常驻全部 ROM 内容。安装和修改游戏见 [添加自备游戏](<ADDING_GAMES.md>)；不要提交 ROM 或部署私有目录。通过密码管理器等私密方式向好友交付生成的口令，不要把它放进 URL、聊天记录、镜像、环境样例或代码库。

Compose 文件型 secret 是**只读绑定**，不是加密的 Swarm secret；文件属主和模式取自宿主，不能靠 Compose 的 secret `uid/gid/mode` 改写。使用 rootless、userns-remap、SELinux、Docker Desktop 或远端 Engine 时，按目标引擎的实际 UID 映射、挂载与访问规则检查权限，不要通过改成全局可读来绕过。核对文件是否存在并可读时不输出内容：

~~~bash
docker compose run --rm --no-deps web node -e 'const fs=require("node:fs"); for (const p of [process.env.ACCESS_PASSWORD_FILE,process.env.GAME_CATALOG_PATH]) fs.accessSync(p,fs.constants.R_OK); fs.accessSync(process.env.ROM_DIRECTORY,fs.constants.R_OK | fs.constants.X_OK)'
~~~

[Compose](<../deploy/compose.yml>) 只让 Node 加入内部后端网络，不映射 8765；Caddy 同时连接后端与有出网能力的默认网络。Node 使用非 root 用户、只读根文件系统、无附加 capabilities 和有限 tmpfs、进程数及内存；不要把不可信容器接到后端网络。Caddy 的数据和配置卷在容器重建后保留，含证书与私钥，勿执行 `docker compose down -v` 作为常规操作。默认 Docker 两服务的本地日志均轮转，Caddy 不开启请求访问日志；证书或启动故障仍应检查运维日志。短期 HSTS（1 天，不含子域名、无 preload）仅用于生产 HTTPS 模板。

## 3. 不用 Docker：同机 systemd + Caddy

需要 Linux、支持 `LoadCredential=` 的 systemd（建议 247+）、Node.js 22+ 和 Caddy 2。示例假定 Linux 发行版的 Caddy 服务读取 `/etc/caddy/Caddyfile`，其 unit 名为 `caddy.service`。先确认本机 Caddy 没有正在使用的其他站点；有其他站点时，应人工合并站点和全局配置，下面的覆盖命令不适用。

从项目根目录执行。若 `kirby-web` 用户已存在，先确认它是专用低权限账户再跳过创建；若 Node 不在 `/usr/bin/node`，则修改安装后的 unit 中的绝对路径，确保服务用户能读取与执行（不要用个人家目录中的 nvm 路径）。

~~~bash
node --version
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin kirby-web
sudo install -d -o root -g root -m 0755 /opt/kirby-web
sudo install -m 0644 server.mjs package.json LICENSE NOTICE THIRD_PARTY.md /opt/kirby-web/
sudo cp -R licenses /opt/kirby-web/
sudo install -d -m 0755 /opt/kirby-web/docs
sudo install -m 0644 docs/LICENSING.md /opt/kirby-web/docs/LICENSING.md
sudo cp -R src public config /opt/kirby-web/
sudo chown -R root:root /opt/kirby-web
sudo chmod -R a=rX,u+w /opt/kirby-web
sudo install -d -o root -g kirby-web -m 0750 /srv/kirby-web/roms
sudo install -o root -g kirby-web -m 0640 data/roms/kirby-amazing-mirror-cn.gba /srv/kirby-web/roms/kirby-amazing-mirror-cn.gba
sudo install -d -o root -g kirby-web -m 0750 /srv/kirby-web/roms/imported
for file in data/roms/imported/*.gba; do
  [ -f "$file" ] || continue
  sudo install -o root -g kirby-web -m 0640 "$file" /srv/kirby-web/roms/imported/
done
sudo install -d -o root -g root -m 0700 /etc/kirby-web
# 首次生成；不要用此步骤覆盖已有口令。
sudo sh -c 'umask 077; set -C; openssl rand -hex 32 > /etc/kirby-web/access-password.txt'
sudo chmod 600 /etc/kirby-web/access-password.txt
sudoedit /etc/kirby-web/site.env
~~~

在 `site.env` 中填写下列内容，实际域名务必与 Caddy 的 `SITE_DOMAIN` 一致：

~~~ini
PUBLIC_ORIGIN=https://play.example.com
MAX_CONNECTIONS=160
MAX_TCP_PER_IP=128
MAX_WS_PER_IP=80
WS_READ_TIMEOUT_MS=5000
INPUT_DELAY_FRAMES=6
~~~

[systemd unit](<../deploy/kirby-web.service>) 将应用绑定到回环地址 `127.0.0.1:8765`，应用、游戏目录与 ROM 对服务用户只读。默认配置是 `/opt/kirby-web/config/games.json`，ROM 根目录由 `ROM_DIRECTORY=/srv/kirby-web/roms` 指定；也可在 `site.env` 设置绝对的 `GAME_CATALOG_PATH`，指向该服务用户可读取的其他目录文件。systemd 管理器读取 root 的口令文件，为该 unit 提供只读凭据；Node 从 `%d/access-password` 读取，不需获得原始密钥文件的权限。例子默认用文件口令；若改用 `ACCESS_PASSWORD`，不可同时配置 `ACCESS_PASSWORD_FILE`，且要考虑环境变量的可见范围。公网模式要求至少 16 字符，建议上述随机口令。

~~~bash
sudo install -m 0644 deploy/kirby-web.service /etc/systemd/system/
sudo install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl edit caddy
~~~

在 Caddy 的 systemd drop-in 填写：

~~~ini
[Service]
Environment=SITE_DOMAIN=play.example.com
~~~

Caddy 默认反代 `127.0.0.1:8765`，无需填 `WEB_UPSTREAM`。用实际域名验证配置后，再启用服务；若现有 Caddy 已在运行，首次加入 drop-in 要重启，使新环境变量生效（会中断该进程已有连接）。

~~~bash
sudo -u caddy env SITE_DOMAIN=play.example.com caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now kirby-web
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl status kirby-web caddy
~~~

## 4. 从 1.2 升级到 1.3

升级会中断对局，先让玩家导出电池存档。保留原站点域名、访问口令和原 ROM 字节；后端内存房间不会迁移。

- **Compose：**更新程序后，在 `deploy/` 内把旧 `roms/game.gba` 改名为 `roms/kirby-amazing-mirror-cn.gba`（若目标已存在，先核对是否是同一份 ROM，勿覆盖）。首次创建 `games.json` 用 `cp ../config/games.json games.json`，已有自定义目录则不要覆盖。删除自定义配置中遗留的 `ROM_PATH`；运行 `docker compose config --quiet` 和 `docker compose up -d --build --force-recreate`。
- **systemd：**安装新版文件和 unit，按上述目录布局安装原 ROM，确认 `site.env` 没有旧 `ROM_PATH`，然后 `sudo systemctl daemon-reload`、`sudo systemctl restart kirby-web`。若暂需继续单 ROM 兼容模式，可设置 `ROM_PATH=/绝对路径/旧文件.gba`，同时不设置 `GAME_CATALOG_PATH`；这会使用单 ROM 而不读取多游戏目录。新版 Compose 模板不使用此兼容模式。
- **浏览器存档：**存档保留在原浏览器。在同一站点、浏览器、昵称、默认卡比游戏和相同 ROM SHA-256 下，旧存档可迁移到新版按游戏分隔的存档；升级后检查旧进度。如更换站点或设备、自动迁移未命中，使用升级前导出的 `.sav` 在正确游戏里手动导入。只改文件名不会改变 ROM 哈希。

## 5. 限额、验收与维护

| 配置 | 反代示例值 | 用途 |
| --- | ---: | --- |
| `MAX_CONNECTIONS` | 160 | Node 全局 TCP 连接数；含 HTTP 与升级连接 |
| `MAX_TCP_PER_IP` | 128 | 按 Node socket 对端 IP 的 TCP 并发数 |
| `MAX_WS_PER_IP` | 80 | 按 socket 对端 IP 的 WebSocket 并发数，不等于可承载玩家数 |
| `WS_READ_TIMEOUT_MS` | 5000 | 等待不完整 WebSocket 帧数据的超时（毫秒），不是对局时长 |
| `INPUT_DELAY_FRAMES` | 6 | 输入流水线帧数（1–12；公网默认 6，局域网默认 3）；可在 4–8 间权衡按键延迟与卡顿 |

Node 不信任客户端提供的 `X-Forwarded-For`；同一个 Caddy 后的用户通常合并为一个 socket IP。登录 POST 限额（同一个 socket IP 每分钟 5 次）与其他按 IP 的限频同样共享，不是每名玩家独立的配额；多人同时登录、重试或遭刷请求时可能暂时无法登录。勿通过透传/伪造 IP 抬额度；先限制入口受众或改用 VPN。ROM GET 另有独立的线性回填额度：每会话 10 次/分钟、每 socket IP 20 次/分钟、全局 40 次/分钟；HEAD 不消耗这组下载额度。Caddy 模板未安装额外的限流模块。它设置了请求头与请求体读超时，不给已升级的 WebSocket 设固定对局时长；代理重载、进程重启、网络中断或应用自身超时仍可能断线。

1. 在另一条网络（如手机蜂窝数据）访问自己的 HTTPS 域名，确认有效证书和页面，及 `/healthz` 匿名请求返回 `{"ok":true}`。后端直查时也要传固定 Host；Compose 的健康检查已处理。
2. 未登录时 `/api/info`、`/api/games`、`/api/games/kirby-amazing-mirror-cn/rom` 和兼容入口 `/game.gba` 应拒绝，匿名 `/ws` 不应成功升级；登录后在浏览器确认同源 WSS 成功及 Cookie 属性。注销后验证需要重新登录。不要把浏览器网络记录原样共享。
3. 以两个真实网络的浏览器进行创建、加入、实际游戏内通信、断线重进及存档导出；再试目标人数与设备。观察延迟、抖动、限额和容量，不因健康检查通过而判定联机完成。
4. 更新时先让玩家导出存档，备份部署配置与受保护的证书数据，再更新 Node/Caddy 补丁镜像；Compose 可先 `docker compose pull caddy`、`docker compose build --pull web`，再 `docker compose up -d` 并复验。更换密钥时重新创建 web 容器或重启 systemd unit，旧会话失效，房间丢失；如果通过替换文件操作更换 Docker secret，强制重建 web 以重新绑定。

本模板没有实际公网部署测试，也没有完成依赖/镜像安全扫描；这些是上线前检查项，不是已通过的验收结果。
