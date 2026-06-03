# 关闭群功能期间订阅内容不补发方案

## 背景

当前发现一个订阅推送行为缺陷：关闭某个群的 Bot 功能后，关闭期间产生的 B 站订阅内容不会发送；但当该群重新开启 Bot 功能后，系统可能把关闭期间积累的内容补发出来。

用户期望是：

1. 群功能关闭期间，订阅推送对该群静默跳过。
2. 重新开启群功能后，只接收开启之后的新内容。
3. 不影响其他仍开启群的正常订阅推送、失败重试、去重和补偿能力。

本方案只设计后续实现，不在本文档创建时修改代码。

## 当前代码事实

### 群功能开关

`enabledGroups` 使用白名单语义：

1. 空数组表示所有群开启。
2. 关闭单个群时，WebUI toggle 会先把当前群列表展开成显式白名单，再移除目标群。
3. `config.isGroupEnabled(groupId)` 最终判断群是否可用。

相关位置：

1. `src/config/groupConfig.js`
   - `isGroupEnabled(enabledGroups, groupId)`
   - `enableGroup(enabledGroups, groupId, saveFn)`
   - `disableGroup(enabledGroups, groupId, saveFn)`
2. `src/dashboard/routes/api/modules/groups.js`
   - `POST /api/groups/:id/toggle`

### 订阅周期目标群

`updateChecker.checkAll()` 构造 `activeGroups` 时，目前只排除 `groupConfig.isInGroup === false` 的群。它没有直接排除 `config.isGroupEnabled(groupId) === false` 的群。

随后各检查路径会使用 `activeGroups` 参与目标解析：

1. Cookie feed dynamic/live：
   - `checkFeedUpdate(feedCoverage, activeGroups)`
   - `processDynamicFeed(accountUid, groupId, activeGroups)`
   - `processLiveFeed(accountUid, groupId, activeGroups)`
2. 手动订阅 dynamic/live：
   - `sub.groupIds.filter(gid => activeGroups.has(gid))`
3. 视频/专栏统一检查：
   - `buildUserCheckList(activeGroups)`
   - `checkUserVideoUnified(userItem)`
   - `checkUserArticleUnified(userItem)`
4. 番剧：
   - `checkBangumi(sub, targetGroups)`

### 发送前过滤

订阅发送前会调用：

```js
canReceiveSubscriptionNotification(groupId)
```

它要求：

1. 群仍在服务范围内，即 `isInGroup !== false`。
2. 群功能开启，即 `config.isGroupEnabled(groupId)`。

在 `notifyGroups()` 和 `notifyGroupsWithImage()` 里，无法接收的群目前会记入 `ledgerSkippedGroups`，但不会进入 `successGroups`、`dedupSkippedGroups` 或 `failedGroups`。

### 状态推进与 delivery ledger

当前状态推进策略：

1. `decideAdvance(result)` 只有 `successGroups.length > 0` 或 `dedupSkippedGroups.length > 0` 时返回 `advance`。
2. `recordNotifyDeliveredGroups(contentType, contentId, notifyResult, extraGroups)` 只会把 `successGroups`、`dedupSkippedGroups` 和 `extraGroups` 写入 `subscription_delivery.json`。
3. `ledgerSkippedGroups` 不会写入持久 delivery ledger。
4. `getUndeliveredGroupSourceMap()` 会基于 delivery ledger 找缺失群，并通过 target baseline 判断是否允许补发。

因此关闭群期间会出现两类问题：

1. 部分群开启、部分群关闭：
   - 开启群成功收到内容，写入 delivery ledger。
   - 关闭群被 `ledgerSkippedGroups` 跳过，但没有 tombstone。
   - 重新开启后，关闭群可能被识别为缺失投递目标并补发。
2. 所有目标群关闭：
   - 没有 success/dedup skipped。
   - `decideAdvance()` 返回 `skip/no_targets`。
   - 用户级或番剧级水位不推进。
   - 重新开启后，关闭期间内容仍被当作新内容推送。

## 目标行为合同

### 核心合同

关闭群功能期间的订阅内容，对该群应视为“静默消费”，不是“发送失败”，也不是“待补偿缺口”。

重新开启群功能后：

1. 不补发关闭期间的动态、视频、专栏、直播开播和番剧更新。
2. 仍能正常发送重新开启之后出现的新内容。
3. 仍能补偿真实发送失败导致的缺失投递。

### 非目标

本次不改变以下行为：

1. 不改变群功能开关的 `enabledGroups` 白名单语义。
2. 不改变退群或 `isInGroup === false` 的清理语义。
3. 不取消真实发送失败后的重试能力。
4. 不改变用户手动 `check now` 或 force check 的显式强制推送语义，除非调用方本来就要求遵守群开关。
5. 不重构订阅存储格式为全新的 schema。

