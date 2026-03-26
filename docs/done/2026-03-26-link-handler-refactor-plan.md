# LinkHandler 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/handlers/linkHandler.js` 拆分为 `services/link/` 领域模块，保留迁移期 facade，并保持 JSON 小程序、短链展开、降级发送、缓存与 emoji 语义兼容。

**Architecture:** 新增高层入口 `handleIncomingMessageLinks({ ws, groupId, userId, rawMessage, messageSegments, traceContext })`，内部按 `messageLinkNormalizer -> shortLinkExpander -> linkExtractor -> linkPipeline` 编排。`linkRenderService` 只产出 `card_ready / fallback_text_ready / render_failed`，`linkPipeline` 在调用 `linkSender` 后统一汇总 `sent_card / sent_fallback_text / failed`，并触发缓存与类型副作用。

**Tech Stack:** Node.js 18+, CommonJS, Mocha + Node assert, existing `biliApi` / `imageGenerator` / `notificationService` / `logger` infrastructure

---

## File Structure

### Create
- `src/services/link/index.js` — 对外统一入口；提供高层消息处理入口和迁移期 convenience API
- `src/services/link/messageLinkNormalizer.js` — 从 `messageSegments` 的 JSON 小程序消息抽 URL，并追加到文本输入
- `src/services/link/shortLinkExpander.js` — 展开 `b23.tv` 短链
- `src/services/link/structuredLinkParser.js` — 解析结构化 URL（space、topic、cheese、note 等）
- `src/services/link/regexLinkParser.js` — 解析 BV/av/au/rl 等 regex 型链接
- `src/services/link/linkExtractor.js` — 组合 normalizer 后的文本 token，产出 descriptors
- `src/services/link/linkCacheService.js` — 只处理 `cacheKey` / descriptor 的冷却缓存读写
- `src/services/link/linkRegistry.js` — 注册所有 type handler，并暴露查询接口
- `src/services/link/linkFetchService.js` — 统一数据缓存与 fetch 调用
- `src/services/link/linkRenderService.js` — 生成 card payload 或 fallback text payload
- `src/services/link/linkSender.js` — 负责 group/private 投递
- `src/services/link/linkPipeline.js` — 处理 descriptors、调用 fetch/render/send、汇总结果
- `src/services/link/linkTypes/video.js` — `video` 类型 handler，包含 `afterSend`
- `src/services/link/linkTypes/bangumi.js` — `bangumi` 类型 handler
- `src/services/link/linkTypes/dynamic.js` — `dynamic` 类型 handler
- `src/services/link/linkTypes/article.js` — `article` 类型 handler
- `src/services/link/linkTypes/live.js` — `live` 类型 handler
- `src/services/link/linkTypes/opus.js` — `opus` 类型 handler
- `src/services/link/linkTypes/ep.js` — `ep` 类型 handler
- `src/services/link/linkTypes/media.js` — `media` 类型 handler
- `src/services/link/linkTypes/user.js` — `user` 类型 handler
- `src/services/link/linkTypes/favoriteList.js` — `favorite_list` 类型 handler
- `src/services/link/linkTypes/audio.js` — `audio` 类型 handler
- `src/services/link/linkTypes/audioList.js` — `audio_list` 类型 handler
- `src/services/link/linkTypes/topic.js` — `topic` 类型 handler
- `src/services/link/linkTypes/channelSeries.js` — `channel_series` 类型 handler
- `src/services/link/linkTypes/articleList.js` — `article_list` 类型 handler
- `src/services/link/linkTypes/note.js` — `note` 类型 handler
- `src/services/link/linkTypes/cheeseVideo.js` — `cheese_video` 类型 handler
- `test/unit/messageLinkNormalizer.test.js` — 验证 JSON 小程序补链逻辑
- `test/unit/linkExtractor-service.test.js` — 验证 extractor 输出与现有 descriptor 兼容
- `test/unit/linkCacheService.test.js` — 验证 cache 读写与 descriptor 写缓存
- `test/unit/linkPipeline.test.js` — 验证三态结果、缓存语义、afterSend 钩子
- `test/unit/link-index-cache-api.test.js` — 验证 convenience API 解析文本后写缓存

### Modify
- `src/handlers/linkHandler.js` — 收敛为 facade，转发到 `services/link/`
- `src/handlers/messageHandler.js` — 改为调用高层入口，不再自己拼 JSON/扩短链/逐条处理链接
- `src/services/previewLab/inputResolver.js` — 迁移到 `services/link/index.js` 的低层接口
- `src/services/subscription/updateChecker/modules/notify.js` — 从 `addUrlToCache()` 迁移到 link index convenience API
- `test/unit/linkHandler-new-types.test.js` — 如需，切到新 facade 输出结构
- `test/unit/linkHandler-extractLinks.test.js` — 保持现有 extractor 兼容行为
- `test/unit/link-handler-logging.test.js` — 从直接调用 `processSingleLink()` 改为验证高层入口或兼容 facade
- `test/unit/messageHandler-linkReaction.test.js` — 校验 `OK/CRYING/SHUSH` 仍按新结果语义触发

