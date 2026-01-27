# Critical Bug Fixes & Refactoring Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical runtime errors in Bilibili API handling, logic defects in UpdateChecker, broken AI settings reset mechanism, UI unit mismatches, and cleanup defective Log components.

**Architecture:**
- Standardize API response formats between Python service and Node.js backend.
- Refactor config management to support "true reset" (deletion of keys).
- Fix logic errors in the subscription update scheduler.
- Optimize React components for performance and correctness.

**Tech Stack:** Node.js (Express), React, Python (aiohttp).

---

### Task 1: Fix Bilibili Group API Data Structure & Frontend Safety

**Files:**
- Modify: `src/services/bili_server.py`
- Modify: `dashboard/src/pages/Groups.jsx`

**Step 1: Standardize Python Backend Response**
Ensure `get_follow_groups` always returns a list of dictionaries with a specific format, handling the case where `groups_api.result` might vary.

Modify `src/services/bili_server.py` inside `get_follow_groups`:
```python
# Ensure groups is a list
if not isinstance(groups, list):
    # Log warning and try to extract if it's a dict like {'data': [...]}
    if isinstance(groups, dict) and 'data' in groups:
        groups = groups['data']
    else:
        groups = [] # Fallback to empty list to prevent crash
```

**Step 2: Add Safety Check in Frontend**
Update `Groups.jsx` to safely handle the response even if backend sends unexpected structure.

Modify `fetchBiliGroups` in `dashboard/src/pages/Groups.jsx`:
```javascript
// ... inside fetchBiliGroups
const res = await api.get(`/api/groups/${groupId}/bili-groups`);
// Safe extraction: ensure it's an array
const safeList = Array.isArray(res.data) ? res.data : [];
setBiliGroups(safeList);
```

**Step 3: Verify**
- Mock invalid response in `api.js` temporary to test frontend resilience.
- Verify frontend no longer crashes.

---

### Task 2: Fix UpdateChecker Logic & Variable Errors

**Files:**
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Fix Variable Name Typos**
Fix the undefined variable `representativeGroupId` (spelled wrong in usage) and `gid` reference errors.

In `notifyGroupsWithImage` (approx line 763):
```javascript
// Fix typo in usage
const showId = config.getGroupConfig(representativeGroupId, 'showId');
```

In `notifyGroups` (approx line 683) and `notifyGroupsWithImage` (approx line 774, 791):
Fix `gid` scope issues. Ensure `gid` is correctly referencing the iteration variable.

**Step 2: Fix Bangumi Data Passing**
In `checkBangumi`:
Change `await this.notifyGroupsWithImage(sub.groupIds, res, ...)` to `await this.notifyGroupsWithImage(sub.groupIds, res.data, ...)`.

**Step 3: Fix Live Notification Deduplication**
In `checkUserLive`:
Update `liveData` structure to include a top-level `id`.
```javascript
const liveData = {
    id: `live_${sub.uid}`, // Add ID for deduplication
    data: { ... }
};
```

**Step 4: Fix Array Method Safety**
In `findTargetGroupsForUser`:
Add type check for `allowedTags` before calling `.some()`.
```javascript
let allowedTags = config.getGroupConfig(gid, 'cookieSyncGroupNames');
if (typeof allowedTags === 'string') {
    allowedTags = allowedTags.split(',').map(s => s.trim());
}
if (Array.isArray(allowedTags) && allowedTags.length > 0) { ... }
```

---

### Task 3: Fix AI Settings Reset Logic & Semantics

**Files:**
- Modify: `src/config.js`
- Modify: `src/dashboard/routes/api.js`

**Step 1: Implement Key Deletion in Config**
Add `deleteKeys` method to `src/config.js` to allow removing keys from `config.json` rather than just overwriting them.

```javascript
// Add to config object
deleteKeys: function(keys) {
    if (!Array.isArray(keys)) return;

    // 1. Remove from in-memory dynamic config (this.groupConfigs, etc if applicable)
    // For root level keys:
    keys.forEach(key => {
        // Reset in-memory to env default or undefined
        if (key in this) {
             // Logic to find env default is tricky here without reparsing env
             // But primarily we want to ensure save() doesn't write it back.
             // We need to modify _performSave to NOT include these if they match defaults?
             // Or better: We specifically implement a 'remove from json' operation.
        }
    });

    // 2. Read JSON, delete keys, write JSON
    try {
        const currentData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        keys.forEach(k => delete currentData[k]);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentData, null, 2));
        logger.info('Deleted keys from config.json:', keys);
    } catch (e) { ... }

    // 3. Reload/Re-init to pick up .env values?
    // Or just force restart the service.
}
```
*Refinement:* Since `sysConfig` is a singleton with mixins, the cleanest "Reset to .env" is:
1. Delete keys from `config.json`.
2. Return success and tell frontend to reload/restart, OR manually re-read `.env` into `sysConfig`.

**Step 2: Update API to Use Deletion**
Modify `POST /api/ai/reset` in `src/dashboard/routes/api.js`:
- Define ALL AI-related keys (including `aiEmbedding*`, `aiChatProxy`, `aiContextLimit`, etc.).
- Call `sysConfig.deleteKeys(aiKeys)`.
- Re-read process.env to update in-memory `sysConfig` state immediately so no restart is needed.

---

### Task 4: Fix AI Settings UI Units & Descriptions

**Files:**
- Modify: `dashboard/src/pages/Settings.jsx`

**Step 1: Correct Labels**
- `aiContextLimit`: Change "上下文限制 (Tokens)" to "上下文限制 (对话轮数)" (Context Limit (Messages)).
- `aiHistoryMaxSize`: Change "历史记录最大数量 (条)" to "历史记录最大体积 (Bytes)".

**Step 2: Add Helpers (Optional)**
Add a small helper text to `aiHistoryMaxSize` saying "Example: 209715200 for 200MB".

---

### Task 5: Cleanup & Fix Log Components

**Files:**
- Delete: `dashboard/src/components/LogViewer.jsx`
- Modify: `dashboard/src/pages/Logs.jsx`

**Step 1: Delete Dead Code**
Remove `dashboard/src/components/LogViewer.jsx`.

**Step 2: Fix Logs.jsx Logic**
- **Fix Connection Loop**: Remove `isPaused` from `useEffect` dependency array. Pause should only affect *rendering* or *state updates*, not the WebSocket connection itself.
- **Fix Cleanup**: Ensure `ws.close()` is called in return function.
- **Add Max Lines**: Limit `logs` state array to 1000 items.

```javascript
// In ws.onmessage
setLogs(prev => {
    const newLogs = [...prev, logEntry];
    if (newLogs.length > 1000) return newLogs.slice(-1000);
    return newLogs;
});
```
- **Fix Filter Icon**: Remove unused import.

---

### 补充注意事项（避免二次返工）

**Config 重构兼容性**
- 旧的 `config.json` 已有自定义值时，建议在新结构上线时进行一次“迁移到 _overrides”的兼容处理，避免用户配置丢失。

**Bili 分组解包形态**
- `get_follow_groups` 建议明确支持并优先解析以下常见结构：
  - `{"data":{"list":[...]}}`
  - `{"data":[...]}`
  - `{"list":[...]}`
  - 其他情况统一回退为空数组

**AI 设置单位一致性**
- 修正文案后，请确保默认值回填逻辑与单位一致（对话轮数/字节），避免“改文案未改数值”的二次问题。
