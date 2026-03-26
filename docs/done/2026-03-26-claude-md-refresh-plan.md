# CLAUDE.md Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `CLAUDE.md` 中度重构为与当前仓库真实结构一致的“架构地图 + 开发手册”。

**Architecture:** 只修改 `CLAUDE.md`，不改业务代码。实施顺序按“先修正事实，再重写架构，再更新验证/调试/坑位，再做一致性检查”推进，避免在单次大改中把新旧表述混杂在一起。

**Tech Stack:** Markdown, Node.js, Mocha, Vite, 现有仓库脚本与 CLI 工具

---

### Task 1: 锁定并替换过时的目录与命令说明

**Files:**
- Modify: `CLAUDE.md`
- Verify against: `package.json`
- Verify against: `dashboard/package.json`
- Verify against: `tools/preview-lab.js`
- Verify against: `tools/preview-lab-web.js`

- [ ] **Step 1: 记录当前过时描述的基线**

Run:

```bash
grep -nE 'placeholder|bili_server.py --port 10001|No configured linters|preview-lab.js' CLAUDE.md
```

Expected:
- 命中 `npm test` 仍被描述为 placeholder 的段落
- 命中只强调 `src/services/bili_server.py` 的段落
- 命中 `No configured linters` 这一旧表述
- 命中仅提到 `tools/preview-lab.js` 的段落

- [ ] **Step 2: 用当前真实结构重写 `Project Structure` 与 `Common Development Commands`**

将 `CLAUDE.md` 中对应部分替换为以下内容风格，保留现有主标题，但更新正文为：

```md
## Project Structure

```
bili-qq-bot/
├── src/
│   ├── bot.js
│   ├── config.js
│   ├── commands/
│   ├── handlers/
│   ├── services/
│   │   ├── ai/                         # AI pipeline helpers
│   │   ├── bili_server_core/           # Python service主体
│   │   ├── imageGenerator/             # 预览卡渲染与出图
│   │   ├── previewLab/                 # preview-lab CLI / Web 调试支撑
│   │   └── subscription/               # 订阅系统与 updateChecker
│   ├── dashboard/                      # Dashboard backend (Express)
│   └── utils/
├── dashboard/
│   └── src/
│       ├── pages/groups/
│       ├── pages/settings/
│       └── pages/logs/
├── test/
│   ├── unit/
│   └── output/
├── docs/
│   ├── plans/
│   ├── done/
│   └── images/
└── tools/
    ├── preview-lab.js
    └── preview-lab-web.js
```

**Key Directories:**
- `src/services/ai/` - AI gate、context selector、prompt assembler、tool guard 等多阶段 AI pipeline
- `src/services/subscription/updateChecker/` - 订阅检查核心，按 `helpers/` 与 `modules/` 分层
- `src/dashboard/routes/api/modules/` - Dashboard 后端模块化 API 路由
- `dashboard/src/pages/groups/`, `settings/`, `logs/` - Dashboard 前端拆分后的主页面目录
- `src/services/bili_server_core/` - Python Bilibili service 主体实现
- `tools/preview-lab*.js` - 本地预览调试入口

## Common Development Commands

### Starting the Application
```bash
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm start
```

### Dashboard Development
```bash
cd dashboard
npm install
npm run dev
npm run build
npm run lint
```

### Running Tests
```bash
npm test
node test/unit/detectChargingContent.test.js
```

### Python Service Verification
```bash
python3 src/services/bili_server.py --port 10001
curl http://localhost:10001/health
```

说明：`src/services/bili_server.py` 现在更适合作为兼容入口，主体实现位于 `src/services/bili_server_core/`。

### Preview / Regression Checks
```bash
node tools/preview-lab.js "https://www.bilibili.com/opus/1183668934980665366" --fresh --out-name article-opus-check
node tools/preview-lab.js "https://www.bilibili.com/read/cv17878862/?opus_fallback=1" --fresh --out-name article-cv-check
node tools/preview-lab.js "https://t.bilibili.com/1181751663738748928" --fresh --out-name long-dynamic-check
node tools/preview-lab-web.js
```
```

- [ ] **Step 3: 重新核对命令来源**

Run:

```bash
node -e "const root=require('./package.json'); const dash=require('./dashboard/package.json'); console.log('root test =', root.scripts.test); console.log('dashboard build =', dash.scripts.build); console.log('dashboard lint =', dash.scripts.lint)"
```

