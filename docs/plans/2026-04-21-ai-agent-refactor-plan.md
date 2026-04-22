# AI Agent 化重构总规划（含 Bot 控制能力）

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在不破坏核心 guard 与权限边界的前提下，直接把 bili-qq-bot 的 AI chat 路径升级为完备 Agent Runtime，并新增一个统一 bot-control 接口，让 Agent 可以查询、控制和调整 bot 设置与运行能力。

**Architecture:** 采用“激进但可控”的改造路线：不再把现有 AI chat 仅视为 reply pipeline，而是直接重组为 `Agent Runtime + Bot Control API + Local Actions`。`messageHandler` 保留生产 guard 顺序，但 AI 分支尽快切到统一 `runAgent()`；bot 内部能力通过单一 bot-control 接口暴露给 Agent，再由 local action registry 做权限、确认、审计和 scope 约束。

**Tech Stack:** Node.js 18+, OneBot/NapCat, Express dashboard, OpenAI-compatible chat API, existing MCP bridge under `src/services/mcpManager.js`

---

## 1. 本轮 review 结论

### 1.1 这份改造值得做，但要调整节奏

当前仓库已经不是“普通聊天机器人”：
- 有消息级 admission：`src/services/ai/replyGateService.js`
- 有上下文收敛：`src/services/ai/contextSelectorService.js`
- 有回复模式分类：`src/services/ai/responseModeService.js`
- 有 augmentation：`src/services/ai/retrievalAugmentService.js`
- 有 prompt 组装：`src/services/ai/promptAssemblerService.js`
- 有 tool loop：`src/services/ai/llmChatService.js`
- 有运行时装配：`src/services/ai/replyRuntimeService.js`
- 有 orchestrator：`src/services/ai/replyOrchestratorService.js`

所以这次重构的重点不是“重新发明 agent”，而是：
1. 把现有 AI 管线的边界抽象成稳定契约
2. 给 bot 内部动作补上统一 action 层
3. 给 mutation 补齐确认、权限和审计

### 1.2 当前规划的主要问题

结合现有代码，原版规划有几个需要修正的点：

1. **过早弱化 `messageHandler.js` 的职责。**
   现在它不只是 ingress，还承担：
   - 私聊仅 Root 可进 AI
   - Root 私聊审批优先拦截
   - 命令优先
   - 链接优先
   - 黑名单/群启用状态/幂等去重

   所以 Phase 1 不应该把它直接降成“只构造 agentInput”，而应该保留现有 guard 顺序，只抽薄的 AI pipeline input。

2. **低估了现有 `llmChatService.js` 的执行控制能力。**
   它已经处理：
   - 循环次数
   - 空回复重试
   - tool loop
   - API 超时/错误返回

   所以 Phase 1 更适合为它补 `steps[]` metadata，而不是新建一套完全平行的 executor 语义后再重写。

3. **原 action 列表里有几项与当前代码不完全匹配。**
   例如：
   - `subscription.checkUserExists`：当前没有现成单独 service
   - `subscription.getSubscriptionStatus`：当前也没有统一 service 入口
   - `subscription.getAtAllTargets`：更像 config/dashboard 视图，不是订阅 service 原子能力
   - `subscription.checkNow`：当前只适用于“本群已订阅 UID”，不是任意对象
   - `config.setSubscriptionInterval`：当前是 runtime 调整，不是持久化 config

4. **审批动作的自然语言自动执行风险过高。**
   当前 `requestApprovalService.js` 的安全锚点是：
   - 引用审批消息回复“是/否”
   - 或带 `REQ-*` shortId

   第一版不应支持“同意最新一个”这种模糊自然语言直接执行。

5. **配置写入口当前分散，必须先统一。**
   当前至少有：
   - `/AI` 命令：`src/commands/ai.js`
   - Dashboard 单独 AI API：`src/dashboard/routes/api/modules/group-ai.js`
   - Dashboard 通用群配置 API：`src/dashboard/routes/api/modules/groups.js`

   如果 agent action 再直接各写各的 setter，会出现第三套规则源。

### 1.3 修正后的总策略

原先的保守版路线仍然成立，但如果你要更激进，可以直接采用：

- **一条统一的 `runAgent()` 主链路替换现有 AI chat 编排**
- **一个统一的 bot-control 接口作为 Agent 的本地控制平面**
- **现有 `/AI` 命令、订阅命令、Dashboard 写接口逐步下沉为这个控制平面的调用方**

核心前提只有两个：
1. 不破坏 `messageHandler.js` 的生产 guard 顺序
2. 所有 mutation 只能通过 bot-control / local action 层，不允许模型直接碰内部 service

### 1.4 激进方案是否可行

**可以。** 但这里的“激进”应理解为：
- 快速统一 AI chat 与 agent runtime
- 快速新增 bot-control 接口
- 快速把自然语言入口接到 bot 控制面

而不是：
- 让模型直接调用 `subscriptionService` / `config` / `requestApprovalService`
- 跳过 confirmation / audit / permission gate
- 在群聊里默认允许 mutation

### 1.5 激进方案的目标形态

建议直接把目标收敛成下面这套：

```text
messageHandler
  -> buildAgentInput
  -> runAgent(agentInput)
       -> agentDecision
       -> agentContext
       -> agentPlan
       -> agentExecutor
            -> MCP tools
            -> bot-control API
       -> agentFinalizer
```

其中 `bot-control API` 是新增的统一控制面：

```text
src/services/ai/botControl/
  -> index.js
  -> registry.js
  -> subscriptionController.js
  -> configController.js
  -> contextController.js
  -> approvalController.js
  -> runtimeController.js
```

这层的职责不是“包装给命令行用”，而是作为 **bot 内部唯一可变更控制平面**：
- AI agent 通过它执行 bot 动作
- 命令系统未来也可以逐步复用它
- Dashboard API 未来也可以逐步复用它

### 1.6 激进方案的风险边界

为了让这个方案能落地，必须强制保留下面这些边界：

- 群聊 mutation 默认仍需确认
- Root 私聊审批仍保留现有优先链路
- 高风险动作只允许精确目标，不允许模糊自然语言直接执行
- bot-control 统一产出 audit 结果
- `mutated=false` 时最终回复不得声称执行成功

---

## 2. 现状代码地图

### 2.1 现有 AI 入口链路

#### 消息入口
- `src/handlers/messageHandler.js`

当前已做：
- 自己消息过滤
- 私聊 Root 校验
- Root 私聊审批优先处理
- 幂等去重
- 黑名单/群开关
- 链接预处理
- AI 上下文写入
- 命令优先、链接优先、AI 最后
- AI gate/context/response mode 初步拼装

#### AI 兼容入口
- `src/handlers/aiHandler.js`

当前已做：
- runtime assembly
- runtime helper 注入
- 调用 `replyOrchestratorService.generateReply()`

