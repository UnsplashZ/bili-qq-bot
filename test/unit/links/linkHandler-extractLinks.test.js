#!/usr/bin/env node
/**
 * test/unit/links/linkHandler-extractLinks.test.js
 *
 * 测试 LinkHandler.extractLinks() 的动态链接识别
 *
 * 运行: npx mocha --exit test/unit/links/linkHandler-extractLinks.test.js
 */

'use strict'

const assert = require('assert')

const linkDomainPath = require.resolve('../../../src/services/link')
const linkHandlerPath = require.resolve('../../../src/handlers/linkHandler')

function loadLinkHandlerWithMocks({ linkDomainExports } = {}) {
    delete require.cache[linkHandlerPath]

    if (linkDomainExports) {
        require.cache[linkDomainPath] = {
            id: linkDomainPath,
            filename: linkDomainPath,
            loaded: true,
            exports: linkDomainExports
        }
    } else {
        delete require.cache[linkDomainPath]
    }

    return require('../../../src/handlers/linkHandler')
}

describe('LinkHandler facade delegation', function () {
    const originalLinkDomainModule = require.cache[linkDomainPath]

    afterEach(function () {
        delete require.cache[linkHandlerPath]
        if (originalLinkDomainModule) {
            require.cache[linkDomainPath] = originalLinkDomainModule
        } else {
            delete require.cache[linkDomainPath]
        }
    })

    it('extractLinks/isLinkCached/addLinkToCache/cleanupExpiredCache 应委托给 link 服务 facade', function () {
        const calls = []
        const fakeLinks = [{ type: 'dynamic', id: '123456789' }]
        const handler = loadLinkHandlerWithMocks({
            linkDomainExports: {
                extractLinksFromMessage(rawMessage, groupId, traceContext) {
                    calls.push(['extractLinksFromMessage', rawMessage, groupId, traceContext])
                    return fakeLinks
                },
                cacheResolvedText() {
                    throw new Error('not used in this test')
                },
                isCached(cacheKey) {
                    calls.push(['isCached', cacheKey])
                    return cacheKey === 'video|BV1|10001'
                },
                markProcessed(cacheKey) {
                    calls.push(['markProcessed', cacheKey])
                    return `${cacheKey}:marked`
                },
                cleanupExpired() {
                    calls.push(['cleanupExpired'])
                    return 3
                }
            }
        })

        const traceContext = { scope: 'test-scope' }
        assert.deepStrictEqual(handler.extractLinks('https://t.bilibili.com/123456789', '10001', traceContext), fakeLinks)
        assert.strictEqual(handler.isLinkCached('video|BV1|10001'), true)
        assert.strictEqual(handler.addLinkToCache('video|BV1|10001'), 'video|BV1|10001:marked')
        assert.strictEqual(handler.cleanupExpiredCache(), 3)

        assert.deepStrictEqual(calls, [
            ['extractLinksFromMessage', 'https://t.bilibili.com/123456789', '10001', traceContext],
            ['isCached', 'video|BV1|10001'],
            ['markProcessed', 'video|BV1|10001'],
            ['cleanupExpired']
        ])
    })

    it('expandUrl 应委托给 link service facade', async function () {
        const calls = []
        const handler = loadLinkHandlerWithMocks({
            linkDomainExports: {
                shortLinkRegex: /https?:\/\/b23\.tv\/[a-zA-Z0-9]+/,
                expandShortUrl(shortUrl) {
                    calls.push(shortUrl)
                    return Promise.resolve('https://www.bilibili.com/video/BV1xx411c7mD')
                },
                extractLinksFromMessage() {
                    return []
                },
                cacheResolvedText() {
                    return { addedCount: 0, cacheKeys: [] }
                },
                isCached() {
                    return false
                },
                markProcessed(cacheKey) {
                    return cacheKey
                },
                cleanupExpired() {
                    return 0
                }
            }
        })

        const result = await handler.expandUrl('https://b23.tv/abc123')
        assert.strictEqual(result, 'https://www.bilibili.com/video/BV1xx411c7mD')
        assert.deepStrictEqual(calls, ['https://b23.tv/abc123'])
    })
})