Expected:
- 输出 `root test = mocha --exit "test/unit/**/*.test.js"`
- 输出 `dashboard build = vite build`
- 输出 `dashboard lint = eslint .`

- [ ] **Step 4: 验证新文案已覆盖关键入口**

Run:

```bash
grep -nE 'src/services/bili_server_core|tools/preview-lab-web.js|npm test|npm run lint|src/services/subscription/updateChecker/' CLAUDE.md
```

Expected:
- 能命中新增后的目录和命令说明
- 原有“placeholder”旧描述不应再作为当前事实保留

### Task 2: 重写架构总览与关键代码位置

**Files:**
- Modify: `CLAUDE.md`
- Verify against: `src/bot.js`
- Verify against: `src/handlers/messageHandler.js`
- Verify against: `src/handlers/linkHandler.js`
- Verify against: `src/handlers/aiHandler.js`
- Verify against: `src/services/subscription/updateChecker/UpdateChecker.js`
- Verify against: `src/dashboard/routes/api/index.js`

- [ ] **Step 1: 重写 `Architecture Overview` 的主链路说明**

将旧的“Core Message Flow + Key Architectural Components”改写成以下结构化内容：

```md
## Architecture Overview

### Startup Lifecycle
- `src/bot.js` 负责启动 WebSocket、Dashboard、Python ServiceManager、MCP manager 与订阅服务。
- 启动时会预热 `warmupEmojiIndexProvider()`，建立 `global.bot` 运行态，并在连接成功后启动群列表刷新与下载清理调度。
- `post_type === 'request'` 交给 `requestApprovalService`，消息事件交给 `messageHandler`。

### Message Flow
1. `messageHandler.js` 先处理机器人自身消息过滤、私聊权限、审批流回复、幂等去重。
2. 群消息走 `ensureGroupConfig(groupId)`、黑名单与群启用检查。
3. 非命令消息写入 context / vector memory / user profile 元数据。
4. 命令优先于链接解析执行。
5. 链接处理通过 `linkHandler -> biliApi -> ServiceManager -> bili_server_core -> imageGenerator`。
6. AI 回复不是单一概率判断，而是 `replyGateService -> contextSelectorService -> responseModeService -> aiHandler` 的多阶段管线。

### AI Pipeline
- `src/services/ai/idempotency.js`：AI 幂等去重
- `src/services/ai/replyGateService.js`：决定是否应回复
- `src/services/ai/contextSelectorService.js`：选择最近上下文与候选记忆
- `src/services/ai/responseModeService.js`：识别回复模式
- `src/services/ai/botFactsService.js`：注入 bot facts
- `src/services/ai/promptAssemblerService.js`：组装 prompt
- `src/services/ai/toolExecutionGuard.js`：收紧工具调用边界

### Subscription Architecture
- `subscriptionManager.js` 负责订阅数据持久化、schema 迁移、cookie followings 状态保留。
- `updateChecker/` 目录按 `helpers/` 与 `modules/` 分层，重点包括 state advance、dedup key、group reachability、notify、feed、manual/unified checks。
- 订阅系统同时处理动态、视频、专栏、直播、番剧，并维护 cookie 同步用户与手动订阅用户的统一状态推进。

### Dashboard Architecture
- 后端入口是 `src/dashboard/server.js`，API 主体是 `src/dashboard/routes/api/index.js + modules/*.js + shared/*.js`。
- 前端主页面已拆分为 `dashboard/src/pages/groups/`、`settings/`、`logs/` 下的 hooks/components/constants/utils。
- Logs 页面与日志 API 是当前重要调试入口，不再只依赖手动 tail 日志文件。

### Python Service Architecture
- Python 主体位于 `src/services/bili_server_core/`。
- `web/routes.py` 与 `web/handlers.py` 负责 HTTP 层；`services/*.py` 负责各 B 站资源类型；`auth/` 与 `download/` 分别处理鉴权与下载。
- `src/services/bili_server.py` 仍可作为兼容启动入口，但新增功能应优先落在 `bili_server_core/`。
```

- [ ] **Step 2: 将 `Critical Code Locations` 改为按主题分组的文件地图**

把表格替换为如下风格：

```md
## Key Code Locations

### Runtime & Lifecycle
- `src/bot.js` - 启动顺序、WebSocket 生命周期、群列表同步、请求审批事件分发
- `src/services/ServiceManager.js` - Python 子进程托管与 health check
- `src/dashboard/server.js` - Dashboard backend 启动入口

### Message / Link / AI Entry
- `src/handlers/messageHandler.js` - 消息入口、权限过滤、命令优先级、AI/链接链路串联
- `src/handlers/linkHandler.js` - 多类型 B 站链接解析与 URL 规范化
- `src/handlers/aiHandler.js` - LLM 调用、prompt 注入、工具轮询

### AI Services
- `src/services/ai/replyGateService.js`
- `src/services/ai/contextSelectorService.js`
- `src/services/ai/responseModeService.js`
- `src/services/ai/promptAssemblerService.js`
- `src/services/ai/toolExecutionGuard.js`

### Subscription Core
- `src/services/subscription/subscriptionManager.js`
- `src/services/subscription/updateChecker/UpdateChecker.js`
- `src/services/subscription/updateChecker/helpers/stateAdvance.js`
- `src/services/subscription/updateChecker/helpers/dedupKey.js`
- `src/services/subscription/updateChecker/helpers/groupReachability.js`
- `src/services/subscription/updateChecker/modules/feed.js`
- `src/services/subscription/updateChecker/modules/notify.js`

### Dashboard API / Frontend
- `src/dashboard/routes/api/index.js`
- `src/dashboard/routes/api/modules/`
- `dashboard/src/pages/groups/`
- `dashboard/src/pages/settings/`
- `dashboard/src/pages/logs/`

### Rendering / Preview / Python
- `src/services/imageGenerator/`
- `src/services/previewLab/`
- `src/services/bili_server_core/`
```

- [ ] **Step 3: 验证新架构节标题和关键词存在**

Run:

```bash
grep -nE 'Startup Lifecycle|AI Pipeline|Subscription Architecture|Dashboard Architecture|Python Service Architecture|Key Code Locations' CLAUDE.md
```

Expected:
- 所有新节标题都能命中
- 旧的单表式关键位置说明已经被新的主题地图替代

### Task 3: 更新测试、文档组织、调试技巧和常见坑

**Files:**
- Modify: `CLAUDE.md`
- Verify against: `test/unit/`
- Verify against: `docs/plans/`
- Verify against: `src/dashboard/routes/api/modules/logs.js`

- [ ] **Step 1: 将 `Testing Strategy` 改成“当前验证路径”**

把旧的“未来推荐补测试”大段替换为：

```md
## Testing & Verification

### Primary Test Entry
- `npm test` 使用 Mocha 运行 `test/unit/**/*.test.js`
- 单文件调试仍可直接运行 `node test/unit/<file>.test.js`

### Current Coverage Areas
现有单测已覆盖以下重点：
- message / link / AI pipeline
- subscription state advance / dedup / logging
- dashboard API、logs、video download、at-all 行为
- image generator 的 richtext / emoji / 渲染契约
- bot lifecycle 与 ServiceManager logging

### Preview Regression
- 使用 `tools/preview-lab.js` 生成 PNG / JSON / HTML / manifest
- 需要交互式调试时使用 `tools/preview-lab-web.js`
- 产物统一写入 `test/output/`

### Runtime Verification
- Python service: `/health` 与关键 endpoint
- Dashboard: `npm --prefix dashboard run build`、`npm --prefix dashboard run lint`
- Logs: 优先通过 Logs 页面或 `/api/logs/recent` 检查链路
```

