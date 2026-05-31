const config = require('../../../config')
const {
    AT_ALL_CAPABILITY_CACHE_TTL_MS,
    AT_ALL_SEND_FAILURE_CACHE_TTL_MS,
    AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE
} = require('./constants')

class UpdateChecker {
    constructor() {
        this.checkInterval = (config.subscriptionCheckInterval || 60) * 1000
        this.syncInterval = 60 * 60 * 1000 // 1 hour
        this.timer = null
        this.syncTimer = null
        this.initTimer = null
        this.initSyncTimer = null
        this.ws = null
        this.credentialRefreshTimer = null
        this.CREDENTIAL_REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 24小时
        this.AT_ALL_CAPABILITY_CACHE_TTL_MS = AT_ALL_CAPABILITY_CACHE_TTL_MS
        this.AT_ALL_SEND_FAILURE_CACHE_TTL_MS = AT_ALL_SEND_FAILURE_CACHE_TTL_MS
        this.AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE = AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE
        this.groupAtAllCapabilityCache = new Map() // groupId -> { canAtAll, expiresAt, reason, retcode }
        this.groupAtAllCapabilityInFlight = new Map() // groupId -> Promise<capability>
        this.groupBotRoleCache = new Map() // groupId -> { role, allowed, expiresAt, reason, retcode }
        this.groupBotRoleInFlight = new Map() // groupId -> Promise<roleState>
        this.cookieSyncFailureState = new Map() // groupId -> retryable/auth failure counters
        this._checkAllInFlight = false
    }
}

module.exports = UpdateChecker
