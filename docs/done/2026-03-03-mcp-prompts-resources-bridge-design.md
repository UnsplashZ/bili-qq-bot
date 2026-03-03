# MCP 全能力接入（Prompts/Resources 桥接）修改设计

**日期**: 2026-03-03
**设计者**: Codex
**优先级**: 高
**影响范围**: `src/services/mcpManager.js`、`src/handlers/aiHandler.js`、`README.md`、`config/.env.example`（可选）、`src/config.js`（可选）

## 概述

当前项目已完成 MCP `tools` 能力接入，但未接入 `prompts/resources` 能力，导致对仅暴露 Prompt 或 Resource 的 MCP 服务无法有效利用。本方案采用“通用桥接工具”方式，在不推翻现有 AI function-calling 主流程的前提下，补齐 `prompts/resources` 调用链。

核心思路是新增 4 个内部通用工具：

- `mcp_list_prompts`
- `mcp_get_prompt`
- `mcp_list_resources`
- `mcp_read_resource`

模型通过现有工具调用循环即可使用上述能力，保持与当前 `tools` 流程一致的稳定性、可观测性与回滚路径。

## 问题分析

### 当前行为与观察到的问题

- 当前仅在 MCP 连接后执行 `listTools`，并在对话中只处理 `callTool`。
- `prompts/list`、`prompts/get`、`resources/list`、`resources/read` 未进入现有调用链。
- 结果是“协议能力可用，但产品能力未消费”：当服务器提供高质量 Prompt 模板或只暴露 Resource 时，模型无法直接调用。

### 根本原因

- `McpManager` 能力模型仅围绕 `toolsMap` 构建，缺少 prompts/resources 元数据与执行分发。
- `AiHandler` 只拿到 OpenAI 风格 tools 列表，不存在 prompts/resources 对应入口。
- 缺少统一的 prompts/resources 结果标准化，无法稳定回填到当前 `tool` 消息格式。

### 触发条件

- 接入的 MCP 服务主要能力在 prompts/resources。
- 需要读取结构化资料（资源 URI）而不是执行动作类工具。
- 需要服务端 Prompt 模板来统一回答风格或约束输出格式。

### 影响

- MCP 能力覆盖不完整，实际可用范围受限。
- 需要在外部人工拼接 Prompt/Resource 内容，增加维护成本。
- 模型无法基于资源内容做“先检索再回答”的标准链路。

### 候选方案

- 方案A：保持现状（仅 tools）。
- 方案B：为每个 prompt/resource 动态生成大量伪工具。
- 方案C：新增固定数量的通用桥接工具（推荐）。

### 推荐方案与理由

推荐方案C。理由如下：

- 与现有架构兼容，改动集中在 `mcpManager`，`aiHandler` 只需最小配合或无需改动。
- 工具数量稳定，不会随服务端 prompt/resource 数量膨胀。
- 能覆盖多 server、多能力、可分页场景，扩展性更好。
- 回滚简单，移除 4 个桥接工具注册即可恢复到 tools-only。

## 修复目标

- 功能完整性：在现有 tools 基础上接入 prompts/resources 核心调用能力。
- 兼容性：不破坏已有 `server__tool` 调用语义与错误分类。
- 可观测性：prompts/resources 调用具备统一日志、错误码和超时行为。
- 可回滚性：支持按功能开关或代码层快速回退。
- 性能安全：对 resource 读取内容做长度限制，防止超大返回拖垮模型请求。

## 详细设计

### 1. 能力模型扩展（`src/services/mcpManager.js`）

新增并维护以下运行态结构：

- `serverCapabilitiesMap`: `serverName -> { tools, prompts, resources }`
- `serverPromptsMap`: `serverName -> prompt metadata[]`（可选缓存）
- `serverResourcesMap`: `serverName -> resource metadata[]`（可选缓存）

连接成功后执行能力探测：

- 保留现有 `listTools` 缓存逻辑。
- 尝试调用 `listPrompts`、`listResources`。
- 单项失败不影响其他能力，按 server 级别记录能力可用性。

### 2. 通用桥接工具定义

通过 `getOpenAITools()` 在原有 `server__tool` 之外追加 4 个固定工具。

#### `mcp_list_prompts`

- 入参：
  - `server`（可选，空表示聚合全部已连接 server）
  - `cursor`（可选）
  - `limit`（可选）
- 出参：标准化文本，包含 prompt 名称、描述、参数摘要、所属 server。

#### `mcp_get_prompt`

- 入参：
  - `server`（必填）
  - `name`（必填）
  - `arguments`（可选对象）
- 出参：标准化文本，包含 prompt message 列表与内容摘要（文本优先）。

#### `mcp_list_resources`

- 入参：
  - `server`（可选）
  - `cursor`（可选）
  - `limit`（可选）
- 出参：标准化文本，包含 `uri`、`name`、`description`、`mimeType`、所属 server。

#### `mcp_read_resource`

- 入参：
  - `server`（必填）
  - `uri`（必填）
  - `maxChars`（可选，默认值受配置限制）