#### AI 服务层
- `src/services/ai/replyGateService.js`
- `src/services/ai/contextSelectorService.js`
- `src/services/ai/responseModeService.js`
- `src/services/ai/retrievalAugmentService.js`
- `src/services/ai/botFactsService.js`
- `src/services/ai/promptAssemblerService.js`
- `src/services/ai/replyRuntimeService.js`
- `src/services/ai/replyOrchestratorService.js`
- `src/services/ai/llmChatService.js`
- `src/services/ai/replyPersistenceService.js`
- `src/services/ai/toolExecutionGuard.js`

### 2.2 现有 bot 控制能力来源

#### 订阅
- `src/services/subscriptionService.js`
- `src/services/subscription/subscriptionManager.js`
- `src/commands/subscription.js`
- `src/dashboard/routes/api/modules/subscriptions.js`

当前可复用原子能力：
- `addUserSubscription(uid, groupId)`
- `removeUserSubscription(uid, groupId)`
- `addBangumiSubscription(seasonId, groupId)`
- `removeBangumiSubscription(seasonId, groupId)`
- `getSubscriptionsByGroup(groupId)`
- `getFollowingsForGroup(groupId)`
- `removeAllGroupSubscriptions(groupId)`
- `checkSubscriptionNow(uid, groupId)`
- `updateCheckInterval(seconds)`（runtime 语义）

#### 审批
- `src/services/requestApprovalService.js`

当前能力特征：
- 强依赖 pending 队列
- 自带 `REQ-*` shortId 概念
- Root 私聊“是/否”链路优先级很高

#### 配置
- `src/config/index.js`
- `src/config/schema.js`
- `src/commands/ai.js`
- `src/dashboard/routes/api/modules/group-ai.js`
- `src/dashboard/routes/api/modules/groups.js`

当前问题：
- AI 配置存在专门 API 和通用群配置 API 两套更新路径
- `/AI` 命令还在直接 `setGroupConfig`
- setter / validator 还没完全统一成单一服务层

---

## 3. 目标边界

### 3.1 这次不是“让模型接管 bot”

目标是：
- 让 AI 具备 **受控执行能力**
- 让用户能用自然语言完成有限 bot 操作
- 所有变更动作都能被权限、确认和审计约束

不是目标：
- 不做自主长期任务编排
- 不做多轮复杂计划求解器
- 不让模型绕过命令系统或 Dashboard
- 不让模型直接调用内部 service

### 3.2 动作分层

#### 低风险：只读
- 查询本群订阅列表
- 查询某 UID 是否已在本群订阅
- 查询本群 AI/RAG/profile 状态
- 查询当前可用 MCP 工具
- 查询 bot 状态
- 查询待审批数量/列表

#### 中风险：单群、单对象 mutation
- 添加本群用户订阅
- 删除本群用户订阅
- 添加本群番剧订阅
- 删除本群番剧订阅
- 重置当前群对话
- 开关本群 AI / RAG / profile

#### 高风险：必须严格限制
- 清空本群全部订阅
- 修改全局或跨群配置
- runtime 级订阅间隔调整
- 审批通过/拒绝
- 管理员/黑名单相关配置

---

## 4. 设计原则

### 4.1 保留现有 ingress guard 顺序

`messageHandler.js` 的现有 guard 顺序必须继续成立：
1. 权限/黑名单/群开关/私聊 Root
2. 审批拦截优先
3. 命令优先
4. 链接优先
5. AI 最后

Agent 化只重构 AI 分支，不动整个消息系统的外部行为顺序。

### 4.2 现有 AI 服务以“组合”优先，不平移重写

以下服务保留原子职责：
- `replyGateService`
- `contextSelectorService`
- `responseModeService`
- `retrievalAugmentService`
- `botFactsService`
- `llmChatService`

新增层只负责组合和统一契约，不重写其核心逻辑。

### 4.3 所有 bot mutation 必须过 Local Action Layer

模型禁止直接调用：
- `subscriptionService.*`
- `requestApprovalService.*`
- `config.setGroupConfig()`
- `aiHandler.resetContext()`

统一走：
- `src/services/ai/localActions/*`

### 4.4 确认必须基于 action snapshot，而不是二次语义解释

用户确认后恢复执行时：
- 不再让 LLM 重新“理解一次用户想干什么”
- 直接使用保存下来的 `actionName + args + actor + scope + expiresAt`
- 恢复阶段只做权限重检和状态重检

### 4.5 命令和 Dashboard 继续存在

Agent 不替代：
- 命令系统
- Dashboard API

长期目标是让命令和 Dashboard 也逐步复用 action/setting service，但不是这轮强制完成。

---

## 5. 目标架构

建议把 AI 能力收敛成 8 层。

### 5.1 Ingress Layer

**文件：** `src/handlers/messageHandler.js`

职责：
- 保留所有现有前置 guard
- 只在 AI 分支构造 `agentInput`
- 继续保持审批优先、命令优先、链接优先
- 不直接决定 mutation permission 细节

建议新增 helper：
- `buildAgentInput({ rawMessage, userId, groupId, messageId, messageMeta, traceId, ws })`

### 5.2 Agent Admission Layer

**新增：** `src/services/ai/agentDecisionService.js`

输入：`agentInput`

组合来源：
- `replyGateService.evaluate()`
- `classifyResponseMode()`
- source policy（group/private）
- permission facts（Root / group admin / normal user）

输出：`agentDecision`

```js
{
  shouldRespond: true,
  triggerLevel: 'ambient' | 'direct' | 'private_direct',
  taskMode: 'chat' | 'answer' | 'query' | 'confirm' | 'act',
  riskLevel: 'low' | 'medium' | 'high',
  toolPolicy: {
    allowMcpTools: true,
    allowLocalActions: false,
    allowedActionNamespaces: []
  },
  confirmation: {
    required: false,
    reason: null,
    scope: 'none' | 'pending_action'
  },
  reasons: []
}
```

### 5.3 Agent Context Builder Layer

**新增：** `src/services/ai/agentContextBuilderService.js`

组合来源：
- `contextSelectorService.selectContext()`
- `retrievalAugmentService.collectAugments()`（通过 runtime 现有入口复用）
- `botFactsService`
- 当前群配置快照
- actor permission facts

输出：`agentContext`

```js
{
  traceId,
  currentTurn,
  selectedContext,
  backgroundSummary,
  relevantMemories,
  profileText,
  botFacts,
  permissionFacts,
  groupConfigSnapshot,
  executionConstraints,
  availableActionNamespaces
}
```

### 5.4 Agent Planner Layer

**新增：** `src/services/ai/agentPlannerService.js`

第一版保持轻量：
- 不做树搜索
- 不做复杂多步计划器
- 只做“本轮应该回答、查询、确认还是执行”抽象

