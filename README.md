# Bili QQ Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![Python](https://img.shields.io/badge/python-%3E%3D3.8-yellow)

基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 框架开发的Bilibili链接解析机器人。它能智能识别并解析B站各种类型的链接，并为这些内容生成高清预览卡片。

## 目录

- [✨ 核心特性](#核心特性)
- [📸 预览效果](#预览效果)
- [🚀 一键快速部署](#一键快速部署)
- [🖥️ WebUI 管理面板](#webui-管理面板)
- [⚙️ 配置说明](#配置说明)
- [💬 指令列表](#指令列表)
- [🛠️ 其他部署方式](#其他部署方式)
- [📂 项目结构](#项目结构)
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
    *   使用 Puppeteer 生成精美长截图卡片（默认 Noto Sans CJK SC + Noto Sans Sinhala + Noto Color Emoji 字体链）
    *   统一设计系统：支持定时深色模式，毛玻璃视觉风格
    *   智能配色：自动提取装扮卡片重点色，动态调整氛围背景
    *   SVG 矢量图标 & Emoji，无乱码，视觉统一

*   🤖 **智能 AI 对话**
    *   群组记忆 (RAG)：内置向量记忆系统，支持长期记忆与语义检索
    *   用户身份感知：向量记忆保留 `userId/userName`，降低群聊记忆串线
    *   用户画像：按群可开关，自动生成参与者画像并注入个性化回复
    *   智能记忆管理：自动去重、重要性评分、智能保留策略、上下文和时间感知
    *   MCP支持：通过简单的配置文件，即可让Bot调用其他工具
    *   支持概率回复和 `@机器人` 触发

*   ⬇️ **视频下载**
    *   解析到 B 站视频链接后可异步自动下载并发送 MP4（不阻塞预览卡片）
    *   支持多 P 视频续下：`/下载 P{n}`，并支持订阅推送视频下载扇出
    *   支持全局与分群配置：开关、默认分辨率、最大时长、自动清理

*   📡 **订阅推送**：内置订阅系统，支持分群订阅与同步关注分组，实时追踪 UP 主动态、直播、番剧更新

*   🖥️ **WebUI 管理面板**：内置可视化管理后台，支持分群配置、AI/RAG/画像开关、视频下载策略、订阅管理、日志查看、B站登录等操作，无需命令行

*   🐳 **Docker 化部署**：一键部署，内置 Noto CJK、多语种 Noto 与 Emoji 字体，并包含 FFmpeg 依赖

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
*注：预览图关闭了左上角标签功能。*
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

## WebUI 管理面板

<details>
<summary><b>展开查看 WebUI 说明</b></summary>

部署完成后，访问 `http://<服务器IP>:3000` 即可打开 WebUI 管理面板。

### 访问说明

*   **本地访问**：`localhost` 或 `127.0.0.1` 无需额外配置，自动允许访问
*   **内网访问**：通过 Tailscale 或局域网 IP 访问，自动检测并允许
*   **公网部署**：如需通过公网域名或 IP 访问，必须配置 `config/.env` 中的 `DASHBOARD_ALLOWED_ORIGINS`（参考 [配置说明](#配置说明)）

### 登录

首次访问需要输入密码登录。默认密码为 `admin`，可通过 `config/.env` 中的 `DASHBOARD_PASSWORD` 修改。登录基于 JWT 令牌，有效期 24 小时。连续登录失败 5 次会被临时锁定 5 分钟。

### 功能模块

| 模块 | 说明 |
| :--- | :--- |
| **仪表盘** | 实时监控 CPU、内存、网络等系统状态，可视化图表展示 |
| **群组管理** | 分群配置：启用/禁用群组、链接冷却、标签开关、深色模式、黑名单、管理员、AI 参数覆盖、关注同步、视频下载（继承/覆盖） |
| **全局设置** | 常规配置（轮询间隔等）、MCP 服务管理、全局黑名单、B站登录、AI 参数（模型/密钥/系统提示词）、AI/RAG/画像开关、视频下载全局策略、应用重启 |
| **实时日志** | WebSocket 实时推送应用日志，支持暂停/清空 |

</details>

## 配置说明

本项目采用双重配置系统：`config/.env` 用于启动/敏感信息，`config.json` 用于运行时动态配置。

<details>
<summary><b>展开查看具体配置</b></summary>

### 1. 基础配置 (.env)
复制 `config/.env.example` 为 `config/.env`，填入 WebSocket 连接与 AI 密钥等启动参数：

| 变量名 | 说明 | 示例 / 默认值 |
| :--- | :--- | :--- |
| `WS_URL` | NapCat 的 WebSocket 地址 | `ws://napcat:3001` (Docker) / `ws://localhost:3001` (本地) |
| `WS_TOKEN` | WebSocket 连接 Token (可选，留空则不启用身份验证) | 需与 NapCat 配置一致 |
| `NAPCAT_TEMP_PATH` | 机器人写入图片的临时路径 | `/app/.config/QQ/tmp/` |
| `NAPCAT_READ_PATH` | NapCat 读取图片的路径 (需与上条映射到同一物理路径) | `/app/.config/QQ/tmp/` |
| `AI_API_URL` | AI 接口地址 (OpenAI 兼容) | `https://api.openai.com/v1/chat/completions` |
| `AI_API_KEY` | AI 接口密钥 | `sk-xxxxxxxx` |
| `AI_MODEL` | 使用的模型名称 | `gpt-3.5-turbo` |
| `AI_CHAT_API_URL` | AI 聊天专用接口地址 (可选，优先于 `AI_API_URL`) | 留空 (默认跟随 `AI_API_URL`) |
| `AI_CHAT_API_KEY` | AI 聊天专用密钥 (可选，优先于 `AI_API_KEY`) | 留空 (默认跟随 `AI_API_KEY`) |
| `AI_CHAT_MODEL` | AI 聊天专用模型 (可选，优先于 `AI_MODEL`) | 留空 (默认跟随 `AI_MODEL`) |
| `AI_CHAT_SYSTEM_PROMPT` | AI 聊天专用系统提示词 (可选，优先于 `AI_SYSTEM_PROMPT`) | 留空 (默认跟随 `AI_SYSTEM_PROMPT`) |
| `AI_PROBABILITY` | AI 随机插话概率 (0-1) | `0.1` |
| `AI_TEMPERATURE` | AI 采样温度 (影响回复发散度) | `1.0` |
| `AI_SYSTEM_PROMPT` | AI 人设提示词 | `你是一个可爱的猫娘...` |
| `AI_EMBEDDING_API_URL` | 向量嵌入接口地址 (用于记忆) | `https://api.openai.com/v1/embeddings` |
| `AI_EMBEDDING_API_KEY` | 向量嵌入密钥 (留空则同上) | `sk-xxxxxxxx` |
| `AI_EMBEDDING_MODEL` | 向量嵌入模型名称 | `text-embedding-3-small` |
| `AI_CHAT_PROXY` | AI 聊天接口代理地址 (可选) | `http://127.0.0.1:7890` |
| `AI_EMBEDDING_PROXY` | AI 嵌入接口代理地址 (可选) | `http://127.0.0.1:7890` |
| `MCP_CALL_DELAY_MS` | MCP 工具调用之间的延迟（毫秒） | `100` |
| `PUPPETEER_EXECUTABLE_PATH` | 指定浏览器可执行文件路径（可选） | 留空（自动检测） |
| `PYTHON_PATH` | Python 解释器路径 (本地开发用，Docker 默认无需配置) | `venv/bin/python` |
| `ADMIN_QQ` | 管理员 QQ 号 (用于特权指令) | `123456789` |
| `USE_BASE64_SEND` | 是否使用 Base64 发送图片 | `false` |
| `DATA_CACHE_TTL` | 数据缓存过期时间 (秒) | `3600` (1小时) |
| `JWT_SECRET` | Dashboard JWT 签名密钥（可选，不填则自动生成并持久化） | 留空 |
| `DASHBOARD_PASSWORD` | WebUI 管理面板登录密码 | `admin` |
| `DASHBOARD_ALLOWED_ORIGINS` | WebUI 公网访问白名单 (逗号分隔，仅公网部署时需要) | 留空 (仅允许本地/内网访问) |

### 2. 动态配置 (config.json)
这些配置随bot运行自动创建，支持热更新（通过 `/设置` 和 `/AI` 相关指令），无需手动修改：

| 字段名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `aiEnabled` | 全局 AI 开关 | `true` |
| `aiRagEnabled` | 全局 RAG 开关（依赖 AI 开启） | `true` |
| `aiProfileEnabled` | 全局用户画像开关（依赖 AI 开启） | `false` |
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
| `aiProfileMinMessages` | 首次生成画像所需最小发言数 | `30` |
| `aiProfileUpdateInterval` | 画像增量更新触发间隔（新增发言数） | `50` |
| `aiProfileMaxLength` | 单条画像最大长度（字） | `200` |
| `blacklistedQQs` | 黑名单 QQ 列表 | `[]` |
| `enabledGroups` | 允许响应的群组 (空为全部) | `[]` |
| `linkCacheTimeout` | 链接解析缓存时间 (秒) | `600` |
| `subscriptionCheckInterval` | 订阅轮询间隔 (秒) | `60` |
| `videoDownloadEnabled` | 视频下载全局开关 | `false` |
| `videoDownloadResolution` | 视频下载默认分辨率 (`360p/480p/720p/1080p/1080p+`) | `1080p` |
| `videoDownloadMaxDuration` | 视频下载最大时长限制（秒，`0` 表示不限） | `600` |
| `videoDownloadAutoClean` | 视频文件发送后自动清理 | `true` |
| `videoDownloadCleanTimeout` | 下载目录兜底清理超时（小时） | `6` |
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

### 视频下载指令
| 指令 | 参数 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- | :--- |
| `/下载 P{n}` | 例如 `P2` | 下载最近一次视频链接的指定分 P（需当前群已启用视频下载） | 当前群 | 所有人 |
| `/下载状态` | 无 | 查看下载目录文件数量与占用体积 | 当前群 | 群管/Root |
| `/清理下载` | 无 | 清理下载目录中的视频文件（有活跃任务时会拒绝） | 当前群 | 群管/Root |

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
| `/设置 推送AT全体` | `<开\|关>` | `@全体` 总开关；细粒度规则（来源/分类/UID）请在 WebUI 群组管理中配置（需要为Bot QQ管理员权限） | **当前群** |
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
    docker compose up -d
    ```

4.  **查看日志与登录**
    ```bash
    docker logs -f napcat
    ```

**高级选项：**
*   **自行构建镜像**：修改 `docker-compose.yml`，注释掉 `image: ...`，取消注释 `build: .`，使用 `docker compose up -d --build` 构建并启动。
*   **已有 NapCat**：如果您已有 NapCat 服务，可自行修改 `docker-compose.yml` ，并更新 `config/.env` 中的 `WS_URL` (如 `ws://localhost:3001`) 和 `NAPCAT_TEMP_PATH` 路径映射。

</details>

<details>
<summary><b>本地 NPM 运行</b></summary>

适用于开发调试或非 Docker 环境。

1.  **环境准备**：确保安装 Node.js (v18+), Python (v3.8+), Microsoft Edge/Chrome/Chromium。
    同时需要系统可用的 `ffmpeg`（用于下载后合并音视频流）。

2.  **克隆项目**：
    ```bash
    git clone https://github.com/UnsplashZ/bili-qq-bot.git
    cd bili-qq-bot
    ```

3.  **安装 Node.js 依赖**：
    ```bash
    npm install
    ```

4.  **安装 Python 依赖**：
    如果使用虚拟环境，请先激活环境，并更新 `config/.env` 中的 `PYTHON_PATH` 为虚拟环境中的 Python 解释器路径。
    ```bash
    # 使用 requirements.txt 安装所有依赖
    pip install -r requirements.txt

    # 或使用虚拟环境（推荐）
    python3 -m venv venv
    source venv/bin/activate  # Windows: venv\Scripts\activate
    pip install -r requirements.txt
    ```

5.  **构建 WebUI**：
    ```bash
    cd dashboard
    npm install
    npm run build  # 构建生产版本
    cd ..
    ```

6.  **配置**：复制并编辑 `config/.env`。
    ```bash
    cp config/.env.example config/.env
    nano config/.env  # 或使用其他编辑器
    ```
    **注意**：本地运行时，请确保 `config/.env` 中的 `NAPCAT_TEMP_PATH` 指向宿主机真实路径，且该路径已被映射到 NapCat 容器中。

7.  **运行**：
    ```bash
    npm start
    ```

8.  **访问 WebUI**：打开浏览器访问 `http://localhost:3000`

### WebUI 前端开发（可选）

WebUI 基于 React + Vite + Tailwind CSS 构建，开发时可独立运行：

```bash
cd dashboard
npm install
npm run dev     # 开发服务器 (端口 5173，自动代理 API 至 3000)
npm run build   # 生产构建，输出至 dashboard/dist
```

构建后由主服务 (端口 3000) 托管静态文件，无需额外部署。
</details>

## 项目结构

<details>
<summary><b>展开查看项目结构</b></summary>

*   `setup.sh`: 一键部署脚本
*   `Dockerfile` / `docker-compose.yml`: Docker 部署配置
*   `config/`:
    *   `config/.env`: **核心配置文件** (API Key, WS 地址等)
    *   `config.json`: 运行时动态配置 (黑名单, 自动保存)
*   `napcat/`: NapCat 配置文件与数据目录 (自动生成)
*   `logs/`: 运行日志目录
*   `data/`: 数据持久化目录
    *   `cache/`: API 数据缓存，加速解析并降低请求频率 (LRU 策略，1GB 上限)
    *   `contexts/`: AI 对话上下文历史 (每个群一个文件，最大 200MB)
    *   `vectors/`: AI 向量记忆库 (用于长期记忆检索，每个群一个文件，最大 200MB)
    *   `profiles/`: AI 用户画像数据 (按群存储用户画像与活跃元数据)
    *   `downloads/`: 视频下载临时文件目录 (自动清理)
    *   `cookies.json`: Bilibili 登录凭证 (用于获取高清资源/会员内容)
    *   `subscriptions.json`: 订阅配置信息 (UP主/番剧/关键词监控)
    *   `subfollowers.json`: 订阅推送目标列表 (群组/用户映射关系)
*   `fonts/`: 字体文件目录 (支持热更新)
*   `dashboard/`: WebUI 前端 (React + Vite + Tailwind CSS)
    *   `src/pages/`: 页面组件 (Dashboard, Groups, Settings, Logs, Login)
    *   `src/components/`: 通用组件 (GlassCard, GlassModal)
    *   `dist/`: 生产构建输出 (由主服务托管)
*   `src/`: 源代码
    *   `bot.js`: 程序入口，WebSocket 连接与消息分发
    *   `config.js`: 配置管理系统 (双重配置架构 + 分群覆盖)
    *   `dashboard/`: WebUI 后端
        *   `server.js`: Express 应用，静态文件托管与 WebSocket 日志推送
        *   `routes/api.js`: 兼容入口壳（转发到模块化实现）
        *   `routes/api/`: 模块化 RESTful API（配置、群组、订阅、B站登录等）
        *   `middleware/auth.js`: JWT 认证中间件
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
        *   `userProfileService.js`: 用户画像生成与存储
        *   `videoDownloadService.js`: 视频下载、发送与清理调度
    *   `utils/`: 工具函数
        *   `logger.js`: 日志系统 (log4js)
        *   `cacheManager.js`: LRU 缓存管理器
        *   `designSystem.js`: 统一设计系统与主题配置
        *   `proxyUtils.js`: 代理配置工具
*   `src/services/`: Python 服务
    *   `bili_server.py`: 兼容入口壳（启动参数解析与 `create_app` 导出）
    *   `bili_server_core/`: Python 服务核心实现
        *   `app.py` / `main.py`: aiohttp 应用装配与启动
        *   `web/`: 路由与 HTTP handlers
        *   `services/`: 按业务域拆分的 B 站能力实现
        *   `auth/` / `media/` / `download/`: 凭证、媒体工具、下载子系统

</details>


## 常见问题 (FAQ)

<details>
<summary><b>Q: Root 管理员和群管理员有什么区别?</b></summary>

**Root 管理员** (`config/.env` 中的 `ADMIN_QQ`)：拥有全局最高权限，可执行所有管理指令、设置群管理员、修改全局配置。

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

检查 `config/.env` 中的 `AI_API_URL`、`AI_API_KEY`、`AI_MODEL` 是否正确（若配置了 `AI_CHAT_*`，则以 `AI_CHAT_*` 为准）。尝试 `@机器人` 发送消息（必定触发回复）。检查 `AI_PROBABILITY` 设置（0.1 表示 10% 概率插话），可使用 `/AI 概率 1` 测试（群管/Root）。
</details>

<details>
<summary><b>Q: 如何登录 B 站账号以获取高清封面?</b></summary>

1. 在群内发送 `/设置 登录` (群管理员/Root) 或私聊 Bot 发送 (仅 Root)
2. 使用 B 站 APP 扫描返回的二维码
3. 机器人将自动检测扫码状态，登录成功后会发送通知（约30秒超时）。
4. 如遇自动检测超时，可使用 `/设置 验证 <key>` 手动验证。

**注意**：登录凭证**全局生效**。登录后，本群可访问会员专属内容和高清封面。
</details>

<details>
<summary><b>Q: 订阅推送不工作?</b></summary>

检查订阅轮询间隔 (`/设置 轮询 <秒数>`)、查看日志 (`logs/application.log`) 是否有错误、确认已订阅用户/番剧 (`/订阅列表`)。注意：首次订阅只记录状态，不会立即推送，需等待下次更新。可使用 `/查询订阅 <UID>` 手动触发检查。
</details>

## 致谢 (Acknowledgments)

本项目默认使用 **Noto Sans CJK SC + Noto Sans Sinhala + Noto Color Emoji** 字体链，以兼顾中文可读性与跨脚本字符兼容性。

特别感谢以下 AI 模型与工具在开发过程中的强力支持：

*   **Gemini**/**Claude**/**CodeX**
*   **Trae**

## 免责声明

本工具仅用于学习交流，请勿用于非法用途。Bilibili 相关接口由 `bilibili-api-python` 提供，请遵守 B 站相关规定。
