# 2026-05-31 整体 Review 遗留问题完整修复方案

## 背景

当前分支已经完成了订阅状态统一、投递台账、Cookie 错误分类和 Dashboard chunk 拆分的主体修复，并通过了现有单元测试、Docker build、`npm start` smoke 和 Dashboard build。

整体 review 后仍发现 4 个边界问题：

1. 新增群会被投递台账误判为旧内容的缺失投递群，从而补发旧内容。
2. 视频订阅的卡片补偿已限制到缺失群，但视频下载副作用仍可能发给全量目标群。
3. Python error envelope 已统一，但 Node `_withCache()` 仍可能吞掉 Python 返回的结构化错误字段。
4. Dashboard manual chunk 中 `vendor-icons` 分支被 `vendor-react` 提前匹配，拆包规则和意图不一致。

本方案目标是一次性消除这些 review 遗留缺口，不再继续用局部特判堆补丁。

## 修复总原则

### 新目标群不能继承旧事件补偿

投递台账的补偿语义必须只适用于“内容产生时已经是目标群、但发送失败或发送结果未知”的群。

新增群订阅某个 UID 时，不能因为其他群曾收到某条旧内容，就把这条旧内容补发给新增群。新增群的语义应该是“从订阅生效后的下一条新内容开始接收”，除非用户显式执行强制检查。

### 附带动作必须和主推送使用同一有效目标集

视频下载、缓存写入、`@全体`、fallback 文本等附带动作不能再使用原始全量 `targetGroups`。只要当前推送是缺失群补偿，所有副作用都必须只作用于 `effectiveTargetGroups`。

### Error envelope 要贯穿 Python handler 到 Node 调用方

Python 侧返回的 `status/errorType/retryable/endpoint/httpStatus/biliCode/exceptionClass` 是错误分类真源。Node 层不得把它降级成只有 `message` 的普通错误。

### 构建优化要可解释

Dashboard chunk 规则不只要消除 warning，还要保证规则顺序和输出一致，避免后续维护者以为 icon chunk 已生效但实际没有。

## 1. 新增群旧内容补发问题

### 当前问题

`getUndeliveredGroupSourceMap(contentType, contentId, targetGroupSourceMap)` 用当前目标群列表查询台账。

场景：

1. UID `U` 原来只订阅 A 群。
2. `contentId=X` 成功推送到 A 群，写入 `A:dynamic:X`。
3. 后来 B 群新增订阅 UID `U`。
4. 下一轮检查发现最新内容仍是 `X`，统一锚点已到 `X`。
5. 台账查询当前目标群 A+B，发现 A 有记录、B 没记录，于是把 B 当成缺失投递群，补发旧内容 `X`。

这不是发送失败补偿，而是新增订阅后的历史回放。

### 完整修复设计

新增“目标群订阅生效水位”概念，按 `uid + groupId + contentType` 保存该群开始接收该 UID 某类内容的基准。

推荐落在现有 `subscription_state.json` 中，避免再开第三份状态文件：

```json
{
  "schemaVersion": 2,
  "users": {
    "108618052": {
      "uid": "108618052",
      "dynamic": { "lastDynamicId": "1208352331096129540", "meta": {} },
      "video": { "videoId": "BVxxx", "lastCreated": 1780000000, "meta": {} },
      "article": { "articleId": "cv123", "lastPublishTime": 1780000000, "meta": {} },
      "live": { "lastStatus": 0, "roomId": "9527", "meta": {} },
      "targets": {
        "1065812436": {
          "dynamic": { "baselineId": "1208352331096129540", "activatedAt": 1780216245000 },
          "video": { "baselineId": "BVxxx", "baselineTime": 1780000000, "activatedAt": 1780216245000 },
          "article": { "baselineId": "cv123", "baselineTime": 1780000000, "activatedAt": 1780216245000 },
          "live": { "baselineStatus": 0, "baselineRoomId": "9527", "activatedAt": 1780216245000 }
        }
      }
    }
  }
}
```

字段语义：

