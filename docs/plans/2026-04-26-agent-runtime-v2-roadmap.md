# Agent Runtime V2 Roadmap

> 日期：2026-04-26  
> 分支：`feat/ai-agent-runtime`  
> 目标：整理当前 Agent 全部待办，重新确定后续开发路线；在已有 Phase 1-8 能力基础上，进入 Runtime V2 架构收敛阶段。

## 1. 当前结论

当前 Agent 已经不是早期“聊天回复功能”，而是具备以下能力的 QQ 群聊 Agent：

- 群聊自然语言进入 Agent，由 LLM 判断回复、沉默、延迟或工具调用。
- 显式命令和 B 站链接仍走确定性系统链路，不交给 LLM 抢占。
- 支持长期记忆、短期上下文、话题摘要、记忆提取和记忆管理。
- 支持白名单工具、自我管理、权限闸门、风险分级、确认短码和审计日志。
- 支持 B 站查询、订阅管理、Bot/Agent 配置查询和修改。
- 支持 QQ 群管理、加群/好友审批、在线状态、输入状态。
- 支持受限只读浏览器工具和显式自学习工具。
- 支持 WebUI 的 Agent 配置、轨迹查看、记忆管理和工具观测。

但当前实现仍然偏“功能逐步叠加”，下一步重点不应继续堆新工具，而应把 Agent Runtime 整理成稳定、可扩展、可观测、可长期运行的架构。

## 2. 已完成范围

### 2.1 Phase 1：观察入口

状态：完成。

- Agent 入口接入消息链路。
- 命令、链接、黑名单、群禁用等硬边界保留。
- 普通自然语言进入观察流程。
- 短期记忆、话题上下文、基础 trajectory 已接入。

### 2.2 Phase 1.5：LLM 影子决策

状态：完成。

- OpenAI-compatible LLM client 已接入。
- 支持结构化 JSON 决策。
- 支持 LLM JSON 解析失败修复重试。
- 决策失败降级为 `observe_only`。
- message traits 只作为上下文，不替 Agent 硬裁决自然语言。

### 2.3 Phase 2：回复发送闸门

状态：完成。

- 支持 `short_reply`、`full_reply`、`ask_clarify`。
- 支持 `sendEnabled`、`observeOnly`、冷却、重复回复拦截。
- 明确 @Bot / 回复 Bot / 叫昵称能进入强相关回复路径。
- 工具结果可回灌 LLM 生成自然语言最终回复。

### 2.4 Phase 3：长期记忆

状态：完成。

- 文件型长期记忆存储已实现。
- LLM `memoryHints` 写入已实现。
- 规则兜底记忆提取已实现。
- 记忆检索注入 prompt 已实现。
- 记忆冲突覆盖、重要性评分、访问统计、自动过期已实现。
- Root 记忆命令和 WebUI 记忆管理已实现。

### 2.5 Phase 4：受限工具和自我管理

状态：完成。

- 白名单工具注册表已实现。
- `permissionGate`、风险分级、确认短码、审计日志已实现。
- 中高风险工具默认确认。
- 高风险确认不可被 WebUI 关闭。
- 工具执行与普通发言门禁已拆分，允许 Agent 通过工具恢复自身可用状态。

### 2.6 Phase 5：WebUI Agent 管理

状态：完成。

- Agent 配置页已实现。
- 决策轨迹页已实现。
- 记忆管理页已实现。
- 工具确认、工具结果、权限拒绝、发送结果可观测。
- 旧 AI/MCP 配置没有恢复。

### 2.7 Phase 6：可靠性和实测收口

状态：大部分完成，仍需文档和实测矩阵收尾。

- Docker 本地构建启动已多轮验证。
- QQ 实测覆盖过 @Bot、普通聊天、工具确认、记忆、上下文、群管等关键路径。
- 多个 review 问题已修复。
- 仍需要把最终测试清单、README 使用说明、安全边界同步到文档。

### 2.8 Phase 7：领域工具和工具结果闭环

状态：功能已落地，计划文档需补齐。

- B 站用户查询已实现。
- B 站视频查询已实现。
- 群订阅状态查询已实现。
- 群 Agent 配置查询已实现。
- 工具执行结果回灌 LLM 最终回复已实现。

### 2.9 Phase 8：QQ 管理、浏览器、自学习

状态：功能已落地，仍需实测矩阵补齐。

