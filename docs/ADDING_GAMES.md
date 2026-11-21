# 添加自备 GBA 游戏

游戏目录由服务器管理员维护：放置自己有权提供的 ROM、编辑 JSON，然后重启服务。浏览器只能在已启用的游戏中选择，不能上传 ROM 或指定服务器文件路径；登录用户可以取得目录中提供的 ROM。详见 [安全边界](<SECURITY.md>)。

每个房间只运行一个游戏 ID、同一份 ROM（按 SHA-256 校验），支持模拟 GBA 通信线（`cable`）。不保证所有 GBA 游戏可联机，也不支持不同 ROM 版本或不同游戏互连、无线适配器联机、单卡多机下载（multiboot）。已测试卡比、用户ROM目录中8个输入所对应的核心运行与切换，以及自制SIO通信测试；这不代表已验证这些修改版的完整游戏内联机。单人配置可用 link:"none"，此时 players 必须仅为 [1]。逐ROM结果见 ROM_COMPATIBILITY.md。

## 批量导入本机ROM目录

当前工作站可先运行 node scripts/import-rom-directory.mjs ROM --dry-run 预览，再去掉 --dry-run 导入。工具通过头标识和已知配置登记当前用户ROM；单一GBA的ZIP会校验路径、大小和CRC后提取，源文件保持不变。写入配置前会运行完整目录校验。它不是HTTP上传接口，也不会下载游戏。未知标头只给出未验证的单人配置，不能自动推断联机。

## 1. 放置 ROM

| 运行方式 | 编辑的目录文件 | ROM 根目录 |
| --- | --- | --- |
| 本机 Node | `config/games.json` | `data/roms/` |
| Docker Compose | `deploy/games.json`（首次从项目默认目录复制） | `deploy/roms/` |
| systemd 模板 | `/opt/kirby-web/config/games.json` | `/srv/kirby-web/roms/` |

把你自己的普通 `.gba` 文件复制到对应的 ROM 根目录。不要把 ROM 放进 `public/`、镜像或源码仓库。文件必须可由服务用户读取，大小 1 字节至 32 MiB。配置中使用相对于 `ROM_DIRECTORY` 的路径；可使用普通子目录（如 `homebrew/demo.gba`），分隔符用 `/`，不能用绝对路径、URL、`..` 或指向目录外的链接。建议直接使用普通文件而非链接，便于审计和备份。

## 2. 编辑 JSON

在 `games` 数组中追加条目。以下是完整 JSON 示例，保留默认卡比条目，添加一个虚构游戏。只有把 `example-link-demo.gba` 替换为真实存在且有权提供的自备文件后，才可以启用这条示例；不准备文件时，为示例项添加 `"enabled": false`。

~~~json
{
  "version": 1,
  "defaultGameId": "kirby-amazing-mirror-cn",
  "games": [
    {
      "id": "kirby-amazing-mirror-cn",
      "title": "星之卡比 · 镜之迷宫（中文版）",
      "rom": "kirby-amazing-mirror-cn.gba",
      "players": [
        1,
        2,
        3,
        4
      ],
      "defaultPlayers": 2,
      "link": "cable",
      "compatibility": "core-tested",
      "description": "1–4 台 GBA 通信线联机。已通过核心启动与链路测试，完整游戏流程仍需人工验收。",
      "instructions": "每位玩家按 Start 进入游戏菜单，再按游戏内说明选择多人／通信模式。网页建房只连接模拟通信线，不会代替你操作菜单。",
      "labels": {
        "a": "A / 跳跃",
        "b": "B / 吸入"
      }
    },
    {
      "id": "example-link-demo",
      "title": "自备通信线游戏（虚构示例）",
      "rom": "example-link-demo.gba",
      "players": [
        1,
        2
      ],
      "defaultPlayers": 2,
      "link": "cable",
      "compatibility": "untested",
      "description": "给自备 ROM 使用的配置示例。请按实际验证结果更新。",
      "instructions": "每位玩家在游戏内进入通信线多人菜单，按游戏提示操作。",
      "labels": {
        "a": "A / 确认",
        "b": "B / 返回"
      }
    }
  ]
}
~~~

- `version` 固定为 `1`；`games` 最多 64 项（含停用项），JSON 最多 1 MiB。`defaultGameId` 必须指向已启用游戏。
- `id` 唯一且最好长期不变，使用小写英文字母、数字、连字符分隔的字段，最多 48 字符。`title` 是显示名，不是文件名。
- `players` 是可选人数的数组，元素为 1 至 4 的不重复整数；`defaultPlayers` 必须在数组中。示例人数仅用于演示，不代表自备游戏实际支持的人数。`labels`（例如 `a`、`b`）只改显示文字，不改模拟器按键映射。
- 新游戏先标 `untested`。`core-tested` 表示核心启动或通信链路已有测试，不代表实际游戏流程可玩。只有用实际 ROM 和声明的人数完成游戏内通信验证，才标 `verified`；换 ROM 版本后重新验证。
- `enabled: false` 可用于保留未安装模板；停用项不进行 ROM 加载、不出现在玩家列表，不可作为默认游戏。任何启用项缺少 ROM、无法读取或配置无效时，启动会失败。

## 3. 检查、重启并验收

在项目根目录用 Node.js 22+ 运行 `node scripts/catalog.mjs`（也可 `npm run games:check`，无需安装依赖），以默认路径检查。对 Compose 的宿主机目录，可运行：

~~~bash
node scripts/catalog.mjs --catalog ./deploy/games.json --rom-dir ./deploy/roms
~~~

也可通过 `GAME_CATALOG_PATH` 和 `ROM_DIRECTORY` 指定路径。脚本不启动监听，退出码为 0 只表明配置和 ROM 文件满足加载条件，不代表游戏兼容。它在源码树运行，不是生产镜像的一部分；宿主上运行成功也不代替容器或 systemd 用户的文件权限检查。

安排维护窗口并让玩家导出存档。直接运行 Node 时停止并重新启动；systemd 运行 `sudo systemctl restart kirby-web`；Compose 在 `deploy/` 运行 `docker compose up -d --no-deps --force-recreate web`。JSON 是文件级绑定，很多编辑器通过替换文件来保存，重建容器可重新绑定新文件。不要在对局中热替换 ROM：服务启动时计算 SHA-256，下载时检查文件是否被替换，并流式读取。重启会清空房间，会话也需要重新建立。

用至少两台设备或两个独立浏览器环境按实际支持的每种人数验收（如果允许单人，也测单人）。检查登录后的游戏列表、房间绑定的游戏、游戏内通信菜单、连续游玩、掉线后的重新开始，以及电池存档导出与导入。网页建房不会替玩家操作游戏内菜单。浏览器存档按游戏 ID 和 ROM SHA-256 隔离，同时受站点和昵称影响；改 ID 或换 ROM 后不要假定能复用旧档。

公网配置、迁移及联网验收见 [部署指南](<DEPLOYMENT.md>)。