- `users[uid].dynamic/video/article/live` 仍是 UID 级统一锚点。
- `users[uid].targets[groupId]` 是该群对该 UID 的订阅接收边界。
- 新增群时，把当前 UID 级锚点写入该群 baseline。
- 旧群迁移时，不能简单把当前 UID 级锚点写成 baseline；否则会挡掉上线前已经存在的 partial delivery 补偿。
- 旧群迁移只标记 `baselineSource: "existing_target"` 和 `activatedAt`，不写内容 baseline，或者写 baseline 但允许已有 delivery ledger 缺口穿透。
- 只有运行时首次发现的“新目标群”才使用当前 UID 级锚点作为 `baselineSource: "new_target"`。
- baseline 不是投递记录，不表示发送过，只表示“这个基准及更早内容不应该因补偿逻辑发送给该群”。

### Store API 设计

在 `SubscriptionStateStore` 增加：

```js
async ensureTargetBaseline(uid, groupId, contentType, currentAnchor)
async ensureTargetBaselines(uid, groupIds, currentState)
async markTargetInactive(uid, groupId, removedAt)
async reactivateTargetBaseline(uid, groupId)
getTargetBaseline(userState, groupId, contentType)
```

规则：

- `ensureTargetBaselines()` 幂等，只在目标群第一次出现时写 baseline。
- 不允许用更旧 baseline 覆盖已有 baseline。
- 删除订阅群时不物理删除 baseline，而是标记 `active: false` 和 `removedAt`。
- 用户误删再加时，`reactivateTargetBaseline()` 复用旧 baseline，并更新 `active: true`，避免短期误删导致旧内容回放。
- 定期清理超过 30 天仍为 inactive 的 target baseline。
- Cookie 同步目标群启用时同样要初始化 baseline，不能只处理手动订阅。
- Cookie 关注列表刷新、分组过滤变化、群账号映射变化都会改变目标群集合；baseline ensure 不能只依赖启动初始化。

### 检查流程调整

所有动态、视频、专栏、直播检查在构建 `targetGroupSourceMap` 后先调用：

```js
await this.ensureTargetBaselinesForUser(userItemOrSub, targetGroupSourceMap, unifiedState)
```

然后 `getUndeliveredGroupSourceMap()` 增加 baseline 过滤：

```js
const coverage = await deliveryStore.getDeliveryCoverage(groupIds, contentType, contentId)
if (!coverage.hasAnyRecord) return new Map()

const retryableGroups = coverage.undeliveredGroups.filter(groupId => {
  const baseline = stateStore.getTargetBaseline(unifiedState, groupId, contentType)
  if (baseline?.baselineSource === 'existing_target') {
    return true
  }
  return isContentAfterBaseline({ contentType, contentId, contentTime, baseline })
})
```

现有 `targeting.getUndeliveredGroupSourceMap(contentType, contentId, targetGroupSourceMap)` 的参数不够。必须改成对象参数：

```js
await this.getUndeliveredGroupSourceMap({
  uid,
  contentType,
  contentId,
  contentTime,
  targetGroupSourceMap
})
```

字段要求：

- `uid` 用于读取该 UID 的 target baseline。
- `contentType` 为 `dynamic`、`video`、`article` 或 `live`。
- `contentId` 是台账 key 中的内容 ID。
- `contentTime` 是 video/article 的发布时间，dynamic 可以为空。
- `targetGroupSourceMap` 是当前目标群和来源集合。

比较规则：

- dynamic：`contentId > baselineId` 才允许补偿。
- video：优先用 `created > baselineTime`，无时间时用 `contentId !== baselineId && contentId` 新于 baseline。
- article：优先用 `publish_time > baselineTime`。
- live：直播开播补偿只对 baseline 建立后发生的在线状态有效；新增群时如果 UID 已在线，不补发当前开播，等下次下播再开播。

迁移穿透规则：

