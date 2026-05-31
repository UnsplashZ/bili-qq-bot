# 2026-05-31 订阅状态统一与重复推送彻底修复方案

## 目标

彻底解决 2026-05-31 凌晨出现的两个连锁问题：

1. B 站接口短暂超时被误判成 Cookie 失效，触发误导性告警。
2. Cookie 动态流失败后回退到手动订阅检查，由于手动状态落后于 Cookie 状态，导致旧动态被重新推送。

本方案的目标不是给现有分支打补丁，而是把订阅系统的事实模型重新收敛：

- 手动订阅和 Cookie 同步仍保留各自的来源语义。
- 同一个 UP 主只有一份统一的内容锚点。
- 同一内容对同一群成功推送后有持久化投递记录兜底。
- 任一 B 站接口失败时，系统能区分“登录态失效”和“临时网络/API 失败”。
- Cookie 流、手动回退、重启、缓存过期、短期超时都不能再次造成历史内容批量回放。

## 根本原则

### 发送成功必须可证明

持久投递台账和统一锚点都依赖“真实投递结果”。在接入台账前，必须先收紧通知层发送合同：

- `sendSubscriptionMessage()` 必须返回结构化结果：`{ ok, reason, retcode, fallbackUsed }`。
- 如果首选发送方式失败并降级为文本 fallback，fallback 也必须 `await`，并把最终结果返回给调用方。
- `notifyGroups()`、`notifyGroupsWithImage()`、`notifyGroupsWithImageAndCache()` 只能基于真实 `ok` 结果填充 `successGroups`。
- 只有 `successGroups` 中的群可以写入 `subscription_delivery.json`。
- 发送失败的群不得写台账、不得被视为成功推进依据，下一轮允许重试。

这是本方案的前置条件。否则会出现“实际未发送成功，却被写入持久台账并推进锚点”的永久漏推。

### 来源不合并，状态必须统一

手动订阅和 Cookie 同步不应该物理合并成一条来源不明的记录，因为它们代表不同业务意图：

- 手动订阅：群明确订阅某个 UID。即使 B 站账号取关该 UID，群订阅也应该继续存在。
- Cookie 同步：来自某个 B 站账号关注列表和分组过滤。B 站取关、分组变化、账号切换都会改变它。

但内容状态不应该跟来源绑定。`lastDynamicId`、`lastVideoId`、`lastArticleId`、`lastLiveStatus` 代表“这个 UID 的内容看到哪里了”，应按 UID 统一保存和读取。

结论：

- `subscriptions.json` 保存手动订阅意图。
- `subfollowers.json` 保存 Cookie 关注快照和账号映射。
- 新增统一锚点存储，保存所有 UID 的内容进度。
- 运行时通过来源意图计算目标群，通过统一锚点判断是否有新内容。

### 投递结果必须独立于锚点

锚点用于判断内容是否新，不能单独承担去重职责。服务重启、历史状态迁移、异常回退、接口乱序都可能让锚点出错。

因此需要持久化投递台账：

- 同一 `groupId + contentType + contentId` 成功投递过，就不应再次投递。
- 台账保留时间建议 30 天。
- 台账不替代锚点，作为最后一道兜底。
- 投递台账写入必须串行化。现有 JSON atomic write 使用固定 `.tmp` 文件名，不支持同一文件多写并发；`subscriptionDeliveryStore` 必须内置单文件写队列或批量合并接口，避免并发 `recordDelivered()` 互相覆盖。

### 临时失败不得触发历史回放

任何单轮接口失败都应进入降级状态，而不是切换到另一路径批量补推历史内容。

动态流失败时：

- 可以继续检查手动专属用户。
- 对同时存在 Cookie 覆盖的用户，不允许用落后的手动锚点推送历史内容。
- 如果需要回退到 per-user 动态接口，必须使用统一锚点和持久投递台账。

### 旧字段只能作为迁移来源

兼容期保留 `subscriptions.json` 和 `subfollowers.json` 中的旧锚点字段，但运行时检查流程不得继续把它们当事实源。

- `lastDynamicId`、`lastVideoId`、`lastVideoCreated`、`lastArticleId`、`lastArticlePublishTime`、`lastLiveStatus`、`roomId` 在旧文件中仅作为 migration input。
- 业务模块不得直接调用 `updateUserSub()` 或 `updateCookieFollowerState()` 写这些内容锚点字段。
- 如回滚兼容需要镜像旧字段，只能由 `subscriptionStateStore` 统一同步写回，不能分散在 feed/manual/unified checks 中。
- 测试必须能证明动态、视频、专栏、直播检查不再读取旧字段决策。

## 新数据模型

### 1. 手动订阅意图：`data/subscriptions.json`

