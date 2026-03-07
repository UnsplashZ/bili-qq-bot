# Subscription Live And List Metadata Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix intermittent full-session live notification misses, restore avatars in the WebUI subscription list, and add verification badges to the `/订阅列表` image output.

**Architecture:** Reuse `subscriptionUserMetaCacheService` as the single enrichment path for subscription user display metadata, then add badge rendering in the subscription list image generator. For live notifications, extract shared live-state confirmation logic so both manual subscriptions and cookie-sync feed checks distinguish confirmed online/offline states from unknown upstream responses before advancing persisted state.

**Tech Stack:** Node.js, Express, React, Puppeteer image generation, existing subscription/updateChecker modules, local unit tests if available

---

### Task 1: Baseline the current subscription metadata flow

**Files:**
- Read: `src/dashboard/routes/api/modules/subscriptions.js`
- Read: `src/commands/subscription.js`
- Read: `src/services/subscriptionUserMetaCacheService.js`
- Read: `src/services/imageGenerator/generators/subscriptionList.js`

**Step 1: Write down the exact metadata contract**

Document the fields each caller needs for user subscriptions:

```text
uid
name
face
officialVerify
```

**Step 2: Identify the current split paths**

Verify that:
- WebUI already calls `enrichSubscriptions()`.
- `/订阅列表` still calls `biliApi.getUserCard()` directly.
- The image generator does not yet render `officialVerify`.

**Step 3: Confirm the target behavior**

Expected outcome:
- Both WebUI and `/订阅列表` use the same enrichment service.
- The image generator accepts enriched users without additional fetch logic.

**Step 4: Commit the analysis checkpoint**

```bash
git add docs/plans/2026-03-07-subscription-live-and-list-metadata-design.md docs/plans/2026-03-07-subscription-live-and-list-metadata-fixes.md
git commit -F - <<'COMMITMSG'
v3.20.4 记录订阅直播与列表元数据修复设计

- 新增直播漏推与订阅列表元数据问题设计文档
- 新增对应的实现计划，明确元数据统一与直播状态确认改造路径
COMMITMSG
```

### Task 2: Add a failing test or fixture for subscription metadata enrichment

**Files:**
- Create or modify: `test/unit/subscriptionUserMetaCacheService.test.js`
- Read: `src/services/subscriptionUserMetaCacheService.js`

**Step 1: Write the failing test**

Cover at least one case where a subscription item without `face` or `officialVerify` is enriched into a renderable object:

```javascript
it('enriches subscription users with face and officialVerify fallback fields', async () => {
  const users = [{ uid: '123', name: 'Test UP' }]
  const result = await service.enrichSubscriptions(users, '10001')
  expect(result[0]).toEqual(expect.objectContaining({
    uid: '123',
    name: expect.any(String)
  }))
})
```

**Step 2: Run the test to verify the baseline**

Run: `npm test -- --runInBand test/unit/subscriptionUserMetaCacheService.test.js`
Expected: Either FAIL for the missing assertion target or reveal no existing coverage.

**Step 3: Adjust the test for the real module shape**

If the project has no existing test harness for this file, create the smallest targeted test or script under `test/` without committing generated artifacts.

**Step 4: Re-run the targeted verification**

Run the narrowest command that proves the enriched shape.

**Step 5: Commit**

```bash
git add test/unit/subscriptionUserMetaCacheService.test.js src/services/subscriptionUserMetaCacheService.js
git commit -m "test: cover subscription user metadata enrichment" -m "Add targeted coverage for face and officialVerify enrichment fallback behavior."
```

### Task 3: Route `/订阅列表` through the shared metadata enrichment path

**Files:**
- Modify: `src/commands/subscription.js`
- Read: `src/services/subscriptionService.js`
- Read: `src/services/subscriptionUserMetaCacheService.js`

**Step 1: Write the failing test or reproducible check**

Define the expected `/订阅列表` payload shape before image generation:

```javascript
expect(data.users[0]).toEqual(expect.objectContaining({
  face: expect.any(String),
  officialVerify: expect.anything()
}))
```

**Step 2: Run the check to confirm the current gap**

Use the smallest available command or local script to show that `officialVerify` is currently absent from the command path.

**Step 3: Implement the minimal code change**

Replace the ad-hoc `getUserCard()` enrichment block with a call to `subscriptionUserMetaCacheService.enrichSubscriptions()` or an equivalent shared path. Preserve existing fallback behavior for empty groups and error handling.

**Step 4: Run the targeted verification**

Verify that the command path now prepares users with `face` and `officialVerify` fields.

**Step 5: Commit**

```bash
git add src/commands/subscription.js
git commit -m "refactor: unify subscription command user metadata" -m "Route /订阅列表 through the shared subscription user metadata enrichment path."
```

### Task 4: Render verification badges in the subscription list image generator

**Files:**
- Modify: `src/services/imageGenerator/generators/subscriptionList.js`
- Read: `src/services/imageGenerator/renderers/components/verifyBadge.js`
- Read: `src/services/imageGenerator/renderers/icons.js`

**Step 1: Write the failing render check**

