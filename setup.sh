#!/bin/bash

set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BOT_IMAGE_DEFAULT='unsplash/bili-qq-bot:latest'
NAPCAT_IMAGE_DEFAULT='mlikiowa/napcat-docker:latest'

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

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        die "未找到 Docker Compose。"
    fi
}

install_docker() {
    warn "未检测到 Docker。"
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

    download_with_fallback "$compose_file" \
        "https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/docker-compose.yml" \
        "https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/docker-compose.yml" || \
        die "下载 docker-compose.yml 失败。"
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
    local started
    started=$(date +%s)
    while [ $(( $(date +%s) - started )) -lt "$timeout_seconds" ]; do
        if docker logs napcat 2>&1 | grep -Eq 'Login Success|登录成功|Server Started|WebSocket Server.*Started'; then
            info "NapCat 已登录或服务已就绪。"
            return 0
        fi
        sleep 3
    done
    return 1
}

main() {
    info "[1/8] 检测运行环境"
    if [ "${BILI_SETUP_TEST_MODE:-0}" != '1' ] && [ "$EUID" -ne 0 ]; then
        die "请使用 root 用户或 sudo 运行此脚本。"
    fi
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || \
        die "需要 curl 或 wget。"

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

    info "[4/8] 创建目录"
    mkdir -p config data fonts/custom napcat/config napcat/qq logs

    info "[5/8] 准备部署配置"
    local bot_image dashboard_port config_file overwrite_config
    bot_image=$(prompt_default "Bot 镜像" "$BOT_IMAGE_DEFAULT")
    dashboard_port=$(prompt_default "WebUI 宿主机端口" "3000")
    config_file="$install_dir/config/config.yaml"

    prepare_compose_file "$script_dir" "$install_dir/docker-compose.yml"
    write_compose_env "$install_dir/.env" "$bot_image" "$dashboard_port"

    echo "拉取部署镜像..."
    BILI_BOT_IMAGE="$bot_image" compose pull

    overwrite_config='y'
    if [ -f "$config_file" ]; then
        read -r -p "检测到 config/config.yaml，是否重新生成？[y/N]: " overwrite_config
    fi

    local dashboard_password=''
    if [ ! -f "$config_file" ] || [[ "$overwrite_config" =~ ^[Yy]$ ]]; then
        local bot_qq ws_token ws_url admin_qq allowed_origins
        local agent_enabled='false' agent_base_url='' agent_model='' agent_api_key=''
        bot_qq=$(prompt_required "请输入 Bot QQ 号")
        read -r -p "请输入 NapCat WebSocket Token (留空自动生成): " ws_token
        ws_token="${ws_token:-$(random_token)}"
        ws_url=$(prompt_default "NapCat WebSocket 地址" "ws://napcat:3001")
        admin_qq=$(prompt_required "请输入管理员 QQ 号")
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

    info "[7/8] 启动服务"
    compose up -d
    compose ps

    info "[8/8] 等待 NapCat 登录"
    if ! wait_for_napcat_login 180; then
        warn "暂未检测到登录成功，请执行 docker logs -f napcat 查看二维码。"
    fi

    echo
    info "部署完成。"
    echo "WebUI: http://<服务器IP>:$dashboard_port"
    [ -z "$dashboard_password" ] || echo "面板密码: $dashboard_password"
    echo "Bot 日志: docker logs -f bili-qq-bot"
}

main "$@"
