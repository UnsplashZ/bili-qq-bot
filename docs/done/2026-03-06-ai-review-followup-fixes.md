# 2026-03-06 AI 对话 Review Follow-up 修复记录

## 背景

针对上一轮 AI 对话功能 review 中“未完成”的 3 个问题，进行集中修复：

1. 工具调用超时仅在上层返回，未向底层传播取消信号。  
2. 数值解析存在宽松解析风险（`parseInt/parseFloat` 可接受脏尾巴）。  
3. 幂等缓存仅在容量超限时清理，常规路径下过期键可能滞留。  

## 修复项

### 1) 工具超时取消链路

- `src/services/ai/toolExecutionGuard.js`
  - 在 `execute` 内引入 `AbortController`。
  - 超时时设置 `TOOL_TIMEOUT` 错误并 `abort` 底层调用。
  - 调用函数签名改为接收 `{ signal, timeoutMs }`。
- `src/handlers/aiHandler.js`
  - MCP 工具调用改为接收 guard 传入的 `signal`。
- `src/services/mcpManager.js`
  - `executeTool(name, args, requestOptions)` 新增可选 `requestOptions`。
  - 将 `signal/timeout` 透传到 MCP SDK 的 `client.callTool(..., options)`。

### 2) 严格数值解析

- `src/services/ai/validation.js`
  - `int/float` 解析改为严格格式校验后再 `Number(...)` 转换。
  - 拒绝 `"0.3abc"`、`"10foo"` 这类脏输入。
  - 补充 `aiShortMessageThreshold` 的统一范围校验（1-50）。
- `src/commands/ai.js`
  - `/AI 概率`、`/AI 向量阈值`、`/AI 向量数量`、`/AI 短消息过滤` 统一走 `normalizeAiConfigField`。
- `src/commands/settings.js`
  - `/设置 AI概率` 改为复用统一校验。

### 3) 幂等缓存清理触发优化

- `src/services/ai/idempotency.js`
  - 新增 `cleanupIntervalMs` 与 `lastCleanupAt`。
  - 在正常请求路径按间隔触发过期清理，不再仅依赖“容量超限”。
  - 保留超限清理逻辑。
  - 导出 `AiIdempotencyService` 类（不影响默认单例导出）。

## 测试与验证

### 新增/更新用例

- `test/unit/toolExecutionGuard.test.js`
  - 新增“超时触发底层 abort”用例。
- `test/unit/ai-config-validation.test.js`
  - 新增“脏数值输入拒绝”用例。
- `test/unit/ai-config-entry-consistency.test.js`
  - 新增 `/AI 概率 0.3abc` 被拒绝用例。
- `test/unit/ai-idempotency-cleanup.test.js`（新增）
  - 验证非溢出场景也会定期清理过期键。

### 执行结果

- `node test/unit/toolExecutionGuard.test.js` ✅
- `node test/unit/ai-config-validation.test.js` ✅
- `node test/unit/ai-config-entry-consistency.test.js` ✅
- `node test/unit/ai-idempotency-cleanup.test.js` ✅

## 影响评估

- 兼容性：保留原有默认导出接口，调用方无需改动。  
- 行为变化：数值输入更严格，非法脏输入会被拒绝。  
- 稳定性：工具超时后可向底层传播取消信号，降低堆积风险。  
