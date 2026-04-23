# Tool-First Agent Runtime Refactor Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在不影响现有 Bilibili 链接解析、预览卡片、下载、订阅轮询与 Dashboard 核心能力的前提下，完整重构 AI 功能，把当前 `bot-control / MCP / AI chat` 收敛成一个 tool-first、stateful 的 agent runtime。

**Architecture:** 保留 `messageHandler` 的生产 guard 顺序与 Bilibili/link fast-path；把 AI 相关决策统一收口到 `runAgent(agentInput, runtime)`；把本地 bot-control 能力与 MCP 能力接入同一个工具注册表；把 confirmation / candidate selection / clarification 统一升级为 workflow state，而不是继续堆文本特判。第一阶段不改 Bilibili 处理链，只改 AI 控制平面；第二阶段再逐步淘汰 legacy AI 编排。

**Tech Stack:** Node.js 18+, NapCat / OneBot WebSocket, OpenAI-compatible chat API, existing MCP bridge, Mocha unit tests, Express dashboard, existing `src/services/link/*` and `src/services/bili_server_core/*` stack.

---

## 1. Locked scope and non-goals

### 1.1 本轮必须保持不变的功能边界

以下能力不在本轮重构范围内，除非为了兼容性补 very small adapter，否则不得主动改语义：

- `src/handlers/linkHandler.js`
- `src/services/link/*`
- `src/services/bili_server_core/*`
- `src/services/videoDownloadService.js`
- `src/services/subscription/updateChecker/*`
- 现有 Bilibili 链接提取、短链展开、结构化解析、卡片渲染、截图发送、视频下载与订阅轮询行为

### 1.2 必须保留的入口 guard 顺序

`src/handlers/messageHandler.js` 中现有顺序保持：

1. self-message ignore
2. private Root restriction
3. Root private approval intercept
4. idempotency / blacklist / group enable checks
5. command dispatch first
6. link handling first
7. AI / agent last

不能为了“更 agent”而让 AI 抢在命令、链接解析、审批前面。

### 1.3 本轮不做的事

- 不重写 Bilibili Python service
- 不重写 link parser / renderer
- 不改变订阅轮询调度语义
- 不让模型直接调用内部 service 对象
- 不把 mutation 权限交给模型判断
- 不在第一阶段追求“全自然语言零约束”

### 1.4 允许整体重构的范围

可以完整重构以下 AI 相关层：

- `src/handlers/aiHandler.js`
- `src/services/ai/*`
- `src/services/mcpManager.js` 的 AI 集成方式
- AI config 的统一 facade
- AI memory / workflow / tool orchestration

---

## 2. Current repo-grounded diagnosis

### 2.1 现状不是没有 agent，而是 agent 不是唯一决策面

当前至少有四套逻辑并存：

- `replyGateService.js` 决定 shouldReply
- `responseModeService.js` 决定 chat / answer_only / action_ready / confirm_needed
- `naturalLanguageBotControlRecognitionService.js` 做动作短语特判
- `agentRunService.js` 包了一层 agent 术语，但最终仍会回落到 legacy `generateLegacyReply()` / `llmChatService.runChatLoop()`

结果：
- 回复判断不是单点真相
- 工具开放受 `responseMode` 影响
- bot-control 仍是“文本识别 + 本地执行 helper”，不是 tool-first runtime

### 2.2 当前最脆的地方

1. `replyOrchestratorService.js` 里 tools 会被 `responseMode` 条件性 withheld
2. `candidateSelectionFollowupRecognitionService.js` 强依赖 reply-to-bot + exact message id
3. `naturalLanguageBotControlRecognitionService.js` 承担了过多主路由职责
4. `agentRunService.js` 仍不是 agent-native executor
5. local bot-control 和 MCP tools 没有统一 registry surface

### 2.3 直接后果

- “订阅老番茄 -> 返回候选 -> 用户发 1” 经常掉回普通聊天
- 工具是否可用不是由权限 / policy 决定，而被前置 mode 控制
- follow-up 状态机和普通 chat memory 容易串扰
- 系统看起来像 agent，实质仍是半 chat half 特判

---

## 3. Target architecture

目标形态如下：

```text
messageHandler
  -> hard admission only
  -> buildAgentInput
  -> aiHandler.runAgent(agentInput)
       -> agentRuntime.buildContext()
       -> agentRuntime.decide()
       -> agentRuntime.executeToolCalls()
       -> agentRuntime.advanceWorkflow()
       -> agentRuntime.finalizeReply()
```

