const crypto = require('crypto')
const config = require('../config')
const logger = require('../utils/logger')
const notificationService = require('./notificationService')

const DEFAULT_EXPIRE_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const RECENTLY_HANDLED_EXPIRE_MS = 24 * 60 * 60 * 1000
const SUPPORTED_GROUP_SUB_TYPES = new Set(['add', 'invite'])

function storeLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:approval', message, fields)
}

class RequestApprovalService {
    constructor() {
        this.pendingByKey = new Map()
        this.queue = []
        this.keyByNotifyMessageId = new Map()
        this.keyByShortId = new Map()
        this.inflightKeys = new Set()
        this.recentlyHandled = new Map()

        this.cleanupTimer = setInterval(() => {
            try {
                this.cleanupExpired()
            } catch (e) {
                storeLog('error', 'cleanup-failed', {
                    error: logger.getErrorMessage(e)
                })
            }
        }, CLEANUP_INTERVAL_MS)

        if (typeof this.cleanupTimer.unref === 'function') {
            this.cleanupTimer.unref()
        }
    }

    _buildKey(requestType, subType, flag) {
        return `${requestType}:${subType || '-'}:${flag}`
    }

    _makeShortIdBase(key) {
        const digest = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 6).toUpperCase()
        return `REQ-${digest}`
    }

    _allocateShortId(key) {
        const base = this._makeShortIdBase(key)
        let candidate = base
        let suffix = 2

        while (this.keyByShortId.has(candidate) && this.keyByShortId.get(candidate) !== key) {
            candidate = `${base}-${suffix}`
            suffix += 1
        }

        this.keyByShortId.set(candidate, key)
        return candidate
    }

    _sanitizeText(text) {
        if (text === undefined || text === null) return ''
        return String(text).trim()
    }

    _normalizeRequestEvent(payload) {
        if (!payload || payload.post_type !== 'request') return null

        const requestType = this._sanitizeText(payload.request_type)
        const subType = this._sanitizeText(payload.sub_type)
        const flag = this._sanitizeText(payload.flag)

        if (!flag) return null

        if (requestType === 'friend') {
            return {
                requestType,
                subType: null,
                flag,
                userId: this._sanitizeText(payload.user_id),
                groupId: null,
                comment: this._sanitizeText(payload.comment),
                rawPayload: payload
            }
        }

        if (requestType === 'group' && SUPPORTED_GROUP_SUB_TYPES.has(subType)) {
            return {
                requestType,
                subType,
                flag,
                userId: this._sanitizeText(payload.user_id),
                groupId: this._sanitizeText(payload.group_id),
                comment: this._sanitizeText(payload.comment),
                rawPayload: payload
            }
        }

        return null
    }

    _cleanupRecentlyHandled(now = Date.now()) {
        for (const [key, expiresAt] of this.recentlyHandled.entries()) {
            if (expiresAt <= now) {
                this.recentlyHandled.delete(key)
            }
        }
    }

    _markRecentlyHandled(key, now = Date.now()) {
        this.recentlyHandled.set(key, now + RECENTLY_HANDLED_EXPIRE_MS)
    }

    _isRecentlyHandled(key, now = Date.now()) {
        this._cleanupRecentlyHandled(now)
        const expiresAt = this.recentlyHandled.get(key)
        return typeof expiresAt === 'number' && expiresAt > now
    }

    _createPendingItem(normalized, now = Date.now()) {
        const key = this._buildKey(normalized.requestType, normalized.subType, normalized.flag)
        return {
            key,
            shortId: normalized.shortId || '',
            requestType: normalized.requestType,
            subType: normalized.subType,
            flag: normalized.flag,
            userId: normalized.userId || '',
            groupId: normalized.groupId || '',
            comment: normalized.comment || '',
            rawPayload: normalized.rawPayload || null,
            createdAt: now,
            expiresAt: now + DEFAULT_EXPIRE_MS,
            status: 'PENDING',
            notifyMessageId: '',
            retryCount: 0,
            lastError: ''
        }
    }

    _removePendingByKey(key) {
        const item = this.pendingByKey.get(key)
        if (item && item.notifyMessageId) {
            this.keyByNotifyMessageId.delete(String(item.notifyMessageId))
        }
        if (item && item.shortId) {
            this.keyByShortId.delete(String(item.shortId))
        }

        this.pendingByKey.delete(key)
        this.inflightKeys.delete(key)
        this.queue = this.queue.filter(k => k !== key)
    }

    _isApprovableStatus(status) {
        return status === 'PENDING' || status === 'FAILED'
    }

    _isItemExpired(item, now = Date.now()) {
        return !item || typeof item.expiresAt !== 'number' || item.expiresAt <= now
    }

    _getApprovablePendingCount() {
        let count = 0
        for (const item of this.pendingByKey.values()) {
            if (this._isApprovableStatus(item.status)) {
                count++
            }
        }
        return count
    }

    _extractReplyMessageId(messageData) {
        const segments = Array.isArray(messageData?.message) ? messageData.message : []
        for (const segment of segments) {
            if (segment?.type !== 'reply') continue
            const rawId = segment?.data?.id ?? segment?.data?.message_id ?? segment?.data?.msg_id
            const replyId = this._sanitizeText(rawId)
            if (replyId) return replyId
        }

        const fallbackReplyId = this._sanitizeText(messageData?.reply?.id ?? messageData?.reply?.message_id)
        return fallbackReplyId || ''
    }

    _parseDecision(rawMessage) {
        if (typeof rawMessage !== 'string') return null

        const stripped = rawMessage
            .replace(/\[CQ:[^\]]+\]/g, ' ')
            .trim()

        if (!stripped) return null

        const tokens = stripped
            .split(/[\s,，。!！、；;:：]+/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)

        if (tokens.length === 0) return null

        for (const token of tokens) {
            if (token === '是' || token === '同意' || token === 'yes' || token === 'y') {
                return 'approve'
            }

            if (token === '否' || token === '拒绝' || token === 'no' || token === 'n') {
                return 'reject'
            }
        }

        return null
    }

    _extractShortId(rawMessage) {
        if (typeof rawMessage !== 'string') return ''
        const stripped = rawMessage.replace(/\[CQ:[^\]]+\]/g, ' ')
        const match = stripped.match(/REQ-[A-Z0-9]+(?:-\d+)?/i)
        if (!match) return ''
        return String(match[0]).toUpperCase()
    }

    _requestTypeLabel(item) {
        if (item.requestType === 'friend') return '好友申请'
        if (item.requestType === 'group' && item.subType === 'add') return '加群申请'
        if (item.requestType === 'group' && item.subType === 'invite') return '邀请入群'
        return '未知申请'
    }

    _snapshotPendingItem(item, now = Date.now()) {
        if (!item) return null

        return {
            key: item.key,
            shortId: item.shortId || '',
            requestType: item.requestType,
            requestTypeLabel: this._requestTypeLabel(item),
            subType: item.subType,
            flag: item.flag,
            userId: item.userId || '',
            groupId: item.groupId || '',
            comment: item.comment || '',
            status: item.status,
            notifyMessageId: item.notifyMessageId || '',
            retryCount: Number(item.retryCount || 0),
            lastError: item.lastError || '',
            createdAt: item.createdAt || null,
            expiresAt: item.expiresAt || null,
            expiresInMs: typeof item.expiresAt === 'number' ? Math.max(0, item.expiresAt - now) : null
        }
    }

    _formatPendingMessage(item, pendingCount) {
        const lines = [
            '收到新的待审批请求',
            `类型：${this._requestTypeLabel(item)}`,
            `编号：${item.shortId || item.key}`,
            `申请人：${item.userId || '未知'}`
        ]

        if (item.groupId) {
            lines.push(`群号：${item.groupId}`)
        }

        if (item.comment) {
            lines.push(`附言：${item.comment}`)
        }

        lines.push('')
        lines.push('请引用本消息回复“是”或“否”进行处理')
        lines.push(`若无法引用，可回复“是 ${item.shortId || item.key}”或“否 ${item.shortId || item.key}”`)
        lines.push(`当前待处理：${pendingCount}`)
        return lines.join('\n')
    }

    _formatDecisionResult(item, decision, actionResult, pendingCount, extraHint = '') {
        const actionLabel = decision === 'approve' ? '同意' : '拒绝'
        const lines = [
            `${actionLabel}成功`,
            `类型：${this._requestTypeLabel(item)}`,
            `编号：${item.shortId || item.key}`
        ]

        if (item.groupId) {
            lines.push(`群号：${item.groupId}`)
        }

        lines.push(`剩余待处理：${pendingCount}`)
        if (extraHint) {
            lines.push(extraHint)
        }
        if (actionResult?.wording) {
            lines.push(`接口回执：${actionResult.wording}`)
        }
        return lines.join('\n')
    }

    async _sendAdminText(ws, adminId, text) {
        if (!adminId) return
        notificationService.sendPrivateMessage(ws, adminId, [{ type: 'text', data: { text } }], 'RequestApproval', true)
    }

    async _sendPendingNotify(ws, adminId, item) {
        const pendingCount = this._getApprovablePendingCount()
        const text = this._formatPendingMessage(item, pendingCount)
        const messageChain = [{ type: 'text', data: { text } }]

        try {
            const response = await notificationService.callAction(
                ws,
                'send_private_msg',
                {
                    user_id: adminId,
                    message: messageChain
                },
                'RequestApproval',
                10000
            )

            const messageId = response?.data?.message_id
            const statusOk = response?.status === 'ok' && (response?.retcode === 0 || response?.retcode === undefined || response?.retcode === null)

            if (!statusOk) {
                const wording = response?.wording || response?.message || 'send_private_msg failed'
                storeLog('warn', 'notify-failed', {
                    key: item.key,
                    shortId: item.shortId,
                    error: wording
                })
                this._sendAdminText(ws, adminId, text)
                return
            }

            if (messageId !== undefined && messageId !== null) {
                const mid = String(messageId)
                item.notifyMessageId = mid
                this.keyByNotifyMessageId.set(mid, item.key)
                storeLog('info', 'notify-sent', {
                    key: item.key,
                    shortId: item.shortId,
                    messageId: mid
                })
                return
            }

            storeLog('warn', 'notify-sent-missing-message-id', {
                key: item.key,
                shortId: item.shortId
            })
            this._sendAdminText(ws, adminId, text)
        } catch (e) {
            storeLog('error', 'notify-failed', {
                key: item.key,
                shortId: item.shortId,
                error: logger.getErrorMessage(e)
            })
            this._sendAdminText(ws, adminId, text)
        }
    }

    _resolveTargetByReplyFirst(messageData, now = Date.now()) {
        const replyMessageId = this._extractReplyMessageId(messageData)
        if (!replyMessageId) {
            return { item: null, reason: 'no_reply' }
        }

        const key = this.keyByNotifyMessageId.get(replyMessageId)
        if (!key) {
            return { item: null, reason: 'reply_not_matched' }
        }

        const item = this.pendingByKey.get(key)
        if (!item) {
            this.keyByNotifyMessageId.delete(replyMessageId)
            return { item: null, reason: 'reply_target_missing' }
        }

        if (this._isItemExpired(item, now)) {
            this._removePendingByKey(item.key)
            return { item: null, reason: 'reply_target_expired' }
        }

        if (!this._isApprovableStatus(item.status)) {
            return { item: null, reason: 'reply_target_processed' }
        }

        return { item, reason: 'reply' }
    }

    _resolveTargetByShortId(messageData, now = Date.now()) {
        const shortId = this._extractShortId(messageData?.raw_message || '')
        if (!shortId) {
            return { item: null, reason: 'no_short_id' }
        }

        const key = this.keyByShortId.get(shortId)
        if (!key) {
            return { item: null, reason: 'short_id_not_found', shortId }
        }

        const item = this.pendingByKey.get(key)
        if (!item) {
            this.keyByShortId.delete(shortId)
            return { item: null, reason: 'short_id_target_missing', shortId }
        }

        if (this._isItemExpired(item, now)) {
            this._removePendingByKey(item.key)
            return { item: null, reason: 'short_id_target_expired', shortId }
        }

        if (!this._isApprovableStatus(item.status)) {
            return { item: null, reason: 'short_id_target_processed', shortId }
        }

        return { item, reason: 'short_id', shortId }
    }

    _resolveTargetItem(messageData, now = Date.now()) {
        const replyResult = this._resolveTargetByReplyFirst(messageData, now)
        if (replyResult.item) {
            return { item: replyResult.item, resolveMode: 'reply', invalidReply: false, invalidShortId: false, shortId: '' }
        }

        const hasReply = replyResult.reason !== 'no_reply'
        if (hasReply) {
            return {
                item: null,
                resolveMode: 'reply',
                invalidReply: true,
                invalidShortId: false,
                shortId: ''
            }
        }

        const shortIdResult = this._resolveTargetByShortId(messageData, now)
        if (shortIdResult.item) {
            return {
                item: shortIdResult.item,
                resolveMode: 'short_id',
                invalidReply: false,
                invalidShortId: false,
                shortId: shortIdResult.shortId || ''
            }
        }

        if (shortIdResult.reason !== 'no_short_id') {
            return {
                item: null,
                resolveMode: 'short_id',
                invalidReply: false,
                invalidShortId: true,
                shortId: shortIdResult.shortId || ''
            }
        }

        return {
            item: null,
            resolveMode: 'none',
            invalidReply: false,
            invalidShortId: false,
            shortId: ''
        }
    }

    _resolveExactTarget({ shortId = '', replyMessageId = '' } = {}, now = Date.now()) {
        const normalizedReplyMessageId = this._sanitizeText(replyMessageId)
        const normalizedShortId = this._sanitizeText(shortId).toUpperCase()

        if (normalizedReplyMessageId) {
            const replyResult = this._resolveTargetByReplyFirst({
                message: [{ type: 'reply', data: { id: normalizedReplyMessageId } }],
                reply: { id: normalizedReplyMessageId }
            }, now)

            if (!replyResult.item) {
                return {
                    item: null,
                    resolveMode: 'reply',
                    status: 'invalid_reply',
                    shortId: normalizedShortId,
                    replyMessageId: normalizedReplyMessageId
                }
            }

            if (!normalizedShortId) {
                return {
                    item: replyResult.item,
                    resolveMode: 'reply',
                    status: 'resolved',
                    shortId: replyResult.item.shortId || '',
                    replyMessageId: normalizedReplyMessageId
                }
            }

            const shortIdResult = this._resolveTargetByShortId({
                raw_message: normalizedShortId
            }, now)

            if (!shortIdResult.item) {
                return {
                    item: null,
                    resolveMode: 'short_id',
                    status: 'invalid_short_id',
                    shortId: normalizedShortId,
                    replyMessageId: normalizedReplyMessageId
                }
            }

            if (shortIdResult.item.key !== replyResult.item.key) {
                return {
                    item: null,
                    resolveMode: 'conflict',
                    status: 'target_conflict',
                    shortId: normalizedShortId,
                    replyMessageId: normalizedReplyMessageId
                }
            }

            return {
                item: replyResult.item,
                resolveMode: 'reply',
                status: 'resolved',
                shortId: normalizedShortId,
                replyMessageId: normalizedReplyMessageId
            }
        }

        if (normalizedShortId) {
            const shortIdResult = this._resolveTargetByShortId({
                raw_message: normalizedShortId
            }, now)

            if (!shortIdResult.item) {
                return {
                    item: null,
                    resolveMode: 'short_id',
                    status: 'invalid_short_id',
                    shortId: normalizedShortId,
                    replyMessageId: ''
                }
            }

            return {
                item: shortIdResult.item,
                resolveMode: 'short_id',
                status: 'resolved',
                shortId: normalizedShortId,
                replyMessageId: ''
            }
        }

        return {
            item: null,
            resolveMode: 'none',
            status: 'missing_target',
            shortId: '',
            replyMessageId: ''
        }
    }

    async _executeDecisionForItem(ws, item, decision, now = Date.now()) {
        if (!item) {
            return {
                ok: false,
                mutation: false,
                status: 'missing_target',
                decision,
                pendingCount: this._getApprovablePendingCount(),
                target: null,
                actionResult: null,
                error: 'missing_target'
            }
        }

        if (this.inflightKeys.has(item.key)) {
            return {
                ok: false,
                mutation: false,
                status: 'inflight',
                decision,
                pendingCount: this._getApprovablePendingCount(),
                target: this._snapshotPendingItem(item, now),
                actionResult: null,
                error: 'inflight'
            }
        }

        this.inflightKeys.add(item.key)
        item.status = 'PROCESSING'

        try {
            const actionResult = await this._applyDecision(ws, item, decision)

            if (actionResult.ok) {
                const target = this._snapshotPendingItem(item, now)
                this._removePendingByKey(item.key)
                this._markRecentlyHandled(item.key, now)

                return {
                    ok: true,
                    mutation: true,
                    status: 'executed',
                    decision,
                    pendingCount: this._getApprovablePendingCount(),
                    target,
                    actionResult,
                    error: ''
                }
            }

            item.status = 'FAILED'
            item.retryCount = Number(item.retryCount || 0) + 1
            item.lastError = actionResult.wording || 'unknown_error'

            return {
                ok: false,
                mutation: false,
                status: 'failed',
                decision,
                pendingCount: this._getApprovablePendingCount(),
                target: this._snapshotPendingItem(item, now),
                actionResult,
                error: item.lastError
            }
        } catch (e) {
            item.status = 'FAILED'
            item.retryCount = Number(item.retryCount || 0) + 1
            item.lastError = e.message || 'unknown_error'

            return {
                ok: false,
                mutation: false,
                status: 'failed',
                decision,
                pendingCount: this._getApprovablePendingCount(),
                target: this._snapshotPendingItem(item, now),
                actionResult: null,
                error: item.lastError
            }
        } finally {
            this.inflightKeys.delete(item.key)
        }
    }

    async _applyDecision(ws, item, decision) {
        const approve = decision === 'approve'
        let action = ''
        let params = {}

        if (item.requestType === 'friend') {
            action = 'set_friend_add_request'
            params = {
                flag: item.flag,
                approve
            }
        } else if (item.requestType === 'group') {
            action = 'set_group_add_request'
            params = {
                flag: item.flag,
                sub_type: item.subType,
                approve
            }
        } else {
            return {
                ok: false,
                wording: 'unsupported_request_type'
            }
        }

        try {
            const response = await notificationService.callAction(ws, action, params, 'RequestApproval', 10000)
            const retcode = response?.retcode
            const ok = response?.status === 'ok' && (retcode === 0 || retcode === undefined || retcode === null)
            return {
                ok,
                retcode: retcode === undefined ? null : retcode,
                wording: response?.wording || response?.message || ''
            }
        } catch (e) {
            return {
                ok: false,
                retcode: null,
                wording: e.message || 'action_call_failed'
            }
        }
    }

    async handleRequestEvent(ws, payload) {
        try {
            const adminId = config.getRootAdminQQ()
            if (!adminId) {
                storeLog('warn', 'request-ignored', {
                    reason: 'admin_missing'
                })
                return
            }

            const normalized = this._normalizeRequestEvent(payload)
            if (!normalized) return

            const now = Date.now()
            const key = this._buildKey(normalized.requestType, normalized.subType, normalized.flag)

            if (this._isRecentlyHandled(key, now)) {
                storeLog('info', 'request-ignored', {
                    key,
                    reason: 'recently_handled'
                })
                return
            }

            const existing = this.pendingByKey.get(key)
            if (existing) {
                existing.comment = normalized.comment || existing.comment
                existing.userId = normalized.userId || existing.userId
                existing.groupId = normalized.groupId || existing.groupId
                existing.rawPayload = normalized.rawPayload || existing.rawPayload
                if (!existing.shortId) {
                    existing.shortId = this._allocateShortId(existing.key)
                } else {
                    this.keyByShortId.set(existing.shortId, existing.key)
                }
                storeLog('info', 'request-duplicate', {
                    key,
                    shortId: existing.shortId,
                    requestType: existing.requestType,
                    subType: existing.subType || ''
                })
                return
            }

            normalized.shortId = this._allocateShortId(key)
            const item = this._createPendingItem(normalized, now)
            this.pendingByKey.set(item.key, item)
            this.queue.push(item.key)
            storeLog('info', 'request-queued', {
                key: item.key,
                shortId: item.shortId,
                requestType: item.requestType,
                subType: item.subType || '',
                groupId: item.groupId,
                userId: item.userId
            })
            await this._sendPendingNotify(ws, adminId, item)
        } catch (e) {
            storeLog('error', 'request-handle-failed', {
                error: logger.getErrorMessage(e)
            })
        }
    }

    async tryHandleAdminDecision(ws, messageData) {
        const userId = messageData?.user_id !== undefined && messageData?.user_id !== null
            ? String(messageData.user_id)
            : ''

        if (!config.isRootAdmin(userId)) return false

        const decision = this._parseDecision(messageData?.raw_message || '')
        if (!decision) return false

        const adminId = config.getRootAdminQQ()
        const now = Date.now()
        this.cleanupExpired(now)

        const { item, resolveMode, invalidReply, invalidShortId, shortId } = this._resolveTargetItem(messageData, now)
        if (!item) {
            if (invalidReply) {
                await this._sendAdminText(ws, adminId, '引用的审批消息不存在、已过期或已处理')
                return true
            }

            if (invalidShortId) {
                await this._sendAdminText(ws, adminId, `编号无效或已失效：${shortId || '未知编号'}`)
                return true
            }

            // 无引用且无编号：不消费，回到普通私聊处理链路
            return false
        }

        const executionResult = await this._executeDecisionForItem(ws, item, decision, now)

        if (executionResult.status === 'inflight') {
            await this._sendAdminText(ws, adminId, `该申请正在处理中，请稍后重试\n编号：${item.shortId || item.key}`)
            return true
        }

        if (executionResult.ok) {
            const extraHint = resolveMode === 'short_id'
                ? '定位方式：编号匹配'
                : ''
            await this._sendAdminText(
                ws,
                adminId,
                this._formatDecisionResult(item, decision, executionResult.actionResult, executionResult.pendingCount, extraHint)
            )
            return true
        }

        await this._sendAdminText(
            ws,
            adminId,
            [
                '审批执行失败',
                `类型：${this._requestTypeLabel(item)}`,
                `编号：${item.shortId || item.key}`,
                `错误：${executionResult.error || executionResult.actionResult?.wording || 'unknown_error'}`,
                '你可以继续引用该条通知并回复“是”或“否”重试'
            ].join('\n')
        )

        return true
    }

    listPendingApprovals(now = Date.now()) {
        this.cleanupExpired(now)

        const items = this.queue
            .map(key => this.pendingByKey.get(key))
            .filter(item => item && this._isApprovableStatus(item.status))
            .map(item => this._snapshotPendingItem(item, now))

        return {
            pendingCount: items.length,
            items
        }
    }

    async handleExactApprovalDecision(ws, { decision, shortId = '', replyMessageId = '', now = Date.now() } = {}) {
        const normalizedDecision = this._sanitizeText(decision).toLowerCase()

        if (normalizedDecision !== 'approve' && normalizedDecision !== 'reject') {
            throw new Error(`Unsupported approval decision: ${decision || '<empty>'}`)
        }

        this.cleanupExpired(now)

        const resolvedTarget = this._resolveExactTarget({ shortId, replyMessageId }, now)

        if (!resolvedTarget.item) {
            return {
                ok: false,
                mutation: false,
                status: resolvedTarget.status,
                decision: normalizedDecision,
                resolveMode: resolvedTarget.resolveMode,
                shortId: resolvedTarget.shortId || '',
                replyMessageId: resolvedTarget.replyMessageId || '',
                pendingCount: this._getApprovablePendingCount(),
                target: null,
                actionResult: null,
                error: resolvedTarget.status
            }
        }

        const executionResult = await this._executeDecisionForItem(ws, resolvedTarget.item, normalizedDecision, now)

        return {
            ...executionResult,
            resolveMode: resolvedTarget.resolveMode,
            shortId: resolvedTarget.shortId || executionResult?.target?.shortId || '',
            replyMessageId: resolvedTarget.replyMessageId || ''
        }
    }

    cleanupExpired(now = Date.now()) {
        this._cleanupRecentlyHandled(now)
        let expiredCount = 0

        for (const [key, item] of this.pendingByKey.entries()) {
            if (this._isItemExpired(item, now)) {
                this._removePendingByKey(key)
                expiredCount++
            }
        }

        if (expiredCount > 0) {
            storeLog('info', 'cleanup-complete', {
                expiredCount
            })
        }
    }
}

module.exports = new RequestApprovalService()
