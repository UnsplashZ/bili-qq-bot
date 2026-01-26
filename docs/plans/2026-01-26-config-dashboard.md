# Glassmorphism React Configuration Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a glassmorphism-styled React dashboard to manage bot configuration, groups, and AI/MCP settings, served by an Express API integrated into the existing bot process.

**Architecture:**
- **Backend:** Express.js server integrated into `src/bot.js` exposing REST APIs for `config.json` and `mcp_servers.json`.
- **Frontend:** React + Vite + Tailwind CSS (using `backdrop-blur` for glassmorphism) located in `dashboard/` directory.
- **Integration:** Bot serves frontend static assets in production; runs on separate port with proxy during dev.

**Tech Stack:** Node.js, Express, React, Vite, Tailwind CSS, Headless UI / Radix UI, Lucide Icons.

---

### Phase 1: Backend API Infrastructure

#### Task 1: Setup Dashboard Server Module
**Files:**
- Create: `src/dashboard/server.js`
- Modify: `src/bot.js`

**Step 1: Create Basic Express Server Wrapper**
Create a module that exports a `start(port)` function.

```javascript
// src/dashboard/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('../utils/logger');

function createServer() {
    const app = express();
    app.use(express.json());
    app.use(cors()); // Allow cross-origin for dev mode

    // Health check
    app.get('/api/status', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    return app;
}

function start(port = 3000) {
    const app = createServer();
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            logger.info(`Dashboard server running on port ${port}`);
            resolve(server);
        }).on('error', reject);
    });
}

module.exports = { start, createServer };
```

**Step 2: Integrate into Bot Startup**
Modify `src/bot.js` to start the dashboard server.

```javascript
// src/bot.js (add at top)
const dashboardServer = require('./dashboard/server');

// In main async function, before createWebSocketConnection:
try {
    await dashboardServer.start(process.env.DASHBOARD_PORT || 3000);
} catch (e) {
    logger.error('Failed to start dashboard server:', e);
}
```

**Step 3: Verification**
Run `node src/bot.js` (or just the server part) and curl the status endpoint.
`curl http://localhost:3000/api/status`

---

#### Task 2: Implement Config & Group APIs
**Files:**
- Modify: `src/dashboard/server.js`
- Create: `src/dashboard/routes/api.js`

**Step 1: Create Config Read/Write Logic**
We need safe wrappers to read/write `config/config.json`.

```javascript
// src/dashboard/routes/api.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();

const CONFIG_PATH = path.resolve(__dirname, '../../../config/config.json');

// GET /api/config - Read full config
router.get('/config', async (req, res) => {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/groups - Get merged group info
// (Mock implementation for now, will refine with real data later)
router.get('/groups', async (req, res) => {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8');
        const config = JSON.parse(data);
        const groupIds = new Set([...config.enabledGroups, ...Object.keys(config.groupConfigs || {})]);

        const groups = Array.from(groupIds).map(id => ({
            id,
            name: `Group ${id}`, // Placeholder until we can get real names
            isEnabled: config.enabledGroups.includes(id),
            config: config.groupConfigs?.[id] || {}
        }));

        res.json(groups);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
```

**Step 2: Mount Routes in Server**
Update `src/dashboard/server.js` to use the router.

```javascript
const apiRoutes = require('./routes/api');
// ... inside createServer
app.use('/api', apiRoutes);
```

**Step 3: Verification**
Start server, access `http://localhost:3000/api/groups` and verify JSON output matches `config.json`.

---

#### Task 3: Implement MCP & AI APIs
**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: MCP Server Endpoints**
Add endpoints to read/write `mcp_servers.json`.

```javascript
const MCP_PATH = path.resolve(__dirname, '../../../config/mcp_servers.json');

router.get('/mcp', async (req, res) => {
    try {
        const data = await fs.readFile(MCP_PATH, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
```

**Step 2: AI Settings Endpoints**
Add endpoints to specifically target AI settings within `config.json`.

```javascript
router.post('/ai', async (req, res) => {
    // Logic to patch specific AI fields in config.json
    // { aiProbability, aiContextLimit, ... }
});
```

---

### Phase 2: Frontend Setup

#### Task 4: Initialize React Project
**Files:**
- Create: `dashboard/` directory structure

**Step 1: Scaffold Project**
Run commands to create Vite project (will simulate this via shell commands).

```bash
cd dashboard
npm create vite@latest . -- --template react
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @headlessui/react lucide-react axios framer-motion clsx tailwind-merge
```

**Step 2: Configure Tailwind**
Update `dashboard/tailwind.config.js`.

```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: "rgba(255, 255, 255, 0.1)",
        glassBorder: "rgba(255, 255, 255, 0.2)",
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
```

**Step 3: Configure Proxy**
Update `dashboard/vite.config.js` to proxy `/api` to `http://localhost:3000`.

---

### Phase 3: Frontend Components (Glassmorphism)

#### Task 5: Base Layout & Glass Components
**Files:**
- Create: `dashboard/src/components/Layout.jsx`
- Create: `dashboard/src/components/GlassCard.jsx`

**Step 1: Glass Card Component**
Create a reusable card with blur effect.

```jsx
// dashboard/src/components/GlassCard.jsx
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function GlassCard({ children, className }) {
  return (
    <div className={twMerge(
      "bg-white/10 backdrop-blur-md border border-white/20 rounded-xl shadow-lg p-6 text-white",
      className
    )}>
      {children}
    </div>
  );
}
```

**Step 2: Main Layout**
Create the sidebar/navigation layout with a dark/gradient background.

```jsx
// dashboard/src/components/Layout.jsx
export function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-black text-white font-sans selection:bg-blue-500/30">
        <nav className="fixed left-0 top-0 h-full w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 p-4">
            {/* Nav Links */}
        </nav>
        <main className="pl-64 p-8">
            {children}
        </main>
    </div>
  );
}
```

---

#### Task 6: Group Management View
**Files:**
- Create: `dashboard/src/pages/Groups.jsx`

**Step 1: Fetch Data**
Use `axios` to fetch `/api/groups` on mount.

**Step 2: Render List**
Left column list of groups with toggle switches.

**Step 3: Render Details**
Right column specific settings using Tabs (Headless UI) for "General", "AI", "Subscription".

---

#### Task 7: AI & Settings View
**Files:**
- Create: `dashboard/src/pages/Settings.jsx`

**Step 1: Global Settings Form**
Sliders for probabilities, Inputs for context limits.

**Step 2: MCP Card List**
Grid of GlassCards showing installed MCP servers and their status.

---

### Phase 4: Production Build Integration

#### Task 8: Serve Static Assets
**Files:**
- Modify: `src/dashboard/server.js`

**Step 1: Serve Static Files**
Configure Express to serve `dashboard/dist` when in production mode.

```javascript
// src/dashboard/server.js
const DIST_PATH = path.resolve(__dirname, '../../dashboard/dist');

// After API routes
app.use(express.static(DIST_PATH));
app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
});
```
