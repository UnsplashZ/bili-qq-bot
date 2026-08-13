#!/bin/bash

set -Eeuo pipefail

# Product contract:
# - Fresh directory: collect NapCat settings, generate config/config.yaml, and start containers.
# - Existing installation: preserve all deployment/config/data files and only pull/recreate containers.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BOT_IMAGE_DEFAULT='unsplash/bili-qq-bot:latest'
NAPCAT_IMAGE_DEFAULT='mlikiowa/napcat-docker:latest'
COMPOSE_FILE=''
SETUP_OPERATOR_UID=''
SETUP_OPERATOR_GID=''
SETUP_CONTAINER_UID=''
SETUP_CONTAINER_GID=''

info() {
    echo -e "${GREEN}$*${NC}"
}

warn() {
    echo -e "${YELLOW}$*${NC}"
}

die() {
    echo -e "${RED}错误: $*${NC}" >&2
    exit 1
}

prompt_default() {
    local prompt="$1"
    local default_value="$2"
    local value
    read -r -p "$prompt (默认: $default_value): " value
    printf '%s' "${value:-$default_value}"
}

prompt_required() {
    local prompt="$1"
    local value
    while true; do
        read -r -p "$prompt: " value
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return 0
        fi
        warn "该项不能为空。"
    done
}

validate_qq_number() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label 必须为纯数字。"
}

validate_port() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label 必须为 1-65535 的整数。"
    [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || die "$label 必须为 1-65535 的整数。"
}

validate_image_reference() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z0-9._/:@-]+$ ]] || die "Bot 镜像名称包含不支持的字符。"
}

validate_ws_token() {
    local value="$1"
    [[ "$value" =~ ^[A-Za-z0-9._~-]+$ ]] || die "NapCat WebSocket Token 仅支持字母、数字及 . _ ~ -。"
}

