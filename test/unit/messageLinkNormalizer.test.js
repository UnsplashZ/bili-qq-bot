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

    it('兼容更多 json 小程序 url 字段', function () {
        const cases = [
            [
                'meta.news.jumpUrl',
                {
                    meta: {
                        news: {
                            jumpUrl: 'https://www.bilibili.com/video/BV1ZHiyBkExG'
                        }
                    }
                },
                'https://www.bilibili.com/video/BV1ZHiyBkExG'
            ],
            [
                'meta.detail_1.url',
                {
                    meta: {
                        detail_1: {
                            url: 'https://www.bilibili.com/read/cv17878862'
                        }
                    }
                },
                'https://www.bilibili.com/read/cv17878862'
            ],
            [
                'meta.detail.url',
                {
                    meta: {
                        detail: {
                            url: 'https://www.bilibili.com/live/123456'
                        }
                    }
                },
                'https://www.bilibili.com/live/123456'
            ],
            [
                'meta.detail.qqdocurl',
                {
                    meta: {
                        detail: {
                            qqdocurl: 'https://www.bilibili.com/video/BV1ZHiyBkExG'
                        }
                    }
                },
                'https://www.bilibili.com/video/BV1ZHiyBkExG'
            ],
            [
                'top-level url',
                {
                    url: 'https://www.bilibili.com/opus/1234567890123456789'
                },
                'https://www.bilibili.com/opus/1234567890123456789'
            ],
            [
                'prompt',
                {
                    prompt: 'https://www.bilibili.com/opus/1234567890123456789'
                },
                'https://www.bilibili.com/opus/1234567890123456789'
            ],
            [
                'meta.detail_1.preview',
                {
                    meta: {
                        detail_1: {
                            preview: 'https://live.bilibili.com/123456'
                        }
                    }
                },
                'https://live.bilibili.com/123456'
            ]
        ]

        for (const [name, jsonData, expectedUrl] of cases) {
            const result = normalizeIncomingMessage({
                rawMessage: '[CQ:json,data=mock]',
                messageSegments: [{
                    type: 'json',
                    data: {
                        data: JSON.stringify(jsonData)
                    }
                }],
                traceContext: { scope: `msg:1000:2:${name}` }
            })

            assert.ok(result.rawMessage.includes(expectedUrl))
        }
    })

    it('json 消息没有 url 时保留原始消息', function () {
        const result = normalizeIncomingMessage({
            rawMessage: '[CQ:json,data=mock]',
            messageSegments: [{
                type: 'json',
                data: {
                    data: JSON.stringify({
                        meta: {
                            detail_1: {
                                title: 'no url here'
                            }
                        }
                    })
                }
            }],
            traceContext: { scope: 'msg:1000:2:556' }
        })

        assert.strictEqual(result.rawMessage, '[CQ:json,data=mock]')
    })

    it('json 解析失败时保留原始消息', function () {
        const result = normalizeIncomingMessage({
            rawMessage: '[CQ:json,data=broken]',
            messageSegments: [{
                type: 'json',
                data: {
                    data: '{invalid-json'
                }
            }],
            traceContext: { scope: 'msg:1000:2:557' }
        })

        assert.strictEqual(result.rawMessage, '[CQ:json,data=broken]')
    })

    it('没有 json segment 时透传 rawMessage', function () {
        const result = normalizeIncomingMessage({
            rawMessage: 'plain text message',
            messageSegments: [{
                type: 'text',
                data: { text: 'plain text message' }
            }],
            traceContext: { scope: 'msg:1000:2:558' }
        })

        assert.strictEqual(result.rawMessage, 'plain text message')
    })
})