内部统一为：

```text
src/services/ai/
  agent/
    runtime.js
    decisionService.js
    contextBuilder.js
    executor.js
    finalizer.js
    policy.js
  tools/
    registry.js
    localToolAdapter.js
    mcpToolAdapter.js
    toolPolicy.js
  workflow/
    workflowStateService.js
    confirmationWorkflow.js
    selectionWorkflow.js
    clarificationWorkflow.js
  facades/
    aiConfigFacade.js
    runtimeStatusFacade.js
    memoryFacade.js
  botControl/
    ...existing controllers, migrated behind tool adapters
```

核心规则：

1. Agent 决定 ignore / answer / clarify / call tool / await confirmation
2. 系统决定该 tool 能不能执行
3. workflow state 推动 follow-up，不再由 follow-up 文本主导业务逻辑
4. link / command / approval fast-path 继续优先于 AI

---

## 4. Invariants to protect Bilibili functionality

### 4.1 Hard isolation rule

所有 AI 重构任务必须满足：

- 不改 `linkHandler.js` 的调用时机
- 不改 `linkService.parse/handle` 入口协议
- 不改 `bili_server_core` 对外返回结构
- 不改视频下载触发条件
- 不改订阅轮询主循环与数据存储结构，除非仅新增只读 facade

### 4.2 Integration contract to preserve

`messageHandler` 在 link fast-path 命中时：

- 不进入 `runAgent()`
- 不写 AI workflow state
- 不因 AI refactor 改变 reaction / preview / send 行为

### 4.3 Safety rollout rule

整个重构期间必须保留 feature flag：

- `AI_AGENT_RUNTIME_V2=false` 时，完全回退当前 legacy AI path
- link / command / approval path 不受此 flag 影响

建议配置来源：
- `config/.env`
- `src/config/aiConfig.js`

---

## 5. File map: reuse vs replace

### 5.1 Reuse as primitives, do not delete in Phase 1

继续复用，但降级为 primitive / adapter：

- `src/services/ai/llmChatService.js`
- `src/services/ai/toolExecutionGuard.js`
- `src/services/ai/retrievalAugmentService.js`
- `src/services/ai/promptAssemblerService.js`
- `src/services/ai/botFactsService.js`
- `src/services/ai/contextSelectorService.js`
- `src/services/ai/replyPersistenceService.js`
- `src/services/ai/botControl/*`
- `src/services/mcpManager.js`

### 5.2 Transitional components to demote

以下文件先保留兼容，但不再作为长期主决策器：

- `src/services/ai/replyGateService.js`
- `src/services/ai/responseModeService.js`
- `src/services/ai/naturalLanguageBotControlRecognitionService.js`
- `src/services/ai/replyOrchestratorService.js`

### 5.3 New modules to create

Create:

- `src/services/ai/agent/runtime.js`
- `src/services/ai/agent/contextBuilder.js`
- `src/services/ai/agent/decisionService.js`
- `src/services/ai/agent/executor.js`
- `src/services/ai/agent/finalizer.js`
- `src/services/ai/agent/policy.js`
- `src/services/ai/tools/registry.js`
- `src/services/ai/tools/localToolAdapter.js`
- `src/services/ai/tools/mcpToolAdapter.js`
- `src/services/ai/tools/toolPolicy.js`
- `src/services/ai/workflow/workflowStateService.js`
- `src/services/ai/workflow/workflowTypes.js`
- `src/services/ai/facades/aiConfigFacade.js`
- `src/services/ai/facades/runtimeStatusFacade.js`
- `src/services/ai/facades/memoryFacade.js`

---

## 6. Tool model

### 6.1 Unified tool definition

每个 tool 统一描述：

```js
{
  name: 'subscription.add_user',
  description: 'Add a Bilibili user subscription to the current group',
  source: 'local' | 'mcp',
  inputSchema: {...},
  riskClass: 'public_read' | 'admin_read' | 'admin_write' | 'root_private_only',
  scopePolicy: 'current_group' | 'root_private',
  confirmPolicy: 'never' | 'group_mutation' | 'root_sensitive',
  idempotent: true,
  handler: async (input, context) => result
}
```

### 6.2 First-class local tools to expose

第一批本地工具不要再让模型拼 `operation=...`，直接给明确名：

- `subscription.search_user`
- `subscription.list_current_group`
- `subscription.add_user`
- `subscription.remove_user`
- `context.reset_current_group`
- `config.get_ai_status`
- `config.set_ai_enabled`
- `config.set_rag_enabled`
- `runtime.get_status`
- `approval.list_pending`
- `approval.approve_exact`
- `approval.reject_exact`

