# Agent Runtime Control-Plane Fixes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 修复当前 agent runtime / bot-control 主链上的状态串单、真实入口可达性、记忆污染、权限边界和 dashboard 契约问题，使控制流在真实消息入口下稳定可用且边界清晰。

**Architecture:** 继续保留现有 `messageHandler -> aiHandler.runAgent -> botControl runtime` 主结构，不重写核心聊天链路；本轮重点是收紧 control-plane 入口条件、把 confirmation / candidate 状态改为 actor-aware、把 bot-control 消息从普通 chat memory 中分离出来，并为 action 显式声明权限等级。交互约束按已确认方案执行：初始 bot-control 动作必须 `@bot` 或 reply bot，follow-up 必须 reply bot。

**Tech Stack:** Node.js, Express, Mocha, existing OneBot/NapCat message meta, existing `runAgent()` / `botControl` runtime / `groupConfigFacade`

---

## Scope Decisions (Locked)

### 1. Confirmation 绑定
- confirmation 只绑定发起人 `actorUserId`
- 谁发起，谁确认 / 取消

### 2. Pending confirmation 并发规则
- 同一群 + 同一 actor 只允许一个 pending confirmation
- 新的需要确认动作到来时：拒绝创建，不覆盖，不排队

### 3. Bot-control 入口约束
- follow-up 必须 reply bot
- 初始 bot-control 动作必须 `@bot` 或 reply bot

### 4. Memory 规则
- 所有被识别为 bot-control 的消息都不写普通 AI 上下文 / 向量记忆

### 5. 权限模型
- `public_read`
- `admin_read`
- `admin_write`
- `root_private_only`

### 6. Candidate snapshot 规则
- 绑定 `actorUserId`
- follow-up 必须 reply 到对应候选列表消息
- TTL = 10 分钟

### 7. 测试力度
- 补完整入口回归集（入口可达性 + 状态隔离 + TTL + memory 污染 + 权限边界）

### 8. Dashboard DELETE 契约
- `DELETE /groups/:groupId/ai-config` 返回完整 snapshot，和 GET/PUT 对齐

---

## Phase A — 先修状态安全与真实入口可达性

### Task A1: Refactor confirmation storage to actor-scoped records

**Objective:** 将 pending confirmation 从 group-only 改成 group + actor 维度，消除串单和 silent overwrite。

**Files:**
- Modify: `src/services/ai/agentConfirmationService.js`
- Modify: `src/services/ai/botControl/index.js`
- Modify: `src/services/ai/botControlActionResolutionService.js`
- Test: `test/unit/agent-run-service.test.js`
- Test: `test/unit/ai-bot-control.test.js`

**Implementation notes:**
- 将 `pendingConfirmations` 从 `Map(groupId -> record)` 改为 `Map(groupId -> Map(actorUserId -> record))`
- confirmation record 至少包含：
  - `confirmationId`
  - `groupId`
  - `actorUserId`
  - `action`
  - `summary`
  - `snapshot`
  - `createdAt`
- runtime 创建 pending confirmation 时必须传入 `actorUserId`
- `getPendingConfirmation()` / `confirm()` / `reject()` 全部要求 `groupId + actorUserId`

**Behavior requirements:**
- 同群其他 actor 不能读取/消费别人的 pending confirmation
- 同 actor 已有 pending confirmation 时，再次创建应返回“请先处理当前待确认操作”类结果
- 不允许 silent overwrite

**Verification:**
- A 创建 pending confirmation，B follow-up `确认` 不应消费
- A 已有 pending confirmation，再发第二个需要确认的动作，旧的仍保留，新的被拒绝

---

### Task A2: Refactor candidate snapshot storage to actor + message + TTL

**Objective:** 将候选搜索状态改成 actor-aware，并要求 follow-up 精确 reply 到对应 bot 候选消息。

**Files:**
- Modify: `src/services/ai/candidateSelectionStateService.js`
- Modify: `src/services/ai/botControl/index.js`
- Modify: `src/services/ai/candidateSelectionFollowupRecognitionService.js`
- Modify: `src/services/ai/botControlActionResolutionService.js`
- Test: `test/unit/agent-run-service.test.js`
- Test: `test/unit/ai-bot-control.test.js`