- 出参：标准化文本；文本内容按 `maxChars` 截断，二进制返回元信息摘要。

### 3. 执行分发机制

扩展 `executeTool(name, args)`：

- 若命中现有 `server__tool`，走原逻辑 `client.callTool`。
- 若命中 `mcp_*` 桥接工具，走新分发：
  - `client.listPrompts(...)`
  - `client.getPrompt(...)`
  - `client.listResources(...)`
  - `client.readResource(...)`
- 统一回收为 `{ success, text, blocks, error, serverName, callName }` 结构。

### 4. 结果标准化策略

新增/扩展标准化函数：

- `normalizePromptResult(result)`
- `normalizeResourceListResult(result)`
- `normalizeReadResourceResult(result, maxChars)`

约束：

- 文本优先，保证模型可直接消费。
- 非文本块仅输出安全摘要（类型、uri、mimeType、大小）。
- 对超长文本进行截断，并追加“已截断”标记。

### 5. 配置与默认值（可选）

建议新增可选配置项：

- `MCP_RESOURCE_MAX_CHARS`：单次资源读取最大字符数，默认 `12000`。
- `MCP_PROMPT_MAX_ITEMS`：prompt 列表最大返回条数，默认 `50`。

若暂不新增配置，可先在 `mcpManager` 内使用常量默认值，后续再暴露到 WebUI。

### 6. AI 调用链兼容性

- `AiHandler` 继续通过 `mcpManager.getOpenAITools()` 拿工具定义。
- 继续通过 `mcpManager.executeTool()` 执行，不改现有循环结构。
- 现有 mem0 混合搜索增强逻辑保持不变，仅对 `mem0` 工具名生效。

### 7. 文档与运维说明

更新 `README.md`：

- 新增“prompts/resources 已接入”说明。
- 给出示例对话触发语句和排障步骤。
- 说明 `mcp_read_resource` 读取长度限制及调参方式。

## 错误处理和日志策略

错误分类沿用现有体系并补充新场景：

- `CONNECTION`：连接失败、服务不可达。
- `TIMEOUT`：调用超时。
- `PARAMETER`：缺少 `server/name/uri` 等必填参数，或参数格式错误。
- `SERVER_ERROR`：服务端返回错误或协议异常。

日志策略：

- `info`：能力探测结果、桥接工具调用开始/结束。
- `warn`：可恢复异常（能力不支持、内容截断、单 server 失败）。
- `error`：不可恢复异常（调用抛错、标准化失败）。

关键日志字段：

- `callName`
- `serverName`
- `capability`（tools/prompts/resources）
- `durationMs`
- `resultSize`（文本长度/条目数）

## 测试策略

### 单元验证

- `mcpManager` 桥接分发：
  - 正常调用四个 `mcp_*` 工具返回成功。
  - 参数缺失返回 `PARAMETER`。
  - server 不支持对应能力时返回可诊断错误，不影响其他能力。
- 标准化函数：
  - 文本、非文本、混合内容均可生成稳定输出。
  - 超长文本正确截断并标记。

### 集成验证

- 接入支持 prompts/resources 的 MCP server：
  - `mcp_list_prompts` 能列出可用模板。
  - `mcp_get_prompt` 能拿到模板展开结果。
  - `mcp_list_resources` 能列出资源 URI。
  - `mcp_read_resource` 能读取文本资源。
- 接入只支持 tools 的 server：
  - 原有工具调用全量回归通过。

### 回归验证

- AI 普通对话不回归。
- MCP tools 原路径不回归。
- 重载配置流程不回归（保存成功、重载失败告警逻辑保持一致）。

## 实施清单

- 在 `src/services/mcpManager.js` 增加 capability 探测、桥接工具定义、桥接执行分发与结果标准化。
- 在 `src/handlers/aiHandler.js` 确认无缝消费新增工具（必要时仅做最小兼容调整）。
- 更新 `README.md` 使用说明与排障手册。
- 可选：在 `src/config.js`、`config/.env.example` 增加资源读取长度限制配置。
- 增加最小测试脚本或测试用例，覆盖四个桥接工具主路径与失败路径。

## 风险评估

- 风险1：模型可能过度调用桥接工具，增加单轮耗时。
  - 缓解：保留现有动态超时策略，限制返回长度，必要时加调用计数上限。
- 风险2：不同 MCP server 对 prompts/resources 实现差异较大。
  - 缓解：能力探测与单项容错，不把单 server 失败升级为全局失败。
- 风险3：读取资源内容过大导致 token 膨胀。
  - 缓解：统一截断策略与可配置上限。

回滚计划：

- 回滚代码中的 4 个 `mcp_*` 通用工具注册与分发逻辑。
- 保留现有 `server__tool` 逻辑，恢复 tools-only 模式。
- 若新增了配置项，可保留配置但不再消费，或一并回滚配置读取逻辑。

## 审批记录

- 2026-03-03：用户提出“按方案2输出完整修改文档”。
- 2026-03-03：本文档生成，待用户审批后进入实现阶段。
- 审批状态：**待审批**。

