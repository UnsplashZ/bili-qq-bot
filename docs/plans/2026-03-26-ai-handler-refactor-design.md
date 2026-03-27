# aiHandler 重构方案

## Context

当前 `src/handlers/aiHandler.js` 同时承担了消息清洗、身份意图判断、Turn Facts 构建、RAG 与画像增强、Prompt 组装、LLM 请求与 Tool Loop、回复保护、上下文写回与向量记忆写回等多类职责。

最近链接链路已经完成职责下沉，`linkHandler` 更接近薄入口；相比之下，`aiHandler` 仍然是 AI 主链路中的重型文件，`getReply()` 单函数承载了过多策略与副作用，继续在此叠加能力会提高回归风险与维护成本。

本方案的目标不是重写 AI 系统，而是在不改变外部行为与配置语义的前提下，完成一次边界清晰、可逐步迁移的结构性重构。

## Problem

当前实现的主要问题：

1. `src/handlers/aiHandler.js` 职责过载，编排、策略、基础设施和持久化副作用混杂。
2. `getReply()` 过长，阅读、定位和验证成本高，任何新增能力都容易继续膨胀该函数。
3. Prompt 构建存在双轨路径：
   - 非结构化路径直接在 `aiHandler.js` 内组装
   - 结构化路径部分委托给 `src/services/ai/promptAssemblerService.js`
   这会让规则、注入内容和格式要求逐步漂移。
4. RAG、画像、Tool Loop、回复保护等逻辑彼此耦合，难以为单点行为编写稳定测试。
5. 回复持久化与生成逻辑耦合，未来若要增加幂等、审计或降级处理会被主流程牵制。

## Goals

### Primary goals

1. 将 `aiHandler` 收敛为薄入口，主回复流程下沉到 `src/services/ai/`。
2. 拆开策略逻辑、消息整形、增强逻辑、LLM 交互、持久化副作用。
3. 为后续 AI 能力迭代提供稳定扩展点，避免继续向 `getReply()` 堆逻辑。
4. 保持现有外部接口、配置项语义和主要回复行为不变。

### Non-goals

1. 不重做 `messageHandler.js` 的 reply gating 流程。
2. 不修改 `pipelineInput` 的外部数据结构。
3. 不重做 `mcpManager`、向量库实现或用户画像生成机制。
4. 不顺手新增功能或更改默认提示词策略。

## Recommended approach

采用“编排下沉型”重构：保留 `aiHandler` 作为对外兼容入口，新增 `replyOrchestratorService` 作为单轮回复总编排器，并将专项职责拆到独立 AI service。

选择该方案的原因：

- 比仅抽少量 helper 更能解决边界混乱问题。
- 比完整阶段流水线改造更克制，能控制改动范围。
- 与当前项目中链接链路的演进方向一致，便于后续维护。

## Alternatives considered

### 方案 A：轻量整理型

只从 `aiHandler.js` 中抽取部分 helper，不改变整体主流程位置。

- 优点：改动最小，短期风险低。
- 缺点：`aiHandler` 仍然偏重，后续容易继续膨胀。
- 结论：适合临时止血，不适合作为本次目标方案。

### 方案 C：完整流水线型

将回复过程改造成严格的 prepare/build/execute/finalize 阶段流水线。

- 优点：流程最清晰，后续 tracing 与 A/B 更容易。
- 缺点：设计偏重，当前代码基础上容易超出本次合理范围。
- 结论：可作为未来演进方向，不作为本次首轮重构方案。

## Target architecture

### 1. 保留的入口层

#### `src/handlers/aiHandler.js`

重构后只保留：

- `getReply(message, userId, groupId, traceId, pipelineInput)`
- `shouldReply(message, isAt, groupId)`
- `addMessageToContext(...)`
- `resetContext(groupId)`
- 少量日志包装

其中 `getReply()` 只负责将请求转交给 `replyOrchestratorService.generateReply()`。

### 2. 新增总编排层

#### `src/services/ai/replyOrchestratorService.js`

职责：

1. 读取运行配置和上下文
2. 规范化当前轮输入
3. 调用身份/策略服务得到 intent 与 facts
4. 调用增强服务获取 memories / profile
5. 调用 Prompt 组装服务生成最终 messages
6. 调用 LLM 聊天服务执行 Tool Loop
7. 应用管理动作保护等回复后置规则
8. 调用持久化服务写回 context 与 vector memory

建议导出接口：

```javascript
async function generateReply({
    message,
    userId,
    groupId,
    traceId,
    pipelineInput
})
```

### 3. 新增专项服务边界

#### `src/services/ai/messageSanitizerService.js`

负责：

- `sanitizeMessage`
- `markUserMessage`
- `sanitizeName`
- `_escapeTagValue`
- `_normalizeId`

目标：统一消息清洗、标签值转义和消息 datamarking 规则，供 prompt 组装与历史消息格式化复用。

#### `src/services/ai/identityPolicyService.js`

