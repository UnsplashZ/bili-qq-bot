# Subscription Fallback Protection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent duplicate re-push for video/article subscriptions when the previously tracked latest item is deleted, while preserving existing behavior for first-run and force-check flows.

**Architecture:** Extend subscription state from ID-only to `ID + timestamp` for both manual subscriptions and cookie-followers. Apply timestamp fallback guards in unified video/article checkers so traversal stops when content is older than the last known anchor. Keep current notification pipeline, dedup cache, and race-condition-safe state update path unchanged.

**Tech Stack:** Node.js (CommonJS), existing unit tests under `test/unit/*.test.js`, subscription state files managed via `storageUtils.asyncWriteWithBackup()`.

---

## Execution Rules

1. Use `@test-driven-development`: write failing tests first for each behavior change.
2. Keep changes minimal (DRY + YAGNI): only touch subscription state fields and video/article checker logic.
3. Use `@verification-before-completion`: do not claim success until all listed test commands pass.
4. Make frequent commits: one commit per task.

### Task 1: Add failing tests for state field compatibility in SubscriptionManager

**Files:**
- Create: `test/unit/subscriptionManager-fallbackStateFields.test.js`
- Modify: `src/services/subscription/subscriptionManager.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const subscriptionManager = require(path.join(__dirname, '../../src/services/subscription/subscriptionManager'))

subscriptionManager._saveFollowers = async () => {}
subscriptionManager._followersLoaded = true

async function run() {
    const accountUid = 'acc_state_fields'
    const uid = '10086'

    // old follower has new timestamp state
    subscriptionManager.cookieFollowings[accountUid] = [{
        mid: Number(uid),
        name: 'tester',
        lastDynamicId: '1',
        lastLiveStatus: 0,
        lastVideoId: 'BV_old',
        lastVideoCreated: 1700000000,
        lastArticleId: 'cv_old',
        lastArticlePublishTime: 1700000001
    }]

    // refresh from API (without state fields)
    await subscriptionManager.setCookieFollowings(accountUid, [{ mid: Number(uid), name: 'tester' }])

    const merged = subscriptionManager.cookieFollowings[accountUid][0]
    assert.strictEqual(merged.lastVideoCreated, 1700000000)
    assert.strictEqual(merged.lastArticlePublishTime, 1700000001)
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
})
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/subscriptionManager-fallbackStateFields.test.js`  
Expected: FAIL (timestamp fields are `undefined` after merge/recovery paths).

**Step 3: Write minimal implementation**

In `src/services/subscription/subscriptionManager.js`, update:

```js
_normalizeFollowerState(f) {
    if (!f) return f
    if (f.lastDynamicId === undefined) f.lastDynamicId = null
    if (f.lastLiveStatus === undefined) f.lastLiveStatus = 0
    if (f.lastVideoId === undefined) f.lastVideoId = null
    if (f.lastVideoCreated === undefined) f.lastVideoCreated = null
    if (f.lastArticleId === undefined) f.lastArticleId = null
    if (f.lastArticlePublishTime === undefined) f.lastArticlePublishTime = null
    return f
}
```

And preserve new fields in:
- stale cache save/restore
- merge from `oldF`
- initialize defaults for new followers

**Step 4: Run test to verify it passes**

Run: `node test/unit/subscriptionManager-fallbackStateFields.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscriptionManager-fallbackStateFields.test.js src/services/subscription/subscriptionManager.js
git commit -m "test: add follower timestamp state compatibility coverage"
```

### Task 2: Add failing tests for video fallback guard behavior

**Files:**
- Create: `test/unit/checkUserVideoUnified-fallbackGuard.test.js`
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const updateChecker = require(path.join(__dirname, '../../src/services/subscription/updateChecker'))
const biliApi = require(path.join(__dirname, '../../src/services/biliApi'))

