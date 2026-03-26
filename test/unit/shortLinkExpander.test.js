'use strict'

const assert = require('assert')
const https = require('https')
const { expandShortUrl } = require('../../src/services/link/shortLinkExpander')

describe('shortLinkExpander', function () {
    it('非 3xx 时返回原 URL', async function () {
        const originalRequest = https.request
        let requestOptions = null

        https.request = (url, options, callback) => {
            requestOptions = { url, options }
            const req = {
                on() {
                    return req
                },
                end() {
                    callback({ statusCode: 200, headers: {} })
                },
                destroy() {}
            }
            return req
        }

        try {
            const result = await expandShortUrl('b23.tv/abc123')
            assert.strictEqual(result, 'https://b23.tv/abc123')
            assert.strictEqual(requestOptions.url, 'https://b23.tv/abc123')
            assert.strictEqual(requestOptions.options.method, 'HEAD')
        } finally {
            https.request = originalRequest
        }
    })

    it('3xx 且带 Location 时返回展开后的 URL', async function () {
        const originalRequest = https.request
        let requestOptions = null

        https.request = (url, options, callback) => {
            requestOptions = { url, options }
            const req = {
                on() {
                    return req
                },
                end() {
                    callback({ statusCode: 302, headers: { location: 'https://www.bilibili.com/video/BV1ZHiyBkExG' } })
                },
                destroy() {}
            }
            return req
        }

        try {
            const result = await expandShortUrl('b23.tv/abc123')
            assert.strictEqual(result, 'https://www.bilibili.com/video/BV1ZHiyBkExG')
            assert.strictEqual(requestOptions.url, 'https://b23.tv/abc123')
            assert.strictEqual(requestOptions.options.method, 'HEAD')
        } finally {
            https.request = originalRequest
        }
    })

    it('请求超时时返回原 URL 且不抛错', async function () {
        const originalRequest = https.request
        let timeoutHandler = null

        https.request = (url, options) => {
            const req = {
                on(event, handler) {
                    if (event === 'timeout') {
                        timeoutHandler = handler
                    }
                    return req
                },
                end() {
                    process.nextTick(() => timeoutHandler())
                },
                destroy() {}
            }
            return req
        }

        try {
            await assert.doesNotReject(async () => {
                const result = await expandShortUrl('https://b23.tv/abc123')
                assert.strictEqual(result, 'https://b23.tv/abc123')
            })
        } finally {
            https.request = originalRequest
        }
    })

    it('请求错误时返回原 URL 且不抛错', async function () {
        const originalRequest = https.request
        let errorHandler = null

        https.request = (url, options) => {
            const req = {
                on(event, handler) {
                    if (event === 'error') {
                        errorHandler = handler
                    }
                    return req
                },
                end() {
                    process.nextTick(() => errorHandler(new Error('network fail')))
                },
                destroy() {}
            }
            return req
        }

        try {
            await assert.doesNotReject(async () => {
                const result = await expandShortUrl('https://b23.tv/abc123')
                assert.strictEqual(result, 'https://b23.tv/abc123')
            })
        } finally {
            https.request = originalRequest
        }
    })
})