validate_ws_url() {
    local value="$1"
    [[ "$value" =~ ^wss?://[^[:space:]]+$ ]] || die "NapCat WebSocket 地址必须以 ws:// 或 wss:// 开头，且不能包含空白字符。"
}

resolve_setup_operator() {
    SETUP_OPERATOR_UID=$(id -u)
    SETUP_OPERATOR_GID=$(id -g)

    if [ "$EUID" -ne 0 ] || [ -z "${SUDO_USER:-}" ]; then
        return 0
    fi
    [[ "${SUDO_UID:-}" =~ ^[0-9]+$ ]] || die "无法识别 sudo 调用用户 UID。"
    [[ "${SUDO_GID:-}" =~ ^[0-9]+$ ]] || die "无法识别 sudo 调用用户 GID。"

    local resolved_uid resolved_gid
    resolved_uid=$(id -u "$SUDO_USER" 2>/dev/null) || die "无法识别 sudo 调用用户 $SUDO_USER。"
    resolved_gid=$(id -g "$SUDO_USER" 2>/dev/null) || die "无法识别 sudo 调用用户 $SUDO_USER。"
    [ "$resolved_uid" = "$SUDO_UID" ] || die "sudo 调用用户 UID 校验失败。"
    [ "$resolved_gid" = "$SUDO_GID" ] || die "sudo 调用用户 GID 校验失败。"

    SETUP_OPERATOR_UID="$resolved_uid"
    SETUP_OPERATOR_GID="$resolved_gid"
}

prepare_install_directories() {
    local install_dir="$1"
    local relative_path
    local -a managed_directories=(
        config
        data
        fonts/custom
        napcat/config
        napcat/qq
        logs
    )

    mkdir -p "${managed_directories[@]/#/$install_dir/}"
    for relative_path in "${managed_directories[@]}"; do
        chown "$SETUP_OPERATOR_UID:$SETUP_OPERATOR_GID" "$install_dir/$relative_path"
    done
    chmod 700 "$install_dir/config"
}

set_setup_operator_ownership() {
    chown "$SETUP_OPERATOR_UID:$SETUP_OPERATOR_GID" "$@"
}

read_numeric_ownership() {
    local target_path="$1"
    if stat -c '%u:%g' "$target_path" >/dev/null 2>&1; then
        stat -c '%u:%g' "$target_path"
    else
        stat -f '%u:%g' "$target_path"
    fi
}

prepare_container_bind_mounts() {
    local install_dir="$1"
    local bot_image="$2"
    local probe_dir probe_file probe_name ownership relative_path
    local -a managed_directories=(
        config
        data
        fonts/custom
        napcat/config
        napcat/qq
        logs
    )

    probe_dir=$(mktemp -d "$install_dir/.setup-bind-owner.XXXXXX")
    probe_name="owner-$(random_token)"
    probe_file="$probe_dir/$probe_name"
    set_setup_operator_ownership "$probe_dir"
    chmod 733 "$probe_dir"
    if ! printf '%s' "$probe_name" | docker run --rm -i \
        -v "$probe_dir:/setup-owner-probe" \
        --entrypoint node \
        "$bot_image" -e \
        'const fs = require("fs"); const name = fs.readFileSync(0, "utf8"); if (!/^owner-[a-f0-9]{32}$/.test(name)) process.exit(2); fs.writeFileSync(`/setup-owner-probe/${name}`, "", { mode: 0o600, flag: "wx" })'; then
        rmdir "$probe_dir" 2>/dev/null || true
        die "无法确认 Docker 容器对安装目录的写入身份。"
    fi

    if [ -L "$probe_file" ] || [ ! -f "$probe_file" ]; then
        rm -f "$probe_file"
        rmdir "$probe_dir" 2>/dev/null || true
        die "Docker 容器写入身份探测文件无效。"
    fi
    if ! ownership=$(read_numeric_ownership "$probe_file"); then
        rm -f "$probe_file"
        rmdir "$probe_dir" 2>/dev/null || true
        die "无法读取 Docker 容器写入身份。"
    fi
    SETUP_CONTAINER_UID=${ownership%%:*}
    SETUP_CONTAINER_GID=${ownership##*:}
    rm -f "$probe_file"
    rmdir "$probe_dir"
    [[ "$SETUP_CONTAINER_UID" =~ ^[0-9]+$ ]] || die "Docker 容器写入 UID 无效。"
    [[ "$SETUP_CONTAINER_GID" =~ ^[0-9]+$ ]] || die "Docker 容器写入 GID 无效。"

    for relative_path in "${managed_directories[@]}"; do
        chown "$SETUP_CONTAINER_UID:$SETUP_CONTAINER_GID" "$install_dir/$relative_path"
    done
    chmod 700 "$install_dir/config"
}

set_container_ownership() {
    chown "$SETUP_CONTAINER_UID:$SETUP_CONTAINER_GID" "$@"
}

random_token() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 16
    else
        od -An -N16 -tx1 /dev/urandom | tr -d ' \n'
    fi
}

download_with_fallback() {
    local output_file="$1"
    shift
    local url
    for url in "$@"; do
        if command -v curl >/dev/null 2>&1 && curl -fsSL "$url" -o "$output_file"; then
            return 0
        fi
        if command -v wget >/dev/null 2>&1 && wget -qO "$output_file" "$url"; then
            return 0
        fi
    done
    return 1
}

write_compose_template() {
    local output_file="$1"
    cat > "$output_file" <<'EOF'
services:
  napcat:
    image: ${BILI_NAPCAT_IMAGE:-mlikiowa/napcat-docker:latest}
    container_name: napcat
    restart: always
    init: true
    stop_grace_period: 30s
    ports:
      - "${BILI_NAPCAT_WEBUI_HOST_PORT:-6099}:6099"
      - "${BILI_NAPCAT_WS_HOST_PORT:-3001}:3001"
    environment:
      TZ: Asia/Shanghai
      WS_ENABLE: "true"
      HTTP_ENABLE: "true"
    volumes:
      - type: bind
        source: ./napcat/config
        target: /app/napcat/config
      - type: bind
        source: ./napcat/qq
        target: /app/.config/QQ
    networks:
      - bot_network

  bili-qq-bot:
    image: ${BILI_BOT_IMAGE:-unsplash/bili-qq-bot:latest}
    pull_policy: if_not_present
    container_name: bili-qq-bot
    restart: always
    init: true
    stop_grace_period: 420s
    depends_on:
      napcat:
        condition: service_started
    environment:
      TZ: Asia/Shanghai
    volumes:
      - type: bind
        source: ./config
        target: /app/config
      - type: bind
        source: ./data
        target: /app/data
      - type: bind
        source: ./logs
        target: /app/logs
      - type: bind
        source: ./fonts/custom
        target: /app/fonts/custom
      - type: bind
        source: ./napcat/qq
        target: /app/.config/QQ
    ports:
      - "${BILI_DASHBOARD_HOST_PORT:-3000}:3000"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:3000/api/live')
          .then(r=>{if(!r.ok)process.exit(1)})
          .catch(()=>process.exit(1))
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    networks:
      - bot_network

networks:
  bot_network:
    driver: bridge
EOF
}

compose() {
    local compose_args=()
    if [ -n "$COMPOSE_FILE" ]; then
        compose_args=(-f "$COMPOSE_FILE")
    fi
    if docker compose version >/dev/null 2>&1; then
        docker compose "${compose_args[@]}" "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "${compose_args[@]}" "$@"
    else
        die "未找到 Docker Compose。"
    fi
}

install_docker() {
    warn "未检测到 Docker。"
    command -v curl >/dev/null 2>&1 || die "自动安装 Docker 需要 curl。请先安装 curl 后重试。"
    echo "1) 国内镜像源"
    echo "2) Docker 官方源"
    local choice
    read -r -p "请选择安装源 [1/2]: " choice
    case "$choice" in
        1) bash <(curl -fsSL https://linuxmirrors.cn/docker.sh) ;;
        2) curl -fsSL https://get.docker.com/ | sh ;;
        *) die "无效选项。" ;;
    esac
    hash -r
    command -v docker >/dev/null 2>&1 || die "Docker 安装后仍不可用，请重新登录后再试。"
}