## 方案总览

引入一个明确的新结果语义：`disabledSkippedGroups`。

含义：

1. 群仍在服务范围内。
2. 群存在于本轮订阅目标内。
3. 但群功能关闭，所以本轮对该群静默跳过。
4. 该跳过应写入 delivery tombstone，且允许订阅水位推进。

区别：

| 结果字段 | 含义 | 是否真实发送 | 是否允许推进水位 | 是否写 delivery tombstone | 是否后续补发 |
| --- | --- | --- | --- | --- | --- |
| `successGroups` | 实际发送成功 | 是 | 是 | 是 | 否 |
| `dedupSkippedGroups` | 短期去重命中，等价已覆盖 | 否 | 是 | 是 | 否 |
| `disabledSkippedGroups` | 群功能关闭，静默消费 | 否 | 是 | 是 | 否 |
| `ledgerSkippedGroups` | 不适合发送但不一定可消费 | 否 | 否，除非同时在上面字段 | 否 | 视 baseline/ledger |
| `failedGroups` | 真实发送失败 | 否 | 否 | 否 | 是 |

## 详细设计

### 1. 扩展 notify result 结构

修改 `src/services/subscription/updateChecker/modules/notify.js`：

1. `createNotifyResult()` 增加：

```js
disabledSkippedGroups: []
```

2. 增加 helper：

```js
function recordDisabledSkipped(result, gid) {
    pushUniqueGroup(result.disabledSkippedGroups, gid)
    recordLedgerSkipped(result, gid)
}
```

保留 `ledgerSkippedGroups` 是为了兼容现有日志和测试语义，但新增字段表达“这是可消费跳过”。

### 2. 区分关闭群和其他不可达群

当前发送前直接调用 `canReceiveSubscriptionNotification(gid)`，结果只有 boolean。实现时建议拆出更细的判定：

```js
function getSubscriptionNotificationReachability(groupId) {
    const gid = normalizeGroupId(groupId)
    if (!gid) return { ok: false, reason: 'invalid_group' }
    if (!isGroupInService(gid)) return { ok: false, reason: 'not_in_group' }
    if (!config.isGroupEnabled(gid)) return { ok: false, reason: 'group_disabled' }
    return { ok: true, reason: 'ok' }
}
```

保留原 `canReceiveSubscriptionNotification(groupId)` 作为兼容包装：

```js
function canReceiveSubscriptionNotification(groupId) {
    return getSubscriptionNotificationReachability(groupId).ok
}
```

然后在 `notifyGroups()` 和 `notifyGroupsWithImage()` 中：

1. 如果 `reason === 'group_disabled'`：
   - 调用 `recordDisabledSkipped(result, gid)`。
   - 不发送。
2. 如果 `reason === 'not_in_group'` 或其他不可达：
   - 保持原有 `recordLedgerSkipped(result, gid)` 或现有失败语义。

这样不会把退群、无效群、群功能关闭混成同一种结果。

### 3. 让 disabled skip 可推进水位

修改 `src/services/subscription/updateChecker/helpers/stateAdvance.js`：

```js
const disabledSkippedGroups = Array.isArray(result?.disabledSkippedGroups)
    ? result.disabledSkippedGroups
    : []

if (
    successGroups.length > 0 ||
    dedupSkippedGroups.length > 0 ||
    disabledSkippedGroups.length > 0
) {
    return { action: 'advance', reason: 'has_covered_target' }
}
```

兼容性建议：

1. 当前测试可能断言 reason 是 `has_success`。
2. 为减少影响，可以保留 `reason: 'has_success'`，但语义会不准确。
3. 推荐改成 `has_covered_target`，并同步调整测试断言。

行为影响：

1. 全部目标群关闭时，动态/视频/专栏/直播会推进水位，不会重启后补发。
2. 部分群关闭时，关闭群会被视为已覆盖，不阻塞全局水位推进。
3. 真实发送失败仍不会推进，因为它只进入 `failedGroups`。

### 4. 把 disabled skip 写入 delivery tombstone

修改 `src/services/subscription/updateChecker/modules/targeting.js`：

```js
async recordNotifyDeliveredGroups(contentType, contentId, notifyResult, extraGroups = []) {
    const deliveredGroups = [
        ...(Array.isArray(notifyResult?.successGroups) ? notifyResult.successGroups : []),
        ...(Array.isArray(notifyResult?.dedupSkippedGroups) ? notifyResult.dedupSkippedGroups : []),
        ...(Array.isArray(notifyResult?.disabledSkippedGroups) ? notifyResult.disabledSkippedGroups : []),
        ...(Array.isArray(extraGroups) ? extraGroups : [])
    ]
    await this.recordDeliveredGroups(contentType, contentId, deliveredGroups)
}
```

