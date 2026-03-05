# 2026-03-05 WebUI 移除私聊管理与群管理一致性修复方案

## 背景
当前系统支持 Root 私聊入口（`message_type=private`）并将其映射为虚拟群 ID（`private_<userId>`）。

该设计在消息处理链路可工作，但在 WebUI 与配置/订阅管理域出现了“半支持”状态：
1. WebUI 列表会混入 `private_*`，但大部分群管理接口对其返回 404 或行为异常。
2. 不同 API 对 groupId 的合法性判定不一致，导致同一个 ID 在部分页面可写、部分页面不可写。
3. `isEnabled` 的展示语义与运行时语义不一致，造成“显示禁用但实际可用”的误导。
4. 命令侧仍允许在 Root 私聊中执行群级命令，持续产生伪群配置/订阅污染。

## 目标
1. 明确并落地：**WebUI 不支持私聊管理**。
2. 统一“可管理群”判定规则，消除路由行为分裂。
3. 修复 `isEnabled` 展示与运行时不一致问题。
4. 阻断新增 `private_*` 污染，并清理历史脏数据。
5. 保持 Root 私聊核心能力（聊天/AI/链接解析/下载）不受影响。

## 非目标
1. 不新增“私聊会话管理”页面或私聊配置域模型。
2. 不重构整个订阅推送架构（仅在本方案范围内做保护与一致性修复）。
3. 不改变现有群聊业务能力与权限模型。

## 现状问题与影响

### P0: WebUI 启用状态显示错误
- 运行时 `config.isGroupEnabled(groupId)` 语义：`enabledGroups` 为空时“全部启用”。
- `/api/groups` 当前返回 `isEnabled: enabledGroups.has(groupIdStr)`，空白名单下会显示全部禁用。
- 影响：运维误判功能状态，且配合 toggle 操作会出现反直觉结果。

### P0: 路由校验不一致
- `POST /api/groups/:id/toggle`、`POST /api/groups/:id/config` 强依赖 `bot.groupList`。
- `group-ai`、`group-video-download` 又允许对任意字符串 `groupId` 写配置（会 `ensureGroupConfig`）。
- 影响：同一 ID 在不同页面可写性不同，产生“局部成功”与脏数据。

### P1: WebUI 混入私聊伪群
- `/api/groups` 聚合来源包含 `groupConfigs`，导致 `private_*` 进入群列表。
- 影响：页面出现“群组 private_xxx”，操作失败率高且概念混乱。

### P1: 命令侧持续写入伪群数据
- Root 私聊执行群级命令时，`groupId=private_*` 仍可参与配置/订阅写入。
- 影响：历史脏数据持续增长，后续维护成本上升。

### P1: 订阅推送对伪群不可达
- 推送主链路使用 `send_group_msg`，对 `private_*` 不成立。
- 影响：Root 私聊中误建订阅后，后续推送失败并产生错误日志噪声。

## 关键结论：Root 私聊功能是否有缺失
有缺失，但范围可界定：
1. **存在缺失**：Root 私聊下的“群级能力”本就不完整（订阅推送不可达、群配置语义不成立）。
2. **不受本方案影响**：Root 私聊的核心即时能力（AI 聊天、链接解析、视频下载发送私聊）可保持正常。
3. **本方案策略**：明确禁止“私聊做群级管理”，避免伪成功；不是削弱可用能力，而是收敛边界。

## 统一设计

### 1. 统一 ID 分类
新增统一判定函数（建议放在 `src/dashboard/routes/api/shared/normalize.js`）：
- `isPrivateVirtualGroupId(groupId)`：`^private_\d+$`
- `isNumericGroupId(groupId)`：`^\d+$`
- `isManageableWebuiGroupId(groupId)`：仅允许数字群号