### Responsibility Notes
- `linkRenderService` 只准备内容，不负责发送
- `linkSender` 只负责投递，不负责渲染
- `linkCacheService` 不接收原始文本；“从文本提取并写缓存”只放在 `src/services/link/index.js` 或 facade
- `src/handlers/linkHandler.js` 的 `processSingleLink` 仅兼容迁移期，不接受新调用方接入
- `afterSend` 是非致命副作用钩子；失败只记录日志，不得把主链路的 `sent_card` / `sent_fallback_text` 升级成失败
- 本次实现应在新分支上进行；后续如需提交，commit subject/body 与分支命名相关规则必须遵循 `AGENTS.md`
- 计划中的 commit 步骤仅表示推荐切分点；真正执行前必须先获得用户明确批准

## Task 1: 抽出消息归一化、短链展开和 extractor

**Files:**
- Create: `src/services/link/messageLinkNormalizer.js`
- Create: `src/services/link/shortLinkExpander.js`
- Create: `src/services/link/structuredLinkParser.js`
- Create: `src/services/link/regexLinkParser.js`
- Create: `src/services/link/linkExtractor.js`
- Create: `test/unit/messageLinkNormalizer.test.js`
- Create: `test/unit/linkExtractor-service.test.js`
- Modify: `src/handlers/linkHandler.js`
- Test: `test/unit/linkHandler-extractLinks.test.js`
- Test: `test/unit/linkHandler-new-types.test.js`

- [ ] **Step 1: 写失败测试，固定 JSON 小程序和 extractor 行为**

```js
// test/unit/messageLinkNormalizer.test.js
'use strict'

const assert = require('assert')
const { normalizeIncomingMessage } = require('../../src/services/link/messageLinkNormalizer')

describe('messageLinkNormalizer', function () {
    it('把 json 小程序里的 bilibili url 追加回 rawMessage', function () {
        const result = normalizeIncomingMessage({
            rawMessage: '[CQ:json,data=mock]',
            messageSegments: [{
                type: 'json',
                data: {
                    data: JSON.stringify({
                        meta: {
                            detail_1: {
                                qqdocurl: 'https://www.bilibili.com/video/BV1ZHiyBkExG'
                            }
                        }
                    })
                }
            }],
            traceContext: { scope: 'msg:1000:2:555' }
        })

        assert.ok(result.rawMessage.includes('https://www.bilibili.com/video/BV1ZHiyBkExG'))
    })
})
```

```js
// test/unit/linkExtractor-service.test.js
'use strict'

const assert = require('assert')
const { extractLinksFromMessage } = require('../../src/services/link/linkExtractor')

describe('linkExtractor service', function () {
    it('保留现有 descriptor 结构', function () {
        const links = extractLinksFromMessage('https://www.bilibili.com/space/123/favlist?fid=456', '10001')

        assert.deepStrictEqual(links[0], {
            type: 'favorite_list',
            id: '456',
            cacheKey: 'favorite_list|video:456|10001',
            match: 'https://www.bilibili.com/space/123/favlist?fid=456',
            meta: {
                url: 'https://www.bilibili.com/space/123/favlist?fid=456',
                mediaId: '456',
                favoriteType: 'video',
                uniqueId: 'video:456'
            },
            sourceToken: 'https://www.bilibili.com/space/123/favlist?fid=456'
        })
    })
})
```

- [ ] **Step 2: 跑测试确认当前缺模块/缺导出而失败**

Run:
```bash
npx mocha "test/unit/messageLinkNormalizer.test.js" "test/unit/linkExtractor-service.test.js"
```

Expected: FAIL，报 `Cannot find module '../../src/services/link/messageLinkNormalizer'` 或 `extractLinksFromMessage is not a function`

- [ ] **Step 3: 写最小实现，先把旧解析逻辑平移到新 service**

```js
// src/services/link/messageLinkNormalizer.js
'use strict'

const logger = require('../../utils/logger')

function getJsonUrl(jsonData) {
    return jsonData.meta?.detail_1?.qqdocurl
        || jsonData.meta?.detail_1?.url
        || jsonData.meta?.news?.jumpUrl
        || jsonData.meta?.detail?.qqdocurl
        || jsonData.meta?.detail?.url
        || jsonData.prompt
        || jsonData.meta?.detail_1?.preview
        || jsonData.url
        || ''
}

function normalizeIncomingMessage({ rawMessage, messageSegments = [], traceContext = null }) {
    let nextRawMessage = String(rawMessage || '')
    const jsonMsg = Array.isArray(messageSegments)
        ? messageSegments.find((segment) => segment?.type === 'json')
        : null

    if (!jsonMsg?.data?.data) {
        return { rawMessage: nextRawMessage }
    }

    try {
        logger.logEvent('info', 'LINK', traceContext?.scope || '', 'json-extract-start')
        const jsonData = JSON.parse(jsonMsg.data.data)
        const url = getJsonUrl(jsonData)
        if (url) {
            logger.logEvent('info', 'LINK', traceContext?.scope || '', 'json-url-found', { url })
            nextRawMessage += ` ${url}`
        } else {
            logger.logEvent('warn', 'LINK', traceContext?.scope || '', 'json-url-missing', {
                preview: JSON.stringify(jsonData).slice(0, 500)
            })
        }
    } catch (error) {
        logger.logEvent('warn', 'LINK', traceContext?.scope || '', 'json-parse-failed', {
            error: logger.getErrorMessage(error)
        })
    }

    return { rawMessage: nextRawMessage }
}

module.exports = {
    normalizeIncomingMessage
}
```

