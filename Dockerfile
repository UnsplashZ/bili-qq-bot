# 使用 Node.js 20 (Debian Bookworm) 作为基础镜像
# Slim 版本较小，但包含了运行 Puppeteer 所需的大部分系统库的基础
FROM docker.1ms.run/library/node:20-bookworm-slim

# 设置工作目录
WORKDIR /app

# 切换 apt 源为国内镜像
RUN set -eux; \
    rm -f /etc/apt/sources.list; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware' \
      'deb http://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware' \
      > /etc/apt/sources.list

# 1. 安装系统依赖
# - python3, python3-pip, python3-venv: 用于运行 B 站脚本
# - fonts-noto-cjk, fonts-noto-color-emoji: 用于 Puppeteer 截图中文和 Emoji (关键！)
# - chromium: 系统浏览器
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-symbola \
    chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. 安装字体 (Noto CJK 默认安装，MiSans 可选)
# 将 fonts 目录下的所有内容复制到字体目录
# 如果 fonts/mi 存在，会被复制到 /usr/share/fonts/truetype/mi
# 如果不存在，也不会报错
COPY fonts/ /usr/share/fonts/truetype/
RUN fc-cache -fv

# 4. 设置 Python 虚拟环境 (为了匹配源码中的 venv/bin/python 路径)
# 创建虚拟环境
RUN python3 -m venv /app/venv

# 复制 Python 依赖文件
COPY requirements.txt .

# 在虚拟环境中安装依赖
RUN /app/venv/bin/pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 6. 设置 Node.js 环境
# 复制 package.json 和 lock 文件
COPY package.json package-lock.json ./

# 设置 Puppeteer 环境变量
# 使用系统安装的 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm config set registry https://registry.npmmirror.com && npm ci

# 7. 复制项目源代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs temp && mkdir -p /root/napcat-data/QQ/NapCat/temp

# 暴露端口 (如果有 Web 服务的话，没有则不需要，这里保留以防万一)
# EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
