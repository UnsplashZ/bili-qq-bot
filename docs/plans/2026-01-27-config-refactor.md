# Configuration Refactor & Bug Fixes Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor config architecture to support correct "reset to default" behavior, fix data structure handling in Bilibili sync, and correct UI defaults.

**Architecture:**
- **Layered Config System:** Refactor `src/config.js` to distinguish between User Overrides (saved to JSON) and System Defaults/Env Vars. Access config via dynamic Getters that implement priority logic (`Override > Env > Default`).
- **Robust Data Handling:** Improve Python backend to recursively search for list data in API responses.
- **Correct UI Defaults:** Update React components to use correct fallback values matching new unit definitions.

**Tech Stack:** Node.js (CommonJS), React, Python (aiohttp).

---

### Task 1: Refactor Config Architecture (Layered System)

**Files:**
- Modify: `src/config.js`
- Test: `tests/config_layered_test.js` (Create new test file)

**Step 1: Create Test for Layered Logic**
Create `tests/config_layered_test.js` to verify:
1. `config.key` returns Env value if no override.
2. Setting `config.key = val` writes to `_overrides` and persists to JSON.
3. `config.deleteKeys(['key'])` removes from `_overrides` and value reverts to Env/Default.
4. Array mutation (push) persists for `blacklistedQQs`.

**Step 2: Implement Metadata & Parsers**
Refactor `src/config.js`:
- Define `META` object containing `env`, `def`, `type`, `lazyInit` for all keys.
- Implement `parsers` helper (string, int, float, bool, array).
- Initialize `_overrides` from `config.json`.

**Step 3: Implement Dynamic Getter/Setter**
- Use `Object.defineProperty` loop over `META`.
- Getter: Check `_overrides` -> Check `process.env` -> Return `def`.
  - Implement `lazyInit` logic for Arrays/Objects (copy default to override on first read).
- Setter: Write to `_overrides`, trigger debounce `save()`.

**Step 4: Update Helper Methods**
- Rewrite `save()` to only write `_overrides`.
- Rewrite `deleteKeys()` to delete from `_overrides` and save.
- Ensure `enableGroup` etc. trigger save.

**Step 5: Run Tests**
Run `npx mocha tests/config_layered_test.js` to verify behavior.

---

### Task 2: Simplify API Reset Logic

**Files:**
- Modify: `src/dashboard/routes/api.js`

**Step 1: Update Reset Endpoint**
In `POST /api/ai/reset`:
- Remove the manual re-assignment of `sysConfig.aiApiUrl = process.env...`.
- Only call `sysConfig.deleteKeys(aiKeys)`.
- Rely on the new Getter logic to automatically return the correct fallback values.

---

### Task 3: Fix Settings UI Defaults

**Files:**
- Modify: `dashboard/src/pages/Settings.jsx`

**Step 1: Correct Fallback Values**
Find the `useEffect` or state initialization logic.
- Change `aiContextLimit` fallback from `2000` to `10`.
- Change `aiHistoryMaxSize` fallback from `20` to `209715200` (200MB).
- Change `aiMemorySafetyLimit` fallback from `2000` to `5000` (if applicable).

---

### Task 4: Fix Bilibili Sync Data Unwrapping

**Files:**
- Modify: `src/services/bili_server.py`

**Step 1: Improve Data Extraction**
In `get_follow_groups`:
- Implement a recursive or multi-level check for list data.
- Search pattern: `groups`, `groups['data']`, `groups['data']['list']`, `groups['data']['items']`.
- Ensure final result is a list or empty list.

```python
# Pseudo-code logic
data = groups
if isinstance(data, dict):
    if 'list' in data and isinstance(data['list'], list):
        data = data['list']
    elif 'items' in data and isinstance(data['items'], list):
        data = data['items']
    elif 'data' in data:
        # recurse one level down? or just check
        sub = data['data']
        if isinstance(sub, list):
            data = sub
        elif isinstance(sub, dict) and 'list' in sub:
            data = sub['list']
```

---

### Task 5: Verify Live Deduplication ID Usage

**Files:**
- Verify: `src/services/imageGenerator/index.js` (or wherever image generation happens)
- Modify: `src/services/subscription/updateChecker.js` (if needed)

**Step 1: Check Downstream Usage**
Verify if `imageGenerator` throws error when receiving extra fields in `data`.
- If it strictly validates schema, passing `id` at top level might break it if it expects only `data`.
- However, `updateChecker` passes `liveData` (which contains `id` and `data`).
- `notifyGroupsWithImage` uses `data` (the payload) as the 2nd arg.
- Wait, `notifyGroupsWithImage(groupIds, data, ...)`
- Inside `notifyGroupsWithImage`: `imageGenerator.generatePreviewCard(data, type, ...)`
- So `imageGenerator` receives `{ id: ..., data: { ... } }`.
- Need to ensure `imageGenerator` extracts `data.data` or handles the wrapper.
- **Action:** If `imageGenerator` expects pure data, modify `notifyGroupsWithImage` to pass `data.data` to the generator, but use `data.id` for dedup.

**Step 2: Fix UpdateChecker Call**
In `notifyGroupsWithImage`:
```javascript
// Current:
const base64Image = await imageGenerator.generatePreviewCard(data, type, ...);

// Proposed change (if data structure changed):
// If data has top-level 'data' property (like our new liveData), pass that inner data to generator.
const payload = (data && data.data && data.id) ? data.data : data;
const base64Image = await imageGenerator.generatePreviewCard(payload, type, ...);
```
*Note: This makes it compatible with both structures.*

---