prepare_compose_file() {
    local script_dir="$1"
    local compose_file="$2"
    local overwrite='y'

    if [ -f "$compose_file" ]; then
        read -r -p "检测到 docker-compose.yml，是否使用最新版覆盖？[y/N]: " overwrite
    fi
    if [ -f "$compose_file" ] && [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
        warn "保留现有 docker-compose.yml。"
        return 0
    fi

    if [ -f "$script_dir/docker-compose.yml" ] && [ "$script_dir/docker-compose.yml" != "$compose_file" ]; then
        cp "$script_dir/docker-compose.yml" "$compose_file"
        return 0
    fi

    local temp_file
    temp_file=$(mktemp "${compose_file}.tmp.XXXXXX")
    write_compose_template "$temp_file"
    mv -f "$temp_file" "$compose_file"
}

find_compose_file() {
    local install_dir="$1"
    local name
    for name in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        if [ -f "$install_dir/$name" ]; then
            printf '%s' "$install_dir/$name"
            return 0
        fi
    done
    return 1
}

has_existing_config() {
    local install_dir="$1"
    [ -f "$install_dir/config/config.yaml" ] ||
    [ -f "$install_dir/config/config.json" ] ||
    [ -f "$install_dir/config/.env" ]
}

wait_for_bot_state() {
    local require_ready="$1"
    local timeout_seconds="${2:-180}"
    local poll_seconds="${BILI_SETUP_POLL_INTERVAL:-3}"
    local started container_id state
    started=$(date +%s)
    container_id=$(compose ps -q bili-qq-bot 2>/dev/null || true)
    [ -n "$container_id" ] || return 1

    while [ $(( $(date +%s) - started )) -lt "$timeout_seconds" ]; do
        state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
        case "$state" in
            healthy|running)
                if [ "$require_ready" != '1' ]; then
                    return 0
                fi
                if docker exec "$container_id" node -e \
                    "fetch('http://127.0.0.1:3000/api/ready').then(r => { if (!r.ok) process.exit(1); return r.json() }).then(body => { if (body.ready !== true) process.exit(1) }).catch(() => process.exit(1))" \
                    >/dev/null 2>&1; then
                    return 0
                fi
                ;;
            unhealthy|exited|dead|removing) return 1 ;;
        esac
        sleep "$poll_seconds"
    done
    return 1
}