```js
// src/services/link/linkExtractor.js
'use strict'

const { parseStructuredToken, createLink, buildTokenInfo } = require('./structuredLinkParser')
const { parseRegexToken } = require('./regexLinkParser')

function extractLinksFromMessage(rawMessage, groupId, traceContext = null) {
    const source = String(rawMessage || '')
    if (!source) return []

    const tokens = source
        .split(/\s+/)
        .map((token) => buildTokenInfo(token))
        .filter(Boolean)

    const links = []
    for (const tokenInfo of tokens) {
        const structured = parseStructuredToken(tokenInfo, groupId)
        if (structured.handled) {
            if (structured.link) links.push(structured.link)
            continue
        }
        links.push(...parseRegexToken(tokenInfo, groupId))
    }

    return links.filter((link, index, arr) => arr.findIndex((item) => (
        item.type === link.type
        && item.cacheKey === link.cacheKey
        && item.sourceToken === link.sourceToken
    )) === index)
}

module.exports = {
    extractLinksFromMessage,
    createLink,
    buildTokenInfo
}
```

```js
// src/handlers/linkHandler.js
const { expandShortUrl, shortLinkRegex } = require('../services/link/shortLinkExpander')
const { extractLinksFromMessage } = require('../services/link/linkExtractor')

this.shortLinkRegex = shortLinkRegex

expandUrl(shortUrl) {
    return expandShortUrl(shortUrl)
}

extractLinks(rawMessage, groupId, traceContext = null) {
    return extractLinksFromMessage(rawMessage, groupId, traceContext)
}
```

- [ ] **Step 4: 跑新旧解析测试，确认 extractor 行为不变**

Run:
```bash
npx mocha "test/unit/messageLinkNormalizer.test.js" "test/unit/linkExtractor-service.test.js" "test/unit/linkHandler-new-types.test.js" && node test/unit/linkHandler-extractLinks.test.js
```

Expected: PASS；输出包含 `LinkHandler.extractLinks 动态链接识别测试` 且 `0 failed`

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/link/messageLinkNormalizer.js src/services/link/shortLinkExpander.js src/services/link/structuredLinkParser.js src/services/link/regexLinkParser.js src/services/link/linkExtractor.js src/handlers/linkHandler.js test/unit/messageLinkNormalizer.test.js test/unit/linkExtractor-service.test.js test/unit/linkHandler-new-types.test.js test/unit/linkHandler-extractLinks.test.js

git commit -F - <<'EOF'
refactor: 抽离链接消息归一化与解析服务

- 新增 messageLinkNormalizer、shortLinkExpander、structuredLinkParser、regexLinkParser 与 linkExtractor
- 保持 extractLinks 的 descriptor 结构兼容现有测试与调用方
- 为后续 link domain 拆分打下无副作用基础
EOF
```

Expected: 仅在用户明确批准提交且当前位于非 `main` 分支时执行；若仍在 `main`，先与用户确认是否切分支并按 `AGENTS.md` 调整 commit subject

## Task 2: 抽出 linkCacheService 和文本缓存 convenience API

**Files:**
- Create: `src/services/link/linkCacheService.js`
- Create: `src/services/link/index.js`
- Create: `test/unit/linkCacheService.test.js`
- Create: `test/unit/link-index-cache-api.test.js`
- Modify: `src/handlers/linkHandler.js`
- Modify: `src/services/subscription/updateChecker/modules/notify.js`

- [ ] **Step 1: 写失败测试，固定 cacheKey/descriptor 写缓存和文本 convenience API**

```js
// test/unit/linkCacheService.test.js
'use strict'

const assert = require('assert')
const linkCacheService = require('../../src/services/link/linkCacheService')

describe('linkCacheService', function () {
    it('支持按 descriptor 写入和读取缓存', function () {
        const descriptor = {
            type: 'video',
            id: 'BV1ZHiyBkExG',
            cacheKey: 'video|BV1ZHiyBkExG|1000'
        }

        linkCacheService.markProcessedDescriptor(descriptor)
        assert.strictEqual(linkCacheService.isCached(descriptor.cacheKey), true)
    })
})
```

```js
// test/unit/link-index-cache-api.test.js
'use strict'

const assert = require('assert')
const linkServices = require('../../src/services/link')

describe('link index cache convenience api', function () {
    it('先解析文本再写缓存', function () {
        const result = linkServices.cacheResolvedText('https://www.bilibili.com/video/BV1ZHiyBkExG', '1000')
        assert.strictEqual(result.addedCount, 1)
        assert.strictEqual(result.cacheKeys[0], 'video|BV1ZHiyBkExG|1000')
    })
})
```

- [ ] **Step 2: 跑测试确认 cache service 和 index API 还不存在**

Run:
```bash
npx mocha "test/unit/linkCacheService.test.js" "test/unit/link-index-cache-api.test.js"
```

Expected: FAIL，报缺模块或缺方法

- [ ] **Step 3: 实现 cache service，并让上层 convenience API 负责“解析文本后写缓存”**

```js
// src/services/link/linkCacheService.js
'use strict'

const config = require('../../config')

const state = new Map()

function getTimeoutMs(groupId) {
    const timeoutSeconds = config.getGroupConfig(groupId, 'linkCacheTimeout')
    return (timeoutSeconds || 300) * 1000
}

function isCached(cacheKey) {
    if (!state.has(cacheKey)) return false
    const time = state.get(cacheKey)
    const groupId = cacheKey.includes('|') ? cacheKey.slice(cacheKey.lastIndexOf('|') + 1) : null
    if (Date.now() - time >= getTimeoutMs(groupId)) {
        state.delete(cacheKey)
        return false
    }
    return true
}

