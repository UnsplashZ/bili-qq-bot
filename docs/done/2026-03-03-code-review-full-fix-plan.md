# 2026-03-03 全量 Code Review 问题汇总与修复计划

## 1. 背景与目标
本次计划基于当前仓库的全量代码审查结果，目标是：
- 修复已确认的功能性缺陷，优先消除会导致错误行为或静默失败的问题。
- 修复 WebUI“继承全局设置”链路中的关键异常，确保配置语义一致（`null`=继承）。
- 补齐回归测试与验证脚本，防止相同问题再次引入。

## 2. 问题总览（按优先级）

### P1-1 初始化失败返回码错误（进程可能以 0 退出）
- 现象：初始化异常时，`initializeBot` 的 `catch` 中调用 `gracefulShutdown()`，默认 `exitCode=0`，`gracefulShutdown` 内部会直接 `process.exit(0)`，导致失败场景可能被外部系统识别为成功退出。
- 影响：容器/守护进程健康判定错误，故障恢复策略失效。
- 位置：
  - `src/bot.js:291`
  - `src/bot.js:387`

### P1-2 Feed 预标记 UID 导致订阅漏检
- 现象：`checkFeedUpdate` 在实际拉取 feed 前就把 UID 写入 `monitoredUidsSet`，若 feed 处理失败，后续 manual dynamic/live 检查会被跳过。
- 影响：订阅更新漏推（动态/直播）。
- 位置：
  - `src/services/subscription/updateChecker.js:229`
  - `src/services/subscription/updateChecker.js:269`
  - `src/services/subscription/updateChecker.js:386`

### P1-3 WebUI 群配置“继承全局”对 AI 三开关不生效（核心）
- 现象：
  - 前端群设置保存时，会把 `aiEnabled/aiRagEnabled/aiProfileEnabled: null` 一并提交到通用配置接口。
  - 通用接口只清理了 `aiProbability/aiContextLimit/aiTemperature` 的 `null`，未清理 AI 三开关的 `null`。
  - 运行时 `isAiEnabledForGroup/isRagEnabledForGroup` 用 `'key' in groupConfig` 判断覆盖，`null` 也被当作“已覆盖值”，最终在布尔语义中表现为关闭。
- 影响：页面显示“继承全局”，实际 AI/RAG 被关闭，属于功能与 UI 语义不一致。
- 位置：
  - `dashboard/src/pages/Groups.jsx:361`
  - `src/dashboard/routes/api.js:419`
  - `src/config.js:610`
  - `src/config.js:631`

### P2-1 全局黑名单类型不一致（number vs string）
- 现象：Dashboard API 写入黑名单时可能存 `number`，消息处理判断用字符串 `includes`，导致命中失败。
- 影响：全局封禁偶发失效。
- 位置：
  - `src/dashboard/routes/api.js:984`
  - `src/handlers/messageHandler.js:105`

### P2-2 MCP reload 失败回滚连接泄漏
- 现象：reload 失败时清理循环遍历 `this.clients`，但新建连接保存在局部 `newClients`；若失败发生在替换前，局部新连接可能未关闭。
- 影响：连接/句柄泄漏，长期运行稳定性下降。
- 位置：
  - `src/services/mcpManager.js:224`
  - `src/services/mcpManager.js:313`

### P3-1 Groups 页全局 AI 概率 0 显示错误
- 现象：`aiProbability: res.data.aiProbability || 0.1`，全局值为 `0` 时会错误回显 `0.1`。
- 影响：UI 展示错误，误导运维配置判断。
- 位置：
  - `dashboard/src/pages/Groups.jsx:106`

## 3. WebUI“继承全局设置”结论
- 当前结论：**不完全正常**。
- 正常部分：
  - AI 参数（概率/上下文/温度）继承链路基本正常（通用接口已做 `null` 清理）。
  - 视频下载配置继承链路正常（专用接口将 `null` 解释为删除覆盖）。
- 异常部分：
  - AI 三开关（`aiEnabled`/`aiRagEnabled`/`aiProfileEnabled`）在“群配置通用保存”链路下存在 `null` 持久化与运行时判定不一致风险，其中 `aiEnabled`、`aiRagEnabled` 已可复现实际关闭。

## 4. 修复方案（分阶段）

### 阶段 A：先修 P1（阻断错误行为）
1. 初始化退出码修复（P1-1）
- 改动：
  - `initializeBot` 异常分支改为 `await gracefulShutdown(1)`；
  - 或让 `gracefulShutdown` 只做清理不 `exit`，由调用方统一退出码（推荐作为后续重构）。
- 验收：模拟初始化失败，进程退出码必须为 `1`。

2. Feed 漏检修复（P1-2）
- 改动：
  - 将 `monitoredUidsSet.add(fid)` 从“feed 执行前”迁移到“对应 feed 成功处理后”；
  - 或采用“两段集合”策略：`candidateUids` 与 `successUids` 分离，后续跳过逻辑仅看 `successUids`。
- 验收：注入 `processDynamicFeed/processLiveFeed` 失败场景后，manual dynamic/live 必须兜底执行。

