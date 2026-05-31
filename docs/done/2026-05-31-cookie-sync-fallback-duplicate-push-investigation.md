# 2026-05-31 Cookie 同步失败与重复订阅推送调查

## 现象

2026-05-31 02:40 左右，Bot 向 root admin 私聊发送：

`[Bot通知] ⚠️ B站关注列表同步失败（1个群均失败），订阅推送可能中断。请检查Cookie状态。`

随后群 `1065812436` 出现多条此前已经发送过的动态订阅推送。

## 线上证据

- 容器 `bili-qq-bot` 连续运行 8 天，事故不是容器重启或冷启动导致。
- 02:39:41 开始的 `/my_info` 请求在 02:40:12 超时失败，耗时约 31 秒。
- 02:39:44 开始的 `/dynamic_feed` 请求在 02:40:15 超时失败，耗时约 30 秒。
- Python 堆栈显示 `aiohttp` 连接阶段 `asyncio.TimeoutError`，不是明确的 Cookie 失效响应。
- 02:40:12 由于 `refreshCookieFollowings()` 中唯一启用同步的群失败，触发 “1个群均失败” 私聊告警。
- 02:40:17 动态流检查记录为 `dynamicSucceeded=false`，因此 `feedCoverage.dynamicUids` 为 0。
- 02:40:17 起，系统回退执行全部手动订阅用户的 `dynamic-check`。
- 02:40:27 至 02:41:12，群 `1065812436` 记录了 10 条动态推送去重历史：
  - `1207816499573555240`
  - `1207728800645775378`
  - `1208120853850488834`
  - `1208184934755205122`
  - `1206628601808551937`
  - `1207307167949914131`
  - `1207489841549279265`
  - `1207851473472323600`
  - `1208042243068264450`
  - `1208256862548394009`
- 02:49 之后动态流恢复成功，后续每轮 `dynamicSucceeded=true`，说明 Cookie 本身并未持续失效。

## 根因

这是两个独立问题叠加造成的。

### 1. 短暂 B 站接口超时被误报为 Cookie 同步失败

`refreshCookieFollowings()` 每小时调用 `/my_info` 判断登录账号。02:39:41 的 `/my_info` 请求在连接阶段超时，返回 `status=error`。当前逻辑无法区分“Cookie 失效”和“B 站网络/接口短暂超时”，因此在所有启用同步的群都失败时直接发送“请检查Cookie状态”告警。

### 2. Cookie 动态流失败后回退到手动动态检查，但手动锚点长期滞后

正常情况下，Cookie 动态流成功后会把相关 UID 加入 `feedCoverage.dynamicUids`，`checkAll()` 随后跳过这些 UID 的手动动态检查。

当 02:40 的 `/dynamic_feed` 超时失败时，`feedCoverage.dynamicUids` 为空，系统开始执行手动订阅动态检查。手动检查只读取并更新 `subscriptions.json` 中的 `lastDynamicId`，而正常路径长期由 Cookie 流推进 `subfollowers.json` 中的 `lastDynamicId`。两套状态没有互相同步。

结果是：平时 Cookie 流已覆盖并推进过的动态，一旦切到手动回退路径，就会被手动订阅的旧 `lastDynamicId` 重新判定为新动态并推送。

当前状态也能看到这种分裂仍未完全消除：

- `108618052` 手动 `lastDynamicId=1208184934755205122`，Cookie `lastDynamicId=1208352331096129540`
- `51628309` 手动 `lastDynamicId=1206628601808551937`，Cookie `lastDynamicId=1208084277860761602`

## 解决方案设计

### P0：阻止再次批量重推

1. 将“内容锚点”收敛为按 UID 共享的有效锚点。
   - 手动源和 Cookie 源同时存在时，动态检查应使用 `max(manual.lastDynamicId, cookie.lastDynamicId)` 作为比较基准。
   - 成功推送或确认已见后，同时推进手动订阅状态和 Cookie follower 状态。

2. Cookie 动态流失败时，不应立刻对同一批 Cookie 覆盖用户执行可推送的手动回退。
   - 如果该 UID 也在 Cookie follower 中，并且 Cookie 状态存在有效 `lastDynamicId`，手动回退可以只做锚点对齐，不发旧内容。
   - 或者在单轮动态流失败时，将这些 UID 标记为 `degraded_covered`，跳过本轮手动推送，等待下一轮恢复。

3. 手动动态检查增加“回放窗口保护”。
   - 非强制检查时，最多推送 1 条。
   - 若候选动态数量大于 1，或候选动态距离当前时间超过阈值，默认只把锚点推进到最新，不推送历史队列。
   - 日志记录 `dynamic-anchor-refreshed reason=stale_manual_anchor`，便于审计。

### P1：降低误告警

1. `refreshCookieFollowings()` 对 `/my_info` 失败分类。
   - 明确未登录、鉴权失败、B 站返回登录态错误：计入 Cookie 异常。
   - `TimeoutError`、连接失败、DNS/网络错误、Python 服务瞬断：计入 transient。

2. transient 失败不立即发“检查 Cookie”告警。
   - 连续 N 次失败或持续超过 M 分钟后再告警。
   - 告警文案改成“B站接口超时/网络异常，关注列表同步暂时失败”，不要默认指向 Cookie。

3. Cookie 同步和动态流分别建立健康状态。
   - `cookieSyncHealth`: my_info / followings 拉取状态。
   - `dynamicFeedHealth`: 动态流状态。
   - Dashboard 或日志能看到最近失败原因、连续失败次数、上次成功时间。

### P2：持久去重与可观测性

1. 当前 `notificationHistory` 是进程内短 TTL，不能作为长期重复推送防线。
   - 增加持久化的 subscription delivery ledger，按 `groupId + type + contentId` 保存最近成功推送记录。
   - TTL 可设为 7 到 30 天，覆盖“旧锚点回放”风险。

2. 给订阅推送日志补充状态基准。
   - 推送前记录 `basisLastDynamicId`、`manualLastDynamicId`、`cookieLastDynamicId`、`candidateCount`、`source`.
   - 这样下次能直接看出是哪个状态源落后。

## 建议测试

- `manual + cookie` 双来源用户：Cookie 锚点新于手动锚点时，动态流失败后不得重推手动旧动态。
- 动态流单次超时：应跳过或只对齐锚点，不发送历史队列。
- 真正 Cookie 失效：连续鉴权失败后仍要通知 admin。
- transient 超时：第一次只记录 warn，不发送“检查 Cookie”误导文案。
- 成功推送后：手动状态和 Cookie follower 状态都被推进。
