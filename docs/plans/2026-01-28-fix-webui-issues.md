# Plan: Fix WebUI System Settings Issues (2026-01-28)

## 1. Problem Analysis

### Issue 1: WebUI AI Settings Save Failure
**Symptoms:** Users report that saving AI settings in the WebUI fails (or reverts).
**Root Cause:**
- **Disk vs Memory Race Condition:**
    - The backend `POST /api/ai` updates the **in-memory** configuration object (`sysConfig`) and triggers a debounced (500ms) save to `config.json` on disk.
    - However, `GET /api/config` (used by the frontend to fetch settings) reads directly from **disk**.
    - If the frontend refreshes data immediately after saving (or if the user navigates away and back), `GET /api/config` returns the *stale* data from disk before the debounce timer has flushed the changes.
    - This makes it appear as if the save failed.

### Issue 2: MCP Server Editing & Logging
**Symptoms:**
- Users cannot edit an existing MCP server (only Add/Delete are available).
- There is no visibility into whether MCP servers are running or what they are outputting (logs).
**Root Cause:**
- **Missing Feature:** The `Settings.jsx` frontend lacks the UI logic to open the modal with existing data for editing.
- **Missing Logging:** `src/services/mcpManager.js` uses `StdioClientTransport` but does not capture or pipe the `stdout`/`stderr` of the spawned processes to the system logger.

## 2. Proposed Solutions

### Solution 1: Fix Configuration Persistence (API)
Modify `src/dashboard/routes/api.js` to serve configuration from the **in-memory** `sysConfig` object instead of reading from disk. This ensures the API always returns the most up-to-date state, including pending changes.

### Solution 2: Implement MCP Editing UI
Update `dashboard/src/pages/Settings.jsx` to:
1.  Add an `editingMcpIndex` state.
2.  Add an "Edit" button (Pencil icon) to the MCP card actions.
3.  Populate the "Add/Edit" modal with existing data when editing.
4.  Update the save handler to replace the entry at the specific index if editing.

### Solution 3: Implement MCP Process Logging
Modify `src/services/mcpManager.js` to:
1.  Intercept the `StdioClientTransport` creation.
2.  Access the underlying child process (`transport.process` or similar, depending on SDK exposure) or wrap the transport to capture output.
    *   *Note:* The `@modelcontextprotocol/sdk` `StdioClientTransport` might not expose the process easily. We may need to verify if we can attach listeners to `transport._process.stderr` / `stdout`.
    *   If the SDK hides the process, we might need to subclass `StdioClientTransport` or use a custom implementation to pipe logs to `logger.info` / `logger.error`.

## 3. Implementation Plan

### Step 1: Fix Config API
**File:** `src/dashboard/routes/api.js`
- **Change:** Update `router.get('/config', ...)`
- **Logic:**
    - Instead of `await readConfig()`, directly return `sysConfig`.
    - Since `sysConfig` properties are enumerable getters, `res.json(sysConfig)` will serialize the computed values correctly.

### Step 2: Update MCP Manager Logging
**File:** `src/services/mcpManager.js`
- **Change:** inside `connectToServer`:
    - When creating `StdioClientTransport`, try to access the spawned process.
    - If accessible, attach:
        ```javascript
        transport.server?.stderr?.on('data', (data) => logger.warn(`[MCP:${serverName}] ${data}`));
        transport.server?.stdout?.on('data', (data) => logger.info(`[MCP:${serverName}] ${data}`));
        ```
    - *Investigation:* The SDK `StdioClientTransport` starts the process in `start()`. We need to verify if we can access it. If `transport._process` is private, we might need to rely on the `onerror` handler or wrap the class.
    - **Refined Approach:** The SDK's `StdioClientTransport` takes `command` and `args`. We can't easily hook into the IO unless we pass a custom `transport`.
    - **Alternative:** We can try to attach to the `transport` object *after* construction, checking for `transport.process` or `transport._process` (it is likely stored).

### Step 3: Apply Frontend Changes
**File:** `dashboard/src/pages/Settings.jsx`
- **Change:** Apply the React code changes prepared in the previous reasoning step (adding `editingMcpIndex`, `openEditMcpModal`, etc.).

## 4. Verification
1.  **Config Save:** Change an AI setting in WebUI, save, immediately refresh page. value should persist.
2.  **MCP Edit:** Add an MCP server, then click Edit. Change name. Save. Verify list updates.
3.  **MCP Logs:** Add a dummy MCP server (e.g. `python -c "print('hello'); import time; time.sleep(1)"`). Check `Logs` page in WebUI for output.

