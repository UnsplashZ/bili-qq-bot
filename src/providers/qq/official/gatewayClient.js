const EventEmitter = require('events')
const WebSocket = require('ws')

const OPCODES = {
    DISPATCH: 0,
    HEARTBEAT: 1,
    IDENTIFY: 2,
    RESUME: 6,
    RECONNECT: 7,
    INVALID_SESSION: 9,
    HELLO: 10,
    HEARTBEAT_ACK: 11
}

class OfficialGatewayClient extends EventEmitter {
    constructor(options = {}) {
        super()
        this.openapi = options.openapi
        this.tokenManager = options.tokenManager
        this.WebSocketClass = options.WebSocketClass || WebSocket
        this.logger = options.logger || null
        this.intents = Number(options.intents || (1 << 25))
        this.useShardedGateway = options.useShardedGateway !== false
        this.reconnectBaseMs = Number(options.reconnectBaseMs || 1000)
        this.reconnectMaxMs = Number(options.reconnectMaxMs || 60000)
        this.ackTimeoutMs = Number(options.ackTimeoutMs || 0)
        this.ws = null
        this.state = 'stopped'
        this.seq = null
        this.sessionId = ''
        this.gatewayUrl = ''
        this.shard = [0, 1]
        this.heartbeatIntervalMs = 0
        this.heartbeatTimer = null
        this.ackTimer = null
        this.awaitingAck = false
        this.reconnectTimer = null
        this.reconnectAttempts = 0
        this.manualStop = false
    }

    async start() {
        this.manualStop = false
        await this.connect()
    }

    async resolveGateway() {
        const data = this.useShardedGateway
            ? await this.openapi.getGatewayBot()
            : await this.openapi.getGateway()
        const url = data.url || data.endpoint
        if (!url) throw new Error('qq_gateway_url_missing')
        const shards = Number(data.shards || data.shard_count || 1)
        this.gatewayUrl = url
        this.shard = [0, Math.max(1, shards)]
        return url
    }

    async connect(resume = false) {
        this.clearReconnectTimer()
        this.clearHeartbeatTimers()
        const url = this.gatewayUrl && resume ? this.gatewayUrl : await this.resolveGateway()
        this.state = 'connecting'
        this.ws = new this.WebSocketClass(url)
        this.ws.on('open', () => {
            this.state = 'open'
            this.emit('state', this.state)
        })
        this.ws.on('message', (raw) => this.handleMessage(raw))
        this.ws.on('close', (code, reason) => this.handleClose(code, reason))
        this.ws.on('error', (error) => {
            this.logger?.logEvent?.('error', 'QQ', 'svc:qq:gateway', 'gateway-error', {
                error: this.logger.getErrorMessage ? this.logger.getErrorMessage(error) : String(error)
            })
            this.emit('error', error)
        })
    }

    async identify() {
        const token = await this.tokenManager.getAuthorizationHeader()
        this.sendPayload({
            op: OPCODES.IDENTIFY,
            d: {
                token,
                intents: this.intents,
                shard: this.shard,
                properties: {
                    os: process.platform,
                    browser: 'bili-qq-bot',
                    device: 'bili-qq-bot'
                }
            }
        })
        this.state = 'identifying'
        this.emit('state', this.state)
    }

    async resume() {
        if (!this.sessionId) {
            await this.identify()
            return
        }
        const token = await this.tokenManager.getAuthorizationHeader()
        this.sendPayload({
            op: OPCODES.RESUME,
            d: {
                token,
                session_id: this.sessionId,
                seq: this.seq
            }
        })
        this.state = 'resuming'
        this.emit('state', this.state)
    }

    sendPayload(payload) {
        if (!this.ws || this.ws.readyState !== 1) return false
        this.ws.send(JSON.stringify(payload))
        return true
    }

    heartbeat() {
        if (!this.sendPayload({ op: OPCODES.HEARTBEAT, d: this.seq })) return
        this.awaitingAck = true
        if (this.ackTimer) clearTimeout(this.ackTimer)
        const ackTimeoutMs = this.ackTimeoutMs > 0
            ? this.ackTimeoutMs
            : Math.max(5000, Math.floor(this.heartbeatIntervalMs * 1.5))
        this.ackTimer = setTimeout(() => {
            if (!this.awaitingAck || this.manualStop) return
            this.logger?.logEvent?.('warn', 'QQ', 'svc:qq:gateway', 'heartbeat-ack-timeout')
            try {
                this.ws?.close?.(4000, 'heartbeat_ack_timeout')
            } catch {}
            this.scheduleReconnect(true)
        }, ackTimeoutMs)
        if (typeof this.ackTimer.unref === 'function') this.ackTimer.unref()
    }

