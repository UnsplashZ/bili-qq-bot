'use strict'

const assert = require('assert')

const linkRegistry = require('../../src/services/link/linkRegistry')
const linkFetchService = require('../../src/services/link/linkFetchService')
const linkRenderService = require('../../src/services/link/linkRenderService')
const linkSender = require('../../src/services/link/linkSender')
const videoHandler = require('../../src/services/link/linkTypes/video')
const cacheManager = require('../../src/utils/cacheManager')
const imageGenerator = require('../../src/services/imageGenerator')
const notificationService = require('../../src/services/notificationService')
const videoDownloadService = require('../../src/services/videoDownloadService')

const originals = {
    cacheGet: cacheManager.get,
    cacheSet: cacheManager.set,
    generatePreviewCard: imageGenerator.generatePreviewCard,
    sendGroupMessage: notificationService.sendGroupMessage,
    sendPrivateMessage: notificationService.sendPrivateMessage,
    downloadAndSend: videoDownloadService.downloadAndSend
}

describe('link service infrastructure contracts', function () {
    afterEach(function () {
        cacheManager.get = originals.cacheGet
        cacheManager.set = originals.cacheSet
        imageGenerator.generatePreviewCard = originals.generatePreviewCard
        notificationService.sendGroupMessage = originals.sendGroupMessage
        notificationService.sendPrivateMessage = originals.sendPrivateMessage
        videoDownloadService.downloadAndSend = originals.downloadAndSend
    })

    it('registers and returns the core eight link handlers', function () {
        const expectedTypes = [
            'video',
            'bangumi',
            'dynamic',
            'article',
            'live',
            'opus',
            'ep',
            'media'
        ]

        for (const type of expectedTypes) {
            const handler = linkRegistry.getHandler(type)
            assert.ok(handler, `expected handler for ${type}`)
            assert.strictEqual(handler.type, type)
            assert.strictEqual(typeof handler.fetch, 'function')
            assert.strictEqual(typeof handler.buildUrl, 'function')
            assert.strictEqual(typeof handler.resolveCardType, 'function')
        }

        assert.strictEqual(linkRegistry.getHandler('unknown_type'), null)
    })

    it('returns cached fetch results without calling handler.fetch', async function () {
        const cachedInfo = { status: 'success', data: { title: 'cached video' } }
        const hits = []
        let fetchCalled = false
        let setCalled = false

        cacheManager.get = async (key) => {
            assert.strictEqual(key, 'video_BV1cache')
            return cachedInfo
        }
        cacheManager.set = async () => {
            setCalled = true
        }

        const handler = {
            type: 'video',
            async fetch() {
                fetchCalled = true
                return { status: 'success' }
            }
        }

        const result = await linkFetchService.fetch(handler, '10001', { id: 'BV1cache' }, {
            onCacheHit(cacheKey) {
                hits.push(cacheKey)
            }
        })

        assert.deepStrictEqual(result, {
            info: cachedInfo,
            cacheKey: 'video_BV1cache',
            fromCache: true
        })
        assert.strictEqual(fetchCalled, false)
        assert.strictEqual(setCalled, false)
        assert.deepStrictEqual(hits, ['video_BV1cache'])
    })

    it('fetches and stores successful results on cache miss', async function () {
        const fetchedInfo = { status: 'success', data: { title: 'fresh video' } }
        const setCalls = []

        cacheManager.get = async (key) => {
            assert.strictEqual(key, 'video_BV1fresh')
            return null
        }
        cacheManager.set = async (key, value) => {
            setCalls.push([key, value])
        }

        const handler = {
            type: 'video',
            async fetch(groupId, descriptor) {
                assert.strictEqual(groupId, '10001')
                assert.deepStrictEqual(descriptor, { id: 'BV1fresh' })
                return fetchedInfo
            }
        }

        const result = await linkFetchService.fetch(handler, '10001', { id: 'BV1fresh' })

        assert.deepStrictEqual(result, {
            info: fetchedInfo,
            cacheKey: 'video_BV1fresh',
            fromCache: false
        })
        assert.deepStrictEqual(setCalls, [['video_BV1fresh', fetchedInfo]])
    })

    it('prepares card, fallback text, and render failure states', async function () {
        const handler = {
            buildUrl(descriptor) {
                return `https://www.bilibili.com/video/${descriptor.id}`
            },
            resolveCardType() {
                return 'video'
            }
        }

        imageGenerator.generatePreviewCard = async (info, cardType, groupId) => {
            assert.deepStrictEqual(info, { title: 'demo' })
            assert.strictEqual(cardType, 'video')
            assert.strictEqual(groupId, '10001')
            return 'ZmFrZQ=='
        }

        const ready = await linkRenderService.prepare(handler, { title: 'demo' }, { id: 'BV1ready' }, '10001')
        assert.deepStrictEqual(ready, {
            status: 'card_ready',
            url: 'https://www.bilibili.com/video/BV1ready',
            cardType: 'video',
            base64Image: 'ZmFrZQ=='
        })

        imageGenerator.generatePreviewCard = async () => {
            throw new Error('render failed')
        }

        const fallback = await linkRenderService.prepare(handler, { title: 'demo' }, { id: 'BV1fallback' }, '10001')
        assert.strictEqual(fallback.status, 'fallback_text_ready')
        assert.strictEqual(fallback.url, 'https://www.bilibili.com/video/BV1fallback')
        assert.strictEqual(fallback.cardType, 'video')
        assert.strictEqual(fallback.reason, 'preview_generation_failed')
        assert.strictEqual(fallback.error, 'render failed')
        assert.strictEqual(fallback.text, '预览生成失败，已降级为文本链接：\nhttps://www.bilibili.com/video/BV1fallback')

        const failed = await linkRenderService.prepare({
            buildUrl() {
                return null
            },
            resolveCardType() {
                return 'video'
            }
        }, { title: 'demo' }, { id: 'BV1failed' }, '10001')

        assert.deepStrictEqual(failed, {
            status: 'render_failed',
            url: null,
            cardType: 'video'
        })
    })

    it('routes prepared sends to group or private messaging semantics', async function () {
        const groupCalls = []
        const privateCalls = []

        notificationService.sendGroupMessage = async (...args) => {
            groupCalls.push(args)
        }
        notificationService.sendPrivateMessage = async (...args) => {
            privateCalls.push(args)
        }

        await linkSender.sendPrepared({}, '10001', {
            status: 'fallback_text_ready',
            url: 'https://www.bilibili.com/video/BV1group',
            text: 'group fallback text'
        }, '20002')

        await linkSender.sendPrepared({}, 'private_30003', {
            status: 'card_ready',
            url: 'https://www.bilibili.com/video/BV1private',
            base64Image: 'ZmFrZQ=='
        }, '20002')

        assert.strictEqual(groupCalls.length, 1)
        assert.deepStrictEqual(groupCalls[0], [
            {},
            '10001',
            [{
                type: 'text',
                data: { text: 'group fallback text' }
            }],
            'LinkHandler',
            true
        ])

        assert.strictEqual(privateCalls.length, 1)
        assert.deepStrictEqual(privateCalls[0], [
            {},
            '30003',
            [
                { type: 'image', data: { file: 'base64://ZmFrZQ==' } },
                { type: 'text', data: { text: 'https://www.bilibili.com/video/BV1private' } }
            ],
            'LinkHandler',
            true
        ])
    })

    it('keeps video afterSend download side effect active', async function () {
        const calls = []
        videoDownloadService.downloadAndSend = async (...args) => {
            calls.push(args)
        }

        const ws = { name: 'socket' }
        const info = { title: 'video title' }
        const descriptor = { id: 'BV1download' }

        await videoHandler.afterSend({
            ws,
            groupId: '10001',
            descriptor,
            info
        })

        assert.deepStrictEqual(calls, [[ws, '10001', 'BV1download', info]])
    })
})
