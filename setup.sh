#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 通用下载函数：按顺序尝试多个 URL，任一成功即返回 0
download_with_fallback() {
    local output_file="$1"
    shift
    local urls=("$@")

    if command -v wget &> /dev/null; then
        for url in "${urls[@]}"; do
            if wget -q -O "$output_file" "$url"; then
                return 0
            fi
        done
    elif command -v curl &> /dev/null; then
        for url in "${urls[@]}"; do
            if curl -s -L -o "$output_file" "$url"; then
                return 0
            fi
        done
    else
        return 1
    fi

    return 1
}

# 安全更新/追加 .env 键值，避免 sed 替换时被特殊字符破坏
upsert_env_var() {
    local key="$1"
    local value="$2"
    local env_file="$3"
    local tmp_file

    tmp_file=$(mktemp)
    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        index($0, key "=") == 1 {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (!updated) {
                print key "=" value
            }
        }
    ' "$env_file" > "$tmp_file" && mv "$tmp_file" "$env_file"
}

# 监控 NapCat 日志，等待登录成功；超时返回 124
wait_for_napcat_login() {
    local timeout_seconds="$1"
    local monitor_pid
    local start_ts

    start_ts=$(date +%s)

    docker logs -f napcat 2>&1 | awk '
    BEGIN { matched = 0 }
    {
        print $0
        fflush()
    }
    /Login Success|登录成功|Server Started|WebSocket Server] Server Started/ {
        matched = 1
        print "\n\033[0;32m>>> 检测到登录成功或服务已就绪！ <<<\033[0m"
        exit 0
    }
    END {
        if (!matched) {
            exit 1
        }
    }
    ' &
    monitor_pid=$!

    while kill -0 "$monitor_pid" 2>/dev/null; do
        if [ $(( $(date +%s) - start_ts )) -ge "$timeout_seconds" ]; then
            kill "$monitor_pid" 2>/dev/null
            wait "$monitor_pid" 2>/dev/null
            return 124
        fi
        sleep 1
    done

    wait "$monitor_pid"
    return $?
}

# 1. 检测系统环境
echo -e "${GREEN}[1/8] 检测系统环境...${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}错误: 请使用 root 用户或 sudo 运行此脚本。${NC}"
  exit 1
fi

# 检测并安装必要依赖
check_and_install_dependencies() {
    local dependencies=("wget" "curl" "grep" "awk" "sed")
    local install_cmd=""
    local update_cmd=""
    
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case $ID in
            debian|ubuntu|kali)
                install_cmd="apt-get install -y"
                update_cmd="apt-get update"
                ;;
            centos|rhel|fedora)
                if command -v dnf &> /dev/null; then
                    install_cmd="dnf install -y"
                    update_cmd="dnf check-update"
                else
                    install_cmd="yum install -y"
                    update_cmd="yum check-update"
                fi
                ;;
            alpine)
                install_cmd="apk add --no-cache"
                update_cmd="apk update"
                ;;
            *)
                echo -e "${YELLOW}警告: 未知系统发行版 '$ID'，无法自动安装依赖。${NC}"
                return 1
                ;;
        esac
    else
        echo -e "${YELLOW}警告: 无法检测系统发行版，跳过依赖安装。${NC}"
        return 1
    fi

    for dep in "${dependencies[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            echo -e "${YELLOW}未找到 $dep，尝试自动安装...${NC}"
            if [ -z "$updated" ]; then
                echo "更新软件包列表..."
                $update_cmd
                updated=true
            fi
            
            if $install_cmd "$dep"; then
                echo -e "${GREEN}$dep 安装成功。${NC}"
            else
                echo -e "${RED}错误: $dep 安装失败，请手动安装。${NC}"
                exit 1
            fi
        else
            echo "$dep 已安装。"
        fi
    done
}

if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "系统: $NAME $VERSION"
else
    echo "系统: 未知"
fi

check_and_install_dependencies

# 2. 检测 Docker
echo -e "${GREEN}[2/8] 检测 Docker 安装状态...${NC}"

install_docker() {
    echo "未检测到 Docker。"
    echo "请选择安装源:"
    echo "1) 国内镜像源 (推荐): bash <(curl -sSL https://linuxmirrors.cn/docker.sh)"
    echo "2) 官方源: sudo wget -qO- https://get.docker.com/ | bash"
    read -p "请输入选项 [1/2]: " docker_choice
    
    case $docker_choice in
        1)
            bash <(curl -sSL https://linuxmirrors.cn/docker.sh)
            ;;
        2)
            wget -qO- https://get.docker.com/ | bash
            ;;
        *)
            echo "无效选项，退出。"
            exit 1
            ;;
    esac
}

