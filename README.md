# NapCat Bilibili & AI Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue)

基于 [NapCat](https://github.com/NapCat-Tools/NapCat-QQ) 框架开发的 Bilibili 全能助手 QQ 机器人。它不仅能智能识别并解析 B 站几乎所有类型的链接，还能为这些内容生成极具美感、布局紧凑的高清长预览卡片。同时，内置了基于 OpenAI 接口的 AI 智能聊天功能。

## ✨ 核心特性

*   🚀 **全类型解析**：精准识别并解析以下内容：
    *   **视频** (BV/av)
    *   **番剧** (ss/ep) - 支持显示评分、追番数、播放量
    *   **专栏文章** (cv) - 支持 2000 字长文摘要抓取
    *   **动态** (t.bilibili.com) - 完美支持长文动态、九宫格图片、转发动态
    *   **Opus 图文** (opus)
    *   **直播间** (live.bilibili.com)
    *   **小程序/短链** (b23.tv) - 自动还原 QQ 小程序分享链接
*   🖼️ **高颜值预览**：
    *   使用 Puppeteer 生成**苹果风格（苹方字体）**的长截图卡片。
    *   支持 **SVG 矢量图标**，无乱码，视觉统一。
    *   智能布局：自适应单图/多图，自动提取封面颜色背景，类型标签悬浮显示。
*   🤖 **智能 AI 对话**：
    *   支持自定义回复概率 (随机插话) 与 `@机器人` 触发。
    *   支持自定义系统提示词 (System Prompt) 设定人设。
*   📡 **订阅推送**：内置订阅系统，可实时追踪 UP 主动态与直播状态。
*   🐳 **Docker 化部署**：一键打包部署，内置 **Noto CJK (思源)** 与 **Emoji** 字体，完美解决 Linux 环境乱码问题。

## 📸 预览效果

_(在此处添加生成的预览图截图)_

## 🚀 快速开始 (Docker 推荐)

这是最简单、最稳定的部署方式，无需担心 Node/Python 版本或字体缺失问题。

### 1. 部署 NapCat
请先确保你已经部署并运行了 [NapCatQQ](https://github.com/NapCat-Tools/NapCat-QQ)，并开启了 **正向 WebSocket 服务** (默认端口 3001)。

### 2. 获取项目
```bash
git clone <repository_url>
cd napcat-qq-bot
```

### 3. 配置环境
复制并编辑配置文件：
```bash
cp .env.example .env
nano .env
```
确保 `.env` 中的 `WS_URL` 指向你的 NapCat 服务地址 (如 `ws://172.17.0.1:3001` 或宿主机 IP)。

### 4. 启动容器
```bash
docker-compose up -d --build
```

查看日志：
```bash
docker-compose logs -f
```

---

## 🛠️ 本地开发 (源码部署)

如果你想进行二次开发，可以在本地运行。

### 前置要求
*   **Node.js** (v18+)
*   **Python** (v3.8+)
*   **Chrome/Chromium** (Puppeteer 依赖)

### 安装步骤

1.  **安装依赖**
    ```bash
    # 自动创建 Python 虚拟环境并安装 npm 依赖
    chmod +x setup.sh
    ./setup.sh
    ```

2.  **启动**
    ```bash
    npm start
    ```

## 💬 指令列表

| 指令 | 说明 | 示例 |
| :--- | :--- | :--- |
| **链接/小程序** | 直接发送链接，Bot 自动回复预览卡片 | `https://www.bilibili.com/video/BV1xx...` |
| `/help` | 查看帮助菜单 | `/help` |
| `/login` | 获取 B 站登录二维码 (用于获取高清/会员数据) | `/login` |
| `/check <key>` | 扫码后验证登录状态 | `/check 8a7c...` |
| `/sub <uid> dynamic` | 订阅 UP 主动态 | `/sub 123456 dynamic` |
| `/sub <uid> live` | 订阅 UP 主直播 | `/sub 123456 live` |

## 📂 项目结构

*   `Dockerfile` / `docker-compose.yml`: Docker 部署配置。
*   `src/bot.js`: 程序入口，WebSocket 连接管理。
*   `src/handlers/`:
    *   `messageHandler.js`: 核心消息路由，正则匹配链接。
    *   `aiHandler.js`: AI 对话逻辑。
*   `src/services/`:
    *   `bili_service.py`: Python 中间件，调用 `bilibili-api-python` 库获取数据。
    *   `biliApi.js`: Node.js 与 Python 脚本的通信桥梁。
    *   `imageGenerator.js`: Puppeteer 绘图服务，HTML/CSS 模版所在。
    *   `subscriptionService.js`: 轮询监控服务。

## ⚠️ 免责声明

本工具仅用于学习交流，请勿用于非法用途。Bilibili 相关接口由 `bilibili-api-python` 提供，请遵守 B 站相关规定。