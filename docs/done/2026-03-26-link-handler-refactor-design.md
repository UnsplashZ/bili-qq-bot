# LinkHandler 重构设计

## 背景

当前 `src/handlers/linkHandler.js` 同时承担链接提取、结构化解析、短链展开、冷却缓存、Bili API 拉取、预览图渲染、消息发送、失败降级与类型分发等职责。该文件已经从单一 handler 演变为端到端业务编排器，导致模块边界模糊、扩展新链接类型时需要持续膨胀 `switch`、测试粒度过粗，且 `messageHandler`、Preview Lab、订阅通知模块都已与它产生多点耦合。

这次重构的目标不是只在文件内部做整理，而是同时完成三件事：拆解 `linkHandler` 内部职责、调整 `messageHandler -> link` 边界、把核心能力下沉到 `services/link/` 领域模块中，同时保留一层兼容 facade 以降低迁移风险。

## 目标

1. 将 `src/handlers/linkHandler.js` 从全能类收敛为兼容 facade。
2. 在 `src/services/link/` 下建立清晰的领域模块边界，拆分提取、缓存、编排、拉取、渲染、发送等职责。
3. 让 `messageHandler` 只保留消息入口编排与 emoji 生命周期，不再关心链接处理细节。
4. 用类型注册表替换 `processSingleLink()` 中的巨型 `switch`，降低新增资源类型的修改面。
5. 保持现有链接识别、冷却缓存、失败可重试、订阅成功后写缓存等行为兼容。

## 非目标

1. 不在这次重构中新增新的 B 站资源类型。
2. 不改动现有 preview card 的视觉表现或 `imageGenerator` 设计。
3. 不改变当前消息层面对 emoji 的触发规则。
4. 不追求一次性删除所有旧接口；兼容层会在迁移完成前保留。

## 设计概览

### 目标边界

- `messageHandler`
  - 负责消息入口、短期交互反馈、emoji 生命周期
  - 不再知道短链展开、链接缓存、单链接处理细节
- `src/services/link/`
  - 负责链接识别、处理编排、缓存、拉取、渲染与发送
- `src/handlers/linkHandler.js`
  - 只保留兼容 facade，转发到 `services/link/`

### 目标调用关系

```txt
messageHandler
  -> services/link/index
      -> messageLinkNormalizer
      -> shortLinkExpander
      -> linkExtractor
      -> linkCacheService
      -> linkPipeline
          -> linkRegistry
          -> linkFetchService
          -> linkRenderService
          -> linkSender
```

### 建议目录结构

```txt
src/services/link/
  index.js
  messageLinkNormalizer.js
  linkPipeline.js
  linkExtractor.js
  shortLinkExpander.js
  structuredLinkParser.js
  regexLinkParser.js
  linkRegistry.js
  linkCacheService.js
  linkFetchService.js
  linkRenderService.js
  linkSender.js
  linkTypes/
    video.js
    bangumi.js
    dynamic.js
    article.js
    ...
```

## 模块职责设计

### `src/services/link/index.js`

对外应优先暴露一个高层 use case 给 `messageHandler` 使用：

- `handleIncomingMessageLinks({ ws, groupId, userId, rawMessage, messageSegments, traceContext })`

该高层入口内部再组合：

- `messageLinkNormalizer(input)`
- `shortLinkExpander(normalizedMessage)`
- `linkExtractor(expandedMessage, groupId)`
- `linkPipeline(descriptors, context)`

兼容 facade 或测试场景仍可暴露较低层接口，例如：

- `expandShortLinks(rawMessage, traceContext)`
- `resolveMessageLinks(rawMessage, groupId, traceContext)`
- `processLinks(links, context)`

但这些低层接口不是 `messageHandler` 的推荐调用方式。这样才能真正把“先展开、再提取、再处理”的流程细节收口到 link 域内部。

### `messageLinkNormalizer`

负责把消息层输入归一化为 link 域可消费的文本输入，尤其覆盖当前 `messageHandler` 中的 JSON 小程序链路。它应接收 `{ rawMessage, messageSegments, traceContext }`，并完成：