- [ ] **Step 2: 更新 `Documentation Organization`，统一计划目录规则**

把计划文档规则改成用户要求的版本：

```md
## Documentation Organization

### Directory Structure
- `docs/plans/` - 活跃计划文档，新的设计/实现计划统一写在这里
- `docs/done/` - 已完成计划与执行记录
- `docs/images/` - 截图、视觉参考与预览样例
- `docs/napcat_interface/` - NapCat 接口材料

### Plan Placement Rule
- 后续计划文档统一写入 `docs/plans/`
- 执行完成后，如有需要再移动到 `docs/done/`
```

- [ ] **Step 3: 更新 `Debugging Tips` 与 `Common Pitfalls`**

将旧式“手改源码打日志”建议收缩为如下风格：

```md
## Debugging Tips
- 优先使用现有日志体系与 Dashboard Logs 页面，而不是先改源码打日志。
- 链接/卡片问题优先跑 `tools/preview-lab.js`。
- Python 链路问题优先查 `/health`、端口占用和 orphan process。
- 只在现有日志和 targeted tests 不足以定位时，才添加临时调试代码。

## Common Pitfalls
1. `groupId` 必须尽早转成字符串，尤其在 WebSocket 与 Dashboard API 入口。
2. Root 私聊会被映射为 `private_<userId>`，不要把它当普通群号处理。
3. Python 服务可能因孤儿进程导致版本漂移，重启前先确认端口占用和 health。
4. 订阅状态字段必须完整保留：`lastDynamicId`、`lastLiveStatus`、`lastVideoId`、`lastArticleId`。
5. Groups 页面不要依赖硬编码 tab index，应以 tab key 为准。
6. 调整 Dashboard 配置项时，要同时检查后端白名单、前端面板与群级 API 是否同步更新。
```