并新增统一断言（建议 `src/dashboard/routes/api/shared/group-guard.js`）：
- `assertWebuiManageableGroup(req, res, { requireInGroup?: boolean, allowLeftGroup?: boolean })`
- 失败策略：
  - 私聊 ID：`400 { error: 'WebUI 不支持私聊会话管理' }`
  - 非法 ID：`400 { error: 'Invalid groupId' }`
  - 不存在群：`404 { error: 'Group not found' }`

### 2. `/api/groups` 只返回“群管理域”数据
- 聚合前过滤：仅保留数字群号。
- `private_*`、其他非数字键在服务端直接忽略，不返回前端。

### 3. `isEnabled` 与运行时语义对齐
在 `/api/groups` 返回中改为：
- 若 `enabledGroups` 为空：`isEnabled = true`
- 否则：`isEnabled = enabledGroups.includes(groupIdStr)`

### 4. toggle 逻辑修复（白名单空集语义）
当前语义下“空集=全开”，直接 push/splice 会导致行为反直觉。修复为：
- 当 `enabledGroups` 为空且用户请求“禁用某群”时：
  1. 先构建当前“在群的所有数字群号”白名单；
  2. 再移除目标群。
- 当用户请求“启用某群”时：确保目标群在白名单中。
- 这样 UI 行为与用户直觉一致。

### 5. 各模块路由统一接入 guard
以下路由必须统一拒绝私聊 ID：
1. `modules/groups.js`
   - `POST /groups/:id/toggle`
   - `POST /groups/:id/config`
   - `DELETE /groups/:id`
2. `modules/subscriptions.js`
   - `GET /groups/:id/subscriptions`
   - `GET /groups/:id/atall-targets`
   - `POST /groups/:id/subscriptions`
   - `DELETE /groups/:id/subscriptions`
3. `modules/group-ai.js`
   - `GET/PUT/DELETE /groups/:groupId/ai-config`
4. `modules/group-video-download.js`
   - `GET/PUT/DELETE /groups/:groupId/video-download-config`

策略：全部按“群管理域”处理，仅数字群号可访问。

### 6. 命令侧私聊群级能力硬拦截
在命令层统一加判定：`if (groupId startsWith('private_'))` 时拒绝群级管理命令。

建议拦截范围：
1. `subscription` 命令（订阅/取消订阅/订阅列表管理动作）
2. `settings` 中群配置类命令（功能开关、关注同步、AT全体、标签、群管理员管理等）
3. `admin` 中需要群维度数据的命令（若输入目标群为私聊则拒绝）
4. `download` 中涉及群配置管理的命令（`/下载状态`、`/清理下载` 视设计可保留为 Root 全局运维命令或显式私聊可用；需统一文案）

统一回复文案：
`私聊仅支持聊天/AI/链接解析/下载，不支持群配置与订阅管理。请在目标群聊或 WebUI 操作。`

### 7. 历史数据迁移与清理
新增一次性迁移（启动期或手工脚本）：
1. 删除 `config.groupConfigs` 中所有 `private_*` 键。
2. 从 `config.enabledGroups` 移除所有非数字 ID。
3. 订阅数据中，移除所有 `groupIds` 里的 `private_*`。
4. 迁移日志输出：删除条目数、受影响订阅数。

建议提供 `dry-run` 模式先观测影响再执行。

## 详细改造清单（文件级）

### A. WebUI API 侧
1. `src/dashboard/routes/api/shared/normalize.js`
   - 新增：`isPrivateVirtualGroupId`、`isNumericGroupId`。
2. `src/dashboard/routes/api/shared/group-guard.js`（新文件）
   - 实现统一 groupId 校验与可管理性断言。
3. `src/dashboard/routes/api/modules/groups.js`
   - `/groups`：过滤非数字 ID；修正 `isEnabled` 计算。
   - `/groups/:id/toggle`：接入 guard；修复空白名单 toggle 行为。
   - `/groups/:id/config`、`/groups/:id`：接入 guard。
4. `src/dashboard/routes/api/modules/subscriptions.js`
   - 全路由接入 guard，统一拒绝私聊 ID。
