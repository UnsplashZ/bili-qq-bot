# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bili QQ Bot is a Node.js + Python hybrid application that connects QQ groups to Bilibili content via NapCat (OneBot v11 protocol). It parses Bilibili URLs, generates preview cards using Puppeteer, and includes AI chat with RAG-based memory and subscription monitoring.

**Tech Stack:** Node.js 18+, Python 3.8+, Express 5, WebSocket, Puppeteer, bilibili-api-python

## Project Structure

```
bili-qq-bot/
├── src/                    # Main application source
│   ├── bot.js              # Entry point, WebSocket connection
│   ├── config.js           # Configuration management
│   ├── commands/           # Command modules
│   ├── handlers/           # Message, link, AI handlers
│   ├── services/           # Core services (BiliApi, ImageGenerator, etc.)
│   ├── utils/              # Utilities (logger, storage, cache)
│   └── dashboard/          # Dashboard backend (Express)
├── dashboard/              # Dashboard frontend (React/Vite)
│   ├── src/                # React components and pages
│   └── dist/               # Production build (served by bot)
├── test/                   # Test files and generated outputs
│   ├── unit/               # Unit tests (*.test.js)
│   └── output/             # Local generated preview images
├── docs/                   # Documentation
│   ├── plans/              # Active plans (work in progress)
│   ├── done/               # Completed plans and records
│   ├── images/             # Screenshots and visual references
│   └── napcat_interface/   # NapCat interface docs/assets
├── data/                   # Persistent data (not in git)
│   ├── cache/              # API response cache
│   ├── contexts/           # AI conversation history
│   ├── vectors/            # Vector embeddings
│   ├── cookies.json        # Bilibili credentials
│   └── subscriptions.json  # Subscription mappings
├── config/                 # Configuration files
│   └── mcp_servers.json    # MCP tool definitions
├── fonts/                  # Custom fonts for image rendering
├── logs/                   # Application logs
└── napcat/                 # NapCat QQ client data
```

