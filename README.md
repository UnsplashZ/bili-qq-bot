# Bili QQ Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green) ![Python](https://img.shields.io/badge/python-%3E%3D3.8-yellow)

基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 框架开发的Bilibili链接解析机器人。它能智能识别并解析B站各种类型的链接，并为这些内容生成高清预览卡片。

> 当前版本聚焦 Bilibili 链接解析、订阅推送、视频下载与 WebUI 管理。旧版 AI 对话、向量记忆、用户画像、MCP 工具调用等实验性能力已从代码、配置和管理界面中移除；后续智能入口会以新的 Agent 架构重新设计。

## 目录

- [✨ 核心特性](#核心特性)
- [📸 预览效果](#预览效果)
- [🚀 一键快速部署](#一键快速部署)
- [🖥️ WebUI 管理面板](#webui-管理面板)
- [⚙️ 配置说明](#配置说明)
- [💬 指令列表](#指令列表)
- [🛠️ 其他部署方式](#其他部署方式)
- [📂 项目结构](#项目结构)
- [📝 日志标签说明](#日志标签说明)
- [🎛️ 日志显示控制](#日志显示控制)
- [❓ 常见问题](#常见问题-faq)
- [🙏 致谢](#致谢-acknowledgments)
- [⚠️ 免责声明](#免责声明)

---

## 核心特性

*   🚀 **全类型解析**：精准识别并解析以下内容
    *   视频 (BV/av)、番剧/影视 (ss/ep/md)、直播间 (live)
    *   专栏文章 (cv) - 统一渲染为紧凑预览卡，支持封面、标题、三行摘要、作者装扮与统计信息
    *   动态 (t.bilibili.com) - 支持长文、多图、转发动态，完美还原装扮卡片与粉丝编号
    *   用户主页 (space) - 展示用户数据，自动抓取并展示最新一条动态
    *   Opus 图文 (opus) - 自动区分普通动态与“文章型 opus”，文章型 opus 按专栏语义解析并渲染
    *   收藏夹、音频/歌单、话题、合集/系列、文集、笔记、课堂视频等扩展类型
    *   小程序/短链 (b23.tv) - 自动还原目标链接

*   🎨 **高颜值预览**
    *   使用 Puppeteer 生成精美长截图卡片（默认 Noto Sans CJK SC + Noto Sans Sinhala + Noto Color Emoji 字体链）
    *   统一设计系统：支持定时深色模式，毛玻璃视觉风格
    *   智能配色：自动提取装扮卡片重点色，动态调整氛围背景
    *   SVG 矢量图标 & Emoji，无乱码，视觉统一
    *   专栏作者头部支持头像框、认证、等级，以及可从动态装扮卡回补的粉丝装扮卡与编号

*   ⬇️ **视频下载**
    *   解析到 B 站视频链接后可异步自动下载并发送 MP4（不阻塞预览卡片）
    *   支持多 P 视频续下：`/下载 P{n}`，并支持订阅推送视频下载扇出
    *   支持全局与分群配置：开关、默认分辨率、最大时长、自动清理

*   📡 **订阅推送**：内置订阅系统，支持分群订阅与同步关注分组，实时追踪 UP 主动态、视频、专栏、直播与番剧更新

*   🖥️ **WebUI 管理面板**：内置可视化管理后台，支持分群配置、视频下载策略、订阅管理、日志查看、B站登录等操作，无需命令行

*   🐳 **Docker 化部署**：一键部署，内置 Noto CJK、多语种 Noto 与 Emoji 字体，并包含 FFmpeg 依赖

## 预览效果

### ☀️ 浅色模式

<table align="center">
  <tr>
    <td align="center"><img src="docs/images/帮助菜单-浅色模式.webp" height="400" /><br /><b>帮助菜单</b></td>
    <td align="center"><img src="docs/images/管理菜单-浅色模式.webp" height="400" /><br /><b>管理菜单</b></td>
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
| **群组管理** | 分群配置：启用/禁用群组、链接冷却、标签开关、深色模式、黑名单、管理员、关注同步、视频下载（继承/覆盖） |
| **全局设置** | 常规配置（轮询间隔等）、全局黑名单、B站登录、视频下载全局策略、应用重启 |
| **实时日志** | WebSocket 实时推送应用日志，支持暂停/清空 |

> 说明：WebUI 仅管理真实群聊（数字群号），不支持私聊会话（`private_*`）管理。

</details>

## 配置说明

本项目采用双重配置系统：`config/.env` 用于启动/敏感信息，`config.json` 用于运行时动态配置。

> `.env` 仅保留 NapCat 连接、管理员、图片路径、缓存、Python 与 WebUI 相关配置；不再包含任何 AI/MCP 密钥或模型配置。

<details>
<summary><b>展开查看具体配置</b></summary>

### 1. 基础配置 (.env)
复制 `config/.env.example` 为 `config/.env`，填入 WebSocket 连接等启动参数：

| 变量名 | 说明 | 示例 / 默认值 |
| :--- | :--- | :--- |
| `WS_URL` | NapCat 的 WebSocket 地址 | `ws://napcat:3001` (Docker) / `ws://localhost:3001` (本地) |
| `WS_TOKEN` | WebSocket 连接 Token (可选，留空则不启用身份验证) | 需与 NapCat 配置一致 |
| `NAPCAT_TEMP_PATH` | 机器人写入图片的临时路径 | `/app/.config/QQ/tmp/` |
| `NAPCAT_READ_PATH` | NapCat 读取图片的路径 (需与上条映射到同一物理路径) | `/app/.config/QQ/tmp/` |
| `PUPPETEER_EXECUTABLE_PATH` | 指定浏览器可执行文件路径（可选） | 留空（自动检测） |
| `PYTHON_PATH` | Python 解释器路径 (本地开发用，Docker 默认无需配置) | `venv/bin/python` |
| `ADMIN_QQ` | 管理员 QQ 号 (用于特权指令) | `123456789` |
| `USE_BASE64_SEND` | 是否使用 Base64 发送图片 | `false` |
| `DATA_CACHE_TTL` | 数据缓存过期时间 (秒) | `3600` (1小时) |
| `JWT_SECRET` | Dashboard JWT 签名密钥（可选，不填则自动生成并持久化） | 留空 |
| `DASHBOARD_PASSWORD` | WebUI 管理面板登录密码 | `admin` |
| `DASHBOARD_ALLOWED_ORIGINS` | WebUI 公网访问白名单 (逗号分隔，仅公网部署时需要) | 留空 (仅允许本地/内网访问) |

### 2. 动态配置 (config.json)
这些配置随 bot 运行自动创建，支持热更新（通过 `/设置` 相关指令和 WebUI），无需手动修改。

内部实现现已拆分为模块化配置子系统：`src/config.js` 作为兼容入口，实际逻辑位于 `src/config/` 目录（如 `schema.js`、`store.js`、`groupConfig.js`、`authConfig.js`、`jwtSecretOwner.js`、`normalizers.js`）。对外调用方式保持兼容，仍可通过 `require('./src/config')` 或现有 `config` 入口访问。

| 字段名 | 说明 | 默认值 |
| :--- | :--- | :--- |
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
| `labelConfig` | 标签显示配置（视频、番剧、动态、专栏、直播及扩展类型） | `{"video": true, ...}` |
| `showId` | 是否在卡片中显示 UID | `true` |
| `groupConfigs` | 群级配置覆盖 (每个群可独立配置) | `{}` |
</details>

## 指令列表

所有指令均以 `/` 开头，部分指令仅限管理员使用。
Root 可使用私聊能力，但私聊仅支持链接解析/下载；`/设置`、`/管理`、订阅管理指令需在群聊或 WebUI 操作。

<details>
<summary><b>展开查看完整指令列表</b></summary>

### 通用指令
| 指令 | 说明 | 作用域 | 权限 |
| :--- | :--- | :--- | :--- |
| `/菜单` / `/帮助` | 查看用户帮助菜单 | 当前群 | 所有人 |
| `/设置 帮助` | 查看管理配置面板 | 当前群 | 群管/Root |
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
> 私聊不支持配置管理指令；如需修改全局默认配置，请在群聊使用 Root 指令或通过 WebUI 操作。

| 指令 | 参数 | 说明 | 作用域 |
| :--- | :--- | :--- | :--- |
| `/设置 登录` | (无) | 获取 B 站登录二维码（全局 Cookie；群号参数已弃用） | **当前群** |
| `/设置 验证` | `<key>` | 验证登录状态 (配合登录指令使用) | **当前群** |
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
