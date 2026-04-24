# Agent Runtime Redesign Plan

> 目标：在旧 AI/MCP 已移除的基础上，从零设计一个适合 QQ 群聊的拟人化 Agent。本文只描述新架构，不复用旧 AI/MCP 代码，也不引入 MCP。

## 1. 设计结论

当前项目更适合把 AI Agent 设计成“群聊观察者 + 谨慎参与者 + 受限业务操作者”，而不是传统“收到消息即回复”的 ChatBot。

新的 Agent 入口应位于 `src/handlers/messageHandler.js` 的命令分发和链接处理之后：

1. 系统显式命令仍然由 `src/commands/index.js` 分发，保持确定性和可审计。
2. B 站链接、订阅、下载等原有功能仍走现有 handler/service，不让 Agent 抢占。
3. Agent 只接收剩余自然语言消息，先观察并更新记忆，再决定是否回复、反应、延迟或执行受限工具。
4. Agent 的自我管理能力只通过白名单业务工具暴露，不允许任意文件写入、shell、源码修改、动态 MCP 接入。

## 2. 从 Hermes Agent 借鉴的机制

参考目录：`~/.hermes/hermes-agent`。只借鉴架构思想，不复制实现。

### 2.1 MemoryManager / MemoryProvider

Hermes 的 `agent/memory_manager.py` 把记忆能力集中到一个 manager：

- Builtin provider 始终存在。
- 最多允许一个 external provider，避免工具 schema 膨胀和记忆后端冲突。
- 生命周期包含 `prefetch`、`queue_prefetch`、`sync_turn`、`on_pre_compress`、`on_session_end`。
- 记忆上下文被包在 `<memory-context>` 中，并明确声明“不是新的用户输入”。
- provider 输出会被清洗，避免用户伪造 memory-context 或 system note。

本项目可借鉴为：

- `AgentMemoryManager` 统一管理短期/长期记忆，不让回复生成器直接访问存储细节。
- 长期记忆初期只实现 builtin provider，后续如需向量库也最多接一个 provider。
- 注入 LLM 的记忆必须带 fence，防止群友通过聊天内容伪造系统上下文。

### 2.2 ContextEngine / ContextCompressor

Hermes 的 `agent/context_engine.py` 把上下文压缩从主流程中抽离：

- 单一 active context engine。
- 生命周期包含 `on_session_start`、`update_from_response`、`should_compress`、`compress`、`on_session_end`。
- 压缩不是简单截断，而是受 engine 策略控制。

本项目可借鉴为 `TopicContextEngine`：

- QQ 群聊不是单线对话，必须按话题分流。
- 每个群维护多个 active topics，每个 topic 有最近消息、参与者、摘要、活跃度和最后更新时间。
- 压缩对象应是“话题”，不是整个群最近 N 条消息。

### 2.3 PromptBuilder

Hermes 的 `agent/prompt_builder.py` 把 identity、platform hints、memory guidance、skills/context files 分段组装。

本项目可借鉴为：

- Persona、平台行为、群聊礼仪、权限边界、工具规则分块组装。
- 不把所有规则写成一个巨大 prompt。
- 加载任何用户可编辑文本作为上下文前，先做 prompt injection 扫描或转义。

### 2.4 Gateway Session / SessionContext

Hermes 的 gateway 层用 `SessionSource`、`SessionContext` 表达平台、chat_id、chat_type、user_id、thread_id、chat_topic，并支持 `shared_multi_user_session`。

本项目可借鉴为 `AgentSessionContext`：

- `platform`: `qq` / `onebot` / `napcat`
- `chatType`: `group` / `private`
- `groupId`、`userId`、`messageId`、`selfId`
- `topicId`: 话题分流后的上下文 ID
- `isSharedMultiUserSession`: 群聊恒为 true
- `actor`: 当前发言人的权限快照

### 2.5 ContextVar / AsyncLocalStorage

Hermes 的 `gateway/session_context.py` 使用 Python `ContextVar`，避免并发会话污染全局状态。

本项目是 Node.js，可用 `AsyncLocalStorage` 实现同类能力：