    startHeartbeat(intervalMs) {
        this.heartbeatIntervalMs = Math.max(1000, Number(intervalMs) || 45000)
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.heartbeat()
        this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs)
        if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref()
    }

    handleDispatch(payload) {
        this.seq = payload.s ?? this.seq
        if (payload.t === 'READY') {
            this.sessionId = payload.d?.session_id || this.sessionId
            this.state = 'ready'
            this.reconnectAttempts = 0
            this.emit('state', this.state)
        }
        this.emit('event', payload)
    }

    handleMessage(raw) {
        let payload
        try {
            payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
        } catch {
            return
        }

        if (payload.s !== undefined && payload.s !== null) this.seq = payload.s

        if (payload.op === OPCODES.HELLO) {
            this.startHeartbeat(payload.d?.heartbeat_interval)
            const shouldResume = Boolean(this.sessionId && this.seq)
            Promise.resolve(shouldResume ? this.resume() : this.identify()).catch((error) => this.emit('error', error))
            return
        }

        if (payload.op === OPCODES.HEARTBEAT_ACK) {
            this.awaitingAck = false
            if (this.ackTimer) {
                clearTimeout(this.ackTimer)
                this.ackTimer = null
            }
            return
        }

        if (payload.op === OPCODES.HEARTBEAT) {
            this.heartbeat()
            return
        }

        if (payload.op === OPCODES.RECONNECT) {
            this.scheduleReconnect(true)
            this.closeCurrentSocket(4001, 'server_requested_reconnect')
            return
        }

        if (payload.op === OPCODES.INVALID_SESSION) {
            this.sessionId = ''
            this.seq = null
            this.scheduleReconnect(false)
            this.closeCurrentSocket(4002, 'invalid_session')
            return
        }

        if (payload.op === OPCODES.DISPATCH) {
            this.handleDispatch(payload)
        }
    }

    handleClose(code, reason) {
        this.clearHeartbeatTimers()
        this.state = this.manualStop ? 'stopped' : (this.reconnectTimer ? 'reconnecting' : 'closed')
        this.emit('state', this.state)
        this.emit('close', { code, reason: reason ? String(reason) : '' })
        if (!this.manualStop) this.scheduleReconnect(Boolean(this.sessionId))
    }

    scheduleReconnect(resume = true) {
        if (this.manualStop || this.reconnectTimer) return
        this.reconnectAttempts += 1
        const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * Math.pow(2, this.reconnectAttempts - 1))
        this.state = 'reconnecting'
        this.emit('state', this.state)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.connect(resume).catch((error) => {
                this.emit('error', error)
                this.scheduleReconnect(resume)
            })
        }, delay)
        if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref()
    }

    closeCurrentSocket(code, reason) {
        if (!this.ws || this.ws.readyState === 2 || this.ws.readyState === 3) return
        try {
            this.ws.close(code, reason)
        } catch {}
    }

    clearHeartbeatTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
        if (this.ackTimer) {
            clearTimeout(this.ackTimer)
            this.ackTimer = null
        }
        this.awaitingAck = false
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }

    stop() {
        this.manualStop = true
        this.clearReconnectTimer()
        this.clearHeartbeatTimers()
        this.state = 'stopped'
        if (this.ws) {
            try {
                this.ws.close()
            } catch {}
            this.ws = null
        }
        this.emit('state', this.state)
    }

    getStatus() {
        return {
            state: this.state,
            sessionReady: Boolean(this.sessionId),
            hasSeq: this.seq !== null && this.seq !== undefined,
            heartbeatIntervalMs: this.heartbeatIntervalMs,
            ackTimeoutMs: this.ackTimeoutMs,
            awaitingAck: this.awaitingAck,
            reconnectAttempts: this.reconnectAttempts,
            shard: this.shard
        }
    }
}

module.exports = OfficialGatewayClient
module.exports.OPCODES = OPCODES