继续保存手动订阅列表，但不再作为内容锚点真源。

```json
{
  "schemaVersion": 3,
  "users": [
    {
      "uid": "108618052",
      "name": "真实球迷汇",
      "groupIds": ["1065812436"],
      "type": "user"
    }
  ],
  "bangumis": []
}
```

兼容期内可以保留旧字段，例如 `lastDynamicId`、`lastVideoId`，但读写逻辑不再以这些字段为主。迁移完成后可逐步清理。

### 2. Cookie 关注快照：`data/subfollowers.json`

继续保存账号关注列表、群到账号映射、B 站分组信息，但不再作为内容锚点真源。

```json
{
  "schemaVersion": 3,
  "followings": {
    "15156331": [
      {
        "mid": "108618052",
        "name": "真实球迷汇",
        "biliGroups": ["默认分组"]
      }
    ]
  },
  "groupMap": {
    "1065812436": "15156331"
  }
}
```

兼容期内可以保留旧状态字段，但运行时只把它们作为迁移来源或兜底读取来源。

### 3. 统一锚点：`data/subscription_state.json`

新增文件，按 UID 保存内容检查进度。

```json
{
  "schemaVersion": 1,
  "users": {
    "108618052": {
      "uid": "108618052",
      "name": "真实球迷汇",
      "dynamic": {
        "lastId": "1208352331096129540",
        "updatedAt": "2026-05-31T06:29:54.000Z",
        "source": "cookieFeed"
      },
      "video": {
        "lastId": "BV1GtVj6KEyj",
        "lastCreated": 1780123456,
        "updatedAt": "2026-05-31T06:29:54.000Z",
        "source": "unifiedUserCheck"
      },
      "article": {
        "lastId": null,
        "lastPublishTime": null,
        "updatedAt": null,
        "source": null
      },
      "live": {
        "lastStatus": 0,
        "roomId": null,
        "updatedAt": "2026-05-31T06:29:54.000Z",
        "source": "liveFeed"
      }
    }
  }
}
```

锚点更新规则：

- 只允许前进，不允许被旧值覆盖。
- 动态 ID 使用 `BigInt` 比较，异常时使用零填充字符串比较。
- 视频和专栏同时保存 ID 与发布时间，避免旧 ID 不在列表时回放。
- 直播保存状态和 roomId。
- 每次更新记录来源，方便审计。

### 4. 持久投递台账：`data/subscription_delivery.json`

新增文件，按群和内容保存成功投递记录。

```json
{
  "schemaVersion": 1,
  "records": {
    "1065812436:dynamic:1208352331096129540": {
      "groupId": "1065812436",
      "contentType": "dynamic",
      "contentId": "1208352331096129540",
      "uid": "108618052",
      "sourceSet": ["manual", "cookieSync"],
      "deliveredAt": "2026-05-31T06:29:51.000Z"
    }
  }
}
```

投递台账规则：

- 成功发送到群后写入。
- 发送失败不写入，下一轮可重试。
- 发送前先查台账，命中则跳过发送并允许锚点前进。
- 如果同一内容 A 群发送成功、B 群发送失败，统一锚点仍可以推进到该内容，但下一轮检查不能仅因 `contentId <= lastId` 就结束；必须继续对目标群执行投递台账检查，只重试缺失台账的 B 群。
- 锚点只表示“该 UID 的内容已被系统看见”，不表示“所有目标群都已完成投递”。是否还要对某个群发送，必须以 `subscription_delivery.json` 为准。
- 默认保留 30 天，启动和每日维护时清理过期记录。
- 写入使用现有 atomic write 工具，避免文件损坏。
- 写入必须通过队列串行执行；对一次 `notifyGroupsWithImage()` 中多个成功群，优先批量写入成功记录，避免 `Promise.all` 群发送完成后逐群并发写同一 JSON 文件。
- store 需要支持 reload 场景，证明服务重启后仍能读取旧台账阻止重复发送。

### 锚点推进后的失败群重试

这是统一锚点方案的硬规则，否则会把“重复推送”修成“失败群永久漏推”。

检查流程不能只处理 `candidateId > unifiedAnchor` 的内容。对每类内容都必须额外检查“当前最新内容是否已有部分群投递缺口”：

1. 拉取最新内容并得到目标群集合。
2. 即使 `latestContentId` 等于或不新于统一锚点，也要对该内容逐群查询 `subscription_delivery.json`。
3. 已有台账的群跳过，并记录 `delivery-ledger-hit`。
4. 缺台账的群如果仍是当前目标群，允许重试发送。
5. 重试成功后只补写缺失群的台账；锚点不需要倒退或重复推进。
6. 如果内容已不在 API 最新窗口中，台账缺口不主动补历史，避免重新打开历史回放风险。

