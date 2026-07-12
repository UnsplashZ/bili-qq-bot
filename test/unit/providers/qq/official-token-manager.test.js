#!/usr/bin/env node
'use strict'

const assert = require('assert')

const OfficialTokenManager = require('../../../../src/providers/qq/official/tokenManager')

describe('OfficialTokenManager', () => {
    it('caches token and coalesces concurrent refreshes', async () => {
        let fetchCount = 0
        const manager = new OfficialTokenManager({
            appId: 'app',
            clientSecret: 'secret-value',
            fetchImpl: async () => {
                fetchCount += 1
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        access_token: `token-${fetchCount}`,
                        expires_in: 7200
                    })
                }
            }
        })

        const [left, right] = await Promise.all([
            manager.getAccessToken(),
            manager.getAccessToken()
        ])

        assert.equal(left, 'token-1')
        assert.equal(right, 'token-1')
        assert.equal(fetchCount, 1)
        assert.equal(await manager.getAccessToken(), 'token-1')
    })

    it('keeps an unexpired token when refresh fails', async () => {
        let fetchCount = 0
        const manager = new OfficialTokenManager({
            appId: 'app',
            clientSecret: 'secret-value',
            fetchImpl: async () => {
                fetchCount += 1
                if (fetchCount === 1) {
                    return {
                        ok: true,
                        status: 200,
                        text: async () => JSON.stringify({ access_token: 'good-token', expires_in: 7200 })
                    }
                }
                throw new Error('network token=raw-secret')
            }
        })

        assert.equal(await manager.getAccessToken(), 'good-token')
        assert.equal(await manager.refreshAccessToken({ forceRefresh: true }), 'good-token')
        assert.equal(fetchCount, 2)
    })
})
