#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

# --- MCP 配置逻辑 ---
MCP_EXAMPLE_URL="https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/config/mcp_servers.json.example"

download_mcp_example() {
    echo "正在从远程仓库下载 mcp_servers.json.example..."
    if command -v wget &> /dev/null; then
        wget -q -O "config/mcp_servers.json.example" "$MCP_EXAMPLE_URL"
    elif command -v curl &> /dev/null; then
        curl -s -L -o "config/mcp_servers.json.example" "$MCP_EXAMPLE_URL"
    else
        echo -e "${YELLOW}警告: 无法下载 mcp_servers.json.example，MCP 功能可能需要手动配置。${NC}"
        return 1
    fi
}

if [ ! -f "config/mcp_servers.json.example" ]; then
    if [ -f "$SCRIPT_SOURCE_DIR/config/mcp_servers.json.example" ]; then
        cp "$SCRIPT_SOURCE_DIR/config/mcp_servers.json.example" "config/mcp_servers.json.example"
        echo "已从本地模板复制 mcp_servers.json.example"
    else
        download_mcp_example
    fi
fi

if [ ! -f "config/mcp_servers.json" ] && [ -f "config/mcp_servers.json.example" ]; then
    cp "config/mcp_servers.json.example" "config/mcp_servers.json"
    echo "已生成默认 config/mcp_servers.json"
fi
# --- End MCP 配置逻辑 ---

# --- .env 配置逻辑 ---
ENV_EXAMPLE_URL="https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/config/.env.example"