- QQ 群信息、禁言列表、精华消息、公告、系统消息查询已实现。
- QQ 成员查询、搜索、禁言、解禁、踢人、改群名片已实现。
- 全员禁言、撤回消息、设置/取消精华已实现。
- 加群申请和好友申请处理已实现。
- Bot 在线状态和输入状态工具已实现。
- 受限 `browser.read_url` 已实现，带 SSRF 和内网防护。
- `agent.learn_memory` 显式学习工具已实现。

## 3. 当前全部待办

### 3.1 P0：必须先完成

1. 更新总计划文档，把 Phase 7/8 已完成能力补入主线。
2. 更新 README，说明新 Agent 配置、环境变量、WebUI 页面、QQ 实测方式和安全边界。
3. 补齐 QQ 实测矩阵记录：
   - @Bot 必须回复。
   - 回复 Bot 的上下文追问。
   - 普通自然语言低频参与。
   - 记忆自动提取和显式学习。
   - 订阅查询、新增、删除、确认、取消。
   - Agent 开关、发言开关、观察模式开关。
   - QQ 管理：禁言、解禁、撤回、精华、成员搜索。
   - 加群申请、好友申请、在线状态、输入状态。
   - 越权用户触发工具应被拒绝。
   - 高风险工具必须短码确认。
4. 对现有 Agent 单测跑一次完整回归。
5. 对 Docker 本地构建启动流程再验证一次，确认不会拉取远端 `bili-qq-bot` 镜像。

### 3.2 P1：Runtime V2 架构收敛

1. 抽象 `AgentRunner`：
   - 每条 QQ 消息对应一个 `RunState`。
   - Runner 负责串联 context、LLM、policy、tool、confirmation、reply。
   - `agentIngress` 只负责接入和硬边界。
2. 升级工具注册表为 `ToolSpec V2`：
   - `paramsSchema`
   - `resultSchema`
   - `risk`
   - `permission`
   - `sideEffect`
   - `timeoutMs`
   - `guardrails`
   - `outputTrimmer`
3. 拆分 guardrail 管线：
   - input guardrail：黑名单、群禁用、命令/链接绕过、预算限制。
   - decision guardrail：JSON schema、action 合法性、confidence、replyDraft。
   - tool guardrail：权限、风险、确认、参数合法性、目标可信来源。
   - output guardrail：最终回复长度、敏感信息、执行状态一致性。
4. 统一工具超时、错误码和用户可见错误：
   - 工具失败不能打断主消息链路。
   - 工具错误要能在 Dashboard 解释。
   - LLM 最终回复不能声称执行了失败工具。

### 3.3 P1：上下文和记忆治理

1. 把现有 relevance window 正式整理为：
   - `SessionStore`
   - `ContextSelector`
   - `ContextCompactor`
   - `MemoryRetriever`
2. 增加上下文预算配置：
   - `maxContextMessages`
   - `maxContextChars`
   - `maxMemoryItems`
   - `maxToolDefinitions`
3. 增加话题级摘要压缩：
   - 多人群聊不要只靠最近 N 条。
   - 回复链、同话题、Bot 自身发言、同用户发言优先。
4. 继续加强记忆污染治理：
   - 敏感字段过滤。
   - prompt injection 转义。
   - 低置信度记忆降权。
   - 过期记忆自动清理。
   - 冲突记忆保留来源和更新轨迹。

### 3.4 P1：Trace Span 可观测性

1. 将 trajectory 升级为 span 模型：
   - `message_received`
   - `input_guardrail`
   - `context_selected`
   - `llm_decision`
   - `decision_guardrail`
   - `tool_plan`
   - `tool_guardrail`
   - `tool_confirmation`
   - `tool_execute`
   - `tool_result_reply`
   - `output_guardrail`
   - `reply_sent`
2. Dashboard 决策页支持按 span 类型过滤。
3. 每条最终回复能回溯：
   - 用了哪些上下文。
   - 命中了哪些记忆。
   - 为什么调用工具。
   - 为什么要求确认。
   - 为什么拒绝或沉默。

### 3.5 P2：Specialist Agents / Handoff

1. 主 Agent 保持群聊人格、上下文判断和路由能力。
2. 拆出领域 Agent：
   - `bili_agent`：B 站查询、订阅状态、订阅管理解释。
   - `qq_admin_agent`：群管理、成员定位、申请处理。
   - `memory_agent`：记忆写入、检索、清理、冲突解释。
   - `browser_agent`：网页读取、摘要、来源说明。
