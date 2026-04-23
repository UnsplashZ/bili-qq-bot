'use strict'

const config = require('../../config')

class ReplyGateService {
    constructor({ now = () => Date.now() } = {}) {
        this.now = now
        this.groupStates = new Map()
    }

    _getState(groupId) {
        const key = String(groupId || 'unknown')
        if (!this.groupStates.has(key)) {
            this.groupStates.set(key, {
                messageTimestamps: [],
                botReplyTimestamps: [],
                recentBotInteractions: new Map()
            })
        }
        return this.groupStates.get(key)
    }

    _trimState(state, windowMs, interactionMs, now) {
        state.messageTimestamps = state.messageTimestamps.filter(ts => now - ts <= windowMs)
        state.botReplyTimestamps = state.botReplyTimestamps.filter(ts => now - ts <= windowMs)
        for (const [userId, ts] of state.recentBotInteractions.entries()) {
            if (now - ts > interactionMs) {
                state.recentBotInteractions.delete(userId)
            }
        }
    }

    _isQuestionLike(text) {
        return /[?？]|为什么|怎么|如何|咋办|怎么办|要不要|能不能|可以吗|是什么|啥原因|帮我|帮忙|看下|看看/.test(text)
    }

    _isShortNoise(text) {
        const normalized = String(text || '').trim()
        if (!normalized) return true
        if (normalized.length <= 3) return true
        return /^(哈哈+|呵呵+|嗯+|哦+|好吧|行吧|确实|收到|ok|OK)$/.test(normalized)
    }

    evaluate({ groupId, userId, rawMessage, messageMeta = {} }) {
        if (!config.isAiEnabledForGroup(groupId)) {
            return {
                shouldReply: false,
                score: -Infinity,
                busyMode: false,
                triggerLevel: 'disabled',
                reasons: ['ai_disabled']
            }
        }

        const now = this.now()
        const state = this._getState(groupId)
        const busyWindowSeconds = config.getGroupConfig(groupId, 'aiBusyWindowSeconds')
        const busyMessageCount = config.getGroupConfig(groupId, 'aiBusyMessageCount')
        const maxRepliesPerWindow = config.getGroupConfig(groupId, 'aiMaxRepliesPerWindow')
        const replyThreshold = config.getGroupConfig(groupId, 'aiReplyScoreThreshold')
        const busyThreshold = config.getGroupConfig(groupId, 'aiBusyReplyScoreThreshold')
        const windowMs = Number(busyWindowSeconds) * 1000
        const interactionMs = 60 * 1000

        state.messageTimestamps.push(now)
        this._trimState(state, windowMs, interactionMs, now)

        const message = String(rawMessage || '').trim()
        const isPrivate = messageMeta.source === 'private' || String(groupId || '').startsWith('private_')
        const isAtBot = messageMeta.isAtBot === true || messageMeta.currentMentionsBot === true
        const isReplyToBot = messageMeta.isReplyToBot === true
        const hasBotNameHit = !!messageMeta.botNameHit
        const hasRecentInteraction = !!(userId && state.recentBotInteractions.has(String(userId)))
        const busyMode = state.messageTimestamps.length >= Number(busyMessageCount)

        let score = 0
        const reasons = []
        let triggerLevel = 'ambient'

        if (isPrivate) {
            score += 100
            triggerLevel = 'direct'
            reasons.push('private')
        }
        if (isAtBot) {
            score += 100
            triggerLevel = 'direct'
            reasons.push('at_bot')
        }
        if (isReplyToBot) {
            score += 70
            triggerLevel = 'direct'
            reasons.push('reply_to_bot')
        }
        if (hasBotNameHit) {
            score += 35
            if (triggerLevel === 'ambient') triggerLevel = 'direct'
            reasons.push('bot_name_hit')
        }
        if (hasRecentInteraction) {
            score += 25
            if (triggerLevel === 'ambient') triggerLevel = 'followup'
            reasons.push('recent_bot_interaction')
        }
        if (this._isQuestionLike(message)) {
            score += 20
            if (triggerLevel === 'ambient') triggerLevel = hasRecentInteraction ? 'followup' : 'ambient'
            reasons.push('question_like')
        }
        if (this._isShortNoise(message)) {
            score -= 25
            reasons.push('short_noise')
        }
        if (busyMode) {
            score -= 30
            reasons.push('busy_mode')
        }
        if (state.botReplyTimestamps.length >= Number(maxRepliesPerWindow)) {
            score -= 20
            reasons.push('reply_rate_limited')
        }

        const threshold = busyMode ? Number(busyThreshold) : Number(replyThreshold)
        const shouldReply = score >= threshold

        return {
            shouldReply,
            score,
            busyMode,
            triggerLevel,
            reasons
        }
    }

    evaluateAdmission(input) {
        return this.evaluate(input)
    }

    recordBotReply(groupId, userId) {
        const now = this.now()
        const busyWindowSeconds = config.getGroupConfig(groupId, 'aiBusyWindowSeconds')
        const windowMs = Number(busyWindowSeconds) * 1000
        const state = this._getState(groupId)
        state.botReplyTimestamps.push(now)
        if (userId) {
            state.recentBotInteractions.set(String(userId), now)
        }
        this._trimState(state, windowMs, 60 * 1000, now)
    }

    reset() {
        this.groupStates.clear()
    }
}

module.exports = {
    ReplyGateService,
    replyGateService: new ReplyGateService()
}