输出：`agentPlan`

```js
{
  userGoal: '为本群订阅某个UP主',
  planType: 'chat' | 'tool_assisted_answer' | 'query_only' | 'confirm_then_action' | 'single_action',
  requiresTools: true,
  requiresConfirmation: true,
  candidateActions: [
    {
      kind: 'local_action',
      name: 'subscription.addUser',
      args: { groupId: '1065812436', uid: '12345' }
    }
  ],
  finalAnswerStyle: 'brief_chat' | 'status_report'
}
```

### 5.5 Confirmation Layer

**新增：** `src/services/ai/agentConfirmationService.js`

职责：
- 保存短期 pending action
- 识别“确认/取消”回复
- 根据 snapshot 恢复执行
- 避免 pending-action 回复污染普通聊天上下文

第一版约束：
- 仅内存态
- 不支持跨重启恢复
- 群聊仅限当前群 + 当前 actor
- 审批动作不走通用 confirmation，继续沿用现有审批链路

### 5.6 Execution Layer

**建议新增：** `src/services/ai/agentRunService.js`

说明：
- `replyOrchestratorService.js` 先保留兼容导出
- 新增 `agentRunService.js` 负责组织 decision/context/plan/execute
- `llmChatService.js` 继续负责 chat completion + tool loop

Run state：

```js
{
  runId,
  state: 'planned' | 'waiting_confirmation' | 'executing' | 'observing' | 'finalized' | 'blocked' | 'failed' | 'aborted',
  stepCount,
  steps: [],
  toolCalls: [],
  localActions: [],
  errors: [],
  hasMutation: false,
  finalReply: ''
}
```

### 5.7 Local Action Layer

**新增目录：** `src/services/ai/localActions/`

建议结构：
- `index.js`
- `actionRegistry.js`
- `subscriptionActions.js`
- `configActions.js`
- `contextActions.js`
- `approvalActions.js`
- `runtimeActions.js`

统一 action 定义：

```js
{
  name: 'subscription.addUser',
  namespace: 'subscription.write',
  riskLevel: 'medium',
  mutating: true,
  confirmation: 'required_in_group',
  schema: { /* JSON schema or validator fn */ },
  canExecute(ctx) { /* permission check */ },
  execute(args, ctx) { /* call service */ }
}
```

统一结果：

```js
{
  ok: true,
  action: 'subscription.addUser',
  mutated: true,
  summary: '已为群 1065812436 添加用户订阅 12345',
  data: { uid: '12345', groupId: '1065812436' },
  audit: {
    namespace: 'subscription.write',
    riskLevel: 'medium',
    actorId: '2402855757',
    scope: 'group:1065812436'
  }
}
```

### 5.8 Persistence / Audit Layer

扩展：
- `replyPersistenceService.js`
- logger
- 可选轻量 run store

至少记录：
- `runId`, `traceId`
- `actorId`, `groupId`, `source`
- `taskMode`, `planType`
- `toolCalls`
- `localActions`
- `confirmationState`
- `finalState`
- `hasMutation`
- `finalReplyLength`

---

## 6. Local Action 目录与能力边界

### 6.1 第一版实际可落的 action namespace

#### `subscription.read`
- `subscription.listGroup`
- `subscription.getGroupSubscriptions`
- `subscription.getFollowingsForGroup`
- `subscription.isUserSubscribed`

#### `subscription.write`
- `subscription.addUser`
- `subscription.removeUser`
- `subscription.addBangumi`
- `subscription.removeBangumi`
- `subscription.checkNow`
- `subscription.removeAllForGroup`

#### `config.read`
- `config.getGroupAiConfig`
- `config.getGroupBasicConfig`

#### `config.write`
- `config.setGroupAiEnabled`
- `config.setGroupRagEnabled`
- `config.setGroupProfileEnabled`
- `config.setGroupAiContextLimit`

#### `context.write`
- `context.resetConversation`

#### `runtime.read`
- `runtime.getBotStatus`
- `runtime.getMcpTools`
- `runtime.getCurrentCapabilities`

#### `runtime.write`（后置）
- `runtime.setSubscriptionCheckInterval`

#### `approval.read`
- `approval.listPending`
- `approval.getPendingByShortId`

#### `approval.write`（最后接）
- `approval.approveByShortId`
- `approval.rejectByShortId`

### 6.2 第一版不做的 action

以下能力暂不在第一版自然语言 action 中支持：
- 模糊语义审批（如“同意最新一个”）
- 跨群批量修改
- 全局配置修改
- 管理员/黑名单相关配置
- 任意 UID 的立即检查（若不在本群订阅内）

### 6.3 action 参数约束

#### 群聊
- 默认强绑定当前 `groupId`
- 模型不可自由指定其他群
- 若用户文本带其他群号，也先拒绝或要求 Root 私聊

#### 私聊 Root
- 可允许显式 `groupId`
- 但必须：
  - 明确写进 args
  - audit 落 `scope=group:<id>`
  - 高风险仍需确认

---

## 7. 配置控制面设计

### 7.1 当前问题

AI 相关配置写入口分散：
- `/AI` 命令直接 `config.setGroupConfig`
- `group-ai.js` 手动更新 groupConfig 再 `save()`
- `groups.js` 又有一套字段校验和写入逻辑

### 7.2 目标

新增一个统一配置写层，例如：
- `src/services/ai/agentConfigFacade.js`
- 或 `src/services/config/groupAiConfigService.js`

由它统一处理：
- 字段级校验
- nullable/reset 语义
- `setGroupConfig` / 删除 override
- `save()`
- 审计 payload 生成

然后让：
- `/AI` 命令复用它
- Dashboard `group-ai.js` / `groups.js` 渐进复用它
- `localActions/configActions.js` 也复用它

这样避免三套规则分叉。

### 7.3 Agent 新配置项

等基础能力稳定后，再加下列 group-level 配置：
- `aiAgentEnabled`
- `aiAgentAllowLocalActions`
- `aiAgentRequireConfirmationInGroup`
- `aiAgentAllowedActionNamespaces`
- `aiAgentMaxSteps`
- `aiAgentMaxMutationsPerRun`

注意：这些字段进入 `schema.js` 前，先确认是否真的需要 group override；不要先加一堆未来字段。

---

## 8. 核心流程设计

## 8.1 主流程

```text
messageHandler
  -> early guards (existing)
  -> command/link dispatch (existing)
  -> build agentInput
  -> agentConfirmationService.tryConsumePendingDecision()
      -> if consumed: stop normal AI path
  -> agentDecisionService.evaluate()
      -> shouldRespond=false => stop
  -> agentContextBuilderService.build()
  -> agentPlannerService.plan()
  -> if plan requires confirmation
       -> agentConfirmationService.openPendingAction()
       -> reply confirmation prompt
       -> stop
  -> agentRunService.run()
       -> may call MCP tools
       -> may call localActions
  -> replyPersistenceService.persist()
  -> send final reply
```

