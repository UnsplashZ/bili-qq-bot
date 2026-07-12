#!/usr/bin/env node
'use strict'

const assert = require('assert')

const OfficialOpenApiClient = require('../../../../src/providers/qq/official/openapiClient')

describe('OfficialOpenApiClient', () => {
    it('refreshes auth once after 401 and redacts auth-bearing errors through logger helpers', async () => {
        const authCalls = []
        const tokenManager = {
            async getAuthorizationHeader(options = {}) {
                authCalls.push(Boolean(options.forceRefresh))
                return options.forceRefresh ? 'QQBot refreshed-token' : 'QQBot stale-token'
            }
        }
        const requests = []
        const client = new OfficialOpenApiClient({
            apiBase: 'https://api.sgroup.qq.com',
            tokenManager,
            fetchImpl: async (url, init) => {
                requests.push({ url, init })
                if (requests.length === 1) {
                    return {
                        ok: false,
                        status: 401,
                        headers: { get: () => null },
                        text: async () => JSON.stringify({ code: 401, message: 'expired' })
                    }
                }
                return {
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    text: async () => JSON.stringify({ ok: true })
                }
            }
        })

        const result = await client.requestJson('GET', '/gateway/bot')
        assert.deepEqual(result, { ok: true })
        assert.deepEqual(authCalls, [false, true])
        assert.equal(requests[1].init.headers.authorization, 'QQBot refreshed-token')
    })

    it('throws structured errors with retry-after for 429', async () => {
        const client = new OfficialOpenApiClient({
            tokenManager: {
                async getAuthorizationHeader() {
                    return 'QQBot token'
                }
            },
            fetchImpl: async () => ({
                ok: false,
                status: 429,
                headers: { get: (name) => String(name).toLowerCase() === 'retry-after' ? '2' : null },
                text: async () => JSON.stringify({ code: 12345, message: 'too many requests' })
            })
        })

        await assert.rejects(
            () => client.sendGroupMessage('group-openid', { msg_type: 0, content: 'hi' }),
            (error) => {
                assert.equal(error.httpStatus, 429)
                assert.equal(error.qqCode, 12345)
                assert.equal(error.category, 'rate_limited')
                assert.equal(error.retryable, true)
                assert.ok(error.retryAfterMs >= 2000)
                return true
            }
        )
    })
})
