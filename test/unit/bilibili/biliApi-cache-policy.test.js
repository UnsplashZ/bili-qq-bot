'use strict'

const assert = require('assert')

const biliApi = require('../../../src/services/biliApi')
const cacheManager = require('../../../src/utils/cacheManager')
const serviceManager = require('../../../src/services/ServiceManager')

describe('biliApi cache policy', function () {
    const originals = {
        cacheGet: cacheManager.get,
        cacheSet: cacheManager.set,
        sendCommand: serviceManager.sendCommand,
        start: serviceManager.start,
        process: serviceManager.process,
        lastRequestTime: serviceManager.lastRequestTime
    }

    afterEach(function () {
        cacheManager.get = originals.cacheGet
        cacheManager.set = originals.cacheSet
        serviceManager.sendCommand = originals.sendCommand
        serviceManager.start = originals.start
        serviceManager.process = originals.process
        serviceManager.lastRequestTime = originals.lastRequestTime
    })

    it('cached 策略允许直接命中缓存', async function () {
        let sendCalls = 0

        cacheManager.get = async () => ({
            status: 'success',
            data: { name: 'cached-user' }
        })
        cacheManager.set = async () => {
            throw new Error('should not write cache when cache hit')
        }
        serviceManager.sendCommand = async () => {
            sendCalls += 1
            return { status: 'success', data: { name: 'fresh-user' } }
        }

        const result = await biliApi.getUserInfo('123', '1000', 'cached')
        assert.deepStrictEqual(result, {
            status: 'success',
            data: { name: 'cached-user' }
        })
        assert.strictEqual(sendCalls, 0)
    })

    it('fresh 策略应绕过缓存读取并在成功后回写缓存', async function () {
        let cacheGetCalls = 0
        let sendCalls = 0
        let cacheSetPayload = null

        cacheManager.get = async () => {
            cacheGetCalls += 1
            return {
                status: 'success',
                data: { name: 'stale-user' }
            }
        }
        cacheManager.set = async (_key, data) => {
            cacheSetPayload = data
        }
        serviceManager.sendCommand = async () => {
            sendCalls += 1
            return {
                status: 'success',
                data: { name: 'fresh-user' }
            }
        }

        const result = await biliApi.getUserInfo('123', '1000', 'fresh')
        assert.deepStrictEqual(result, {
            status: 'success',
            data: { name: 'fresh-user' }
        })
        assert.strictEqual(cacheGetCalls, 0)
        assert.strictEqual(sendCalls, 1)
        assert.deepStrictEqual(cacheSetPayload, {
            status: 'success',
            data: { name: 'fresh-user' }
        })
    })

    it('应透传 Python error envelope 并保留结构化字段', async function () {
        let cacheSetCalls = 0
        cacheManager.get = async () => null
        cacheManager.set = async () => {
            cacheSetCalls += 1
        }
        serviceManager.sendCommand = async () => {
            const error = new Error('Request failed with status code 401')
            error.response = {
                status: 401,
                data: {
                    status: 'error',
                    message: 'credential expired',
                    errorType: 'auth_failed',
                    failureKind: 'auth_failed',
                    retryable: false,
                    endpoint: 'user_info',
                    httpStatus: 401,
                    biliCode: -101,
                    exceptionClass: 'CredentialError',
                    code: 'BILI_AUTH'
                }
            }
            throw error
        }

        const result = await biliApi.getUserInfo('123', '1000', 'fresh')

        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.message, 'credential expired')
        assert.strictEqual(result.errorType, 'auth_failed')
        assert.strictEqual(result.failureKind, 'auth_failed')
        assert.strictEqual(result.retryable, false)
        assert.strictEqual(result.endpoint, 'user_info')
        assert.strictEqual(result.httpStatus, 401)
        assert.strictEqual(result.biliCode, -101)
        assert.strictEqual(result.exceptionClass, 'CredentialError')
        assert.strictEqual(result.code, 'BILI_AUTH')
        assert.strictEqual(cacheSetCalls, 0)
    })

    it('无响应网络异常应返回 transient_network envelope 且不写缓存', async function () {
        let cacheSetCalls = 0
        cacheManager.get = async () => null
        cacheManager.set = async () => {
            cacheSetCalls += 1
        }
        serviceManager.sendCommand = async () => {
            const error = new Error('socket hang up')
            error.code = 'ECONNRESET'
            throw error
        }

        const result = await biliApi.getVideoInfo('BV1xx', '1000')

        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.failureKind, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'video')
        assert.strictEqual(result.code, 'ECONNRESET')
        assert.strictEqual(cacheSetCalls, 0)
    })

    it('HTTP 200 但 body.status=error 的裸错误应补齐统一 envelope', async function () {
        let cacheSetCalls = 0
        cacheManager.get = async () => null
        cacheManager.set = async () => {
            cacheSetCalls += 1
        }
        serviceManager.sendCommand = async () => ({
            status: 'error',
            message: 'socket timeout'
        })

        const result = await biliApi.getVideoInfo('BV1xx', '1000')

        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.message, 'socket timeout')
        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.failureKind, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'video')
        assert.strictEqual(result.httpStatus, 200)
        assert.strictEqual(cacheSetCalls, 0)
    })

    it('structured unknown timeout 应允许 classifier 纠偏为 transient_network', async function () {
        cacheManager.get = async () => null
        cacheManager.set = async () => {
            throw new Error('should not write cache')
        }
        serviceManager.sendCommand = async () => {
            const error = new Error('Request failed with status code 200')
            error.responseData = {
                status: 'error',
                message: 'socket timeout',
                errorType: 'unknown',
                failureKind: 'unknown',
                retryable: false,
                endpoint: 'video',
                httpStatus: 200
            }
            throw error
        }

        const result = await biliApi.getVideoInfo('BV1xx', '1000')

        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.failureKind, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'video')
        assert.strictEqual(result.httpStatus, 200)
    })

    it('downloadVideo 应通过统一 RPC envelope 归一化超时错误', async function () {
        let call = null
        serviceManager.process = { pid: 1 }
        serviceManager.start = async () => {
            throw new Error('start should not be called')
        }
        serviceManager.sendCommand = async (endpoint, payload, options) => {
            call = { endpoint, payload, options }
            const error = new Error('socket timeout')
            error.code = 'ETIMEDOUT'
            throw error
        }

        const result = await biliApi.downloadVideo('BV1xx', 0, '720p', '1000', { title: 't' })

        assert.deepStrictEqual(call, {
            endpoint: 'video_download',
            payload: {
                bvid: 'BV1xx',
                page_index: 0,
                resolution: '720p',
                group_id: '1000',
                video_meta: { title: 't' }
            },
            options: { timeoutMs: 5 * 60 * 1000 }
        })
        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.failureKind, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'video_download')
        assert.strictEqual(result.code, 'ETIMEDOUT')
    })

    it('直接 sendCommand 接口也应返回结构化 error envelope', async function () {
        serviceManager.sendCommand = async () => {
            const error = new Error('Request failed with status code 400')
            error.responseData = {
                status: 'error',
                message: '缺少参数: keyword',
                errorType: 'unknown',
                failureKind: 'unknown',
                retryable: false,
                endpoint: 'user_search',
                httpStatus: 400,
                code: 'INVALID_REQUEST'
            }
            throw error
        }

        const result = await biliApi.searchUsers('', '1000')

        assert.strictEqual(result.status, 'error')
        assert.strictEqual(result.message, '缺少参数: keyword')
        assert.strictEqual(result.errorType, 'unknown')
        assert.strictEqual(result.failureKind, 'unknown')
        assert.strictEqual(result.retryable, false)
        assert.strictEqual(result.endpoint, 'user_search')
        assert.strictEqual(result.httpStatus, 400)
        assert.strictEqual(result.code, 'INVALID_REQUEST')
    })

    it('所有非缓存直连接口都应通过统一 _sendCommand envelope 包装', async function () {
        const cases = [
            ['getLoginUrl', () => biliApi.getLoginUrl(), 'login_url'],
            ['checkLogin', () => biliApi.checkLogin('qr-key', '1000'), 'login_check'],
            ['getUserLive', () => biliApi.getUserLive('42', '1000'), 'user_live'],
            ['getLiveRoomInfo', () => biliApi.getLiveRoomInfo('9000', '1000'), 'live_room'],
            ['getMyInfo', () => biliApi.getMyInfo('1000'), 'my_info'],
            ['getMyFollowings', () => biliApi.getMyFollowings(null, '1000'), 'my_followings'],
            ['getDynamicFeed', () => biliApi.getDynamicFeed(null, '1000'), 'dynamic_feed'],
            ['getLiveFeed', () => biliApi.getLiveFeed('1000'), 'live_feed'],
            ['getUserVideos', () => biliApi.getUserVideos('42', '1000'), 'user_videos'],
            ['getUserArticles', () => biliApi.getUserArticles('42', '1000'), 'user_articles'],
            ['refreshCredential', () => biliApi.refreshCredential(), 'refresh_credential']
        ]

        for (const [name, call, endpoint] of cases) {
            serviceManager.sendCommand = async () => {
                const error = new Error('socket timeout')
                error.code = 'ETIMEDOUT'
                throw error
            }

            const result = await call()

            assert.strictEqual(result.status, 'error', name)
            assert.strictEqual(result.errorType, 'transient_network', name)
            assert.strictEqual(result.failureKind, 'transient_network', name)
            assert.strictEqual(result.retryable, true, name)
            assert.strictEqual(result.endpoint, endpoint, name)
            assert.strictEqual(result.code, 'ETIMEDOUT', name)
        }
    })
})
