# Dashboard Bug Fixes - API Data Structure Mismatches

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two critical bugs causing Dashboard infinite loading and Groups page white screen by correcting API response structure mismatches with frontend expectations.

**Architecture:**
- The `/api/monitor` endpoint returns nested objects, but Dashboard component expects flat simple values
- The `/api/groups` endpoint returns `isEnabled` property, but Groups component uses `enabled` property
- Fixes involve aligning API responses with frontend expectations without breaking existing functionality

**Tech Stack:** Node.js/Express (backend), React (frontend), systeminformation library

**Impact Analysis:**
- ✅ No impact on existing bot functionality - these are dashboard-only APIs
- ✅ No impact on config storage format - internal data model unchanged
- ✅ Only affects API response serialization layer
- ⚠️ Groups component property name change (`enabled` → `isEnabled`) is purely cosmetic rename

---

## Task 1: Fix Monitor API Response Structure

**Files:**
- Modify: `src/dashboard/routes/api.js:395-448`

**Context:**
The `/api/monitor` endpoint currently returns nested object structures that cause the Dashboard component to crash when it tries to call methods like `toFixed()` on objects or access undefined properties.

Current API returns:
```javascript
{
  cpu: { load: 12.5 },           // Object
  memory: { active: 12345, total: 12345678 },  // Has 'active', not 'used'
  network: { rx_sec: 100, tx_sec: 50 },      // Has 'rx_sec'/'tx_sec', not 'down'/'up'
  uptime: { process: 1234, system: 5678 }   // Object, not number
}
```

Dashboard expects:
```javascript
{
  cpu: 12.5,                       // Number
  memory: { used: 12345, total: 12345678 },  // Has 'used'
  network: { up: 50, down: 100 },   // Has 'up'/'down'
  uptime: 1234                      // Number
}
```

**Step 1: Modify the stats object structure in monitor endpoint**

Change lines 425-441 in `src/dashboard/routes/api.js`:

```javascript
// Current (WRONG):
const stats = {
    cpu: {
        load: cpu.currentLoad
    },
    memory: {
        active: mem.active,
        total: mem.total
    },
    network: {
        rx_sec: rx_sec,
        tx_sec: tx_sec
    },
    uptime: {
        process: processUptime,
        system: time.uptime
    }
};

// Change to (CORRECT):
const stats = {
    cpu: cpu.currentLoad,
    memory: {
        used: mem.active,
        total: mem.total
    },
    network: {
        up: tx_sec,
        down: rx_sec
    },
    uptime: processUptime
};
```

**Explanation:**
- `cpu`: Changed from `{ load: number }` to direct `number` - Dashboard calls `toFixed()` directly
- `memory`: Renamed `active` to `used` - Dashboard accesses `stats.memory.used`
- `network`: Renamed `rx_sec` to `down` and `tx_sec` to `up` - Dashboard uses `up`/`down`
- `uptime`: Changed from `{ process: number, system: number }` to direct `number` - Dashboard passes to `formatUptime()`

**Step 2: Verify the fix**

Start the dashboard server and test the endpoint:

```bash
# From project root
curl -H "Authorization: Bearer <your-token>" http://localhost:3000/api/monitor
```

Expected response structure:
```json
{
  "cpu": 12.5,
  "memory": {
    "used": 12345678,
    "total": 17179869184
  },
  "network": {
    "up": 1024,
    "down": 2048
  },
  "uptime": 3600
}
```

**Step 3: Test Dashboard in browser**

1. Open browser and navigate to dashboard
2. Login
3. Navigate to Dashboard page
4. Verify:
   - CPU/Memory/Network cards display values
   - Charts render correctly
   - No "Loading..." stuck state

**Step 4: Commit**

```bash
git add src/dashboard/routes/api.js
git commit -m "fix: monitor API response structure to match Dashboard expectations"
```

---

## Task 2: Fix Groups Component Property Name Mismatch

**Files:**
- Modify: `dashboard/src/pages/Groups.jsx:115, 117, 124, 279, 281`

**Context:**
The `/api/groups` endpoint returns `isEnabled` property, but the Groups component uses `enabled` (missing "is" prefix). This causes:
1. Toggle logic to always enable groups (since `!group.enabled` is always `!undefined = true`)
2. Power icon to display in wrong state
3. Potential rendering errors causing white screen

**Step 1: Replace all `group.enabled` with `group.isEnabled` in Groups.jsx**

Change at line 115:
```javascript
// Current:
const newStatus = !group.enabled;

// Change to:
const newStatus = !group.isEnabled;
```

