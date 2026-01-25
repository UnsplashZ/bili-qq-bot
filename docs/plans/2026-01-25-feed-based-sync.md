# Feed-Based Cookie Following Sync Implementation Plan (Updated)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a high-performance, low-risk "Feed Stream" polling mechanism for syncing and pushing updates from Bilibili cookie-followed accounts, ensuring no missed updates (via pagination) and stable follower list maintenance (via hourly sync).

**Architecture:**
Switch from "Active Polling (N requests)" to "Feed Monitoring (2+ requests)". The Python service will expose new endpoints to fetch the user's "Dynamic Feed" (with pagination support) and "Live Feed". The Node.js service will poll these feeds every minute, auto-paginating if high activity is detected, and trigger push notifications. A separate hourly job will sync the full follower list ("Shadow List") to capture new follows/unfollows.

**Tech Stack:** Node.js, Python (bilibili-api-python), Puppeteer (existing image gen)

---

### Task 1: Python Service - Feed Endpoints with Pagination

**Files:**
- Modify: `scripts/bili_service.py`

**Step 1: Add `/get_dynamic_feed` endpoint with offset support**

Add a new route to `bili_service.py` that fetches the dynamic feed, accepting an optional `offset` parameter for pagination.

```python
# In scripts/bili_service.py

async def get_dynamic_feed(offset=None, group_id=None):
    try:
        cred = load_credential(group_id)
        # API: https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all
        api = Api("https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all", method="GET", credential=cred)
        params = {'type': 'all', 'page': 1, 'timezone_offset': -480}

        # If offset is provided, use it (though this API typically uses 'offset' for next page, check API docs or response)
        # Bilibili Feed API usually returns 'offset' in response to be used in next request.
        if offset:
            params['offset'] = offset

        api.update_params(**params)
        data = await api.result
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Add dispatch logic
elif command == "dynamic_feed":
    offset = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "None" else None
    group_id = sys.argv[3] if len(sys.argv) > 3 else None
    result = await get_dynamic_feed(offset, group_id)
    print(json.dumps(result, ensure_ascii=False))
```

**Step 2: Add `/get_live_feed` endpoint**
(Same as previous plan)

---

### Task 2: Node.js BiliApi Wrapper

**Files:**
- Modify: `src/services/biliApi.js`

**Step 1: Update `getDynamicFeed` to accept offset**

```javascript
// src/services/biliApi.js

async getDynamicFeed(offset, groupId) {
    // No cache needed for feed
    return serviceManager.sendCommand('dynamic_feed', { offset: offset || null, group_id: groupId });
}
```

---

### Task 3: Subscription Manager - Shadow List Logic

**Files:**
- Modify: `src/services/subscription/subscriptionManager.js`

**Step 1: Update `setCookieFollowings` (Smart Merge)**
(Same as previous plan - preserve `lastDynamicId`)

**Step 2: Add `getGlobalLastDynamicId` helper**
We need to know the *global* oldest "last seen" ID across all followers to know when to stop paginating. Actually, we should track the *newest* ID we successfully processed in the previous cycle as the watermark.
Or better: store a `latestFeedId` globally for the feed poller.

Let's add `updateCookieFollowerState` as planned.

---

### Task 4: Update Checker - Refactored Polling Logic

**Files:**
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Refactor `start()` to support dual timers**

Separate the "High Frequency" (Feed) and "Low Frequency" (List Sync) timers.

```javascript
// src/services/subscription/updateChecker.js

start() {
    if (this.timer) return;

    // 1. Existing checks (User/Bangumi Subs) + Feed Polling
    this.timer = setInterval(() => {
        this.checkAll();
    }, this.checkInterval);

    // 2. Low Frequency Sync (Hourly) - Shadow List Refresh
    this.syncTimer = setInterval(() => {
        this.refreshCookieFollowings();
    }, 60 * 60 * 1000);

    // Initial runs
    setTimeout(() => this.checkAll(), 10000);
    setTimeout(() => this.refreshCookieFollowings(), 5000); // Sync list shortly after start
}

stop() {
    // Clear both timers
}
```

**Step 2: Implement `checkFeedUpdate` with Pagination**

```javascript
async checkFeedUpdate() {
    // ... (group filtering logic same as before) ...

    for (const { accountUid, groupId } of accountsToPoll.values()) {
        try {
            await this.processDynamicFeed(accountUid, groupId);
            // ... live feed ...
        } catch (e) { ... }
    }
}

async processDynamicFeed(accountUid, groupId) {
    let offset = null;
    let hasMore = true;
    let page = 0;
    const MAX_PAGES = 5; // Safety limit (approx 100 items)

    // Get ALL followers for this account to quick-check if we care about the items
    const followers = subscriptionManager.cookieFollowings[String(accountUid)] || [];
    if (followers.length === 0) return;

    // We need a way to stop pagination.
    // Heuristic: If we encounter an item that is OLDER than the 'lastDynamicId' of that specific user,
    // it implies we've caught up for THAT user.
    // But different users update at different times.
    // Since we process chronologically descending (newest first), we can just process until we hit the safety limit
    // OR until we see items that are very old (e.g. > 1 day) if we want.
    // For now, simple pagination limited to 3-5 pages is safest and covers most bursts.

    while (hasMore && page < MAX_PAGES) {
        const res = await biliApi.getDynamicFeed(offset, groupId);
        if (res.status !== 'success' || !res.data || !res.data.items) break;

        const items = res.data.items;
        offset = res.data.offset; // Get next page offset
        hasMore = res.data.has_more && !!offset;
        page++;

        for (const item of items) {
            const authorUid = item.modules?.module_author?.mid;
            if (!authorUid) continue;

            const follower = followers.find(f => String(f.uid) === String(authorUid));
            if (!follower) continue;

            const dynamicId = item.id_str;

            // Critical: Check if newer than last seen for THIS user
            // Note: BigInt comparison needed for IDs
            if (follower.lastDynamicId && BigInt(dynamicId) <= BigInt(follower.lastDynamicId)) {
                // We've seen this (or newer) for this user.
                // We don't stop the whole feed loop because other users might have new stuff
                // interleaved further down?
                // No, Feed is strictly time-descending.
                // If we hit an old post for User A, it just means User A hasn't posted since then.
                // We continue processing for User B, C...
                continue;
            }

            // ... (Process notification logic) ...

            // Update state immediately to avoid re-processing in next page if duplicate (unlikely)
            // or next poll
            await subscriptionManager.updateCookieFollowerState(accountUid, authorUid, { lastDynamicId: dynamicId });
        }

        // Safety delay between pages
        if (hasMore) await new Promise(r => setTimeout(r, 1000));
    }
}
```

**Step 3: Cleanup `checkAll`**

Remove the call to `refreshCookieFollowings` from `checkAll` (it's now on its own timer). Add `checkFeedUpdate`.

---

### Task 5: Testing & Verification

**Step 1: Test Pagination**
- Write unit test mocking `biliApi.getDynamicFeed` to return 2 pages of data.
- Verify `processDynamicFeed` fetches both pages and updates state.

**Step 2: Test Low-Freq Sync**
- Verify `refreshCookieFollowings` is NOT called on every `checkAll` tick.
- Verify it IS called on startup and hourly.

