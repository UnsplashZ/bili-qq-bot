# 2026-03-02 一期计划：MCP 仅 HTTP 传输 + 完整工具调用链

## 1. 目标与边界

### 1.1 目标

1. 禁用 `stdio`，MCP 仅允许 `sse/streamable_http`。
2. 提升 MCP 工具调用可靠性与结果保真度（“完整调用能力”）。
3. 优先保证 Docker 场景可部署、可诊断、可回滚。

### 1.2 非目标

1. 本期不做图片等多模态输入改造（放到二期）。
2. 不引入 1mcp，不新增独立 MCP 管理系统。

## 2. 里程碑

### 里程碑 M1：配置收敛（HTTP-only）

完成标准：

1. 后端 API 不再接受 `stdio`。
2. WebUI 不再提供 `stdio` 录入入口。
3. 配置模板和文档全部切换为 HTTP 示例。

### 里程碑 M2：调用链增强（完整工具调用）

完成标准：

1. MCP 调用结果有统一标准化结构（文本与非文本块均可表达）。
2. 调用失败有明确错误分类（连接、超时、参数、服务端错误）。
3. AI 侧工具调用流程可稳定消费标准化结果，不出现“不可解释空结果”。

### 里程碑 M3：Docker 验证与回归

完成标准：

1. Docker 组网下可成功调用至少 1 个 `sse` 与 1 个 `streamable_http` MCP。
2. MCP 重载成功/失败路径均有清晰反馈与可回退策略。
3. 非 MCP 功能（链接解析、订阅、普通 AI）无回归。

## 3. 逐文件改动清单

## 3.1 `src/dashboard/routes/api.js`

改动点：

1. `allowedTypes` 从 `['stdio', 'sse', 'streamable_http']` 收敛到 `['sse', 'streamable_http']`。
2. 对存量 `stdio` 提交返回明确迁移错误信息（包含迁移指引）。
3. `writeMcpConfig` 改为 `asyncWriteWithBackup`，避免配置文件非原子写风险。
4. 保留当前版本冲突检测（409）和 reload 成功/失败语义。

风险与备注：

1. 这是用户可感知行为变化（禁止 stdio），上线前需公告迁移窗口。

## 3.2 `dashboard/src/pages/Settings.jsx`

改动点：

1. MCP 类型下拉只保留 `sse`、`streamable_http`。
2. 删除 `stdio` 专属字段输入区（`command/args/env`）。
3. 新增 UI 提示：仅支持 HTTP MCP 服务端点。
4. 错误文案统一为 HTTP-only 语义。

风险与备注：

1. 与后端校验必须同步发布，避免前后端不一致导致用户困惑。

## 3.3 `src/services/mcpManager.js`

改动点：

1. 新增 `normalizeMcpResult(result)`：统一将 MCP 返回转换为 AI 可消费内容（文本优先，非文本输出结构摘要）。
2. `executeTool` 增加调用超时、错误分类与上下文标识（serverName/toolName）。
3. 启动连接策略增强：显式可用状态（ready）与启动阶段日志。
4. 保持 `reload` 的“新连接全部成功后再切换”策略，并完善失败路径日志。

风险与备注：

1. 结果标准化会影响模型读到的工具反馈文本，需要回归验证关键工具。

## 3.4 `src/handlers/aiHandler.js`

改动点：

1. 工具调用回包改为只消费标准化后的 MCP 结果。
2. 统一工具异常反馈模板，避免空响应或格式分歧。
3. 保持当前对话风格与系统提示策略不变。

风险与备注：

1. 不改变用户可见话术策略，仅增强工具调用稳定性。

## 3.5 `config/mcp_servers.json.example`

改动点：

1. 移除 `stdio` 示例。
2. 增加 `sse/streamable_http` 示例（含 Docker 内网地址示例）。

## 3.6 `README.md`

改动点：

1. 增补“仅支持 HTTP MCP”说明。
2. 增补 Docker 部署检查清单（服务可达、鉴权、超时、重载）。
3. 给出从旧 `stdio` 到 HTTP 服务的迁移示例。

## 3.7 `setup.sh`（可选）

改动点：

1. 初始化 MCP 模板改为 HTTP-only 示例。
2. 在脚本提示中明确：不再支持 `stdio`。

## 4. 验证计划

1. API 层
   1. `sse/streamable_http` 保存成功。
   2. `stdio` 保存失败并返回迁移提示。
2. 调用链
   1. 至少 2 个不同传输工具调用成功。
   2. 超时/不可达时，AI 收到可读错误并继续对话流程。
3. Docker
   1. 跨容器域名访问 MCP 正常。
   2. 重载后无需重启主服务即可生效。
4. 回归
   1. 链接解析、订阅、普通 AI 回复正常。

## 5. 回滚方案

1. 回滚 `allowedTypes` 与前端类型选项，恢复 `stdio`。
2. 回滚 `mcpManager/aiHandler` 标准化路径到旧逻辑。
3. 回滚模板与 README 描述。

## 6. DoD

1. 代码与 UI 层面均无法新增或保存 `stdio`。
2. MCP 工具调用在 HTTP 传输下具备稳定性、可诊断性与结果保真度。
3. Docker 场景下有可执行的部署与排障说明。
4. 验证记录完整，未执行项有明确原因。
