'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const OfficialQqProvider = require('../../../../src/providers/qq/officialProvider')

function createProvider(overrides = {}) {
    const gateway = Object.assign(new EventEmitter(), {
        startCount: 0,
        async start() { this.startCount += 1 },
        async stop() {},
        getStatus() { return { state: 'stopped' } }
    })
    const config = {
        qqOfficialAppId: 'app-id',
        qqOfficialClientSecret: 'client-secret',
        qqOfficialUseShardedGateway: false,
        qqOfficialIntents: 1,
        qqOfficialGatewayAckTimeoutMs: 1000,
        qqOfficialMediaUploadMode: 'direct',
        qqOfficialTempPublicBaseUrl: '',
        qqOfficialAccountQpm: 10,
        qqOfficialGroupQpm: 10,
        qqOfficialQueueMaxSize: 10,
        napcatTempPath: '/tmp',
        ...(overrides.config || {})
    }
    const provider = new OfficialQqProvider({
        publishGlobal: false,
        runtimeActive: false,
        config,
        tokenManager: overrides.tokenManager || {
            async getAccessToken() { return 'token' },
            getStatus() { return { configured: true } }
        },
        openapi: overrides.openapi || {
            async getGateway() { return { url: 'wss://gateway.example.test/ws' } },
            async getGatewayBot() { return { url: 'wss://gateway.example.test/ws', shards: 2 } }
        },
        gateway,
        rateLimiter: { async stop() {}, getStatus() { return {} } },
        mediaUploader: {},
        sender: {},
        idStore: { toGroupListMap: () => new Map(), getStatus: () => ({}) },
        messageIdStore: { getStatus: () => ({}) },
        logger: { logEvent() {}, getErrorMessage: error => error?.message || String(error) }
    })
    return { provider, gateway }
}

describe('OfficialQqProvider preflight', () => {
    it('fails closed before network calls when either credential is empty', async () => {
        let tokenCalls = 0
        const tokenManager = {
            async getAccessToken() { tokenCalls += 1; return 'token' },
            getStatus() { return {} }
        }
        const missingApp = createProvider({
            config: { qqOfficialAppId: '' },
            tokenManager
        }).provider
        const missingSecret = createProvider({
            config: { qqOfficialClientSecret: '' },
            tokenManager
        }).provider

        await assert.rejects(() => missingApp.preflight(), error => error.code === 'QQ_OFFICIAL_APP_ID_MISSING')
        await assert.rejects(() => missingSecret.preflight(), error => error.code === 'QQ_OFFICIAL_CLIENT_SECRET_MISSING')
        assert.equal(tokenCalls, 0)
    })

    it('preserves token 401 and timeout failures without opening a gateway session', async () => {
        for (const failure of [
            Object.assign(new Error('token 401'), { status: 401 }),
            Object.assign(new Error('token timeout'), { code: 'ETIMEDOUT' })
        ]) {
            const { provider, gateway } = createProvider({
                tokenManager: {
                    async getAccessToken() { throw failure },
                    getStatus() { return {} }
                }
            })
            await assert.rejects(() => provider.preflight(), error => error === failure)
            assert.equal(gateway.startCount, 0)
        }
    })

    it('rejects missing, malformed, and insecure gateway metadata', async () => {
        for (const url of ['', 'not-a-url', 'ws://gateway.example.test/ws', 'https://gateway.example.test/ws']) {
            const { provider, gateway } = createProvider({
                openapi: { async getGateway() { return { url } } }
            })
            await assert.rejects(
                () => provider.preflight(),
                error => ['QQ_OFFICIAL_GATEWAY_URL_INVALID', 'QQ_OFFICIAL_GATEWAY_URL_INSECURE'].includes(error.code)
            )
            assert.equal(gateway.startCount, 0)
        }
    })

    it('selects the configured gateway metadata endpoint without starting consumption', async () => {
        let plainCalls = 0
        let shardedCalls = 0
        const { provider, gateway } = createProvider({
            config: { qqOfficialUseShardedGateway: true },
            openapi: {
                async getGateway() { plainCalls += 1; return { url: 'wss://plain.example.test/ws' } },
                async getGatewayBot() { shardedCalls += 1; return { url: 'wss://sharded.example.test/ws', shards: 4 } }
            }
        })

        const result = await provider.preflight()
        assert.equal(result.endpoint, 'wss://sharded.example.test/ws')
        assert.equal(result.shards, 4)
        assert.equal(plainCalls, 0)
        assert.equal(shardedCalls, 1)
        assert.equal(gateway.startCount, 0)
    })
})
