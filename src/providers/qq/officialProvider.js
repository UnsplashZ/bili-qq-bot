const BaseQqProvider = require('./baseProvider')
const path = require('path')
const { OFFICIAL_CAPABILITIES } = require('./capabilities')
const logger = require('../../utils/logger')
const config = require('../../config')
const OfficialTokenManager = require('./official/tokenManager')
const OfficialOpenApiClient = require('./official/openapiClient')
const OfficialGatewayClient = require('./official/gatewayClient')
const OfficialEventMapper = require('./official/eventMapper')
const OfficialMessageSender = require('./official/messageSender')
const OfficialMediaUploader = require('./official/mediaUploader')
const QpmRateLimiter = require('./official/rateLimiter')
const OfficialIdStore = require('./official/idStore')
const OfficialMessageIdStore = require('./official/messageIdStore')

const GROUP_AND_C2C_EVENT_INTENT = 1 << 25

class OfficialQqProvider extends BaseQqProvider {
    constructor(options = {}) {
        super({
            id: 'official',
            name: 'QQ Official',
            capabilities: OFFICIAL_CAPABILITIES
        })
        this.config = options.config || config
        this.logger = options.logger || logger
        this.onEvent = options.onEvent || null
        this.publishGlobal = options.publishGlobal !== false
        this.runtimeActive = options.runtimeActive ?? this.publishGlobal
        this._stopPromise = null
        this.state = 'created'
        this.canonicalSharedState = options.sharedState || {
            idStore: options.idStore || new OfficialIdStore({
                storagePath: path.join(process.cwd(), 'data', 'qq-official-id-store.json')
            }),
            messageIdStore: options.messageIdStore || new OfficialMessageIdStore()
        }
        this._sharedStateCandidate = Boolean(options.forkSharedState)
        this._sharedStateCommitted = !this._sharedStateCandidate
        this._sharedStateCommitCheckpoint = null
        if (this._sharedStateCandidate) {
            if (typeof this.canonicalSharedState.idStore?.fork !== 'function' ||
                typeof this.canonicalSharedState.messageIdStore?.fork !== 'function') {
                throw new TypeError('Official shared state stores must support fork()')
            }
            this.idStore = this.canonicalSharedState.idStore.fork()
            this.messageIdStore = this.canonicalSharedState.messageIdStore.fork()
        } else {
            this.idStore = this.canonicalSharedState.idStore
            this.messageIdStore = this.canonicalSharedState.messageIdStore
        }
        this.tokenManager = options.tokenManager || new OfficialTokenManager({
            appId: this.config.qqOfficialAppId,
            clientSecret: this.config.qqOfficialClientSecret,
            tokenUrl: this.config.qqOfficialTokenUrl,
            logger: this.logger,
            fetchImpl: options.fetchImpl
        })
        this.openapi = options.openapi || new OfficialOpenApiClient({
            apiBase: this.config.qqOfficialApiBase,
            tokenManager: this.tokenManager,
            logger: this.logger,
            fetchImpl: options.fetchImpl
        })
        this.rateLimiter = options.rateLimiter || new QpmRateLimiter({
            accountLimit: this.config.qqOfficialAccountQpm,
            groupLimit: this.config.qqOfficialGroupQpm,
            maxQueueSize: this.config.qqOfficialQueueMaxSize
        })
        this.mediaUploader = options.mediaUploader || new OfficialMediaUploader({
            client: this.openapi,
            mode: this.config.qqOfficialMediaUploadMode,
            tempPublicBaseUrl: this.config.qqOfficialTempPublicBaseUrl,
            tempFileDir: path.join(this.config.napcatTempPath, 'qq-official-temp'),
            sourceFileBaseDir: this.config.napcatTempPath
        })
        this.sender = options.sender || new OfficialMessageSender({
            client: this.openapi,
            mediaUploader: this.mediaUploader,
            rateLimiter: this.rateLimiter,
            messageIdStore: this.messageIdStore,
            logger: this.logger
        })
        this.gateway = options.gateway || new OfficialGatewayClient({
            openapi: this.openapi,
            tokenManager: this.tokenManager,
            logger: this.logger,
            intents: this.config.qqOfficialIntents || GROUP_AND_C2C_EVENT_INTENT,
            useShardedGateway: this.config.qqOfficialUseShardedGateway,
            ackTimeoutMs: this.config.qqOfficialGatewayAckTimeoutMs,
            WebSocketClass: options.WebSocketClass
        })
        this.recentErrors = []
        this.gateway.on('event', (event) => this.handleGatewayEvent(event))
        this.gateway.on('state', (state) => {
            this.state = state
        })
        this.gateway.on('error', (error) => {
            this.recordError(error, 'gateway')
            this.logger.logEvent('error', 'QQ', 'svc:qq:provider', 'gateway-error', {
                error: this.logger.getErrorMessage(error)
            })
        })
    }

