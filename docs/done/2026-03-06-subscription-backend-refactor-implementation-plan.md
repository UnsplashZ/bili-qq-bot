# Subscription Backend Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不推倒现有目录结构的前提下，完成订阅后端语义收敛，消除漏推风险，并分阶段提升性能与可维护性。

**Architecture:** 采用“语义内核 + 渐进接管”策略：先引入统一的状态推进、去重键、发送结果契约，再将 manual/feed/unified 检查链路逐步迁移到统一策略层。数据层通过 `schemaVersion` 自动迁移保持兼容，发布时使用灰度开关控制风险。

**Tech Stack:** Node.js 18+, Mocha, Express 5, OneBot v11 (NapCat), Python bili_server_core

---

## 0. 执行约束

- 本计划按 `@test-driven-development` 执行：先写失败测试，再最小实现。
- 每个任务完成后执行 `@verification-before-completion`。
- 频繁小提交；当前分支非 `main`，提交信息格式使用 `<type>: <summary>`。
- 禁止跨任务混改；每个任务只覆盖本任务文件范围。

---

### Task 1: 统一状态推进策略内核（P0）

**Files:**
- Create: `src/services/subscription/updateChecker/helpers/stateAdvance.js`
- Test: `test/unit/subscription-state-advance-policy.test.js`

**Step 1: Write the failing test**

```js
// test/unit/subscription-state-advance-policy.test.js
const assert = require('assert')
const { decideAdvance } = require('../../src/services/subscription/updateChecker/helpers/stateAdvance')

describe('state advance policy', function () {
  it('全失败不推进', function () {
    const r = decideAdvance({ successGroups: [], failedGroups: ['1000'] })
    assert.strictEqual(r.action, 'retry')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-state-advance-policy.test.js`
Expected: FAIL with `decideAdvance is not a function` or module not found.

**Step 3: Write minimal implementation**

```js
// src/services/subscription/updateChecker/helpers/stateAdvance.js
function decideAdvance(result) {
  const ok = Array.isArray(result?.successGroups) ? result.successGroups.length : 0
  if (ok > 0) return { action: 'advance', reason: 'has_success' }
  return { action: 'retry', reason: 'no_success' }
}

module.exports = { decideAdvance }
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-state-advance-policy.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-state-advance-policy.test.js src/services/subscription/updateChecker/helpers/stateAdvance.js
git commit -m "refactor: add unified subscription state advance policy"
```

---

### Task 2: 统一发送结果契约 NotifyResult（P0）

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/notify.js`
- Test: `test/unit/updateChecker-notify-result.test.js`

**Step 1: Write the failing test**

```js
// 断言 notifyGroupsWithImageAndCache 返回结构
assert.deepStrictEqual(Object.keys(result).sort(), ['dedupKey', 'failedGroups', 'successGroups'].sort())
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/updateChecker-notify-result.test.js`
Expected: FAIL because function returns undefined.

**Step 3: Write minimal implementation**

```js
// notify.js 内
return {
  successGroups,
  failedGroups,
  dedupKey: dedupId || null
}
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/updateChecker-notify-result.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/updateChecker-notify-result.test.js src/services/subscription/updateChecker/modules/notify.js
git commit -m "refactor: return structured notify result for subscription pushes"
```

---

### Task 3: 统一去重键解析（P0）

**Files:**
- Create: `src/services/subscription/updateChecker/helpers/dedupKey.js`
- Modify: `src/services/subscription/updateChecker/modules/notify.js`
- Test: `test/unit/subscription-dedup-key.test.js`

**Step 1: Write the failing test**

```js
assert.strictEqual(resolveDedupKey('video', { data: { bvid: 'BV1xx' } }), 'video:BV1xx')
assert.strictEqual(resolveDedupKey('article', { data: { id: 123 } }), 'article:cv123')
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-dedup-key.test.js`
Expected: FAIL module/function missing.

**Step 3: Write minimal implementation**

```js
function resolveDedupKey(type, payload) {
  // 统一从 envelope.data 取 canonical id
}
module.exports = { resolveDedupKey }
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-dedup-key.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-dedup-key.test.js src/services/subscription/updateChecker/helpers/dedupKey.js src/services/subscription/updateChecker/modules/notify.js
git commit -m "refactor: normalize dedup key extraction across subscription payloads"
```

---

### Task 4: 接入 unified video/article 状态推进策略（P0）

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/unifiedChecks.js`
- Test: `test/unit/updateChecker-unified-state-advance.test.js`