3. Handoff 仍然不能绕过工具权限：
   - specialist 只返回 tool intent 或领域结论。
   - 实际工具执行仍由统一 `ToolRunner + permissionGate` 处理。

### 3.6 P2：能力扩展候选

以下不建议立刻做，除非 Runtime V2 收敛后再排期：

1. 网页搜索工具：
   - 只读。
   - 强制来源记录。
   - 不把搜索摘要当确定事实。
2. 更完整的浏览器 Agent：
   - 只读 snapshot。
   - 禁止登录态操作、表单提交、下载文件、执行任意脚本。
   - 每群/全局开关、限流、审计。
3. SQLite / FTS5 记忆后端：
   - 替代 JSON 文件。
   - 支持更强检索、分页、统计和维护。
4. embedding / 向量检索：
   - 仅在 FTS5 和话题摘要不足后评估。
   - 需要明确隐私、成本和运维策略。

## 4. 推荐新阶段划分

### Phase 9：文档和实测收口

目标：把当前功能状态、使用方式和测试矩阵补齐，避免“代码已实现但不可运营”。

范围：

- 更新主计划文档 Phase 7/8 状态。
- 更新 README 的 Agent 配置和安全说明。
- 输出 QQ 实测矩阵。
- 跑 Agent 相关单测。
- 本地 Docker 构建启动验证。

验收：

- 用户可以按 README 开启 Agent。
- 用户知道哪些能力需要 root、群管、确认。
- 实测项有明确通过/待验证记录。

### Phase 10：Agent Runner 重构

目标：把当前 `agentIngress` 中的长流程拆成可维护 Runtime。

状态：已完成首轮行为保持型重构。

范围：

- 新增 `src/agent/runtime/agentRunner.js`。
- 新增 `src/agent/runtime/runState.js`。
- `agentIngress` 只做归一化、硬边界和调用 Runner。
- 保持现有外部行为和测试结果不变。

当前进展：

- 已新增 `AgentRunState`，集中保存一次 Agent run 的上下文、消息、配置、actor、短期观察和 session。
- 已新增 `AgentRunner`，承接 LLM 决策、工具确认、工具执行、记忆写入、policy、回复和 trajectory。
- `agentIngress` 已收敛为入口适配器：配置判断、消息归一化、回复目标解析、actor 解析、短期记忆观察和调用 Runner。
- Agent 相关单测已通过，外部行为保持不变。

验收：

- 现有 Agent 单测全部通过。
- QQ 实测行为无明显变化。
- 后续 confirmation resume、trace span、handoff 可以基于 `RunState` 扩展。

### Phase 11：ToolSpec V2 和 Guardrails

目标：让工具能力从“能跑”变成“可验证、可审计、可扩展”。

状态：已完成 ToolSpec 元数据、只读工具超时、首轮 tool guardrail、decision guardrail 和 output guardrail；input guardrail/span 化仍待继续。

范围：

- 给所有工具补 `paramsSchema`。
- 给高风险工具补目标可信来源校验说明。
- 给工具补统一 timeout。
- 给工具补结果摘要和错误码。
- 拆出 input/decision/tool/output guardrail。

当前进展：

- 所有白名单工具已具备 `paramsSchema`、`resultSchema`、`sideEffect`、`timeoutMs`、`guardrails` 元数据。
- `listToolDefinitions()` 已向 LLM 暴露工具 schema、sideEffect、timeout 和 guardrail 标签。
- 工具执行仍复用原 `normalizeArgs` / `execute`，但只读/外部读取工具已通过 `timeoutMs` 限制执行耗时；写操作不做 Promise 级超时，避免出现“返回超时失败但实际已执行”的状态歧义。
- 已新增 `toolGuardrails`，把权限、目标用户、目标消息、审批目标、Bot 管理员要求、`get_msg` 发送人校验等要求输出为结构化检查结果。
- `processToolPlan` 和确认恢复链路都会重新执行 tool guardrail，并把阻断原因写入审计和结果对象。
- 已新增 `decisionGuardrails`，把 LLM 决策可用性、action 合法性、confidence 范围、tool intent 一致性输出为结构化检查结果。
- 已新增 `outputGuardrails`，在发送前执行回复长度收敛和疑似密钥泄漏阻断。
- 已补单测校验所有工具必须暴露 ToolSpec 元数据、工具执行超时错误、tool/decision/output guardrail 结构化结果。