    get selfId() {
        return String(this.config.qqOfficialAppId || global.bot?.selfId || '')
    }

    get readyState() {
        return this.state === 'ready' ? 1 : 0
    }

    isRuntimeReady() {
        const gatewayState = this.gateway?.getStatus?.().state || this.gateway?.state
        const socketReady = !this.gateway?.ws || this.gateway.ws.readyState === 1
        return this.state === 'ready' && gatewayState === 'ready' && socketReady && !this.gateway?.manualStop
    }

    async preflight() {
        const appId = String(this.config.qqOfficialAppId || '').trim()
        const clientSecret = String(this.config.qqOfficialClientSecret || '').trim()
        if (!appId) {
            const error = new Error('qq_official_app_id_missing')
            error.code = 'QQ_OFFICIAL_APP_ID_MISSING'
            throw error
        }
        if (!clientSecret) {
            const error = new Error('qq_official_client_secret_missing')
            error.code = 'QQ_OFFICIAL_CLIENT_SECRET_MISSING'
            throw error
        }

        await this.tokenManager.getAccessToken()
        const gateway = this.config.qqOfficialUseShardedGateway
            ? await this.openapi.getGatewayBot()
            : await this.openapi.getGateway()
        const endpoint = String(gateway?.url || gateway?.endpoint || '').trim()
        let parsed
        try {
            parsed = new URL(endpoint)
        } catch {
            const error = new Error('qq_official_gateway_url_invalid')
            error.code = 'QQ_OFFICIAL_GATEWAY_URL_INVALID'
            throw error
        }
        if (parsed.protocol !== 'wss:' || !parsed.hostname) {
            const error = new Error('qq_official_gateway_url_insecure')
            error.code = 'QQ_OFFICIAL_GATEWAY_URL_INSECURE'
            throw error
        }
        return {
            endpoint: parsed.toString(),
            shards: Math.max(1, Number(gateway?.shards || gateway?.shard_count || 1))
        }
    }

    async start(options = {}) {
        this.onEvent = options.onEvent || this.onEvent || null
        if (options.publishGlobal !== undefined) this.publishGlobal = Boolean(options.publishGlobal)
        this.state = 'starting'
        if (this.publishGlobal && this.runtimeActive) this.publishGlobalState()
        await this.tokenManager.getAccessToken()
        await this.gateway.start()
        return this
    }

    async stop() {
        if (this._stopPromise) return this._stopPromise
        this.runtimeActive = false
        const stopPromise = (async () => {
            const cleanupTasks = [
                ['gateway', () => Promise.resolve(this.gateway.stop())],
                ['rate_limiter', () => Promise.resolve(this.rateLimiter.stop())]
            ]
            if (!this._sharedStateCandidate || this._sharedStateCommitted) {
                cleanupTasks.push(['id_store_flush', () => Promise.resolve(this.idStore.flush())])
            }
            const failures = []
            for (const [component, cleanup] of cleanupTasks) {
                try {
                    await cleanup()
                } catch (error) {
                    this.recordError(error, component)
                    failures.push(Object.assign(error, { component }))
                }
            }
            if (failures.length > 0) {
                const error = new AggregateError(failures, 'Official Provider cleanup failed')
                error.code = 'OFFICIAL_PROVIDER_CLEANUP_FAILED'
                error.cleanupErrors = failures
                throw error
            }
            this.state = 'stopped'
        })()
        this._stopPromise = stopPromise
        try {
            return await stopPromise
        } catch (error) {
            if (this._stopPromise === stopPromise) this._stopPromise = null
            throw error
        }
    }

    updateGroupList() {
        if (!this.publishGlobal || !this.runtimeActive) return
        global.bot = global.bot || {}
        global.bot.groupList = this.idStore.toGroupListMap()
    }

    publishGlobalState() {
        if (!this.publishGlobal || !this.runtimeActive) return
        global.bot = global.bot || { groupList: new Map(), selfId: '0' }
        global.bot.selfId = this.selfId || 'official'
        global.bot.nickname = global.bot.nickname || 'QQ Official Bot'
        global.bot.ws = null
        global.bot.groupList = this.idStore.toGroupListMap()
    }

