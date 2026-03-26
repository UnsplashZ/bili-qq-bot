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
│   ├── services/           # Core services
│   │   ├── ai/             # AI chat, memory, profile, prompt helpers
│   │   ├── bili_server_core/ # Python API backend
│   │   ├── bili_server.py   # Python compatibility entry
│   │   ├── imageGenerator/  # Preview card rendering and generation
│   │   └── subscription/    # Subscription service and update checker
│   │       └── updateChecker/ # Feed, video, article, live checks
│   ├── dashboard/          # Dashboard backend (Express)
│   │   ├── routes/api/     # REST API implementation
│   │   └── middleware/     # Auth and request middleware
│   └── utils/              # Utilities (logger, storage, cache)
├── dashboard/              # Dashboard frontend (React/Vite)
│   ├── src/                # React app source
│   │   ├── pages/          # Pages (dashboard, login, groups/settings/logs)
│   │   └── utils/          # Frontend helpers
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
├── tools/                  # Local helper scripts
│   ├── preview-lab.js      # Preview Lab CLI
│   └── preview-lab-web.js  # Preview Lab Web
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
npm run lint    # ESLint check
```

After building, the main bot serves static files from `dashboard/dist` at port 3000.

### Python Service Testing

The Bilibili API service runs independently, with the main implementation in `src/services/bili_server_core/` and a compatibility entry still available at `src/services/bili_server.py`.

```bash
# Test the Python server directly
python3 src/services/bili_server.py --port 10001

# Health check
curl http://localhost:10001/health
```

### Targeted Preview / Regression Checks

Use `tools/preview-lab.js` for local preview regression checks and write generated files to `test/output/`; use `tools/preview-lab-web.js` for browser-based manual inspection.

```bash
# 文章型 opus
node tools/preview-lab.js "https://www.bilibili.com/opus/1183668934980665366" --fresh --out-name article-opus-check

# read/cv 专栏
node tools/preview-lab.js "https://www.bilibili.com/read/cv17878862/?opus_fallback=1" --fresh --out-name article-cv-check

# 长正文动态
node tools/preview-lab.js "https://t.bilibili.com/1181751663738748928" --fresh --out-name long-dynamic-check

