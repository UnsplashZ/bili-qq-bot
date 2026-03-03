# 多模态与 MCP 传输回退设计

**日期**: 2026-03-03
**设计者**: Codex
**优先级**: 高
**影响范围**: `src/handlers/aiHandler.js`、`src/handlers/messageHandler.js`、`src/services/aiContextService.js`、`src/config.js`、`src/dashboard/routes/api.js`、`dashboard/src/pages/Settings.jsx`、`src/services/mcpManager.js`、`README.md`、`config/.env.example`、`config/mcp_servers.json.example`、`setup.sh`

## 概述

本方案用于回退最近引入的两类行为变更：
1. AI 多模态输入（图片）与模型内置搜索配置链路。
2. MCP 仅支持 HTTP 传输（禁用 `stdio`）的限制。

目标是恢复到“纯文本 AI 输入 + MCP 同时支持 `stdio/sse/streamable_http`”的行为。

## 问题分析

### 根本原因

- 多模态与 native search 改动引入了大量新配置项、消息结构（`contentParts`）和请求分支，超出当前用户期望。
- MCP HTTP-only 改动移除了 `stdio` 连接路径，导致原有本地命令式 MCP 配置不再可用。

### 触发条件

- 配置启用 `aiMultimodal*` 或消息携带图片时，会触发多模态处理分支。
- MCP 配置使用 `type=stdio` 或只配置 `command/args/env` 时，当前逻辑会在前后端校验阶段失败。

### 观察到的影响

- 用户可见行为发生变化（设置页新增/变更项，配置校验策略变化，MCP 可用类型变化）。
- 兼容性下降（旧 `stdio` MCP 配置无法继续使用）。

## 修复目标

- 恢复 AI 纯文本消息链路，移除多模态与 native search 新增行为。
- 恢复 MCP `stdio` 连接与配置路径，保留 `sse/streamable_http` 支持。
- 保持 MCP prompts/resources bridge 及错误标准化等非冲突增强能力。
- 提供可验证、可回滚的最小化改动。

## 详细设计

### 方案选项

- 方案 A：保持现状，不回退。
- 方案 B（推荐并已获批准）：
  - 回退多模态与 native search 的代码、配置、UI 和文档。
  - 恢复 MCP `stdio` 连接路径及前后端校验/UI 配置入口。

### 实施内容

- `aiHandler`：删除多模态构建、图片下载/探测、native search 注入与回退逻辑，恢复纯文本 `messages` 组装。
- `messageHandler` / `aiContextService`：移除 `contentParts` 流转与存储增强，恢复文本上下文写入。
- `config` 与 Dashboard API/UI：移除 `aiMultimodal*`、`aiNativeSearch*` 配置项与相关校验、设置项。
- `mcpManager`、Dashboard API/UI：恢复 `stdio` 作为合法类型，重新允许 `command/args/env` 配置与连接。
- 文档与示例配置：删除 HTTP-only 强约束表述，示例恢复含 `stdio` 参考。

## 错误处理和日志策略

- 保持现有日志级别策略不变，仅移除与多模态/native search 强相关日志。
- MCP `stdio` 恢复后沿用既有连接失败重试与错误日志输出。

## 验证清单

- 启动后 AI 文本对话链路可正常回复。
- 设置页不再出现多模态/native search 配置项。
- MCP 新增/编辑可选择 `stdio`，并可提交 `command/args/env`。
- 后端 MCP 配置校验允许 `stdio`，并拒绝不合法 URL/command 输入。
- `sse/streamable_http` 现有路径不回归。

## 实施清单

- [ ] 回退 AI 多模态与 native search 相关代码与配置。
- [ ] 回退 MCP HTTP-only 限制，恢复 `stdio` 全链路。
- [ ] 同步更新示例与 README 文档。
- [ ] 运行最小范围验证并输出结果。

## 风险评估

- 风险 1：回退时误伤 MCP bridge 工具能力。
  - 缓解：仅回退传输类型与配置入口，不改 bridge 工具实现。
- 风险 2：UI 和 API 字段不同步。
  - 缓解：按“API 校验 -> UI 表单 -> 默认值”顺序对齐检查。

## 审批记录

- 2026-03-03 用户批准：`批准执行方案：多模态=B，MCP传输=B`