**Key Directories:**
- **test/unit/** - Unit tests (`*.test.js`)
- **test/output/** - Local generated preview outputs (including image preview tests)
- **docs/plans/** - New plan documents (active work) must be created here
- **docs/done/** - Completed plans are moved here after execution
- **docs/images/** - Screenshots and visual references
- **data/** - Runtime data (excluded from git, auto-created on first run)

## Common Development Commands

### Starting the Application

```bash
# Local development (requires NapCat running separately)
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
npm start

# Docker deployment
docker-compose up -d
docker-compose logs -f  # View logs
docker-compose down     # Stop services
```

### Dashboard Development

The dashboard is a separate React/Vite application:

```bash
cd dashboard
npm install
npm run dev     # Development server (port 5173)
npm run build   # Production build to dashboard/dist
```

After building, the main bot serves static files from `dashboard/dist` at port 3000.

### Python Service Testing

The Bilibili API service runs independently:

```bash
# Test the Python server directly
python3 src/services/bili_server.py --port 10001

# Health check
curl http://localhost:10001/health
```

### Linting & Code Quality

No configured linters. Follow existing code style:
- **JavaScript:** 4-space indentation, no semicolons
- **Python:** PEP 8 style, 4-space indentation

## Architecture Overview

### Core Message Flow

```
QQ User → NapCat (WebSocket) → bot.js → MessageHandler
                                              ↓
                         ┌────────────────────┴─────────────────────┐
                         ↓                    ↓                      ↓
                    LinkHandler         CommandManager          AIHandler
                         ↓                    ↓                      ↓
                    BiliApi             Execute Commands      VectorMemory
                         ↓                                           ↓
                  Python Server                              RAG Retrieval
                         ↓                                           ↓
                  ImageGenerator ←────────────────────────────── LLM API
                         ↓
                  Send to QQ Group
```

### Key Architectural Components

**1. Dual Configuration System**

- **Layer 1 (`.env`):** Startup config (API keys, WS_URL, ADMIN_QQ)
- **Layer 2 (`config.json`):** Runtime config (hot-reloadable via commands)
- **Priority:** config.json > environment variable > default
- **Group Overrides:** Each group in `groupConfigs[groupId]` can override global settings

Implementation: `/src/config.js` with META schema defining all config keys.

**2. Service Manager Pattern**

`ServiceManager.js` manages the Python subprocess lifecycle:
- Health checks via `/health` endpoint
- Auto-restart on failure (exponential backoff)
- Idle shutdown after 1 hour
- All Bilibili API calls proxy through this service

**3. Image Generation Pipeline**

Modular Puppeteer-based system (`/src/services/imageGenerator/`):

```
Renderers (Pure HTML) → Generators (Browser + Render) → PNG Output
```

- **Renderers** (`renderers/`): Pure functions returning HTML strings (video.js, dynamic.js, article.js, live.js, bangumi.js, user.js)
- **Components** (`renderers/components/`): Reusable pieces (richtext.js, media.js, vote.js)
- **Generators** (`generators/`): Combine renderers with browser instance (previewCard.js, helpCard.js, aiHelpCard.js, subscriptionList.js)
- **Core** (`core/`): Browser management (browser.js), formatters (formatters.js), theme system (theme.js — dark/light mode with color extraction)

When adding new content types:
1. Create renderer in `renderers/`
2. Add case to `generators/previewCard.js`
3. Update `CARD_WIDTH` and viewport settings if needed

**4. Storage Patterns**

All data in `/data/` directory:

```
/data/
├── cache/              # LRU cache (1GB limit, API responses)
├── contexts/           # AI conversation history (per-group JSON)
├── vectors/            # Vector embeddings (per-group, 200MB max)
├── cookies.json        # Bilibili credentials (global only)
├── cookies_map.json    # Cookie account mapping
├── subfollowers.json   # Subscription follower state
└── subscriptions.json  # Subscription mappings
```

**Atomic Write Pattern:** Used throughout via `storageUtils.js`:
```javascript
// Write to temp → validate → rename (atomic operation)
await asyncWriteWithBackup(filePath, data, createBackup=true)
```

**5. Vector Memory Architecture**

Three-tier caching (`vectorMemoryService.js`):
- **L1:** In-memory vectors (200MB limit)
- **L2:** LRU group cache (3 active groups max)
- **L3:** Query-level cache (20 queries/group, 5min TTL)

Memory is auto-trimmed when size limits are exceeded (10% default trim ratio).

**6. Subscription System**

Facade pattern (`subscriptionService.js` → `subscription/SubscriptionManager.js`):
- Periodic polling (default 60s interval)
- Detects: new dynamics, videos, articles, live status changes, bangumi episodes
- Cookie-based follow syncing (per-group)
- Notifications sent to all subscribed groups

**Content Type Detection:**

订阅系统支持多种内容类型推送：

1. **视频投稿** (`checkUserVideo`):
   - 使用 `/user_videos` API端点获取最新视频
   - 状态追踪：`lastVideoId`
   - 空数组处理：区分初始化/正常检查/强制检查三种场景

2. **专栏文章** (`checkUserArticle`):
   - 使用 `/user_articles` API端点获取最新专栏
   - 状态追踪：`lastArticleId`
   - 空数组处理：同视频投稿

3. **动态更新** (`checkUserDynamic`):
   - 获取用户动态流
   - 状态追踪：`lastDynamicId`
   - 应用去重逻辑（见下方）

4. **直播状态** (`checkUserLive`):
   - 检测开播/下播事件
   - 状态追踪：`lastLiveStatus`

**Feed Deduplication:**

订阅系统自动跳过视频/专栏投稿的自动动态，避免重复推送：

**跳过规则：**
- 视频投稿自动动态：`major.type === 'MAJOR_TYPE_ARCHIVE'` 或 `item.type === 'DYNAMIC_TYPE_AV'`
- 专栏投稿自动动态：`major.type === 'MAJOR_TYPE_OPUS'` 且 `jump_url` 匹配 `/read/cv\d+`

**保留推送：**
- 图文动态（Opus但不含专栏链接）
- 转发动态、纯文字动态、直播推荐等

**状态持久化：**
- Cookie同步用户：状态存储在 `subscriptions.json` 的 `cookieFollowings` 字段
- 手动订阅用户：状态存储在 `subscriptions` 数组中
- 定期刷新（每小时）时必须保留所有状态字段

**实现位置：**
- `subscription/updateChecker/modules/feed.js` - `shouldSkipDynamic()`（动态去重逻辑）
- `subscription/updateChecker/modules/unifiedChecks.js` - `checkUserVideoUnified()` 与 `checkUserArticleUnified()`（视频/专栏检查）
- `subscription/subscriptionManager.js` - `setCookieFollowings()`（状态保留）
- 在 `checkUserDynamic()` 与 `processDynamicFeed()` 调用链中生效

### Critical Code Locations

| Feature | Primary File | Key Function/Class |
|---------|-------------|-------------------|
| WebSocket connection | `/src/bot.js` | Lines 34-148 |
| Message routing | `/src/handlers/messageHandler.js` | `handleMessage()` |
| URL extraction | `/src/handlers/linkHandler.js` | `extractUrls()` |
| Command dispatch | `/src/commands/index.js` | `dispatch()` |
| AI context | `/src/handlers/aiHandler.js` | `getReply()` |
| Vector search | `/src/services/vectorMemoryService.js` | `searchSimilar()` |
| Config resolution | `/src/config.js` | Lines 84-200 (META) |
| Image generation | `/src/services/imageGenerator/index.js` | `generatePreviewCard()` |
| Python API | `/src/services/bili_server_core/` | `web/handlers.py` + `services/*.py` |

## Configuration System Deep Dive

### Adding New Config Keys

1. Add to META in `/src/config.js`:
```javascript
META = {
  myNewKey: { env: 'MY_NEW_KEY', def: 'default', type: 'string' }
}
```

2. Config automatically gets getter/setter:
```javascript
sysConfig.myNewKey = 'new value'  // Sets in config.json
let val = sysConfig.myNewKey      // Reads: config.json > env > default
```

3. For group-level overrides, access via:
```javascript
let groupConfig = sysConfig.groupConfigs[groupId]
groupConfig.myNewKey = 'group-specific value'
```

### Config Persistence

All `config.json` writes are debounced (500ms) via `saveConfigDebounced()` to prevent I/O storms.

### AI Function Toggles

AI功能支持全局和群级分级开关：

**全局配置（META）：**
- `aiEnabled`: 全局AI开关（默认true）
- `aiRagEnabled`: 全局RAG开关（默认true）

**群级配置（groupConfigs[groupId]）：**
```javascript
{
  aiEnabled?: boolean,      // 可选，不设置则继承全局
  aiRagEnabled?: boolean    // 可选，不设置则继承全局
}
```

**权限检查函数：**
```javascript
// 检查群是否启用AI功能
config.isAiEnabledForGroup(groupId)

// 检查群是否启用RAG功能（依赖AI启用）
config.isRagEnabledForGroup(groupId)
```

**依赖关系：**
- RAG功能需要AI功能启用（AI关闭时RAG自动不可用）
- 群级配置优先于全局配置
- 全局开关可以强制关闭所有群的功能

**使用位置：**
- `aiHandler.js` - AI回复前检查`isAiEnabledForGroup()`
- `aiHandler.js` - 向量检索前检查`isRagEnabledForGroup()`
- Dashboard - Settings页面管理全局开关
- Dashboard - Groups页面管理群级开关

### Cookie Management

系统仅使用全局Cookie（`data/cookies.json`）进行Bilibili API认证：

- 所有群组共享同一个全局Cookie
- 群级Cookie文件（`cookies_{groupId}.json`）已废弃
- Dashboard Settings页面管理全局Cookie
- Dashboard Groups页面不再显示Cookie管理选项

## Message Handler Pipeline

When a message arrives from QQ:

1. **Pre-checks** (`messageHandler.js`):
   - Blacklist filtering (global + per-group)
   - Group enabled/disabled status
   - JSON mini-program extraction

2. **AI Context Recording**:
   - All messages saved to `/data/contexts/{groupId}.json`
   - Even if not replied to, used for future context

3. **Link Processing**:
   - Regex extraction (10+ patterns for bilibili.com, b23.tv, etc.)
   - Cache check (TTL from `linkCacheTimeout`)
   - Fetch via `BiliApi` → Python service
   - Generate preview image via `ImageGenerator`

4. **Command Handling**:
   - Commands start with `/` (e.g., `/订阅用户 123456`)
   - Permission check (user → group admin → root admin)
   - Dispatch to appropriate command module

5. **AI Processing**:
   - Probability check (`aiProbability` or `@bot` mention)
   - Vector memory search for relevant context
   - Build prompt with history + retrieved memories
   - Call LLM API (supports OpenAI-compatible endpoints)

## Bilibili Content Types

### Supported URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Video | `/video/BVxxx`, `/av123` | BV1xx411c7mD |
| Bangumi | `/bangumi/play/ss123`, `/bangumi/play/ep456` | ss12345, ep67890 |
| Dynamic | `t.bilibili.com/123` | Dynamic ID |
| Article | `/read/cv123` | cv12345 |
| Live | `/live/123` | Room ID |
| Opus | `/opus/123` | Opus ID |
| User | `/space/123` | User UID |
| Short Link | `b23.tv/xxx` | Auto-resolves |

### Adding New Content Type Support

1. **Add URL regex** to `/src/handlers/linkHandler.js`:
```javascript
const MY_TYPE_REGEX = /pattern/
```

2. **Add Python service function** to the appropriate module under `/src/services/bili_server_core/services/`:
```python
async def get_my_type_info(id, group_id=None):
    # Use bilibili_api classes
    return {"status": "success", "type": "my_type", "data": info}
```

3. **Add web handler + route**:
```python
# /src/services/bili_server_core/web/handlers.py
async def handle_my_type(request):
    ...

# /src/services/bili_server_core/web/routes.py
web.post('/my_type', handle_my_type)
```

4. **Add renderer** to `/src/services/imageGenerator/renderers/mytype.js`:
```javascript
function renderMyType(data, opts) {
    return `<html>...</html>`
}
module.exports = { renderMyType }
```

5. **Update generator** in `/src/services/imageGenerator/generators/previewCard.js`:
```javascript
case 'my_type':
    html = renderMyType(data, opts)
    break
```

## Command System

### Command Structure

All commands inherit from a base pattern in `/src/commands/`:

```javascript
module.exports = {
    name: 'MyCommand',
    execute: async function(context) {
        // context: { bot, groupId, userId, message, isGroupMessage, isAdmin, isRoot }

        // Return message object or null
        return { type: 'text', message: 'Response' }
    }
}
```

### Adding a New Command

1. Create file in `/src/commands/` (e.g., `mycommand.js`)
2. Implement `execute` function with permission checks
3. Register in `/src/commands/index.js`:
```javascript
const myCommand = require('./mycommand')

async function dispatch(context) {
    if (message.startsWith('/mycommand')) {
        return await myCommand.execute(context)
    }
    // ...
}
```

### Permission Levels

Three levels checked in order:
1. **User:** Anyone (read-only operations)
2. **Group Admin:** Set via `/设置 管理员` (per-group config)
3. **Root Admin:** `ADMIN_QQ` from `.env` (global control)

Check in command:
```javascript
if (!context.isAdmin && !context.isRoot) {
    return { type: 'text', message: '权限不足' }
}
```

## AI System Integration

### Context Building

AI responses use multiple sources:
1. **Recent History:** Last N messages from `contexts/{groupId}.json` (N = `aiContextLimit`)
2. **Vector Memories:** Top K similar past messages via cosine similarity (K = `aiVectorSearchLimit`)
3. **System Prompt:** From `AI_SYSTEM_PROMPT` env var
4. **Timestamp Info:** Current time added to prompt for temporal awareness

### Message Flow

```javascript
// In aiHandler.js
async function getReply(groupId, message, userId) {
    // 1. Get conversation history
    let history = await aiContextService.getContext(groupId)

    // 2. Vector search for relevant memories
    let memories = await vectorMemoryService.searchSimilar(groupId, message)

    // 3. Build prompt with context
    let prompt = buildPrompt(history, memories, message)

    // 4. Call LLM
    let response = await callLLM(prompt)

    // 5. Save to context
    await aiContextService.addMessage(groupId, { role: 'assistant', content: response })

    return response
}
```

### Adding MCP Tool Support

MCP (Model Context Protocol) tools are defined in `/config/mcp_servers.json`:

```json
{
  "myTool": {
    "command": "node",
    "args": ["tool-server.js"],
    "transport": "stdio"
  }
}
```

MCPManager automatically discovers tools and makes them available to AI via function calling.

## Dashboard Architecture

### Backend (Express)

Located in `/src/dashboard/`:
- **server.js:** Express app setup, static file serving
- **routes/api.js:** Compatibility entry (re-export), implementation split under `routes/api/`
- **routes/api/index.js + routes/api/modules/*.js:** RESTful endpoints for config, groups, subscriptions
- **middleware/auth.js:** JWT authentication

### Frontend (React/Vite)

Located in `/dashboard/src/`:
- **Pages:** Dashboard, Login, Groups, Settings, Logs
- **Components:** GlassCard, GlassModal (Tailwind + glassmorphism)
- **API Client:** `/dashboard/src/utils/auth.js` with Axios + JWT interceptor

### Adding Dashboard Features

1. **Backend API:** Add route module under `/src/dashboard/routes/api/modules/`, then register it in `/src/dashboard/routes/api/index.js` (keep `/src/dashboard/routes/api.js` as compatibility entry)
2. **Frontend Page:** Create in `/dashboard/src/pages/`
3. **Routing:** Update `/dashboard/src/App.jsx`
4. **Build:** `cd dashboard && npm run build` (outputs to `dashboard/dist`)

## Testing Strategy

All test files and generated preview outputs are organized in the `/test/` directory.

### Test Organization

**Directory Structure:**
```
test/
├── unit/               # Unit tests
└── output/             # Generated files from local test runs
```

**Naming Convention:**
- Test files: `*.test.js` or `test_*.js`
- Generated previews: write to `test/output/` (prefer `test/output/previews/`)

### Current Testing Status

Unit tests exist in `test/unit/` and cover core modules such as message/link handlers, update checker, vector memory, dashboard API behavior, and video download config. `npm test` is still a placeholder — run individual files with `node`.

### Recommended Test Coverage

**Unit Tests (to be added in test/unit/):**
- Config resolution logic (`.env` → `config.json` → defaults)
- Link extraction regex patterns
- Vector memory LRU eviction
- AI context message cleaning (CQ code removal)
- Storage utils (size checks, atomic writes)
- Subscription system state management

**Integration Tests (future expansion):**
- WebSocket message routing
- Python service communication
- Dashboard API routes
- Subscription polling cycle
- Image generation pipeline

**Mocking Targets:**
- `ws` for WebSocket events
- `axios` for Bilibili API responses
- `fs` for file I/O operations
- `puppeteer` browser instances

### Running Tests

```bash
# Run all tests (when implemented)
npm test

# Run specific test file
node test/unit/detectChargingContent.test.js
```

## Documentation Organization

All documentation is organized in the `/docs/` directory with specific subdirectories for different purposes.

### Directory Structure

**docs/plans/** - Active implementation/design plans:
- Markdown format (`.md` files)
- Named with date prefix: `YYYY-MM-DD-topic.md`
- Contains: requirements, approach, implementation steps, risks
- New plans should be written here first

**docs/done/** - Completed implementation/design records:
- Move files from `docs/plans/` to `docs/done/` after execution is complete
- May also contain execution/retrospective records
- Preserves history of decisions and completed work

**docs/images/** - Screenshots and diagrams:
- Architecture diagrams
- UI screenshots
- Flow charts and visualizations

**docs/napcat_interface/** - NapCat interface documentation and related materials.

### Documentation Best Practices

**When to Create a Plan/Record Document:**
- Multi-file changes affecting 3+ files
- Complex logic changes (e.g., subscription system)
- New feature implementation
- Refactoring with architectural impact
- Placement rule: create in `docs/plans/`, move to `docs/done/` when finished

**When to Add Investigation Notes:**
- Non-obvious bugs requiring investigation
- Issues affecting multiple components
- Bugs with instructive lessons for future development
- Production incidents requiring postmortem

**Naming Convention:**
```
docs/plans/YYYY-MM-DD-{feature}-{action}-{type}.md
docs/done/YYYY-MM-DD-{feature}-{action}-{type}.md
docs/done/YYYY-MM-DD-{issue}-diagnosis.md
```

Examples:
- `docs/plans/2026-03-06-video-auth-badge-plan.md`
- `docs/done/2026-02-06-array-bounds-fix-design.md`
- `docs/done/2026-03-04-groups-page-split-plan.md`
- `docs/done/2026-02-06-cookie-sync-video-article-fix.md`

**Template Structure for Plans:**
```markdown
# Feature Name

## Context
[Background and motivation]

## Problem
[What needs to be fixed/implemented]

## Solution
[Proposed approach]

## Implementation Steps
1. [Step 1]
2. [Step 2]

## Risks and Mitigations
[Potential issues and how to handle them]

## Testing Strategy
[How to verify the solution works]
```

**Template Structure for Diagnosis:**
```markdown
# Issue Title

## Symptoms
[Observable problems]

## Investigation
[Steps taken to identify root cause]

## Root Cause
[What actually caused the issue]

## Solution
[How it was fixed]

## Prevention
[How to prevent similar issues in the future]
```

## Docker Deployment Notes

### Multi-Container Setup

`docker-compose.yml` defines two services:
- **napcat:** QQ client container (port 3001 WebSocket, port 6099 WebUI)
- **bili-qq-bot:** Main application (port 3000 Dashboard)

Network: `bot_network` (bridge mode) allows inter-container communication.

### Volume Mounts

```yaml
volumes:
  - ./config:/app/config        # Configuration files
  - ./data:/app/data            # Persistent data
  - ./logs:/app/logs            # Application logs
  - ./fonts:/app/fonts          # Custom fonts
  - ./napcat/qq:/app/.config/QQ # NapCat data (QQ account)
```

**Critical:** `NAPCAT_TEMP_PATH` and `NAPCAT_READ_PATH` must map to the same physical location for image sharing between bot and NapCat.

### Building Custom Images

Dockerfile includes:
- System fonts: Noto CJK, Symbola, Color Emoji
- Chromium for Puppeteer
- Python 3 + bilibili-api-python
- Node.js dependencies

To rebuild:
```bash
docker-compose build --no-cache
docker-compose up -d
```

## Debugging Tips

### Enable Verbose Logging

Edit `/src/utils/logger.js` to set log level:
```javascript
logger.level = 'DEBUG'  // Change from INFO
```

**Important:** Critical checks should use `logger.info()` or higher to ensure they're visible in production.

### Monitor Python Service

```bash
# Check if Python service is running
lsof -i :10001

# View Python service logs
docker logs bili-qq-bot | grep PyServer

# Or in local dev
tail -f logs/application.log | grep bili_server

# Test Python service health
curl http://localhost:10001/health

# Verify API endpoints exist
curl -X POST http://localhost:10001/user_videos -H "Content-Type: application/json" -d '{"uid": "123"}'
```

**Python Service Troubleshooting:**
- If API returns 404: Check if service is running old version (orphan process)
- If service not responding: Check logs for startup errors
- If authentication fails: Verify `data/cookies.json` has valid BUVID3

### Inspect WebSocket Messages

Add debug logging in `/src/bot.js`:
```javascript
ws.on('message', (data) => {
    logger.debug('[WS Raw]', data.toString())
    // ... existing code
})
```

### Check Cache Status

Cache is in-memory LRU. To inspect:
```javascript
// In cacheManager.js, add:
function getCacheStats() {
    return {
        size: cache.size,
        totalSize: currentSize,
        limit: MAX_CACHE_SIZE
    }
}
```

### Subscription State Debugging

Check current subscription states:
```javascript
// In subscriptionManager.js or via Dashboard API
const state = {
    manualSubs: subscriptions,
    cookieSubs: cookieFollowings
}
console.log(JSON.stringify(state, null, 2))
```

Look for:
- Missing `lastVideoId` or `lastArticleId` fields (indicates state not persisted)
- Null values (indicates initialization state)
- Unexpected resets (indicates refresh overwrote state)

### Creating Debug Scripts

When investigating complex issues, create one-off scripts under `/test/` (prefer temporary local usage and clean up after use):

```javascript
// test/temp_subscription_state.js
const subscriptionManager = require('../src/services/subscription/subscriptionManager')

async function main() {
    // Load current state
    await subscriptionManager.loadSubscriptions()

    // Test specific functionality
    const user = subscriptionManager.getCookieFollowingState('123456')
    console.log('User state:', user)

    // Verify state preservation after refresh
    await subscriptionManager.refreshCookieFollowings()
    const userAfter = subscriptionManager.getCookieFollowingState('123456')
    console.log('User state after refresh:', userAfter)

    // Compare states
    console.log('State preserved:', JSON.stringify(user) === JSON.stringify(userAfter))
}

main().catch(console.error)
```

**Remember to:**
- Write generated preview images to `test/output/`
- Document findings in `/docs/done/`
- Remove one-off scripts after investigation
- Add relevant insights to MEMORY.md

## Code Style Conventions

### JavaScript

- **No semicolons** (existing style)
- **4-space indentation**
- **Async/await over promises** (preferred pattern)
- **Modular exports:** `module.exports = { functionName }`
- **Logger usage:** Use `logger.info/warn/error` instead of console

### Python

- **PEP 8 compliant**
- **Type hints encouraged** but not enforced
- **Async handlers:** All route handlers are `async def`
- **Error handling:** Return `{"status": "error", "message": str(e)}`

### File Naming

- **JavaScript:** camelCase (`messageHandler.js`, `aiContextService.js`)
- **Python:** snake_case (`bili_server.py`, `video_service.py`)
- **React Components:** PascalCase (`GlassCard.jsx`, `Groups.jsx`)

## Security Considerations

### Credential Management

- **Never commit** `.env` or `config.json` files
- Bilibili cookies stored in `/data/cookies*.json` (not version controlled)
- JWT secret auto-generated if not in `.env` (warning logged)

### Input Validation

- CQ code sanitization in AI messages (prevent code injection)
- URL regex validation before API calls
- Command parameter bounds checking (e.g., `/AI 上下文 <1-50>`)

### Authorization Checks

Always check permissions before privileged operations:
```javascript
// Group-level commands
if (!isAdmin && !isRoot) {
    return { type: 'text', message: '权限不足' }
}

// Root-only commands
if (!isRoot) {
    return { type: 'text', message: '仅限根管理员' }
}
```

### Private Chat Restriction

私聊功能仅限Root管理员（`ADMIN_QQ`）使用：

```javascript
// messageHandler.js
if (messageData.message_type === 'private') {
    const isRootAdmin = config.isRootAdmin(userId);
    if (!isRootAdmin) {
        // 非Root管理员，发送提示并返回
        this.sendPrivateMessage(ws, userId, '此功能仅限管理员使用');
        return;
    }
    // Root管理员继续处理
}
```

群管理员（非Root）无法使用私聊功能。

## Performance Optimization

### Caching Strategy

- **Link Cache:** TTL-based (default 600s), per-group isolation
- **API Response Cache:** LRU eviction (1GB limit), stored in `/data/cache/`
- **Vector Query Cache:** 20 queries per group, 5min TTL

### Memory Management

- **Vector Service:** Auto-trim at 200MB (10% reduction)
- **AI Context:** Auto-trim at 200MB (removes oldest messages)
- **Debounced Saves:** Config writes batched (500ms delay)

### Image Generation

- **Browser Pooling:** Singleton Puppeteer instance (reused pages)
- **Viewport Optimization:** Fixed width (420px), dynamic height
- **Font Loading:** Pre-loaded system fonts (no network requests)

## Common Pitfalls

1. **Missing BUVID3:** Bilibili API returns 412 errors without valid device fingerprint. Ensure cookies include BUVID3 field.

2. **Tab State Drift:** In Groups page, avoid hardcoded tab indices. Keep tab definitions centralized in `dashboard/src/pages/groups/constants/tabs.js` and align submit/load logic with tab keys.

3. **Group Config Not Loaded:** Always call `ensureGroupConfig(groupId)` before accessing `groupConfigs[groupId]`.

4. **Python Service Timeout:** Default idle shutdown is 1 hour. Increase in `ServiceManager.js` if needed.

5. **WebSocket Reconnection:** Connection state managed in `bot.js`. Never manually reconnect in handlers.

6. **Atomic Write Violations:** Always use `asyncWriteWithBackup()` for data files to prevent corruption.

7. **GroupId类型不一致**：JavaScript对象键必须是字符串。确保所有groupId在使用前转换为字符串：`String(groupId)`。WebSocket消息中的groupId可能是数字类型，必须立即转换以确保配置访问正确（`groupConfigs[123] !== groupConfigs["123"]`）。

8. **数组越界访问**：在访问数组元素前必须检查数组长度。订阅系统中的 `newVideos[0]` 和 `newArticles[0]` 在空数组时会返回 `undefined`。使用提前失败原则：`if (array.length === 0) return`。

9. **Python服务版本不匹配**：Bot退出后Python服务可能成为孤儿进程继续运行。重启Bot前先检查进程：`lsof -i :10001`，必要时手动终止旧进程。考虑在启动时验证必需的API端点是否可用。

10. **订阅状态字段丢失**：`refreshCookieFollowings()` 定期刷新会覆盖状态。在 `setCookieFollowings()` 中必须保留所有状态字段（`lastDynamicId`、`lastLiveStatus`、`lastVideoId`、`lastArticleId`），不能只保留部分。

11. **Python API字段名不一致**：不同API端点返回的用户名字段可能不同（`uname` vs `name`）。使用前先检查Python服务返回的实际字段名，必要时使用 `||` 运算符提供回退：`follower.name || follower.uname || 'Unknown'`。

## Useful Code Patterns

### Sending Messages to Groups

```javascript
const notificationService = require('./services/notificationService')

await notificationService.sendGroupMessage(groupId, {
    type: 'text',
    message: 'Hello, world!'
})

// With image
await notificationService.sendGroupMessage(groupId, {
    type: 'image',
    file: 'file:///path/to/image.png'
})
```

### Accessing Group-Specific Config

```javascript
const sysConfig = require('./config')

// Ensure config exists
sysConfig.ensureGroupConfig(groupId)

// Read group setting (with fallback to global)
let groupConfig = sysConfig.groupConfigs[groupId]
let timeout = groupConfig.linkCacheTimeout ?? sysConfig.linkCacheTimeout

// Write group setting
groupConfig.linkCacheTimeout = 300
await sysConfig.saveConfigDebounced()
```

### Making Bilibili API Calls

```javascript
const biliApi = require('./services/biliApi')

// Fetch video info
let result = await biliApi.getVideoInfo('BV1xx411c7mD', groupId)
if (result.status === 'success') {
    console.log(result.data.title)
}
```

### Generating Preview Images

```javascript
const fs = require('fs')
const imageGenerator = require('./services/imageGenerator')

const base64 = await imageGenerator.generatePreviewCard(data, 'video', '123456789')
const buffer = Buffer.from(base64, 'base64')

// Save or send
fs.writeFileSync('test/output/previews/video-preview.png', buffer)
```