update_existing_containers() {
    info "检测到已有安装，仅更新现有容器。"
    info "校验现有 Compose 配置"
    compose config -q

    echo "拉取部署镜像..."
    compose pull

    info "先启动 NapCat 并等待登录"
    compose up -d napcat
    warn "如尚未登录，请在 180 秒内完成 QQ 扫码；二维码可通过 docker logs -f napcat 查看。"
    if ! wait_for_napcat_login 180; then
        compose ps napcat || true
        die "NapCat 未在规定时间内完成登录，请执行 docker logs -f napcat 查看二维码后重试。"
    fi

    info "重建并启动全部容器"
    compose up -d
    if ! wait_for_bot_state 1 "${BILI_SETUP_READY_TIMEOUT:-180}"; then
        compose ps || true
        die "Bot 未在规定时间内进入 ready 状态，请检查 docker logs bili-qq-bot。"
    fi
    compose ps

    echo
    info "容器更新完成。现有配置和数据均已保留。"
}

write_compose_env() {
    local env_file="$1"
    local bot_image="$2"
    local dashboard_port="$3"
    cat > "$env_file" <<EOF
BILI_BOT_IMAGE=$bot_image
BILI_NAPCAT_IMAGE=$NAPCAT_IMAGE_DEFAULT
BILI_DASHBOARD_HOST_PORT=$dashboard_port
BILI_NAPCAT_WEBUI_HOST_PORT=6099
BILI_NAPCAT_WS_HOST_PORT=3001
EOF
    set_setup_operator_ownership "$env_file"
    chmod 600 "$env_file"
}

write_napcat_config() {
    local install_dir="$1"
    local bot_qq="$2"
    local ws_token="$3"
    cat > "$install_dir/napcat/config/onebot11_$bot_qq.json" <<EOF
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "enable": true,
        "name": "bot",
        "host": "0.0.0.0",
        "port": 3001,
        "reportSelfMessage": false,
        "enableForcePushEvent": true,
        "messagePostFormat": "array",
        "token": "$ws_token",
        "debug": false,
        "heartInterval": 30000
      }
    ],
    "websocketClients": [],
    "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
EOF
    set_container_ownership "$install_dir/napcat/config/onebot11_$bot_qq.json"
    chmod 600 "$install_dir/napcat/config/onebot11_$bot_qq.json"
}

generate_config_yaml() {
    local install_dir="$1"
    local bot_image="$2"
    local ws_url="$3"
    local ws_token="$4"
    local admin_qq="$5"
    local dashboard_port="$6"
    local dashboard_password="$7"
    local allowed_origins="$8"
    local agent_enabled="$9"
    local agent_base_url="${10}"
    local agent_model="${11}"
    local agent_api_key="${12}"

    docker run --rm \
        -e SETUP_WS_URL="$ws_url" \
        -e SETUP_WS_TOKEN="$ws_token" \
        -e SETUP_ADMIN_QQ="$admin_qq" \
        -e SETUP_DASHBOARD_PORT="$dashboard_port" \
        -e SETUP_DASHBOARD_PASSWORD="$dashboard_password" \
        -e SETUP_ALLOWED_ORIGINS="$allowed_origins" \
        -e SETUP_AGENT_ENABLED="$agent_enabled" \
        -e SETUP_AGENT_BASE_URL="$agent_base_url" \
        -e SETUP_AGENT_MODEL="$agent_model" \
        -e SETUP_AGENT_API_KEY="$agent_api_key" \
        -v "$install_dir:/install" \
        --entrypoint node \
        "$bot_image" -e '
const fs = require("fs")
const { run } = require("/app/src/cli/config")
const input = {
    provider: "napcat",
    rootAdminQQ: process.env.SETUP_ADMIN_QQ,
    wsUrl: process.env.SETUP_WS_URL,
    wsToken: process.env.SETUP_WS_TOKEN,
    dashboardPassword: process.env.SETUP_DASHBOARD_PASSWORD,
    env: {
        DASHBOARD_PORT: process.env.SETUP_DASHBOARD_PORT,
        DASHBOARD_ALLOWED_ORIGINS: process.env.SETUP_ALLOWED_ORIGINS,
        AGENT_LLM_ENABLED: process.env.SETUP_AGENT_ENABLED,
        AGENT_LLM_PROVIDER: "openai-compatible",
        AGENT_LLM_BASE_URL: process.env.SETUP_AGENT_BASE_URL,
        AGENT_LLM_MODEL: process.env.SETUP_AGENT_MODEL,
        AGENT_API_KEY: process.env.SETUP_AGENT_API_KEY
    }
}
fs.writeFileSync("/tmp/setup-config-input.json", `${JSON.stringify(input)}\n`, { mode: 0o600 })
Promise.resolve(run([
    "init", "--output", "/install/config/config.yaml",
    "--provider", "napcat", "--input", "/tmp/setup-config-input.json", "--force"
])).catch((error) => {
    console.error(error && (error.code || error.message) || error)
    process.exit(1)
})
'
    chmod 600 "$install_dir/config/config.yaml"
}

