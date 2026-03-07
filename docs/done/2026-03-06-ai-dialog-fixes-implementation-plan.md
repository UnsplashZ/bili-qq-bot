# AI 对话功能修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 一次性修复 AI 对话链路中的高风险问题（路径安全、工具超时熔断、向量写入并发、入口校验一致性、幂等与缓存边界），且不改变既有业务语义。

**Architecture:** 保持现有消息主链不变（`bot -> messageHandler -> aiHandler -> services`），通过新增共享模块下沉通用能力（校验、幂等、工具保护），再在入口层做薄接入。先测试失败再最小实现，按模块逐步落地并持续回归。

**Tech Stack:** Node.js, Mocha, Express, Axios, WebSocket, 本地文件存储（JSON）

---

### Task 1: 上下文 ID 安全校验（路径穿越防护）

**Files:**
- Create: `test/unit/aiContextService-path-safety.test.js`
- Modify: `src/services/aiContextService.js`
- Modify: `src/commands/ai.js`

**Step 1: Write the failing test**

```js
it('rejects invalid context id and never writes outside contexts dir', async () => {
  // invalid ids: ../x, a/b, empty, private_x
  // expect throw or graceful reject
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/aiContextService-path-safety.test.js --timeout 10000`
Expected: FAIL（当前未统一校验）

**Step 3: Write minimal implementation**

```js
// aiContextService.js
_validateContextId(id) {
  const v = String(id || '').trim();
  if (/^\d+$/.test(v) || /^private_\d+$/.test(v)) return v;
  throw new Error(`invalid context id: ${id}`);
}
```

在所有路径拼接入口（`getContext/saveContext/unloadContext/resetContext`）调用校验，并使用 `path.resolve` + 前缀校验。