## 8.2 群聊订阅示例

用户：`@bot 帮我订阅老番茄`

第一轮：
- admission: `taskMode=confirm`, `riskLevel=medium`
- planner: 候选 action 为 `subscription.addUser`
- 若目标名不唯一：先查询候选并追问
- 若 UID 唯一：生成确认文案，不执行

第二轮用户回复：`确认`
- confirmation service 命中 pending action
- 恢复执行 `subscription.addUser`
- 返回真实执行结果

## 8.3 群聊关闭 AI 示例

用户：`把本群 AI 关掉`
- 若不是群管理员：直接拒绝
- 若是群管理员：开启 pending action
- 用户确认后调用 `config.setGroupAiEnabled(false)`

## 8.4 Root 私聊审批示例

用户：`同意 REQ-3F8K`
- 不走通用 confirmation
- 走 `approval.read/approval.write` 专用路径
- 必须先解析 shortId，找到唯一 pending 项
- 成功后返回真实结果

---

## 9. 状态机与契约

### 9.1 `taskMode`
- `chat`
- `answer`
- `query`
- `confirm`
- `act`

### 9.2 `runState`
- `admitted`
- `context_ready`
- `planned`
- `waiting_confirmation`
- `executing`
- `observing`
- `finalized`
- `blocked`
- `failed`
- `aborted`

### 9.3 `confirmationState`
- `not_required`
- `required`
- `pending`
- `confirmed`
- `rejected`
- `expired`

### 9.4 `riskLevel`
- `low`
- `medium`
- `high`

### 9.5 `agentInput` 建议结构

```js
{
  traceId,
  rawMessage,
  source: 'group' | 'private',
  groupId,
  userId,
  userName,
  messageId,
  messageMeta,
  contextKey,
  ws
}
```

### 9.6 `pendingAction` 建议结构

```js
{
  pendingId,
  actorId,
  groupId,
  source,
  actionName,
  args,
  riskLevel,
  createdAt,
  expiresAt,
  traceId,
  summaryText
}
```

---

## 10. 分阶段实施计划

## Phase 0：补齐设计约束，不写生产逻辑

**目标：** 先把抽象和边界定清楚，避免重构时破坏现有链路。

### Task 0.1：补契约文档
**Files:**
- Modify: `docs/plans/2026-04-21-ai-agent-refactor-plan.md`

**Checklist:**
- 明确 guard 不动
- 明确 action 真实可用清单
- 明确审批第一版只支持 shortId / 引用链路

### Task 0.2：盘点配置写入口
**Files:**
- Inspect only: `src/commands/ai.js`
- Inspect only: `src/dashboard/routes/api/modules/group-ai.js`
- Inspect only: `src/dashboard/routes/api/modules/groups.js`
- Inspect only: `src/config/index.js`

**Checklist:**
- 列出所有 AI 配置写字段
- 标出共用校验和分叉逻辑

---

## Phase 1：薄封装 Agent Runtime，不改变 guard 主流程

**目标：** 不推翻现有 AI 管线，只抽统一契约和 run metadata。

### Task 1.1：定义核心类型
**Files:**
- Create: `src/services/ai/agentTypes.js`
- Test: `test/unit/agent-types-contract.test.js`

**Checklist:**
- 常量：`taskMode`, `runState`, `riskLevel`, `confirmationState`
- typedef：`agentInput`, `agentDecision`, `agentContext`, `agentPlan`, `agentRunResult`

### Task 1.2：新增 `agentDecisionService`
**Files:**
- Create: `src/services/ai/agentDecisionService.js`
- Test: `test/unit/agent-decision-service.test.js`

**Checklist:**
- 内部复用 `replyGateService.evaluate()`
- 内部复用 `classifyResponseMode()`
- 补 private/group risk policy
- 只做组合，不改老服务对外接口

### Task 1.3：新增 `agentContextBuilderService`
**Files:**
- Create: `src/services/ai/agentContextBuilderService.js`
- Test: `test/unit/agent-context-builder.test.js`

**Checklist:**
- 复用 `selectContext()`
- 复用 augmentation/runtime helper
- 复用 bot facts
- 输出统一 `agentContext`

### Task 1.4：新增 `agentPlannerService`
**Files:**
- Create: `src/services/ai/agentPlannerService.js`
- Test: `test/unit/agent-planner-service.test.js`

**Checklist:**
- planner 为纯函数
- 第一版只产出轻量 plan
- 不做副作用

### Task 1.5：给 `llmChatService` 补执行 metadata
**Files:**
- Modify: `src/services/ai/llmChatService.js`
- Test: `test/unit/ai-llm-chat.test.js`

**Checklist:**
- 返回 `steps[]`
- 记录模型响应、tool calls、tool results、空回复重试
- 输出 `hasToolResult`, `hasMutation:false`

### Task 1.6：新增 `agentRunService`
**Files:**
- Create: `src/services/ai/agentRunService.js`
- Modify: `src/services/ai/replyOrchestratorService.js`
- Test: `test/unit/agent-run-service.test.js`
- Test: `test/unit/ai-reply-orchestrator.test.js`

**Checklist:**
- `replyOrchestratorService` 兼容旧调用
- 内部委托给 `agentRunService`
- Phase 1 仍返回字符串 reply 给 `aiHandler`

### Task 1.7：保守调整 AI 入口数据构造
**Files:**
- Modify: `src/handlers/messageHandler.js`
- Modify: `src/handlers/aiHandler.js`
- Test: `test/unit/messageHandler-ai-pipeline.test.js`
- Test: `test/unit/aiHandler-multiTurn.test.js`

**Checklist:**
- 新增 `buildAgentInput()`
- 保留现有 guard 顺序
- 不移除命令/链接/审批优先级

---

## Phase 2：先接只读 Local Actions

**目标：** 先让 agent 查询 bot 状态，不开放 mutation。

### Task 2.1：建立 action registry
**Files:**
- Create: `src/services/ai/localActions/actionRegistry.js`
- Create: `src/services/ai/localActions/index.js`
- Test: `test/unit/local-action-registry.test.js`

**Checklist:**
- action schema
- namespace
- riskLevel
- mutating flag
- permission gate
- audit payload builder

### Task 2.2：接入只读订阅动作
**Files:**
- Create: `src/services/ai/localActions/subscriptionActions.js`
- Test: `test/unit/agent-subscription-actions.test.js`

**Checklist:**
- `listGroup`
- `getGroupSubscriptions`
- `getFollowingsForGroup`
- `isUserSubscribed`
- 严格绑定当前群 scope

### Task 2.3：接入只读配置/运行时动作
**Files:**
- Create: `src/services/ai/localActions/configActions.js`
- Create: `src/services/ai/localActions/runtimeActions.js`
- Test: `test/unit/agent-config-actions.test.js`
- Test: `test/unit/agent-runtime-actions.test.js`