    activateGlobal() {
        this.publishGlobal = true
        this.runtimeActive = true
        this.publishGlobalState()
    }

    deactivateGlobal() {
        this.runtimeActive = false
    }

    getSharedState() {
        return this.canonicalSharedState
    }

    commitSharedState() {
        if (!this._sharedStateCandidate || this._sharedStateCommitted) return this.canonicalSharedState
        const canonicalMessages = this.canonicalSharedState.messageIdStore
        const checkpoint = {
            canonicalIdState: this.canonicalSharedState.idStore.captureState(),
            canonicalMessageState: canonicalMessages.snapshot(),
            candidateIdStore: this.idStore,
            candidateMessageIdStore: this.messageIdStore
        }
        this._sharedStateCommitCheckpoint = checkpoint
        canonicalMessages.commitFrom(this.messageIdStore)
        try {
            this.canonicalSharedState.idStore.commitFrom(this.idStore)
        } catch (error) {
            canonicalMessages.restoreSnapshot(checkpoint.canonicalMessageState)
            checkpoint.candidateMessageIdStore._committed = false
            this._sharedStateCommitCheckpoint = null
            throw error
        }
        this.idStore = this.canonicalSharedState.idStore
        this.messageIdStore = canonicalMessages
        if (this.sender) this.sender.messageIdStore = this.messageIdStore
        this._sharedStateCommitted = true
        this._sharedStateCandidate = false
        return this.canonicalSharedState
    }

    rollbackSharedStateCommit() {
        const checkpoint = this._sharedStateCommitCheckpoint
        if (!checkpoint) return this.canonicalSharedState
        this.canonicalSharedState.idStore.restoreState(checkpoint.canonicalIdState)
        this.canonicalSharedState.messageIdStore.restoreSnapshot(checkpoint.canonicalMessageState)
        checkpoint.candidateIdStore._committed = false
        checkpoint.candidateMessageIdStore._committed = false
        this.idStore = checkpoint.candidateIdStore
        this.messageIdStore = checkpoint.candidateMessageIdStore
        if (this.sender) this.sender.messageIdStore = this.messageIdStore
        this._sharedStateCommitted = false
        this._sharedStateCandidate = true
        this._sharedStateCommitCheckpoint = null
        return this.canonicalSharedState
    }

    finalizeSharedStateCommit() {
        this._sharedStateCommitCheckpoint = null
        return this.canonicalSharedState
    }

    async waitUntilReady(timeoutMs = 15000) {
        if (this.state === 'ready') return this
        await new Promise((resolve, reject) => {
            let timer = null
            const cleanup = () => {
                if (timer) clearTimeout(timer)
                this.gateway.removeListener?.('state', onState)
                this.gateway.removeListener?.('error', onError)
            }
            const onState = (state) => {
                if (state !== 'ready') return
                cleanup()
                resolve()
            }
            const onError = (error) => {
                cleanup()
                reject(error)
            }
            this.gateway.on?.('state', onState)
            this.gateway.once?.('error', onError)
            timer = setTimeout(() => {
                cleanup()
                const error = new Error('Official gateway readiness timed out')
                error.code = 'OFFICIAL_READY_TIMEOUT'
                reject(error)
            }, Math.max(1, Number(timeoutMs) || 15000))
        })
        return this
    }