Change at line 117:
```javascript
// Current:
setGroups(prev => prev.map(g => g.id === group.id ? { ...g, enabled: newStatus } : g));

// Change to:
setGroups(prev => prev.map(g => g.id === group.id ? { ...g, isEnabled: newStatus } : g));
```

Change at line 124:
```javascript
// Current:
setGroups(prev => prev.map(g => g.id === group.id ? { ...g, enabled: !newStatus } : g));

// Change to:
setGroups(prev => prev.map(g => g.id === group.id ? { ...g, isEnabled: !newStatus } : g));
```

Change at line 279:
```javascript
// Current:
group.enabled ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-500 hover:bg-gray-500/20'

// Change to:
group.isEnabled ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-500 hover:bg-gray-500/20'
```

Change at line 281:
```javascript
// Current:
title={group.enabled ? '禁用群组' : '启用群组'}

// Change to:
title={group.isEnabled ? '禁用群组' : '启用群组'}
```

**Step 2: Verify Groups page renders correctly**

1. Refresh browser (or restart dev server)
2. Login
3. Navigate to Groups page
4. Verify:
   - Page loads without white screen
   - Group list displays
   - Power icons show correct state (green for enabled, gray for disabled)
   - Toggle buttons work correctly
   - Clicking a group shows detail view

**Step 3: Test toggle functionality**

1. Click the power button on a group
2. Verify:
   - Icon color changes immediately
   - Group status in API actually toggles (check via curl or DevTools)
   - Subsequent page refresh maintains the state

Test via curl:
```bash
# Get current groups
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/groups

# Toggle a group
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3000/api/groups/<group-id>/toggle

# Verify change
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/groups
```

**Step 4: Commit**

```bash
git add dashboard/src/pages/Groups.jsx
git commit -m "fix: Groups component use isEnabled property to match API response"
```

---

## Task 3: Verify No Functional Impact

**Files:**
- None (verification only)

**Step 1: Verify bot functionality unchanged**

These changes only affect dashboard APIs and frontend. The actual bot logic uses the config system directly.

Check that `config.js` methods still work:

```javascript
// In src/config.js, these methods are unchanged:
- isGroupEnabled(groupId)   // Uses enabledGroups.includes()
- enableGroup(groupId)       // Adds to enabledGroups array
- disableGroup(groupId)      // Removes from enabledGroups array
```

These are NOT affected by our changes because:
1. We only changed API response format, not internal storage
2. We only changed frontend property name, not data structure
3. Bot reads config directly from `config.json`, not through dashboard APIs

**Step 2: Test core bot operations**

Verify bot still works:
1. Send a test message to a group
2. Verify bot responds
3. Check that enabled/disabled groups are respected
4. Verify subscriptions still trigger notifications

**Step 3: Cross-check with existing config format**

Sample `config.json` structure (unchanged):
```json
{
  "enabledGroups": ["123456", "789012"],
  "groupConfigs": {
    "123456": {
      "labelConfig": {
        "video": true,
        "live": true
      }
    }
  }
}
```

This format is NOT changed by our fixes.

**Step 4: Final integration test**

1. Enable a group via dashboard
2. Send test command in that group - should work
3. Disable group via dashboard
4. Send test command in that group - should be ignored
5. Check config.json - `enabledGroups` should be correctly updated

**Step 5: Documentation update**

No documentation needed - these are bug fixes, not feature changes. The API contract is now correct.

---

## Testing Checklist

After implementation, verify:

### Dashboard Page
- [ ] Loads without infinite "Loading..." state
- [ ] CPU percentage displays correctly
- [ ] Memory usage shows used/total values
- [ ] Network traffic shows up/down speeds
- [ ] Uptime displays in human-readable format
- [ ] CPU and Memory charts render and update
- [ ] No console errors

### Groups Page
- [ ] Page loads without white screen
- [ ] Group list displays all groups
- [ ] Power icons show correct colors (green = enabled, gray = disabled)
- [ ] Toggle button enables/disables groups correctly
- [ ] Clicking a group opens detail view
- [ ] Subscriptions tab loads correctly
- [ ] Blacklist tab works
- [ ] Save button persists changes

### No Regressions
- [ ] Bot functionality unchanged
- [ ] Config file format unchanged
- [ ] Existing groups maintain their enabled/disabled status
- [ ] No console errors in browser DevTools
- [ ] No errors in backend logs

---

## Rollback Plan

If issues arise, revert commits:

```bash
# Revert monitor API fix
git revert <monitor-api-commit-hash>

# Revert Groups component fix
git revert <groups-component-commit-hash>
```

No data migration needed since we didn't change storage format.