- 从 `messageSegments` 中识别 `json` 消息
- 按现有兼容路径提取小程序内 URL（如 `meta.detail_1.qqdocurl`、`meta.news.jumpUrl`、`prompt` 等）
- 将提取到的 URL 追加回文本输入，保持与当前行为一致
- 保留现有日志语义（`json-extract-start`、`json-url-found`、`json-url-missing`、`json-parse-failed`）

这一步属于 link 域的一部分，而不是继续留在 `messageHandler` 中。否则按新设计实现时会漏掉 B 站小程序消息。

### `shortLinkExpander`

职责单一：识别并展开 `b23.tv` 短链。失败时返回原 URL，不抛致命错误。这样 `messageHandler` 与 Preview Lab 都不必直接依赖 `https.request` 细节。

### `linkExtractor`

负责把原始文本转为统一的 link descriptor 列表，不做数据拉取、消息发送或渲染。

内部由两类解析器组成：

- `structuredLinkParser`：处理可以通过 URL path/query 精确识别的结构化链接，例如 `space/.../favlist`、`topic_id`、`cheese/play/...`
- `regexLinkParser`：处理通用短码与兜底识别，例如 `BV`、`av`、`au`、`rl`

输出统一 descriptor：

```js
{
  type,
  id,
  match,
  sourceToken,
  cacheKey,
  meta
}
```

这层只表达“识别结果”，不表达“如何处理”。

### `linkCacheService`

独立负责链接冷却缓存：

- `isCached(cacheKey)`
- `markProcessed(cacheKey)`
- `markProcessedDescriptor(descriptor)`
- `cleanupExpired()`

约束：

- 仍按群配置读取 `linkCacheTimeout`
- 只接收 `cacheKey` 或 descriptor，不负责解析文本
- 只有成功处理后的链接才进入冷却缓存
- 订阅推送成功后仍可由上层在完成文本解析后主动写缓存

### `linkRegistry`

用注册表替换当前按 `type` 分支的大型 `switch`。每种链接类型由单独模块注册并提供：

- `fetch(groupId, descriptor)`
- `buildUrl(descriptor, info)`
- `resolveCardType(info, descriptor)`
- 可选 `getCacheIdentity(descriptor)`
- 可选 `afterSend({ ws, groupId, userId, descriptor, info, sendResult, traceContext })`

其中 `afterSend` 用于承接类型专属副作用，避免这些逻辑重新回流到中心编排层。当前最明确的现有场景是 `video` 在卡片发送成功后还会触发 `videoDownloadService.downloadAndSend`。这类行为应挂在对应类型模块上，而不是让 `linkPipeline` 或 `messageHandler` 再次出现按类型特判。

新增链接类型时，只需新增 `linkTypes/*.js` 并注册，不再修改中心编排逻辑。

### `linkFetchService`

统一负责：

- 通过 `linkRegistry` 找到对应 fetcher
- 复用现有 `cacheManager` 做数据缓存
- 保留 `status === 'success'` 语义

它不关心消息发送或失败提示，只产出 fetch 结果。

### `linkRenderService`

统一负责：

- 调用 `imageGenerator.generatePreviewCard`
- 生成可发送的图片 payload
- 在渲染失败时生成可发送的文本降级 payload

它只返回“渲染产物状态”，不返回最终发送语义，至少区分：

- `card_ready`：预览卡渲染完成，可交给 sender 发送
- `fallback_text_ready`：卡片渲染失败，但已准备好文本降级内容
- `render_failed`：既没有卡片产物，也没有可发送的降级内容

最终的发送语义由 `linkPipeline` 在调用 `linkSender` 后统一汇总为：

- `sent_card`
- `sent_fallback_text`
- `failed`

这样 `linkRenderService` 与 `linkSender` 的边界保持清晰：前者只负责准备内容，后者只负责投递内容，pipeline 负责把两者结果汇总成对上层可见的处理状态。

### `linkSender`

统一负责：

- 群聊 / 私聊路由
- 图片消息链发送
- 文本 fallback 发送

这样私聊与群聊的发送分发不会散落在多个模块中。

### `linkPipeline`

