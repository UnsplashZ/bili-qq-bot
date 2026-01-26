# Enhanced Dashboard & Security Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Upgrade the existing dashboard with JWT authentication, real-time system monitoring, full-featured subscription/group management, and a polished Chinese Glassmorphism UI.

**Architecture:**
- **Auth:** Simple password-based JWT authentication protecting all API routes (except login).
- **Monitoring:** `systeminformation` library + WebSocket/Polling for real-time CPU/RAM/Network stats.
- **Backend:** Enhanced API routes for subscriptions, blacklists, and logs.
- **Frontend:** React + Tailwind with localized (Chinese) UI, custom Glass Modals (no native alerts), and new dedicated pages.

**Tech Stack:** Node.js, Express, jsonwebtoken, systeminformation, React, Tailwind CSS, Recharts (for monitoring charts).

---

### Phase 1: Security & Infrastructure (Backend)

#### Task 1: Implement JWT Authentication
**Files:**
- Create: `src/dashboard/middleware/auth.js`
- Modify: `src/dashboard/routes/api.js`
- Modify: `src/dashboard/server.js`

**Step 1: Install Dependencies**
`npm install jsonwebtoken dotenv`

**Step 2: Create Auth Middleware**
Create `src/dashboard/middleware/auth.js`.
- Check `Authorization: Bearer <token>` header.
- Verify token using `JWT_SECRET` (from env or generated on startup).
- Return 401 if invalid.

**Step 3: Create Login Endpoint**
In `src/dashboard/routes/api.js`:
- `POST /api/login`: Accept `{ password }`.
- Compare with `DASHBOARD_PASSWORD` (from .env).
- Return `{ token }`.

**Step 4: Protect API Routes**
Apply middleware to all `/api` routes EXCEPT `/login` and `/status`.

**Step 5: Verification**
- Test `curl` to protected endpoint -> 401.
- Test login -> 200 + token.
- Test access with token -> 200.

#### Task 2: System Monitoring API
**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: Install Dependencies**
`npm install systeminformation`

**Step 2: Create Monitor Endpoint**
`GET /api/monitor`:
- Use `systeminformation` to get:
  - CPU load (`currentLoad`)
  - Memory (`active`, `total`)
  - Network Stats (`rx_sec`, `tx_sec`) - *Note: SI returns cumulative, might need diffing or use `networkStats` which often gives rates.*
  - Uptime (OS & Process)

**Step 3: Verification**
- Access `/api/monitor` and verify valid JSON data structure.

#### Task 3: Log Streaming (WebSocket)
**Files:**
- Modify: `src/dashboard/server.js`
- Modify: `src/utils/logger.js` (optional hook)

**Step 1: Add WebSocket to Dashboard Server**
- Attach `ws` server to the same HTTP server instance.
- Endpoint: `/ws/logs`.

**Step 2: Log Broadcasting**
- Modify `logger.info/error` or add a transport to push new log lines to connected WS clients.

**Step 3: Verification**
- Connect with `wscat` or simple script, trigger logs, verify receipt.

---

### Phase 2: Enhanced Backend Logic

#### Task 4: Extended Config APIs (Subscription & Blacklist)
**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: Subscription Management Endpoints**
- `GET /api/groups/:id/subscriptions`: Get sub list.
- `POST /api/groups/:id/subscriptions`: Add subscription.
- `DELETE /api/groups/:id/subscriptions`: Remove subscription.
*Note: This might require reading/writing a separate `subscriptions.json` or database if not in `config.json`. Check `src/services/subscriptionService.js` to see where subs are stored.*

**Step 2: Blacklist Management Endpoints**
- `GET/POST /api/blacklist/global`: Manage `blacklistedQQs` in `config.json`.
- `GET/POST /api/groups/:id/blacklist`: Manage group-specific blacklist (if supported).

**Step 3: Verification**
- Test adding/removing items via API.

---

### Phase 3: Frontend Security & Components

#### Task 5: Custom Glass Modal & Toast
**Files:**
- Create: `dashboard/src/components/GlassModal.jsx`
- Create: `dashboard/src/components/Toast.jsx` (or use library like `react-hot-toast`)
- Modify: `dashboard/src/App.jsx` (Global providers)

**Step 1: Implement GlassModal**
- Uses `Headless UI` Dialog.
- Glassmorphism style.
- Props: `isOpen`, `onClose`, `title`, `children`, `onConfirm`.

**Step 2: Implement Toast/Notification**
- Global context to `showToast(message, type)`.
- Renders floating glass pills at top/bottom.

#### Task 6: Login Page & Auth Logic
**Files:**
- Create: `dashboard/src/pages/Login.jsx`
- Modify: `dashboard/src/App.jsx`
- Create: `dashboard/src/utils/auth.js` (axios interceptor)

**Step 1: Axios Interceptor**
- Auto-attach `Authorization` header.
- Redirect to `/login` on 401 response.

**Step 2: Login UI**
- Glass card with Password input.
- Calls `/api/login`, saves token, redirects to Dashboard.

---

### Phase 4: Frontend Pages (Chinese & Full Features)

#### Task 7: Dashboard Home (Real Monitoring)
**Files:**
- Modify: `dashboard/src/pages/Dashboard.jsx` (Create new)

**Step 1: Layout**
- 4 Cards: CPU, Memory, Network, Uptime.
- Charts: Use `recharts` for CPU/Mem history.
- Fetch `/api/monitor` every 2-3 seconds.

#### Task 8: Group Management 2.0 (Full Features)
**Files:**
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: Localization**
- Translate all texts to Chinese.

**Step 2: Add Subscriptions Tab**
- List subs.
- "Add" button -> GlassModal form.

**Step 3: Add Blacklist Tab**
- List blacklisted QQs for this group.
- Add/Remove interface.

#### Task 9: Settings 2.0 & Logs
**Files:**
- Modify: `dashboard/src/pages/Settings.jsx`
- Create: `dashboard/src/pages/Logs.jsx`

**Step 1: Global Settings (Chinese)**
- Translate.
- Add `subscriptionCheckInterval`.
- Global Blacklist management section.

**Step 2: Logs Page**
- Terminal-like view.
- Connect to `/ws/logs`.
- Append new logs to buffer.

---

### Phase 5: Cleanup & Polish

#### Task 10: Final Polish
**Files:**
- Check all pages for English text -> Translate to Chinese.
- Ensure no native `alert()` is used.
- Verify `restart` works with new Auth.
