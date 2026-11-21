#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
STATE="$ROOT/deploy"
DOMAIN=''
ROM_SOURCE="$ROOT/data/roms"
TIMEOUT=180
PREPARE_ONLY=0
SKIP_HTTPS=0
usage() {
  cat <<'HELP'
用法：sudo bash deploy/deploy.sh --domain play.example.com [选项]
  --domain NAME        首次部署必填；重跑可读取已有 deploy/.env
  --rom-source DIR     补齐缺失 ROM 的源目录，默认 data/roms
  --timeout SECONDS    容器启动及 HTTPS 检查各自的超时，默认 180（30–1800）
  --prepare-only       只初始化部署文件，不构建或启动应用服务
  --skip-https-check   跳过外部 HTTPS 检查，仍检查容器健康
  -h, --help           显示帮助
前提：原生 Linux、rootful 本机 Docker Engine、Compose v2（支持 up --wait）、curl。
脚本不安装系统依赖，不改防火墙/DNS，不覆盖已有口令、目录配置或 ROM。
HELP
}
die() { printf '部署失败：%s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --domain|--rom-source|--timeout)
      (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || die "$1 缺少参数"
      case "$1" in --domain) DOMAIN="$2";; --rom-source) ROM_SOURCE="$2";; --timeout) TIMEOUT="$2";; esac
      shift 2;;
    --prepare-only) PREPARE_ONLY=1; shift;;
    --skip-https-check) SKIP_HTTPS=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "未知参数：$1（用 --help 查看帮助）";;
  esac
done
[[ "$TIMEOUT" =~ ^[0-9]{2,4}$ ]] && ((10#$TIMEOUT >= 30 && 10#$TIMEOUT <= 1800)) || die '--timeout 必须是 30–1800 的整数'
TIMEOUT=$((10#$TIMEOUT))
[[ "$(uname -s)" == Linux ]] || die '此脚本面向 Linux 服务器；Windows 本机请使用 启动联机.cmd'
((EUID == 0)) || die '请使用 sudo bash deploy/deploy.sh 执行（标准 rootful Docker 权限布局）'
for command in docker curl flock awk grep; do command -v "$command" >/dev/null || die "缺少 $command，请先按部署文档安装依赖"; done
[[ ! -L "$STATE" && -d "$STATE" ]] || die 'deploy 必须是普通目录'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die '请清除 DOCKER_HOST/DOCKER_CONTEXT，使用本机默认 Docker context'
ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
[[ "$ENDPOINT" == unix:///var/run/docker.sock ]] || die '仅支持本机 /var/run/docker.sock；远端/rootless/Desktop 请使用手工部署流程'
SECURITY="$(docker info --format '{{json .SecurityOptions}}')"
[[ "$SECURITY" != *rootless* && "$SECURITY" != *userns* ]] || die '检测到 rootless/userns-remap，请按实际 UID 映射手工配置'
docker compose version >/dev/null
docker compose up --help | grep -- '--wait-timeout' >/dev/null || die 'Compose 版本过旧，需要支持 up --wait/--wait-timeout'
if [[ -d "$ROM_SOURCE" ]]; then
  ROM_SOURCE="$(cd -- "$ROM_SOURCE" && pwd -P)"
elif [[ -d "$STATE/roms" ]]; then
  ROM_SOURCE="$STATE/roms"
else
  die "ROM 源目录不存在：$ROM_SOURCE"
fi
[[ "$ROOT" != *,* && "$ROM_SOURCE" != *,* ]] || die 'Docker 挂载路径不能包含逗号'
[[ ! -L "$STATE/.deploy.lock" ]] || die '拒绝符号链接锁文件'
exec 9>"$STATE/.deploy.lock"
flock -n 9 || die '另一个部署进程正在运行'
compose() {
  env -u SITE_DOMAIN -u MAX_CONNECTIONS -u MAX_TCP_PER_IP -u MAX_WS_PER_IP \
    -u WS_READ_TIMEOUT_MS -u INPUT_DELAY_FRAMES -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME \
    -u COMPOSE_PROFILES -u COMPOSE_ENV_FILES -u COMPOSE_DISABLE_ENV_FILE \
    docker compose --project-name gba-link-room --project-directory "$STATE" \
    --env-file "$STATE/.env" -f "$STATE/compose.yml" "$@"
}
trap 'status=$?; printf "部署在第 %s 行失败（退出码 %s）。已有配置保留；检查 web/caddy 日志，勿使用 down -v。\n" "$LINENO" "$status" >&2; exit "$status"' ERR
printf '1/5 拉取准备工具镜像并初始化部署文件……\n'
docker pull node:22-bookworm-slim
args=(--project /project --state /state --rom-source /rom-source)
[[ -z "$DOMAIN" ]] || args+=(--domain "$DOMAIN")
docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges:true \
  --user 0:0 --mount "type=bind,source=$ROOT,target=/project,readonly" \
  --mount "type=bind,source=$STATE,target=/state" \
  --mount "type=bind,source=$ROM_SOURCE,target=/rom-source,readonly" \
  node:22-bookworm-slim node /project/scripts/deploy-prepare.mjs "${args[@]}"
DOMAIN="$(awk -F= '$1 == "SITE_DOMAIN" {gsub(sprintf("%c", 13), "", $2); print $2}' "$STATE/.env")"
compose config --quiet
if ((PREPARE_ONLY)); then printf '文件准备完成。口令保存在 deploy/secrets/access-password.txt；未启动应用服务。\n'; exit 0; fi
printf '2/5 构建应用镜像并拉取 Caddy……\n'
compose build --pull web
compose pull caddy
printf '3/5 按应用用户校验口令、目录和全部启用 ROM……\n'
compose run --rm --no-deps web node --input-type=module -e '
import { loadConfig, configFromEnv } from "./src/server/config.mjs";
import { loadCatalog } from "./src/server/games.mjs";
await loadConfig(configFromEnv());
const catalog = await loadCatalog({ catalogPath: process.env.GAME_CATALOG_PATH, romDirectory: process.env.ROM_DIRECTORY });
console.log("应用权限与配置检查通过，游戏数：" + catalog.listing.games.length);'
compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
printf '4/5 启动服务并等待容器健康……\n'
# Rebind replaced file secrets so password changes take effect.
compose up -d --force-recreate --wait --wait-timeout "$TIMEOUT"
compose ps
printf '5/5 验证 HTTPS 入口……\n'
if ((SKIP_HTTPS)); then
  printf '已按参数跳过 HTTPS 验证；尚不能据此判定公网可访问。\n'
else
  deadline=$((SECONDS + TIMEOUT))
  ready=0
  while ((SECONDS < deadline)); do
    response=''
    if response="$(curl --proto '=https' --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 5 "https://$DOMAIN/healthz" 2>/dev/null)" && [[ "$response" == '{"ok":true}' ]]; then ready=1; break; fi
    sleep 3
  done
  ((ready)) || die '容器已启动，但 HTTPS 健康检查失败。检查 DNS、80/443、防火墙、AAAA 及 Caddy 日志；未关闭 TLS 校验。'
fi
printf '\n部署流程完成，入口：https://%s\n' "$DOMAIN"
printf '口令文件：%s/secrets/access-password.txt（未输出口令，请通过私密方式交付）\n' "$STATE"
printf '下一步：使用手机蜂窝网络验证登录、双人游戏内通信和存档导出。\n'