- 每条消息进入 Agent runtime 时绑定 `AgentSessionContext`。
- 日志、工具、记忆写入都从当前 async context 读取 trace/session 信息。
- 避免多个群并发处理时互相串 session、权限或 pending action。

### 2.6 File Safety / Hooks / Trajectory

Hermes 的 `agent/file_safety.py`、`agent/shell_hooks.py`、`agent/trajectory.py` 对本项目有三个启发：

- 不给 Agent 原始文件系统权限，只给业务工具；如果未来必须写文件，也必须有 safe root 和 denylist。
- 工具调用前需要统一 gate，可阻断高风险动作。
- 保存 agent run 轨迹，用于解释“为什么回/为什么不回/为什么调用工具”。

本项目可落地为：

- `permissionGate + riskPolicy + confirmationStore + auditLog`。
- `data/agent/runs/*.jsonl` 记录 observe、score、decision、toolPlan、toolResult。
- 轨迹默认不保存完整敏感内容，只保存摘要、分数、原因和 action ID。

## 3. 本项目新目录建议

```text
src/agent/
  index.js
  ingress/
    agentIngress.js
    messageNormalizer.js
    triggerDetector.js
  session/
    agentSessionContext.js
    actorResolver.js
  cognition/
    relevanceScorer.js
    replyDecision.js
    personaPolicy.js
    contextBuilder.js
  memory/
    memoryManager.js
    shortTermStore.js
    longTermStore.js
    topicContextEngine.js
    memoryConsolidator.js
  runtime/
    agentRuntime.js
    llmClient.js
    promptBuilder.js
    planner.js
    trajectoryRecorder.js
  tools/
    registry.js
    permissionGate.js
    riskPolicy.js
    confirmationStore.js
    configTools.js
    subscriptionTools.js
    groupTools.js
  config/
    agentConfig.js
    personaConfig.js
```

原则：

- 不恢复旧 `src/services/ai/**`。
- 不恢复旧 MCP manager。
- Agent 是新的一等模块，旧服务只通过白名单工具被调用。
- WebUI 的 Agent 配置后续应是“新 Agent 配置”，不要把旧 AI/MCP 面板加回来。

## 4. 消息处理流程

```mermaid
flowchart TD
  A[QQ/NapCat message] --> B[messageHandler 基础过滤]
  B --> C{私聊/群权限/黑名单/群启用}
  C -->|拒绝| X[return]
  C -->|允许| D[prepareIncomingMessageLinks]
  D --> E{显式系统命令?}
  E -->|是| F[commandManager.dispatch]
  F --> X
  E -->|否| G{B站/链接消息?}
  G -->|是| H[linkService.handleIncomingMessageLinks]
  H --> X
  G -->|否| I[agentIngress.observe]
  I --> J[更新短期记忆/话题]
  J --> K[relevanceScorer 打分]
  K --> L{replyDecision}
  L -->|observe_only| X
  L -->|react_only| M[表情/轻反馈]
  L -->|short/full reply| N[LLM 回复]
  L -->|tool_plan| O[受限工具规划]
  O --> P[permissionGate + confirmation]
  P --> Q[执行白名单业务工具]
```

## 5. 核心数据结构

### 5.1 AgentMessage

```js
{
  id: 'message_id',
  groupId: '123',
  userId: '456',
  selfId: '789',
  messageType: 'group',
  rawText: '...',
  segments: [],
  normalizedText: '...',
  mentionsSelf: false,
  replyToSelf: false,
  timestamp: 1710000000000,
  sender: {
    nickname: '...',
    card: '...',
    role: 'member|admin|owner|unknown'
  }
}
```

### 5.2 AgentSessionContext

```js
{
  platform: 'qq',
  groupId: '123',
  chatType: 'group',
  userId: '456',
  messageId: 'abc',
  topicId: 'topic_xxx',
  traceScope: '...',
  isSharedMultiUserSession: true,
  actor: {
    isRoot: false,
    isConfiguredGroupAdmin: false,
    qqRole: 'member',
    canManageGroupConfig: false,
    canManageSubscriptions: false,
    canManageGlobalConfig: false
  }
}
```