因此状态推进判断要拆成两件事：

- `advanceAnchor`：是否把 UID 内容进度推进。
- `deliverToGroups`：是否还有目标群缺少该内容台账。

`decideAdvance()` 不能继续作为唯一状态决策。它可以保留用于“是否至少一个群成功”的兼容判断，但新流程必须显式返回 `deliveredGroups`、`failedGroups`、`ledgerSkippedGroups` 和 `retryableGroups`。

## 运行时统一视图

新增 `SubscriptionTargetResolver`，每轮从手动订阅和 Cookie 快照生成统一目标：

```js
{
  uid: "108618052",
  name: "真实球迷汇",
  groups: {
    "1065812436": {
      sources: ["manual", "cookieSync"],
      accountUid: "15156331",
      biliGroups: ["默认分组"]
    }
  },
  hasManualSource: true,
  hasCookieSource: true
}
```

这个视图只存在于运行时，不落盘。它解决的是“发给哪些群、按什么来源规则发”的问题。

注意：这个带元数据的目标对象不能直接传给现有通知层。通知、`@全体` 和 sourceMap 相关逻辑只接受 `Map<groupId, Set<'manual'|'cookieSync'>>` 语义。`SubscriptionTargetResolver` 必须提供显式适配器：

```js
toGroupSourceMap(target) // => Map<groupId, Set<'manual'|'cookieSync'>>
```

所有调用 `notifyGroupsWithImageAndCache()`、`buildAtAllMetaForGroup()`、`normalizeGroupSourceMap()` 的地方，只能传这个 source map 或等价结构，不能传 `groups[gid] = { sources, accountUid, biliGroups }` 的元数据对象。

目标群计算规则：

- 手动订阅来源：`subscriptions.json.users[].groupIds`。
- Cookie 来源：`subfollowers.json.groupMap` + `config.groupConfigs[groupId].enableCookieSync` + `cookieSyncGroupNames` 分组过滤。
- 同一个群同时命中手动和 Cookie 时，来源集合为 `["manual", "cookieSync"]`。
- `@全体`、分类推送、来源开关继续基于来源集合判断。

## 动态检查流程

动态是本次事故的核心，必须从“双路径状态”改成“统一状态驱动”。

### 正常 Cookie 动态流

1. 每轮先构建统一目标视图。
2. 对每个 Cookie 账号调用动态流接口。
3. 对动态流返回的每条动态：
   - 解析作者 UID。
   - 找到该 UID 的统一目标。
   - 读取 `subscription_state.json.users[uid].dynamic.lastId`。
   - 判断动态 ID 是否新于统一锚点，同时检查该动态对目标群是否存在投递台账缺口。
   - 排除直播动态、视频自动投稿动态、专栏自动动态等已有规则。
   - 发送前查 `subscription_delivery.json`。
   - 未投递过则发送到缺台账的目标群。
   - 发送成功后写投递台账。
   - 无论因台账命中跳过还是发送成功，只要确认该内容已见，就推进统一锚点。

### Cookie 动态流失败

动态流失败不再直接暴露旧手动锚点。

流程：

1. 标记该账号本轮 `dynamicFeedStatus=transient_failed` 或 `auth_failed`。
2. 对该账号覆盖的 Cookie 用户：
   - 不使用旧的手动 `lastDynamicId`。
   - 如果启用 per-user 回退，必须读取统一锚点。
   - 如果 per-user 回退发现多条候选动态，只允许发送最新一条且必须通过投递台账检查；其余只推进锚点或忽略。
3. 对纯手动用户：
   - 可以继续使用 per-user 动态检查。
   - 仍读取统一锚点。
   - 仍受投递台账和回放保护约束。

这样即使 Cookie 动态流单轮超时，也不会把手动旧锚点当成事实源。

### 动态流局部失败

不能继续使用账号级 `feedCoverage.dynamicUids` 粗粒度覆盖。动态 feed 成功并不代表该账号下所有 UID 都成功处理。必须改成 per-UID outcome：

```js
{
  uid: "108618052",
  outcome: "seen" | "advanced" | "delivery_failed" | "detail_failed" | "feed_failed" | "skipped",
  reason: "...",
  effectiveLastDynamicId: "...",
  candidateCount: 1
}
```

manual fallback 规则：

- `seen` / `advanced`：本轮跳过手动回退。
- `delivery_failed` / `detail_failed`：允许受控 per-user retry，但必须使用统一锚点和投递台账。
- `feed_failed`：对 Cookie 覆盖 UID 不暴露旧手动锚点；可以跳过或使用统一锚点执行受控 per-user retry。
- 没有 outcome 的纯手动 UID：正常按统一锚点检查。

