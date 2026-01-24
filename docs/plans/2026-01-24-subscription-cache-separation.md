# Subscription Cache Logic Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the issue where subscription updates are delayed by cache, while preserving cache performance for link parsing.

**Architecture:** Implement a "read-through" cache strategy where subscription checks (polling/commands) bypass the cache read step but update the cache on success. Link parsing remains unchanged (read-heavy cache).

**Tech Stack:** Node.js

---

### Task 1: Update BiliApi for Cache Control

**Files:**
- Modify: `src/services/biliApi.js`

**Step 1: Modify `_withCache` signature**

Update `_withCache` to accept `bypassCache` parameter. Logic:
- If `bypassCache` is true: Skip `cacheManager.get`.
- Always: Perform `fetchFn` and `cacheManager.set` on success.

```javascript
// src/services/biliApi.js

// Change method signature
async _withCache(keyPrefix, id, groupId, fetchFn, bypassCache = false) {
    const cacheKey = `${keyPrefix}:${id}:${groupId || 'public'}`;

    // Only read cache if NOT bypassing
    if (!bypassCache) {
        const cached = await cacheManager.get(cacheKey);
        if (cached) {
            return cached;
        }
    }

    try {
        // Fetch fresh data
        const result = await fetchFn();

        // Only cache successful results
        // Note: Even when bypassing read, we WRITE to cache to keep it fresh for others
        if (result && result.status === 'success') {
            await cacheManager.set(cacheKey, result);
        }

        return result;
    } catch (error) {
        // ... existing error handling ...
        return {
            status: 'error',
            message: `Service communication error: ${error.message}`
        };
    }
}
```

**Step 2: Update `getUserDynamic`**

Expose the parameter in the specific method used for subscriptions.

```javascript
// src/services/biliApi.js

// Update method
async getUserDynamic(uid, groupId, bypassCache = false) {
    // Caching user dynamics (reduces load on subscription checks)
    return this._withCache('user_dynamic', uid, groupId, () =>
        serviceManager.sendCommand('user_dynamic', { uid, group_id: groupId }),
        bypassCache
    );
}
```

---

### Task 2: Update Polling Logic

**Files:**
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Force fresh data in `checkUserDynamic`**

Modify the call to `biliApi.getUserDynamic` to pass `true` for `bypassCache`.

```javascript
// src/services/subscription/updateChecker.js

async checkUserDynamic(sub, force = false) {
    try {
        // Pass true as 3rd argument to bypass cache
        const res = await biliApi.getUserDynamic(sub.uid, null, true);
        if (res.status !== 'success') {
            // ... existing code ...
```

---

### Task 3: Update Manual Check & Fix Types

**Files:**
- Modify: `src/services/subscriptionService.js`

**Step 1: Harden `checkSubscriptionNow` with type safety**

Ensure `groupId` comparison works regardless of String/Number input, and ensure manual checks also bypass cache (via `updateChecker` modification in Task 2).

```javascript
// src/services/subscriptionService.js

async checkSubscriptionNow(uid, groupId) {
    // Ensure subscriptions are loaded before checking
    await subscriptionManager._ensureSubscriptionsLoaded();

    // Type-safe comparison
    const targetGroupId = String(groupId);
    const sub = subscriptionManager.userSubs.find(s =>
        String(s.uid) === String(uid) &&
        s.groupIds.map(String).includes(targetGroupId)
    );

    if (sub) {
        // Force check to generate card immediately
        // CRITICAL: Create a temporary sub object with ONLY the current group ID
        const tempSub = {
            ...sub,
            groupIds: [targetGroupId]
        };
        // updateChecker.checkUserDynamic now internally uses bypassCache=true
        // 2nd arg true = force (process even if ID hasn't changed, needed for "Check Now" command)
        await updateChecker.checkUserDynamic(tempSub, true);
        return true;
    }
    return false;
}
```

---

### Task 4: Verification (Manual)

**Files:**
- N/A (Manual Testing)

**Step 1: Verify Subscription Query**
- Command: `/查询订阅 <UID>`
- Expected: Should return latest dynamic immediately, even if it was just posted 1s ago.

**Step 2: Verify Link Parsing Cache**
- Action: Send a link `https://t.bilibili.com/<ID>`
- Action: Send it again 5s later.
- Expected: Second time should NOT trigger a new network request (check logs for "Cache hit").