建议同时让 `recordDeliveredGroups()` 支持可选 meta reason，但不是必要条件。最小实现可以沿用当前 meta：

```js
meta: { source: 'updateChecker' }
```

更完整实现可增加：

```js
meta: { source: 'updateChecker', reason: 'group_disabled' }
```

不过如果同一批里既有成功群又有 disabled 群，当前 `recordDeliveredGroups()` 对所有 group 使用统一 meta，不适合直接混入 reason。为保持改动小且避免破坏现有台账格式，第一阶段可以不区分 meta reason，只靠结果日志保留语义。

### 5. notifyGroupsWithImageAndCache 返回新字段

`notifyGroupsWithImageAndCache()` 当前显式重组返回对象，需要增加：

```js
disabledSkippedGroups: Array.isArray(notifyResult?.disabledSkippedGroups)
    ? notifyResult.disabledSkippedGroups
    : []
```

否则上层 checker 无法看到该字段。

### 6. 番剧路径的处理

`checkBangumi()` 仍使用 legacy `lastEpId`，没有 per-group delivery ledger。它的关键点是 `decideAdvance(notifyResult)`。

增加 `disabledSkippedGroups` 可推进后：

1. 所有番剧订阅目标群都关闭时，`notifyGroupsWithImageAndCache()` 返回 disabled skip。
2. `decideAdvance()` 返回 advance。
3. `lastEpId` 更新为最新集。
4. 重新开启后不会补发关闭期间番剧更新。

这不需要给番剧新增完整 delivery ledger。

### 7. activeGroups 是否要过滤 disabled 群

不建议第一阶段在 `checkAll()` 的 `activeGroups` 中直接过滤 disabled 群。

原因：

1. 如果 disabled 群被提前过滤，后续 checker 根本看不到这些群，无法写 tombstone 或推进“该群已静默消费”的语义。
2. 部分开启、部分关闭时，关闭群仍需要进入目标解析，才能记录为 `disabledSkippedGroups`。
3. 真正不应参与订阅的是 `isInGroup === false`，它和“群功能关闭但仍在群内”是不同生命周期。

因此建议：

1. `activeGroups` 继续表示“Bot 仍在群内/群未被移除”。
2. `notify` 层负责把 enabled 状态转成可消费的 disabled skip。

## 兼容性与负面影响控制

### 不影响真实发送失败重试

真实发送失败仍进入 `failedGroups` 和 `retryableGroups`，不会进入 `disabledSkippedGroups`。因此：

1. WebSocket 不可用不会被误判为静默消费。
2. NapCat 发送失败不会被吞掉。
3. 超时、网络异常仍保留重试和告警价值。

### 不影响短期去重

`dedupSkippedGroups` 保持原语义：短期缓存命中，写 tombstone 并允许推进。

新增的 `disabledSkippedGroups` 只补充“群关闭”场景，不改变 dedup 逻辑。

### 不影响退群清理

`isInGroup === false` 不应进入 `disabledSkippedGroups`。退群属于目标失效或配置清理，不应被当成“关闭期间静默消费”。

### 不影响链接解析和普通群消息

改动范围只在订阅 updateChecker 的 notify/state/delivery 路径，不触碰：

1. 普通 B 站链接解析。
2. messageHandler 群消息早期 guard。
3. WebUI 群开关 API 语义。
4. preview renderer。

### 不扩大补发范围

新增 tombstone 会减少关闭群开启后的历史补发，不会让更多历史内容被补发。

保留原 delivery ledger 的 partial retry 能力：

1. 开启群真实发送失败：仍缺失 delivery，后续可补偿。
2. 关闭群静默跳过：写 tombstone，后续不补偿。

## 测试计划

### 单元测试 1：reachability 分类

新增或扩展 `test/unit/subscriptions/subscription-group-reachability.test.js`：

1. `isInGroup !== false` 且 `isGroupEnabled === true`：
   - `ok: true`
   - `reason: 'ok'`
2. `isInGroup === false`：
   - `ok: false`
   - `reason: 'not_in_group'`
3. `isInGroup !== false` 但 `isGroupEnabled === false`：
   - `ok: false`
   - `reason: 'group_disabled'`

### 单元测试 2：notify result 字段

扩展 `test/unit/subscriptions/updateChecker-notify-result.test.js`：

1. `notifyGroupsWithImage()` 遇到关闭群：
   - `successGroups: []`
   - `failedGroups: []`
   - `disabledSkippedGroups: ['1000']`
   - `ledgerSkippedGroups: ['1000']`
2. `notifyGroupsWithImageAndCache()` 返回对象包含 `disabledSkippedGroups`。
3. 关闭群不调用 `notificationHistory.add()`。
4. 关闭群不调用真实发送函数。

### 单元测试 3：state advance policy

扩展 `test/unit/subscriptions/subscription-state-advance-policy.test.js`：