# Preview Lab Web
node tools/preview-lab-web.js
```

Current expectations:
- main dynamic `.text-content` max height is `800px` (about 15 lines)
- article cover uses original image ratio instead of forced `21:9`
- article cards should not render `user-vip-label`

### Code Style

Use the main `Testing & Verification` section below for test and validation entry points.

Follow existing code style:
- **JavaScript:** 4-space indentation, no semicolons
- **Python:** PEP 8 style, 4-space indentation

## Architecture Overview

### Bot Runtime Lifecycle

`/src/bot.js` is the runtime entry point and owns the socket lifecycle around NapCat/OneBot. It keeps the cross-module runtime handle in one place and gates bot-scoped services on connection state.

- Establish and maintain the WebSocket connection
- Keep `global.bot` aligned with login and group state
- Start bot-scoped services only after the socket is ready
- Route transport events into the internal service boundaries
- Stop timers and loops cleanly on disconnect

### Message Pipeline

`/src/handlers/messageHandler.js` is the main ingress for QQ messages. It defines the processing order without expanding the downstream implementation details that are documented later in the file.

- Normalize group and private conversation identity
- Apply early guards for self messages, permissions, blacklist, and enablement
- Persist context inputs before reply selection
- Dispatch commands before link handling
- Hand off link previews and AI replies to dedicated handlers
- Keep private-session scope separate from group scope

### AI Pipeline

The AI path is split across `messageHandler.js`, `handlers/aiHandler.js`, and the AI support services under `/src/services/ai/`. This section only describes the division of responsibility.

- Separate reply admission from prompt construction and model invocation
- Keep context, response shaping, and execution safety in distinct services
- Centralize final orchestration in `aiHandler.js`
- Treat memory, bot facts, and tool control as supporting layers
- Avoid duplicating the detailed AI step sequence from later sections

### Subscription Architecture

The subscription subsystem is split into scheduling, persistent state, and polling/checking. The boundary between them stays narrow so feed-specific logic can reuse shared helpers without owning lifecycle concerns.

- `subscriptionService.js` handles bot lifecycle integration and scheduling
- `subscriptionManager.js` owns persistent state and state mutation helpers
- `updateChecker/` contains polling and content-specific checks
- Shared helper modules cover state advancement, deduplication, and reachability
- Checker modules focus on feed/video/article/live/bangumi processing and notification dispatch

### Dashboard Architecture

The dashboard is a two-part system: an Express backend embedded in the bot process and a separate React/Vite frontend. The split keeps API/auth responsibilities on the backend and page composition on the frontend.

- Backend serves the built frontend and exposes config/subscription APIs
- API modules are organized by domain under `routes/api/modules/`
- Middleware handles auth and request shaping
- Frontend pages own login, settings, groups, and logs workflows
- Shared UI components stay separate from route and server concerns

### Python Service Boundary

The Python implementation under `/src/services/bili_server_core/` is the Bilibili data backend. Node-side code treats it as an external boundary through `biliApi.js`, while the Python side handles Bilibili-specific fetching and normalization.

- `bili_server.py` remains as a compatibility entry
- `web/routes.py` defines the HTTP surface
- `web/handlers.py` adapts requests into service calls
- `services/` contains the content/domain logic
- Node handlers, preview generation, and subscription checks consume the normalized results

### Key Code Locations

#### Bot runtime and transport
- `/src/bot.js` — WebSocket lifecycle and runtime startup/shutdown
- `/src/services/requestApprovalService.js` — OneBot request handling
- `/src/services/subscriptionService.js` — subscription scheduling tied to bot lifecycle

#### Message ingress and dispatch
- `/src/handlers/messageHandler.js` — main QQ message ingress and routing
- `/src/commands/index.js` — command dispatch entry
- `/src/services/link/index.js` — link-domain entry for message preparation, extraction, cache helpers, and pipeline orchestration
- `/src/handlers/linkHandler.js` — compatibility facade for legacy link callers during migration
- `/src/services/notificationService.js` — outbound message delivery

#### AI pipeline
- `/src/handlers/aiHandler.js` — AI orchestration entry
- `/src/services/ai/` — AI support services for memory, gating, context, prompts, and execution control

#### Subscriptions and update checking
- `/src/services/subscription/subscriptionManager.js` — subscription state and cookie followings
- `/src/services/subscription/updateChecker/` — polling/checking implementation
- `/src/services/subscription/updateChecker/modules/feed.js` — feed-specific skip and dispatch logic

#### Bilibili service boundary and preview generation
- `/src/services/biliApi.js` — Node client for the Python service
- `/src/services/bili_server_core/web/routes.py` — Python HTTP routes
- `/src/services/imageGenerator/index.js` — preview generation entry
- `/src/services/imageGenerator/renderers/` — content-type HTML renderers
- `/src/services/imageGenerator/generators/previewCard.js` — type-to-renderer preview assembly

#### Dashboard backend and frontend
- `/src/dashboard/server.js` — Express host and static asset serving
- `/src/dashboard/routes/api/index.js` — dashboard API composition root
- `/src/dashboard/routes/api/modules/` — dashboard API domain modules
- `/dashboard/src/pages/groups/` — groups management frontend
- `/dashboard/src/pages/settings/` — settings frontend
- `/dashboard/src/pages/logs/` — logs frontend

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

AI features use both global and group-level switches.

**Global config (`META`):**
- `aiEnabled`: global AI switch (default `true`)
- `aiRagEnabled`: global RAG switch (default `true`)

**Group config (`groupConfigs[groupId]`):**
```javascript
{
  aiEnabled?: boolean,      // optional, inherits the global value when unset
  aiRagEnabled?: boolean    // optional, inherits the global value when unset
}
```

**Helper checks:**
```javascript
// Check whether AI is enabled for the group
config.isAiEnabledForGroup(groupId)

