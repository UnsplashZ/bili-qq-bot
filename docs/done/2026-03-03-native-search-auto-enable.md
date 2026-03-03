# 模型内置搜索自动启用方案设计

**日期**: 2026-03-03  
**设计人**: Codex  
**优先级**: 高  
**影响范围**: `src/handlers/aiHandler.js`、`src/config.js`、`src/dashboard/routes/api.js`、`dashboard/src/pages/Settings.jsx`

## 概述

在保留现有 MCP 工具链（`mcpManager`）的前提下，为 AI 对话链路增加“模型内置搜索”能力。采用方案 C：内置搜索优先、MCP 兜底。

本次实现分两层：
- 配置层：新增全局开关与模式，支持自动启用。
- 调用层：按 provider 自动注入内置搜索参数；若 provider 不支持或请求失败，自动降级为原有 MCP 工具路径。

## 问题分析

### 根因

当前 `AiHandler` 仅使用 `chat/completions + MCP tools`，未向模型 API 传递任何原生搜索参数，导致“模型内置搜索”无法使用。

### 触发条件

- 用户希望模型自动联网搜索，但当前仅能依赖 MCP 搜索工具。
- MCP 搜索服务出现网络/权限/可用性问题时，搜索能力波动明显。

### 观察影响

- 无法启用模型侧搜索能力。
- 搜索能力完全依赖 MCP server 稳定性。

## 修复目标

- 支持在配置中开启“模型内置搜索”。
- `auto` 模式下默认尝试启用；失败时自动降级，不影响正常回复。
- 保持现有 MCP 工具链兼容，不引入破坏性改动。

## 详细设计

### 1. 配置模型

新增全局配置项（`src/config.js`）：
- `aiNativeSearchEnabled: boolean`（默认 `false`）
- `aiNativeSearchMode: string`（`auto | force_on | force_off`，默认 `auto`）
- `aiNativeSearchProvider: string`（`auto | openai_responses | deepseek | custom`，默认 `auto`）

默认关闭，避免行为突变。

### 2. API 与 WebUI

- `POST /api/ai` 增加上述字段校验与持久化。
- `POST /api/ai/reset` 增加上述字段回滚到默认。
- `Settings` 页面增加三个字段：开关、模式、provider。

### 3. AiHandler 请求构造

在构造 `requestPayload` 时增加 native-search 组装逻辑：
- 根据配置与 API URL/model 推断 provider（`auto`）。
- 仅在启用状态下注入对应 provider 的搜索字段。
- 当前先支持：
  - `deepseek`: `web_search: true`
  - `openai_responses`: 记录为不兼容当前 `chat/completions` 通道（不注入）

### 4. 自动降级

若请求返回“参数不支持/未知字段/模型不支持”类错误：
- 本轮请求自动移除 native-search 参数重试 1 次。
- 成功后继续正常回复；并打印降级日志，标记 `search_source=native_fallback_mcp`。

### 5. 可观测性

新增日志：
- 尝试启用内置搜索时记录 provider 与模式。
- 注入成功记录 `search_source=native`。
- 降级重试记录原因摘要与最终路径。

## 错误处理和日志策略

- 参数校验错误：在 API 层返回 400，指明字段和期望值。
- provider 不匹配：不注入参数并记录 info 级日志，不中断请求。
- 内置搜索失败：仅触发一次降级重试，避免无限循环。
- 降级失败：保持现有错误处理路径（超时/HTTP 错误）。

## 测试策略

- 配置测试：
  - 开关、模式、provider 的保存与重置。
- 调用测试：
  - `enabled=false` 时不注入字段。
  - `enabled=true + deepseek` 时注入 `web_search: true`。
  - 模拟 400 不支持错误时触发一次降级重试并成功返回。
- 回归测试：
  - MCP tools 正常挂载与调用不受影响。

## 实施清单

- [ ] 更新 `src/config.js` 新增 native-search 配置项
- [ ] 更新 `src/dashboard/routes/api.js` 增加字段校验与 reset 键
- [ ] 更新 `dashboard/src/pages/Settings.jsx` 暴露三个配置项
- [ ] 更新 `src/handlers/aiHandler.js` 注入与降级逻辑
- [ ] 本地最小验证与日志确认

## 风险评估

- 不同 provider 参数差异大，误注入可能导致 4xx。
- `openai_responses` 能力与当前 `chat/completions` 协议不完全一致，本次仅做“可配置+可降级”，不切换请求协议。

缓解：
- 默认关闭；开启后仅对已识别 provider 注入。
- 失败自动降级，保障可用性。

## 审批记录

- 2026-03-03：用户已确认采用“方案 C”。