if ! command -v docker &> /dev/null; then
    install_docker
    
    # 安装后刷新环境
    echo "正在刷新环境变量以识别 Docker..."
    hash -r
    
    # 尝试 source 常用环境配置
    [ -f /etc/profile ] && . /etc/profile
    [ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
    [ -f ~/.bashrc ] && . ~/.bashrc
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}错误: 安装 Docker 后仍无法识别 'docker' 命令。${NC}"
        echo -e "${YELLOW}可能需要重新登录 SSH 会话才能生效。${NC}"
        echo -e "${YELLOW}请重新登录后再次运行此脚本。${NC}"
        exit 1
    else
        echo -e "${GREEN}Docker 安装成功并已识别。${NC}"
        docker --version
    fi
else
    echo "Docker 已安装。"
    docker --version
fi


# 3. 设置安装目录
echo -e "${GREEN}[3/8] 设置安装目录...${NC}"
read -p "请输入安装目录 (留空则为当前目录): " install_dir
if [ -z "$install_dir" ]; then
    install_dir=$(pwd)
else
    # 创建并进入目录
    mkdir -p "$install_dir"
    install_dir=$(cd "$install_dir" && pwd)
    cd "$install_dir" || exit 1
fi
echo "当前工作目录: $install_dir"

# 4. 创建目录结构
echo -e "${GREEN}[4/8] 创建必要目录...${NC}"
mkdir -p config data fonts/custom napcat/config napcat/qq logs
echo "已创建: config, data, fonts/custom, napcat/config, napcat/qq, logs"
echo -e "${YELLOW}提示: 如需使用自定义字体，请将字体文件放入 fonts/custom 目录${NC}"

# 5. 配置 Bot QQ (NapCat 自动配置)
echo -e "${GREEN}[5/8] 配置 Bot QQ...${NC}"

while true; do
    read -p "请输入 Bot 的 QQ 号 (必填): " bot_qq
    if [ -n "$bot_qq" ]; then
        break
    else
        echo -e "${RED}错误: QQ 号不能为空。${NC}"
    fi
done

# 设置 WebSocket Token (NapCat 强制要求)
read -p "请设置 WebSocket Token (留空将自动生成随机 Token): " ws_token
if [ -z "$ws_token" ]; then
    if command -v openssl &> /dev/null; then
        ws_token=$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 10)
    else
        # Fallback for systems without openssl
        ws_token=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 10 | head -n 1)
    fi
    echo -e "${GREEN}已自动生成 Token: $ws_token${NC}"
else
    echo -e "${GREEN}已设置 Token: $ws_token${NC}"
fi

# 生成 NapCat 配置文件
echo "正在生成 NapCat 配置文件..."
cat > "napcat/config/onebot11_$bot_qq.json" <<EOF
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
echo "已创建 napcat/config/onebot11_$bot_qq.json"

# 6. 配置 .env
echo -e "${GREEN}[6/8] 生成配置文件...${NC}"

# 确保 config 目录存在
mkdir -p config

SCRIPT_SOURCE_DIR=$(dirname "$(readlink -f "$0")")

# --- .env 配置逻辑 ---
ENV_EXAMPLE_URLS=(
    "https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/config/.env.example"
    "https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/config/.env.example"
)

# 下载函数 (.env.example)
download_env_example() {
    echo "正在下载 .env.example..."
    if ! download_with_fallback "config/.env.example" "${ENV_EXAMPLE_URLS[@]}"; then
        echo -e "${RED}错误: 下载 .env.example 失败，请检查网络或稍后重试。${NC}"
        exit 1
    fi
}

# 逻辑核心：
# 1. 检查 config/.env 是否存在
# 2. 存在 -> 询问是否覆盖
#    - 覆盖 -> 下载/复制 .env.example -> 覆盖 config/.env -> 后续编辑
#    - 不覆盖 -> 直接在现有 config/.env 上进行后续编辑
# 3. 不存在 -> 下载/复制 .env.example -> 创建 config/.env -> 后续编辑

should_create_new=true

if [ -f "config/.env" ]; then
    read -p "检测到 config/.env 已存在，是否重新生成(覆盖)？[y/N] " overwrite_env
    if [[ "$overwrite_env" =~ ^[Yy]$ ]]; then
        echo "准备覆盖 .env..."
        should_create_new=true
    else
        echo "将使用现有 config/.env 进行配置..."
        should_create_new=false
    fi
fi