**Step 1: Write the failing test**

```js
// 用 mock notify 让发送全失败，断言 updateVideoState/updateArticleState 未被调用
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/updateChecker-unified-state-advance.test.js`
Expected: FAIL because state still advances.

**Step 3: Write minimal implementation**

```js
const decision = decideAdvance(notifyResult)
if (decision.action === 'advance' && persistState) {
  await this.updateVideoState(...)
}
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/updateChecker-unified-state-advance.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/updateChecker-unified-state-advance.test.js src/services/subscription/updateChecker/modules/unifiedChecks.js
git commit -m "fix: gate unified video/article anchor advancement by notify result"
```

---

### Task 5: 接入 manual/feed 状态推进策略（P0）

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/manualChecks.js`
- Modify: `src/services/subscription/updateChecker/modules/feed.js`
- Test: `test/unit/updateChecker-manual-feed-state-advance.test.js`

**Step 1: Write the failing test**

```js
// dynamic/live 发送失败时，lastDynamicId/lastLiveStatus 不应推进
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/updateChecker-manual-feed-state-advance.test.js`
Expected: FAIL with unexpected state update.

**Step 3: Write minimal implementation**

```js
// 推送后读取 NotifyResult，再决定是否调用 updateUserSub/updateCookieFollowerState
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/updateChecker-manual-feed-state-advance.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/updateChecker-manual-feed-state-advance.test.js src/services/subscription/updateChecker/modules/manualChecks.js src/services/subscription/updateChecker/modules/feed.js
git commit -m "fix: align manual and feed anchor advancement with unified policy"
```

---

### Task 6: 轮询参数校验对齐命令与 WebAPI（P0）

**Files:**
- Modify: `src/commands/settings.js`
- Test: `test/unit/settings-subscription-interval-validation.test.js`

**Step 1: Write the failing test**

```js
// /设置 轮询 0 和 /设置 轮询 -1 应返回错误提示且不触发 updateCheckInterval
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/settings-subscription-interval-validation.test.js`
Expected: FAIL because 0/-1 currently accepted.

**Step 3: Write minimal implementation**

```js
if (isNaN(value) || value <= 0) {
  // reply invalid
  return true
}
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/settings-subscription-interval-validation.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/settings-subscription-interval-validation.test.js src/commands/settings.js
git commit -m "fix: enforce positive subscription polling interval in command path"
```

---

### Task 7: 图文与视频扇出共用群可达性判定（P0-P1）

**Files:**
- Create: `src/services/subscription/updateChecker/helpers/groupReachability.js`
- Modify: `src/services/subscription/updateChecker/modules/notify.js`
- Modify: `src/services/videoDownloadService.js`
- Test: `test/unit/subscription-group-reachability.test.js`

**Step 1: Write the failing test**

```js
// 构造 isGroupEnabled=false 但 videoDownloadEnabled=true 的群，断言图文与视频目标群一致为不发送
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-group-reachability.test.js`
Expected: FAIL because video path still sends.

**Step 3: Write minimal implementation**

```js
// helper 统一判定：isInGroup && isGroupEnabled && channelSwitch
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-group-reachability.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-group-reachability.test.js src/services/subscription/updateChecker/helpers/groupReachability.js src/services/subscription/updateChecker/modules/notify.js src/services/videoDownloadService.js
git commit -m "refactor: unify group reachability for image and video fanout"
```

---

### Task 8: 活跃群集合改为“配置+订阅数据并集”（P1）

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/lifecycle.js`
- Test: `test/unit/updateChecker-active-groups-union.test.js`

**Step 1: Write the failing test**

```js
// 有订阅但 groupConfigs 不存在时，checkAll 仍应检查该群对应用户
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/updateChecker-active-groups-union.test.js`
Expected: FAIL because current activeGroups only from groupConfigs.