这是新的多链接编排器，负责：

- 过滤冷却缓存
- 基于 `cacheKey` 去重
- 按顺序处理多个 descriptor
- 聚合成功 / 失败结果
- 仅在成功后调用 `linkCacheService.markProcessed()`

它不负责 emoji，emoji 生命周期仍由 `messageHandler` 控制。

## 数据流设计

### 文本解析流

```txt
{ rawMessage, messageSegments }
  -> messageLinkNormalizer
  -> shortLinkExpander
  -> linkExtractor
  -> descriptors[]
```

### 链接处理流

```txt
descriptors[]
  -> linkPipeline
      -> linkCacheService 过滤冷却
      -> linkRegistry 找到类型处理器
      -> linkFetchService 拉数据
      -> linkRenderService 生成卡片或降级内容
      -> linkSender 投递消息
      -> linkPipeline 汇总 render + send 结果
      -> linkCacheService 标记成功项
  -> result
```

### `messageHandler` 消费的返回结果

```js
{
  foundCount,
  skippedCachedCount,
  successCount,
  failureCount,
  allCached,
  results: [
    { descriptor, renderStatus: 'card_ready', status: 'sent_card' },
    { descriptor, renderStatus: 'fallback_text_ready', status: 'sent_fallback_text' },
    { descriptor, renderStatus: 'render_failed', status: 'failed', error }
  ]
}
```

语义约束：

- `card_ready` / `fallback_text_ready` 只是渲染层产物状态
- `sent_card` / `sent_fallback_text` / `failed` 才是 pipeline 汇总后的最终处理状态
- `sent_card`：成功，允许写冷却缓存
- `sent_fallback_text`：也视为成功，允许写冷却缓存
- `failed`：失败，不写冷却缓存，允许用户重试

基于这个结果，`messageHandler` 只负责：

- `allCached === true` 时发 `SHUSH`
- `failureCount > 0` 时发 `CRYING`
- 当所有实际处理结果均为 `sent_card` 或 `sent_fallback_text` 时发 `OK`

## 兼容策略

### 保留 `src/handlers/linkHandler.js` facade

在迁移完成前，`src/handlers/linkHandler.js` 保留这些对外入口，但内部全部转发到 `services/link/`：

- `extractLinks`
- `expandUrl`
- `processSingleLink`
- `isLinkCached`
- `addLinkToCache`
- `addUrlToCache`
- `sendGroupMessage`

其中保留 `processSingleLink` facade 的直接原因是当前仍有这些调用方依赖它：

- `src/handlers/messageHandler.js`
- `test/unit/link-handler-logging.test.js`

该 facade 仅用于迁移兼容期，不接受新的调用方继续接入。

`addUrlToCache` 的现有语义也不只是“单 URL 写缓存”，而是“从一段文本或 URL 中提取一个或多个可识别链接并写入冷却缓存”。这类 convenience API 应放在 `services/link/index.js` 或 facade 中，由上层先调用 extractor 解析出 descriptors，再交给 `linkCacheService` 写入缓存。兼容层阶段仍可保留旧名，但新的 cache service 只接收 `cacheKey` 或 descriptor，不再直接接收原始文本。

这样可以先完成内部职责重构，再分步迁移外部调用点。

### 外部调用点迁移顺序

1. `messageHandler.js`：优先切到新的统一入口
2. `src/services/subscription/updateChecker/modules/notify.js`：从 `linkHandler.addUrlToCache()` 迁到 `services/link/index.js` 的 convenience API，或由上层先解析 descriptor 再交给 `linkCacheService.markProcessedDescriptor()`；迁移期也可先经 facade 过渡
3. `src/services/previewLab/inputResolver.js`：可先保留通过 facade 调用，后续再直连 `services/link/`

## 迁移步骤

### Phase 1：抽纯解析能力

先从当前分散实现中抽出：

- `messageLinkNormalizer`
- `shortLinkExpander`
- `structuredLinkParser`
- `regexLinkParser`
- `linkExtractor`

目标：先把“消息归一化 + 识别链接”从“处理链接”里剥离，同时保持 `extractLinks()` 输出结构不变，并完整覆盖当前 JSON 小程序补链逻辑。