兼容层可继续复用 `botControl/registry.js` 和各 controller，但仅作为 adapter 背后的执行入口。

### 6.3 MCP integration rule

`mcpManager` 不再直接向 legacy chat loop 暴露 tools；改为：

- `mcpToolAdapter.js` 从 `mcpManager` 拉取可用工具
- 过滤高风险 / 不适合群聊的工具
- 统一注册进 tool registry

Agent 只看到统一 registry，不关心来源。

---

## 7. Workflow model

### 7.1 Unified workflow state

统一 workflow record：

```js
{
  workflowId,
  kind: 'confirmation' | 'selection' | 'clarification',
  actorUserId,
  groupId,
  originMessageId,
  botMessageId,
  status: 'pending' | 'executing' | 'done' | 'cancelled' | 'expired',
  payload,
  createdAt,
  expiresAt
}
```

### 7.2 Replace split state services gradually

当前：
- `agentConfirmationService.js`
- `candidateSelectionStateService.js`

目标：
- 两者都迁入 `workflowStateService.js`
- 旧 service 暂时变 compatibility wrapper

### 7.3 Follow-up resolution rule

follow-up 处理顺序：

1. explicit structured action
2. pending confirmation workflow
3. pending selection workflow
4. pending clarification workflow
5. deterministic shortcut parser
6. ordinary agent decision

规则：
- 当同 actor + 同 group 下存在唯一 pending selection 时，允许弱匹配消费 `1 / 第1个 / uid`
- 存在歧义时，要求严格 reply-to-bot 绑定
- 绝不重新解释旧自然语言原句去推断 mutation

---

## 8. Decision model

### 8.1 Agent becomes the single high-level decision point

`decisionService` 输出结构化结果：

```js
{
  decision: 'ignore' | 'respond' | 'tool_call' | 'await_user',
  intent: {
    type: 'chat' | 'query' | 'mutation' | 'workflow' | 'clarification',
    summary,
    confidence
  },
  replyPolicy: {
    visible,
    style: 'short' | 'normal',
    needsConfirmation
  },
  executionPlan: {
    toolCalls: [],
    finalText: null
  }
}
```

### 8.2 What gets demoted

- `replyGateService.js` -> spam / busy / rate hints only
- `responseModeService.js` -> style hints only
- `naturalLanguageBotControlRecognitionService.js` -> deterministic shortcut parser only

不能再继续：
- 用 `responseMode` 决定 tools 是否可见
- 用 gate score 直接决定 shouldReply 的最终真值

---

## 9. Detailed implementation phases

## Phase 0 — Safety fences and compatibility shell

### Task 0.1: Add feature flag and runtime switch

**Objective:** 引入 agent runtime v2 开关，保证可以无损回退到当前 AI 逻辑。

**Files:**
- Modify: `src/config/aiConfig.js`
- Modify: `src/handlers/aiHandler.js`
- Test: `test/unit/ai-handler.test.js` or create if missing

**Requirements:**
- `AI_AGENT_RUNTIME_V2=false` 时保留现有 `generateLegacyReply()` / `runAgent()` 兼容行为
- `AI_AGENT_RUNTIME_V2=true` 时进入新 runtime
- link / command / approval path 不依赖该开关

### Task 0.2: Freeze Bilibili/link contracts in tests

**Objective:** 在动 AI 之前，先把 link fast-path 和 command priority 固化成回归测试。

**Files:**
- Modify: `test/unit/messageHandler-ai-pipeline.test.js`
- Modify: `test/unit/messageHandler-link-priority.test.js` if exists, otherwise create

**Verification:**
- 链接消息仍优先走 `linkHandler`
- 命令仍优先于 AI
- Root private approval intercept 仍优先于 AI

## Phase 1 — Unified tool registry, no behavior expansion

### Task 1.1: Create unified tool registry

**Objective:** 新建 AI 侧统一工具注册表，不改用户行为，只统一内部能力面。

**Files:**
- Create: `src/services/ai/tools/registry.js`
- Create: `src/services/ai/tools/toolPolicy.js`
- Test: `test/unit/ai-tool-registry.test.js`

**Requirements:**
- 支持 local / mcp tool source
- 支持 riskClass / scopePolicy / confirmPolicy
- 支持 listToolsForContext(context)

### Task 1.2: Wrap local bot-control actions as explicit tools