在 `commands/ai.js` 的 `/AI 新对话` 对 `targetGid` 做同样校验并返回用户可读错误。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/aiContextService-path-safety.test.js --timeout 10000`
Expected: PASS

**Step 5: Commit**

```bash
git add test/unit/aiContextService-path-safety.test.js src/services/aiContextService.js src/commands/ai.js
git commit -m "fix: 收敛AI上下文ID校验并阻断路径穿越" -m "- 为context id增加白名单校验" -m "- 在存储层增加resolve前缀校验" -m "- /AI 新对话入口前置校验"
```

### Task 2: MCP 工具执行超时与熔断保护

**Files:**
- Create: `src/services/ai/toolExecutionGuard.js`
- Create: `test/unit/toolExecutionGuard.test.js`
- Modify: `src/handlers/aiHandler.js`

**Step 1: Write the failing test**

```js
it('times out slow tool call and returns guarded tool error', async () => {
  // mock executeTool never resolves
  // expect timeout error payload and loop continues
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/toolExecutionGuard.test.js --timeout 10000`
Expected: FAIL

**Step 3: Write minimal implementation**

```js
// toolExecutionGuard.js
async runWithTimeout(fn, ms) {
  return Promise.race([fn(), timeoutPromise(ms)]);
}
```

- 增加按 `toolName` 的失败计数与短窗口熔断状态。
- 在 `aiHandler` 工具循环中接入 guard：超时/熔断返回结构化 tool result，不中断整轮。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/toolExecutionGuard.test.js --timeout 10000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/ai/toolExecutionGuard.js test/unit/toolExecutionGuard.test.js src/handlers/aiHandler.js
git commit -m "fix: 为AI工具调用增加超时与轻量熔断" -m "- 增加工具执行保护模块" -m "- 超时与连续失败降级" -m "- 保证单工具失败不阻断整轮"
```

### Task 3: 向量写入并发治理与退避

**Files:**
- Create: `test/unit/vectorMemory-write-queue.test.js`
- Modify: `src/services/vectorMemoryService.js`

**Step 1: Write the failing test**

```js
it('limits concurrent embedding calls and drops low-priority jobs when queue is full', async () => {
  // simulate burst addMemory
  // assert concurrency cap and queue overflow behavior
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/vectorMemory-write-queue.test.js --timeout 15000`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在 `VectorMemoryService` 增加：
  - `maxEmbeddingConcurrency`
  - `maxEmbeddingQueueSize`
  - `enqueueAddMemory()` / worker drain
- 对 embedding 429/5xx 增加小次数指数退避。
- 队列满时优先丢弃低价值任务并记录 `debug` 日志。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/vectorMemory-write-queue.test.js --timeout 15000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/vectorMemoryService.js test/unit/vectorMemory-write-queue.test.js
git commit -m "fix: 收敛向量写入并发并增加退避策略" -m "- 为embedding写入增加有界队列" -m "- 控制并发并处理队列溢出" -m "- 对限流和服务错误执行重试"
```

### Task 4: 向量查询缓存键修复（limit 维度）

**Files:**
- Modify: `src/services/vectorMemoryService.js`
- Create: `test/unit/vectorMemory-cache-key-limit.test.js`

**Step 1: Write the failing test**

```js
it('uses limit in cache key to avoid cross-limit cache collision', async () => {
  // same query with limit=1 and limit=5 should not share cache entry
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/vectorMemory-cache-key-limit.test.js --timeout 10000`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在 `search()` 的 `cacheKey` 中加入 `limit`。
- 返回结果前兜底 `slice(0, limit)`。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/vectorMemory-cache-key-limit.test.js --timeout 10000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/vectorMemoryService.js test/unit/vectorMemory-cache-key-limit.test.js
git commit -m "fix: 修复向量查询缓存key缺少limit维度" -m "- 规避不同limit缓存碰撞" -m "- 增加返回条数兜底"
```

### Task 5: AI 配置统一校验模块

**Files:**
- Create: `src/services/ai/validation.js`
- Create: `test/unit/ai-config-validation.test.js`

**Step 1: Write the failing test**

```js
it('normalizes and validates ai config updates consistently across scopes', () => {
  // global/group scope
  // valid -> normalized, invalid -> throws with field info
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/ai-config-validation.test.js --timeout 10000`
Expected: FAIL

**Step 3: Write minimal implementation**

- 统一导出：`validateAndNormalizeAiConfig(updates, scope)`。
- 提供字段白名单、类型转换、范围校验、null-reset 语义。
- 对未知字段明确拒绝（防 mass assignment）。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/ai-config-validation.test.js --timeout 10000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/ai/validation.js test/unit/ai-config-validation.test.js
git commit -m "refactor: 提取AI配置统一校验模块" -m "- 白名单与范围校验统一" -m "- 统一类型归一化和reset语义"
```

### Task 6: 接入命令与 API 入口的一致校验

**Files:**
- Modify: `src/commands/ai.js`
- Modify: `src/commands/settings.js`
- Modify: `src/dashboard/routes/api/modules/ai.js`
- Modify: `src/dashboard/routes/api/modules/groups.js`
- Create: `test/unit/ai-config-entry-consistency.test.js`

**Step 1: Write the failing test**

```js
it('rejects invalid aiContextLimit consistently in command/api handlers', async () => {
  // same invalid value should be rejected everywhere
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/ai-config-entry-consistency.test.js --timeout 15000`
Expected: FAIL

**Step 3: Write minimal implementation**

- 各入口改为调用共享 `validation.js`。
- 删除重复散落校验逻辑，仅保留入口层错误映射与响应格式。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/ai-config-entry-consistency.test.js --timeout 15000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/ai.js src/commands/settings.js src/dashboard/routes/api/modules/ai.js src/dashboard/routes/api/modules/groups.js test/unit/ai-config-entry-consistency.test.js
git commit -m "refactor: 统一AI配置在命令与API入口的校验规则" -m "- 各入口复用共享验证模块" -m "- 消除规则漂移"
```

### Task 7: 消息幂等与消息结构归一化

**Files:**
- Create: `src/services/ai/idempotency.js`
- Modify: `src/handlers/messageHandler.js`
- Create: `test/unit/messageHandler-ai-idempotency.test.js`

**Step 1: Write the failing test**

```js
it('does not reply twice for duplicated message_id event', async () => {
  // send same event twice
  // expect only one aiHandler.getReply invocation
})
```

**Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/messageHandler-ai-idempotency.test.js --timeout 10000`
Expected: FAIL

**Step 3: Write minimal implementation**

- 引入短 TTL 幂等缓存（如 120s）。
- AI 路径前先判重；命中则直接返回。
- `message` 字段统一归一化 `const segments = Array.isArray(message) ? message : []`。

**Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/messageHandler-ai-idempotency.test.js --timeout 10000`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/ai/idempotency.js src/handlers/messageHandler.js test/unit/messageHandler-ai-idempotency.test.js
git commit -m "fix: 增加AI消息幂等保护并归一化消息结构" -m "- 防重复事件导致重复回复" -m "- 避免非数组message触发异常"
```

### Task 8: 可观测性补齐与回归验证

**Files:**
- Modify: `src/handlers/aiHandler.js`
- Modify: `src/handlers/messageHandler.js`
- Modify: `src/services/vectorMemoryService.js`
- Modify: `src/services/ai/toolExecutionGuard.js`

**Step 1: Add structured log fields**

- 在关键日志补齐：`traceId/groupId/userId/messageId/intentType/toolName`。

**Step 2: Add counters in logs**

- 输出工具超时、熔断触发、队列丢弃计数日志。

**Step 3: Run targeted unit tests**

Run:

```bash
npx mocha test/unit/aiContextService-path-safety.test.js test/unit/toolExecutionGuard.test.js test/unit/vectorMemory-write-queue.test.js test/unit/vectorMemory-cache-key-limit.test.js test/unit/ai-config-validation.test.js test/unit/ai-config-entry-consistency.test.js test/unit/messageHandler-ai-idempotency.test.js --timeout 20000
```

Expected: PASS

**Step 4: Run existing AI-related regression tests**

Run:

```bash
npx mocha test/unit/aiHandler-multiTurn.test.js test/unit/vectorMemory-userIdentity.test.js test/unit/vectorMemory-userSearch.test.js test/unit/aiGroupSwitchInheritance.test.js --timeout 20000
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/aiHandler.js src/handlers/messageHandler.js src/services/vectorMemoryService.js src/services/ai/toolExecutionGuard.js
git commit -m "chore: 补齐AI链路关键观测字段并完成回归验证" -m "- 增加trace与关键计数日志" -m "- 完成AI相关回归测试"
```

## 执行注意事项

- 遵循 DRY/YAGNI/TDD：每个任务先写失败测试，再最小实现。
- 单任务内保持 2-5 分钟粒度，不跨任务叠加大改动。
- 先完成高风险任务（Task 1-3），再做一致性与回归（Task 4-8）。
- 若现有测试对日志文本强依赖，优先保持原日志主干，仅新增结构化字段。
- 推荐在独立 worktree 执行（若未创建，先补建）。

## 推荐技能顺序

1. `@superpowers:executing-plans`
2. `@superpowers:test-driven-development`
3. `@superpowers:verification-before-completion`