### Phase 2：抽缓存与注册表

新增：

- `linkCacheService`
- `linkRegistry`

目标：统一缓存策略，并把新增类型的修改入口收敛到注册文件，而不是继续扩张中心 `switch`。

### Phase 3：抽单链接处理链路

新增：

- `linkFetchService`
- `linkRenderService`
- `linkSender`

目标：拆解 `processSingleLink()`，明确谁负责拉数据、渲染、发送与文本降级。

### Phase 4：引入 `linkPipeline`

把多链接处理流程迁入 pipeline：

- 去重
- 冷却过滤
- 顺序处理
- 成功写缓存
- 聚合返回结果

目标：让 `messageHandler` 不再逐条处理链接，而是消费 pipeline 的聚合结果。

### Phase 5：收敛外部调用点

依次迁移：

- `messageHandler.js`
- `notify.js`
- `previewLab/inputResolver.js`
- `test/unit/link-handler-logging.test.js`（改为高层入口或新的兼容边界）

目标：外部代码逐步只依赖稳定入口，`handlers/linkHandler.js` 最终退化为纯兼容层。

## 风险与控制

### 风险 1：解析行为回归

重点风险点：

- `sourceToken`
- `cacheKey`
- `meta.uniqueId`
- structured link 覆盖同 token user 命中的规则

控制方式：先把提取层行为通过单测固定住，过渡期保持 descriptor 输出结构兼容。

### 风险 2：错误提示重复发送

当前失败提示既出现在 `processSingleLink()`，也可能在 `messageHandler()` 的 catch 中二次发送。

重构决策：**用户可见错误只由 pipeline 上层统一发一次**，底层 service 仅返回错误信息，不直接叠加新的失败提示。

### 风险 3：缓存写入时机变化

必须保持当前语义：

- 只有成功处理的链接才进入冷却缓存
- 失败链接允许用户稍后重试
- 订阅推送成功后仍可通过一段文本或 URL 主动写缓存

### 风险 4：调用点迁移不完整

控制方式：先保留 facade，再逐步替换调用点，避免“一步删旧接口”的硬切换。

## 测试策略

### 1. Extractor 层测试

覆盖：

- 普通 URL
- 短码
- 括号 / 标点包裹
- 结构化空间链接
- 未知空间子页不回退为 user
- structured link 覆盖同 token user 命中

可迁移并增强当前已有测试：

- `test/unit/linkHandler-extractLinks.test.js`
- `test/unit/linkHandler-new-types.test.js`

### 2. Pipeline 层测试

覆盖：

- 全部缓存
- 部分缓存
- 部分失败
- 全成功
- `card_ready` / `fallback_text_ready` 与最终发送状态的映射正确
- `sent_card` 与 `sent_fallback_text` 都会写缓存
- `failed` 不写缓存
- 多链接顺序处理
- 最终 emoji 判断与三态结果一致

### 3. Registry 层测试

覆盖：

- type 是否完成注册
- URL 构造是否正确
- fetch 参数是否正确传递
- cardType 解析是否正确

### 4. 兼容层测试

保证旧入口在重构期间不破：

- `extractLinks`
- `expandUrl`
- `addUrlToCache`
- `isLinkCached`

### 5. MessageHandler 集成测试

只验证边界行为：

- 找到链接后会调用高层入口 `handleIncomingMessageLinks(...)`
- JSON 小程序消息仍可识别出链接
- 全部缓存发 `SHUSH`
- `sent_card` / `sent_fallback_text` 结果发 `OK`
- 存在 `failed` 结果发 `CRYING`

## 验收标准

1. `src/handlers/linkHandler.js` 不再承载核心业务实现，只保留兼容 facade。
2. 新增链接类型时，不需要修改巨型 `switch`。
3. `messageHandler` 不再知道链接处理细节。
4. 订阅通知缓存不再直接依赖 handler。
5. 现有链接识别与冷却行为保持兼容。
6. 测试从单大文件覆盖转为提取 / 编排 / 注册表 / 兼容层的分层验证。