**Step 3: Write minimal implementation**

```js
// activeGroups = groupConfigs(在群) ∪ subscriptionManager 中出现的 groupIds(在群)
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/updateChecker-active-groups-union.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/updateChecker-active-groups-union.test.js src/services/subscription/updateChecker/modules/lifecycle.js
git commit -m "fix: build active group set from config and subscription union"
```

---

### Task 9: 空同步分组语义统一为“不过滤（全量）”（P1）

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/targeting.js`
- Modify: `src/commands/subscription.js`
- Modify: `src/commands/settings.js`
- Test: `test/unit/subscription-empty-sync-groups-semantics.test.js`

**Step 1: Write the failing test**

```js
// enableCookieSync=true && cookieSyncGroupNames=[] 时，应不过滤 follower
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-empty-sync-groups-semantics.test.js`
Expected: FAIL because command display currently treats as empty.

**Step 3: Write minimal implementation**

```js
// targeting 执行语义保持不过滤；命令提示和展示文本改为“全部分组”
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-empty-sync-groups-semantics.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-empty-sync-groups-semantics.test.js src/services/subscription/updateChecker/modules/targeting.js src/commands/subscription.js src/commands/settings.js
git commit -m "refactor: unify empty sync group semantics to match runtime behavior"
```

---

### Task 10: 数据 schemaVersion 与自动迁移（P1）

**Files:**
- Modify: `src/services/subscription/subscriptionManager.js`
- Test: `test/unit/subscription-schema-migration.test.js`

**Step 1: Write the failing test**

```js
// 输入旧结构 JSON，加载后应升级为 schemaVersion=2 且字段完整
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-schema-migration.test.js`
Expected: FAIL with missing schemaVersion/fields.

**Step 3: Write minimal implementation**

```js
// _loadSubscriptions/_loadFollowers 时执行 migrateIfNeeded
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-schema-migration.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-schema-migration.test.js src/services/subscription/subscriptionManager.js
git commit -m "feat: add subscription data schema versioning and auto migration"
```

---

### Task 11: follower 状态写盘节流与批量提交（P1-P2）

**Files:**
- Modify: `src/services/subscription/subscriptionManager.js`
- Test: `test/unit/subscription-follower-batch-save.test.js`

**Step 1: Write the failing test**

```js
// 一轮 100 次 updateCookieFollowerState，_saveFollowers 调用次数应明显小于 100
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-follower-batch-save.test.js`
Expected: FAIL because current code saves every update.

**Step 3: Write minimal implementation**

```js
// 引入 debounce/flush 机制；循环结束显式 flush
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-follower-batch-save.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-follower-batch-save.test.js src/services/subscription/subscriptionManager.js
git commit -m "perf: batch follower state persistence to reduce write amplification"
```

---

### Task 12: 元信息缓存并发键与回收策略（P1-P2）

**Files:**
- Modify: `src/services/subscriptionUserMetaCacheService.js`
- Test: `test/unit/subscription-meta-cache-context-key.test.js`

**Step 1: Write the failing test**

```js
// 同 uid 不同 groupId 并发时，不能共享同一 in-flight promise
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/subscription-meta-cache-context-key.test.js`
Expected: FAIL because key currently only uid.

**Step 3: Write minimal implementation**

```js
// inFlight key: `${uid}:${groupId || 'global'}`
// comparedInProcess 增加 TTL 清理
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/subscription-meta-cache-context-key.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/subscription-meta-cache-context-key.test.js src/services/subscriptionUserMetaCacheService.js
git commit -m "fix: isolate meta cache in-flight by context and add cleanup"
```

---

### Task 13: follow_service 同步路径降载（P2）

**Files:**
- Modify: `src/services/bili_server_core/services/follow_service.py`
- Test: `test/unit/follow-sync-performance-guard.test.js`

**Step 1: Write the failing test**

```js
// 通过 mock 断言分组成员拉取在缓存命中时不会全量重复请求
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/follow-sync-performance-guard.test.js`
Expected: FAIL with excessive call count.

**Step 3: Write minimal implementation**

```python
# follow_service.py
# 引入短 TTL 缓存 + 分页上限 + 轻量 sleep backoff
```

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/follow-sync-performance-guard.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add test/unit/follow-sync-performance-guard.test.js src/services/bili_server_core/services/follow_service.py
git commit -m "perf: reduce follow sync overhead with cache and pagination guards"
```