**Objective:** 把现有 `botControl/*` 包装成模型可见的明确工具名。

**Files:**
- Create: `src/services/ai/tools/localToolAdapter.js`
- Modify: `src/services/ai/botControl/index.js`
- Modify: `src/services/ai/botControl/registry.js`
- Test: `test/unit/ai-local-tool-adapter.test.js`

**First batch:**
- `subscription.search_user`
- `subscription.list_current_group`
- `subscription.add_user`
- `subscription.remove_user`
- `context.reset_current_group`
- `config.get_ai_status`
- `config.set_ai_enabled`
- `config.set_rag_enabled`
- `runtime.get_status`

### Task 1.3: Wrap MCP tools through adapter

**Objective:** MCP tools 通过统一 adapter 注册，不再直接绑定 legacy reply loop。

**Files:**
- Create: `src/services/ai/tools/mcpToolAdapter.js`
- Modify: `src/services/mcpManager.js`
- Test: `test/unit/ai-mcp-tool-adapter.test.js`

**Requirements:**
- tool schema normalize
- source 标记为 `mcp`
- 过滤不可用 / 非文本返回 / 高风险工具

## Phase 2 — Unified workflow state

### Task 2.1: Create workflow state service

**Objective:** 把 confirmation / selection 状态统一进 workflow service。

**Files:**
- Create: `src/services/ai/workflow/workflowStateService.js`
- Create: `src/services/ai/workflow/workflowTypes.js`
- Test: `test/unit/ai-workflow-state-service.test.js`

**Requirements:**
- actorUserId + groupId 绑定
- TTL 管理
- workflow kind 区分 confirmation / selection / clarification
- 支持 exact lookup 和 unique pending lookup

### Task 2.2: Migrate confirmation service to workflow wrapper

**Objective:** `agentConfirmationService.js` 变成 workflow wrapper，避免双状态源。

**Files:**
- Modify: `src/services/ai/agentConfirmationService.js`
- Modify: `src/services/ai/botControl/index.js`
- Test: `test/unit/agent-run-service.test.js`

### Task 2.3: Migrate candidate selection state to workflow wrapper

**Objective:** `candidateSelectionStateService.js` 变成 workflow wrapper。

**Files:**
- Modify: `src/services/ai/candidateSelectionStateService.js`
- Modify: `src/services/ai/candidateSelectionFollowupRecognitionService.js`
- Modify: `src/services/ai/botControlActionResolutionService.js`
- Test: `test/unit/bot-control-action-resolution-service.test.js`

**Requirements:**
- 唯一 pending selection 时允许弱匹配数字 follow-up
- 歧义时强制 reply binding
- 过期后 deterministic expired reply

## Phase 3 — Agent-native context and decision

### Task 3.1: Build agent runtime context object

**Objective:** 统一 `messageMeta / pipelineInput / selectedContext / permissionFacts / workflows / tools` 为一个 context object。

**Files:**
- Create: `src/services/ai/agent/contextBuilder.js`
- Modify: `src/handlers/aiHandler.js`
- Test: `test/unit/agent-context-builder.test.js`

**Context must include:**
- current message
- actor / scope / permissions
- recent history
- workflow snapshots
- visible tools
- memory summary
- replyGate spam/busy hints

### Task 3.2: Build single decision service

**Objective:** 让 agent 决定 ignore/respond/tool/await，不再由 gate/mode 分流主导。

**Files:**
- Create: `src/services/ai/agent/decisionService.js`
- Modify: `src/services/ai/agentDecisionService.js` or replace with compatibility export
- Test: `test/unit/agent-decision-service.test.js`

**Requirements:**
- `replyGateService` 只能提供 signal，不再做终裁
- `responseModeService` 不再控制 tool visibility
- 明确输出 structured decision

## Phase 4 — Agent-native execution

### Task 4.1: Create executor for unified tool calls

**Objective:** 所有工具调用走统一 executor，执行前强制做 policy 校验。

**Files:**
- Create: `src/services/ai/agent/executor.js`
- Modify: `src/services/ai/toolExecutionGuard.js`
- Test: `test/unit/agent-executor.test.js`

**Execution checks:**
- permission
- scope pinning
- confirm policy
- idempotency / noop handling
- timeout / circuit breaker

### Task 4.2: Stop mode-based tool withholding

**Objective:** 去掉 `replyOrchestratorService` 基于 `responseMode` withholding tools 的行为。

**Files:**
- Modify: `src/services/ai/replyOrchestratorService.js`
- Modify: `src/services/ai/llmChatService.js`
- Test: `test/unit/ai-reply-runtime.test.js`

