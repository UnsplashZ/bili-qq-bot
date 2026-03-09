# Live Feed/Fallback Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复直播 feed 误覆盖 manual fallback 的问题，确保只有被 feed 可靠处理完成的 manual live 订阅才会跳过 `checkUserLive()`

**Architecture:** 保留 `feed-first, fallback-second` 的直播模型，但将 live coverage 重定义为“manual 已可靠覆盖”的结果集。`processLiveFeed()` 显式返回 manual coverage 结果，`checkFeedUpdate()` 仅消费该结果，`lifecycle` 只依据该结果跳过 manual live fallback。

**Tech Stack:** Node.js, Mocha, 现有 `updateChecker` 模块拆分结构

---

### Task 1: 固化 live coverage 契约失败用例

**Files:**
- Modify: `test/unit/updateChecker-feedCoverageSplit.test.js`
- Modify: `test/unit/updateChecker-manual-feed-state-advance.test.js`

**Step 1: 写失败测试**

补至少两类失败用例：

- `processLiveFeed()` 命中 UID，但未真正完成 manual 处理时，不应提交 live coverage
- both 来源用户在线时，只有 manual 状态已等价处理后才允许覆盖 fallback

**Step 2: 运行测试验证失败**

Run:

```bash
npx mocha --exit test/unit/updateChecker-feedCoverageSplit.test.js test/unit/updateChecker-manual-feed-state-advance.test.js
```

Expected:

- 新增测试失败
- 失败原因应明确指向 live coverage 过宽或 manual fallback 被错误跳过

### Task 2: 重构 processLiveFeed 的结果语义

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/feed.js`

**Step 1: 引入明确的 live coverage 结果**

将 `coveredUids` 改为明确语义的 manual coverage 结果，例如：

- `manualCoveredUids`

要求：

- 只在 manual 已被可靠处理时写入
- 区分 online 推进、offline 复位、already online 三种可靠状态

**Step 2: 收紧在线场景覆盖条件**

在线场景中，只有以下情况允许覆盖 manual fallback：

- manual 已在线且本轮 feed 明确确认仍在线
- manual 本轮成功发送通知并完成 `0 -> 1` 推进

禁止把“仅看见 UID”“仅 cookie 侧已处理”“notify 未成功”的场景算作 coverage。

**Step 3: 收紧离线场景覆盖条件**

离线场景中，只有 manual 本轮成功完成 `1 -> 0` 复位时，才能覆盖 fallback。

`unknown` 状态一律不得覆盖。

### Task 3: 调整 checkFeedUpdate 的 coverage 提交逻辑

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/feed.js`
- Modify: `src/services/subscription/updateChecker/modules/lifecycle.js`

**Step 1: 让 checkFeedUpdate 只消费显式 manual coverage**

禁止根据 `collectFeedCoveredUids()` 或 feed 候选集合直接提交 live coverage。

动态维持当前逻辑，直播只提交来自 `processLiveFeed()` 的显式结果。

**Step 2: lifecycle 只基于 manual coverage 跳过 live fallback**

保持 `checkAll()` 的跳过入口不变，但确保其消费的是新的 manual coverage 结果集。

### Task 4: 增强日志

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/feed.js`

**Step 1: 增加 coverage reason 日志**

至少记录：

- manual coverage 已提交
- manual coverage 未提交
- reason

建议日志字段：

- `uid`
- `name`
- `reason`
- `state`

### Task 5: 跑最小相关回归

**Files:**
- Test: `test/unit/updateChecker-feedCoverageSplit.test.js`
- Test: `test/unit/updateChecker-manual-feed-state-advance.test.js`
- Test: `test/unit/updateChecker-live-cache-regression.test.js`
- Test: `test/unit/updateChecker-follower-flush-boundary.test.js`
- Test: `test/unit/updateChecker-unified-state-advance.test.js`
- Test: `test/unit/subscriptionLiveState.test.js`

**Step 1: 跑 targeted tests**

Run:

```bash
npx mocha --exit test/unit/updateChecker-feedCoverageSplit.test.js test/unit/updateChecker-manual-feed-state-advance.test.js test/unit/updateChecker-live-cache-regression.test.js test/unit/updateChecker-follower-flush-boundary.test.js test/unit/updateChecker-unified-state-advance.test.js test/unit/subscriptionLiveState.test.js
```

Expected:

- 全部通过
- 没有新的 live coverage 相关失败

### Task 6: 提交变更

**Files:**
- Modify: `src/services/subscription/updateChecker/modules/feed.js`
- Modify: `src/services/subscription/updateChecker/modules/lifecycle.js`
- Modify: `test/unit/updateChecker-feedCoverageSplit.test.js`
- Modify: `test/unit/updateChecker-manual-feed-state-advance.test.js`

**Step 1: 提交**

如果当前仍在 `main`：

```bash
git add src/services/subscription/updateChecker/modules/feed.js src/services/subscription/updateChecker/modules/lifecycle.js test/unit/updateChecker-feedCoverageSplit.test.js test/unit/updateChecker-manual-feed-state-advance.test.js
git commit -F - <<'EOF'
v3.20.8 收紧直播 feed 覆盖语义

- 仅在 feed 可靠处理 manual live 状态时才跳过 fallback
- 修复 live coverage 误覆盖导致的 manual live 漏推
- 补充 live coverage 契约回归测试
EOF
```

如果是修正最近提交，则改为 `git commit --amend`。

### Task 7: 线上验证清单

**Files:**
- Verify runtime only

**Step 1: 部署并重启容器**

**Step 2: 验证在线 UID**

针对 `51628309` 这类当前在线且 manual `lastLiveStatus=0` 的 UID，验证：

- 定时轮询日志是否出现 `POST /live_room`
- 是否真正进入开播通知
- `subscriptions.json` 中 `lastLiveStatus` 是否推进到 `1`

**Step 3: 验证下播 UID**

等待一个已推进到 `1` 的 UID 下播，验证：

- manual `lastLiveStatus` 是否从 `1 -> 0`
- 后续再次开播能否正常再次推送

Plan complete and saved to `docs/plans/2026-03-10-live-feed-fallback-contract-plan.md`. Two execution options:

1. Subagent-Driven (this session) - 我在当前会话按任务逐步实现并验证
2. Parallel Session (separate) - 新开会话按计划执行

Which approach?
