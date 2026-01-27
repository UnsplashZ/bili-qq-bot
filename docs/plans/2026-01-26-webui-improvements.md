# WebUI & Core Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 6 key iteration points to improve WebUI UX, fix synchronization issues, and enhance configuration capabilities.

**Architecture:**
- **Frontend:** React + TailwindCSS (Dashboard).
- **Backend:** Node.js + Express (API) + NapCat (QQ Bot).
- **State Management:** Fix dual-source-of-truth issues by centralizing config updates through the in-memory `config` module rather than direct file writes.

**Tech Stack:** Node.js, Express, React, WebSocket, Puppeteer.

---

### Task 1: Fix WebUI Scrolling White Edge

**Goal:** Eliminate white edges when scrolling past the viewport bounds in the WebUI.

**Files:**
- Modify: `dashboard/src/index.css`

**Step 1: Update Global CSS**

Modify `dashboard/src/index.css` to ensure the dark background covers the entire root element and overscroll areas.

```css
:root {
  color-scheme: dark;
}

html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background-color: #111827; /* gray-900 match */
  color: white;
  overflow-x: hidden;
}

#root {
  min-height: 100vh;
  background: linear-gradient(to bottom right, #111827, #1e293b, #000000);
}
```

**Step 2: Verify**
- Open dashboard.
- Scroll rapidly up/down (rubber band effect on Mac/Mobile).
- Ensure no white background is visible.

---

### Task 2: Fix Blacklist/Config Synchronization

**Goal:** Ensure config changes made in WebUI are immediately reflected in the Bot's runtime behavior by routing updates through the `config` module instead of direct file writes.

**Files:**
- Modify: `src/dashboard/routes/api.js`
- Modify: `src/config.js` (Optional, ensure `save` handles all fields)

**Step 1: Create Backend Test (Reproduction)**

Create `tests/api_sync_test.js`:
1. Start server.
2. Call API to add blacklist item.
3. Check `config.blacklistedQQs` in memory (mock/spy).
4. Expect it to contain the new item.

**Step 2: Refactor API Config Write Logic**

In `src/dashboard/routes/api.js`:
- Remove `writeConfig` helper usage for updates.
- In `POST /api/config`:
  ```javascript
  // Instead of fs.writeFile
  Object.assign(sysConfig, newConfig);
  // Re-apply special logic if needed (e.g. recreating maps)
  sysConfig.save();
  ```
- In `POST /api/groups/:id/config`:
  ```javascript
  if (!sysConfig.groupConfigs[groupId]) sysConfig.groupConfigs[groupId] = {};
  Object.assign(sysConfig.groupConfigs[groupId], updates);
  sysConfig.save();
  ```
- In `POST /api/blacklist/global`:
  ```javascript
  const { qq } = req.body;
  if (!sysConfig.blacklistedQQs.includes(qq)) {
      sysConfig.blacklistedQQs.push(qq);
      sysConfig.save();
  }
  ```
- Apply similar logic for `DELETE` routes.

**Step 3: Verify**
- Run Bot.
- Add blacklist item in WebUI.
- Run `/设置 黑名单 list` in QQ.
- Ensure item appears immediately without restart.

---

### Task 3: Real-time Bot Logs

**Goal:** Display real-time logs in WebUI via WebSocket.

**Files:**
- Create: `src/services/logWebSocket.js`
- Modify: `src/bot.js` (Initialize WS)
- Modify: `dashboard/src/components/LogViewer.jsx`
- Modify: `dashboard/src/pages/Logs.jsx`
- Modify: `dashboard/src/App.jsx` (Route)
- Modify: `dashboard/src/components/Layout.jsx` (Menu Item)

**Step 1: Backend Log Service**

Create `src/services/logWebSocket.js`:
- Use `tail` or file watcher on `logs/application.log` (or intercept logger transport).
- Broadcast new lines to connected WebSocket clients (path `/ws/logs`).
- Implement simple auth check (token in query param or protocol).

**Step 2: Register WS in Bot**

In `src/bot.js`:
- Initialize `LogWebSocket` attaching to the existing HTTP server or a new port.

**Step 3: Frontend Log Component**

Create `dashboard/src/components/LogViewer.jsx`:
- Connect to WS.
- Display logs in a terminal-like view (`pre/code`).
- Auto-scroll to bottom.
- Filter controls (Info/Warn/Error).

**Step 4: Frontend Page & Route**
- Add `Logs` page.
- Add to Sidebar in `Layout.jsx`.

---

### Task 4: Real-time AI Config & Priority

**Goal:** Implement WebUI > .env priority and allow resetting.

**Files:**
- Modify: `src/config.js`
- Modify: `src/dashboard/routes/api.js`
- Modify: `dashboard/src/pages/Settings.jsx`

**Step 1: Update Config Logic**

In `src/config.js`:
- Update config logic to prioritize loaded JSON over ENV for AI fields if present in JSON.
- Ensure `save()` serializes these fields to `config.json`.

**Step 2: Backend API for Reset**

In `src/dashboard/routes/api.js`:
- Add endpoint `POST /api/ai/reset`:
  - Sets `sysConfig.aiApiUrl = undefined` (or deletes key).
  - Calls `sysConfig.save()`.

**Step 3: Frontend UI**

In `dashboard/src/pages/Settings.jsx`:
- Update AI section.
- Add "Reset to .env defaults" button.
- Logic: If API returns values, show them. If "reset" is clicked, call reset API, then reload config (which should now reflect env vars).
- Add indicator: "Current Source: Custom (WebUI)" vs "Default (.env)".

---

### Task 5: Bilibili Login in Group Settings

**Goal:** Allow scanning QR code to login to Bilibili for specific groups via WebUI.

**Files:**
- Modify: `src/dashboard/routes/api.js`
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: Backend Login API**

In `src/dashboard/routes/api.js`:
- `GET /api/bili/login-url`: Call `biliApi.getLoginUrl()`. Return URL + Key.
- `POST /api/bili/check-login`: Accept Key + GroupID. Call `biliApi.checkLogin()`.

**Step 2: Frontend Login Modal**

In `dashboard/src/pages/Groups.jsx`:
- Add "Bilibili Account" section.
- Show "Login" button.
- On click: Fetch URL -> Generate QR -> Show Modal.
- Poll check-login API.
- On success: Show "Logged in as [Name]".

---

### Task 6: Subscription Tab Improvements

**Goal:** Rename tab, remove text, implement group-based selection.

**Files:**
- Modify: `src/dashboard/routes/api.js`
- Modify: `dashboard/src/pages/Groups.jsx`
- Modify: `src/services/biliApi.js`

**Step 1: Backend Follow Groups API**

In `src/services/biliApi.js`:
- Add `getFollowGroups(groupId)`: Calls Bilibili API to get user's follow tags/groups.

In `src/dashboard/routes/api.js`:
- `GET /api/groups/:id/bili-groups`: Expose the service.

**Step 2: Frontend Logic**

In `dashboard/src/pages/Groups.jsx`:
- Rename "Sync" tab to "关注列表同步".
- Remove helper text "与其他群组同步Cookie".
- Fetch Bilibili groups on load.
- Render checkboxes for each group.
- Value binding: `formData.cookieSyncGroupNames` (Array of strings).

---