**Implementation notes:**
- 将 snapshot 改为 `Map(groupId -> Map(actorUserId -> snapshot))`
- snapshot 至少包含：
  - `groupId`
  - `actorUserId`
  - `botMessageId`
  - `query`
  - `candidates`
  - `createdAt`
  - `expiresAt`
- TTL 固定 10 分钟
- 保存 snapshot 时必须记录 bot 发出的候选列表 messageId
- 识别 follow-up 时必须同时满足：
  - 当前用户 == `actorUserId`
  - 当前消息 reply bot
  - `replyToMessageId === botMessageId`
  - snapshot 未过期

**Behavior requirements:**
- B 不能消费 A 的候选 snapshot
- reply 到错误 bot 消息时不应解析为候选 follow-up
- 过期后应返回“候选已过期，请重新搜索”类结果

---

### Task A3: Tighten bot-control ingress rules at message entry

**Objective:** 让 bot-control 的真实消息入口按 `@bot / reply bot` 约束稳定可达，不再依赖自由文本被普通 AI gate 放行。

**Files:**
- Modify: `src/handlers/messageHandler.js`
- Modify: `src/services/ai/botControlActionResolutionService.js`
- Modify: `src/services/ai/naturalLanguageBotControlRecognitionService.js`
- Modify: `src/services/ai/pendingBotControlFollowupRecognitionService.js`
- Modify: `src/services/ai/candidateSelectionFollowupRecognitionService.js`
- Test: `test/unit/messageHandler-ai-pipeline.test.js`

**Implementation notes:**
- 在 message ingress 上明确控制入口约束：
  - follow-up：必须 reply bot
  - 初始 bot-control 动作：必须 `@bot` 或 reply bot
- 不再允许群里裸发 `关闭AI` / `订阅老番茄` / `确认` / `1` 直接命中 control plane
- 可以保留现有 gate，但 bot-control 候选消息的 admit 逻辑必须以 `@bot / reply bot` 为硬前提，而不是继续依赖普通聊天分数模型碰运气
- 保持现有 guard 顺序不变：
  - Root private restriction
  - legacy approval intercept
  - command
  - link
  - AI / agent runtime

**Behavior requirements:**
- `@bot 关闭AI` 可达
- reply bot 的 `确认` 可达
- reply bot 的 `1` / `第2个` 可达
- 裸 `确认` / 裸 `1` / 裸 `关闭AI` 不应触发 control plane

---

## Phase B — 解决 memory 污染与权限边界

### Task B1: Prevent bot-control messages from entering normal chat memory

**Objective:** 所有 bot-control 消息不进入普通 AI context / vector memory。

**Files:**
- Modify: `src/handlers/messageHandler.js`
- Test: `test/unit/messageHandler-ai-pipeline.test.js`
- Test: `test/unit/message-handler-logging.test.js`

**Implementation notes:**
- 在写 `aiContextService` / `vectorMemoryService` 之前，先判断当前消息是否已被识别为 bot-control：
  - pending confirmation follow-up
  - candidate selection follow-up
  - initial bot-control action
- 命中后：
  - 不写普通上下文
  - 不写向量记忆
- 普通聊天行为保持不变

**Behavior requirements:**
- `确认` / `取消` / `1` / `第2个` 不写普通记忆
- `@bot 关闭AI` / `@bot 订阅老番茄` 不写普通记忆
- 普通聊天仍照常写入

---

### Task B2: Introduce explicit permission classes per bot-control action

**Objective:** 将 structured bot-control 从统一管理员权限改为四级权限模型。

**Files:**
- Modify: `src/services/ai/agentRunService.js`
- Modify: `src/services/ai/agentDecisionService.js`
- Modify: `src/services/ai/botControl/registry.js`
- Modify: `src/services/ai/botControl/*.js` (各 controller/action metadata)
- Test: `test/unit/agent-run-service.test.js`
- Test: `test/unit/ai-bot-control.test.js`

**Implementation notes:**
- 为 action 显式声明 `permissionClass`：
  - `public_read`
  - `admin_read`
  - `admin_write`
  - `root_private_only`
- 不要继续在 structured action 执行时统一检查 `canManageCurrentGroup`
- 建议初始映射：
  - `approval.read` / `approval.write` -> `root_private_only`
  - `config.write` / `subscription.write` / `context.write` -> `admin_write`
  - `config.read` / `subscription.read(search_user)` / `subscription.read(list)` -> `admin_read`（若后续决定放宽再调整）
  - `runtime.read` -> 视业务决定 `admin_read` 或 `public_read`