async function run() {
    const pushed = []
    updateChecker.notifyGroupsWithImageAndCache = async () => { pushed.push('sent') }
    updateChecker.updateVideoState = async () => {}

    // list only has old video1, last state points to deleted video2
    biliApi.getUserVideos = async () => ({
        status: 'success',
        data: { videos: [{ bvid: 'BV1', created: 100 }] }
    })

    const userItem = {
        uid: '1',
        name: 'up',
        targetGroups: ['1000'],
        source: 'manual',
        manualSub: { lastVideoId: 'BV2', lastVideoCreated: 200 },
        cookieFollower: null
    }

    await updateChecker.checkUserVideoUnified(userItem, false)
    assert.strictEqual(pushed.length, 0, 'should not re-push old video when latest was deleted')
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
})
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/checkUserVideoUnified-fallbackGuard.test.js`  
Expected: FAIL (current logic pushes BV1).

**Step 3: Write minimal implementation**

In `src/services/subscription/updateChecker.js`:
- read `lastVideoCreated` from manual/cookie state
- in traversal loop, add guard:

```js
const created = Number(video.created)
if (
    lastVideoCreated !== null &&
    Number.isFinite(created) &&
    created < lastVideoCreated
) break
```

- when `lastVideoId` missing in list and guard stops traversal, do not push old items.

**Step 4: Run test to verify it passes**

Run: `node test/unit/checkUserVideoUnified-fallbackGuard.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/checkUserVideoUnified-fallbackGuard.test.js src/services/subscription/updateChecker.js
git commit -m "fix: prevent video re-push on deleted latest item"
```

### Task 3: Add failing tests for article fallback guard behavior

**Files:**
- Create: `test/unit/checkUserArticleUnified-fallbackGuard.test.js`
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const updateChecker = require(path.join(__dirname, '../../src/services/subscription/updateChecker'))
const biliApi = require(path.join(__dirname, '../../src/services/biliApi'))

async function run() {
    const pushed = []
    updateChecker.notifyGroupsWithImageAndCache = async () => { pushed.push('sent') }
    updateChecker.updateArticleState = async () => {}

    biliApi.getUserArticles = async () => ({
        status: 'success',
        data: { articles: [{ id: 1, publish_time: 100 }] }
    })

    const userItem = {
        uid: '1',
        name: 'up',
        targetGroups: ['1000'],
        source: 'manual',
        manualSub: { lastArticleId: 'cv2', lastArticlePublishTime: 200 },
        cookieFollower: null
    }

    await updateChecker.checkUserArticleUnified(userItem, false)
    assert.strictEqual(pushed.length, 0, 'should not re-push old article when latest was deleted')
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
})
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/checkUserArticleUnified-fallbackGuard.test.js`  
Expected: FAIL (current logic pushes cv1).

**Step 3: Write minimal implementation**

In `src/services/subscription/updateChecker.js`:
- read `lastArticlePublishTime`
- add guard in article traversal:

```js
const publishTime = Number(article.publish_time)
if (
    lastArticlePublishTime !== null &&
    Number.isFinite(publishTime) &&
    publishTime < lastArticlePublishTime
) break
```

**Step 4: Run test to verify it passes**

Run: `node test/unit/checkUserArticleUnified-fallbackGuard.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/checkUserArticleUnified-fallbackGuard.test.js src/services/subscription/updateChecker.js
git commit -m "fix: prevent article re-push on deleted latest item"
```

### Task 4: Implement state update API to persist ID + timestamp anchors

**Files:**
- Modify: `src/services/subscription/updateChecker.js`
- Modify: `src/services/subscription/subscriptionManager.js`
- Test: `test/unit/updateVideoState-race.test.js`

**Step 1: Write/adjust failing assertions**

Add assertions in `test/unit/updateVideoState-race.test.js` for:
- `lastVideoCreated` is saved with `lastVideoId`
- `lastArticlePublishTime` is saved with `lastArticleId`

**Step 2: Run test to verify it fails**

Run: `node test/unit/updateVideoState-race.test.js`  
Expected: FAIL on new timestamp assertions.

**Step 3: Write minimal implementation**

Update signatures and writes:

```js
async updateVideoState(userItem, videoState) {
    const updates = {
        lastVideoId: videoState.videoId,
        lastVideoCreated: videoState.videoCreated
    }
    // update manualSub + cookieFollower via existing safe path
}
```

```js
async updateArticleState(userItem, articleState) {
    const updates = {
        lastArticleId: articleState.articleId,
        lastArticlePublishTime: articleState.articlePublishTime
    }
}
```

Update all call sites to pass both ID and timestamp on init and post-push refresh.

**Step 4: Run test to verify it passes**

Run: `node test/unit/updateVideoState-race.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/subscription/updateChecker.js src/services/subscription/subscriptionManager.js test/unit/updateVideoState-race.test.js
git commit -m "refactor: persist video and article timestamp anchors"
```