function markProcessed(cacheKey) {
    state.set(cacheKey, Date.now())
}

function markProcessedDescriptor(descriptor) {
    if (!descriptor?.cacheKey) return
    markProcessed(descriptor.cacheKey)
}

module.exports = {
    isCached,
    markProcessed,
    markProcessedDescriptor,
    _state: state
}
```

```js
// src/services/link/index.js
'use strict'

const { extractLinksFromMessage } = require('./linkExtractor')
const linkCacheService = require('./linkCacheService')

function cacheResolvedText(text, groupId) {
    const links = extractLinksFromMessage(text, groupId)
    for (const link of links) {
        linkCacheService.markProcessedDescriptor(link)
    }
    return {
        addedCount: links.length,
        cacheKeys: links.map((link) => link.cacheKey)
    }
}

module.exports = {
    cacheResolvedText,
    extractLinksFromMessage,
    expandShortLinks: require('./shortLinkExpander').expandShortUrl
}
```

```js
// src/handlers/linkHandler.js
const linkCacheService = require('../services/link/linkCacheService')
const linkServices = require('../services/link')

isLinkCached(cacheKey) {
    return linkCacheService.isCached(cacheKey)
}

addLinkToCache(cacheKey) {
    linkCacheService.markProcessed(cacheKey)
}

addUrlToCache(url, groupId) {
    return linkServices.cacheResolvedText(url, groupId)
}
```

- [ ] **Step 4: 迁移 notify.js，停止直接把“文本解析”塞进 cache service**

```js
// src/services/subscription/updateChecker/modules/notify.js
const linkServices = require('../../../../services/link')

for (const groupId of cacheGroupIds) {
    linkServices.cacheResolvedText(textUrl, groupId)
}
```

Run:
```bash
npx mocha "test/unit/linkCacheService.test.js" "test/unit/link-index-cache-api.test.js"
```

Expected: PASS

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/link/index.js src/services/link/linkCacheService.js src/handlers/linkHandler.js src/services/subscription/updateChecker/modules/notify.js test/unit/linkCacheService.test.js test/unit/link-index-cache-api.test.js
git commit -F - <<'EOF'
refactor: 隔离链接冷却缓存服务与缓存便捷入口

- 新增只接 cacheKey 或 descriptor 的 linkCacheService
- 将解析文本后写缓存的能力收口到 link index convenience API
- 迁移 notify 模块，避免把文本解析职责拉回缓存层
EOF
```

## Task 3: 建立 registry、fetch、render、sender 基础设施并先迁移核心类型

**Files:**
- Create: `src/services/link/linkRegistry.js`
- Create: `src/services/link/linkFetchService.js`
- Create: `src/services/link/linkRenderService.js`
- Create: `src/services/link/linkSender.js`
- Create: `src/services/link/linkTypes/video.js`
- Create: `src/services/link/linkTypes/bangumi.js`
- Create: `src/services/link/linkTypes/dynamic.js`
- Create: `src/services/link/linkTypes/article.js`
- Create: `src/services/link/linkTypes/live.js`
- Create: `src/services/link/linkTypes/opus.js`
- Create: `src/services/link/linkTypes/ep.js`
- Create: `src/services/link/linkTypes/media.js`
- Modify: `src/handlers/linkHandler.js`
- Test: `test/unit/link-handler-logging.test.js`

- [ ] **Step 1: 写失败测试，先固定 render 三态和 sender 投递接口**

```js
// test/unit/linkPipeline.test.js (先写第一条用例)
'use strict'

const assert = require('assert')
const linkRenderService = require('../../src/services/link/linkRenderService')

describe('linkRenderService', function () {
    it('渲染成功时返回 card_ready', async function () {
        const result = await linkRenderService.renderPreview({ status: 'success', data: { title: 'test' } }, 'video', '1000')
        assert.strictEqual(result.renderStatus, 'card_ready')
        assert.ok(result.messageChain[0].type === 'image')
    })
})
```

- [ ] **Step 2: 跑测试确认 registry/render/sender 还不存在**

Run:
```bash
npx mocha "test/unit/linkPipeline.test.js" --grep "linkRenderService"
```

Expected: FAIL，报 `Cannot find module '../../src/services/link/linkRenderService'`

- [ ] **Step 3: 实现 registry 和 8 个核心类型模块，消掉 `switch` 的第一大块**

```js
// src/services/link/linkTypes/video.js
'use strict'

const biliApi = require('../../biliApi')
const videoDownloadService = require('../../videoDownloadService')

module.exports = {
    type: 'video',
    async fetch(groupId, descriptor) {
        return biliApi.getVideoInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://www.bilibili.com/video/${descriptor.id}`
    },
    resolveCardType(info) {
        return info.type || 'video'
    },
    async afterSend({ ws, groupId, descriptor, info }) {
        if ((info.type || 'video') === 'video') {
            await videoDownloadService.downloadAndSend(ws, groupId, descriptor.id, info)
        }
    }
}
```

```js
// src/services/link/linkRegistry.js
'use strict'

const handlers = new Map()

for (const handler of [
    require('./linkTypes/video'),
    require('./linkTypes/bangumi'),
    require('./linkTypes/dynamic'),
    require('./linkTypes/article'),
    require('./linkTypes/live'),
    require('./linkTypes/opus'),
    require('./linkTypes/ep'),
    require('./linkTypes/media')
]) {
    handlers.set(handler.type, handler)
}