### 5.3 DecisionResult

```js
{
  action: 'observe_only|react_only|short_reply|full_reply|ask_clarify|tool_plan|defer',
  score: 0.72,
  reasons: ['mentioned_bot', 'topic_relevant', 'cooldown_ok'],
  penalties: ['crowded_chat'],
  topicId: 'topic_xxx',
  cooldownMs: 30000,
  toolIntent: null
}
```

### 5.4 MemoryItem

```js
{
  id: 'mem_xxx',
  scope: 'global|group|user|relation|topic',
  groupId: '123',
  userId: '456',
  type: 'fact|preference|relation|episode|persona',
  content: '...',
  confidence: 0.8,
  sourceMessageIds: ['...'],
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  expiresAt: null
}
```

### 5.5 PendingAction

```js
{
  id: 'act_xxx',
  groupId: '123',
  userId: '456',
  requestedBy: '456',
  toolName: 'subscription.add',
  args: {},
  risk: 'low|medium|high',
  requiredPermission: 'manage_subscriptions',
  status: 'pending|confirmed|cancelled|expired|executed',
  expiresAt: 1710000300000,
  originalMessageId: '...'
}
```

## 6. 回复准入策略

Agent 不应使用“概率回复”作为核心逻辑，而应先判断“这句话是否值得它参与”。

建议评分：

```text
replyScore =
  mentionScore
  + replyToBotScore
  + topicRelevanceScore
  + relationshipScore
  + conversationGapScore
  + valueScore
  + personaInterestScore
  - crowdingPenalty
  - interruptionPenalty
  - repetitionPenalty
  - cooldownPenalty
```

推荐动作：

- `observe_only`: 只记忆，不回复。默认动作。
- `react_only`: 发一个表情或轻反馈，不展开话题。
- `short_reply`: 一两句话参与。
- `full_reply`: 被明确询问、需要解释或总结时才使用。
- `ask_clarify`: 信息不足但确实需要跟进。
- `tool_plan`: 用户表达了配置/订阅/管理意图。
- `defer`: 当前群聊太拥挤或不适合插话，延后观察。

硬触发优先级：

1. @Bot、回复 Bot、明确叫 Bot 名字：允许进入较高回复评分，但仍受权限/冷却约束。
2. 明确系统命令：不进入 Agent，继续走 commandManager。
3. 链接消息：不进入 Agent，继续走 linkService。
4. 普通闲聊：除非与当前 topic/persona 强相关，否则 observe_only。

## 7. 记忆设计

### 7.1 短期记忆

存储建议：内存 + 定期落盘 JSON，Phase 1 不引入数据库。

每个群维护：

- 最近消息窗口：例如 100 条或 30 分钟。
- 活跃话题：topicId、summary、participants、lastActiveAt、messageIds。
- Bot 状态：最近回复时间、最近被 @ 时间、冷却、正在等待确认的 action。
- 群聊节奏：单位时间消息数、活跃人数、是否拥挤。

关键点：

- 群聊人数多时，不能只按时间线拼上下文。
- 新消息必须先归入 topic，再由 topic 取上下文。
- Bot 回复应引用当前 topic，而不是整个群最近消息。

### 7.2 长期记忆

Phase 2 建议用 SQLite：

- `agent_memories`: 结构化记忆。
- `agent_memory_sources`: 记忆来源消息。
- `agent_relations`: 用户关系和偏好。
- `agent_topic_summaries`: 群话题摘要。
- FTS5：先支持关键词检索，暂不引入 embedding。

不建议一开始就做向量库：

- 当前更关键的是准入策略、话题分流、权限安全。
- embedding 会增加依赖、配置、隐私和调试成本。
- 等 Phase 2 稳定后再评估是否加入。

## 8. 自我管理与工具边界

Agent 可以“管理 Bot”，但只能通过业务工具，不能直接改源码或执行命令。

允许工具示例：

