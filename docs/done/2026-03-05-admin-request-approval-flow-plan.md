# 2026-03-05 管理员审批好友/群申请功能改造方案

## 1. 背景与目标

当前 Bot 能处理普通消息与部分 notice 事件，但尚未处理 OneBot `request` 事件（好友申请、加群申请、邀请入群）。

本次目标是实现：
1. 当收到好友申请/加群申请/邀请 Bot 入群时，第一时间私聊推送给 Root Admin。
2. Root Admin 通过回复“是/否”完成同意或拒绝。
3. 多条并发申请场景下，优先支持“引用消息回复”做精确审批，并提供“短编号”兜底。
4. 提供清晰的失败回执、幂等保护、超时失效与最小可行的补偿策略。

## 2. 范围与非目标

### 范围
1. `request` 事件接入（friend/group add/group invite）。
2. Admin 私聊审批交互（是/否 + 引用判定）。
3. 调用 NapCat action 执行审批（`set_friend_add_request` / `set_group_add_request`）。
4. 本地内存级待审批队列与状态管理。

### 非目标
1. 不做 WebUI 页面改造。
2. 不改现有群管理权限模型（沿用 `ADMIN_QQ` Root 私聊通道）。
3. 首版不做复杂聚合消息模板（先“一条申请一条通知”）。

## 3. 现状分析（代码）

1. 事件入口仅处理 `message` 与部分 `notice`，未处理 `post_type=request`。  
   文件：`src/bot.js`
2. 私聊消息仅允许 Root Admin，通过该通道可直接承载审批指令。  
   文件：`src/handlers/messageHandler.js`
3. 已有通用 action 调用能力 `callAction`，支持 echo 回包与超时。  
   文件：`src/services/notificationService.js`
4. Root Admin 身份来源于 `ADMIN_QQ`。  
   文件：`src/config.js`

## 4. NapCat 能力映射（基于仓库内接口索引）

从 `docs/napcat_interface/llms.txt` 可直接定位到：
1. `用户接口 -> 处理加好友请求`（对应 `set_friend_add_request`）。
2. `群组接口 -> 处理加群请求`（对应 `set_group_add_request`，可处理 add/invite）。
3. `系统接口 -> 获取群系统消息`（对应 `get_group_system_msg`，可用于补偿拉取）。

结论：能力满足“获取 + 操作”闭环，且与 OneBot 标准流程一致。

## 5. 交互设计（重点：多条申请与引用回复）

## 5.1 推送策略
1. 每条新申请到达时，立即私聊 Root Admin 一条通知消息。
2. 通知内容包含：
   - 申请类型（好友申请 / 加群申请 / 邀请入群）
   - 申请人 `user_id`
   - `group_id`（群相关事件）
   - 验证信息 `comment`（若有）
   - 内部短编号（如 `REQ-7F3A`）
   - 操作提示：`请引用本消息回复“是”或“否”`
   - 当前待处理数量
3. 发送通知必须拿到 `message_id`（用于“引用消息->待审批项”映射）。

## 5.2 审批判定规则（V2）
1. 优先规则（推荐路径）：
   - Admin 私聊消息包含 `reply` 段时，读取 `reply.data.id`。
   - 用该 `message_id` 精确匹配待审批项并执行。
2. 短编号兜底（无引用）：
   - 支持 `是 REQ-XXXX` / `否 REQ-XXXX`。
   - 通过 `shortId` 精确匹配待审批项并执行。
3. 非法引用：
   - 引用消息找不到对应待审批项（已处理/已过期/非审批消息）时，回复“该引用对应申请不存在或已处理”。
4. 严格保护：
   - 若“有引用但无效”，只提示错误，不回退到其他待审批项。
   - 若“无引用且无编号”，不消费审批，回到普通私聊处理链路。

## 5.3 文本语义
1. 同意词：`是`、`同意`、`yes`、`y`
2. 拒绝词：`否`、`拒绝`、`no`、`n`
3. 其余文本：忽略审批逻辑，继续走原私聊处理链路。
4. 仅有“是/否”但没有引用或编号：不触发审批执行。

