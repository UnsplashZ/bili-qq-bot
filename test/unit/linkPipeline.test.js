'use strict'

const assert = require('assert')

const linkPipeline = require('../../src/services/link/linkPipeline')
const linkDomain = require('../../src/services/link')

describe('linkPipeline', function () {
    beforeEach(function () {
        linkDomain.__resetCacheForTests()
    })

    it('marks fallback sends as sent_fallback_text and writes cache', async function () {
        const sends = []
        const result = await linkPipeline.processLinkDescriptors([{
            type: 'video',
            id: 'BV1fallback',
            cacheKey: 'video|BV1fallback|10001'
        }], {
            ws: {},
            groupId: '10001',
            userId: '20002'
        }, {
            getHandler() {
                return {
                    type: 'video',
                    buildUrl(descriptor) {
                        return `https://www.bilibili.com/video/${descriptor.id}`
                    }
                }
            },
            fetchLinkInfo: async () => ({
                info: { status: 'success', data: { title: 'demo' } },
                cacheKey: 'video_BV1fallback',
                fromCache: false
            }),
            prepareLinkRender: async () => ({
                status: 'fallback_text_ready',
                url: 'https://www.bilibili.com/video/BV1fallback',
                cardType: 'video',
                text: 'preview failed fallback text'
            }),
            sendPreparedLink: async (ws, groupId, prepared, userId) => {
                sends.push({ ws, groupId, prepared, userId })
            }
        })

        assert.strictEqual(result.successCount, 1)
        assert.strictEqual(result.failureCount, 0)
        assert.strictEqual(result.results[0].status, 'sent_fallback_text')
        assert.strictEqual(result.results[0].renderStatus, 'fallback_text_ready')
        assert.strictEqual(linkDomain.isCached('video|BV1fallback|10001'), true)
        assert.strictEqual(sends.length, 1)
    })

    it('does not write cache for failed results', async function () {
        const result = await linkPipeline.processLinkDescriptors([{
            type: 'video',
            id: 'BV1failed',
            cacheKey: 'video|BV1failed|10001'
        }], {
            ws: {},
            groupId: '10001'
        }, {
            getHandler() {
                return {
                    type: 'video',
                    buildUrl() {
                        return null
                    }
                }
            },
            fetchLinkInfo: async () => ({
                info: { status: 'success', data: { title: 'demo' } },
                cacheKey: 'video_BV1failed',
                fromCache: false
            }),
            prepareLinkRender: async () => ({
                status: 'render_failed',
                url: null,
                cardType: 'video'
            })
        })

        assert.strictEqual(result.successCount, 0)
        assert.strictEqual(result.failureCount, 1)
        assert.strictEqual(result.results[0].status, 'failed')
        assert.strictEqual(linkDomain.isCached('video|BV1failed|10001'), false)
    })

    it('reports allCached when every unique descriptor is already cached', async function () {
        linkDomain.markProcessed('video|BV1cached|10001')
        linkDomain.markProcessed('audio|123|10001')

        const result = await linkPipeline.processLinkDescriptors([{
            type: 'video',
            id: 'BV1cached',
            cacheKey: 'video|BV1cached|10001'
        }, {
            type: 'audio',
            id: '123',
            cacheKey: 'audio|123|10001'
        }], {
            groupId: '10001'
        })

        assert.strictEqual(result.allCached, true)
        assert.strictEqual(result.skippedCachedCount, 2)
        assert.strictEqual(result.successCount, 0)
        assert.strictEqual(result.failureCount, 0)
        assert.deepStrictEqual(result.results.map(item => item.status), ['cached', 'cached'])
    })

    it('deduplicates descriptors by cacheKey before processing fetch failures', async function () {
        let fetchCount = 0

        const result = await linkPipeline.processLinkDescriptors([{
            type: 'video',
            id: 'BV1dup',
            cacheKey: 'video|BV1dup|10001'
        }, {
            type: 'video',
            id: 'BV1dup',
            cacheKey: 'video|BV1dup|10001'
        }], {
            ws: {},
            groupId: '10001'
        }, {
            getHandler() {
                return {
                    type: 'video',
                    buildUrl(descriptor) {
                        return `https://www.bilibili.com/video/${descriptor.id}`
                    }
                }
            },
            fetchLinkInfo: async () => {
                fetchCount += 1
                return {
                    info: { status: 'error', message: 'fetch failed' },
                    cacheKey: 'video_BV1dup',
                    fromCache: false
                }
            },
            sendGroupMessage: async () => {}
        })

        assert.strictEqual(fetchCount, 1)
        assert.strictEqual(result.foundCount, 2)
        assert.strictEqual(result.results.length, 1)
        assert.strictEqual(result.failureCount, 1)
        assert.strictEqual(result.results[0].status, 'failed')
        assert.strictEqual(result.results[0].reason, 'fetch_failed')
        assert.strictEqual(linkDomain.isCached('video|BV1dup|10001'), false)
    })

    it('prefers handler cache identity for dedupe and processed-cache hits', async function () {
        let fetchCount = 0

        linkDomain.markProcessed('channel_series|uid:42|series:84|10001')

        const result = await linkPipeline.processLinkDescriptors([{
            type: 'channel_series',
            id: '84',
            meta: {
                uid: '42'
            }
        }, {
            type: 'channel_series',
            id: 'different-id',
            meta: {
                uid: '42'
            }
        }], {
            groupId: '10001'
        }, {
            getHandler() {
                return {
                    type: 'channel_series',
                    getCacheIdentity(descriptor) {
                        return `uid:${descriptor.meta.uid}|series:84`
                    },
                    buildUrl() {
                        return 'https://space.bilibili.com/42/channel/seriesdetail?sid=84'
                    }
                }
            },
            fetchLinkInfo: async () => {
                fetchCount += 1
                return {
                    info: { status: 'success', data: { title: 'demo' } },
                    cacheKey: 'channel_series_uid:42|series:84',
                    fromCache: false
                }
            }
        })

        assert.strictEqual(fetchCount, 0)
        assert.strictEqual(result.foundCount, 2)
        assert.strictEqual(result.skippedCachedCount, 1)
        assert.strictEqual(result.results.length, 1)
        assert.strictEqual(result.results[0].status, 'cached')
        assert.strictEqual(result.results[0].cacheKey, 'channel_series|uid:42|series:84|10001')
    })

    it('keeps success when afterSend fails', async function () {
        const afterSendErrors = []

        const result = await linkPipeline.processLinkDescriptors([{
            type: 'video',
            id: 'BV1after',
            cacheKey: 'video|BV1after|10001'
        }], {
            ws: { socket: true },
            groupId: '10001'
        }, {
            getHandler() {
                return {
                    type: 'video',
                    buildUrl(descriptor) {
                        return `https://www.bilibili.com/video/${descriptor.id}`
                    },
                    async afterSend() {
                        throw new Error('after send failed')
                    }
                }
            },
            fetchLinkInfo: async () => ({
                info: { status: 'success', data: { title: 'demo' } },
                cacheKey: 'video_BV1after',
                fromCache: false
            }),
            prepareLinkRender: async () => ({
                status: 'card_ready',
                url: 'https://www.bilibili.com/video/BV1after',
                cardType: 'video',
                base64Image: 'ZmFrZQ=='
            }),
            sendPreparedLink: async () => {},
            onAfterSendError(context, error) {
                afterSendErrors.push({ context, error })
            }
        })

        assert.strictEqual(result.successCount, 1)
        assert.strictEqual(result.failureCount, 0)
        assert.strictEqual(result.results[0].status, 'sent_card')
        assert.strictEqual(afterSendErrors.length, 1)
        assert.strictEqual(linkDomain.isCached('video|BV1after|10001'), true)
    })
})