- `group.enableFeature(groupId, featureName)`
- `group.disableFeature(groupId, featureName)`
- `group.setDownloadEnabled(groupId, enabled)`
- `subscription.add(groupId, uid)`
- `subscription.remove(groupId, uid)`
- `subscription.list(groupId)`
- `blacklist.addGroupUser(groupId, userId)`
- `blacklist.removeGroupUser(groupId, userId)`
- `config.setGroupAdmin(groupId, userId)`
- `config.unsetGroupAdmin(groupId, userId)`

禁止能力：

- 任意 shell。
- 任意文件读写。
- 修改 `src/**`、`package.json`、`Dockerfile`、`docker-compose.yml`。
- 修改 `.env` 中密钥类字段。
- 动态加载 MCP server。
- 任意 HTTP 请求。
- 读取本机敏感路径。

工具实现原则：

- 复用现有 service/config 方法，避免 Agent 自己写 JSON 文件。
- 复用 Dashboard API 的校验规则，或把校验逻辑抽到共享 service。
- 每次工具执行写审计日志：谁、在哪个群、为什么、执行了什么、结果如何。

## 9. 权限模型

权限来源分四层：

| Level | 来源 | 能力 |
| --- | --- | --- |
| 0 | 普通群成员 | 聊天、查询、提出请求 |
| 1 | `config.groupConfigs[groupId].admins` | 管理本群 Bot 配置、订阅 |
| 2 | QQ 群管理员/群主 | 基于 QQ 权限管理本群配置 |
| 3 | `ADMIN_QQ` Root Admin | 全局配置、跨群管理、高风险操作 |

需要新增 `actorResolver`：

- 从现有 `config.isRootAdmin(userId)` 判断 root。
- 从现有 `config.isGroupAdmin(groupId, userId)` 判断配置管理员。
- 从 NapCat/OneBot `messageData.sender.role` 判断 QQ 角色。
- 如果 `sender.role` 缺失，再考虑通过 OneBot API 查询群成员信息。

权限判断建议：

- `canManageSubscriptions`: root、配置群管理员、QQ 管理员/群主。
- `canManageGroupConfig`: root、配置群管理员、QQ 管理员/群主。
- `canManageGlobalConfig`: root only。
- `canExecuteHighRisk`: root 或 QQ 群主/管理员 + 二次确认，具体看 action。

## 10. 风险与确认机制

按风险分级：

- Low：查询类、解释类、列出订阅、列出配置。可直接执行。
- Medium：新增/删除订阅、修改本群普通功能开关。需要“确认/取消”。
- High：关闭整个群 Bot、移除管理员、拉黑、全局配置。需要更高权限 + 明确确认。

确认流程：

1. Agent 识别工具意图，但不立即执行 medium/high。
2. 创建 `PendingAction`，回复用户“将执行 X，回复 确认/取消”。
3. 后续消息先进入 `confirmationStore.tryConsume()`。
4. 确认消息必须同群、同用户、未过期、权限仍满足。
5. 执行后写审计日志和 trajectory。

## 11. WebUI 关系

旧 AI/MCP 配置已经移除，暂时不要恢复。

新 Agent 的 WebUI 应分阶段加入：

- Phase 1：无 WebUI，只通过配置文件开关和日志观察。
- Phase 2：只读观测页，展示 Agent 决策统计、observe/reply 比例、最近拒绝回复原因。
- Phase 3：可配置 persona、每群 Agent 开关、冷却参数、工具权限策略。
- Phase 4：记忆管理页，允许 root 查看/删除/禁用记忆条目。

WebUI 不应提供 MCP 配置入口。

## 12. 实施路线

### Phase 1：只观察，不回复

目标：安全接入，不影响现有功能。

范围：

- 新增 `src/agent` 基础目录。
- 在 `messageHandler` 命令和链接之后调用 `agentIngress.observe()`。
- 实现 `messageNormalizer`、`actorResolver`、`shortTermStore`、`relevanceScorer`。
- 只输出日志和 trajectory，不发消息、不调用 LLM、不改配置。

验收：