验收：

- LLM 传错参数时不会进入 service 层。
- 高风险工具不能靠 LLM 伪造目标绕过权限。
- Dashboard 能展示 guardrail 阻断原因。

### Phase 12：Session / Context / Memory V2

目标：解决群聊上下文“前言不搭后语”和长期记忆污染风险。

范围：

- 建立 `SessionStore`。
- 抽出 `ContextSelector`。
- 抽出 `ContextCompactor`。
- 记忆检索与上下文选择分层。
- 增加配置化上下文预算。

验收：

- 回复链追问能稳定引用 Bot 前文。
- 多人群聊不会把无关话题拼进回答。
- 长期记忆不会覆盖系统规则。
- 记忆来源和置信度可解释。

### Phase 13：Trace Span 和 Dashboard V2

目标：把 Agent 每次行为变成可解释运行轨迹。

范围：

- trajectory 存储兼容升级为 span。
- Dashboard 支持 span 时间线。
- 支持按 traceId、groupId、action、tool、spanType、error 过滤。

验收：

- 一条 QQ 消息能看到完整执行链。
- 工具确认和执行结果能关联到原始消息。
- 沉默、拒绝、越权、失败都有可解释原因。

### Phase 14：Specialist Agents

目标：降低主 Agent prompt 和工具列表复杂度。

范围：

- 实现 `bili_agent`。
- 实现 `qq_admin_agent`。
- 实现 `memory_agent`。
- 实现 `browser_agent`。
- 主 Agent 只负责判断是否 handoff 和最终表达。

验收：

- 主 Agent prompt 变短。
- 工具选择错误率下降。
- 不同领域能力可单独测试。
- specialist 不能绕过统一权限和确认。

## 5. 开发优先级

推荐立即执行顺序：

1. Phase 9：文档和实测收口。
2. Phase 10：Agent Runner 重构。
3. Phase 11：ToolSpec V2 和 Guardrails。
4. Phase 13：Trace Span 和 Dashboard V2。
5. Phase 12：Session / Context / Memory V2。
6. Phase 14：Specialist Agents。

说明：

- Phase 12 和 Phase 13 可互换，但建议先做 Trace，因为重构上下文时需要更强观测能力。
- 不建议在 Phase 10-13 完成前继续增加高风险 QQ 操作工具。
- 不建议现在上完整浏览器自动化；当前 `browser.read_url` 的只读能力足够作为安全起点。

## 6. 下一步具体任务

### 6.1 本轮可直接做

1. 更新旧计划文档 `docs/plans/2026-04-24-agent-runtime-redesign-plan.md`：
   - 补 Phase 7/8 当前状态。
   - 标记 Phase 6 剩余项。
   - 链接本 Roadmap。
2. 更新 README：
   - Agent 环境变量。
   - WebUI 配置入口。
   - QQ 管理权限说明。
   - 工具确认方式。
   - 记忆验证方式。
   - 浏览器能力边界。
3. 新增 QQ 实测清单文档：
   - 放在 `docs/plans/`。
   - 按场景、前置条件、操作、预期、实际结果记录。

### 6.2 需要代码修改授权后做

1. Phase 10：抽 `AgentRunner` 和 `RunState`。
2. Phase 11：升级 `registry` 为 `ToolSpec V2`。
3. Phase 11：补 `paramsSchema`、只读工具超时和 tool guardrail。
4. Phase 11：继续拆 decision/output guardrail。
5. Phase 13：升级 trajectory span。
6. Phase 12：抽 `ContextSelector` 和 `ContextCompactor`。

## 7. 风险控制原则

- 不恢复旧 AI/MCP。
- 不给 Agent 任意 shell、任意文件读写、动态 MCP、任意 HTTP。
- QQ 管理能力必须以 QQ 权限和 root 权限为硬边界。
- 高风险工具必须二次确认。
- LLM 只能提出意图，不能决定权限。
- 所有工具执行都必须可审计。
- 浏览器能力默认只读，禁止登录态和外部状态修改。
- 上下文长度不要盲目追求 200K，优先做话题选择、摘要压缩和记忆检索质量。