// Check whether RAG is enabled for the group (depends on AI)
config.isRagEnabledForGroup(groupId)
```

**Dependency rules:**
- RAG requires AI to be enabled, so disabling AI also disables RAG
- Group-level config takes precedence over the global setting
- The global switches can force the feature off for every group

**Used in:**
- `aiHandler.js` - checks `isAiEnabledForGroup()` before generating an AI reply
- `aiHandler.js` - checks `isRagEnabledForGroup()` before vector retrieval
- Dashboard Settings - manages the global switches
- Dashboard Groups - manages the group-level switches

### Cookie Management

The system uses only the global cookie file (`data/cookies.json`) for Bilibili API authentication.

- All groups share the same global cookie
- Group-level cookie files such as `cookies_{groupId}.json` are deprecated
- Dashboard Settings manages the global cookie
- Dashboard Groups no longer exposes cookie management

## Message Handler Pipeline

When a message arrives from QQ, `messageHandler.js` processes it in this order:

1. **Pre-checks**:
   - Ignore self messages and reject unsupported private-chat entry cases early
   - Apply blacklist filtering (global + per-group)
   - Check whether the target group is enabled
   - Extract JSON mini-program payloads when present

2. **Context recording**:
   - Save non-command conversation context to `/data/contexts/{groupId}.json`
   - Record inputs that may later be used by AI memory/profile flows even when no reply is sent

3. **Command handling**:
   - Commands start with `/` (for example `/订阅用户 123456`)
   - Run permission checks (user → group admin → root admin)
   - Dispatch through `/src/commands/index.js`
   - Return early when a command fully handles the message

4. **Link processing**:
   - Extract supported Bilibili URLs from the remaining message text
   - Apply link cache checks (`linkCacheTimeout`)
   - Fetch normalized data through `BiliApi` → Python service
   - Generate preview images through `ImageGenerator`

5. **AI processing**:
   - Check reply admission (`aiProbability`, mentions, and related gating)
   - Search vector memory for relevant context when enabled
   - Build the prompt from history and retrieved context
   - Call the configured LLM endpoint

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

For a new Bilibili content type, keep the chain aligned instead of following a fixed scaffold:

1. Add or extend URL detection in `/src/services/link/linkExtractor.js` (and the structured/regex parsers it composes)
2. Add or register the type handler under `/src/services/link/linkTypes/` and `/src/services/link/linkRegistry.js`
3. Expose normalized data from the Python service boundary under `/src/services/bili_server_core/` when the existing endpoints are not enough
4. Add preview rendering support under `/src/services/imageGenerator/renderers/` and wire the type in `/src/services/imageGenerator/generators/previewCard.js`
5. Only add Dashboard or subscription handling if that content type actually needs those entry points

The important part is that the Node side continues to consume a normalized `type + data` result instead of duplicating Bilibili-specific parsing in multiple places. `src/handlers/linkHandler.js` is now a compatibility facade, not the primary extension point for new link types.

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

Keep command work centered on the existing dispatch path:

1. Add or update the command module under `/src/commands/`
2. Wire the trigger in `/src/commands/index.js`, which remains the dispatch entry
3. Keep permission checks and response shape consistent with neighboring commands

Prefer extending the current command flow over introducing parallel entry points or command-local routing.

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

This section focuses on concrete implementation entry points and extension locations. For the higher-level backend/frontend split, see `Architecture Overview > Dashboard Architecture`.

### Backend Entry Points

Located in `/src/dashboard/`:
- **server.js:** Express app setup and static asset serving
- **routes/api.js:** compatibility entry (re-export)
- **routes/api/index.js:** API composition root
- **routes/api/modules/*.js:** domain route modules for config, groups, subscriptions, and related features
- **middleware/auth.js:** JWT authentication middleware

### Frontend Entry Points

Located in `/dashboard/src/`:
- **App.jsx:** frontend routing entry
- **pages/**: page implementations such as Dashboard, Login, Groups, Settings, and Logs
- **components/**: shared UI components
- **utils/auth.js:** Axios client and JWT interceptor

### Adding Dashboard Features

1. **Backend API:** Add a route module under `/src/dashboard/routes/api/modules/`, then register it in `/src/dashboard/routes/api/index.js` (keep `/src/dashboard/routes/api.js` as the compatibility entry)
2. **Frontend page/flow:** Add or update the page under `/dashboard/src/pages/`
3. **Routing:** Update `/dashboard/src/App.jsx`
4. **Build:** Run `cd dashboard && npm run build` so the bot serves the updated `dashboard/dist`

## Testing & Verification

Use the existing verification paths in this repository before adding new ad-hoc checks. Most changes can be validated with a combination of unit tests, Dashboard frontend checks, preview regression tools, and health/log inspection.

### Verification Paths

**Automated checks:**
```bash
# Root unit tests (mocha)
npm test

# Run one test file when narrowing a regression
node test/unit/detectChargingContent.test.js