- 原命令、链接、订阅、下载行为不变。
- 群聊普通消息会记录 observe/score/decision。
- 默认 decision 基本为 `observe_only`。

### Phase 2：回复准入 + 人格短回复

目标：只在高相关场景下回复。

范围：

- 引入 `llmClient` 和 `promptBuilder`。
- 支持 @Bot、回复 Bot、昵称触发。
- 实现冷却、拥挤惩罚、重复惩罚。
- 只允许 `short_reply` / `full_reply`，不开放工具。

验收：

- 不会每条消息都回。
- 高并发群聊中能稳定沉默。
- 被明确询问时能结合短期话题上下文回答。

### Phase 3：长期记忆

目标：降低群聊混乱和重复自我介绍。

范围：

- SQLite 长期记忆。
- 话题摘要定期固化。
- 用户偏好、关系、事实、episode 分表或分 type 存储。
- 记忆提取和遗忘机制。

验收：

- 能记住稳定偏好，不把不同用户混淆。
- 能解释记忆来源和置信度。
- root 可清理错误记忆。

### Phase 4：受限工具与自我管理

目标：让 Agent 通过自然语言管理 Bot 的部分业务配置。

范围：

- `tools/registry`。
- `permissionGate`、`riskPolicy`、`confirmationStore`。
- 订阅、群配置、黑名单等工具。
- 审计日志。

验收：

- 普通用户不能越权管理。
- QQ 管理员/群主可管理本群配置。
- 高风险动作必须确认。
- Agent 不能修改程序本身。

### Phase 5：WebUI Agent 管理

目标：可视化观测和配置。

范围：

- Agent 开关。
- Persona 参数。
- 决策日志。
- 记忆管理。
- 工具权限策略。

验收：

- WebUI 只展示新 Agent，不恢复旧 AI/MCP。
- 支持 root 审核 Agent 行为。

## 13. 最小配置建议

Phase 1 配置应尽量少：

```json
{
  "agent": {
    "enabled": false,
    "observeOnly": true,
    "logTrajectory": true,
    "defaultGroupEnabled": false,
    "shortTerm": {
      "maxRecentMessagesPerGroup": 100,
      "topicIdleMs": 1800000
    }
  }
}
```

说明：

- `enabled: false`：默认不启用，避免影响当前生产行为。
- `observeOnly: true`：第一阶段只观察。
- `defaultGroupEnabled: false`：每群显式开启。
- 不在 Phase 1 增加 LLM key。

## 14. 验证计划

每个阶段都要保护现有能力：

- `messageHandler` 单元测试：命令优先、链接优先、黑名单、群禁用逻辑不变。
- Agent Phase 1 测试：普通消息进入 observe，命令/链接不进入或只标记 ignored_by_system_handler。
- 权限测试：root、配置群管理员、QQ 管理员、普通成员分别覆盖。
- 确认测试：同用户确认、不同用户确认、过期确认、权限变化后确认。
- 工具测试：只调用白名单 service，不直接写源码/执行 shell。
- Dashboard 回归：旧 AI/MCP 面板不回归，新 Agent 页面后续单独实现。

## 15. 主要风险

- 群聊话题分流难度高：应先用规则 + 最近窗口，不急着上复杂语义聚类。
- LLM 回复容易过度积极：必须先实现准入策略和冷却，再接 LLM。
- 自我管理存在越权风险：必须先有 actorResolver、permissionGate、confirmationStore。
- 长期记忆可能污染：必须有来源、置信度、过期、删除机制。
- WebUI 过早配置化会拖慢核心闭环：应先跑 observe 日志验证决策质量。

## 16. 推荐下一步

建议下一步只实现 Phase 1：`Agent Ingress + Observer + ShortTermStore + RelevanceScorer`，不接 LLM、不发消息、不开放工具。

这样可以在真实群聊流量里观察：

- 哪些消息被判定为和 Bot 相关。
- 哪些场景应该沉默。
- 群聊拥挤时打分是否下降。
- 话题分流是否足够稳定。

等 Phase 1 日志质量稳定后，再进入 Phase 2 接 LLM 回复。
