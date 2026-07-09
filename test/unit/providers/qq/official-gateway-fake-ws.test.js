#!/usr/bin/env node
'use strict'

const assert = require('assert')
const EventEmitter = require('events')

const OfficialGatewayClient = require('../../../../src/providers/qq/official/gatewayClient')
const { OPCODES } = require('../../../../src/providers/qq/official/gatewayClient')

class FakeWs extends EventEmitter {
    constructor(url) {
        super()
        this.url = url
        this.readyState = 1
        this.sent = []
        FakeWs.instances.push(this)
    }

    send(payload) {
        this.sent.push(JSON.parse(payload))
    }

    close(code = 1000, reason = '') {
        this.readyState = 3
        this.emit('close', code, reason)
    }
}
FakeWs.instances = []

function createClient(overrides = {}) {
    return new OfficialGatewayClient({
        WebSocketClass: FakeWs,
        openapi: {
            async getGatewayBot() {
                return { url: 'wss://gateway.example/ws', shards: 1 }
            }
        },
        tokenManager: {
            async getAuthorizationHeader() {
                return 'QQBot token'
            }
        },
        intents: 1,
        reconnectBaseMs: 100000,
        ...overrides
    })
}

describe('OfficialGatewayClient fake ws', () => {
    beforeEach(() => {
        FakeWs.instances = []
    })

    it('identifies after hello, tracks READY, handles ack, and stops timers', async () => {
        const client = createClient()

        await client.start()
        const ws = FakeWs.instances[0]
        ws.emit('message', JSON.stringify({ op: OPCODES.HELLO, d: { heartbeat_interval: 100000 } }))
        await new Promise(resolve => setImmediate(resolve))

        assert.ok(ws.sent.some((item) => item.op === OPCODES.HEARTBEAT))
        assert.ok(ws.sent.some((item) => item.op === OPCODES.IDENTIFY && item.d.token === 'QQBot token'))

        ws.emit('message', JSON.stringify({ op: OPCODES.DISPATCH, t: 'READY', s: 7, d: { session_id: 'session-1' } }))
        assert.equal(client.getStatus().state, 'ready')
        assert.equal(client.getStatus().sessionReady, true)

        ws.emit('message', JSON.stringify({ op: OPCODES.HEARTBEAT_ACK }))
        assert.equal(client.getStatus().awaitingAck, false)

        client.stop()
        assert.equal(client.getStatus().state, 'stopped')
        assert.equal(client.heartbeatTimer, null)
    })

    it('resumes when a session and seq are available', async () => {
        const client = createClient()
        await client.start()
        const ws = FakeWs.instances[0]

        ws.emit('message', JSON.stringify({ op: OPCODES.DISPATCH, t: 'READY', s: 9, d: { session_id: 'session-1' } }))
        ws.emit('message', JSON.stringify({ op: OPCODES.HELLO, d: { heartbeat_interval: 100000 } }))
        await new Promise(resolve => setImmediate(resolve))

        assert.ok(ws.sent.some((item) => item.op === OPCODES.RESUME && item.d.session_id === 'session-1' && item.d.seq === 9))
        client.stop()
    })

    it('drops session on invalid session and reconnects with identify next time', async () => {
        let timerFn = null
        const client = createClient({
            setTimer: undefined,
            reconnectBaseMs: 10
        })
        client.reconnectBaseMs = 10
        client.reconnectMaxMs = 10
        const originalSetTimeout = global.setTimeout
        try {
            global.setTimeout = (fn) => {
                timerFn = fn
                return { unref() {} }
            }
            await client.start()
            const ws = FakeWs.instances[0]
            ws.emit('message', JSON.stringify({ op: OPCODES.DISPATCH, t: 'READY', s: 3, d: { session_id: 'session-1' } }))
            ws.emit('message', JSON.stringify({ op: OPCODES.INVALID_SESSION }))

            assert.equal(client.sessionId, '')
            assert.equal(client.seq, null)
            assert.equal(client.getStatus().state, 'reconnecting')
            assert.equal(typeof timerFn, 'function')
        } finally {
            global.setTimeout = originalSetTimeout
            client.stop()
        }
    })

    it('closes and schedules reconnect on heartbeat ack timeout', async () => {
        const timers = []
        const client = createClient({
            ackTimeoutMs: 5
        })
        const originalSetTimeout = global.setTimeout
        try {
            global.setTimeout = (fn, delay) => {
                timers.push({ fn, delay })
                return { unref() {} }
            }
            await client.start()
            const ws = FakeWs.instances[0]
            ws.emit('message', JSON.stringify({ op: OPCODES.HELLO, d: { heartbeat_interval: 100000 } }))
            await new Promise(resolve => setImmediate(resolve))

            const ackTimer = timers.find((item) => item.delay === 5)
            assert.ok(ackTimer)
            ackTimer.fn()
            assert.equal(ws.readyState, 3)
            assert.equal(client.getStatus().state, 'reconnecting')
        } finally {
            global.setTimeout = originalSetTimeout
            client.stop()
        }
    })
})