# Dashboard frontend checks
cd dashboard && npm run lint
cd dashboard && npm run build
```

`npm test` is a real entry point and runs `mocha --exit "test/unit/**/*.test.js"`.

**Preview and rendering checks:**
- Use `tools/preview-lab.js` for targeted local preview regression and write outputs to `test/output/`
- Use `tools/preview-lab-web.js` for browser-based manual inspection when comparing layouts or styles
- Prefer these tools over temporary one-off render scripts for preview/card issues

**Service and runtime checks:**
- Use `curl http://localhost:10001/health` to confirm the Python service is alive before debugging downstream failures
- Use the Dashboard Logs page and `logs/application.log` to confirm actual runtime behavior before adding instrumentation
- For subscription/API issues, verify the relevant endpoint or runtime status first, then narrow to code

### Test Organization

**Directory Structure:**
```
test/
├── unit/               # Unit tests
└── output/             # Generated files from local test runs
```

**Naming Convention:**
- Test files: `*.test.js`
- Generated previews: write directly to `test/output/`

### Choosing the Fastest Check

- **Node/backend logic change:** start with `npm test`
- **Dashboard UI/config change:** run `cd dashboard && npm run lint && npm run build`
- **Preview card/rendering change:** run `node tools/preview-lab.js ...` and inspect output in `test/output/`
- **Browser/manual preview comparison:** run `node tools/preview-lab-web.js`
- **Python/Bilibili service issue:** run `/health` and inspect logs before changing code

## Documentation Organization

All project documentation is organized under `/docs/`, with plans and records separated by lifecycle stage.

### Directory Structure

