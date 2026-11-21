# 公网安全边界

**这是少量可信好友的私服，不是面向陌生人的公共大厅。** 首选 VPN/私有组网；必须公网时，应限定受众、设长随机口令并使用同源 HTTPS/WSS。模板提供风险缓解，不能保证防渗透、抗 DDoS 或无漏洞。部署方式见 [公网部署](<DEPLOYMENT.md>)。

## 认证不等于房间隔离

- 生产模式要求精确的 HTTPS Origin（协议、域名、端口一致），登录/注销和 WebSocket 握手有来源约束。`GET /api/session` 查询状态，`POST` 以共享站点口令登录，`DELETE` 注销；会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`，期限 12 小时。游戏列表（`/api/games`）、ROM（`/api/games/<id>/rom` 及兼容入口 `/game.gba`）、`/api/info` 和 `/ws` 受会话保护；`/healthz` 可匿名访问，仍需正确 Host，且受限额影响。安全属性依赖实际反代和浏览器配置。
- 所有人共用同一个站点口令，不是账号系统；不能区分使用者身份，也不能用这个共享口令对单个成员撤权。已登录成员仍可猜测六位房间码并进入其他有空位房间。限频只能缓解猜测，不能把房间码当强凭据。若扩大受众，建议另建高熵、可撤销的房间邀请或独立房间口令，再考虑账号与按房间授权。
- 当前确定性同步会把各座位的电池存档发给同房间成员；不应将成员视为互不信任的隔离租户。游戏输入与客户端也不是防作弊边界，不能承诺阻止已授权成员故意扰乱对局。
- 已授权浏览器收到完整 ROM，就必然能提取或复制；TLS、登录、缓存控制和哈希都不是 DRM。请自行确认有权上传及向他人提供 ROM；不要把 ROM 放进镜像、仓库或静态目录。

## 主要风险及操作建议

| 风险 | 该怎么做 |
| --- | --- |
| RCE 与运行时漏洞 | Node 的 HTTP/WebSocket 解析、消息处理和 Caddy TLS 都接收不可信数据；无需 npm 依赖并不代表没有远程代码执行风险。及时更新宿主、Docker、Node 与 Caddy；最小权限、只读代码与挂载、后端隔离只用于减小影响。不要挂载 Docker socket，也不要开放 Node Inspector。 |
| 路径遍历及文件泄露 | 应用静态资源限于指定目录；反代不启用项目目录 `file_server`。管理员从宿主维护游戏目录和 ROM；浏览器不能上传 ROM，下载路由按已启用游戏 ID 查找文件，不接受任意文件路径。ROM 相对路径必须解析在指定目录内；容器只读挂载不阻止宿主修改，仍须限制宿主目录写权限。不要把密钥放在 `public` 或额外映射项目根目录，不要向不可信进程开放后端。部署时验证敏感目录未被其他站点暴露。 |
| CSWSH / XSS | 保持精确 Origin 和会话检查；不做宽泛 CORS 或跨域 Cookie，不接入不可信脚本。Origin 是浏览器来源约束，不是客户端身份认证；XSS 可在同源环境代表用户发起请求，即使读不到 HttpOnly Cookie。修改页面、聊天渲染或反代后应重新审查输出编码和 CSP。 |
| DoS / DDoS | 请求、连接、消息限额与超时只能缓解部分应用层耗尽，不能应对链路洪泛。单 Caddy 后按 socket IP 的登录与连接限额由用户共享，可能被一个来源拖累。不要信任任意 `X-Forwarded-For`、`Forwarded`，或通过伪造/改写 IP 绕过限额。若需要更多防护，优先限制可访问来源，或评估支持 WSS 且可信的边缘防护，重新验证其受信边界。 |
| 密钥与日志 | 一站一条独立随机站点口令；使用权限 0600 的外部文件或受控密钥管理，绝不提交、写镜像层、写 URL、广播或记录口令和 Cookie。Compose 文件型 secret 不让宿主管理员失去访问能力，也不提供静态加密。勿启用未经脱敏的访问/调试日志或导出含凭据的 HAR；保留必要审计指标并限制日志访问。 |
| 主机与恢复 | 公网入站只开放 TCP 443/80（以及显式启用时的 HTTP/3 UDP 443）；TCP 22 仅限可信管理来源，使用 SSH key，避免密码/root 远程登录，规则同时核对云安全组和宿主防火墙。核查 Docker 发布端口的实际防火墙行为；不发布 8765。定期更新和检查备份恢复，证书卷含私钥须加密或限制访问，玩家自行备份电池存档。 |

合适的上线检查包括应用与基础镜像的漏洞扫描、安全配置审查、TLS/WSS 检查、实际公网连通性与容量验证。本次并未完成依赖/镜像扫描、渗透验证或真实公网测试，不能将本地验证视为上线安全保证。

## 官方资料

- [OWASP WebSocket Security Cheat Sheet](<https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html>)：WSS、Origin 校验、会话与消息级防护、限流和日志。
- [Caddy reverse_proxy](<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>)：WebSocket 升级、代理头、长流与重载。
- [Node.js Security Best Practices](<https://nodejs.org/en/learn/getting-started/security-best-practices>)：Node.js HTTP 服务的常见风险及缓解措施。