负责：

- `detectIdentityIntent`
- `getSpeakerId`
- `getSpeakerName`
- `getMentionIds`
- `buildSpeakerTag`
- `buildTurnFacts`
- `buildAdminNoToolReply`
- `applyAdminActionGuard`

目标：把“身份、事实、权限约束”从 LLM 调用流程中拆开，独立管理策略规则。

#### `src/services/ai/retrievalAugmentService.js`

负责：

- `getRagSearchOptions`
- RAG 检索开关与策略判断
- profile 注入准备
- 将增强结果整理为统一输出对象

建议返回结构：

```javascript
{
    memories,
    profileText,
    ragEnabled,
    promptFragments
}
```

目标：统一管理记忆增强输入，减少主流程中的条件分支。

#### `src/services/ai/llmChatService.js`

负责：

- API 配置读取后的聊天请求执行
- timeout 计算
- request payload 组装
- tool loop
- empty reply retry
- 统一返回 `reply` 与 `hasToolResult`

建议返回结构：

```javascript
{
    reply,
    hasToolResult,
    rawMessages
}
```

目标：把模型交互与工具执行循环收拢到基础设施层，便于测试超时、空回复、工具错误等路径。

#### `src/services/ai/replyPersistenceService.js`

负责：

- assistant 回复写入 `aiContextService`
- assistant 回复写入 `vectorMemoryService`
- 未来承接幂等、审计或降级策略

建议接口：

```javascript
async function persistAssistantReply({
    contextKey,
    groupId,
    reply,
    traceId
})
```

## Prompt assembly strategy

本次重构需要同时解决 Prompt 双轨问题。

### 当前问题

目前存在两条路径：

1. 非结构化上下文：在 `aiHandler.js` 内直接拼装 `systemPrompt` 和 `messages`
2. 结构化上下文：通过 `promptAssemblerService` 组装部分消息

这会造成：

- 规则只补一边
- 记忆/画像/Turn Facts 注入位置逐步漂移
- 调试时难以确定两种模式的真正差异

### 目标方案

统一收口到 `src/services/ai/promptAssemblerService.js`：

- `replyOrchestratorService` 只准备规范化输入
- `promptAssemblerService` 负责生成最终 `messages`
- 即使关闭结构化上下文，也仍使用同一 assembler，只是输入字段不同

需要保证以下内容都只在一处定义或装配：

- `CORE_INSTRUCTIONS`
- 时间指令
- conversation policy
- bot facts
- turn facts
- memories/profile 注入
- datamarking 规则

## Detailed implementation plan

### Phase 1：抽离纯工具与策略，不改变行为

目标：先做“纯搬运”，不改变现有对外行为。

1. 新建 `messageSanitizerService.js`
2. 新建 `identityPolicyService.js`
3. 将 `aiHandler.js` 中对应方法迁移过去
4. `aiHandler.js` 先改为调用新 service，但保留原主流程结构
5. 为这些纯函数补单元测试

完成标志：

- `aiHandler.js` 中不再直接保存消息清洗与身份策略实现
- 相关测试可直接针对 service 断言

### Phase 2：抽离增强与持久化副作用

目标：减少 `getReply()` 中的业务分叉和副作用。

1. 新建 `retrievalAugmentService.js`
2. 迁移 RAG 与 profile 准备逻辑
3. 新建 `replyPersistenceService.js`
4. 迁移 assistant 上下文写回与向量记忆写回逻辑
5. 保证异常只记录日志，不改变当前失败降级语义

完成标志：

- `getReply()` 中不再直接拼装 memories/profile 文本
- `getReply()` 中不再直接落库 assistant reply

### Phase 3：抽离 LLM Tool Loop

目标：把最复杂的基础设施逻辑从 handler 中移出。

1. 新建 `llmChatService.js`
2. 迁移 timeout 计算、payload 组装、API 调用、tool loop、empty reply retry
3. 保持现有 `MAX_LOOPS`、重试策略和日志语义
4. 为超时、空回复、tool error 路径补测试

完成标志：

- `aiHandler.js` 或 orchestrator 中不再出现 axios 请求细节
- Tool Loop 的输出通过统一结果对象返回

### Phase 4：引入 `replyOrchestratorService`

目标：让 handler 变成薄入口。

1. 新建 `replyOrchestratorService.js`
2. 将上下文读取、策略服务调用、增强调用、Prompt 组装、LLM 调用、guard、持久化串起来
3. `aiHandler.getReply()` 改为简单转调 orchestrator
4. 保留 `shouldReply()` 在 handler 中，不扩大这次范围

完成标志：

- `src/handlers/aiHandler.js` 成为薄入口文件
- 主逻辑位于 `src/services/ai/` 下

### Phase 5：统一 Prompt 组装路径

目标：消除双轨 Prompt 构建。