这样可以避免“feed 接口成功但单条 detail 或发送失败后既不推进锚点也不重试”的漏推。

### 手动动态检查

手动动态检查不再直接读取 `sub.lastDynamicId`。

流程：

1. 读取统一锚点。
2. 拉取用户动态列表。
3. 排序并过滤自动动态。
4. 如果没有统一锚点：初始化为最新非直播动态，不推送。
5. 如果最新动态不新于统一锚点：仍检查该最新动态是否存在目标群台账缺口；有缺口则只重试缺失群，没有缺口才结束。
6. 如果有新动态：
   - 找出新于统一锚点的候选集合。
   - 如果候选集合数量大于 1，认为可能是历史回放风险：
     - 默认只发送最新一条真正新内容。
     - 如果候选内容已在投递台账中出现，则不发。
     - 将统一锚点推进到最新已确认动态。
   - 如果候选集合数量为 1，按正常推送流程发送。

## 视频、专栏、直播检查流程

视频和专栏当前已经有统一用户列表的雏形，但状态仍可能落在手动或 Cookie 对象上。改造后全部读取统一锚点。

### 视频

1. 使用统一目标视图生成 UID 检查列表。
2. 拉取视频列表。
3. 用 `state.video.lastId` 和 `state.video.lastCreated` 判断新内容。
4. 发送前查投递台账 `groupId:video:bvid`。
5. 成功后写台账并推进统一锚点。
6. 如果旧锚点缺少时间戳且不在列表中，只刷新锚点，不推送历史视频。

### 专栏

1. 使用统一目标视图生成 UID 检查列表。
2. 拉取专栏列表。
3. 用 `state.article.lastId` 和 `state.article.lastPublishTime` 判断新内容。
4. 发送前查投递台账 `groupId:article:cvId`。
5. 成功后写台账并推进统一锚点。
6. 旧锚点缺少发布时间且不在列表中时，只刷新锚点。

### 直播

1. Cookie live feed 和手动 live check 都读取统一 `state.live`。
2. 从离线到在线才推送。
3. 成功投递后写 `groupId:live:roomId` 的短期投递记录。
4. 状态变为离线时推进 `lastStatus=0`，不写投递台账。

## 告警语义

新增失败分类函数，所有 B 站 API 返回错误都归类：

```js
{
  kind: "auth_failed" | "transient_network" | "rate_limited" | "server_error" | "unknown",
  message: "...",
  retryable: true
}
```

分类规则：

- 明确登录态失效、鉴权失败、Cookie 缺字段：`auth_failed`。
- `TimeoutError`、连接超时、DNS、连接重置：`transient_network`。
- 412、风控、请求过快：`rate_limited`。
- 5xx 或 B 站服务异常：`server_error`。
- 无法识别：`unknown`。

错误分类不能只依赖字符串匹配。需要先标准化 Python/Node 错误 envelope：

- Python service 返回 `status=error` 时尽量附带：`errorType`、`exceptionClass`、`biliCode`、`httpStatus`、`retryable`、`endpoint`。
- Node `ServiceManager.sendCommand()` 捕获 axios 错误时必须保留：`code`、`response.status`、`response.data`、`endpoint`、`timeout`。
- `biliApiErrorClassifier` 优先使用结构字段分类，字符串匹配只做兜底。
- `/my_info`、`/my_followings`、`/dynamic_feed`、`refresh_credential` 都必须进入同一分类与告警状态机。

告警规则：

- `auth_failed`：立即告警，文案指向 Cookie。
- `transient_network/server_error/rate_limited`：第一次只写 warn，不发“检查 Cookie”。
- 同类可重试错误连续 3 次或持续 15 分钟，再通知 admin。
- 告警文案必须带失败类型和最近成功时间。
- 失败计数应按 endpoint + group/account 维度隔离，避免一个群或一个接口污染另一个群。
- 任一对应 endpoint 成功后，清除该维度连续失败计数并更新最近成功时间。

示例：

```text
[Bot通知] ⚠️ B站接口超时，关注列表同步暂时失败。最近成功：2026-05-31 01:39:41。当前按已有订阅状态继续运行，不会批量回放历史推送。
```

明确 Cookie 失败时：

```text
[Bot通知] ⚠️ B站Cookie登录态失效，关注列表同步暂停。请重新登录。
```

## 迁移方案

启动时执行幂等迁移。迁移必须在任何订阅检查、Cookie 同步刷新、credential 刷新定时器启动前完成。

### 启动门闩

新增 `initializeSubscriptionState()`，挂载在 `subscriptionService.start()` 或 `updateChecker.start()` 开定时器之前，并被 `await`。

该初始化必须按顺序完成：

