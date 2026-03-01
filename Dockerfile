# 使用 Node.js 20 (Debian Bookworm) 作为基础镜像
# Slim 版本较小，但包含了运行 Puppeteer 所需的大部分系统库的基础
FROM node:22-bookworm-slim

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
# - python3, python3-pip: 用于运行 B 站脚本
# - fonts-noto-cjk, fonts-noto-core, fonts-noto-color-emoji: 用于 Puppeteer 截图中文、多语种与 Emoji (关键！)
# - chromium: 系统浏览器
# - ffmpeg: 用于合并 DASH 视频/音频流（视频下载功能）
# - --no-install-recommends: 不安装推荐包，减少体积
# - autoremove + clean: 清理无用包和缓存
# - rm doc/man: 删除文档和手册页
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-symbola \
    chromium \
    ffmpeg \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && fc-cache -fv

# 3. 安装字体 (支持自定义字体热更新)
# 将 fonts 目录下的所有内容复制到字体目录
COPY fonts/ /usr/share/fonts/truetype/
# 保留 NotoSans* 字体以覆盖 Sinhala 等跨脚本字符（如：ෆ）
RUN rm -rf /usr/share/fonts/truetype/noto/NotoSerif*.ttf \
    && fc-cache -fv

# 4. 安装 Python 依赖 (全局安装)
COPY requirements.txt .
# Debian Bookworm 默认禁止全局 pip，需添加 --break-system-packages
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip3 install --no-cache-dir uv --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple

# 6. 设置 Node.js 环境
# 复制 package.json 和 lock 文件
COPY package.json package-lock.json ./

# 设置 Puppeteer 环境变量
# 使用系统安装的 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm config set registry https://registry.npmmirror.com && npm ci \
    && npm cache clean --force

# 6.5. 预先安装 dashboard 依赖 (利用 Docker 缓存)
# 创建 dashboard 目录并复制依赖定义文件
RUN mkdir -p dashboard
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
# 安装依赖 (使用 npm ci 以确保一致性)
RUN cd dashboard && npm config set registry https://registry.npmmirror.com && npm ci

# 7. 先复制并构建 dashboard (仅在 dashboard 变更时触发)
COPY dashboard/ ./dashboard/
RUN cd dashboard && npm run build

# 8. 再复制项目其余源代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs temp config fonts data/downloads && mkdir -p /app/.config/QQ/tmp/

# 暴露端口 (如果有 Web 服务的话，没有则不需要，这里保留以防万一)
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