wait_for_napcat_login() {
    local timeout_seconds="${1:-180}"
    local poll_seconds="${BILI_SETUP_NAPCAT_POLL_INTERVAL:-3}"
    local started
    local qr_block last_qr_block=''
    started=$(date +%s)
    while [ $(( $(date +%s) - started )) -lt "$timeout_seconds" ]; do
        if docker exec napcat bash -lc 'exec 3<>/dev/tcp/127.0.0.1/3001' >/dev/null 2>&1; then
            info "NapCat 已登录，WebSocket 服务已就绪。"
            return 0
        fi
        qr_block=$(docker logs --tail 160 napcat 2>&1 | awk '
            index($0, "请扫描下面的二维码") {
                current = $0 ORS
                capturing = 1
                next
            }
            capturing {
                current = current $0 ORS
                if (index($0, "二维码已保存到")) {
                    latest = current
                    capturing = 0
                }
            }
            END { printf "%s", latest }
        ' || true)
        if [ -n "$qr_block" ] && [ "$qr_block" != "$last_qr_block" ]; then
            echo
            info "NapCat 登录二维码（请使用手机 QQ 扫描）："
            printf '%s\n' "$qr_block"
            last_qr_block="$qr_block"
        fi
        sleep "$poll_seconds"
    done
    return 1
}

main() {
    info "[1/8] 检测运行环境"
    if [ "${BILI_SETUP_TEST_MODE:-0}" != '1' ] && [ "$EUID" -ne 0 ]; then
        die "请使用 root 用户或 sudo 运行此脚本。"
    fi
    info "[2/8] 检测 Docker"
    command -v docker >/dev/null 2>&1 || install_docker
    docker info >/dev/null 2>&1 || die "Docker 服务不可用。"

    info "[3/8] 设置安装目录"
    local install_input install_dir script_dir
    read -r -p "请输入安装目录 (留空使用当前目录): " install_input
    install_dir="${install_input:-$(pwd)}"
    mkdir -p "$install_dir"
    install_dir=$(cd "$install_dir" && pwd)
    script_dir=$(cd "$(dirname "$0")" && pwd)
    cd "$install_dir"
    resolve_setup_operator

    local existing_compose=''
    if has_existing_config "$install_dir"; then
        existing_compose=$(find_compose_file "$install_dir" || true)
    fi
    if [ -n "$existing_compose" ]; then
        COMPOSE_FILE="$existing_compose"
        update_existing_containers
        return 0
    fi

    info "[4/8] 创建目录"
    prepare_install_directories "$install_dir"

    info "[5/8] 准备部署配置"
    local bot_image dashboard_port config_file overwrite_config
    bot_image=$(prompt_default "Bot 镜像" "$BOT_IMAGE_DEFAULT")
    dashboard_port=$(prompt_default "WebUI 宿主机端口" "3000")
    config_file="$install_dir/config/config.yaml"
    COMPOSE_FILE="$install_dir/docker-compose.yml"

    validate_image_reference "$bot_image"
    validate_port "WebUI 宿主机端口" "$dashboard_port"

    prepare_compose_file "$script_dir" "$install_dir/docker-compose.yml"
    write_compose_env "$install_dir/.env" "$bot_image" "$dashboard_port"

    echo "拉取部署镜像..."
    BILI_BOT_IMAGE="$bot_image" compose pull
    prepare_container_bind_mounts "$install_dir" "$bot_image"

    overwrite_config='y'
    if [ -f "$config_file" ]; then
        read -r -p "检测到 config/config.yaml，是否重新生成？[y/N]: " overwrite_config
    fi

    local dashboard_password=''
    if [ ! -f "$config_file" ] || [[ "$overwrite_config" =~ ^[Yy]$ ]]; then
        local bot_qq ws_token ws_url admin_qq allowed_origins
        local agent_enabled='false' agent_base_url='' agent_model='' agent_api_key=''
        bot_qq=$(prompt_required "请输入 Bot QQ 号")
        validate_qq_number "Bot QQ 号" "$bot_qq"
        read -r -p "请输入 NapCat WebSocket Token (留空自动生成): " ws_token
        ws_token="${ws_token:-$(random_token)}"
        validate_ws_token "$ws_token"
        ws_url=$(prompt_default "NapCat WebSocket 地址" "ws://napcat:3001")
        validate_ws_url "$ws_url"
        admin_qq=$(prompt_required "请输入管理员 QQ 号")
        validate_qq_number "管理员 QQ 号" "$admin_qq"
        dashboard_password=$(prompt_default "WebUI 面板密码" "admin")
        read -r -p "允许访问 WebUI 的公网 Origin (可留空): " allowed_origins

        read -r -p "是否配置 Agent LLM？[y/N]: " configure_agent
        if [[ "$configure_agent" =~ ^[Yy]$ ]]; then
            agent_enabled='true'
            agent_base_url=$(prompt_required "OpenAI-compatible Base URL")
            agent_model=$(prompt_required "模型名称")
            read -r -s -p "API Key: " agent_api_key
            echo
            [ -n "$agent_api_key" ] || die "API Key 不能为空。"
        fi

        write_napcat_config "$install_dir" "$bot_qq" "$ws_token"
        generate_config_yaml \
            "$install_dir" "$bot_image" "$ws_url" "$ws_token" "$admin_qq" \
            "$dashboard_port" "$dashboard_password" "$allowed_origins" \
            "$agent_enabled" "$agent_base_url" "$agent_model" "$agent_api_key"
        info "已生成新版 config/config.yaml。"
    else
        warn "保留现有 config/config.yaml。"
    fi

    info "[6/8] 校验 Compose"
    compose config -q

    info "[7/8] 启动 NapCat"
    compose up -d napcat

    info "[8/8] 等待 NapCat 登录"
    warn "请在 180 秒内完成 QQ 扫码登录；二维码可通过 docker logs -f napcat 查看。"
    if ! wait_for_napcat_login 180; then
        compose ps napcat || true
        die "NapCat 未在规定时间内完成登录，请执行 docker logs -f napcat 查看二维码后重试。"
    fi

    info "启动 Bot 服务"
    compose up -d bili-qq-bot
    if ! wait_for_bot_state 0 "${BILI_SETUP_LIVE_TIMEOUT:-180}"; then
        compose ps || true
        die "Bot 容器未在规定时间内进入健康状态，请检查 docker logs bili-qq-bot。"
    fi
    compose ps

    info "等待 Bot 完成最终 readiness 检查"
    if ! wait_for_bot_state 1 "${BILI_SETUP_READY_TIMEOUT:-180}"; then
        compose ps || true
        die "NapCat 或 Bot 未在规定时间内进入 ready 状态，请完成登录并检查 docker logs bili-qq-bot。"
    fi

    echo
    info "部署完成。"
    echo "WebUI: http://<服务器IP>:$dashboard_port"
    [ -z "$dashboard_password" ] || echo "面板密码: $dashboard_password"
    echo "Bot 日志: docker logs -f bili-qq-bot"
}

main "$@"