1. `subscriptionManager._ensureSubscriptionsLoaded()`
2. `subscriptionManager._ensureFollowersLoaded()`
3. `subscriptionStateStore.load()`
4. 从旧字段执行幂等迁移
5. `subscriptionDeliveryStore.load()`
6. 清理过期 delivery 记录

初始化完成前：

- `checkAll()` 必须直接跳过或等待初始化。
- `refreshCookieFollowings()` 必须直接跳过或等待初始化。
- 不允许出现只加载 `subscriptions.json`、未加载 `subfollowers.json` 就迁移的首轮运行。

### 迁移输入

- `subscriptions.json.users[].lastDynamicId`
- `subscriptions.json.users[].lastVideoId`
- `subscriptions.json.users[].lastVideoCreated`
- `subscriptions.json.users[].lastArticleId`
- `subscriptions.json.users[].lastArticlePublishTime`
- `subscriptions.json.users[].lastLiveStatus`
- `subfollowers.json.followings[*][].lastDynamicId`
- `subfollowers.json.followings[*][].lastVideoId`
- `subfollowers.json.followings[*][].lastVideoCreated`
- `subfollowers.json.followings[*][].lastArticleId`
- `subfollowers.json.followings[*][].lastArticlePublishTime`
- `subfollowers.json.followings[*][].lastLiveStatus`
- `subfollowers.json.followings[*][].roomId`

### 迁移合并规则

对同一个 UID：

- 动态：取更大的 `lastDynamicId`。
- 视频：优先取 `lastVideoCreated` 更大的记录；无时间戳时保留 ID 但标记为 legacy。
- 专栏：优先取 `lastArticlePublishTime` 更大的记录；无时间戳时保留 ID 但标记为 legacy。
- 直播：如果任一来源为在线则保留在线，但下一轮必须用 live room 二次确认。
- roomId：取非空值。
- name：优先手动订阅名，其次 Cookie follower 名。

迁移后：

- 写入 `subscription_state.json`。
- 保留旧字段一段时间，避免回滚时缺数据。
- 日志输出迁移数量和冲突数量。

幂等规则：

- 如果 `subscription_state.json` 已有该 UID 状态，迁移只能把旧字段作为候选输入参与“只前进”比较，不能用旧字段覆盖更新的统一状态。
- dynamic：`max(existingState.dynamic.lastId, manual.lastDynamicId, cookie.lastDynamicId)`。
- video：取 `lastCreated` 最大的候选；已有统一状态有时间戳时，旧无时间戳 legacy 候选不得覆盖。
- article：取 `lastPublishTime` 最大的候选；已有统一状态有时间戳时，旧无时间戳 legacy 候选不得覆盖。
- live：已有统一状态为在线时不得被旧离线字段覆盖；已有离线、旧在线时可记录 `needsConfirm=true`，下一轮二次确认。
- 重复运行迁移必须产生相同或更前进的状态，不得后退。

### 当前线上数据的立即效果

以当前线上状态为例：

- `108618052` 手动动态锚点落后于 Cookie 锚点，迁移后统一锚点取 Cookie 的 `1208352331096129540`。
- `51628309` 手动动态锚点落后于 Cookie 锚点，迁移后统一锚点取 Cookie 的 `1208084277860761602`。

迁移完成后，即使再次出现 02:40 那种动态流超时，手动回退也不会从旧锚点开始回放。

## Force / Check Now 语义

现有 `checkSubscriptionNow` 是管理/测试入口，和正常订阅推送不同。统一状态与持久台账接入后必须明确语义：

- `force=true` 默认绕过持久投递台账拦截，允许管理员主动验证预览和发送链路。
- `force=true` 默认不写 `subscription_delivery.json`，避免污染正常推送去重事实。
- `force=true` 默认不推进统一锚点，除非调用方显式传入 `persistState=true`。
- 日志必须记录 `force=true`、`deliveryLedgerBypassed=true`、`statePersisted=false/true`。
- 正常订阅轮询不得传 `disableDedup` 绕过持久台账。

## 代码改造范围

新增模块：

- `src/services/subscription/subscriptionStateStore.js`
  - 读写 `subscription_state.json`
  - 提供 `getUserState(uid)`、`advanceDynamic(uid, id, meta)`、`advanceVideo(...)` 等方法
  - 保证状态只前进
  - 提供 `initializeFromLegacy({ subscriptions, followers })` 幂等迁移能力
  - 如需兼容写回旧字段，只能由该 store 统一镜像

- `src/services/subscription/subscriptionDeliveryStore.js`
  - 读写 `subscription_delivery.json`
  - 提供 `hasDelivered(groupId, type, contentId)`、`recordDelivered(...)`
  - 定期清理过期记录
  - 内置单文件写队列，提供 `recordDeliveredBatch(records)`，避免并发写覆盖

