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
        this.onEvent = null
        this.state = 'created'
        this.idStore = options.idStore || new OfficialIdStore({
            storagePath: path.join(process.cwd(), 'data', 'qq-official-id-store.json')
        })
        this.messageIdStore = options.messageIdStore || new OfficialMessageIdStore()
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

    async start(options = {}) {
        this.onEvent = options.onEvent || null
        this.state = 'starting'
        global.bot = global.bot || { groupList: new Map(), selfId: '0' }
        global.bot.selfId = this.selfId || 'official'
        global.bot.nickname = global.bot.nickname || 'QQ Official Bot'
        global.bot.ws = null
        global.bot.groupList = this.idStore.toGroupListMap()
        await this.tokenManager.getAccessToken()
        await this.gateway.start()
        return this
    }

    async stop() {
        this.gateway.stop()
        this.rateLimiter.stop()
        try {
            this.idStore.flush()
        } catch (error) {
            this.recordError(error, 'id_store_flush')
        }
        this.state = 'stopped'
    }

    updateGroupList() {
        global.bot = global.bot || {}
        global.bot.groupList = this.idStore.toGroupListMap()
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