**Checklist:**
- 先只做 read
- 列 bot 状态、MCP 工具、group AI 配置

---

## Phase 3：确认机制 + 低风险 mutation

**目标：** 安全支持单群、单对象的变更动作。

### Task 3.1：新增 confirmation service
**Files:**
- Create: `src/services/ai/agentConfirmationService.js`
- Modify: `src/handlers/messageHandler.js`
- Test: `test/unit/agent-confirmation-service.test.js`

**Checklist:**
- open pending action
- try consume confirm/cancel
- 过期处理
- pending-action 回复不写入普通 AI 上下文/向量记忆

### Task 3.2：把 confirmation 接入 run service
**Files:**
- Modify: `src/services/ai/agentRunService.js`
- Modify: `src/services/ai/agentPlannerService.js`
- Test: `test/unit/agent-confirmation-flow.test.js`

**Checklist:**
- `confirm_then_action` 不直接执行 mutation
- 恢复执行时重做权限校验
- 最终动作来自 snapshot，不重新理解用户语义

### Task 3.3：接入低风险 mutation
**Files:**
- Modify/Create: `src/services/ai/localActions/subscriptionActions.js`
- Create: `src/services/ai/localActions/contextActions.js`
- Test: `test/unit/agent-subscription-actions.test.js`
- Test: `test/unit/agent-context-actions.test.js`

**Checklist:**
- `subscription.addUser`
- `subscription.removeUser`
- `subscription.addBangumi`
- `subscription.removeBangumi`
- `context.resetConversation`

说明：
- 群聊 mutation 默认 confirm required
- 私聊 Root 可 act-capable，但仍受 risk policy 约束

---

## Phase 4：统一配置写层，再开放 config mutation

**目标：** 先收敛配置写逻辑，再让 agent 改配置。

### Task 4.1：抽统一 group AI config 写层
**Files:**
- Create: `src/services/ai/agentConfigFacade.js` 或 `src/services/config/groupAiConfigService.js`
- Modify: `src/commands/ai.js`
- Modify: `src/dashboard/routes/api/modules/group-ai.js`
- Modify: `src/dashboard/routes/api/modules/groups.js`
- Test: `test/unit/ai-config-entry-consistency.test.js`
- Test: `test/unit/ai-config-validation.test.js`

**Checklist:**
- 统一字段校验
- 统一 null/reset 语义
- 统一 save 行为
- 命令、Dashboard、agent action 共用

### Task 4.2：接入 config mutation actions
**Files:**
- Modify: `src/services/ai/localActions/configActions.js`
- Test: `test/unit/agent-config-actions.test.js`

**Checklist:**
- `config.setGroupAiEnabled`
- `config.setGroupRagEnabled`
- `config.setGroupProfileEnabled`
- `config.setGroupAiContextLimit`

---

## Phase 5：高风险动作与审批接入

**目标：** 最后接入最危险的动作，并附带更严格限制。

### Task 5.1：接入高风险订阅/runtime 动作
**Files:**
- Modify: `src/services/ai/localActions/subscriptionActions.js`
- Modify: `src/services/ai/localActions/runtimeActions.js`
- Test: `test/unit/agent-high-risk-actions.test.js`

**Checklist:**
- `subscription.removeAllForGroup`
- `runtime.setSubscriptionCheckInterval`

注意：
- `runtime.setSubscriptionCheckInterval` 不等于持久化 config
- 若未来要持久化，再单独设计 config 写路径

### Task 5.2：接入审批只读 + 写动作
**Files:**
- Create: `src/services/ai/localActions/approvalActions.js`
- Modify: `src/services/requestApprovalService.js`
- Test: `test/unit/agent-approval-actions.test.js`

**Checklist:**
- 第一版只支持：
  - 列 pending
  - 通过 shortId 精确 approve/reject
- 必须 Root 私聊
- 不支持模糊目标
- 不覆盖现有“引用消息回复是/否”优先链路

---

## 11. 测试策略

### 11.1 Phase 1 关键单测
- `agent-types-contract.test.js`
- `agent-decision-service.test.js`
- `agent-context-builder.test.js`
- `agent-planner-service.test.js`
- `agent-run-service.test.js`
- `ai-llm-chat.test.js`（扩 steps metadata）
- `messageHandler-ai-pipeline.test.js`（验证 guard 未破坏）

### 11.2 Phase 2-3 单测
- `local-action-registry.test.js`
- `agent-subscription-actions.test.js`
- `agent-runtime-actions.test.js`
- `agent-context-actions.test.js`
- `agent-confirmation-service.test.js`
- `agent-confirmation-flow.test.js`

### 11.3 Phase 4-5 单测
- `ai-config-entry-consistency.test.js`
- `agent-config-actions.test.js`
- `agent-high-risk-actions.test.js`
- `agent-approval-actions.test.js`

### 11.4 必须验证的行为回归
- 私聊非 Root 仍拒绝
- Root 私聊审批优先链路不受 agent 影响
- 命令优先于 AI
- 链接优先于 AI
- 群关闭时 AI 不应误进
- mutation 未确认时绝不执行
- `mutated=false` 时最终回复不得声称“已完成”

---

## 12. 风险与控制

### 风险 1：群聊误执行 mutation
**控制：**
- 群聊 mutation 默认 `confirm_required`
- 只允许当前群 scope
- 高风险动作必须二次确认

### 风险 2：模型虚报已执行
**控制：**
- 最终回复必须基于 action result
- `mutated=false` 不得说“已完成”
- action summary 为唯一事实来源

### 风险 3：配置写规则继续分叉
**控制：**
- config mutation 之前先抽统一配置写层
- agent/命令/Dashboard 共用

### 风险 4：审批安全锚点被破坏
**控制：**
- 现有审批优先链路保留
- agent 审批第一版只支持 shortId 精确目标
- 必须 Root 私聊

### 风险 5：确认回复污染普通 AI 记忆
**控制：**
- confirmation service 优先消费
- `确认/取消` 不写普通上下文和向量记忆

### 风险 6：跨群参数被模型乱填
**控制：**
- 群聊强制注入当前 `groupId`
- 私聊跨群必须显式 `groupId`
- 每个 action 再做 scope 校验

---

## 13. 最小可执行版本（MVP）

建议第一批只做到这里：
1. `agentTypes.js`
2. `agentDecisionService.js`
3. `agentContextBuilderService.js`
4. `agentPlannerService.js`
5. `agentRunService.js`
6. `localActions/actionRegistry.js`
7. `localActions/subscriptionActions.js`（read + add/removeUser）
8. `localActions/contextActions.js`
9. `agentConfirmationService.js`