Create a targeted generator test or snapshot expectation for a user item with:

```javascript
{
  uid: '123',
  name: 'Test UP',
  face: 'https://example.com/avatar.jpg',
  officialVerify: { type: 0, desc: '个人认证' }
}
```

Expected output should contain the badge markup or the badge asset reference.

**Step 2: Run the check to confirm current absence**

Run the narrowest test or local render verification.
Expected: FAIL because the generator currently renders no badge.

**Step 3: Implement the minimal rendering change**

Add badge markup and styling to the avatar container. Reuse existing badge assets or helpers where practical. Also add avatar `onerror` fallback in the generated HTML.

**Step 4: Run the targeted verification**

Confirm both avatar fallback and badge markup render as expected.

**Step 5: Commit**

```bash
git add src/services/imageGenerator/generators/subscriptionList.js
git commit -m "feat: add verify badge to subscription list image" -m "Render official verification badges and avatar fallback in the subscription list image output."
```

### Task 5: Verify WebUI subscription list avatar rendering end-to-end

**Files:**
- Read: `dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx`
- Modify if needed: `dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx`
- Read: `dashboard/src/pages/groups/hooks/useSubscriptions.js`

**Step 1: Write a focused UI check**

Assert that a user subscription row with `face` renders an `<img>` using `sub.face || DEFAULT_AVATAR_URL` and keeps the badge overlay when `officialVerify` exists.

**Step 2: Run the existing frontend check**

Run: `npm --prefix dashboard run build`
Expected: PASS after the API and component contract align.

**Step 3: Make only the necessary UI adjustments**

Only change the component if the shared metadata path exposes a contract mismatch. Avoid redesigning the table.

**Step 4: Re-run the frontend build**

Run: `npm --prefix dashboard run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx
git commit -m "fix: align subscription list avatar rendering" -m "Keep the WebUI subscription list aligned with the shared metadata enrichment contract."
```

### Task 6: Extract shared live-state confirmation logic

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/manualChecks.js`
- Modify: `src/services/subscription/updateChecker/modules/feed.js`
- Create or modify: `src/services/subscription/updateChecker/helpers/liveState.js`
- Read: `src/services/subscription/updateChecker/helpers/stateAdvance.js`

**Step 1: Write the failing tests**

Add narrow cases for:

```javascript
it('does not advance to offline when live status is unknown but roomId is cached', async () => {})
it('advances to online only when live is confirmed and notification can advance', async () => {})
it('keeps previous state when room detail confirmation fails', async () => {})
```

**Step 2: Run the targeted tests**

Run the smallest test command available for the update checker live module.
Expected: FAIL against current behavior or reveal missing coverage.

**Step 3: Implement the shared helper**

Create a helper that returns one of:

```javascript
{ status: 'online', roomId }
{ status: 'offline', roomId }
{ status: 'unknown', roomId }
```

Use it from both manual live checks and feed live checks. Only persist `lastLiveStatus` when the helper result is confirmed and `decideAdvance()` allows state advancement.

**Step 4: Re-run targeted live verification**

Confirm the unknown-state and confirmed-online/offline cases behave as designed.

**Step 5: Commit**

```bash
git add src/services/subscription/updateChecker/modules/manualChecks.js src/services/subscription/updateChecker/modules/feed.js src/services/subscription/updateChecker/helpers/liveState.js
git commit -m "fix: harden live state confirmation" -m "Treat incomplete upstream live signals as unknown and only advance persisted live status after confirmed transitions."
```

### Task 7: Run minimal final verification

**Files:**
- Read: `package.json`
- Read: `dashboard/package.json`

**Step 1: Run backend-targeted verification**

Use the smallest command set that validates the touched Node.js modules and any added tests.

Possible commands:

```bash
npm test -- --runInBand test/unit/subscriptionUserMetaCacheService.test.js
npm test -- --runInBand test/unit/updateChecker.live.test.js
```

**Step 2: Run frontend verification**

```bash
npm --prefix dashboard run build
```

**Step 3: If image generator verification exists, run it**

Use the narrowest preview or generator check for `subscriptionList.js`. Place any generated local preview files directly under `test/output/`.

**Step 4: Review git diff**

Run:

```bash
git diff --stat
git diff -- src/commands/subscription.js src/services/subscription/updateChecker/modules/manualChecks.js src/services/subscription/updateChecker/modules/feed.js src/services/imageGenerator/generators/subscriptionList.js dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx
```

**Step 5: Commit the verification-ready batch**

```bash
git add src/commands/subscription.js src/services/subscription/updateChecker/modules/manualChecks.js src/services/subscription/updateChecker/modules/feed.js src/services/subscription/updateChecker/helpers/liveState.js src/services/imageGenerator/generators/subscriptionList.js dashboard/src/pages/groups/components/tabs/SubscriptionsTab.jsx test/unit/subscriptionUserMetaCacheService.test.js test/unit/updateChecker.live.test.js
git commit -m "fix: repair subscription live notifications and list metadata" -m "Unify subscription display metadata, add verification badges, and harden live-state confirmation against incomplete upstream responses."
```
