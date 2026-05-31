'use strict'

const assert = require('assert')

const { classifyBiliApiError } = require('../../../src/services/biliApiErrorClassifier')
const maintenanceModule = require('../../../src/services/subscription/updateChecker/modules/maintenance')
const deps = require('../../../src/services/subscription/updateChecker/adapters/deps')

describe('updateChecker cookie error classification', function () {
    const originalRefreshCredential = deps.biliApi.refreshCredential

    afterEach(function () {
        deps.biliApi.refreshCredential = originalRefreshCredential
    })

    it('优先使用 Python envelope 中的结构化错误字段', function () {
        const result = classifyBiliApiError({
            status: 'error',
            message: '未登录',
            errorType: 'auth_failed',
            exceptionClass: 'CredentialError',
            biliCode: -101,
            httpStatus: 401,
            retryable: false,
            endpoint: 'my_info'
        })

        assert.strictEqual(result.errorType, 'auth_failed')
        assert.strictEqual(result.failureKind, 'auth_failed')
        assert.strictEqual(result.retryable, false)
        assert.strictEqual(result.biliCode, -101)
        assert.strictEqual(result.httpStatus, 401)
        assert.strictEqual(result.endpoint, 'my_info')
        assert.strictEqual(result.exceptionClass, 'CredentialError')
    })

    it('axios 超时错误应归类为 transient_network 且可重试', function () {
        const error = new Error('timeout of 1000ms exceeded')
        error.code = 'ECONNABORTED'
        error.endpoint = 'my_followings'
        error.timeout = 1000

        const result = classifyBiliApiError(error)

        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'my_followings')
        assert.strictEqual(result.code, 'ECONNABORTED')
    })

    it('带 Cookie/login 文案的网络错误仍应优先归类为 transient_network', function () {
        for (const message of ['Cookie有效性检查失败: timeout', 'checkLogin timeout']) {
            const error = new Error(message)
            error.code = 'ETIMEDOUT'

            const result = classifyBiliApiError(error)

            assert.strictEqual(result.errorType, 'transient_network', message)
            assert.strictEqual(result.retryable, true, message)
            assert.strictEqual(result.code, 'ETIMEDOUT', message)
        }
    })

    it('Python 返回 unknown 但 exceptionClass=TimeoutError 时应修正为 transient_network', function () {
        const result = classifyBiliApiError({
            status: 'error',
            message: '',
            errorType: 'unknown',
            exceptionClass: 'TimeoutError',
            retryable: false,
            endpoint: 'refresh_credential'
        })

        assert.strictEqual(result.errorType, 'transient_network')
        assert.strictEqual(result.retryable, true)
        assert.strictEqual(result.endpoint, 'refresh_credential')
    })

    it('refreshCookieFollowings 分类：未登录立即 Cookie 告警，可重试错误到阈值后发网络/API告警', function () {
        const alerts = []
        const context = {
            ...maintenanceModule,
            cookieSyncFailureState: new Map(),
            notifyAdmin(message) {
                alerts.push(message)
            }
        }

        context.recordCookieSyncFailure('1000', {
            status: 'error',
            message: '未登录',
            errorType: 'auth_failed',
            endpoint: 'my_info',
            retryable: false
        }, { endpoint: 'my_info' })

        assert.strictEqual(alerts.length, 1)
        assert.ok(alerts[0].includes('Cookie未登录或已失效'))

        context.recordCookieSyncFailure('2000', {
            status: 'error',
            message: 'timeout',
            errorType: 'transient_network',
            endpoint: 'my_followings',
            retryable: true
        }, { endpoint: 'my_followings', accountUid: '42' })
        assert.strictEqual(alerts.length, 1, '单次可重试错误不应立即告警')

        context.recordCookieSyncFailure('2000', {
            status: 'error',
            message: 'timeout',
            errorType: 'transient_network',
            endpoint: 'my_followings',
            retryable: true
        }, { endpoint: 'my_followings', accountUid: '42' })
        context.recordCookieSyncFailure('2000', {
            status: 'error',
            message: 'timeout',
            errorType: 'transient_network',
            endpoint: 'my_followings',
            retryable: true
        }, { endpoint: 'my_followings', accountUid: '42' })

        assert.strictEqual(alerts.length, 2)
        assert.ok(alerts[1].includes('网络/API异常'))
        assert.ok(!alerts[1].includes('Cookie未登录'))
    })

    it('checkAndRefreshCredential 单次 transient_network 不应告警 Cookie 异常，达到阈值后发网络/API告警', async function () {
        const alerts = []
        const context = {
            ...maintenanceModule,
            cookieSyncFailureState: new Map(),
            notifyAdmin(message) {
                alerts.push(message)
            }
        }
        deps.biliApi.refreshCredential = async () => ({
            status: 'error',
            reason: 'check_failed',
            message: 'Cookie有效性检查失败: timeout',
            errorType: 'transient_network',
            retryable: true,
            endpoint: 'refresh_credential'
        })

        await context.checkAndRefreshCredential()
        assert.strictEqual(alerts.length, 0)

        await context.checkAndRefreshCredential()
        await context.checkAndRefreshCredential()

        assert.strictEqual(alerts.length, 1)
        assert.ok(alerts[0].includes('Cookie自动刷新遇到网络/API异常'))
        assert.ok(!alerts[0].includes('Cookie异常'))
    })

    it('checkAndRefreshCredential auth_failed 仍应立即提示重新配置 Cookie', async function () {
        const alerts = []
        const context = {
            ...maintenanceModule,
            cookieSyncFailureState: new Map(),
            notifyAdmin(message) {
                alerts.push(message)
            }
        }
        deps.biliApi.refreshCredential = async () => ({
            status: 'error',
            reason: 'invalid',
            message: 'Cookie已失效，请在Dashboard重新扫码登录',
            errorType: 'auth_failed',
            retryable: false,
            endpoint: 'refresh_credential'
        })

        await context.checkAndRefreshCredential()

        assert.strictEqual(alerts.length, 1)
        assert.ok(alerts[0].includes('B站Cookie异常'))
    })
})