---

### Task 14: 阶段回归与灰度发布清单（P2）

**Files:**
- Create: `docs/plans/2026-03-06-subscription-refactor-rollout-checklist.md`
- Modify: `docs/plans/2026-03-06-subscription-backend-refactor-implementation-plan.md` (append verification log template)

**Step 1: Write rollout checklist draft**

```md
- 灰度群名单
- 关键指标阈值
- 回滚开关
```

**Step 2: Verify checklist completeness**

Run: `rg -n "灰度|阈值|回滚" docs/plans/2026-03-06-subscription-refactor-rollout-checklist.md`
Expected: 3 类条目均存在。

**Step 3: Add verification log template**

```md
| 阶段 | 用例 | 结果 | 证据命令 | 负责人 |
```

**Step 4: Final plan verification**

Run: `sed -n '1,260p' docs/plans/2026-03-06-subscription-backend-refactor-implementation-plan.md`
Expected: 任务、命令、验收标准完整。

**Step 5: Commit**

```bash
git add docs/plans/2026-03-06-subscription-refactor-rollout-checklist.md docs/plans/2026-03-06-subscription-backend-refactor-implementation-plan.md
git commit -m "docs: add subscription refactor rollout checklist"
```

---

## 4. 阶段验收矩阵（执行时必须逐项打勾）

- 阶段 1：状态推进/去重/参数校验一致性全部通过。
- 阶段 2：群边界一致、空分组语义一致、活跃群并集覆盖通过。
- 阶段 3：写盘次数下降、缓存不串上下文、同步链路耗时受控。

## 5. 统一验证命令（每阶段结束执行）

```bash
# 针对本次新增/修改测试逐条跑
npx mocha test/unit/subscription-state-advance-policy.test.js
npx mocha test/unit/updateChecker-notify-result.test.js
npx mocha test/unit/subscription-dedup-key.test.js
npx mocha test/unit/updateChecker-unified-state-advance.test.js
npx mocha test/unit/updateChecker-manual-feed-state-advance.test.js
npx mocha test/unit/settings-subscription-interval-validation.test.js
npx mocha test/unit/subscription-group-reachability.test.js
npx mocha test/unit/updateChecker-active-groups-union.test.js
npx mocha test/unit/subscription-empty-sync-groups-semantics.test.js
npx mocha test/unit/subscription-schema-migration.test.js
npx mocha test/unit/subscription-follower-batch-save.test.js
npx mocha test/unit/subscription-meta-cache-context-key.test.js
npx mocha test/unit/follow-sync-performance-guard.test.js
```

Expected: 所有测试通过；若失败，按任务回滚到最近一次通过提交后修复。

## 6. 阶段验证日志模板

> 每个阶段结束后请填写，作为灰度与回滚依据。

| 阶段 | 用例 | 结果 | 证据命令 | 负责人 |
| --- | --- | --- | --- | --- |
| 阶段1 | 状态推进/去重/参数校验 | 待执行 | `npx mocha --exit test/unit/updateChecker-*.test.js test/unit/subscription-*.test.js test/unit/settings-subscription-interval-validation.test.js` |  |
| 阶段2 | 群边界/空分组语义/活跃群并集 | 待执行 | `npx mocha --exit test/unit/subscription-group-reachability.test.js test/unit/subscription-empty-sync-groups-semantics.test.js test/unit/updateChecker-active-groups-union.test.js` |  |
| 阶段3 | 写盘节流/缓存上下文隔离/同步性能保护 | 待执行 | `npx mocha --exit test/unit/subscription-follower-batch-save.test.js test/unit/subscription-meta-cache-context-key.test.js && venv/bin/python -m unittest discover -s test/unit -p 'follow_sync_performance_guard_test.py'` |  |