3. WebUI 继承链路修复（P1-3）
- 改动（后端）：
  - 在 `POST /api/groups/:id/config` 中对 `aiEnabled/aiRagEnabled/aiProfileEnabled` 增加与 AI 参数一致的 `null` 清理逻辑（`null` => 删除覆盖键）。
  - 新增输入校验：三字段只允许 `boolean | null`。
- 改动（运行时）：
  - `isAiEnabledForGroup` 与 `isRagEnabledForGroup` 从 `'key' in groupConfig` 改为显式 `=== true/false` 判定，忽略 `null/undefined` 并回退到全局语义。
- 改动（前端）：
  - `Groups.jsx` 的通用保存前，按协议过滤 `null` 字段或改用 AI 专用接口提交 AI 三开关（两者选其一，建议统一到专用接口）。
- 数据修复：
  - 启动时或迁移脚本中清理历史 `groupConfigs[*].aiEnabled/aiRagEnabled/aiProfileEnabled === null` 的脏数据。
- 验收：群配置切换“继承全局/启用/禁用”后，UI 与运行时行为一致。

### 阶段 B：修 P2（稳定性与一致性）
4. 全局黑名单类型统一（P2-1）
- 改动：
  - 全链路统一使用 `string` 存储 QQ；写入接口强制 `String(qq).trim()`。
  - 读取判断前对数组一次性标准化：`map(String)`。
- 验收：以 number 与 string 两种格式写入，消息拦截结果一致。

5. MCP reload 回滚资源清理（P2-2）
- 改动：
  - catch 中优先遍历局部 `newClients` 并全部关闭；
  - 清理逻辑增加 finally 保护与失败日志。
- 验收：故意让第 N 个 server 连接失败，前 N-1 新连接必须全部关闭（可通过 mock close 调用次数验证）。

### 阶段 C：修 P3（体验一致性）
6. 全局 AI 概率显示修复（P3-1）
- 改动：
  - `res.data.aiProbability || 0.1` 改为 `res.data.aiProbability ?? 0.1`。
- 验收：全局概率设置为 `0` 时，Groups 页显示 `0`。

## 5. 详细实施清单（文件级）
- 后端：
  - `src/bot.js`：退出码语义修正。
  - `src/services/subscription/updateChecker.js`：feed 监控 UID 标记时机重构。
  - `src/dashboard/routes/api.js`：群配置 `null` 清理扩展到 AI 三开关；黑名单类型统一。
  - `src/config.js`：`isAiEnabledForGroup/isRagEnabledForGroup` 对 `null` 的容错判定。
  - `src/services/mcpManager.js`：reload 失败回滚清理 `newClients`。
- 前端：
  - `dashboard/src/pages/Groups.jsx`：AI 三开关提交策略、`aiProbability` 回显修复。
- 数据迁移：
  - 新增一次性修复脚本（建议：`scripts/migrations/cleanup-null-ai-overrides.js`）或在启动期执行兼容清理。

## 6. 测试与验收计划

### 6.1 自动化测试补齐
- 新增/扩展单元测试：
  - `bot` 初始化失败退出码。
  - `updateChecker` 在 feed 失败时 manual 检查仍执行。
  - `config.isAiEnabledForGroup/isRagEnabledForGroup` 对 `null` 覆盖的行为。
  - `api/groups/:id/config` 对 AI 三开关 `null` 的删除语义。
  - `blacklist` number/string 混合输入的一致命中。
  - `mcpManager.reload` 失败时新连接关闭验证。

### 6.2 回归验证（手工）
- WebUI 群设置：
  - 在“继承全局 / 开 / 关”三态反复切换并保存，验证行为与显示一致。
  - 全局 `aiProbability=0`，Groups 页显示应为 0。
- 订阅更新：
  - 模拟 feed 接口异常，确认 manual dynamic/live 仍推送。
- 黑名单：
  - 使用不同格式 QQ（number/string）均可正确拦截。
- MCP：
  - 触发 reload 失败，确认无残留连接。

### 6.3 已执行基线检查（当前状态）
- `npx mocha "test/unit/**/*.test.js" --exit`：通过
- `cd dashboard && npm run lint`：通过
- `python3 -m py_compile src/services/bili_server.py`：通过

## 7. 风险与回滚
- 风险点：
  - 群配置 `null` 清理可能改变旧数据行为（但符合“继承”语义，属于预期修正）。
  - Feed 检查流程重排可能影响请求节奏。
- 控制措施：
  - 分阶段提交，先 P1 后 P2/P3；
  - 每阶段完成后执行对应回归清单。
- 回滚策略：
  - 保留变更前配置快照（尤其 `config/config.js` 或实际配置文件）；
  - 若出现回归，先回滚对应模块（配置接口/运行时判定/feed 检查），再通过日志比对恢复。

## 8. 建议执行顺序与工时
1. P1-1 + P1-2 + P1-3（预计 0.5~1 天）
2. P2-1 + P2-2（预计 0.5 天）
3. P3-1 + 全量回归（预计 0.5 天）

合计预计：1.5~2 天（含测试与联调）。

## 9. 交付物
- 代码修复提交（按阶段拆分，便于回滚与审阅）。
- 新增/更新测试用例。
- 一份修复记录（变更点、验证结果、已知剩余风险）。
