# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bili QQ Bot is a Node.js + Python hybrid application that connects QQ groups to Bilibili content via NapCat (OneBot v11 protocol). It parses Bilibili URLs, generates preview cards using Puppeteer, and includes AI chat with RAG-based memory and subscription monitoring.

**Tech Stack:** Node.js 18+, Python 3.8+, Express 5, WebSocket, Puppeteer, bilibili-api-python

## Common Development Commands

### Starting the Application

```bash
# Local development (requires NapCat running separately)
npm install
pip install bilibili-api-python
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

- **Renderers:** Pure functions returning HTML strings (video.js, dynamic.js, etc.)
- **Components:** Reusable pieces (richtext.js, media.js, vote.js)
- **Generators:** Combine renderers with browser instance (previewCard.js, helpCard.js)
- **Theme System:** `theme.js` handles dark/light mode with color extraction

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
├── cookies*.json       # Bilibili credentials (global + per-group)
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
- Detects: new dynamics, live status changes, bangumi episodes
- Cookie-based follow syncing (per-group)
- Notifications sent to all subscribed groups

**Feed Deduplication:**

订阅系统自动跳过视频/专栏投稿的自动动态，避免重复推送：

**跳过规则：**
- 视频投稿自动动态：`major.type === 'MAJOR_TYPE_ARCHIVE'` 或 `item.type === 'DYNAMIC_TYPE_AV'`
- 专栏投稿自动动态：`major.type === 'MAJOR_TYPE_OPUS'` 且 `jump_url` 匹配 `/read/cv\d+`

**保留推送：**
- 图文动态（Opus但不含专栏链接）
- 转发动态、纯文字动态、直播推荐等

**实现位置：**
- `updateChecker.js` - `shouldSkipDynamic()` 方法
- 在 `checkUserDynamic()` 和 `processDynamicFeed()` 中调用

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
| Image generation | `/src/services/imageGenerator/index.js` | `generate()` |
| Python API | `/src/services/bili_server.py` | Handler functions (1300+ lines) |

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

2. **Add Python handler** to `/src/services/bili_server.py`:
```python
async def get_my_type_info(id, group_id=None):
    # Use bilibili_api classes
    return {"status": "success", "type": "my_type", "data": info}
```

3. **Add route** in `bili_server.py`:
```python
app.add_routes([
    web.post('/my_type', handle_my_type),
])
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
- **routes/api.js:** RESTful endpoints for config, groups, subscriptions
- **middleware/auth.js:** JWT authentication

### Frontend (React/Vite)

Located in `/dashboard/src/`:
- **Pages:** Dashboard, Login, Groups, Subscriptions, Config
- **Components:** GlassCard, GlassModal (Tailwind + glassmorphism)
- **API Client:** `/dashboard/src/utils/auth.js` with Axios + JWT interceptor

### Adding Dashboard Features

1. **Backend API:** Add route to `/src/dashboard/routes/api.js`
2. **Frontend Page:** Create in `/dashboard/src/pages/`
3. **Routing:** Update `/dashboard/src/App.jsx`
4. **Build:** `cd dashboard && npm run build` (outputs to `dashboard/dist`)

## Testing Strategy

Currently no automated tests exist (`npm test` is a placeholder).

### Recommended Test Structure

**Unit Tests (to be added):**
- Config resolution logic (`.env` → `config.json` → defaults)
- Link extraction regex patterns
- Vector memory LRU eviction
- AI context message cleaning (CQ code removal)
- Storage utils (size checks, atomic writes)

**Integration Tests (to be added):**
- WebSocket message routing
- Python service communication
- Dashboard API routes
- Subscription polling cycle

**Mocking Targets:**
- `ws` for WebSocket events
- `axios` for Bilibili API responses
- `fs` for file I/O operations
- `puppeteer` browser instances

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

### Monitor Python Service

```bash
# View Python service logs
docker logs bili-qq-bot | grep PyServer

# Or in local dev
tail -f logs/application.log | grep bili_server
```

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
- **Python:** snake_case (`bili_server.py`)
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

2. **Tab Index Misalignment:** When adding new tabs to `Groups.jsx`, update all hardcoded tab indices (e.g., sync tab changed from 4 to 5 after adding admin tab).

3. **Group Config Not Loaded:** Always call `ensureGroupConfig(groupId)` before accessing `groupConfigs[groupId]`.

4. **Python Service Timeout:** Default idle shutdown is 1 hour. Increase in `ServiceManager.js` if needed.

5. **WebSocket Reconnection:** Connection state managed in `bot.js`. Never manually reconnect in handlers.

6. **Atomic Write Violations:** Always use `asyncWriteWithBackup()` for data files to prevent corruption.

7. **GroupId类型不一致**：JavaScript对象键必须是字符串。确保所有groupId在使用前转换为字符串：`String(groupId)`。WebSocket消息中的groupId可能是数字类型，必须立即转换以确保配置访问正确（`groupConfigs[123] !== groupConfigs["123"]`）。

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

// With caching
let cached = await biliApi.getVideoInfo('BV1xx411c7mD', groupId, 600) // 600s TTL
```

### Generating Preview Images

```javascript
const imageGenerator = require('./services/imageGenerator')

let buffer = await imageGenerator.generate(data, {
    type: 'video',  // video, dynamic, article, live, user, bangumi
    groupId: '123456789',
    theme: 'dark'  // or 'light', auto-detected if omitted
})

// Save or send
fs.writeFileSync('/path/to/preview.png', buffer)
```