function getHandler(type) {
    return handlers.get(type)
}

module.exports = {
    getHandler
}
```

```js
// src/services/link/linkFetchService.js
'use strict'

const cacheManager = require('../../utils/cacheManager')
const { getHandler } = require('./linkRegistry')

async function fetchLinkInfo(descriptor, groupId) {
    const handler = getHandler(descriptor.type)
    const cacheKey = `${descriptor.type}_${descriptor.meta?.uniqueId || descriptor.id}`
    const cached = await cacheManager.get(cacheKey)
    if (cached) return { handler, info: cached }

    const info = await handler.fetch(groupId, descriptor)
    if (info && info.status === 'success') {
        await cacheManager.set(cacheKey, info)
    }
    return { handler, info }
}

module.exports = {
    fetchLinkInfo
}
```

- [ ] **Step 4: 实现 render/sender 基础设施，并让旧 facade 先复用它们**

```js
// src/services/link/linkRenderService.js
'use strict'

const imageGenerator = require('../../services/imageGenerator')

async function renderPreview(info, cardType, groupId, options = {}) {
    try {
        const base64 = await imageGenerator.generatePreviewCard(info, cardType, groupId, options.showId)
        return {
            renderStatus: 'card_ready',
            messageChain: [
                { type: 'image', data: { file: `base64://${base64}` } },
                { type: 'text', data: { text: options.url } }
            ]
        }
    } catch (_error) {
        return {
            renderStatus: 'fallback_text_ready',
            messageChain: [{ type: 'text', data: { text: `预览生成失败，已降级为文本链接：\n${options.url}` } }]
        }
    }
}

module.exports = {
    renderPreview
}
```

```js
// src/services/link/linkSender.js
'use strict'

const notificationService = require('../../services/notificationService')

async function sendMessageChain(ws, groupId, userId, messageChain) {
    if (typeof groupId === 'string' && groupId.startsWith('private_')) {
        return notificationService.sendPrivateMessage(ws, groupId.replace('private_', ''), messageChain, 'LinkHandler', true)
    }
    if (groupId) {
        return notificationService.sendGroupMessage(ws, groupId, messageChain, 'LinkHandler', true)
    }
    return notificationService.sendPrivateMessage(ws, userId, messageChain, 'LinkHandler', true)
}

module.exports = {
    sendMessageChain
}
```

Run:
```bash
npx mocha "test/unit/linkPipeline.test.js" --grep "linkRenderService"
```

Expected: PASS

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/link/linkRegistry.js src/services/link/linkFetchService.js src/services/link/linkRenderService.js src/services/link/linkSender.js src/services/link/linkTypes/video.js src/services/link/linkTypes/bangumi.js src/services/link/linkTypes/dynamic.js src/services/link/linkTypes/article.js src/services/link/linkTypes/live.js src/services/link/linkTypes/opus.js src/services/link/linkTypes/ep.js src/services/link/linkTypes/media.js test/unit/linkPipeline.test.js
git commit -F - <<'EOF'
refactor: 建立链接注册表与核心类型处理器

- 新增 registry、fetch、render、sender 基础设施
- 首批迁移 video、bangumi、dynamic、article、live、opus、ep、media 类型
- 为后续 pipeline 三态结果与 afterSend 钩子准备统一边界
EOF
```

## Task 4: 迁移剩余类型并实现 linkPipeline 三态结果

**Files:**
- Create: `src/services/link/linkPipeline.js`
- Create: `src/services/link/linkTypes/user.js`
- Create: `src/services/link/linkTypes/favoriteList.js`
- Create: `src/services/link/linkTypes/audio.js`
- Create: `src/services/link/linkTypes/audioList.js`
- Create: `src/services/link/linkTypes/topic.js`
- Create: `src/services/link/linkTypes/channelSeries.js`
- Create: `src/services/link/linkTypes/articleList.js`
- Create: `src/services/link/linkTypes/note.js`
- Create: `src/services/link/linkTypes/cheeseVideo.js`
- Modify: `src/services/link/linkRegistry.js`
- Modify: `src/handlers/linkHandler.js`
- Test: `test/unit/linkPipeline.test.js`

- [ ] **Step 1: 写失败测试，固定三态结果、缓存语义和 afterSend 触发条件**

```js
// test/unit/linkPipeline.test.js
it('渲染失败但 fallback 发出时返回 sent_fallback_text 并写缓存', async function () {
    const result = await pipeline.processLinks([
        { type: 'video', id: 'BV1ZHiyBkExG', cacheKey: 'video|BV1ZHiyBkExG|1000', match: 'https://www.bilibili.com/video/BV1ZHiyBkExG', meta: {} }
    ], {
        ws: {},
        groupId: '1000',
        userId: '2',
        traceContext: { scope: 'msg:1000:2:555' }
    })

    assert.strictEqual(result.results[0].status, 'sent_fallback_text')
    assert.strictEqual(result.successCount, 1)
    assert.strictEqual(result.failureCount, 0)
})
```

- [ ] **Step 2: 跑测试确认 pipeline 还不存在或没有三态语义**

Run:
```bash
npx mocha "test/unit/linkPipeline.test.js"
```

Expected: FAIL，报 `Cannot find module '../../src/services/link/linkPipeline'` 或断言失败

- [ ] **Step 3: 实现剩余类型模块并注册完整 type 表**