## 6. 详细技术方案

## 6.1 新增服务：`requestApprovalService`

建议新文件：`src/services/requestApprovalService.js`

职责：
1. 接收/解析 request 事件。
2. 构建待审批项并去重入队。
3. 推送 admin 通知并记录通知消息 ID。
4. 解析 admin 回复并执行审批 action。
5. 管理状态机、超时与并发锁。

核心数据结构（内存）：
1. `pendingByKey: Map<string, PendingItem>`
2. `queue: string[]`（按创建时间顺序存 key，仅用于可视化与清理）
3. `keyByNotifyMessageId: Map<string, string>`（reply 定位）
4. `keyByShortId: Map<string, string>`（shortId 定位）
5. `inflightKeys: Set<string>`（防重复执行）

`PendingItem` 建议字段：
1. `key`：`request_type + ':' + (sub_type||'-') + ':' + flag`
2. `requestType`：`friend | group`
3. `subType`：`add | invite | null`
4. `flag`
5. `userId`
6. `groupId`
7. `comment`
8. `createdAt`
9. `expiresAt`
10. `status`：`PENDING | PROCESSING | APPROVED | REJECTED | FAILED | EXPIRED`
11. `notifyMessageId`
12. `shortId`（如 `REQ-7F3A`）
13. `retryCount`

## 6.2 事件接入点改造

文件：`src/bot.js`

新增处理分支：
1. `if (payload.post_type === 'request') { requestApprovalService.handleRequestEvent(ws, payload); return; }`
2. 放在 `message`/`notice` 分支附近，保证错误隔离与日志可读性。

处理范围：
1. `request_type=friend`
2. `request_type=group && sub_type=add`
3. `request_type=group && sub_type=invite`

## 6.3 Admin 私聊回复接入

文件：`src/handlers/messageHandler.js`

在“私聊 Root Admin 校验通过后、命令分发前”插入：
1. 调用 `requestApprovalService.tryHandleAdminDecision(ws, messageData)`。
2. 若返回 `true`，表示已消费该消息（执行审批或给出失败提示），直接 `return`。
3. 若返回 `false`，继续原有逻辑（命令/AI/链接）。

## 6.4 Action 执行策略

通过 `notificationService.callAction()` 调用：
1. 好友申请：
   - action: `set_friend_add_request`
   - params: `{ flag, approve, remark? }`
2. 群申请/邀请：
   - action: `set_group_add_request`
   - params: `{ flag, sub_type, approve, reason? }`

执行后判定：
1. 成功：`status` 更新为 `APPROVED/REJECTED`，从 `pendingByKey`、`queue`、`keyByNotifyMessageId`、`keyByShortId` 移除。
2. 失败：`status=FAILED`，返回错误原因，并允许 admin 再次回复重试（可配置重试上限）。

## 6.5 幂等与并发控制

1. 去重规则：
   - 以 `key`（含 `flag`）去重。
   - 重复上报只刷新可见信息（如 comment），不重复推送通知（可记录重复次数）。
2. 并发锁：
   - 执行审批前先 `inflightKeys.add(key)`。
   - finally 中释放锁。
3. 重复回复：
   - 若 key 不在 `PENDING`，回执“该申请已处理或失效”。

## 6.6 过期与清理

1. 默认 TTL：24 小时（可后续配置化）。
2. 定时清理：
   - 每 5 分钟扫描 `PENDING` 项，超时转 `EXPIRED` 并移除。
3. 回复过期项：
   - 明确提示“申请已过期，无法处理”。

## 6.7 重连/重启策略

首版（MVP）：
1. 仅内存队列，不做落盘恢复。
2. 进程重启后旧待审批项丢失，可接受。

增强版（二期）：
1. 启动时调用 `get_group_system_msg` 对群 add/invite 做补偿拉取。
2. 可选落盘 `data/pending_requests.json` 恢复未处理状态。

## 7. 文件级改造清单

1. 新增：`src/services/requestApprovalService.js`
2. 修改：`src/bot.js`
   - 增加 `request` 事件路由
