# MCP 功能完整性审计与修复方案

**日期**: 2026-01-28  
**范围**: 前端 Dashboard（设置页）、后端 API（Express）、服务层（MCP 管理器）  
**目标**: 修复已知与潜在问题，完善扩展能力、提升稳定性与一致性

---

## 问题综述
- UI 层启停开关在部分场景下“看似生效但文件未更新”，主要源于版本控制与返回值未处理。
- GET/POST API 在格式转换、并发冲突与重载失败的反馈上已具备基础设施，但前端未完整消费。
- 服务层存在进程生命周期与重连竞争的潜在风险，HTTP 类型的 MCP 未开放配置入口。
- 安全与可维护性方面，环境变量与敏感信息应避免直接写入仓库文件。

---

## 潜在问题清单（含证据链接）
- 前端开关不处理返回体与版本更新
  - toggle 操作仅乐观更新并 POST，不处理 `reloadSuccess`、`version` 与 `409` 冲突，导致 UI 与文件不一致  
    参考 [Settings.jsx:428-441](file:///Users/zheng/dev/Github/bili-qq-bot/dashboard/src/pages/Settings.jsx#L428-L441)
- 添加/编辑的冲突与回滚不彻底
  - Add/Edit 已提示冲突，但未统一回填后端版本与拉取最新配置，UI 可能漂移  
    参考 [Settings.jsx:324-547](file:///Users/zheng/dev/Github/bili-qq-bot/dashboard/src/pages/Settings.jsx#L324-L547)
- 后端已提供并发控制，但前端未消费
  - 后端返回 `version`、`409 conflict`、`207 reload failure`，前端需统一处理  
    参考 [api.js:591-732](file:///Users/zheng/dev/Github/bili-qq-bot/src/dashboard/routes/api.js#L591-L732)
- HTTP/SSE 类型 MCP 未能在 UI 中配置
  - 服务层支持 `type: 'streamable_http' | 'sse' | stdio` 与 `url`，但 UI 只有 command/args/env 三项  
    参考 [mcpManager.js:45-55](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/mcpManager.js#L45-L55)、[mcpManager.js:200-213](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/mcpManager.js#L200-L213)
- 进程生命周期与重连竞争风险
  - 重载时新旧连接并存，旧连接的 onclose/onerror 可能触发“重连”导致竞争  
    参考 [mcpManager.js:108-127](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/mcpManager.js#L108-L127)、[mcpManager.js:177-294](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/mcpManager.js#L177-L294)
- 退出时未显式清理 MCP 客户端与子进程
  - 优雅关闭流程未调用 `mcpManager.cleanup()`，可能遗留子进程  
    参考 [bot.js:297-325](file:///Users/zheng/dev/Github/bili-qq-bot/src/bot.js#L297-L325)
- 工具返回类型兼容问题
  - AiHandler 主要消费文本，MCP 可能返回结构化或非文本内容；当前做法可兼容文本与部分结构，但仍有风险  
    参考 [aiHandler.js:185-233](file:///Users/zheng/dev/Github/bili-qq-bot/src/handlers/aiHandler.js#L185-L233)
- 敏感信息写库风险
  - MCP 的 env 字段可能包含密钥，配置文件被版本控制；建议转为 `.env` 或外部环境注入  
    参考 [config/mcp_servers.json](file:///Users/zheng/dev/Github/bili-qq-bot/config/mcp_servers.json)

---

## 修复方案

**一、前端（Dashboard Settings 页面）**
- 启停开关完善
  - 调用后端返回后：
    - 成功：更新本地 `mcpVersion = response.data.version`；根据 `reloadSuccess` 显示成功或警告提示
    - 409 冲突：弹出提示并执行一次 `/api/mcp` 拉取最新配置与 `version`，回填 UI
    - 网络/保存失败：回滚本地 `enabled` 状态，提示失败
- 添加/编辑/删除统一行为
  - 在成功响应后统一更新 `mcpVersion`；遇到冲突统一拉取最新配置并覆盖本地
  - 编辑改名时保留现有逻辑（renameOperation），前端无需特例
- 扩展配置表单
  - 新增 `type`（select：stdio/sse/streamable_http）与 `url`（在非 stdio 时启用）
  - 校验：当 `type !== stdio` 时，`url` 必填；`command/args/env` 在非 stdio 情况下可隐藏或置为可选
- 交互节流与禁用
  - 开关与保存操作期间禁用按钮，防止多次触发与版本飘移

**二、后端（API 层）**
- 输入校验扩展
  - 在 `/api/mcp` POST 验证支持 `type` 与 `url`：
    - `type` ∈ {stdio, sse, streamable_http}
    - 当 `type !== stdio` 时，`url` 为合法 URL；`command/args/env` 可选
  - 保持现有 `name/command/args/env/enabled` 校验与唯一性约束
- 返回体一致性
  - 成功时返回 `{ version, reloadSuccess, warning? }`，前端统一消费
  - 冲突时返回 `409` 携带 `currentConfig + serverVersion`
  - 重载失败返回 `207` 保持现有结构与 `warning`
- 安全建议（不强制变更）
  - 支持 `env` 值中引用系统环境（如 `${VAR}` 占位符），在服务层解析为 `process.env.VAR`，减少明文密钥写盘

**三、服务层（McpManager）**
- 重连竞争保护
  - 在 `reload()` 开始时设置“重载标记”，`handleDisconnect()` 检查标记或读取当前生效配置，避免对已移除/禁用的服务进行重连
  - 或在 `handleDisconnect()` 内查询 `this._lastWorkingConfig` 中该 `serverName` 是否仍“启用”，不启用则不重连
- 优雅关闭完善
  - 在机器人优雅关闭流程调用 `mcpManager.cleanup()`，确保子进程与连接关闭
  - 参考修改点 [bot.js:297-325](file:///Users/zheng/dev/Github/bili-qq-bot/src/bot.js#L297-L325)
- 工具结果类型适配
  - `executeTool()` 保持返回字符串；若返回结构体，序列化为简洁文本；如未来支持富内容，考虑扩展 `getOpenAITools()` 的返回以标注 content 类型

**四、配置与安全**
- 建议将敏感环境变量从 `config/mcp_servers.json` 中移除，改为 `.env` 或部署环境注入
- 若保留 `env`，避免提交真实密钥到版本库，使用占位符并在部署环境注入真实值

**五、日志与监控**
- 前端：对成功/冲突/重载失败进行提示
- 后端：保留现有详细日志，新增对 `type/url` 校验失败的明确日志
- 服务层：连接失败与重连行为显式日志，含服务名与重试计数

---

## 测试计划
- 单元测试（Mocha + Supertest）
  - `/api/mcp`：成功保存、字段校验失败、版本冲突（409）、重载失败（模拟抛异常返回 207）
  - 对象↔数组转换一致性：GET 返回数组（含 version），POST 接收数组并写对象（含 _version）
- 集成测试
  - 启停串联：前端切换一次，验证文件更新、服务层 reload 被调用、AI 工具列表更新
  - HTTP/SSE 类型：配置 `type=url` 后，验证连接成功与工具可用
- 回归测试
  - 现有 stdio MCP 不受影响；多次编辑与开关不产生漂移

---

## 上线步骤
- 后端先行：扩展 `/api/mcp` 校验与返回体；在 `bot.js` 加入 `mcpManager.cleanup()` 调用
- 前端随后：完善 toggle/add/edit 流程与 UI 表单；统一处理返回体与冲突
- 验证：本地与测试环境跑完整测试；确认无回归后发布

---

## 风险与兼容性
- 对现有 stdio MCP 兼容，新增 HTTP/SSE 能力不影响旧配置
- 若启用占位符解析，需确保生产环境注入真实值，否则连接失败
- 重连保护需谨慎设计，避免误阻正常重连

---

## 参考代码位置
- 前端设置页（MCP 操作与 UI）：[Settings.jsx](file:///Users/zheng/dev/Github/bili-qq-bot/dashboard/src/pages/Settings.jsx)
- 后端路由（MCP API）：[api.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/dashboard/routes/api.js)
- 服务层（MCP 管理器）：[mcpManager.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/mcpManager.js)
- 启动与关闭流程： [bot.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/bot.js)

