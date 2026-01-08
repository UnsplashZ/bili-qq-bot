# Stage 1: Builder
# 用于安装构建依赖和编译 Python/Node 模块
FROM docker.1ms.run/library/node:20-bookworm-slim AS builder

WORKDIR /app

# 切换 apt 源
RUN set -eux; \
    rm -f /etc/apt/sources.list; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware' \
      > /etc/apt/sources.list

# 安装构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 创建虚拟环境并安装 Python 依赖
COPY requirements.txt .
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 安装 Node 依赖
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci --omit=dev

# Stage 2: Final Image
# 最终运行镜像，只包含运行时所需文件
FROM docker.1ms.run/library/node:20-bookworm-slim

# 设置工作目录
WORKDIR /app

# 切换 apt 源
RUN set -eux; \
    rm -f /etc/apt/sources.list; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware' \
      > /etc/apt/sources.list

# 1. 安装运行时系统依赖
# - python3: 运行 Python 脚本
# - fonts-noto-cjk, fonts-noto-color-emoji: 中文和 Emoji 支持
# - chromium: 系统浏览器
# - dumb-init: 进程管理器
# 使用 --no-install-recommends 避免安装非必须依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-symbola \
    chromium \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 安装字体
COPY fonts/ /usr/share/fonts/truetype/
RUN fc-cache -fv

# 4. 复制构建好的环境
COPY --from=builder /app/venv /app/venv
COPY --from=builder /app/node_modules ./node_modules

# 6. 设置环境变量
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

# 7. 复制项目源代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs temp && mkdir -p /root/napcat-data/QQ/NapCat/temp

# 使用 dumb-init 作为入口点
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# 启动命令
CMD ["npm", "start"]