这时已经能支持：
- 自然语言查询本群订阅
- 自然语言添加/删除本群用户订阅
- 自然语言重置本群对话
- 群聊确认后执行
- 私聊 Root 直接执行低风险动作

**先不要急着上：**
- config.write
- removeAllForGroup
- runtime.setSubscriptionCheckInterval
- approval.write

---

## 14. Definition of Done

满足以下条件才算这一轮 Agent 化重构完成：

1. `messageHandler.js` 仍保留既有 guard 顺序，AI 分支只增加标准化输入构造
2. 有统一的 `agentInput` / `agentDecision` / `agentContext` / `agentPlan` / `agentRunResult`
3. `llmChatService.js` 具备可审计的 `steps[]` metadata
4. 所有 bot mutation 都经由 `localActions/`，模型不再直调内部 service
5. 群聊 mutation 默认需要 confirmation
6. confirmation 基于 action snapshot 恢复，不重新依赖 LLM 解释
7. 至少支持以下自然语言动作：
   - 查询本群订阅
   - 添加本群用户订阅
   - 取消本群用户订阅
   - 重置本群对话
8. 所有 mutating action 都有可检索 audit 字段：
   - `actorId`
   - `scope`
   - `target`
   - `result`
9. `mutated=false` 时不会返回“已完成”类表述
10. Root 私聊审批原链路无回归

---

## 15. 推荐实施顺序

按风险最低的顺序落地：
1. Phase 1：统一契约 + metadata
2. Phase 2：只读 actions
3. Phase 3：`context.resetConversation` + `subscription.add/removeUser`
4. Phase 4：统一 config 写层，再接 config.write
5. Phase 5：高风险动作和审批

原因：
- 先验证架构抽象是否稳
- 先验证 action registry 是否可控
- 先从单群、单对象 mutation 验证确认流
- 审批永远最后接

---

## 16. 下一步建议

下一步最合适的是直接产出 **Phase 1 skeleton 设计稿**，把下面这些文件的接口和最小测试样例写清楚：
- `src/services/ai/agentTypes.js`
- `src/services/ai/agentDecisionService.js`
- `src/services/ai/agentContextBuilderService.js`
- `src/services/ai/agentPlannerService.js`
- `src/services/ai/agentRunService.js`
- `test/unit/agent-types-contract.test.js`
- `test/unit/agent-decision-service.test.js`
- `test/unit/agent-context-builder.test.js`
- `test/unit/agent-planner-service.test.js`
- `test/unit/agent-run-service.test.js`

下面给出可以直接开始实现的 skeleton 设计。

---

## 17. Phase 1 Skeleton 设计稿

## 17.1 目标

Phase 1 的目标不是一次性把所有 bot-control 动作接完，而是先把现有 AI chat 主链路切成统一的：

```text
messageHandler -> aiHandler -> runAgent(agentInput, runtime)
```

并确保：
- 不破坏现有 ingress guard 顺序
- 不破坏现有 reply 语义
- 不破坏现有 tool loop
- 为后续 bot-control 接入预留稳定插槽

---

## 17.2 文件一：`src/services/ai/agentTypes.js`

### 职责

定义整个 agent runtime 的共享契约、常量和轻量工厂函数。

### 建议导出

```js
'use strict'

const TASK_MODES = Object.freeze({
    CHAT: 'chat',
    ANSWER: 'answer',
    QUERY: 'query',
    CONFIRM: 'confirm',
    ACT: 'act'
})

const RUN_STATES = Object.freeze({
    ADMITTED: 'admitted',
    CONTEXT_READY: 'context_ready',
    PLANNED: 'planned',
    WAITING_CONFIRMATION: 'waiting_confirmation',
    EXECUTING: 'executing',
    OBSERVING: 'observing',
    FINALIZED: 'finalized',
    BLOCKED: 'blocked',
    FAILED: 'failed',
    ABORTED: 'aborted'
})

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
})

const CONFIRMATION_STATES = Object.freeze({
    NOT_REQUIRED: 'not_required',
    REQUIRED: 'required',
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    REJECTED: 'rejected',
    EXPIRED: 'expired'
})

function createEmptyRunResult(overrides = {}) {
    return {
        runId: '',
        state: RUN_STATES.ADMITTED,
        stepCount: 0,
        steps: [],
        toolCalls: [],
        localActions: [],
        errors: [],
        hasToolResult: false,
        hasMutation: false,
        finalReply: null,
        ...overrides
    }
}

module.exports = {
    TASK_MODES,
    RUN_STATES,
    RISK_LEVELS,
    CONFIRMATION_STATES,
    createEmptyRunResult
}
```

### 备注

- 不要引入外部依赖
- 不要在这里写业务逻辑
- 先用 JSDoc + 常量即可，不必一开始搞 class hierarchy

---

## 17.3 文件二：`src/services/ai/agentDecisionService.js`

### 职责

组合现有：
- `replyGateService.evaluate()`
- `classifyResponseMode()`
- source/private policy
- actor 权限事实

产出统一的 `agentDecision`。

### 建议输入

```js
{
    agentInput,
    config,
    replyGateService,
    classifyResponseMode
}
```

### 建议导出

```js
'use strict'

const { TASK_MODES, RISK_LEVELS, CONFIRMATION_STATES } = require('./agentTypes')

function buildPermissionFacts({ agentInput, config }) {
    const { groupId, userId, source } = agentInput
    return {
        source,
        isRootAdmin: config.isRootAdmin(userId),
        isGroupAdmin: source === 'group' ? config.isGroupAdmin(groupId, userId) : false,
        canManageCurrentGroup: source === 'private'
            ? config.isRootAdmin(userId)
            : config.isGroupAdmin(groupId, userId) || config.isRootAdmin(userId)
    }
}

function mapResponseModeToTaskMode(responseMode) {
    switch (responseMode?.mode) {
        case 'chat':
            return TASK_MODES.CHAT
        case 'confirm_needed':
            return TASK_MODES.CONFIRM
        case 'action_ready':
            return TASK_MODES.ACT
        default:
            return TASK_MODES.ANSWER
    }
}

function evaluateAgentDecision({ agentInput, config, replyGateService, classifyResponseMode }) {
    const { groupId, userId, rawMessage, messageMeta } = agentInput
    const permissionFacts = buildPermissionFacts({ agentInput, config })

    const gateDecision = replyGateService.evaluate({
        groupId,
        userId,
        rawMessage,
        messageMeta
    })

    const responseMode = classifyResponseMode({
        rawMessage,
        messageMeta,
        triggerLevel: gateDecision.triggerLevel
    })

    const taskMode = mapResponseModeToTaskMode(responseMode)
    const isMutationCandidate = taskMode === TASK_MODES.ACT || taskMode === TASK_MODES.CONFIRM
    const riskLevel = isMutationCandidate ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW
    const confirmationRequired = messageMeta?.source === 'group' && isMutationCandidate

    return {
        shouldRespond: gateDecision.shouldReply,
        triggerLevel: gateDecision.triggerLevel,
        taskMode,
        riskLevel,
        confirmationState: confirmationRequired
            ? CONFIRMATION_STATES.REQUIRED
            : CONFIRMATION_STATES.NOT_REQUIRED,
        toolPolicy: {
            allowMcpTools: true,
            allowBotControl: false,
            allowedActionNamespaces: []
        },
        gateDecision,
        responseMode,
        permissionFacts,
        reasons: [
            ...(gateDecision.reasons || []),
            ...((responseMode && responseMode.reasons) || [])
        ]
    }
}

module.exports = {
    buildPermissionFacts,
    evaluateAgentDecision
}
```