1. 只有 `disabledSkippedGroups` 时返回 `advance`。
2. 只有 `ledgerSkippedGroups` 时仍返回 `skip/no_targets`。
3. 只有 `failedGroups` 时仍返回 `retry/no_success`。

### 单元测试 4：delivery tombstone

扩展 targeting 或动态 fallback ledger 测试：

1. `recordNotifyDeliveredGroups('dynamic', '300', { disabledSkippedGroups: ['B'] })` 后，`subscription_delivery.json` 中存在 `B:dynamic:300`。
2. 后续 `getUndeliveredGroupSourceMap()` 不再返回 B。

### 单元测试 5：动态混合群

构造：

1. A 群开启，B 群关闭。
2. 用户 UID 123 的动态 300 出现。
3. notify 返回：
   - `successGroups: ['A']`
   - `disabledSkippedGroups: ['B']`
4. 断言：
   - 水位推进到 300。
   - delivery ledger 同时记录 A 和 B。
   - B 重新开启后不会补发 300。

### 单元测试 6：全部目标群关闭

动态、视频、专栏、直播至少覆盖动态和视频两个代表路径：

1. 所有目标群关闭。
2. notify 返回 `disabledSkippedGroups`。
3. 断言水位推进。
4. 断言无真实发送。
5. 重新开启后不补发同一 contentId。

### 单元测试 7：番剧

构造：

1. 番剧 `lastEpId = 1`。
2. 最新集为 2。
3. 目标群关闭。
4. notify 返回 `disabledSkippedGroups`。
5. 断言 `updateBangumiSub(seasonId, { lastEpId: 2 })` 被调用。
6. 断言没有真实发送。

## 验证命令建议

后续实现后，最小验证：

```bash
node test/runners/run-unit-tests.js test/unit/subscriptions/subscription-group-reachability.test.js
node test/runners/run-unit-tests.js test/unit/subscriptions/updateChecker-notify-result.test.js
node test/runners/run-unit-tests.js test/unit/subscriptions/subscription-state-advance-policy.test.js
node test/runners/run-unit-tests.js test/unit/subscriptions/updateChecker-dynamic-fallback-ledger.test.js
```

如果实现涉及视频/专栏/番剧测试，追加：

```bash
node test/runners/run-unit-tests.js test/unit/subscriptions/updateChecker-unified-state-advance.test.js
node test/runners/run-unit-tests.js test/unit/subscriptions/updateChecker-manual-logging.test.js
```

## 实施顺序

1. 增加 reachability 分类函数，保留现有 boolean wrapper。
2. 扩展 notify result 结构和 disabled skip 记录。
3. 扩展 `notifyGroups()`、`notifyGroupsWithImage()` 和 `notifyGroupsWithImageAndCache()`。
4. 扩展 `decideAdvance()`。
5. 扩展 `recordNotifyDeliveredGroups()`。
6. 补单元测试。
7. 运行最小订阅测试集。

## 回滚方案

如果上线后发现行为异常，可以按以下方式回滚：

1. 删除 `disabledSkippedGroups` 推进逻辑，让 `decideAdvance()` 恢复只看 `successGroups` 和 `dedupSkippedGroups`。
2. 删除 `recordNotifyDeliveredGroups()` 对 `disabledSkippedGroups` 的记录。
3. 保留 reachability 分类函数也不影响旧逻辑；如果要完全回滚，可恢复 notify 层调用 `canReceiveSubscriptionNotification()` 的原 boolean 判定。

已写入的 delivery tombstone 会让关闭期间内容不再补发。这个结果符合本需求；如果需要强制补发，只能通过手动 force check 或清理对应 delivery records，不建议自动回滚。

## 风险评估

### 低风险

1. 不改群开关配置存储。
2. 不改订阅目标解析主流程。
3. 不改真实发送函数。
4. 新字段是向后兼容扩展。

### 中风险

1. `decideAdvance()` 的语义从“有真实成功才推进”扩展为“有可覆盖目标就推进”。
2. 如果某处调用 notify 时传入的目标群未经过业务意图过滤，关闭群会被静默消费。

缓解方式：

1. `disabledSkippedGroups` 只在明确 `group_disabled` 时产生。
2. `not_in_group`、WS 不可用、发送失败不进入 disabled skip。
3. 单测覆盖 no_targets、failed、ledgerSkipped、disabledSkipped 的差异。

## 最终验收标准

1. 关闭群功能后，关闭期间动态/视频/专栏/直播/番剧不发送。
2. 重新开启群功能后，不补发关闭期间内容。
3. 重新开启后，新产生的订阅内容正常发送。
4. 其他开启群不受影响，仍正常收到订阅内容。
5. 真实发送失败仍可重试，不被误认为已消费。
6. 去重命中仍写 tombstone，不被本次改动破坏。