```js
// src/services/link/linkTypes/user.js
'use strict'

const biliApi = require('../../biliApi')

module.exports = {
    type: 'user',
    async fetch(groupId, descriptor) {
        return biliApi.getUserInfo(descriptor.id, groupId)
    },
    buildUrl(descriptor) {
        return `https://space.bilibili.com/${descriptor.id}`
    },
    resolveCardType() {
        return 'user'
    }
}
```

```js
// src/services/link/linkRegistry.js
for (const handler of [
    require('./linkTypes/video'),
    require('./linkTypes/bangumi'),
    require('./linkTypes/dynamic'),
    require('./linkTypes/article'),
    require('./linkTypes/live'),
    require('./linkTypes/opus'),
    require('./linkTypes/ep'),
    require('./linkTypes/media'),
    require('./linkTypes/user'),
    require('./linkTypes/favoriteList'),
    require('./linkTypes/audio'),
    require('./linkTypes/audioList'),
    require('./linkTypes/topic'),
    require('./linkTypes/channelSeries'),
    require('./linkTypes/articleList'),
    require('./linkTypes/note'),
    require('./linkTypes/cheeseVideo')
]) {
    handlers.set(handler.type, handler)
}
```

- [ ] **Step 4: 实现 linkPipeline，让它负责 render+send 汇总、缓存和 afterSend**

```js
// src/services/link/linkPipeline.js
'use strict'

const logger = require('../../utils/logger')
const linkCacheService = require('./linkCacheService')
const { fetchLinkInfo } = require('./linkFetchService')
const { renderPreview } = require('./linkRenderService')
const { sendMessageChain } = require('./linkSender')

async function processLinks(descriptors, context) {
    const seen = new Set()
    const active = descriptors.filter((descriptor) => {
        if (!descriptor?.cacheKey || seen.has(descriptor.cacheKey)) return false
        seen.add(descriptor.cacheKey)
        return !linkCacheService.isCached(descriptor.cacheKey)
    })

    if (active.length === 0) {
        return { foundCount: descriptors.length, skippedCachedCount: descriptors.length, successCount: 0, failureCount: 0, allCached: true, results: [] }
    }

    const results = []
    for (const descriptor of active) {
        const { handler, info } = await fetchLinkInfo(descriptor, context.groupId)
        if (!info || info.status !== 'success') {
            results.push({ descriptor, renderStatus: 'render_failed', status: 'failed', error: new Error(info?.message || 'fetch failed') })
            continue
        }

        const url = handler.buildUrl(descriptor, info)
        const renderResult = await renderPreview(info, handler.resolveCardType(info, descriptor), context.groupId, { url })
        if (renderResult.renderStatus === 'render_failed') {
            results.push({ descriptor, renderStatus: 'render_failed', status: 'failed', error: new Error('render failed') })
            continue
        }

        await sendMessageChain(context.ws, context.groupId, context.userId, renderResult.messageChain)
        const status = renderResult.renderStatus === 'card_ready' ? 'sent_card' : 'sent_fallback_text'
        linkCacheService.markProcessedDescriptor(descriptor)
        if (typeof handler.afterSend === 'function') {
            try {
                await handler.afterSend({ ...context, descriptor, info, sendResult: { status } })
            } catch (afterSendError) {
                logger.logEvent('warn', 'LINK', context.traceContext?.scope || '', 'after-send-failed', {
                    linkType: descriptor.type,
                    linkId: descriptor.id,
                    error: afterSendError.message
                })
            }
        }
        results.push({ descriptor, renderStatus: renderResult.renderStatus, status })
    }

    const successCount = results.filter((item) => item.status !== 'failed').length
    const failureCount = results.length - successCount
    logger.logEvent('info', 'LINK', context.traceContext?.scope || '', 'pipeline-finished', { successCount, failureCount })

    return {
        foundCount: descriptors.length,
        skippedCachedCount: descriptors.length - active.length,
        successCount,
        failureCount,
        allCached: false,
        results
    }
}

module.exports = {
    processLinks
}
```

Run:
```bash
npx mocha "test/unit/linkPipeline.test.js"
```

Expected: PASS，包括 `sent_card`、`sent_fallback_text`、`failed` 三态断言

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/link/linkPipeline.js src/services/link/linkRegistry.js src/services/link/linkTypes/user.js src/services/link/linkTypes/favoriteList.js src/services/link/linkTypes/audio.js src/services/link/linkTypes/audioList.js src/services/link/linkTypes/topic.js src/services/link/linkTypes/channelSeries.js src/services/link/linkTypes/articleList.js src/services/link/linkTypes/note.js src/services/link/linkTypes/cheeseVideo.js test/unit/linkPipeline.test.js
git commit -F - <<'EOF'
refactor: 实现链接处理 pipeline 与剩余类型处理器

- 新增 linkPipeline 并统一汇总 renderStatus 与最终发送状态
- 迁移 user、favorite_list、audio、topic、channel_series、note、cheese_video 等剩余类型
- 固定 sent_card、sent_fallback_text、failed 三态与缓存语义
EOF
```

## Task 5: 接入 messageHandler 高层入口并收敛 facade

**Files:**
- Modify: `src/services/link/index.js`
- Modify: `src/handlers/messageHandler.js`
- Modify: `src/handlers/linkHandler.js`
- Modify: `test/unit/messageHandler-linkReaction.test.js`
- Modify: `test/unit/link-handler-logging.test.js`

- [ ] **Step 1: 写失败测试，固定 messageHandler 只消费高层入口结果**