- `src/services/subscription/subscriptionTargetResolver.js`
  - 从手动订阅和 Cookie 快照构建统一目标视图
  - 统一处理来源集合、分组过滤、活跃群过滤
  - 提供 `toGroupSourceMap(target)`，通知层只消费 `Map<groupId, Set<source>>`

- `src/services/biliApiErrorClassifier.js`
  - 将 Python/Bili API 错误归类为 auth/transient/rate-limit/server 等
  - 结构字段优先，字符串兜底

- Python Bili service 错误 envelope
  - 为关键接口返回稳定错误字段：`errorType`、`exceptionClass`、`biliCode`、`httpStatus`、`retryable`、`endpoint`

- `src/services/ServiceManager.js`
  - axios 异常保留 `code/status/response.data/endpoint/timeout`，供 classifier 使用

重构模块：

- `src/services/subscription/updateChecker/modules/lifecycle.js`
  - 不再用 `feedCoverage.dynamicUids` 决定是否暴露旧手动状态，改为 per-UID outcome。
  - 改为基于统一目标和统一锚点调度各类检查。
  - 确保初始化未完成时不进入检查。

- `src/services/subscription/updateChecker/modules/feed.js`
  - Cookie 动态流使用统一锚点。
  - 成功处理内容后推进 `subscription_state.json`。
  - 动态流失败时进入受控降级，不触发历史回放。
  - 对 detail 失败、发送失败记录 per-UID outcome。

- `src/services/subscription/updateChecker/modules/manualChecks.js`
  - `checkUserDynamic()` 不再读写 `sub.lastDynamicId`。
  - 增加候选集合回放保护。
  - `checkUserLive()` 不再读写 `sub.lastLiveStatus/roomId` 作为事实源。

- `src/services/subscription/updateChecker/modules/unifiedChecks.js`
  - 视频、专栏读写统一状态。

- `src/services/subscription/updateChecker/modules/notify.js`
  - 发送前查持久投递台账。
  - 成功发送后写持久台账。
  - 进程内 `notificationHistory` 可以保留，但只作为短期性能优化。
  - 在接入台账前，必须先使用真实发送结果合同。

- `src/services/subscription/updateChecker/modules/maintenance.js`
  - Cookie 同步失败按错误分类告警。
  - transient 错误连续计数后再通知。

兼容保留：

- 旧 `subscriptions.json` 和 `subfollowers.json` 字段短期保留。
- Dashboard 订阅列表仍可以展示手动订阅和 Cookie 同步来源。
- 旧测试中的状态字段断言需要迁移到统一状态。

## 验证用例

### 状态迁移

- 手动和 Cookie 都有同一 UID，Cookie 动态 ID 更大：迁移后统一动态锚点取 Cookie 值。
- 手动和 Cookie 都有同一 UID，手动动态 ID 更大：迁移后统一动态锚点取手动值。
- 只有手动订阅：迁移后生成统一状态。
- 只有 Cookie follower：迁移后生成统一状态。
- 视频/专栏带时间戳：取时间更新的状态。
- 旧字段缺失：迁移不抛错，初始化为空状态。
- 已有 `subscription_state.json` 比旧字段更新时：重复迁移不得被旧字段反向覆盖。
- 旧字段保留期间：检查流程不得继续读取旧字段作为事实源。

### 动态流失败

- Cookie 动态流超时，UID 同时存在手动和 Cookie 来源：不得重推旧动态。
- Cookie 动态流超时，per-user 回退发现多条候选动态：不得批量推送。
- Cookie 动态流超时，纯手动用户确有 1 条新动态：可以正常推送。
- 动态流下一轮恢复后，统一锚点继续前进。
- 必须新增生命周期级回归：`checkAll -> checkFeedUpdate/feed 失败 -> manual fallback`，双来源 UID 手动旧锚点落后时不得推旧动态。
- feed 成功但单条 detail 失败：该 UID 不应被误标为已覆盖，允许按统一锚点受控重试。
- feed 成功但发送失败：失败群不得写台账，失败 UID/群允许重试。

### 持久投递台账

- 同一动态已成功发到同一群：再次检查时跳过发送。
- 同一动态发到 A 群成功、B 群失败：A 群不重发，B 群可重试。
- 统一锚点已经等于最新内容，但 B 群缺少该内容台账：下一轮仍只向 B 群重试，不向 A 群重发。
- 服务重启后，台账仍能阻止重复发送。
- 台账过期清理不影响当前锚点。
- 并发或批量 `recordDelivered` 不丢记录、不产生 `.tmp` 冲突。
- 写失败不破坏原文件，临时文件被清理，备份可恢复。

### 告警分类