### Phase 1 注意点

- `allowBotControl` 先默认 false
- 这里只做 decision，不做执行
- Phase 2 再把 bot-control policy 接进来

---

## 17.4 文件三：`src/services/ai/agentContextBuilderService.js`

### 职责

把当前散落在 `messageHandler + replyOrchestrator + retrievalAugment` 的上下文准备逻辑收成统一对象。

### 建议输入

```js
{
    agentInput,
    agentDecision,
    runtime
}
```

### runtime 依赖要求

建议在 `replyRuntimeService.js` 上补出这些 helper：
- `getContext(contextKey)`
- `collectAugments(args)`
- `buildBotFacts(groupId, turnMeta)`
- `selectContext(args)`  ← 新增注入，避免在 contextBuilder 里直接 require 老 service

### 建议导出

```js
'use strict'

function buildAgentContext({ agentInput, agentDecision, runtime }) {
    const contextKey = agentInput.contextKey || agentInput.groupId || agentInput.userId
    const fullContext = runtime.getContext(contextKey)
    const currentTurn = fullContext[fullContext.length - 1] || null

    const selectedContext = runtime.selectContext({
        context: fullContext.slice(0, -1),
        currentTurn,
        messageMeta: agentInput.messageMeta
    })

    return Promise.resolve(runtime.collectAugments({
        contextKey,
        groupId: agentInput.groupId,
        userId: agentInput.userId,
        currentSpeakerId: currentTurn?.speakerId || agentInput.userId,
        currentText: currentTurn?.content || agentInput.rawMessage,
        context: fullContext.slice(-runtime.contextLimit),
        intentType: runtime.detectIdentityIntent(currentTurn?.content || agentInput.rawMessage || ''),
        ragMode: runtime.ragMode,
        profileEnabled: runtime.profileEnabled,
        structuredSelectedContext: selectedContext
    })).then((augmentResult) => ({
        contextKey,
        currentTurn,
        fullContext,
        selectedContext,
        relevantMemories: augmentResult.memories || [],
        profileText: augmentResult.profileText || '',
        augmentResult,
        botFacts: runtime.buildBotFacts(agentInput.groupId, {
            currentMentionsBot: agentInput.messageMeta?.currentMentionsBot === true,
            isReplyToBot: agentInput.messageMeta?.isReplyToBot === true
        }),
        permissionFacts: agentDecision.permissionFacts,
        executionConstraints: {
            source: agentInput.source,
            riskLevel: agentDecision.riskLevel,
            confirmationState: agentDecision.confirmationState
        }
    }))
}

module.exports = {
    buildAgentContext
}
```

### Phase 1 注意点

- 不在这里做任何 mutation policy
- 只把上下文对象整理齐
- 先保持与现有 structured context 兼容

---

## 17.5 文件四：`src/services/ai/agentPlannerService.js`

### 职责

把 decision + context 转成可执行 plan。

Phase 1 planner 必须刻意简单。

### 建议导出

```js
'use strict'

const { TASK_MODES } = require('./agentTypes')

function planAgentRun({ agentInput, agentDecision, agentContext }) {
    const { taskMode } = agentDecision

    if (taskMode === TASK_MODES.CHAT) {
        return {
            planType: 'chat',
            requiresTools: false,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'brief_chat'
        }
    }

    if (taskMode === TASK_MODES.ANSWER) {
        return {
            planType: 'tool_assisted_answer',
            requiresTools: true,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'brief_chat'
        }
    }

    if (taskMode === TASK_MODES.QUERY) {
        return {
            planType: 'query_only',
            requiresTools: true,
            requiresConfirmation: false,
            candidateActions: [],
            finalAnswerStyle: 'status_report'
        }
    }

    if (taskMode === TASK_MODES.CONFIRM) {
        return {
            planType: 'confirm_then_action',
            requiresTools: true,
            requiresConfirmation: true,
            candidateActions: [],
            finalAnswerStyle: 'status_report'
        }
    }

    return {
        planType: 'single_action',
        requiresTools: true,
        requiresConfirmation: false,
        candidateActions: [],
        finalAnswerStyle: 'status_report'
    }
}

module.exports = {
    planAgentRun
}
```

### Phase 1 注意点

- 先不要在 planner 里解析“订阅老番茄”这种 domain action
- Phase 2 再让 planner 产出 `candidateActions`
- 现在先把 chat pipeline 统一掉

---

## 17.6 文件五：`src/services/ai/agentRunService.js`

### 职责

成为新的 AI 主编排器。

它要做的是：
1. decision
2. context
3. plan
4. prompt/build messages
5. 执行 `llmChatService.runChatLoop()`
6. 统一返回 `agentRunResult`

### 建议导出

```js
'use strict'

const crypto = require('crypto')
const { createEmptyRunResult, RUN_STATES } = require('./agentTypes')
const { evaluateAgentDecision } = require('./agentDecisionService')
const { buildAgentContext } = require('./agentContextBuilderService')
const { planAgentRun } = require('./agentPlannerService')

function createRunId() {
    return `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

async function runAgent({ agentInput, runtime }) {
    const runResult = createEmptyRunResult({
        runId: createRunId(),
        state: RUN_STATES.ADMITTED
    })

    const agentDecision = evaluateAgentDecision({
        agentInput,
        config: runtime.config,
        replyGateService: runtime.replyGateService,
        classifyResponseMode: runtime.classifyResponseMode
    })

    if (!agentDecision.shouldRespond) {
        return {
            ...runResult,
            state: RUN_STATES.ABORTED,
            agentDecision,
            finalReply: null
        }
    }

    const agentContext = await buildAgentContext({
        agentInput,
        agentDecision,
        runtime
    })

    const agentPlan = planAgentRun({
        agentInput,
        agentDecision,
        agentContext
    })

    runResult.state = RUN_STATES.PLANNED

    const reply = await runtime.generateLegacyReply({
        message: agentInput.rawMessage,
        userId: agentInput.userId,
        groupId: agentInput.groupId,
        traceId: agentInput.traceId,
        pipelineInput: {
            gateDecision: agentDecision.gateDecision,
            selectedContext: agentContext.selectedContext,
            responseMode: agentDecision.responseMode
        }
    })

    return {
        ...runResult,
        state: reply ? RUN_STATES.FINALIZED : RUN_STATES.FAILED,
        agentDecision,
        agentContext,
        agentPlan,
        finalReply: reply
    }
}