if [ "$should_create_new" = true ]; then
    # 优先使用本地模板
    if [ -f "$SCRIPT_SOURCE_DIR/config/.env.example" ]; then
        cp "$SCRIPT_SOURCE_DIR/config/.env.example" "config/.env"
        echo "已从本地模板生成 config/.env"
    else
        # 本地无模板，下载
        download_env_example
        if [ -f "config/.env.example" ]; then
            cp "config/.env.example" "config/.env"
            echo "已下载并生成 config/.env"
            # 清理下载的临时文件(可选，这里保留作为参考)
        else
            echo -e "${RED}错误: 下载 .env.example 失败，无法生成配置文件。${NC}"
            exit 1
        fi
    fi
fi

# 设置 WS_URL (默认为 Docker 内部网络地址)
read -p "请输入 NapCat WebSocket 地址 (默认: ws://napcat:3001): " ws_url
ws_url=${ws_url:-ws://napcat:3001}
upsert_env_var "WS_URL" "$ws_url" "config/.env"

# 设置 WS_TOKEN
upsert_env_var "WS_TOKEN" "$ws_token" "config/.env"
echo "已配置 WS_TOKEN"

# 设置管理员 QQ
while true; do
    read -p "请输入管理员 QQ 号 (必填): " admin_qq
    if [ -n "$admin_qq" ]; then
        break
    else
        echo -e "${RED}管理员 QQ 为必填项。${NC}"
    fi
done

upsert_env_var "ADMIN_QQ" "$admin_qq" "config/.env"

# --- WebUI 配置 ---
echo -e "${GREEN}[6.5/8] WebUI 管理面板配置...${NC}"
read -p "请设置 WebUI 面板端口 (默认: 3000): " webui_port
webui_port=${webui_port:-3000}

read -p "请设置 WebUI 面板密码 (默认: admin): " dashboard_pwd
dashboard_pwd=${dashboard_pwd:-admin}

upsert_env_var "DASHBOARD_PASSWORD" "$dashboard_pwd" "config/.env"

# --- 公网访问配置 ---
echo ""
echo -e "${YELLOW}公网部署配置 (仅在公网服务器部署时需要)：${NC}"
echo "说明："
echo "  - 本地访问 (localhost/127.0.0.1) 无需配置"
echo "  - 内网访问 (Tailscale/局域网) 无需配置"
echo "  - 公网访问需要配置允许的域名或IP地址"
echo ""
read -p "是否配置公网访问？[y/N]: " config_public_access

if [[ "$config_public_access" =~ ^[Yy]$ ]]; then
    read -p "请输入服务器IP或域名 (示例: https://bot.example.com 或 http://1.2.3.4:3000): " allowed_origins

    if [ -n "$allowed_origins" ]; then
        # 检查是否包含协议
        if [[ ! "$allowed_origins" =~ ^https?:// ]]; then
            echo -e "${YELLOW}警告: 检测到未包含协议 (http:// 或 https://)，将自动添加 http://${NC}"
            allowed_origins="http://$allowed_origins"
        fi

        # 如果指定了非标准端口，添加端口号
        if [ "$webui_port" != "3000" ] && [ "$webui_port" != "80" ] && [ "$webui_port" != "443" ]; then
            if [[ ! "$allowed_origins" =~ :[0-9]+$ ]]; then
                allowed_origins="$allowed_origins:$webui_port"
            fi
        fi

        upsert_env_var "DASHBOARD_ALLOWED_ORIGINS" "$allowed_origins" "config/.env"
        echo -e "${GREEN}已配置公网访问白名单: $allowed_origins${NC}"
    else
        echo -e "${YELLOW}未填写，将仅允许本地和内网访问${NC}"
    fi
else
    echo -e "${YELLOW}跳过公网配置，将仅允许本地和内网访问${NC}"
    # 确保配置文件中存在该字段（即使为空）
    if ! grep -q "^DASHBOARD_ALLOWED_ORIGINS=" config/.env; then
        echo "DASHBOARD_ALLOWED_ORIGINS=" >> config/.env
    fi
fi

echo ""
echo -e "${YELLOW}提示: 部署完成后，可通过 WebUI 面板 (http://<服务器IP>:$webui_port) 管理群组配置、订阅推送等。${NC}"

# 7. 配置 docker-compose.yml
echo -e "${GREEN}[7/8] 准备 Docker Compose...${NC}"

COMPOSE_URLS=(
    "https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/docker-compose.yml"
    "https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/docker-compose.yml"
)
HAS_LOCAL_TEMPLATE=false

# 检查脚本所在目录是否有模板文件
if [ -f "$SCRIPT_SOURCE_DIR/docker-compose.yml" ]; then
    HAS_LOCAL_TEMPLATE=true
fi

# 下载函数
download_compose() {
    echo "正在从远程仓库下载 docker-compose.yml..."
    if ! download_with_fallback "docker-compose.yml" "${COMPOSE_URLS[@]}"; then
        echo -e "${RED}错误: 无法下载 docker-compose.yml。${NC}"
        return 1
    fi
}

should_update_compose=true

if [ -f "docker-compose.yml" ]; then
    read -p "检测到 docker-compose.yml 已存在，是否重新生成(覆盖)？[y/N] " overwrite_compose
    if [[ "$overwrite_compose" =~ ^[Yy]$ ]]; then
        echo "准备覆盖 docker-compose.yml..."
        should_update_compose=true
    else
        echo "保留现有 docker-compose.yml"
        should_update_compose=false
    fi
fi

if [ "$should_update_compose" = true ]; then
    # 优先尝试使用本地模板覆盖
    if [ "$HAS_LOCAL_TEMPLATE" = true ] && [ ! "$SCRIPT_SOURCE_DIR/docker-compose.yml" -ef "docker-compose.yml" ]; then
        cp "$SCRIPT_SOURCE_DIR/docker-compose.yml" "docker-compose.yml"
        echo "已使用本地文件生成 docker-compose.yml"
    else
        download_compose
        if [ -f "docker-compose.yml" ]; then
             echo "已下载 docker-compose.yml"
        else
             echo -e "${RED}错误: 下载失败，缺少 docker-compose.yml 文件。${NC}"
             exit 1
        fi
    fi
fi

if [ ! -f "docker-compose.yml" ]; then
     echo -e "${RED}错误: 缺少 docker-compose.yml 文件。${NC}"
     exit 1
fi

# 更新 WebUI 端口
if [ "$webui_port" != "3000" ]; then
    echo "正在更新 docker-compose.yml 端口映射..."
    sed -i "s/- \"3000:3000\"/- \"$webui_port:3000\"/" docker-compose.yml
fi

# 8. 启动运行
echo -e "${GREEN}[8/8] 启动服务...${NC}"

if docker compose version &> /dev/null; then
    CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    CMD="docker-compose"
else
    echo -e "${RED}错误: 未找到 docker-compose。${NC}"
    exit 1
fi

echo "拉取镜像..."
$CMD pull

echo "启动容器..."
$CMD up -d

# 检查状态
if [ $? -eq 0 ]; then
    echo -e "${GREEN}服务启动成功！${NC}"
    $CMD ps
    
    echo -e "\n${YELLOW}=== 扫码登录 ===${NC}"
    echo "正在等待 NapCat 启动并生成二维码..."
    echo "请注意："
    echo "1. 下方将直接显示 NapCat 的实时日志（包含登录二维码）。"
    echo "2. 请使用手机 QQ 扫码登录。"
    echo "3. 登录成功后，脚本将自动完成并退出。"
    echo "---------------------------------------------------"
    
    # 实时监控日志并等待登录成功，超时则提示手动扫码后继续
    login_wait_timeout=180
    wait_for_napcat_login "$login_wait_timeout"
    login_wait_status=$?
    if [ "$login_wait_status" -ne 0 ]; then
        if [ "$login_wait_status" -eq 124 ]; then
            echo -e "\n${YELLOW}在 ${login_wait_timeout} 秒内未检测到登录成功。${NC}"
            echo "你可以稍后手动完成登录："
            echo "1. 执行: docker logs -f napcat"
            echo "2. 使用手机 QQ 扫描日志中的二维码完成登录"
            echo "3. 登录后执行: $CMD ps"
        else
            echo -e "\n${YELLOW}未能从日志确认登录状态（可能是日志中断或容器重启）。${NC}"
            echo "请手动查看登录日志: docker logs -f napcat"
        fi
    fi
    
    echo "---------------------------------------------------"
    echo -e "${GREEN}部署全部完成！${NC}"
    echo "机器人服务已在后台运行。"
    echo ""
    echo -e "${GREEN}WebUI 管理面板: http://<服务器IP>:$webui_port${NC}"
    echo -e "${GREEN}面板密码: $dashboard_pwd${NC}"
    echo ""
    echo "在 WebUI 中您可以:"
    echo "  - 管理群组配置 (启用/禁用、深色模式、标签等)"
    echo "  - 管理订阅推送 (UP 主动态、直播、番剧)"
    echo "  - 查看实时日志与系统状态"
    echo ""
    echo "如需查看机器人日志: docker logs -f bili-qq-bot"
else
    echo -e "${RED}部署失败。${NC}"
fi