### Task 5: Add backward-compatibility test for legacy state (ID without timestamp)

**Files:**
- Create: `test/unit/subscription-legacyAnchorCompatibility.test.js`
- Modify: `src/services/subscription/updateChecker.js`

**Step 1: Write the failing test**

```js
#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const updateChecker = require(path.join(__dirname, '../../src/services/subscription/updateChecker'))
const biliApi = require(path.join(__dirname, '../../src/services/biliApi'))

async function run() {
    let pushed = 0
    let refreshed = null
    updateChecker.notifyGroupsWithImageAndCache = async () => { pushed++ }
    updateChecker.updateVideoState = async (userItem, state) => { refreshed = state }

    // legacy: has lastVideoId but no lastVideoCreated
    biliApi.getUserVideos = async () => ({
        status: 'success',
        data: { videos: [{ bvid: 'BV1', created: 100 }] }
    })

    await updateChecker.checkUserVideoUnified({
        uid: '1',
        name: 'up',
        targetGroups: ['1000'],
        source: 'manual',
        manualSub: { lastVideoId: 'BV2', lastVideoCreated: null }
    }, false)

    assert.strictEqual(pushed, 0, 'legacy missing timestamp should not trigger replay push')
    assert.deepStrictEqual(refreshed, { videoId: 'BV1', videoCreated: 100 })
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
})
```

**Step 2: Run test to verify it fails**

Run: `node test/unit/subscription-legacyAnchorCompatibility.test.js`  
Expected: FAIL (either pushes old item or does not refresh anchor payload correctly).

**Step 3: Write minimal implementation**

In video/article unified checkers:
- detect legacy anchor (`lastId` exists and `lastTimestamp` is null)
- if traversal cannot find `lastId`, skip push and refresh to latest `id + timestamp`.

**Step 4: Run test to verify it passes**

Run: `node test/unit/subscription-legacyAnchorCompatibility.test.js`  
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-legacyAnchorCompatibility.test.js src/services/subscription/updateChecker.js
git commit -m "fix: add legacy anchor compatibility for fallback protection"
```

### Task 6: Full verification and final integration commit

**Files:**
- Verify: `src/services/subscription/updateChecker.js`
- Verify: `src/services/subscription/subscriptionManager.js`
- Verify: `test/unit/*.test.js` (affected set)

**Step 1: Run targeted tests**

Run:

```bash
node test/unit/subscriptionManager-fallbackStateFields.test.js
node test/unit/checkUserVideoUnified-fallbackGuard.test.js
node test/unit/checkUserArticleUnified-fallbackGuard.test.js
node test/unit/subscription-legacyAnchorCompatibility.test.js
node test/unit/updateVideoState-race.test.js
```

Expected: all PASS.

**Step 2: Run regression tests related to subscriptions/message handling**

Run:

```bash
node test/unit/feedState-race.test.js
node test/unit/messageHandler-linkReaction.test.js
node test/unit/resolveArticleTitle.test.js
```

Expected: PASS, no behavior regressions.

**Step 3: Run full unit sweep**

Run:

```bash
for f in test/unit/*.test.js; do node "$f"; done
```

Expected: all PASS.

**Step 4: Review diffs for scope control**

Run:

```bash
git status --short
git diff -- src/services/subscription/subscriptionManager.js src/services/subscription/updateChecker.js test/unit
```

Expected: only planned files changed.

**Step 5: Commit**

```bash
git add src/services/subscription/subscriptionManager.js src/services/subscription/updateChecker.js test/unit
git commit -m "fix: guard subscription video/article fallback from replay pushes"
```

---

## Acceptance Criteria

1. 视频/专栏在“最新内容已删除导致列表回退”时不再重复推送旧内容。
2. 正常新增内容仍能推送。
3. 老状态（仅ID无时间戳）不会在升级后产生回放推送。
4. Cookie followings 的状态合并、恢复、并发写路径均保留新时间戳字段。
5. 计划内测试和现有回归测试全部通过。

## Execution Handoff

Plan complete and saved to `docs/plans/2026-02-27-subscription-fallback-protection-design.md`. Two execution options:

1. Subagent-Driven (this session) - dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - open new session with `executing-plans`, batch execution with checkpoints