5. `src/dashboard/routes/api/modules/group-ai.js`
   - 全路由接入 guard，避免任意字符串 groupId 被写入。
6. `src/dashboard/routes/api/modules/group-video-download.js`
   - 全路由接入 guard，避免任意字符串 groupId 被写入。

### B. 命令与运行时保护
1. `src/commands/subscription.js`
   - 入口增加私聊群级命令拒绝。
2. `src/commands/settings.js`
   - 入口增加私聊群级命令拒绝（保留必要的私聊可用子命令时需白名单化）。
3. `src/commands/admin.js`（按需）
   - 对群维操作增加私聊拒绝。
4. `src/handlers/messageHandler.js`（可选）
   - 增加统一辅助方法 `isPrivateVirtualGroup(groupId)`，供命令层复用。

### C. 数据迁移
1. 新增脚本：`scripts/migrations/cleanup-private-group-artifacts.js`（建议）
   - 支持 `--dry-run`。
   - 清理 `config` 与订阅持久化中的 `private_*`。
2. 在 `src/bot.js` 启动阶段调用（可配置开关），或文档化为手工执行步骤。

## 接口行为规范（修复后）
1. 若 `groupId=private_123` 调用任何群管理 API：`400`。
2. 若 `groupId=abc`：`400`。
3. 若 `groupId` 为数字但不在可管理范围：`404`。
4. `/api/groups` 不再出现 `private_*`。
5. `isEnabled` 在空白名单配置下对所有返回群均为 `true`。

## 测试与验收

### 一、接口测试
1. `GET /api/groups`
   - 不含 `private_*`。
   - 空白名单场景所有群 `isEnabled=true`。
2. `POST /api/groups/private_123/toggle`
   - 返回 `400` 且文案为“不支持私聊会话管理”。
3. `PUT /api/groups/private_123/ai-config`
   - 返回 `400`。
4. `PUT /api/groups/private_123/video-download-config`
   - 返回 `400`。
5. `GET /api/groups/private_123/subscriptions`
   - 返回 `400`。

### 二、命令行为测试
1. Root 私聊发送群级命令（如 `/订阅用户 2`）
   - 被明确拒绝，提示去群聊/WebUI。
2. Root 私聊发送聊天/AI/链接
   - 功能正常。
3. 群聊命令
   - 现有功能无回归。

### 三、迁移测试
1. 构造含 `private_*` 的 config 与订阅数据。
2. `dry-run` 输出受影响项正确。
3. 执行清理后再次检查：
   - `groupConfigs` 无 `private_*`
   - `enabledGroups` 全为数字
   - 订阅 `groupIds` 无 `private_*`

## 发布与回滚

### 发布顺序
1. 先发 API guard + `/api/groups` 过滤 + `isEnabled` 修复。
2. 再发命令层私聊群级拦截。
3. 最后执行历史数据清理脚本。

### 回滚策略
1. 可按模块回滚（API、命令、迁移脚本独立）。
2. 若迁移已执行，需保留迁移前备份（建议自动备份 `config.json` 与订阅文件）。

## 风险与缓解
1. 风险：误伤历史“非数字但业务上有效”的特殊 ID。
   - 缓解：上线前先跑审计脚本输出全量 ID 分布并人工确认。
2. 风险：用户依赖了“私聊下群级命令”的非预期行为。
   - 缓解：命令返回明确迁移提示，公告变更边界。
3. 风险：toggle 修复改动白名单行为，可能影响旧习惯。
   - 缓解：增加回归测试覆盖“空白名单/非空白名单”两种状态。

## DoD（完成标准）
1. WebUI 群管理视图与 API 全面拒绝 `private_*`。
2. `isEnabled` 展示与运行时语义一致。
3. 群管理相关 API 的 groupId 校验规则完全一致。
4. Root 私聊不再能触发群级配置/订阅写入。
5. 历史 `private_*` 脏数据已清理并可审计。
6. Root 私聊核心即时能力无回归。