1. 扩展 `promptAssemblerService.js`，使其支持结构化/非结构化两类输入
2. 将 `CORE_INSTRUCTIONS`、时间指令、facts 注入、增强片段装配收口到 assembler
3. 移除 `aiHandler.js` 中直接构建 messages 的分支
4. 回归验证结构化上下文开关两条路径的行为一致性

完成标志：

- 所有最终 `messages` 都由 `promptAssemblerService` 输出
- Prompt 规则只有一个收口点

## File change map

### New files

- `src/services/ai/messageSanitizerService.js`
- `src/services/ai/identityPolicyService.js`
- `src/services/ai/retrievalAugmentService.js`
- `src/services/ai/llmChatService.js`
- `src/services/ai/replyPersistenceService.js`
- `src/services/ai/replyOrchestratorService.js`

### Modified files

- `src/handlers/aiHandler.js`
- `src/services/ai/promptAssemblerService.js`

### Test files

建议新增或补充：

- `test/unit/ai/messageSanitizerService.test.js`
- `test/unit/ai/identityPolicyService.test.js`
- `test/unit/ai/retrievalAugmentService.test.js`
- `test/unit/ai/llmChatService.test.js`
- `test/unit/ai/replyOrchestratorService.test.js`

如果项目已有相关 AI 测试文件，也可以合并到现有测试组织中，但应保持 service 级边界清晰。

## Test strategy

### Unit tests

至少覆盖以下行为：

1. 身份意图识别
   - `我是谁`
   - `你是谁`
   - 管理动作相关表达
   - 避免将“我是来测试的”误判为身份声明

2. 消息清洗与 datamarking
   - CQ 码清洗
   - `@` 保留为 `<AT:...>`
   - 多行消息 `> ` 标记一致

3. Turn Facts 与 speaker tag 构建
   - 群聊 / 私聊 source
   - replyToBot / mention bot 判断
   - owner_id 与 current_speaker_id 规则

4. RAG 策略
   - `self_identity` 在 strict/normal 下的不同选项
   - `bot_identity` 的禁用或限制
   - `admin_action` 的 crossUserPenalty

5. Tool Loop
   - timeout 计算
   - 工具成功
   - 工具失败
   - 空回复重试
   - 超过最大循环次数

6. Reply guard 与持久化
   - 无 tool result 时 admin action reply 被替换
   - assistant reply 成功写入 context 与 vector memory

### Regression checks

完成重构后至少执行：

```bash
npm test
```

如果 AI 相关代码已有可单跑测试文件，应优先补充并执行定向测试，避免只依赖全量回归。

## Risks and mitigations

### Risk 1：Prompt 行为漂移

**表现：** 重构后回复语气、注入顺序或工具触发条件发生变化。

**Mitigation：**

- Phase 1-4 先做纯搬运，避免在拆分时顺手重写规则
- 先让原逻辑通过新 service 承载，再统一 Prompt 路径
- 对关键 Prompt 片段做快照式断言或结构断言

### Risk 2：Tool Loop 回归

**表现：** 工具调用次数、超时或空回复补偿逻辑发生变化。

**Mitigation：**

- 在迁移到 `llmChatService` 前先梳理当前行为为测试用例
- 保留 `MAX_LOOPS` 和 empty retry 语义不变
- 只移动逻辑，不提前优化策略

### Risk 3：副作用执行时机改变

**表现：** assistant 回复未写入 context，或 vector memory 写入重复/缺失。

**Mitigation：**

- 将持久化集中到 `replyPersistenceService`
- 明确只在最终 reply 生成后执行写回
- 为持久化调用次数增加测试断言

### Risk 4：范围失控

**表现：** 重构过程中顺手改动 message pipeline、MCP 或 profile 机制，导致本次任务膨胀。

**Mitigation：**

- 严格限制在 `aiHandler` 及其直接依赖边界内
- 不修改 `messageHandler.js` 的主流程
- 不调整 `pipelineInput` 的外部契约

## Success criteria

满足以下条件即可认为重构达成目标：

1. `src/handlers/aiHandler.js` 明显收敛为薄入口文件。
2. 生成回复的主流程位于 `src/services/ai/replyOrchestratorService.js`。
3. 消息清洗、身份策略、增强逻辑、LLM 交互、持久化副作用具备独立边界。
4. `promptAssemblerService` 成为最终消息组装的唯一收口点。
5. 关键 AI 行为存在独立单元测试，并通过 `npm test`。
6. 对外接口、配置项语义和用户可感知行为不发生非预期变化。

## Recommended execution order

推荐按以下顺序落地，避免一次性大爆炸迁移：

1. `messageSanitizerService`
2. `identityPolicyService`
3. `retrievalAugmentService`
4. `replyPersistenceService`
5. `llmChatService`
6. `replyOrchestratorService`
7. `promptAssemblerService` 统一收口
8. 全量回归与定向测试

该顺序优先拆低风险纯逻辑，再拆高风险 Tool Loop，最后统一 Prompt 路径，便于逐步控制回归面。
