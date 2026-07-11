'use strict'

const assert = require('assert')
const { EventEmitter } = require('events')

const NapcatProvider = require('../../../src/providers/qq/napcatProvider')
const OfficialQqProvider = require('../../../src/providers/qq/officialProvider')
const { ProviderRuntimeManager } = require('../../../src/providers/qq/providerSlotRuntime')
const qqRuntime = require('../../../src/providers/qq/runtime')

class FakeGateway extends EventEmitter {
    constructor() {
        super()
        this.startCount = 0
        this.stopCount = 0
    }

    async start() {
        this.startCount += 1
        this.emit('state', 'ready')
    }

    stop() {
        this.stopCount += 1
    }

    getStatus() { return { state: 'ready' } }
}

function createOfficial(options = {}) {
    const gateway = options.gateway || new FakeGateway()
    const idStore = {
        toGroupListMap: () => new Map([['group-new', { group_id: 'group-new' }]]),
        flushCount: 0,
        flush() { this.flushCount += 1 },
        getStatus: () => ({ groups: 1 })
    }
    const rateLimiter = {
        stopCount: 0,
        stop() { this.stopCount += 1 },
        getStatus: () => ({})
    }
    const provider = new OfficialQqProvider({
        publishGlobal: options.publishGlobal,
        onEvent: options.onEvent,
        config: {
            qqOfficialAppId: 'candidate-app',
            qqOfficialClientSecret: 'secret',
            qqOfficialTokenUrl: 'https://example.test/token',
            qqOfficialApiBase: 'https://example.test/api',
            qqOfficialIntents: 1,
            qqOfficialUseShardedGateway: false,
            qqOfficialGatewayAckTimeoutMs: 1000,
            qqOfficialMediaUploadMode: 'direct',
            qqOfficialTempPublicBaseUrl: '',
            qqOfficialAccountQpm: 10,
            qqOfficialGroupQpm: 10,
            qqOfficialQueueMaxSize: 10,
            napcatTempPath: '/tmp'
        },
        logger: {
            logEvent() {},
            getErrorMessage: error => error?.message || String(error)
        },
        tokenManager: {
            async getAccessToken() { return 'token' },
            getStatus: () => ({ configured: true })
        },
        openapi: {
            async getGateway() { return { url: 'wss://gateway.example.test/ws' } },
            async getGatewayBot() { return { url: 'wss://gateway.example.test/ws', shards: 1 } }
        },
        gateway,
        rateLimiter,
        mediaUploader: {},
        sender: {
            sendGroupMessage: async () => ({}),
            sendPrivateMessage: async () => ({}),
            recallMessage: async () => ({})
        },
        idStore,
        messageIdStore: {
            record() {},
            getStatus: () => ({})
        }
    })
    return { provider, gateway, idStore, rateLimiter }
}