- [ ] **Step 4: 用命令确认新文案与目录规则生效**

Run:

```bash
grep -nE 'docs/plans/|Testing & Verification|Logs 页面|private_<userId>|lastVideoId|lastArticleId' CLAUDE.md
```

Expected:
- 能命中新的测试章节
- 能命中 `docs/plans/` 的统一计划目录规则
- 能命中 `private_<userId>` 与订阅状态字段说明

### Task 4: 做一轮一致性清理并验证旧表述已退出主文档

**Files:**
- Modify: `CLAUDE.md`
- Verify against: `package.json`
- Verify against: `dashboard/package.json`
- Verify against: `src/bot.js`

- [ ] **Step 1: 删除剩余的旧结论和误导性模板**

手动清理以下类型内容：

```md
- “npm test is still a placeholder”
- “Run all tests (when implemented)”
- 过长的“Adding New Content Type Support”五步模板
- 过长的“Adding a New Command”模板化伪代码
- “No configured linters” 这种与 dashboard 子项目事实冲突的表述
- 大段要求先去源码里手动打 debug log 的建议
```

- [ ] **Step 2: 运行一致性检查命令**

Run:

```bash
grep -nE 'placeholder|Run all tests \(when implemented\)|No configured linters|Add debug logging in `/src/bot.js`|Adding New Content Type Support|Adding a New Command' CLAUDE.md
```

Expected:
- 无输出

- [ ] **Step 3: 运行脚本与路径核对命令**

Run:

```bash
node -e "const root=require('./package.json'); const dash=require('./dashboard/package.json'); console.log(root.scripts.test); console.log(dash.scripts.build); console.log(dash.scripts.lint)" && test -f src/bot.js && test -f src/handlers/messageHandler.js && test -f src/services/bili_server_core/main.py && test -f src/dashboard/routes/api/index.js && test -f tools/preview-lab-web.js && echo OK
```

Expected:
- 打印 root / dashboard 的当前脚本值
- 最后一行输出 `OK`

- [ ] **Step 4: 目检最终 diff**

Run:

```bash
git diff -- CLAUDE.md
```

Expected:
- diff 只包含 `CLAUDE.md`
- 改动聚焦于事实校正、结构重排和高价值说明补充

### Task 5: 可选提交文档变更

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 仅在用户明确要求提交时创建 commit**

如果用户明确要求提交，运行：

```bash
git add CLAUDE.md && git commit -m "docs: refresh CLAUDE.md for current architecture"
```

Expected:
- 生成仅包含 `CLAUDE.md` 的文档提交

如果用户没有要求提交：
- 跳过这一步，保留未提交变更

---

## Self-Review

### Spec coverage
- 规格要求的事实校正：Task 1、Task 4 覆盖
- 规格要求的架构补全：Task 2 覆盖
- 规格要求的测试/调试/坑位更新：Task 3 覆盖
- 用户新增的计划文档目录偏好：Task 3 明确落到 `docs/plans/`

### Placeholder scan
- 计划内没有 `TODO`、`TBD`、`implement later` 一类占位符
- 每个改动任务都包含了具体要写入的 Markdown 文案或要删除的旧表述
- 每个验证步骤都给出了可执行命令与预期结果

### Type consistency
- 全文统一使用 `CLAUDE.md`、`docs/plans/`、`src/services/bili_server_core/`、`tools/preview-lab-web.js` 等已核对过的实际路径
- Dashboard 脚本统一以 `dashboard/package.json` 中的 `build` / `lint` 为准

Plan complete and saved to `docs/plans/2026-03-26-claude-md-refresh-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