module.exports = {
    runAgent,
    createRunId
}
```

### 关键说明

这里故意让 Phase 1 的 `agentRunService` 仍然调用：
- `runtime.generateLegacyReply(...)`

原因：
- 这样可以先把 `runAgent()` 插进去
- 但内部依旧复用现有 `generateReply()` 编排
- 等 Phase 2 再逐步把 `replyOrchestratorService` 的逻辑下沉或拆开

这就是“激进入口统一、保守执行复用”。

---

## 17.7 现有文件的最小改造方式

## 17.7.1 `src/services/ai/replyRuntimeService.js`

### 目标

给 `agentRunService` 提供所需 runtime helper。

### 建议新增导出能力

在返回对象里补：

```js
config,
replyGateService,
classifyResponseMode,
selectContext,
generateLegacyReply,
```

### 最小改造建议

```js
const { replyGateService } = require('./replyGateService')
const { classifyResponseMode } = require('./responseModeService')
const { selectContext } = require('./contextSelectorService')
const { generateReply } = require('./replyOrchestratorService')
```

并在 runtime 返回对象中挂：

```js
config,
replyGateService,
classifyResponseMode,
selectContext,
generateLegacyReply: ({ message, userId, groupId, traceId, pipelineInput }) =>
    generateReply({ message, userId, groupId, traceId, pipelineInput, runtime: runtimeRef })
```

注意：这里需要避免 runtime 自引用写法出错，实际实现时可先构造对象再补字段。

---

## 17.7.2 `src/handlers/aiHandler.js`

### 当前目标

从：
- `getReply(message, userId, groupId, traceId, pipelineInput)`

逐步变成：
- `runAgent(agentInput)`
- `getReply(...)` 只是兼容壳

### 建议形态

```js
const { runAgent } = require('../services/ai/agentRunService')

async runAgent(agentInput) {
    const runtime = buildReplyRuntime(...)
    const result = await runAgent({ agentInput, runtime })
    return result
}

async getReply(message, userId, groupId, traceId = null, pipelineInput = null) {
    const agentInput = {
        traceId,
        rawMessage: message,
        groupId,
        userId,
        userName: null,
        messageId: null,
        messageMeta: pipelineInput?.messageMeta || {},
        source: String(groupId || '').startsWith('private_') ? 'private' : 'group',
        contextKey: groupId || userId,
        ws: null
    }
    const result = await this.runAgent(agentInput)
    return result.finalReply
}
```

Phase 1 保持：
- 旧接口还能用
- `messageHandler` 不必一次性大改

---

## 17.7.3 `src/handlers/messageHandler.js`

### 目标

只做一个最小增强：
- 抽 `buildAgentInput()`
- AI 分支里优先走 `aiHandler.runAgent(agentInput)`
- 但 guard 顺序完全不变

### 建议新增 helper

```js
buildAgentInput({ ws, rawMessage, groupId, userId, userName, messageId, messageMeta, traceContext }) {
    return {
        traceId: traceContext.scope,
        rawMessage,
        groupId,
        userId,
        userName,
        messageId,
        messageMeta,
        source: (typeof groupId === 'string' && groupId.startsWith('private_')) ? 'private' : 'group',
        contextKey: groupId || userId,
        ws
    }
}
```

### 建议 AI 分支最小替换

从：
```js
const reply = await aiHandler.getReply(rawMessage, userId, groupId, traceContext.scope, aiPipelineInput)
```

改成：
```js
const agentInput = this.buildAgentInput({
    ws,
    rawMessage,
    groupId,
    userId,
    userName,
    messageId,
    messageMeta,
    traceContext
})
const agentResult = await aiHandler.runAgent(agentInput)
const reply = agentResult.finalReply
```

Phase 1 仍可继续把 `aiPipelineInput` 带进 `agentInput.messageMeta` 或兼容字段里。

---

## 17.8 Phase 1 单测骨架

## 17.8.1 `test/unit/agent-types-contract.test.js`

验证：
- 常量存在
- `createEmptyRunResult()` 默认字段完整

建议断言：
```js
assert.strictEqual(TASK_MODES.CHAT, 'chat')
assert.strictEqual(RUN_STATES.PLANNED, 'planned')
assert.deepStrictEqual(createEmptyRunResult().steps, [])
```

## 17.8.2 `test/unit/agent-decision-service.test.js`

验证：
- `replyGateService` 和 `responseModeService` 被组合
- group mutation 候选进入 `confirmation required`
- 非 reply 情况直接 `shouldRespond=false`

## 17.8.3 `test/unit/agent-context-builder.test.js`

验证：
- 复用 `selectContext`
- augment 结果正确带入
- `botFacts` / `permissionFacts` 存在

## 17.8.4 `test/unit/agent-planner-service.test.js`

验证：
- `chat -> planType=chat`
- `answer -> tool_assisted_answer`
- `confirm -> confirm_then_action`
- 不产生副作用

## 17.8.5 `test/unit/agent-run-service.test.js`

验证：
- `shouldRespond=false` 时直接 abort
- 会串联 decision/context/plan
- 会调用 `runtime.generateLegacyReply`
- 最终返回 `agentRunResult.finalReply`

## 17.8.6 `test/unit/ai-llm-chat.test.js`

扩展验证：
- `steps[]` 数组存在
- tool success / timeout / empty-retry 都会产生日志步骤

---

## 17.9 Phase 1 完成后的状态

做完这个 skeleton 之后，项目会变成：

- 外层已经统一成 `runAgent()` 主链路
- 内层仍然复用现有 reply orchestrator / llmChatService
- 这时就可以继续 Phase 2，给 executor 接上 `botControl` 接口

也就是说，Phase 1 的成功标准不是“功能大变化”，而是：

**从今天开始，AI chat 已经在架构上是 Agent，只是 bot-control 还没接上。**

---

## 17.10 紧接着的下一步

Phase 1 skeleton 写完后，最值得直接实现的是：

1. `agentTypes.js`
2. `agentDecisionService.js`
3. `agentContextBuilderService.js`
4. `agentPlannerService.js`
5. `agentRunService.js`
6. `replyRuntimeService.js` 注入补齐
7. `aiHandler.js` 新增 `runAgent()`
8. `messageHandler.js` 改成走 `runAgent()`

然后再进入：
- `src/services/ai/botControl/registry.js`
- `src/services/ai/botControl/subscriptionController.js`
- `src/services/ai/botControl/contextController.js`

这就是最激进但仍可控的切换路径。