describe('QQ provider candidate lifecycle', function () {
    it('rejects a NapCat candidate whose login identity probe fails after WebSocket open', async function () {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.send = (raw) => {
            const request = JSON.parse(String(raw))
            setImmediate(() => ws.emit('message', JSON.stringify({
                status: 'failed',
                retcode: 1403,
                data: null,
                echo: request.echo
            })))
        }
        const provider = new NapcatProvider(ws)
        await assert.rejects(
            provider.waitUntilReady(1000),
            (error) => error.code === 'NAPCAT_LOGIN_PROBE_FAILED'
        )
        assert.strictEqual(provider.loginReady, false)
    })

    it('waits for NapCat open and stop removes listeners and closes idempotently', async function () {
        const ws = new EventEmitter()
        ws.readyState = 0
        ws.closeCount = 0
        ws.terminateCount = 0
        ws.close = () => {
            ws.closeCount += 1
            ws.readyState = 3
            ws.emit('close')
        }
        ws.terminate = () => { ws.terminateCount += 1 }
        ws.send = (raw) => {
            const request = JSON.parse(String(raw))
            if (request.action === 'get_login_info') {
                setImmediate(() => ws.emit('message', JSON.stringify({
                    status: 'ok',
                    retcode: 0,
                    data: { user_id: 12345 },
                    echo: request.echo
                })))
            }
        }
        ws.on('message', () => {})
        const provider = new NapcatProvider(ws)

        setImmediate(() => {
            ws.readyState = 1
            ws.emit('open')
        })
        await provider.waitUntilReady(1000)
        await provider.stop()
        await provider.stop()

        assert.equal(ws.closeCount, 1)
        assert.equal(ws.terminateCount, 0)
        assert.equal(ws.listenerCount('message'), 0)
        assert.equal(provider.ws, null)
    })

    it('surfaces NapCat close/terminate failure and preserves the socket for retry', async function () {
        const ws = new EventEmitter()
        ws.readyState = 1
        ws.close = () => {}
        ws.terminate = () => { throw new Error('terminate failed') }
        const provider = new NapcatProvider(ws)
        provider.stopTimeoutMs = 5
        provider.stopForceGraceMs = 5

        await assert.rejects(() => provider.stop(), error => error.code === 'NAPCAT_STOP_FAILED')
        assert.equal(provider.ws, ws)

        ws.close = () => {
            ws.readyState = 3
            ws.emit('close')
        }
        await provider.stop()
        assert.equal(provider.ws, null)
    })

    it('prepares Official candidate without publishing global state before explicit activation', async function () {
        const previousGlobal = global.bot
        global.bot = {
            selfId: 'active-old',
            nickname: 'Old Bot',
            ws: { id: 'old-ws' },
            groupList: new Map([['group-old', {}]])
        }
        const onEvent = () => {}
        const { provider, gateway, idStore, rateLimiter } = createOfficial({
            publishGlobal: false,
            onEvent
        })
        const manager = new ProviderRuntimeManager()
        manager.setActiveProvider({ id: 'old', async stop() {} })

        try {
            await manager.prepareCandidate(provider)
            assert.equal(manager.getCurrentProvider().id, 'old')
            assert.equal(global.bot.selfId, 'active-old')
            assert.equal(global.bot.groupList.has('group-old'), true)
            assert.equal(provider.onEvent, onEvent)

            manager.commitCandidate()
            assert.equal(global.bot.selfId, 'active-old', 'slot commit alone must not mutate global handles')
            provider.activateGlobal()
            assert.equal(global.bot.selfId, 'candidate-app')
            assert.equal(global.bot.groupList.has('group-new'), true)

            await provider.stop()
            await provider.stop()
            assert.equal(gateway.stopCount, 1)
            assert.equal(rateLimiter.stopCount, 1)
            assert.equal(idStore.flushCount, 1)
        } finally {
            global.bot = previousGlobal
        }
    })

    it('projects manager generation and release epoch into public provider status', function () {
        const manager = qqRuntime.providerRuntimeManager
        const previousSlot = manager.activeSlot
        const previousGeneration = manager.generation
        const previousRelease = manager.releaseGate.snapshot()
        try {
            manager.setActiveProvider({
                id: 'status-provider',
                getStatus: () => ({ id: 'status-provider', state: 'ready' })
            }, { generation: 9 })
            manager.releaseGate.restore({
                epoch: 'epoch-status',
                armed: true,
                released: true,
                admissionEnabled: true
            })
            const status = qqRuntime.getProviderStatus()
            assert.equal(status.generation, 9)
            assert.equal(status.resourceGeneration, 9)
            assert.equal(status.releaseEpoch, 'epoch-status')
            assert.equal(status.state, 'ready')
        } finally {
            manager.activeSlot = previousSlot
            manager.generation = previousGeneration
            manager.releaseGate.restore(previousRelease)
        }
    })

    it('aggregates Official cleanup failures and permits an explicit retry', async function () {
        const { provider, gateway, idStore, rateLimiter } = createOfficial({ publishGlobal: false })
        let failCleanup = true
        gateway.stop = async () => {
            gateway.stopCount += 1
            if (failCleanup) throw Object.assign(new Error('gateway stop failed'), { code: 'GATEWAY_STOP_FAILED' })
        }
        rateLimiter.stop = async () => {
            rateLimiter.stopCount += 1
            if (failCleanup) throw Object.assign(new Error('limiter stop failed'), { code: 'LIMITER_STOP_FAILED' })
        }
        idStore.flush = async () => {
            idStore.flushCount += 1
            if (failCleanup) throw Object.assign(new Error('id flush failed'), { code: 'ID_FLUSH_FAILED' })
        }

        await assert.rejects(
            () => provider.stop(),
            error => error.code === 'OFFICIAL_PROVIDER_CLEANUP_FAILED' && error.cleanupErrors.length === 3
        )
        failCleanup = false
        await provider.stop()
        assert.equal(provider.state, 'stopped')
        assert.equal(gateway.stopCount, 2)
        assert.equal(rateLimiter.stopCount, 2)
        assert.equal(idStore.flushCount, 2)
    })
})