- `baselineSource: "new_target"`：严格按 baseline 过滤，防止新增群收到旧内容。
- `baselineSource: "existing_target"`：允许已有 ledger partial retry 穿透，防止上线前失败群永久漏推。
- 没有 baseline：保守视为 existing target，仅允许在 `coverage.hasAnyRecord === true` 时按旧账本补偿；随后立即补写 baseline，避免下一轮语义不明。

### 为什么不用直接给新增群写 tombstone

也可以在新增群时给当前 UID 最新内容写 `group:type:contentId` 的 tombstone，但这会混淆“真实投递”和“接收边界”：

- 后续审计看不出内容到底有没有发送过。
- 新增群时可能拿不到 video/article/live 的所有当前内容 ID。
- baseline 能表达“不应补历史”，比伪造投递记录更干净。

投递台账仍只记录真实投递成功和本地 dedup 确认，不记录订阅边界。

## 2. 视频下载副作用全量发送问题

### 当前问题

视频卡片补偿时，卡片发送使用 `effectiveGroupSourceMap`，但下载副作用仍用原始 `targetGroups`：

```js
videoDownloadService.downloadAndSendToGroups(this.ws, targetGroups, bvid, info)
```

当 A 群已成功、B 群失败时，下一轮只应补 B 群卡片；但下载文件仍可能再次发给 A 群。

### 完整修复设计

把“当前有效目标群”提升为统一变量：

```js
const effectiveGroupSourceMap = shouldRetryMissingGroups ? ledgerRetryMap : normalizedTargetGroupSourceMap
const effectiveTargetGroups = this.getGroupIdsFromSourceMap(effectiveGroupSourceMap)
```

视频卡片、投递台账、下载副作用、日志都使用 `effectiveTargetGroups`。

修改点：

- `checkUserVideoUnified()` 中下载调用改用 `effectiveTargetGroups`。
- 若 `effectiveTargetGroups.length === 0`，不触发下载。
- `videoDownloadService.downloadAndSendToGroups()` 内部已有退群过滤仍保留，作为第二道防线。
- 日志中增加 `effectiveGroupCount` 和 `retryMode`，方便确认补偿模式只触达缺失群。

### 进一步约束

下载副作用是否应该在“台账补偿”时触发，需要明确产品语义：

- 如果订阅视频卡片和视频文件是一体体验，补偿时应该只给缺失群补文件。
- 如果视频文件只是新视频首发时的一次性附带动作，补偿时可以完全不触发下载。

推荐选择第一种：补偿缺失群时也补文件，但严格只发给缺失群。这样不会造成漏推，也不会重复打扰已成功群。

## 3. Node `_withCache()` 吞掉 Python error envelope 问题

### 当前问题

Python handler 已返回稳定 envelope，但 Node `biliApi._withCache()` catch 只返回：

```js
{
  status: 'error',
  message: `Service communication error: ${error.message}`
}
```

这会丢失：

- `errorType`
- `retryable`
- `endpoint`
- `httpStatus`
- `biliCode`
- `exceptionClass`

影响范围包括 `getUserInfo/getUserCard/getVideoInfo/getDynamicInfo/getArticleInfo/getBangumiInfo` 等所有走 `_withCache()` 的接口。

### 完整修复设计

新增统一 helper：

```js
normalizeServiceError(error, fallbackEndpoint)
```

规则：

1. 如果 `error.response.data` 是 Python envelope，直接透传并补齐缺字段：
   - `status: 'error'`
   - `endpoint: payload.endpoint || fallbackEndpoint`
   - `httpStatus: payload.httpStatus || error.response.status`
   - `errorType/retryable` 使用 payload 优先。
2. 如果 axios 没有响应，调用 `classifyBiliApiError(error)` 生成结构化 envelope。
3. 如果 serviceManager 抛出的 error 上已有 `endpoint/httpStatus/responseData`，同样优先读取。
4. 不再把所有错误包装成 `Service communication error`，只在 `message` 为空时补一条可读 message。

返回格式：

```js
{
  status: 'error',
  message,
  errorType,
  failureKind: errorType,
  retryable,
  endpoint,
  httpStatus,
  biliCode,
  exceptionClass,
  code
}
```