# 下载函数 (.env.example)
download_env_example() {
    echo "正在下载 .env.example..."
    if command -v wget &> /dev/null; then
        wget -q -O "config/.env.example" "$ENV_EXAMPLE_URL"
    elif command -v curl &> /dev/null; then
        curl -s -L -o "config/.env.example" "$ENV_EXAMPLE_URL"
    else
        echo -e "${RED}错误: 未找到 wget 或 curl，无法下载配置文件。${NC}"
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
escaped_ws_url=$(echo "$ws_url" | sed 's/\//\\\//g')

if grep -q "^WS_URL=" config/.env; then
    sed -i "s/^WS_URL=.*/WS_URL=$escaped_ws_url/" config/.env
else
    echo "WS_URL=$ws_url" >> config/.env
fi

# 设置 WS_TOKEN
if grep -q "^WS_TOKEN=" config/.env; then
    sed -i "s/^WS_TOKEN=.*/WS_TOKEN=$ws_token/" config/.env
else
    echo "WS_TOKEN=$ws_token" >> config/.env
fi
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

if grep -q "^ADMIN_QQ=" config/.env; then
    sed -i "s/^ADMIN_QQ=.*/ADMIN_QQ=$admin_qq/" config/.env
else
    echo "ADMIN_QQ=$admin_qq" >> config/.env
fi

# --- WebUI 配置 ---
echo -e "${GREEN}[6.5/8] WebUI 与 AI 配置...${NC}"
read -p "请设置 WebUI 面板端口 (默认: 3000): " webui_port
webui_port=${webui_port:-3000}

read -p "请设置 WebUI 面板密码 (默认: admin): " dashboard_pwd
dashboard_pwd=${dashboard_pwd:-admin}

if grep -q "^DASHBOARD_PASSWORD=" config/.env; then
    sed -i "s/^DASHBOARD_PASSWORD=.*/DASHBOARD_PASSWORD=$dashboard_pwd/" config/.env
else
    echo "DASHBOARD_PASSWORD=$dashboard_pwd" >> config/.env
fi

# --- AI 配置 ---
read -p "是否启用 AI 功能 (OpenAI/DeepSeek 等)? [y/N] " enable_ai
if [[ "$enable_ai" =~ ^[Yy]$ ]]; then
    read -p "请输入 AI API 地址 (例如 https://api.openai.com/v1): " ai_url
    if [ -n "$ai_url" ]; then
        if grep -q "^AI_API_URL=" config/.env; then
            sed -i "s|^AI_API_URL=.*|AI_API_URL=$ai_url|" config/.env
        else
            echo "AI_API_URL=$ai_url" >> config/.env
        fi
    fi

    read -p "请输入 AI API Key: " ai_key
    if [ -n "$ai_key" ]; then
        if grep -q "^AI_API_KEY=" config/.env; then
            sed -i "s/^AI_API_KEY=.*/AI_API_KEY=$ai_key/" config/.env
        else
            echo "AI_API_KEY=$ai_key" >> config/.env
        fi
    fi

    read -p "请输入模型名称 (例如 gpt-3.5-turbo): " ai_model
    if [ -n "$ai_model" ]; then
        if grep -q "^AI_MODEL=" config/.env; then
            sed -i "s/^AI_MODEL=.*/AI_MODEL=$ai_model/" config/.env
        else
            echo "AI_MODEL=$ai_model" >> config/.env
        fi
    fi

    read -p "请输入 AI 代理地址 (可选): " ai_proxy
    if [ -n "$ai_proxy" ]; then
        if grep -q "^AI_PROXY_URL=" config/.env; then
            sed -i "s|^AI_PROXY_URL=.*|AI_PROXY_URL=$ai_proxy|" config/.env
        else
            echo "AI_PROXY_URL=$ai_proxy" >> config/.env
        fi
    fi

    read -p "是否启用 RAG (长期记忆)? [y/N] " enable_rag
    if [[ "$enable_rag" =~ ^[Yy]$ ]]; then
        read -p "请输入 Embedding API 地址: " embed_url
        if [ -n "$embed_url" ]; then
            if grep -q "^AI_EMBEDDING_API_URL=" config/.env; then
                sed -i "s|^AI_EMBEDDING_API_URL=.*|AI_EMBEDDING_API_URL=$embed_url|" config/.env
            else
                echo "AI_EMBEDDING_API_URL=$embed_url" >> config/.env
            fi
        fi

        read -p "请输入 Embedding API Key (留空同 AI Key): " embed_key
        if [ -z "$embed_key" ]; then
            embed_key="$ai_key"
        fi
        if [ -n "$embed_key" ]; then
            if grep -q "^AI_EMBEDDING_API_KEY=" config/.env; then
                sed -i "s/^AI_EMBEDDING_API_KEY=.*/AI_EMBEDDING_API_KEY=$embed_key/" config/.env
            else
                echo "AI_EMBEDDING_API_KEY=$embed_key" >> config/.env
            fi
        fi

        read -p "请输入 Embedding 模型 (例如 text-embedding-ada-002): " embed_model
        if [ -n "$embed_model" ]; then
            if grep -q "^AI_EMBEDDING_MODEL=" config/.env; then
                sed -i "s/^AI_EMBEDDING_MODEL=.*/AI_EMBEDDING_MODEL=$embed_model/" config/.env
            else
                echo "AI_EMBEDDING_MODEL=$embed_model" >> config/.env
            fi
        fi
    fi
fi

echo -e "${YELLOW}提示: 您可以稍后编辑 config/.env 修改 AI 配置等其他选项。${NC}"

# 7. 配置 docker-compose.yml
echo -e "${GREEN}[7/8] 准备 Docker Compose...${NC}"

COMPOSE_URL="https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/docker-compose.yml"
HAS_LOCAL_TEMPLATE=false

# 检查脚本所在目录是否有模板文件
if [ -f "$SCRIPT_SOURCE_DIR/docker-compose.yml" ]; then
    HAS_LOCAL_TEMPLATE=true
fi

# 下载函数
download_compose() {
    echo "正在从远程仓库下载 docker-compose.yml..."
    if command -v wget &> /dev/null; then
        wget -q -O "docker-compose.yml" "$COMPOSE_URL"
    elif command -v curl &> /dev/null; then
        curl -s -L -o "docker-compose.yml" "$COMPOSE_URL"
    else
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
    
    # 实时监控日志并等待登录成功
    # 使用 awk 打印日志并在匹配到成功信息时退出
    docker logs -f napcat 2>&1 | awk '
    {
        print $0
        fflush()
    }
    /Login Success|登录成功|Server Started|WebSocket Server] Server Started/ {
        print "\n\033[0;32m>>> 检测到登录成功或服务已就绪！ <<<\033[0m"
        exit 0
    }
    '
    
    echo "---------------------------------------------------"
    echo -e "${GREEN}部署全部完成！${NC}"
    echo "机器人服务已在后台运行。"
    echo -e "${YELLOW}提示: 如需启用 MCP (Model Context Protocol) 扩展能力，请参考 config/mcp_servers.json.example 进行配置。${NC}"
    echo "如需查看机器人日志: docker logs -f bili-qq-bot"
else
    echo -e "${RED}部署失败。${NC}"
fi
