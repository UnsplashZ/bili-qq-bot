# Subscription Cache Freshness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix stale-cache false negatives in subscription monitoring by making cache freshness absolute and routing mutable-state checks through fresh reads.

**Architecture:** Update the disk cache to expire based on fetch time rather than last read time, add an explicit freshness policy in `biliApi`, and switch subscription decision paths to use fresh reads for mutable state. Keep cached reads for presentation-oriented flows so the fix stays correct without disabling cache everywhere.

**Tech Stack:** Node.js, CommonJS modules, file-backed JSON cache, subscription update checker, unit tests under `test/unit`

---

## Execution Notes

Completed in this session:

- added cache freshness regression coverage
- changed cache storage to explicit metadata-wrapped entries with fetch-time expiry
- added explicit cache policy handling in `biliApi`
- switched state-sensitive subscription reads to `fresh`
- verified the live regression path locally for subscribed users already known to be live

Verification commands used:

- `npx mocha --exit test/unit/cacheManager-freshness.test.js test/unit/biliApi-cache-policy.test.js test/unit/updateChecker-live-cache-regression.test.js test/unit/updateChecker-manual-feed-state-advance.test.js test/unit/updateChecker-unified-state-advance.test.js test/unit/subscriptionLiveState.test.js`
- `npx mocha --exit test/unit/subscription-meta-cache-context-key.test.js test/unit/subscriptionUserMetaCacheService.test.js`

Manual local validation used a temporary local `bili_server` process and confirmed:

- UID `51628309`: `lastLiveStatus` advanced `0 -> 1`
- UID `108618052`: `lastLiveStatus` advanced `0 -> 1`

### Task 1: Add cache freshness regression tests

**Files:**
- Create: `/root/dev/bili-qq-bot/test/unit/cacheManager-freshness.test.js`
- Modify: `/root/dev/bili-qq-bot/src/utils/cacheManager.js`

**Step 1: Write the failing test**

Add tests covering:
- a cache entry expires based on original fetch time, not read time
- reading a cache entry does not extend its freshness window
- legacy raw cache payloads remain readable

**Step 2: Run test to verify it fails**

Run: `node test/unit/cacheManager-freshness.test.js`

Expected: FAIL because the current implementation refreshes `mtime` on read and has no explicit fetch metadata.

**Step 3: Write minimal implementation**

Update `/root/dev/bili-qq-bot/src/utils/cacheManager.js`:
- store cache entries in a wrapper shape with metadata including `fetchedAt`
- compute expiry from `fetchedAt`
- stop refreshing freshness on read
- keep backward compatibility for legacy raw entries

**Step 4: Run test to verify it passes**

Run: `node test/unit/cacheManager-freshness.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 2: Add explicit cache policy to Bili API reads

**Files:**
- Modify: `/root/dev/bili-qq-bot/src/services/biliApi.js`
- Create: `/root/dev/bili-qq-bot/test/unit/biliApi-cache-policy.test.js`

**Step 1: Write the failing test**

Add tests covering:
- `cached` reads may return existing cache without upstream call
- `fresh` reads bypass cache lookup
- successful `fresh` reads still update cache content

**Step 2: Run test to verify it fails**

Run: `node test/unit/biliApi-cache-policy.test.js`

Expected: FAIL because `_withCache()` only supports the current boolean bypass behavior and does not expose a clear policy contract.

**Step 3: Write minimal implementation**

Update `/root/dev/bili-qq-bot/src/services/biliApi.js`:
- add a small cache-policy abstraction for `_withCache()`
- preserve backward compatibility for existing callers
- keep API surface simple enough for selective adoption in monitoring flows

**Step 4: Run test to verify it passes**

Run: `node test/unit/biliApi-cache-policy.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 3: Make live subscription state checks bypass stale cached user state

**Files:**
- Modify: `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/modules/manualChecks.js`
- Create: `/root/dev/bili-qq-bot/test/unit/updateChecker-live-cache-regression.test.js`
- Check: `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/helpers/liveState.js`

**Step 1: Write the failing test**

Add a regression test that simulates:
- cached `user_info` says `liveStatus=0`
- upstream fresh `user_info` says `liveStatus=1`
- `lastLiveStatus` starts at `0`

Test expectation:
- live check must use fresh data
- notification path is attempted
- state advances to `1` after successful notification

**Step 2: Run test to verify it fails**