### `_withCache()` 调整

`_withCache(keyPrefix, id, groupId, fetchFn, cacheOptions)` 增加 `endpoint` 或从 `keyPrefix` 映射：

```js
async _withCache(keyPrefix, id, groupId, fetchFn, cacheOptions = false, endpoint = keyPrefix)
```

每个调用点传真实 RPC endpoint，例如：

- `getUserInfo()` -> `user_info`
- `getUserCard()` -> `user_card`
- `getVideoInfo()` -> `video`
- `getDynamicInfo()` -> `dynamic_detail`
- `getArticleInfo()` -> `article`

catch 中：

```js
return normalizeServiceError(error, endpoint)
```

### ServiceManager 保持职责

`ServiceManager.sendCommand()` 仍负责日志和抛错，不需要改成返回 error envelope。原因：

- 直接调用 `sendCommand()` 的方法已经有自己的错误处理。
- `_withCache()` 是吞错返回对象的边界，应该在这个边界恢复 envelope。
- 避免改变所有直接 RPC 调用的异常语义。

### Python handler 补齐

`handle_user_videos()` 和 `handle_user_articles()` 缺 uid 时当前返回 `json_result(invalid_request_envelope(...))` 但没有 HTTP 400。建议统一改成 `_handler_invalid()`，让 HTTP status 和 envelope 都是 400。

这不影响 Node envelope 透传，但能减少 Dashboard/API 调试歧义。

## 4. Dashboard `vendor-icons` 分支不可达问题

### 当前问题

`manualChunks()` 先判断：

```js
if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
  return 'vendor-react'
}
```

`lucide-react` 路径包含 `react`，因此会被归入 `vendor-react`，后面的 `vendor-icons` 分支基本不可达。

### 完整修复设计

把更具体的包名判断放在前面：

```js
if (id.includes('lucide-react')) return 'vendor-icons'
if (id.includes('recharts') || id.includes('/d3-')) return 'vendor-charts'
if (id.includes('framer-motion')) return 'vendor-motion'
if (id.includes('axios')) return 'vendor-http'
if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'vendor-react'
```

同时把判断封装成更稳定的 `node_modules` 包名解析，避免路径字符串误伤：

```js
function getPackageName(id) {
  const marker = 'node_modules/'
  const index = id.lastIndexOf(marker)
  if (index < 0) return ''
  const rest = id.slice(index + marker.length)
  if (rest.startsWith('@')) return rest.split('/').slice(0, 2).join('/')
  return rest.split('/')[0]
}
```

然后按 package name 判断：

```js
const pkg = getPackageName(id)
if (pkg === 'lucide-react') return 'vendor-icons'
if (pkg === 'recharts' || pkg.startsWith('d3-')) return 'vendor-charts'
if (pkg === 'framer-motion') return 'vendor-motion'
if (pkg === 'axios') return 'vendor-http'
if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-router' || pkg === 'react-router-dom') {
  return 'vendor-react'
}
```

验收目标：

- `npm run build` 不出现 500k chunk warning。
- 输出中如果使用了 `lucide-react`，应能看到 `vendor-icons`，或确认 Rollup tree-shake 后没有单独图标 chunk。
- 不引入 circular dependency warning。

## 实施顺序

1. 先改 `subscriptionStateStore`，加入 target baseline schema、normalize、get/ensure/mark-inactive/reactivate API。
2. 改 `targeting.getUndeliveredGroupSourceMap()` 为对象参数，把 UID、content timestamp 和 baseline 过滤纳入账本补偿。
3. 改动态、视频、专栏、直播检查，在每次计算目标群后确保 baseline 存在，并传入必要的 content timestamp 供比较。
4. 在 lifecycle 初始化后，对当前 `buildUserCheckList()` 和手动订阅目标执行一次 baseline backfill；这只是优化，不是正确性依赖。
5. 改 `checkUserVideoUnified()` 下载副作用目标群为 `effectiveTargetGroups`。
6. 新增 Node error envelope normalize helper，并接入 `_withCache()`。
7. 统一 Python handler invalid request HTTP 400。
8. 调整 Dashboard manual chunk 包名匹配顺序。

