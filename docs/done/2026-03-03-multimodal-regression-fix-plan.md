# 2026-03-03 修复计划：多模态图片链路回归（方案 B）

## 1. 背景与问题定义

### 1.1 当前行为

当前多模态逻辑位于 `src/handlers/aiHandler.js`，其中：

1. `checkImageUrlAccessible()` 在图片 URL 的 `HEAD` 请求返回 `405` 时，会回退为 `GET` 请求探测。
2. 回退 `GET` 探测阶段将 `maxContentLength/maxBodyLength` 固定为 `Math.min(maxBytes, 256 * 1024)`。
3. `buildUserMessageWithMultimodal()` 在 `url` 传输模式下，会先执行 bot 侧 URL 可达性探测；探测失败则直接降级为文本占位。

### 1.2 已确认问题

1. `HEAD=405` 分支存在 256KB 硬上限，与 `aiMultimodalMaxImageBytes` 配置不一致。
2. `url` 模式采用 bot 侧可达性作为准入，和“模型服务侧可达”目标不一致，在网络视角不一致时会误丢图。

### 1.3 修复目标

1. 消除 `HEAD=405` 场景下由 256KB 硬上限导致的误降级。
2. 让 `url` 模式遵循其语义：以“URL 合法 + 交给模型侧拉取”为准，不再用 bot 侧探测做强拦截。
3. 保持 `base64` 模式现有安全边界（超限、超时、不可达时降级）。

## 2. 方案对比与决策

### 2.1 候选方案

- 方案 A：保持现状。
- 方案 B：最小修复（本计划采用）。
- 方案 C：在 B 基础上增加“bot 侧预探测开关”配置。

### 2.2 选择方案 B 的理由

1. 直接命中两个已确认问题根因。
2. 只改动一个核心文件，回归面最小。
3. 不扩展配置面，避免额外前后端联动复杂度。

## 3. 详细改动设计（方案 B）

目标文件：`src/handlers/aiHandler.js`

### 3.1 改动点 A：修复 256KB 硬上限

位置：`checkImageUrlAccessible(url, maxBytes, proxyConfig)` 的 `resp.status === 405` 分支。

改动策略：

1. 将回退 `GET` 请求中的 `maxContentLength/maxBodyLength` 改为使用 `maxBytes`。
2. 移除 `Math.min(maxBytes, 256 * 1024)` 的硬编码截断。
3. 保留既有的异常处理与降级语义（`UNREACHABLE` / `TOO_LARGE`）。

预期结果：

1. 在 `HEAD=405` 场景下，图片大小判定与用户配置一致。
2. 大于 256KB 但未超 `maxBytes` 的图片不再误降级。

### 3.2 改动点 B：移除 `url` 模式 bot 侧强拦截

位置：`buildUserMessageWithMultimodal(msg, fallbackMessage, defaultUserName, userId, options)` 中 `transportMode === 'url'` 分支逻辑。

改动策略：

1. `url` 模式不再调用 `checkImageUrlAccessible()` 做准入判断。
2. 增加本地轻量校验，仅检查：
   - URL 非空。
   - 协议为 `http://` 或 `https://`。
3. 校验通过：直接加入 `image_url` 片段。
4. 校验失败：降级为文本占位（沿用现有降级路径和日志语义）。

预期结果：

1. 避免因 bot 与模型网络视角不同导致的误丢图。
2. 继续阻断明显非法 URL，控制基础输入风险。

### 3.3 不改动项（显式约束）

1. `base64` 模式仍执行拉取、体积限制与超时保护。
2. `aiMultimodalMaxImages`、`aiMultimodalMaxImageBytes`、`aiMultimodalTransportMode` 配置语义不变。
3. 不调整消息降级文案与工具调用链路。

## 4. 影响范围与风险评估

### 4.1 影响范围

1. 仅 `src/handlers/aiHandler.js`。
2. 影响路径为“用户消息 -> 多模态请求构造 -> AI API 请求”。

### 4.2 风险

1. `url` 模式下，部分失败将从“预探测阶段”转移到“模型侧拉取阶段”暴露。
2. 在模型侧不可达 URL 的情况下，最终表现为模型响应失败或忽略图片。

### 4.3 风险缓解

1. 保持 URL 基础合法性校验，避免明显异常输入。
2. 保留降级与告警日志，便于定位模型侧不可达问题。

## 5. 验证计划

### 5.1 功能验证用例

1. `HEAD=405` + 图片 300KB + `aiMultimodalMaxImageBytes=5MB`：应保留图片片段，不降级。
2. `HEAD=405` + 图片超 `maxBytes`：应触发 `TOO_LARGE` 并降级。
3. `url` 模式 + bot 不可达但 URL 合法：应透传 `image_url` 片段。
4. `url` 模式 + 非法 URL（空串、非 `http/https`）：应降级并记录告警。
5. `base64` 模式 + 超限：应降级；未超限：应生成 data URL。

### 5.2 回归验证

1. 纯文本消息路径不变。
2. 仅文本上下文对话不受影响。
3. 工具调用（MCP）链路不受影响。

### 5.3 验证方式

1. 单元测试优先覆盖关键分支（建议 mock `axios.head/get`）。
2. 通过日志观察降级原因是否与预期一致。
3. 手工构造包含图片与纯文本的消息进行端到端冒烟。

## 6. 回滚方案

1. 代码级回滚：仅回滚 `src/handlers/aiHandler.js` 本次修复块。
2. 运行时兜底：临时将 `aiMultimodalEnabled=false`，快速回到纯文本行为。
3. 回滚后验证：确认图片消息恢复为文本占位路径且主对话可用。

## 7. 执行顺序与交付物

### 7.1 执行顺序

1. 修改 `checkImageUrlAccessible()` 的 `HEAD=405` 分支上限逻辑。
2. 修改 `buildUserMessageWithMultimodal()` 的 `url` 模式准入逻辑。
3. 运行针对性验证与回归验证。
4. 输出修复结果与风险说明。

### 7.2 交付物

1. 代码修改：`src/handlers/aiHandler.js`。
2. 验证记录：执行项、结果、未执行项及原因。
3. 最终说明：影响范围、风险、回滚指引。
