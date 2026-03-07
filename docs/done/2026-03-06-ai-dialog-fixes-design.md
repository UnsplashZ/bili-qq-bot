# AI 对话功能修复设计（安全稳定 + 入口一致性）

日期：2026-03-06  
范围：后端 AI 对话相关链路（消息入口、AI 编排、向量记忆、MCP 工具、配置入口）

## 1. 背景与目标

本次修复聚焦以下已识别问题：

1. 路径安全风险：`/AI 新对话 [群号]` 与上下文文件路径拼接存在穿越风险。
2. 工具调用稳定性：MCP 工具执行无单次超时和熔断，可能拖死整轮回复。
3. 向量写入压力：Embedding 调用无并发治理，流量高峰存在外部限流与本地堆积风险。
4. 配置入口不一致：命令与 Dashboard API 的校验规则分叉。
5. 缓存/幂等边界：向量查询缓存 key 维度不足、消息重复投递缺少幂等保护。

目标：一次性完成“高风险修复 + 入口规则统一”，在不做大重构的前提下提升安全性、稳定性与一致性。

## 2. 方案选型

### 2.1 候选方案

- 方案 A（采用）：分层收敛 + 小范围重构
- 方案 B：单入口 Orchestrator 大重构
- 方案 C：最小补丁，不抽公共能力

### 2.2 采用方案 A 的原因

- 风险收益比最高：能覆盖核心问题，改动边界可控。
- 兼顾短期交付与长期维护：通过共享校验模块减少后续漂移。
- 避免大重构回归风险：主调用链保持不变，仅替换关键实现点。

## 3. 架构与改造边界

### 3.1 主链保持

保持现有主链：

`bot.js -> messageHandler -> aiHandler -> (aiContext/vectorMemory/mcp) -> notificationService`

不改路由结构，仅在关键节点插入治理能力。

### 3.2 新增共享能力模块

建议新增：

1. `src/services/ai/validation.js`
   - 统一 AI 配置白名单、类型转换、范围校验、null-reset 语义。
2. `src/services/ai/idempotency.js`
   - 消息去重（`groupId:userId:message_id`）与 TTL/LRU 管理。
3. `src/services/ai/toolExecutionGuard.js`
   - MCP 工具超时包装、失败分类、轻量熔断状态。

## 4. 逐问题修复设计

### 4.1 路径安全（高优先级）

改造点：

- `src/commands/ai.js`
  - `/AI 新对话` 的 `targetGid` 仅允许：`^\d+$` 或 `^private_\d+$`。
- `src/services/aiContextService.js`
  - 新增上下文 ID 统一校验。
  - 文件路径使用 `path.resolve` 后做目录前缀检查，确保只能落在 `data/contexts`。

预期效果：

- 双层阻断路径穿越，非法参数不触发任何写盘。

### 4.2 MCP 工具超时与熔断（高优先级）

改造点：

- `src/handlers/aiHandler.js`
  - 工具调用改为 `Promise.race([executeTool, timeout])`。
  - 工具失败写入结构化 tool result，继续后续推理，不中断整轮。
- `src/services/ai/toolExecutionGuard.js`
  - 维护 `toolName` 级别失败/超时计数。
  - 达阈值后短暂熔断，窗口期内直接跳过并记录日志。

预期效果：

- 单工具卡死不再拖垮整轮回复，长尾延迟可控。

### 4.3 向量写入并发治理（高优先级）

改造点：

- `src/services/vectorMemoryService.js`
  - `addMemory` 前加有界并发队列（并发上限 + 队列上限）。
  - 队列满时对低价值任务执行降级丢弃（短文本/重复候选优先丢弃）。
  - embedding 请求对 429/5xx 做小次数指数退避。

预期效果：

- 高峰期优先保障主流程对话可用性，避免 embedding 洪峰。

### 4.4 配置入口统一（高优先级）

改造点：

- `src/services/ai/validation.js` 提供统一 API。
- 接入以下入口：
  - `src/commands/ai.js`
  - `src/commands/settings.js`（AI 相关命令）
  - `src/dashboard/routes/api/modules/ai.js`
  - `src/dashboard/routes/api/modules/groups.js`

统一内容：

- 白名单字段约束。
- 类型与范围统一。
- null-reset 语义统一。
- 错误码/错误语义尽量一致。

预期效果：

- 命令与 Web API 对同字段行为一致，杜绝规则分叉。

### 4.5 缓存与幂等（中优先级，本次纳入）

改造点：

- `src/services/vectorMemoryService.js`
  - L3 查询缓存 key 增加 `limit` 维度。
- `src/handlers/messageHandler.js`
  - 引入消息幂等去重（短 TTL）防重复回复与重复写入。
  - 对 `message` 结构先归一化为数组后再 `find`（避免异常输入崩溃）。

## 5. 错误处理与可观测性

### 5.1 错误处理原则

- 工具失败：单工具失败不打断整轮，回复允许降级。
- 存储失败：向量/画像失败不影响主流程返回。
- 校验失败：在入口层尽早拒绝，返回明确错误。

### 5.2 日志与观测补齐

关键日志字段统一：

- `groupId`
- `userId`
- `messageId`
- `traceId`
- `intentType`
- `toolName`（工具路径）

新增计数类日志：

- 工具超时次数
- 熔断触发次数
- embedding 队列丢弃数量

## 6. 测试与验收标准

### 6.1 安全验收

- 非法 `targetGid` 无法触发上下文写盘。
- 任意非法上下文 ID 均不能写出 `data/contexts` 目录外。

### 6.2 稳定性验收

- 模拟工具超时后，对话仍在可控时间内返回。
- 工具连续失败后触发熔断并可恢复。
- 高并发消息下 embedding 队列受控，无明显阻塞。

### 6.3 一致性验收

- 命令入口与 API 入口对同字段的合法/非法输入判断一致。
- null-reset 语义在群级与全局入口一致。

### 6.4 回归验收

- 正常 AI 对话链路保持可用。
- 不同 `limit` 下向量搜索返回条数正确。
- 重复消息事件不重复回复、不重复写向量。

## 7. 非目标（本次不做）

- 不引入 Redis/消息队列等外部基础设施。
- 不做 `AiOrchestrator` 全链路重构。
- 不调整业务语义（仅治理异常边界与一致性）。