- `/my_info` 返回明确未登录：立即 Cookie 告警。
- `/my_info` 连接超时一次：只写 warn，不发 Cookie 告警。
- `/my_info` 连续超时 3 次：发送网络/API 异常告警，不提示 Cookie 失效。
- 后续成功后，连续失败计数清零。
- `/my_followings`、`/dynamic_feed`、`refresh_credential` 的 status=error 与 throw 两种形态都进入分类。
- 不同 endpoint、群、账号的失败计数不串扰。
- 告警日志和私聊文案包含失败类型、最近成功时间，不误导为 Cookie 失效。

### 回归

- 手动订阅新增用户时：统一锚点初始化为最新内容，不推送历史。
- Cookie 同步新增 follower 时：统一锚点初始化为最新内容，不推送历史。
- B 站取关 follower 时：手动订阅仍保留；Cookie 来源消失但统一状态不丢。
- B 站重新关注 follower 时：继续复用统一状态，不回放。
- `force/check now` 绕过台账但不写台账、不推进锚点，除非显式要求持久化。

### 可观测性

- 推送前日志包含 `uid`、`sourceSet`、`effectiveLastDynamicId`、`manualLegacyLastDynamicId`、`cookieLegacyLastDynamicId`、`candidateCount`。
- 投递台账命中时日志包含 `delivery-ledger-hit`、`groupId`、`contentType`、`contentId`。
- 告警分类日志包含 `failureKind`、`endpoint`、`groupId/accountUid`、`consecutiveFailures`、`lastSuccessAt`。
- `/api/logs/recent` 可以按关键字检索这些字段。

### 发送结果合同

- 图文发送成功才进入 `successGroups`。
- 图文发送失败但文本 fallback 成功时，结果应标明 `fallbackUsed=true` 且群算成功。
- 图文发送失败且文本 fallback 失败时，群进入 `failedGroups`，不写台账。
- `notifyGroups()` 文本发送也必须返回真实结构化结果，不能 fire-and-forget。

## 验收标准

修复完成后，以下场景必须成立：

1. 单次 `/my_info` 或 `/dynamic_feed` 超时不会提示“Cookie 状态异常”。
2. 单次 Cookie 动态流失败不会触发手动订阅旧动态批量回放。
3. 同一 UID 同时来自手动和 Cookie 时，只存在一份有效内容锚点。
4. 同一内容成功发到同一群后，服务重启也不会再次发送。
5. B 站取关、重新关注、修改分组不会清空该 UID 的内容锚点。
6. Dashboard 和日志能看出一个推送由哪些来源命中、使用了哪个统一锚点、是否被投递台账跳过。

## 实施顺序

虽然这是一次性彻底方案，但落地时仍建议按依赖顺序提交代码，避免中间状态不可测试：

1. 重构通知发送合同，确保 `successGroups/failedGroups` 可信。
2. 新增统一状态存储、串行化投递台账、目标解析器和错误分类器。
3. 扩展 Python/Node 错误 envelope，让 classifier 有结构化输入。
4. 增加启动门闩、幂等迁移逻辑和迁移测试。
5. 改造动态检查路径，移除对手动 `lastDynamicId` 的直接依赖，并引入 per-UID outcome。
6. 改造视频、专栏、直播状态读写。
7. 接入持久投递台账，并保留 force/check-now 的独立语义。
8. 改造 Cookie 同步告警分类。
9. 补齐单元测试、Dashboard/log 可见性验证和一次本机运行烟雾验证。

这里的顺序只是工程依赖，不是分层降级方案。所有步骤完成后才算本问题修复完成。

## 授权后并行执行拆分

进入代码实现前必须先获得明确授权。授权后按以下边界并行，所有 worker 都必须知道仓库中会有其他人同时修改文件，不能回滚他人改动。

### 主代理：集成与最终决策

职责：

- 统一依赖方向和接口命名。
- 合并 worker 结果，解决跨模块调用和测试冲突。
- 控制 `lifecycle.js`、`UpdateChecker.js`、`adapters/deps.js` 这类共享入口的最终改动。
- 负责最终集中测试、复审问题修复和验收报告。

共享文件原则：

- `lifecycle.js`、`UpdateChecker.js`、`adapters/deps.js`、`subscriptionService.js` 由主代理最终编辑。
- worker 如需这些共享入口，只在最终报告里说明所需接入点，除非主代理明确重新分配。

### Worker B：状态存储、投递台账和迁移

主要写入范围：

- `src/services/subscription/subscriptionStateStore.js`
- `src/services/subscription/subscriptionDeliveryStore.js`
- `test/unit/subscriptions/subscription-state-store.test.js`
- `test/unit/subscriptions/subscription-delivery-store.test.js`
- `test/unit/subscriptions/subscription-state-migration.test.js`