```js
// test/unit/messageHandler-linkReaction.test.js
it('link 服务返回 sent_fallback_text 时仍发送 OK 表情', async function () {
    linkServices.handleIncomingMessageLinks = async () => ({
        foundCount: 1,
        skippedCachedCount: 0,
        successCount: 1,
        failureCount: 0,
        allCached: false,
        results: [{ status: 'sent_fallback_text', renderStatus: 'fallback_text_ready' }]
    })

    await handler.handleMessage(ws, messageData)
    assert.ok(emojiCalls.some((call) => call.emojiId === LINK_EMOJI.OK))
})
```

- [ ] **Step 2: 跑测试确认 messageHandler 仍旧直接依赖旧链路**

Run:
```bash
npx mocha "test/unit/messageHandler-linkReaction.test.js" "test/unit/link-handler-logging.test.js"
```

Expected: FAIL，断言仍然走旧 `processSingleLink()` 分支或日志不匹配

- [ ] **Step 3: 保持现有消息处理时序，拆成 prepare 阶段和 process 阶段接入**

约束：
- JSON 小程序补链与短链展开必须仍发生在向量记忆与命令分发之前
- 真正的链接处理仍发生在命令分发之后
- `messageHandler` 不能因为接入高层入口而改变当前 `rawMessage` 的生成时序

```js
// src/services/link/index.js
const { normalizeIncomingMessage } = require('./messageLinkNormalizer')
const { expandShortUrlInMessage } = require('./shortLinkExpander')
const { extractLinksFromMessage } = require('./linkExtractor')
const { processLinks } = require('./linkPipeline')

async function prepareIncomingMessageLinks({ rawMessage, messageSegments, traceContext }) {
    const normalized = normalizeIncomingMessage({ rawMessage, messageSegments, traceContext })
    const expanded = await expandShortUrlInMessage(normalized.rawMessage, traceContext)
    const sanitized = expanded.replace(/\[CQ:[^\]]+\]/g, '')
    const descriptors = extractLinksFromMessage(sanitized, null, traceContext)

    return {
        normalizedRawMessage: expanded,
        sanitizedMessage: sanitized,
        descriptors
    }
}

async function handleIncomingMessageLinks({ ws, groupId, userId, descriptors, traceContext }) {
    return processLinks(descriptors.map((descriptor) => ({
        ...descriptor,
        cacheKey: descriptor.cacheKey || `${descriptor.type}|${descriptor.id}|${groupId}`
    })), { ws, groupId, userId, traceContext })
}

module.exports = {
    prepareIncomingMessageLinks,
    handleIncomingMessageLinks
}
```

```js
// src/handlers/messageHandler.js
const linkServices = require('../services/link')

const preparedLinks = await linkServices.prepareIncomingMessageLinks({
    rawMessage,
    messageSegments,
    traceContext
})
rawMessage = preparedLinks.normalizedRawMessage

// 保持现有时序：更新后的 rawMessage 继续参与向量记忆和命令分发

if (await commandManager.dispatch(commandContext)) {
    return
}

const links = preparedLinks.descriptors
    .map((descriptor) => ({
        ...descriptor,
        cacheKey: descriptor.cacheKey || `${descriptor.type}|${descriptor.id}|${groupId}`
    }))

if (links.length > 0) {
    const uncachedLinks = links.filter((link) => !linkHandler.isLinkCached(link.cacheKey))
    if (uncachedLinks.length === 0) {
        this.sendEmojiReaction(ws, messageId, LINK_EMOJI.SHUSH)
        return
    }

    this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING)
    const linkResult = await linkServices.handleIncomingMessageLinks({
        ws,
        groupId,
        userId,
        descriptors: uncachedLinks,
        traceContext
    })
    this.sendEmojiReaction(ws, messageId, LINK_EMOJI.THINKING, false)

    if (linkResult.failureCount > 0) {
        this.sendEmojiReaction(ws, messageId, LINK_EMOJI.CRYING)
    } else {
        this.sendEmojiReaction(ws, messageId, LINK_EMOJI.OK)
    }
    return
}
```

- [ ] **Step 4: 让 linkHandler 只保留迁移期 facade，并更新 logging test**

```js
// src/handlers/linkHandler.js
const linkServices = require('../services/link')
const linkCacheService = require('../services/link/linkCacheService')

module.exports = {
    shortLinkRegex: require('../services/link/shortLinkExpander').shortLinkRegex,
    extractLinks: linkServices.extractLinksFromMessage,
    expandUrl: require('../services/link/shortLinkExpander').expandShortUrl,
    isLinkCached: linkCacheService.isCached,
    addLinkToCache: linkCacheService.markProcessed,
    addUrlToCache: linkServices.cacheResolvedText,
    processSingleLink: async function (descriptor, ws, groupId, userId, traceContext) {
        const result = await require('../services/link/linkPipeline').processLinks([descriptor], { ws, groupId, userId, traceContext })
        if (result.failureCount > 0) throw result.results[0].error
        return result.results[0]
    }
}
```

Run:
```bash
npx mocha "test/unit/messageHandler-linkReaction.test.js" "test/unit/link-handler-logging.test.js"
```

Expected: PASS；`sent_fallback_text` 仍触发 `OK`，logging test 继续看到 `extract/fetch-start/card-ready/fallback-text` 摘要日志

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/link/index.js src/handlers/messageHandler.js src/handlers/linkHandler.js test/unit/messageHandler-linkReaction.test.js test/unit/link-handler-logging.test.js
git commit -F - <<'EOF'
refactor: 通过 link 域入口接管消息链路