    handleGatewayEvent(event) {
        const type = event?.t || ''
        if (type === 'READY') {
            this.state = 'ready'
            return
        }

        const mapped = OfficialEventMapper.mapOfficialEvent(event, { selfId: this.selfId })
        if (!mapped) return

        const official = mapped.official || {}
        this.logger.logEvent('info', 'QQ', 'svc:qq:provider', 'event-dispatch', {
            eventType: official.eventType || type,
            messageType: mapped.message_type || '',
            noticeType: mapped.notice_type || '',
            groupOpenId: official.groupOpenId || '',
            hasUserOpenId: Boolean(official.userOpenId),
            hasMemberOpenId: Boolean(official.memberOpenId)
        })
        if (official.groupOpenId) {
            if (mapped.notice_type === 'group_reachability') {
                this.idStore.setGroupReachability(
                    official.groupOpenId,
                    mapped.reachable,
                    mapped.reason
                )
            } else if (mapped.post_type === 'notice' && mapped.notice_type === 'group_increase') {
                this.idStore.markGroupMembership(official.groupOpenId, 'joined')
            } else if (mapped.post_type === 'notice' && mapped.notice_type === 'group_decrease') {
                this.idStore.markGroupMembership(official.groupOpenId, 'left')
            } else {
                this.idStore.markGroupMessageEvent(official.groupOpenId, official.eventType)
            }
        }
        if (official.userOpenId) {
            this.idStore.upsertUser(official.userOpenId, {
                nickname: mapped.sender?.nickname || ''
            })
        }
        if (official.groupOpenId && official.memberOpenId) {
            this.idStore.upsertMember(official.groupOpenId, official.memberOpenId, {
                userOpenId: official.userOpenId || '',
                nickname: mapped.sender?.nickname || mapped.sender?.card || '',
                role: mapped.sender?.role || 'member',
                status: 'observed'
            })
        }
        if (mapped.post_type === 'message') {
            this.messageIdStore.record({
                internalMessageId: mapped.message_id,
                officialMessageId: official.msgId,
                targetType: mapped.message_type === 'private' ? 'private' : 'group',
                targetId: mapped.message_type === 'private' ? mapped.user_id : mapped.group_id,
                msgSeq: official.msgSeq,
                eventId: official.eventId,
                raw: official.raw
            })
        }
        this.updateGroupList()
        if (typeof this.onEvent === 'function') {
            this.onEvent(mapped)
        }
    }

    recordError(error, source = 'provider') {
        this.recentErrors.push({
            at: Date.now(),
            source,
            message: this.logger.getErrorMessage ? this.logger.getErrorMessage(error) : String(error),
            category: error?.category || '',
            httpStatus: error?.httpStatus || 0,
            qqCode: error?.qqCode ?? null
        })
        while (this.recentErrors.length > 20) {
            this.recentErrors.shift()
        }
    }

    buildMetadata(params = {}) {
        return {
            msgId: params.msg_id || params.message_id || params.sourceMessageId || '',
            eventId: params.event_id || params.eventId || params.official?.eventId || '',
            msgSeq: params.msg_seq ?? null
        }
    }

    sendGroupMessage(groupId, message, options = {}) {
        return this.sender.sendGroupMessage(String(groupId || ''), message, this.buildMetadata(options))
            .catch((error) => {
                this.recordError(error, 'send_group')
                throw error
            })
    }

    sendPrivateMessage(userId, message, options = {}) {
        return this.sender.sendPrivateMessage(String(userId || ''), message, this.buildMetadata(options))
            .catch((error) => {
                this.recordError(error, 'send_private')
                throw error
            })
    }

    async callAction(action, params = {}, options = {}) {
        const name = String(action || '')
        if (name === 'send_group_msg') {
            return this.sendGroupMessage(params.group_id, params.message, { ...options, ...params })
        }
        if (name === 'send_private_msg') {
            return this.sendPrivateMessage(params.user_id, params.message, { ...options, ...params })
        }
        if (name === 'delete_msg') {
            return this.sender.recallMessage(params.message_id, {
                groupId: params.group_id || options.groupId || '',
                userId: params.user_id || options.userId || '',
                hidetip: params.hidetip
            })
        }
        if (name === 'get_login_info') {
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    user_id: this.selfId,
                    nickname: global.bot?.nickname || 'QQ Official Bot',
                    provider: 'official'
                }
            }
        }
        if (name === 'get_group_list') {
            return {
                status: 'ok',
                retcode: 0,
                data: Array.from(this.idStore.toGroupListMap().values())
            }
        }
        return {
            status: 'failed',
            retcode: -1,
            wording: `unsupported_official_action:${name}`,
            message: `unsupported_official_action:${name}`
        }
    }

    getStatus() {
        return {
            ...super.getStatus(),
            connectionState: this.state,
            readyState: this.readyState,
            appId: this.config.qqOfficialAppId,
            token: this.tokenManager.getStatus(),
            gateway: this.gateway.getStatus(),
            rateLimiter: this.rateLimiter.getStatus(),
            idStore: this.idStore.getStatus(),
            messageIdStore: this.messageIdStore.getStatus(),
            recentErrors: this.recentErrors.slice(-10)
        }
    }
}

module.exports = OfficialQqProvider
module.exports.GROUP_AND_C2C_EVENT_INTENT = GROUP_AND_C2C_EVENT_INTENT