必须交付：

- `subscription_state.json` load/save/backup/幂等迁移。
- `subscription_delivery.json` load/save/30 天清理/串行写队列/batch 写。
- 动态 ID 前进比较、视频/专栏时间戳合并、live 状态合并。
- 证明重复迁移不会被旧字段反向覆盖。

不得改：

- `feed.js`、`manualChecks.js`、`unifiedChecks.js` 的业务检查流程。
- 通知发送合同。

### Worker C：目标解析器和内容检查链路

主要写入范围：

- `src/services/subscription/subscriptionTargetResolver.js`
- `src/services/subscription/updateChecker/modules/feed.js`
- `src/services/subscription/updateChecker/modules/manualChecks.js`
- `src/services/subscription/updateChecker/modules/unifiedChecks.js`
- `src/services/subscription/updateChecker/modules/targeting.js`
- `test/unit/subscriptions/updateChecker-state-unification.test.js`
- `test/unit/subscriptions/updateChecker-dynamic-fallback-ledger.test.js`

必须交付：

- 手动/Cookie 来源语义保留，运行时目标视图统一。
- `toGroupSourceMap(target)` 输出通知层兼容结构。
- 动态、视频、专栏、直播全部读写统一状态。
- Cookie feed 失败时双来源 UID 不暴露旧手动锚点。
- per-user 回退多候选只允许最新一条受控发送。
- `latestContentId <= unifiedAnchor` 时仍检查当前最新内容的投递台账缺口，只重试缺失群。

不得改：

- 状态 store 的文件格式和迁移核心算法。
- Python 错误 envelope。

### Worker D：通知合同、台账接入、错误分类和告警

主要写入范围：

- `src/services/subscription/updateChecker/modules/atAll.js`
- `src/services/subscription/updateChecker/modules/notify.js`
- `src/services/subscription/updateChecker/modules/maintenance.js`
- `src/services/biliApiErrorClassifier.js`
- `src/services/ServiceManager.js`
- Python 关键接口错误 envelope 文件：`src/services/bili_server_core/web/handlers.py`、`src/services/bili_server_core/services/user_service.py`、`src/services/bili_server_core/services/feed_service.py`、`src/services/bili_server_core/services/follow_service.py`
- `test/unit/subscriptions/updateChecker-notify-result.test.js`
- `test/unit/subscriptions/updateChecker-cookie-error-classification.test.js`
- `test/unit/services/serviceManager-python-logging.test.js` 或新增等价测试

必须交付：

- `sendSubscriptionMessage()`、`notifyGroups()`、`notifyGroupsWithImage()` 返回可信结构化结果。
- 图文失败但文本 fallback 成功时标记 `fallbackUsed=true` 且只真实成功群写台账。
- `auth_failed`、`transient_network`、`rate_limited`、`server_error`、`unknown` 分类。
- `/my_info` 单次超时只 warn，明确未登录才 Cookie 告警，连续可重试错误后发网络/API 异常告警。
- 日志输出来源命中、统一锚点、投递台账跳过和告警分类字段。

不得改：

- 目标解析器的数据模型。
- 迁移算法。

### 独立复审

实现后至少开两个只读 reviewer：

- Reviewer E：重点查重复推送、失败群重试、历史回放、状态倒退、force/check-now 语义。
- Reviewer F：重点查迁移幂等、错误分类、通知结果可信性、测试覆盖、日志/Dashboard 可见性。

复审规则：

- reviewer 不得复述实现者结论，必须从当前代码和测试证据独立判断。
- 发现 P0/P1 或可靠性问题后，先修复再重新复审。
- 所有关键问题关闭后才进入最终验收。

## 独立 Review 结论处理

本方案经两个只读子代理 review 后补充了以下执行硬约束：

- P0：通知层必须先返回可信发送结果，否则不能接入持久投递台账。
- P0：迁移必须证明幂等，已有统一状态不能被保留的旧字段反向覆盖。
- P0：必须新增事故主链路回归测试，覆盖 `checkAll -> feed 失败 -> manual fallback`。
- P1：初始化必须在所有订阅定时器启动前完成，并同时加载手动订阅和 Cookie follower。
- P1：目标解析器必须对通知层输出 `Map<groupId, Set<source>>`，不能把带元数据对象直接传给 sourceMap。
- P1：动态 feed coverage 必须从账号级集合升级为 per-UID outcome。
- P1：投递台账必须有串行写队列或批量合并，不能并发写同一 JSON 文件。
- P1：错误分类必须建立 Python/Node 结构化错误 envelope。
- P1：旧锚点字段必须成为 legacy migration source，运行时读写以统一状态为唯一事实源。
- P1：force/check-now 必须绕过台账但不污染台账、不默认推进锚点。
