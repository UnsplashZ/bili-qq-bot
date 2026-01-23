# Refactor BiliService to Persistent HTTP Process

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Bilibili Python service from a slow "CLI-per-request" model to a high-performance persistent HTTP sidecar service to eliminate startup latency and enable connection reuse.

**Architecture:** Node.js manages a persistent Python `aiohttp` server subprocess. Communication occurs via HTTP over localhost.

**Tech Stack:** Python 3.11+, aiohttp, Node.js (Child Process), Axios.

---

### Task 1: Create Python Server Boilerplate

**Files:**
- Create: `src/services/bili_server.py`
- Reference: `src/services/bili_service.py` (copy logic from here)

**Step 1: Create the skeleton file**

Create `src/services/bili_server.py` importing necessary libraries and setting up the `aiohttp` app structure with a `/health` endpoint.

```python
import sys
import json
import asyncio
import aiohttp
from aiohttp import web
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bili_server')

async def health_check(request):
    return web.json_response({"status": "ok"})

def create_app():
    app = web.Application()
    app.add_routes([
        web.get('/health', health_check),
    ])
    return app

if __name__ == '__main__':
    # Use argparse for port selection
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=10001)
    args = parser.parse_args()

    web.run_app(create_app(), host='127.0.0.1', port=args.port)
```

**Step 2: Test the server starts**

Run: `python3 src/services/bili_server.py --port 10001`
Test: `curl http://127.0.0.1:10001/health`
Expected: `{"status": "ok"}`

### Task 2: Migrate Business Logic & Session Management

**Files:**
- Modify: `src/services/bili_server.py`

**Step 1: Copy helper functions and imports**

Copy all imports and helper functions (`load_credential`, `get_image_focus_color`, etc.) from `src/services/bili_service.py` to `src/services/bili_server.py`.

**Step 2: Implement Global Session Lifecycle**

Add `on_startup` and `on_cleanup` hooks to manage a global `aiohttp.ClientSession`.

```python
async def on_startup(app):
    # Initialize global session if needed, or just let bilibili_api handle its own sessions
    # Ideally, we patch bilibili_api to use our persistent session,
    # but for now, we just ensure the server stays alive.
    pass

async def on_cleanup(app):
    # Cleanup resources
    pass

# Update create_app
# app.on_startup.append(on_startup)
# app.on_cleanup.append(on_cleanup)
```

**Step 3: Implement POST Handlers**

Migrate each command from `main()` in `bili_service.py` to a route handler.

Example for `/video`:
```python
async def handle_video(request):
    try:
        data = await request.json()
        bvid = data.get('bvid')
        group_id = data.get('group_id')
        if not bvid:
            return web.json_response({"status": "error", "message": "Missing bvid"}, status=400)

        # Call the existing logic function (copy this function over too)
        result = await get_video_info(bvid, group_id)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})
```

Repeat for:
- `/bangumi` (args: season_id)
- `/article` (args: cvid)
- `/live_room` (args: room_id)
- `/login_url`
- `/login_check` (args: key)
- `/user_dynamic` (args: uid)
- `/user_live` (args: uid)
- `/dynamic_detail` (args: dynamic_id)
- `/opus` (args: opus_id)
- `/ep` (args: ep_id)
- `/media` (args: media_id)
- `/user_info` (args: uid)
- `/user_card` (args: uid)
- `/my_followings` (args: group_name)
- `/my_info`

**Step 4: Register all routes**

Update `create_app` to include all new POST routes.

### Task 3: Node.js Process Manager

**Files:**
- Create: `src/services/ServiceManager.js`
- Modify: `src/config.js`

**Step 1: Add config**

Add `biliServerPort: 10001` to `src/config.js`.

**Step 2: Implement ServiceManager class**

Create `src/services/ServiceManager.js` with:
- `spawn()` using `child_process.spawn`.
- Log forwarding (prefix `[PyServer]`).
- `waitForHealth()`: Loop checking `/health` with exponential backoff.
- `restart()`: Kill and spawn.
- `idleCheck`: Timer to track last request time.

```javascript
// Pseudo-code for ServiceManager
class BiliServiceManager {
    constructor() {
        this.port = config.biliServerPort || 10001;
        this.process = null;
        this.lastRequestTime = Date.now();
    }

    start() {
        // spawn python3 src/services/bili_server.py --port THIS.PORT
        // pipe stdout/stderr to logger
        // wait for health
    }

    async sendCommand(endpoint, data) {
        this.lastRequestTime = Date.now();
        // axios.post(`http://127.0.0.1:${this.port}/${endpoint}`, data)
    }

    // ... idle restart logic
}
module.exports = new BiliServiceManager();
```

### Task 4: Integrate Client Adapter

**Files:**
- Modify: `src/services/biliService.js`

**Step 1: Import Manager**

`const serviceManager = require('./ServiceManager');`

**Step 2: Replace `execFile` calls**

Refactor `getVideoInfo(bvid, groupId)`:

**Old:**
```javascript
return new Promise((resolve, reject) => {
    execFile(pythonPath, [scriptPath, 'video', bvid, groupId || ''], ...)
})
```

**New:**
```javascript
return serviceManager.sendCommand('video', { bvid, group_id: groupId });
```

Repeat for all exported functions ensuring signatures match exactly.

### Task 5: Lifecycle Hooks & Cleanup

**Files:**
- Modify: `src/index.js` (or main entry point)
- Modify: `src/services/ServiceManager.js`

**Step 1: Start service on boot**

In `src/index.js` (or wherever bot startup happens), call `await serviceManager.start()`.

**Step 2: Implement Idle Restart**

In `ServiceManager`:
- `setInterval` every 1 hour.
- If `Date.now() - lastRequestTime > 24 * 60 * 60 * 1000` (24h), call `restart()`.

**Step 3: Verification**

- Start the bot.
- Verify `[PyServer]` logs appear.
- Send a command (e.g., share a video).
- Verify response time is faster (subsequent requests should be near-instantaneous on network overhead).