- 调整 messageHandler 先完成消息规范化，再在原链接阶段进入处理入口
- 保持 JSON 小程序与短链展开仍发生在向量记忆和命令分发之前
- 保持 THINKING、OK、CRYING、SHUSH 的现有触发时序
EOF
```

## Task 6: 迁移 Preview Lab、补回归测试并完成验证

**Files:**
- Modify: `src/services/previewLab/inputResolver.js`
- Modify: `test/unit/linkHandler-extractLinks.test.js`
- Modify: `test/unit/linkHandler-new-types.test.js`
- Modify: `test/unit/link-index-cache-api.test.js`
- Modify: `test/unit/linkPipeline.test.js`
- Test: `npm test`

- [ ] **Step 1: 写失败测试，固定 Preview Lab 走新低层接口但不依赖 facade 内部实现**

```js
// src/services/previewLab/inputResolver.js 对应测试片段
it('Preview Lab 通过 link services 解析输入', async function () {
    const result = await resolvePreviewInput('https://b23.tv/mock', { groupId: '1000' }, {
        linkServices: {
            expandShortLinks: async () => 'https://www.bilibili.com/video/BV1ZHiyBkExG',
            extractLinksFromMessage: () => [{ type: 'video', id: 'BV1ZHiyBkExG', cacheKey: 'video|BV1ZHiyBkExG|1000', match: 'https://www.bilibili.com/video/BV1ZHiyBkExG', meta: {}, sourceToken: 'https://www.bilibili.com/video/BV1ZHiyBkExG' }]
        }
    })

    assert.strictEqual(result.resolvedLink.type, 'video')
})
```

- [ ] **Step 2: 跑针对性测试，确认 Preview Lab 和缓存调用点仍有旧依赖**

Run:
```bash
npx mocha "test/unit/link-index-cache-api.test.js" "test/unit/linkPipeline.test.js" "test/unit/linkHandler-new-types.test.js"
```

Expected: FAIL，如果 `inputResolver` 仍只接 `linkHandler` 或缓存入口仍走错边界

- [ ] **Step 3: 迁移 Preview Lab 到新低层接口，并清理多余 facade 依赖**

```js
// src/services/previewLab/inputResolver.js
const linkServices = require('../link')

async function expandPreviewInput(input, deps = {}) {
    const services = deps.linkServices || linkServices
    let rawInput = String(input || '').trim()
    if (!rawInput) return rawInput
    const expanded = await services.expandShortLinks(rawInput)
    return String(expanded || rawInput).replace(/\[CQ:[^\]]+\]/g, '')
}

async function resolvePreviewInput(input, options = {}, deps = {}) {
    const services = deps.linkServices || linkServices
    const normalizedInput = await expandPreviewInput(input, deps)
    const links = services.extractLinksFromMessage(normalizedInput, options.groupId || null)
    if (!Array.isArray(links) || links.length === 0) {
        throw new Error('未识别到可处理的 B 站链接')
    }
    return {
        input: String(input || ''),
        normalizedInput,
        resolvedLink: links[0],
        skippedLinks: links.slice(1)
    }
}
```

- [ ] **Step 4: 跑完整回归验证**

Run:
```bash
npm test && node test/unit/linkHandler-extractLinks.test.js && npx mocha "test/unit/messageLinkNormalizer.test.js" "test/unit/linkExtractor-service.test.js" "test/unit/linkCacheService.test.js" "test/unit/link-index-cache-api.test.js" "test/unit/linkPipeline.test.js" "test/unit/link-handler-logging.test.js" "test/unit/messageHandler-linkReaction.test.js"
```

Expected: 全部 PASS；没有新增 `LinkHandler` 旧实现耦合导致的失败

- [ ] **Step 5: 如需提交，先征求用户批准后再创建 commit**

```bash
git add src/services/previewLab/inputResolver.js test/unit/linkHandler-extractLinks.test.js test/unit/linkHandler-new-types.test.js test/unit/link-index-cache-api.test.js test/unit/linkPipeline.test.js test/unit/link-handler-logging.test.js test/unit/messageHandler-linkReaction.test.js
git commit -F - <<'EOF'
refactor: 迁移 preview 输入解析并完成 link 域落地

- 将 Preview Lab 切到 link services 低层接口
- 清理多余 facade 依赖并补齐回归测试
- 完成 link domain rollout 前的最小验证闭环
EOF
```

## Spec Coverage Check
- JSON 小程序补链：Task 1、Task 5
- 高层入口 `handleIncomingMessageLinks(...)`：Task 5
- render 三态与最终发送三态：Task 3、Task 4、Task 5
- `afterSend` 类型副作用：Task 3、Task 4
- cache service 不直接接文本：Task 2
- `notify.js` 迁移到上层 convenience API：Task 2
- `Preview Lab` 迁移：Task 6
- `processSingleLink` 仅兼容期保留：Task 5

## Self-Review Notes
- 没有使用 `TBD`、`TODO`、`类似 Task N` 之类占位语句
- plan 中所有新名字与设计稿保持一致：`messageLinkNormalizer`、`handleIncomingMessageLinks`、`markProcessedDescriptor`、`card_ready`、`sent_fallback_text`
- 所有 spec 里提到的关键边界：入口契约、结果状态、registry 扩展点、缓存边界、兼容 facade，均有对应任务覆盖
