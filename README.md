# Bili QQ Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![Python](https://img.shields.io/badge/python-%3E%3D3.8-yellow)

基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 框架开发的Bilibili链接解析机器人。它能智能识别并解析B站各种类型的链接，并为这些内容生成高清预览卡片。

## 目录

- [✨ 核心特性](#核心特性)
- [📸 预览效果](#预览效果)
- [🚀 一键快速部署](#一键快速部署)
- [⚙️ 配置说明](#配置说明)
- [💬 指令列表](#指令列表)
- [🖥️ WebUI 管理后台](#webui-管理后台)
- [🛠️ 其他部署方式](#其他部署方式)
- [📂 项目结构](#项目结构)
- [📝 待办计划](#待办计划-roadmap)
- [❓ 常见问题](#常见问题-faq)
- [🙏 致谢](#致谢-acknowledgments)
- [⚠️ 免责声明](#免责声明)

---

## 核心特性

*   🚀 **全类型解析**：精准识别并解析以下内容
    *   视频 (BV/av)、番剧 (ss/ep)、直播间 (live)
    *   专栏文章 (cv) - 支持 2000 字长文摘要，保留富文本格式与插图
    *   动态 (t.bilibili.com) - 支持长文、多图、转发动态，完美还原装扮卡片与粉丝编号
    *   用户主页 (space) - 展示用户数据，自动抓取并展示最新一条动态
    *   Opus 图文 (opus) - 支持富文本解析，完美还原图文混排
    *   小程序/短链 (b23.tv) - 自动还原目标链接

*   🎨 **高颜值预览**
    *   使用 Puppeteer 生成精美长截图卡片（默认 MiSans 字体）
    *   统一设计系统：支持定时深色模式，毛玻璃视觉风格
    *   智能配色：自动提取装扮卡片重点色，动态调整氛围背景
    *   SVG 矢量图标 & Emoji，无乱码，视觉统一

*   🤖 **智能 AI 对话**
    *   群组记忆 (RAG)：内置向量记忆系统，支持长期记忆与语义检索
    *   智能记忆管理：自动去重、重要性评分、智能保留策略、上下文和时间感知
    *   MCP支持：通过简单的配置文件，即可让Bot调用其他工具
    *   支持概率回复和 `@机器人` 触发

*   📡 **订阅推送**：内置订阅系统，支持分群订阅与同步关注分组，实时追踪 UP 主动态、直播、番剧更新

*   🖥️ **WebUI 管理后台**：提供可视化管理界面，轻松管理群组权限和订阅
    *   群组管理：启用/禁用群组、管理员列表、黑名单管理
    *   订阅管理：查看、添加、删除 UP 主和番剧订阅，带头像和封面预览
    *   HTTP Basic Auth 认证，支持内网访问或 SSH 隧道访问
    *   现代化 UI 设计，Bilibili 蓝配色，响应式布局

*   🐳 **Docker 化部署**：一键部署，内置 MiSans、思源与 Emoji 字体

## 预览效果

### ☀️ 浅色模式

<table align="center">
  <tr>
    <td align="center"><img src="docs/images/帮助菜单-浅色模式.webp" height="400" /><br /><b>帮助菜单</b></td>
    <td align="center"><img src="docs/images/管理菜单-浅色模式.webp" height="400" /><br /><b>管理菜单</b></td>
    <td align="center"><img src="docs/images/AI帮助菜单-浅色模式.png" height="400" /><br /><b>AI功能菜单</b></td>
  </tr>
</table>

<details>
<summary><b>展开查看更多功能预览（视频、动态、用户主页...）</b></summary>
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/用户卡片-浅色模式.png" height="300" /><br /><b>用户主页</b></td>
    <td align="center"><img src="docs/images/直播-浅色模式.png" height="300" /><br /><b>直播间</b></td>
    <td align="center"><img src="docs/images/动态-浅色模式.png" height="300" /><br /><b>常规动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/视频动态-浅色模式.png" height="300" /><br /><b>视频动态</b></td>
    <td align="center"><img src="docs/images/视频-浅色模式.png" height="300" /><br /><b>视频解析</b></td>
    <td align="center"><img src="docs/images/转发动态-浅色模式.png" height="300" /><br /><b>转发动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/Opus专栏-浅色模式.png" height="300" /><br /><b>Opus专栏</b></td>
    <td align="center"><img src="docs/images/番剧-浅色模式.png" height="300" /><br /><b>番剧信息</b></td>
    <td align="center"><img src="docs/images/电影-浅色模式.png" height="300" /><br /><b>电影信息</b></td>
  </tr>
</table>
</details>

### 🌙 深色模式
#### *预览图关闭了左上角标签功能*
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/帮助菜单-深色模式.webp" height="400" /><br /><b>帮助菜单</b></td>
    <td align="center"><img src="docs/images/管理菜单-深色模式.webp" height="400" /><br /><b>管理菜单</b></td>
    <td align="center"><img src="docs/images/AI帮助菜单-深色模式.png" height="400" /><br /><b>AI功能菜单</b></td>
  </tr>
</table>

<details>
<summary><b>展开查看更多功能预览（视频、动态、用户主页...）</b></summary>
<table align="center">
  <tr>
    <td align="center"><img src="docs/images/用户卡片-深色模式.png" height="300" /><br /><b>用户主页</b></td>
    <td align="center"><img src="docs/images/直播-深色模式.png" height="300" /><br /><b>直播间</b></td>
    <td align="center"><img src="docs/images/动态-深色模式.png" height="300" /><br /><b>常规动态</b></td>
    
  </tr>
  <tr>
    <td align="center"><img src="docs/images/视频动态-深色模式.png" height="300" /><br /><b>视频动态</b></td>
    <td align="center"><img src="docs/images/视频-深色模式.png" height="300" /><br /><b>视频解析</b></td>
    <td align="center"><img src="docs/images/转发动态-深色模式.png" height="300" /><br /><b>转发动态</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/Opus专栏-深色模式.png" height="300" /><br /><b>Opus专栏</b></td>
    <td align="center"><img src="docs/images/番剧-深色模式.png" height="300" /><br /><b>番剧信息</b></td>
    <td align="center"><img src="docs/images/电影-深色模式.png" height="300" /><br /><b>电影信息</b></td>
    
  </tr>
</table>
</details>

## 一键快速部署

运行下方命令，脚本将自动检测环境、安装 Docker、配置 NapCat 并启动所有服务。
*[点我跳转到视频教程](https://www.bilibili.com/video/BV1YsrEBVEs6/ "bilibili")*

```bash
#从Github下载
wget -O setup.sh https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh

#从代理下载
wget -O setup.sh https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh
```

**部署流程：**
1.  **环境检查**：自动安装 docker 等必要依赖。
2.  **配置引导**：脚本会引导您输入 Bot QQ 号，自动生成 NapCat 配置。
3.  **服务启动**：自动拉取镜像并启动容器。
4.  **扫码登录**：直接在终端显示 NapCat 日志和二维码，扫码即可完成登录。

如需使用AI功能、接入MCP或修改高级配置，请在部署完成后编辑 `config/.env` 文件（参考 [配置说明](#配置说明)），然后重启容器。

## 配置说明

本项目采用双重配置系统：`.env` 用于启动/敏感信息，`config.json` 用于运行时动态配置。

<details>
<summary><b>展开查看具体配置</b></summary>

### 1. 基础配置 (.env)
复制 `.env.example` 为 `.env`，填入 WebSocket 连接与 AI 密钥等启动参数：

| 变量名 | 说明 | 示例 / 默认值 |
| :--- | :--- | :--- |
| `WS_URL` | NapCat 的 WebSocket 地址 | `ws://napcat:3001` (Docker) / `ws://localhost:3001` (本地) |
| `WS_TOKEN` | WebSocket 连接 Token (可选，留空则不启用身份验证) | 需与 NapCat 配置一致 |
| `NAPCAT_TEMP_PATH` | 机器人写入图片的临时路径 | `/app/.config/QQ/tmp/` |
| `NAPCAT_READ_PATH` | NapCat 读取图片的路径 (需与上条映射到同一物理路径) | `/app/.config/QQ/tmp/` |
| `AI_API_URL` | AI 接口地址 (OpenAI 兼容) | `https://api.openai.com/v1/chat/completions` |
| `AI_API_KEY` | AI 接口密钥 | `sk-xxxxxxxx` |
| `AI_MODEL` | 使用的模型名称 | `gpt-3.5-turbo` |
| `AI_PROBABILITY` | AI 随机插话概率 (0-1) | `0.1` |
| `AI_SYSTEM_PROMPT` | AI 人设提示词 | `你是一个可爱的猫娘...` |
| `AI_EMBEDDING_API_URL` | 向量嵌入接口地址 (用于记忆) | `https://api.openai.com/v1/embeddings` |
| `AI_EMBEDDING_API_KEY` | 向量嵌入密钥 (留空则同上) | `sk-xxxxxxxx` |
| `AI_EMBEDDING_MODEL` | 向量嵌入模型名称 | `text-embedding-3-small` |
| `AI_CHAT_PROXY` | AI 聊天接口代理地址 (可选) | `http://127.0.0.1:7890` |
| `AI_EMBEDDING_PROXY` | AI 嵌入接口代理地址 (可选) | `http://127.0.0.1:7890` |
| `PYTHON_PATH` | Python 解释器路径 (本地开发用，Docker 默认无需配置) | `venv/bin/python` |
| `PUPPETEER_EXECUTABLE_PATH` | Puppeteer Chrome 可执行文件路径 (本地开发用，可选) | 留空自动检测 |
| `ADMIN_QQ` | 管理员 QQ 号 (用于特权指令) | `123456789` |
| `WEBUI_ENABLED` | 是否启用 WebUI 管理后台 | `true` |
| `WEBUI_PORT` | WebUI 监听端口 | `3100` |
| `WEBUI_HOST` | WebUI 监听地址 (127.0.0.1 = 仅本地，0.0.0.0 = 所有IP) | `127.0.0.1` |
| `WEBUI_USERNAME` | WebUI 登录用户名 | `root` |
| `WEBUI_PASSWORD` | WebUI 登录密码 (**必须设置，否则认证将被禁用**) | 留空则禁用认证 |
| `USE_BASE64_SEND` | 是否使用 Base64 发送图片 | `false` |
| `DATA_CACHE_TTL` | 数据缓存过期时间 (秒) | `3600` (1小时) |

### 2. 动态配置 (config.json)
这些配置随bot运行自动创建，支持热更新（通过 `/设置` 和 `/AI` 相关指令），无需手动修改：

| 字段名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `aiContextLimit` | AI 上下文保留条数 (发送给 API 的消息数) | `10` |
| `aiHistoryMaxSize` | AI 历史对话文件大小限制 (字节) | `209715200` (200MB) |
| `aiVectorMaxSize` | AI 向量记忆文件大小限制 (字节) | `209715200` (200MB) |
| `aiVectorMemoryLimit` | 内存中向量记忆条数上限 (防止内存溢出) | `10000` |
| `aiVectorSimilarityThreshold` | 向量搜索相似度阈值 (0-1，越高越严格) | `0.4` |
| `aiVectorSearchLimit` | 返回的相关记忆数量 | `3` |
| `aiShortMessageThreshold` | 短消息过滤阈值 (字符数) | `5` |
| `aiMemorySafetyLimit` | 内存中消息安全上限 (防止内存溢出) | `5000` |
| `aiTrimRatio` | 文件修剪比例 (0-1) | `0.1` (10%) |
| `aiVectorBatchLoadSize` | 向量批量加载大小 (预留) | `1000` |
| `aiEnableVectorCache` | 启用向量搜索缓存 | `true` |
| `aiEnableSmartTrim` | 启用智能记忆保留策略 | `true` |
| `blacklistedQQs` | 黑名单 QQ 列表 | `[]` |
| `enabledGroups` | 允许响应的群组 (空为全部) | `[]` |
| `linkCacheTimeout` | 链接解析缓存时间 (秒) | `600` |
| `subscriptionCheckInterval` | 订阅轮询间隔 (秒) | `60` |
| `nightMode` | 深色模式配置 | `{"mode": "off", ...}` |
| `labelConfig` | 标签显示配置 | `{"video": true, ...}` |
| `showId` | 是否在卡片中显示 UID | `true` |
| `groupConfigs` | 群级配置覆盖 (每个群可独立配置) | `{}` |
</details>

## 指令列表

所有指令均以 `/` 开头，部分指令仅限管理员使用。

<details>
<summary><b>展开查看完整指令列表</b></summary>

### 通用指令
| 指令 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- |
| `/菜单` / `/帮助` | 查看用户帮助菜单 | 当前群 | 所有人 |
| `/设置 帮助` | 查看管理配置面板 | 当前群 | 所有人 |
| `/AI 帮助` | 查看AI配置面板 | 当前群 | 所有人 |
| `/订阅列表` | 查看本群当前的订阅列表 (用户与番剧) | 当前群 | 所有人 |

### 订阅管理 (需要群管理员权限)
| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/订阅用户` | `<UID>` | 订阅指定 UP 主的动态与直播 | **当前群** |
| `/取消订阅用户` | `<UID\|用户名>` | 取消订阅指定 UP 主 | **当前群** |
| `/订阅番剧` | `<SeasonID\|链接>` | 订阅番剧/影视更新 | **当前群** |
| `/取消订阅番剧` | `<SeasonID>` | 取消番剧订阅 | **当前群** |
| `/查询订阅` | `<UID>` | 立即检查某用户的订阅状态 (调试用) | **当前群** |

### 配置指令 (需要群管理员或 Root 权限)
> **注意**：以下指令在群聊中发送时，默认**仅对当前群生效**。
> 若需修改全局默认配置，请私聊 Bot 发送指令 (仅限 Root)。

| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/设置 登录` | `[群号]` | 获取 B 站登录二维码。群管仅限当前群，Root 可指定群号 | **当前群** / 指定群 |
| `/设置 验证` | `<key>` | 验证登录状态 (配合登录指令使用) | **当前群** / 指定群 |
| `/设置 功能` | `<开\|关> [群号]` | 开启或关闭指定群组的 Bot 响应 | Root用户可以指定群，群管仅限当前群 |
| `/设置 关注同步` | `<开\|关>` | 开启或关闭关注同步功能 | **当前群** |
| `/设置 关注同步` | `<添加\|删除> <分组>` | 管理同步的 B 站关注分组 | **当前群** |
| `/设置 黑名单` | `<添加\|移除\|列表> [QQ]` | 管理黑名单。Root 操作全局黑名单，群管理员操作本群黑名单 | **当前群** / 全局 |
| `/设置 标签` | `<类型> <开\|关>` | 开关左上角类型标签 (视频/番剧/动态等) | **当前群** |
| `/设置 冷却` | `<秒数>` | 设置相同链接解析冷却时间 | **当前群** |
| `/设置 显示UID` | `<开\|关>` | 开关卡片中 UID 的显示 | **当前群** |
| `/设置 深色模式` | `<开\|关\|定时> [时间]` | 配置深色模式。定时格式如 `21:00-07:00` | **当前群** |
| `/设置 管理员` | `<添加\|移除> <QQ>` | (仅 Root) 设置本群的管理员 | **当前群** |

### AI 配置指令

AI相关配置通过独立的 `/AI` 指令体系管理。

| 指令 | 参数 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- | :--- |
| `/AI 帮助` | 无 | 显示AI配置菜单 | - | 所有人 |
| `/AI 上下文 <条数>` | `<1-50>` | 设置本群AI上下文消息数（默认10） | **当前群** | 群管/Root |
| `/AI 概率 <0-1>` | `<0.0-1.0>` | 设置本群AI随机回复概率（默认0.1） | **当前群** | 群管/Root |
| `/AI 新对话 [群号]` | `[群号]` | 重置AI对话记忆 | **指定群** | 群管/Root |
| `/AI 向量阈值 <0-1>` | `<0.0-1.0>` | 设置记忆相似度阈值（默认0.4） | **全局** | Root |
| `/AI 向量数量 <数量>` | `<1-10>` | 设置返回的相关记忆数量（默认3） | **全局** | Root |
| `/AI 短消息过滤 <字符>` | `<1-50>` | 设置短消息过滤阈值（默认5） | **全局** | Root |
| `/AI 缓存 <开\|关>` | `<开\|关>` | 开关向量搜索缓存（默认开启） | **全局** | Root |
| `/AI 智能保留 <开\|关>` | `<开\|关>` | 开关智能记忆保留（默认开启） | **全局** | Root |

**配置作用域说明**：
- **当前群**：仅影响发送指令的群组，支持群级个性化配置
- **全局**：影响所有群组，仅Root管理员可修改


### 系统指令 (仅限 Root 管理员)
| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/设置 轮询` | `<秒数>` | 设置订阅更新的轮询间隔 | **全局** |
| `/管理 清理` | `[群号]` | 清理指定群组的配置和订阅数据 | 指定群 |
| `/管理 群列表` | (无) | 查看当前已配置的群组状态 | **全局** |

</details>

## WebUI 管理后台

本项目提供了一个可视化的 Web 管理界面，可以方便地管理群组权限和订阅，无需通过 QQ 指令操作。

### 访问方式

**本地访问 (默认配置):**
```bash
http://127.0.0.1:3100
```

**远程访问 (通过 SSH 隧道):**
```bash
# 在本地终端执行
ssh -L 3100:127.0.0.1:3100 user@your-server-ip

# 然后在浏览器访问
http://localhost:3100
```

**Docker 部署访问:**
```bash
# docker-compose.yml 已配置端口映射 3100:3100
http://your-server-ip:3100
```

### 功能特性

- **群组管理**
  - 查看所有群组列表及状态
  - 启用/禁用群组响应
  - 管理群组管理员（添加/删除）
  - 管理群组黑名单（添加/删除）

- **订阅管理**
  - 查看 UP 主订阅列表（带头像和名称）
  - 查看番剧订阅列表（带封面和标题）
  - 添加/删除 UP 主订阅
  - 添加/删除番剧订阅

- **安全认证**
  - HTTP Basic Auth 认证
  - 配置用户名和密码通过 `.env` 文件
  - 未设置密码时认证将被禁用（不推荐）

### 配置示例

在 `.env` 文件中配置：

```env
# 启用 WebUI
WEBUI_ENABLED=true

# 监听端口
WEBUI_PORT=3100

# 监听地址 (127.0.0.1 = 仅本地, 0.0.0.0 = 所有IP)
WEBUI_HOST=127.0.0.1

# 登录凭证
WEBUI_USERNAME=root
WEBUI_PASSWORD=your_secure_password_here
```

**安全建议:**
- 生产环境务必设置强密码
- 使用 `127.0.0.1` 限制仅本地访问，通过 SSH 隧道远程访问
- 如需公网访问，建议配合反向代理（Nginx/Caddy）并启用 HTTPS

## 其他部署方式

<details>
<summary><b>本地 Docker 部署 (Git Clone)</b></summary>

如果您希望手动管理项目文件：

1.  **下载项目**
    ```bash
    git clone https://github.com/UnsplashZ/bili-qq-bot.git
    cd bili-qq-bot
    ```

2.  **配置环境**
    复制配置文件模板并进行修改：
    ```bash
    cp config/.env.example config/.env
    # 编辑 .env 文件，填入必要信息
    nano config/.env
    ```

3.  **启动服务**
    ```bash
    docker-compose up -d
    ```

4.  **查看日志与登录**
    ```bash
    docker logs -f napcat
    ```

**高级选项：**
*   **自行构建镜像**：修改 `docker-compose.yml`，注释掉 `image: ...`，取消注释 `build: .`，使用 `docker-compose up -d --build` 构建并启动。
*   **已有 NapCat**：如果您已有 NapCat 服务，可自行修改 `docker-compose.yml` ，并更新 `config/.env` 中的 `WS_URL` (如 `ws://localhost:3001`) 和 `NAPCAT_TEMP_PATH` 路径映射。

</details>

<details>
<summary><b>本地 NPM 运行</b></summary>

适用于开发调试或非 Docker 环境。

1.  **环境准备**：确保安装 Node.js (v18+), Python (v3.8+), Chrome/Chromium。
2.  **安装依赖**：克隆项目到本地后运行以下命令安装依赖，如果要使用虚拟环境，请先激活环境，并更新 `.env` 中的 `PYTHON_PATH` 为虚拟环境中的 Python 解释器路径。
    ```bash
    npm install
    pip install bilibili-api-python
    ```
3.  **配置**：同上，复制并编辑 `config/.env`。**注意**：本地运行时，请确保 `.env` 中的 `NAPCAT_TEMP_PATH` 指向宿主机真实路径，且该路径已被映射到 NapCat 容器中。
4.  **运行**：
    ```bash
    npm start
    ```
</details>

## 项目结构

<details>
<summary><b>展开查看项目结构</b></summary>

*   `setup.sh`: 一键部署脚本
*   `Dockerfile` / `docker-compose.yml`: Docker 部署配置
*   `config/`:
    *   `.env`: **核心配置文件** (API Key, WS 地址等)
    *   `config.json`: 运行时动态配置 (黑名单, 自动保存)
*   `napcat/`: NapCat 配置文件与数据目录 (自动生成)
*   `logs/`: 运行日志目录
*   `data/`: 数据持久化目录
    *   `cache/`: API 数据缓存，加速解析并降低请求频率 (LRU 策略，1GB 上限)
    *   `contexts/`: AI 对话上下文历史 (每个群一个文件，最大 200MB)
    *   `vectors/`: AI 向量记忆库 (用于长期记忆检索，每个群一个文件，最大 200MB)
    *   `cookies.json`: Bilibili 登录凭证 (用于获取高清资源/会员内容)
    *   `subscriptions.json`: 订阅配置信息 (UP主/番剧/关键词监控)
    *   `subfollowers.json`: 订阅推送目标列表 (群组/用户映射关系)
*   `fonts/`: 字体文件目录 (支持热更新)
*   `src/`: 源代码
    *   `bot.js`: 程序入口，WebSocket 连接与消息分发
    *   `config.js`: 配置管理系统 (双重配置架构 + 分群覆盖)
    *   `handlers/`: 消息与 AI 处理逻辑
        *   `messageHandler.js`: 链接解析、指令系统、权限管理
        *   `aiHandler.js`: AI 对话、RAG 检索、上下文管理
    *   `services/`: B站 API, 绘图服务, 订阅服务
        *   `biliApi.js`: Bilibili API 调用 (通过 Python 子进程)
        *   `imageGenerator/`: **Puppeteer 图片生成服务** (模块化架构，17 个文件)
            *   `index.js`: 主入口，导出单例 ImageGenerator 类
            *   `core/`: 核心模块
                *   `browser.js`: Puppeteer 浏览器管理 (单例模式)
                *   `theme.js`: 主题系统 (深色/浅色模式，配色计算)
                *   `formatters.js`: 格式化工具 (时间、数字、HTML 转义)
            *   `renderers/`: 内容渲染器 (纯函数，HTML 生成)
                *   `video.js`, `bangumi.js`, `article.js`, `live.js`, `user.js`, `dynamic.js`: 各类型内容渲染
                *   `icons.js`: SVG 图标常量
                *   `components/`: 可复用组件
                    *   `richtext.js`: 富文本解析 (@用户、表情、话题)
                    *   `vote.js`: 投票卡片组件
                    *   `media.js`: 媒体 (图片/视频) 组件
            *   `generators/`: 图片生成器 (整合渲染器与浏览器)
                *   `previewCard.js`: 预览卡片生成 (6 种内容类型)
                *   `subscriptionList.js`: 订阅列表生成
                *   `helpCard.js`: 帮助卡片生成 (用户/管理员菜单)
        *   `subscriptionService.js`: 订阅轮询与推送系统
        *   `vectorMemoryService.js`: 向量嵌入与相似度检索
    *   `utils/`: 工具函数
        *   `logger.js`: 日志系统 (log4js)
        *   `cacheManager.js`: LRU 缓存管理器
        *   `designSystem.js`: 统一设计系统与主题配置
        *   `proxyUtils.js`: 代理配置工具
*   `scripts/`: Python 脚本
    *   `bili_service.py`: Bilibili API 调用服务 (基于 bilibili-api-python)

</details>

## 待办计划 (Roadmap)

- [ ] Web 管理后台 (可视化配置订阅与设置)
- [ ] 订阅关键词监控 (监控动态中的特定关键词)
- [ ] 消息统计与数据分析
- [ ] 插件系统 (支持自定义扩展)

## 常见问题 (FAQ)

<details>
<summary><b>Q: Root 管理员和群管理员有什么区别?</b></summary>

**Root 管理员** (`.env` 中的 `ADMIN_QQ`)：拥有全局最高权限，可执行所有管理指令、设置群管理员、修改全局配置。

**群管理员** (`/设置 管理员` 添加)：仅在指定群组拥有管理权限，可管理本群订阅、黑名单、配置等，无法修改全局配置。
</details>

<details>
<summary><b>Q: 如何为不同的群设置不同的配置?</b></summary>

Bot 支持分群配置覆盖。在群聊中发送 `/设置` 指令时，默认仅对当前群生效。每个群的配置独立存储在 `config.json` 的 `groupConfigs` 字段中。
</details>

<details>
<summary><b>Q: 为什么订阅列表有 120 秒冷却时间?</b></summary>

为避免频繁查询导致性能问题，`/订阅列表` 指令设有 120 秒冷却。如需立即查看单个用户，可使用 `/查询订阅 <UID>`。
</details>

<details>
<summary><b>Q: AI 聊天不回复怎么办?</b></summary>

检查 `.env` 中的 `AI_API_URL`、`AI_API_KEY`、`AI_MODEL` 是否正确。尝试 `@机器人` 发送消息（必定触发回复）。检查 `AI_PROBABILITY` 设置（0.1 表示 10% 概率插话），可使用 `/设置 AI概率 1` 测试。
</details>

<details>
<summary><b>Q: 如何登录 B 站账号以获取高清封面?</b></summary>

1. 在群内发送 `/设置 登录` (群管理员/Root) 或私聊 Bot 发送 (仅 Root)
2. 使用 B 站 APP 扫描返回的二维码
3. 机器人将自动检测扫码状态，登录成功后会发送通知（约30秒超时）。
4. 如遇自动检测超时，可使用 `/设置 验证 <key>` 手动验证。

**注意**：登录凭证**仅对当前群生效**。登录后，本群可访问会员专属内容和高清封面。
</details>

<details>
<summary><b>Q: 订阅推送不工作?</b></summary>

检查订阅轮询间隔 (`/设置 轮询 <秒数>`)、查看日志 (`logs/application.log`) 是否有错误、确认已订阅用户/番剧 (`/订阅列表`)。注意：首次订阅只记录状态，不会立即推送，需等待下次更新。可使用 `/查询订阅 <UID>` 手动触发检查。
</details>

## 致谢 (Acknowledgments)

本项目默认使用 **MiSans (小米)** 字体以获得最佳视觉体验。

特别感谢以下 AI 模型与工具在开发过程中的强力支持：

*   **Qwen**
*   **Gemini**
*   **Claude**
*   **Trae**

## 免责声明

本工具仅用于学习交流，请勿用于非法用途。Bilibili 相关接口由 `bilibili-api-python` 提供，请遵守 B 站相关规定。