**docs/plans/** - Active plans and new planning documents:
- Markdown format (`.md` files)
- Named with date prefix: `YYYY-MM-DD-topic.md`
- Contains: context, problem, solution, implementation steps, verification, risks
- All new plan documents should be created here by default
- If you are unsure where a future implementation/design note belongs, put it in `docs/plans/`

**docs/done/** - Completed implementation/design records:
- Move files from `docs/plans/` to `docs/done/` after execution is complete
- May also contain retrospectives, diagnosis notes, and completed records
- Preserves implementation history and decision outcomes

**docs/images/** - Screenshots and diagrams:
- Architecture diagrams
- UI screenshots
- Flow charts and visual references

**docs/napcat_interface/** - NapCat interface documentation and related materials.

### Documentation Best Practices

**When to Create a Plan Document:**
- Multi-file changes affecting 3+ files
- Complex logic changes (for example, subscription flow or config behavior)
- New feature implementation
- Refactoring with architectural impact
- Any follow-up implementation plan requested during future work

Rule: create the plan in `docs/plans/` first, and only move it to `docs/done/` after the work is finished.

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

Prefer existing observability and verification tools before editing source code to add logs. In most cases you can confirm the failing layer by checking runtime logs, the Dashboard Logs page, preview regression tools, and Python health/API reachability.

### Start With Existing Signals

Check these in order before changing code:

1. **Dashboard Logs page** - fastest way to inspect recent runtime behavior from the Web UI
2. **Application logs** - inspect `logs/application.log` locally or container logs in Docker
3. **Python health check** - confirm the service is actually alive: `curl http://localhost:10001/health`
4. **Preview tools** - reproduce card/rendering issues with `tools/preview-lab.js` or `tools/preview-lab-web.js`
5. **Targeted tests/builds** - run `npm test`, `cd dashboard && npm run lint`, or `cd dashboard && npm run build` depending on the change surface

Only add temporary instrumentation after the existing logs and checks are insufficient.

### Monitor Python Service

```bash
# Check whether something is listening on the Python service port
lsof -i :10001

# Health check
curl http://localhost:10001/health

# Verify a specific API endpoint exists
curl -X POST http://localhost:10001/user_videos -H "Content-Type: application/json" -d '{"uid": "123"}'

# Docker logs
docker logs bili-qq-bot | grep PyServer
```

For local development, inspect `logs/application.log` before assuming the Node side is at fault.

**Python Service Troubleshooting:**
- If an endpoint returns 404, first suspect an old/orphaned Python process still holding port `10001`
- If `/health` fails, debug service startup before investigating higher layers
- If authentication fails, verify `data/cookies.json` includes valid cookie/device fields such as `BUVID3`

### Preview and Rendering Debugging

For preview card issues, prefer the existing tools over ad-hoc debug scripts:

```bash
# CLI preview regression
node tools/preview-lab.js "https://www.bilibili.com/opus/1183668934980665366" --fresh --out-name local-check

# Browser-based preview inspection
node tools/preview-lab-web.js
```

Write generated outputs to `test/output/` and compare there.

### Subscription State Debugging

When debugging subscription regressions, inspect persisted state and logs first. Focus on whether the state fields are present and whether a refresh path overwrote them.

Look for:
- Missing `lastDynamicId`, `lastLiveStatus`, `lastVideoId`, or `lastArticleId`
- Null values that indicate initialization state
- State values reverting after cookie-following refresh

### When to Add Temporary Instrumentation

Only after logs, health checks, preview tools, and tests/builds are not enough:
- Add the smallest possible temporary log
- Prefer existing logger paths over broad source edits
- Remove temporary instrumentation after the issue is understood or fixed

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

Private-chat entry is limited to the root administrator (`ADMIN_QQ`).

1. Private messages from non-root users are rejected immediately with the message indicating that the feature is admin-only.
2. Root private chat can use chat, AI, link parsing, and download features.
3. Root private chat cannot use group-management features such as `/设置`, `/管理`, or subscription management commands (`/订阅*`, `/取消订阅*`, `/查询订阅`); those flows must be handled in the target group or through the Web UI.
4. The Web UI group-management scope only accepts numeric group IDs. Requests using `private_*` return `400 WebUI 不支持私聊会话管理`.

Group admins who are not root cannot use private-chat entry.

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

1. **Stringify `groupId` early**: JavaScript object keys are string-keyed in practice. Convert all group session IDs to `String(groupId)` before they touch config, caches, context storage, or Dashboard APIs, otherwise you can hit subtle mismatches such as `groupConfigs[123] !== groupConfigs["123"]`.

2. **A private session is not a numeric group**: Private conversations use the `private_<userId>` form and must not be treated as numeric group IDs. The Web UI group-management scope accepts only numeric groups, so passing `private_*` into that path causes semantic errors or a direct `400` response.

3. **Do not key Groups page tab state by index**: Avoid hard-coded tab indices. Keep `dashboard/src/pages/groups/constants/tabs.js` as the single source of truth, and base loading, submit, and default-active logic on tab keys instead of positions.

4. **Keep Dashboard forms and APIs in sync**: When adding or changing config fields, update the frontend form, backend allowlist, read endpoints, and write endpoints together. Changing only one side creates false-success states where the UI shows a setting that does not persist, or the API supports a field that the UI cannot save.

5. **Ensure group config exists before reading it**: Call `ensureGroupConfig(groupId)` before accessing `groupConfigs[groupId]`, especially on new groups, edge-session paths, or migration paths where the object may not exist yet.

6. **Orphaned Python processes can mask the real version**: After the bot exits, an older Python service may still hold port `10001`. If `/health` or a specific endpoint behaves unexpectedly, check `lsof -i :10001` first before assuming the current code failed to start or did not take effect.

7. **Preserve all subscription state fields on refresh paths**: Refresh flows such as `refreshCookieFollowings()` must not drop state fields. `setCookieFollowings()` or equivalent merge logic must preserve `lastDynamicId`, `lastLiveStatus`, `lastVideoId`, and `lastArticleId`, otherwise the system can fall back into initialization state and cause missed or duplicate notifications.

8. **Check array length before indexing**: In subscription and fetch logic, do not read `newVideos[0]`, `newArticles[0]`, or similar values without guarding for empty arrays first. Short-circuit empty results early so `undefined` does not leak into state updates or notification flows.

9. **Python API field names may differ across endpoints**: Username fields may appear as `name` or `uname` depending on the endpoint. Use a defensive fallback such as `follower.name || follower.uname || 'Unknown'`.

10. **Do not bypass the standard atomic write path**: Data-file writes should use existing atomic helpers such as `asyncWriteWithBackup()` to avoid corrupting config or subscription state during interrupted writes.

11. **Do not take over connection lifecycle inside handlers**: WebSocket reconnection and runtime-state transitions are owned centrally by `bot.js`. Business handlers should not initiate reconnects or maintain parallel connection state.

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
fs.writeFileSync('test/output/video-preview.png', buffer)
```
