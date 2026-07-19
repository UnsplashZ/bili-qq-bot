# 阶段1：安装后端 Node 生产依赖（仅保留运行所需包）
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# 跳过 Puppeteer 自带 Chromium 下载，统一使用系统 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true

# 仅拷贝依赖清单以利用 Docker 缓存
COPY package.json package-lock.json ./
# 安装生产依赖并清理 npm 缓存
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force


# 阶段2：构建 dashboard 前端静态资源
FROM node:22-bookworm-slim AS dashboard-builder

WORKDIR /app/dashboard

# 先安装 dashboard 依赖（加速二次构建）
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --no-audit --no-fund \
    && npm cache clean --force

COPY src/shared /app/src/shared
# 拷贝 dashboard 源码并执行生产构建（输出 dist）
COPY dashboard/ ./
RUN npm run build


# 阶段3：运行时镜像（只包含运行必需内容）
FROM node:22-bookworm-slim

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

## 安装运行期系统依赖：Python + Chromium + ffmpeg + 字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-color-emoji \
    fonts-symbola \
    chromium \
    ffmpeg \
    && rm -rf /usr/share/fonts/truetype/noto/NotoSerif*.ttf \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
    && fc-cache -fv

## 安装 Python 依赖（bilibili-api 服务使用）
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip3 install --no-cache-dir uv --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple \
    && rm -f requirements.txt

# 运行时环境变量：生产模式 + Puppeteer 浏览器路径
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

## 仅拷贝运行需要的文件：生产 node_modules、后端源码、配置模板、前端 dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# 创建运行期目录（日志/临时文件/下载目录/QQ 临时目录）
RUN mkdir -p logs temp config fonts data/downloads /app/.config/QQ/tmp/

# Dashboard 端口
EXPOSE 3000

# 启动入口
CMD ["node", "src/bot.js"]