## 测试矩阵

### 单元测试

新增或扩展以下测试：

1. `subscription-state-store.test.js`
   - target baseline 可保存、reload、幂等。
   - 新 baseline 不覆盖已有 baseline。
   - schema v1 文件可 normalize 到 v2。
   - inactive baseline 30 天内 re-activate 不丢接收边界。
   - `baselineSource=existing_target` 和 `baselineSource=new_target` normalize 后语义保留。

2. `updateChecker-dynamic-fallback-ledger.test.js`
   - A 群已有 `dynamic:X` 台账，B 群新增订阅后，不补发 `X`。
   - B 群新增后，出现 `dynamic:Y > X` 时，A+B 都可收到 `Y`。
   - A 成功 B 失败的同轮 partial delivery，下一轮仍只补 B。
   - 旧群迁移为 `existing_target` 后，A 成功 B 失败的历史 partial delivery 仍能补 B。

3. `updateChecker-unified-state-advance.test.js`
   - 视频 latest 已到锚点且 A 有账本 B 为新增 baseline 时，不补发旧视频。
   - 视频 A 成功 B 失败后，下载副作用只发 B。
   - 专栏同视频规则。
   - `getUndeliveredGroupSourceMap()` 必须接收 `contentTime`，无时间戳路径只作为降级比较。

4. `updateChecker-manual-feed-state-advance.test.js`
   - 直播当前已在线时新增 B 群，不补发当前开播。
   - 下播再开播后 B 群正常收到新开播。
   - Cookie follower 或分组刷新导致目标群变化时，检查前会补 baseline。

5. `biliApi-error-envelope.test.js`
   - `_withCache()` 遇到 axios `response.data` envelope 时透传 `errorType/retryable/endpoint/httpStatus`。
   - `_withCache()` 遇到 timeout/ECONNRESET 时生成 `transient_network`。
   - `_withCache()` 不缓存 error 结果。

6. Dashboard build 测试或快照
   - `manualChunks()` 对 `node_modules/lucide-react/dist/...` 返回 `vendor-icons`。
   - 对 `node_modules/react/...` 返回 `vendor-react`。
   - 对 `node_modules/recharts/...` 返回 `vendor-charts`。

### 集成验证

1. `npm test`
2. `venv/bin/python -m pytest test/unit/bilibili`
3. `cd dashboard && npm run lint && npm run build`
4. `docker build -t bili-qq-bot-local-smoke:review-fix .`
5. `npm start` smoke，不启动 NapCat，验证 `/api/status` 和 Python `/health`。

## 验收标准

本次修复完成必须同时满足：

- 新增群不会收到订阅前已经存在的旧动态、旧视频、旧专栏、当前直播开播。
- partial delivery 仍可补偿原本发送失败的群，不因 baseline 过滤而漏推。
- 视频下载副作用和卡片补偿目标完全一致。
- Node 调用方拿到的非订阅接口错误 envelope 字段完整。
- Dashboard build 无大 chunk warning，manual chunk 规则与实际输出一致。
- 全量单测和 Docker build 通过。

## 风险与回滚

### 风险

- baseline schema 引入后，旧状态文件 normalize 需要谨慎，不能破坏已有 UID 锚点。
- 如果 baseline 初始化时机太晚，某一轮检查仍可能先执行补偿逻辑。因此必须在所有检查前统一执行 baseline ensure。
- 如果 baseline 过滤写得过严，可能误伤 partial delivery 补偿。因此测试必须区分“新增群”和“同轮失败群”。

### 回滚

如果上线后发现 baseline 逻辑异常，可以临时关闭 baseline 过滤，但保留 UID 统一锚点和投递台账：

```js
SUBSCRIPTION_TARGET_BASELINE_GUARD=false
```

建议实现时将 baseline guard 做成配置开关，仅用于紧急回滚。默认必须开启。