**Behavior requirements:**
- 读操作不再被统一误杀为写权限
- 高风险审批仍只允许 Root 私聊

---

## Phase C — 补完整回归测试并统一 dashboard 契约

### Task C1: Add full messageHandler ingress regression coverage

**Objective:** 补齐真实入口级测试，覆盖可达性、隔离、TTL、memory 污染和权限边界。

**Files:**
- Modify: `test/unit/messageHandler-ai-pipeline.test.js`
- Modify: `test/unit/agent-run-service.test.js`
- Modify: `test/unit/ai-bot-control.test.js`
- Modify: `test/unit/bot-control-action-resolution-service.test.js`
- Modify: `test/unit/natural-language-bot-control-recognition.test.js`

**Required test groups:**

#### Ingress reachability
- reply bot 的 `确认` 可达 confirmation flow
- reply bot 的 `取消` 可达 reject flow
- reply bot 的 `1` / `第2个` 可达 candidate selection flow
- `@bot 关闭AI` / `@bot 查看AI配置` / reply bot 的初始 bot-control 动作可达
- 裸文本不触发

#### State isolation
- A 的 confirmation 不能被 B 确认
- 同 actor 已有 pending confirmation 时新请求被拒绝
- A 的 candidate snapshot 不能被 B 消费
- reply 错 bot 消息不能消费 snapshot
- snapshot 超过 10 分钟后失效

#### Memory pollution
- control-plane 消息不写普通 context / vector memory
- 普通聊天仍正常写入

#### Permission boundaries
- `public_read` / `admin_read` / `admin_write` / `root_private_only` 行为符合声明

---

### Task C2: Align DELETE /groups/:groupId/ai-config response contract with GET/PUT

**Objective:** 保证 dashboard 删除群 AI 配置后，前端可直接用响应更新状态，不保留旧值。

**Files:**
- Modify: `src/dashboard/routes/api/modules/group-ai.js`
- Modify: related dashboard tests if present

**Implementation notes:**
- `DELETE /groups/:groupId/ai-config` 成功后返回完整 snapshot
- 返回结构与 GET/PUT 对齐，至少包含：
  - `message`
  - `global`
  - `group`
  - `effective`
  - 或 facade 当前统一 snapshot 结构

**Behavior requirements:**
- DELETE 后前端不需要额外 GET 才能刷新出正确状态
- 返回契约与 GET/PUT 一致

---

## Verification Commands

### Targeted regression suite (minimum)
```bash
node test/unit/agent-run-service.test.js
node test/unit/ai-bot-control.test.js
node test/unit/bot-control-action-resolution-service.test.js
node test/unit/natural-language-bot-control-recognition.test.js
node test/unit/messageHandler-ai-pipeline.test.js
node test/unit/messageHandler-ai-idempotency.test.js
node test/unit/ai-pipeline-logging.test.js
node test/unit/message-handler-logging.test.js
node test/unit/requestApprovalService.test.js
node test/unit/ai-reply-runtime.test.js
```

### Full declared JS unit suite
```bash
npm test -- --exit
```

### Optional Python/B 站搜索 regression if touched
```bash
./node_modules/.bin/mocha --exit test/unit/bili-api-user-search.test.js
./venv/bin/python test/unit/user_service_search_test.py
```

---

## Execution Order

1. Task A1 — confirmation actor binding + no overwrite
2. Task A2 — candidate snapshot actor/message/TTL
3. Task A3 — ingress trigger tightening (`@bot` / reply bot)
4. Task B1 — bot-control messages skip normal memory
5. Task B2 — permission classes
6. Task C1 — full ingress regression coverage
7. Task C2 — dashboard DELETE response contract

---

## Definition of Done

- 同群不同用户之间不会再确认/选择彼此的状态
- 同 actor 新 confirmation 不会覆盖旧 confirmation
- follow-up 必须 reply bot，初始 bot-control 动作必须 `@bot` 或 reply bot
- control-plane 消息不进入普通 AI context / vector memory
- read/write/root-private 权限边界显式且测试覆盖
- messageHandler 真实入口级测试覆盖关键路径并通过
- dashboard DELETE `/groups/:groupId/ai-config` 返回完整 snapshot
- `npm test -- --exit` 通过