Run: `node test/unit/updateChecker-live-cache-regression.test.js`

Expected: FAIL because `checkUserLive()` currently uses cached `getUserInfo()`.

**Step 3: Write minimal implementation**

Update `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/modules/manualChecks.js`:
- use fresh-read policy for mutable user state in live decision flow
- keep existing notify/state-advance behavior unchanged

**Step 4: Run test to verify it passes**

Run: `node test/unit/updateChecker-live-cache-regression.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 4: Audit and patch other mutable-state subscription decision paths

**Files:**
- Modify: `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/modules/manualChecks.js`
- Modify: `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/modules/feed.js`
- Modify: `/root/dev/bili-qq-bot/src/services/subscription/updateChecker/modules/unifiedChecks.js`
- Test: `/root/dev/bili-qq-bot/test/unit/updateChecker-unified-state-advance.test.js`
- Test: `/root/dev/bili-qq-bot/test/unit/updateChecker-manual-feed-state-advance.test.js`

**Step 1: Write the failing test**

Add or extend tests to prove that subscription state decisions do not rely on stale cached mutable payloads for:
- manual user checks
- feed fallback checks
- unified user state checks where mutable payloads are involved

**Step 2: Run test to verify it fails**

Run: `node test/unit/updateChecker-unified-state-advance.test.js`

Run: `node test/unit/updateChecker-manual-feed-state-advance.test.js`

Expected: At least one assertion fails or requires new behavior coverage because freshness policy is not yet consistently applied.

**Step 3: Write minimal implementation**

Audit the listed modules and update only the decision-making call sites that depend on mutable remote state:
- switch them to fresh policy where needed
- leave presentation-oriented reads alone
- avoid unrelated refactors

**Step 4: Run test to verify it passes**

Run: `node test/unit/updateChecker-unified-state-advance.test.js`

Run: `node test/unit/updateChecker-manual-feed-state-advance.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 5: Add deployment-safe handling for legacy mutable cache entries

**Files:**
- Modify: `/root/dev/bili-qq-bot/src/utils/cacheManager.js`
- Create: `/root/dev/bili-qq-bot/test/unit/cacheManager-freshness.test.js`
- Document: `/root/dev/bili-qq-bot/docs/plans/2026-03-10-subscription-cache-freshness-design.md`

**Step 1: Write the failing test**

Add coverage for:
- legacy mutable cache entries being read safely
- rewritten entries adopting the new metadata shape after fresh fetch

**Step 2: Run test to verify it fails**

Run: `node test/unit/cacheManager-freshness.test.js`

Expected: FAIL because rewrite/migration behavior is not implemented yet.

**Step 3: Write minimal implementation**

Implement compatibility behavior in `/root/dev/bili-qq-bot/src/utils/cacheManager.js`:
- detect legacy payloads
- return them safely
- ensure the next successful write converts them to the new shape

Also add rollout notes to the design doc if implementation detail changes.

**Step 4: Run test to verify it passes**

Run: `node test/unit/cacheManager-freshness.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.

### Task 6: Run targeted verification

**Files:**
- Verify: `/root/dev/bili-qq-bot/test/unit/cacheManager-freshness.test.js`
- Verify: `/root/dev/bili-qq-bot/test/unit/biliApi-cache-policy.test.js`
- Verify: `/root/dev/bili-qq-bot/test/unit/updateChecker-live-cache-regression.test.js`
- Verify: `/root/dev/bili-qq-bot/test/unit/updateChecker-unified-state-advance.test.js`
- Verify: `/root/dev/bili-qq-bot/test/unit/updateChecker-manual-feed-state-advance.test.js`

**Step 1: Run focused cache tests**

Run: `node test/unit/cacheManager-freshness.test.js`

Expected: PASS

**Step 2: Run API policy tests**

Run: `node test/unit/biliApi-cache-policy.test.js`

Expected: PASS

**Step 3: Run subscription regression tests**

Run: `node test/unit/updateChecker-live-cache-regression.test.js`

Run: `node test/unit/updateChecker-unified-state-advance.test.js`

Run: `node test/unit/updateChecker-manual-feed-state-advance.test.js`

Expected: PASS

**Step 4: Run one existing adjacent regression test**

Run: `node test/unit/subscriptionLiveState.test.js`

Expected: PASS

**Step 5: Commit**

Do not commit without explicit user approval.