**Rule:**
- tools 由 toolPolicy 过滤
- 不再由 `action_ready` 控制

## Phase 5 — Finalizer and legacy bridge removal

### Task 5.1: Add finalizer and user-visible reply rendering

**Objective:** 将最终回复、workflow 提示、tool result summary 统一由 finalizer 输出。

**Files:**
- Create: `src/services/ai/agent/finalizer.js`
- Modify: `src/services/ai/localBotControlExecutionHelper.js`
- Test: `test/unit/agent-finalizer.test.js`

### Task 5.2: Demote legacy reply pipeline to fallback only

**Objective:** `generateLegacyReply()` 只作为 fallback，不再是 agent 主路径。

**Files:**
- Modify: `src/services/ai/agentRunService.js`
- Modify: `src/handlers/aiHandler.js`
- Modify: `src/services/ai/replyRuntimeService.js`
- Test: `test/unit/agent-run-service.test.js`

**Requirements:**
- 新 runtime 优先
- legacy 仅在 feature flag off 或 runtime hard failure 时兜底

## Phase 6 — Config facade and cleanup

### Task 6.1: Unify AI config writes

**Objective:** 在开放更多 config tools 前，先统一配置写入口。

**Files:**
- Create: `src/services/ai/facades/aiConfigFacade.js`
- Modify: `src/commands/ai.js`
- Modify: `src/dashboard/routes/api/modules/group-ai.js`
- Modify: `src/dashboard/routes/api/modules/groups.js`
- Modify: `src/services/ai/botControl/configController.js`
- Test: related dashboard / command tests

### Task 6.2: Clean dead transitional code

**Objective:** 在全部回归通过后，删除不再承担主路由职责的 transitional 代码。

**Files:**
- Modify or remove: `src/services/ai/responseModeService.js`
- Modify or remove: `src/services/ai/naturalLanguageBotControlRecognitionService.js`
- Modify or reduce: `src/services/ai/replyGateService.js`

前提：必须先确认新 runtime 已覆盖原路径所需能力。

---

## 10. Testing matrix

### 10.1 Bilibili safety regression

必须新增或保留这些回归：

- command priority over AI
- link priority over AI
- Bilibili link parse/render path unchanged
- video download trigger unchanged
- subscription updateChecker unaffected by AI flag

### 10.2 AI control-plane regression

- exact UID subscribe/unsubscribe
- fuzzy subscription search -> candidate list -> follow-up selection
- pending confirmation actor isolation
- selection workflow actor isolation
- short follow-up reachability
- control messages excluded from ordinary memory
- `mutated=false` reply must not claim success

### 10.3 Permission regression

- `public_read`
- `admin_read`
- `admin_write`
- `root_private_only`

### 10.4 Runtime regression

- MCP tool failure isolation
- tool timeout handling
- workflow expiry
- feature flag fallback to legacy path

---

## 11. Rollout sequence

### Stage A

仅落地文档、feature flag、测试护栏。

### Stage B

上 unified tool registry 和 workflow state，但默认仍走 legacy AI reply。

### Stage C

小流量开启 `AI_AGENT_RUNTIME_V2=true`，仅对 Root private 或测试群开启。

### Stage D

验证以下通过后再扩到普通群：
- command/link priority 无回归
- Bilibili 预览无回归
- 订阅搜索/确认闭环稳定
- MCP tool 不影响普通聊天稳定性

### Stage E

旧 AI pipeline 降级为 fallback only。

---

## 12. Definition of done

以下条件同时满足，才算本计划完成：

1. AI 侧存在统一 tool registry，local + MCP 工具同源暴露
2. confirmation / selection / clarification 统一由 workflow state 管理
3. `runAgent()` 成为唯一高层决策面
4. `replyGateService` / `responseModeService` 不再决定 tool visibility 或最终 reply truth
5. legacy reply pipeline 只作为 fallback
6. command / link / approval 优先级不变
7. Bilibili 解析、渲染、下载、订阅轮询没有行为回归
8. 回归测试覆盖上述关键边界

---

## 13. Suggested execution note

这份计划刻意把“AI 完整重构”和“Bilibili 主功能零回归”拆开：

- 重构只动 AI 控制平面
- Bilibili 链路先冻结接口与优先级
- 通过 feature flag + regression tests 保证上线风险可控

如果按此方案执行，建议先做 Phase 0 + Phase 1 + Phase 2，不要一开始就删除 legacy path。