3. 修改：`src/handlers/messageHandler.js`
   - 增加 admin 私聊审批拦截
4. 可选修改：`src/services/notificationService.js`
   - 若现有 `send_private_msg` 发送链路拿不到 `message_id`，新增 `sendPrivateMessageWithAck()` 封装（内部走 `callAction`）
5. 可选新增：`src/utils/requestApprovalParser.js`
   - 抽离“引用解析 + 是/否语义解析”纯函数，便于单测

## 8. 关键伪代码

```js
// bot.js
if (payload.post_type === 'request') {
  requestApprovalService.handleRequestEvent(ws, payload)
  return
}
```

```js
// messageHandler.js (private root admin path)
const consumed = await requestApprovalService.tryHandleAdminDecision(ws, messageData)
if (consumed) return
```

```js
// requestApprovalService.js
async function tryHandleAdminDecision(ws, messageData) {
  const decision = parseDecision(rawMessage) // approve/reject/null
  if (!decision) return false

  const targetKey = resolveTargetByReplyFirstThenShortId(messageData)
  if (!targetKey) {
    return false // 回到普通私聊链路
  }

  if (inflightKeys.has(targetKey)) {
    notifyAdmin('该申请正在处理中，请稍后')
    return true
  }

  await executeDecision(targetKey, decision)
  return true
}
```

## 9. 日志与可观测性

建议统一日志前缀：`[RequestApproval]`

关键日志点：
1. 收到新申请（含 key、type、user/group）
2. 推送 admin 成功/失败（含 notifyMessageId）
3. admin 回复命中方式（reply/shortId）
4. action 调用结果（retcode、message）
5. 过期清理数量

## 10. 测试计划

## 10.1 单元测试

建议新增：`test/unit/requestApprovalService.test.js`

覆盖点：
1. `key` 生成与去重
2. 语义解析（是/否/其他）
3. reply 命中逻辑
4. shortId 兜底逻辑
5. 过期与状态转移

## 10.2 集成验证（本地）

1. 单条 friend 申请：
   - 收到通知
   - admin 引用回复“是”成功通过
2. 单条 group add 申请：
   - admin 引用回复“否”成功拒绝
3. 单条 group invite：
   - 同意路径正常
4. 三条并发申请：
   - 分别通知
   - 引用第二条回复“否”，必须只影响第二条
5. 无引用无编号：
   - 不消费审批消息，回到普通私聊链路
6. 无引用 + 编号：
   - 按 `shortId` 精确处理目标申请
6. 重复回复同一条：
   - 第二次提示“已处理/失效”
7. action 失败模拟：
   - 进入 FAILED，允许重试

## 11. 风险与缓解

1. 风险：通知消息回包缺少 `message_id` 时，引用链路失效。
   - 缓解：保留 shortId 兜底，允许 `是/否 + 编号` 精确审批。
2. 风险：不同 NapCat 版本 reply 消息段结构差异。
   - 缓解：解析器兼容 `reply.data.id` 与常见别名字段，并记录原始消息样本日志。
3. 风险：进程重启导致内存待审批丢失。
   - 缓解：一期接受；二期补 `get_group_system_msg` + 落盘恢复。

## 12. 里程碑

1. M1（MVP）：
   - request 事件接入
   - admin 通知
   - 引用优先审批 + shortId 兜底
   - 基础测试通过
2. M2（增强）：
   - 补偿拉取（`get_group_system_msg`）
   - 待审批落盘恢复
   - 更完善的统计与告警

## 13. 验收标准（DoD）

1. friend/group add/group invite 三类申请均可被捕获并推送到 Root Admin。
2. Root Admin 回复“是/否”可触发正确 action。
3. 多条并发时，引用消息回复可精确命中目标申请。
4. 无引用无编号不触发审批，无效引用/编号会明确提示，不出现误审批或 silent failure。
5. 已处理、过期、失败重试路径均有明确回执与日志。
6. 不影响现有普通消息处理、命令、AI、链接解析主链路。
