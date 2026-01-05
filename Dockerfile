# 使用 Node.js 20 (Debian Bookworm) 作为基础镜像
# Slim 版本较小，但包含了运行 Puppeteer 所需的大部分系统库的基础
FROM node:20-bookworm-slim

# 设置工作目录
WORKDIR /app

# 1. 安装系统依赖
# - python3, python3-pip, python3-venv: 用于运行 B 站脚本
# - fonts-noto-cjk, fonts-noto-color-emoji: 用于 Puppeteer 截图中文和 Emoji (关键！)
# - chromium 依赖库: Puppeteer 需要的库
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-symbola \
    wget \
    gnupg \
    libgconf-2-4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    libnss3-dev \
    libxss-dev \
    libasound2 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. 设置 Python 虚拟环境 (为了匹配源码中的 venv/bin/python 路径)
# 创建虚拟环境
RUN python3 -m venv /app/venv

# 复制 Python 依赖文件
COPY requirements.txt .

# 在虚拟环境中安装依赖
RUN /app/venv/bin/pip install --no-cache-dir -r requirements.txt

# 3. 设置 Node.js 环境
# 复制 package.json 和 lock 文件
COPY package.json package-lock.json ./

# 设置 Puppeteer 环境变量，跳过 Chromium 下载（如果使用系统 Chrome）或者让它下载
# 这里我们让 Puppeteer 自己下载 Chromium，因为上面的 apt 只是安装了运行库
# 设置 npm 镜像源加速下载
RUN npm config set registry https://registry.npmmirror.com && npm ci

# 4. 复制项目源代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs temp

# 暴露端口 (如果有 Web 服务的话，没有则不需要，这里保留以防万一)
# EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
