# Bili QQ Bot

![License](https://img.shields.io/badge/license-ISC-blue.svg) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-green) ![Python](https://img.shields.io/badge/python-%3E%3D3.8-yellow)

基于 [NapCat](https://github.com/NapNeko/NapCatQQ) / OneBot 的 Bilibili 链接解析机器人，并提供 QQ 官方机器人 OpenAPI Provider（可选）。它能智能识别并解析 B 站各种类型的链接，并为这些内容生成高清预览卡片。

> 旧版 AI 对话、向量记忆、用户画像、MCP 工具调用等实验性能力已移除。当前分支使用新的 Agent 架构：命令和 B 站链接仍走确定性系统链路，自然语言消息可进入受限 Agent，由 LLM 判断是否回复、记忆或调用白名单工具。

## 目录

- [✨ 核心特性](#核心特性)
- [📸 预览效果](#预览效果)
- [🚀 一键快速部署](#一键快速部署)
- [🖥️ WebUI 管理面板](#webui-管理面板)
- [🤖 Agent 功能](#agent-功能)
- [⚙️ 配置说明](#配置说明)
- [🧪 开发与测试](#开发与测试)
- [📂 项目结构](#项目结构)
- [💬 指令列表](#指令列表)

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

*   🔌 **QQ 接入 Provider**
    *   默认兼容 OneBot / NapCat 部署
    *   可在 WebUI 或配置中切换 QQ Official Provider，通过官方 WSS + OpenAPI 收发消息
    *   Official 模式支持文本、图片、视频、订阅推送、基础指令、Agent 基础回复与机器人消息撤回；NapCat 专属群管能力会按 capability 自动隐藏或降级

*   🖥️ **WebUI 管理面板**：内置可视化管理后台，支持分群配置、QQ 连接模式、视频下载策略、订阅管理、日志查看、B站登录等操作，无需命令行

*   🤖 **受限 Agent（实验性）**
    *   自然语言消息可进入 Agent，由 LLM 结合上下文、群聊节奏、记忆和人格决定回复或沉默
    *   命令消息和 B 站链接不进 LLM，继续走确定性系统 handler
    *   支持长期记忆、短期上下文、工具确认、权限闸门、审计日志和 WebUI 观测
    *   支持受限工具：订阅管理、Agent/Bot 配置、B 站查询、QQ 群管理、申请处理、网页读取/搜索/截图和显式学习记忆

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

运行下方命令。脚本负责安装问答、旧进程 fencing、Compose、volume、网络、health gate 与部署回滚；最终 `config/config.yaml`、legacy 配置迁移和业务数据 migration 由目标主程序在任何运行时副作用启动前完成。
*[点我跳转到视频教程](https://www.bilibili.com/video/BV1YsrEBVEs6/ "bilibili")*

```bash
#从Github下载
wget -O setup.sh https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh

#从代理下载
wget -O setup.sh https://gh-proxy.org/https://raw.githubusercontent.com/UnsplashZ/bili-qq-bot/refs/heads/main/setup.sh && chmod +x setup.sh && sudo ./setup.sh
```

常用模式：

```bash
sudo ./setup.sh                         # 首装或自动识别旧版升级
sudo ./setup.sh --dry-run               # 只输出计划，不写配置、不操作容器
sudo ./setup.sh --upgrade               # 显式升级
sudo ./setup.sh --apply                 # 应用端口、volume、网络等部署级变更
sudo ./setup.sh --non-interactive ...   # 自动化环境；缺少必要参数时 fail-closed
```

升级会先备份并验证配置/数据，再由目标进程 bootstrap 完成配置和数据升级。probe health 通过后写入同一 `releaseEpoch` 的 release marker，再启动正式 Provider。marker 前失败恢复旧镜像、旧配置、原数据、Compose、网络和 managed writer；marker 后只允许 same-epoch recovery。legacy 文件只在 normal readiness 成功且 archive proof 复核通过后移入 `data/setup-state/<attempt>/retained-vault/`。


## WebUI 管理面板

<details>
<summary><b>展开查看 WebUI 说明</b></summary>

部署完成后，访问 `http://<服务器IP>:3000` 即可打开 WebUI 管理面板。

### 访问说明

*   **本地访问**：`localhost` 或 `127.0.0.1` 无需额外配置，自动允许访问
*   **其他来源**：Tailscale、局域网、公网域名或 IP 都必须把完整 origin（例如 `https://bot.example.com`）逐项写入 `config/config.yaml` 的 `dashboard.allowedOrigins`

### 登录

首次访问需要输入密码登录。默认密码为 `admin`，请直接修改 `config/config.yaml` 的 `dashboard.password`。JWT Secret 也保存在该 YAML 中，但 API/WebUI 只返回 `configured` 状态，绝不回显明文。

### 功能模块

| 模块 | 说明 |
| :--- | :--- |
| **仪表盘** | 实时监控 CPU、内存、网络等系统状态，可视化图表展示 |
| **群组管理** | 分群配置：启用/禁用群组、链接冷却、标签开关、深色模式、黑名单、管理员、关注同步、视频下载（继承/覆盖） |
| **全局设置** | 常规配置（轮询间隔等）、全局黑名单、B站登录、视频下载全局策略、应用重启 |
| **Agent 设置** | 新 Agent 的全局开关、Persona、LLM 引用、预算、工具策略和群级覆盖 |
| **Agent 决策** | 查看 Agent 的 timing、LLM decision、policy、工具确认/执行、发送结果、重入调度和筛选统计 |
| **Agent 记忆** | 查看长期记忆、人物画像、表达习惯和回复效果；长期记忆支持筛选、删除和清理 |
| **实时日志** | WebSocket 实时推送应用日志，支持暂停/清空 |

> 说明：WebUI 仅管理真实群聊标识：NapCat 使用数字群号，QQ Official 使用安全的 `group_openid`；不支持私聊会话（`private_*`）管理。

</details>

## Agent 功能

<details>
<summary><b>展开查看 Agent 说明</b></summary>

Agent 是当前分支的新智能入口，目标是“群聊观察者 + 谨慎参与者 + 受限业务操作者”，不是收到消息就回复的聊天机器人。

### 处理边界

| 消息/事件 | 处理方式 |
| :--- | :--- |
| `/` 开头的显式指令 | 不进 LLM，直接走命令系统 |
| B 站链接、短链、小程序分享 | 不进 LLM，直接走链接解析链路 |
| 黑名单、群禁用、Agent 未启用 | 硬拒绝，不进入 Agent |
| 普通自然语言 | 进入 Agent，由 LLM 判断回复、沉默、延迟或工具计划 |
| @Bot、回复 Bot、叫昵称 | 高相关消息，原则上应由 Agent 认真回应 |
| 配置、订阅、群管理意图 | LLM 只能输出 `tool_plan`，实际执行由权限和确认系统决定 |

### 权限模型

| 权限来源 | 能力范围 |
| :--- | :--- |
| 普通群成员 | 聊天、查询、提出请求 |
| 配置群管理员 | 管理本群 Bot/Agent 配置和订阅 |
| QQ 群管理员/群主 | 基于 QQ 权限管理本群配置和群聊操作 |
| YAML Root 管理员 | NapCat 使用 `admin.rootQQ`；QQ Official 使用 `qq.official.rootOpenids` |

> QQ Official 模式使用 `openid/member_openid/group_openid`，Root 管理员配置在 `config/config.yaml` 的 `qq.official.rootOpenids`；不要把数字 QQ 号和官方 openid 混用。

### 工具和确认

- Agent 只能调用白名单工具，不能执行 shell、不能任意读写文件、不能动态接入 MCP。
- 中高风险工具会进入短码确认流程；确认必须来自同群同用户，并携带短码或明确回复 Bot。
- 高风险工具不可通过 WebUI 配置关闭确认。
- QQ 群管理工具会检查用户权限和 Bot 当前 QQ 群权限。
- 浏览器能力包括 `browser.read_url`、`browser.search_web` 和 `browser.screenshot_url`；拒绝 localhost、内网地址、带凭证 URL 和 DNS 解析到内网的地址。
- QQ 管理工具包括群信息查询、成员查询、禁言/解禁、踢人、撤回、精华、全员禁言、加群申请、好友申请、在线状态和输入状态；写操作受 QQ 权限、Bot 权限、风险确认和审计日志约束。

### 验证方式

- 在 WebUI 的 **Agent 决策** 页查看每条消息的 timing、LLM 决策、policy、工具计划、确认、重入调度和发送结果。
- 在 **Agent 记忆** 页查看长期记忆、人物画像、表达习惯和回复效果；长期记忆可继续删除或按筛选清理。
- QQ 群实测建议参考 `docs/done/2026-04-26-agent-qq-test-matrix.md`。

</details>

## 配置说明

唯一配置真源是 `config/config.yaml`。主程序每次启动先运行 `ApplicationMigrationBootstrap`：已有合法 YAML 永远权威；没有 YAML 时才读取 `.env`、`config.json`、`.jwtSecret` 与 `.qqOfficialClientSecret`；随后执行 schema registry 和业务数据 registry，再移交 ConfigService owner。失败时 Dashboard、Provider、Python、browser 和订阅 timer 都不会启动。

直接运行 `node src/bot.js` 或使用手写 Compose 也走同一 bootstrap。离线诊断/显式迁移可使用 Config CLI 与 data migration CLI；它们调用相同 service，不是正常部署的第二套 migration owner。

使用 Docker 时，只要继续挂载原来的 `/app/config` 和 `/app/data`，执行 `docker compose pull && docker compose up -d` 即可在新容器启动阶段自动迁移 legacy 配置与业务数据，不需要设置额外的 fencing 环境变量。项目支持的部署模型是一套挂载目录只运行一个 Bot 容器；不要让旧、新两个容器同时写入同一目录。

```bash
node src/cli/config.js init --output config/config.yaml
node src/cli/config.js validate --config config/config.yaml
node src/cli/config.js status --manifest data/migrations/config-manifest.json
node src/cli/config.js deployment-plan --config config/config.yaml --output data/config-state/deployment-plan.json
```

YAML 使用 versioned schema（当前 `version: 1`），主要分区包括 `qq`、`dashboard`、`deployment`、`paths`、`pythonService`、`cache`、`subscription`、`rendering`、`videoDownload`、`logging`、`groupConfigs` 和 `agent`。Secret（NapCat token、Official client secret、Dashboard password/JWT、Agent API key）均写入 YAML，文件/目录权限为 `0600/0700`；Dashboard 和 API 只返回 configured marker。

手工编辑合法 YAML 后，ConfigService 会按 diff 自动即时应用或重建对应子系统：日志/缓存/订阅 timer、Python、Dashboard listener、浏览器、下载路径以及 NapCat/Official Provider 都无需手工重启整个 Bot。非法 YAML、重复 key、危险对象路径或未知字段会被拒绝，运行实例继续使用 last-good snapshot。仅宿主机端口、volume 和 Docker 网络属于 deployment apply，需执行 `setup.sh --apply`。

Dashboard/API 更新必须携带 `expectedGeneration`。响应会区分 `applied`、`reloaded`、`deploymentApplyRequired` 和 `warnings`；Secret 留空表示保持不变，清除必须使用显式 secret action。

### QQ Official

- 配置位于 `qq.provider: official` 与 `qq.official.*`；`group_openid`、`user_openid`、`member_openid` 使用安全 opaque ID，不与数字 QQ 号混用。
- Provider 配置和 `paths.napcatTemp` 热更新会受控重建连接；candidate 在 commit 前不接收业务入口，失败时恢复旧 generation。
- Official ID store、reply/recall mapping 与 per-target `msg_seq` 使用共享 COW 状态，失败 candidate 不写正式文件。
- 富媒体公网临时地址配置为 `qq.official.tempPublicBaseUrl`，内置只读路径仍为 `/qq-official-temp/`。

### Agent 开启建议

Agent 默认关闭。一键部署不会自动让 Agent 在群里发言；建议按阶段开启：

1. WebUI 或 YAML 设置 `agent.enabled=true`、目标群 `agent.groups.<群ID>.enabled=true`。
2. 先保持 `agent.observeOnly=true`、`agent.sendEnabled=false`，在 Agent 决策页观察 LLM 判断。
3. 确认效果后切到 `decisionMode=llm_live`，再开启 `sendEnabled=true`。
4. 需要自然语言管理订阅、配置或 QQ 群时，再开启 `agent.tools.enabled=true`。
5. 中高风险工具保留确认，尤其是禁言、踢人、撤回、关闭 Bot、处理申请等操作。
6. 如需偶尔插话，在 Agent 设置中开启 `agent.social.enabled=true`，并逐步调高插话概率和每日上限。


### Agent 实测建议

开启 Agent 后，建议在 QQ 群中按风险从低到高验证：

| 场景 | 示例 | 预期 |
| :--- | :--- | :--- |
| 自然语言 | `@Bot 你现在能做什么？` | Agent 正常回复，WebUI Agent 决策可见轨迹 |
| 网页读取 | `@Bot 总结 https://example.com` | 调用 `browser.read_url` 并给出摘要 |
| 网页搜索 | `@Bot 搜一下 B 站最新动态` | 调用 `browser.search_web`，返回搜索摘要 |
| 网页截图 | `@Bot 截图 https://example.com` | 调用 `browser.screenshot_url` 并发送截图；风控页返回受限提示 |
| 记忆 | `@Bot 记住我喜欢简短回答` | 写入长期记忆，WebUI Agent 记忆可见 |
| QQ 管理 | `@Bot 禁言 @某人 1分钟` | 校验用户权限和 Bot 群管权限，中高风险要求确认 |
| 申请处理 | `@Bot 查看加群申请` / `同意第一个申请` | 读取/处理申请，写操作按风险确认 |
| 偶尔插话 | 群内持续闲聊 | 社交模式开启后，Agent 在预算和冷却内低频插话 |

## 开发与测试

本地开发建议使用仓库内的固定入口，避免新增一次性调试脚本：

建议使用 Node.js `>=22.12.0`（Docker 与 CI 均使用 Node 22）。

```bash
# Node/MJS 单元测试
npm test

# Python Bilibili 服务相关单测
venv/bin/python -m pytest test/unit/bilibili

# Dashboard 检查
cd dashboard && npm run lint
```

预览卡片和渲染回归使用 `test/tools/` 下的复用工具，生成的图片、HTML、JSON 等本地验证产物统一写入 `test/output/`：

```bash
node test/tools/preview-lab.js "https://www.bilibili.com/opus/1183668934980665366" --fresh --out-name local-check
node test/tools/preview-lab-web.js
```

## 项目结构

```text
bili-qq-bot/
├── src/                    # Node.js bot、命令、服务、渲染和 Dashboard 后端
├── dashboard/              # React/Vite WebUI
├── test/
│   ├── runners/            # 测试运行入口，例如 run-unit-tests.js
│   ├── tools/              # 可复用本地验证工具，例如 Preview Lab
│   ├── fixtures/           # 稳定测试夹具
│   ├── unit/               # 按领域分类的单元测试
│   │   ├── agent/
│   │   ├── bilibili/
│   │   ├── commands/
│   │   ├── config/
│   │   ├── dashboard/
│   │   ├── links/
│   │   ├── messages/
│   │   ├── preview/
│   │   ├── rendering/
│   │   ├── services/
│   │   └── subscriptions/
│   └── output/             # 本地预览/测试输出，不作为源码管理目标
├── docs/                   # 计划、归档记录、图片和接口文档
├── config/                 # 启动配置和示例
├── data/                   # 运行时数据，默认不提交
├── logs/                   # 应用日志
└── napcat/                 # NapCat QQ 客户端数据
```

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

</details>
