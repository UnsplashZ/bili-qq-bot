'use strict'

const { escapeTagValue, normalizeId } = require('./messageSanitizerService')

function detectIdentityIntent(text) {
    const rawText = String(text || '').trim().toLowerCase()
    const normalized = rawText.replace(/\s+/g, '')
    const normalizedNoPunc = normalized.replace(/[。！？!?.,，]+$/g, '')
    if (!normalized) return 'general'

    const selfIdentityPatterns = [
        /我是谁/,
        /你知道我是谁/,
        /猜猜我是谁/,
        /^我叫[\u4e00-\u9fa5a-z0-9_-]{1,20}$/
    ]
    if (selfIdentityPatterns.some(re => re.test(normalizedNoPunc))) {
        return 'self_identity'
    }

    if (/^我是(?!来|想|要|在|去|给|帮|正在|准备|测试)[\u4e00-\u9fa5a-z0-9_-]{1,20}$/.test(normalizedNoPunc)) {
        return 'self_identity'
    }

    const botIdentityPatterns = [
        /你是谁/,
        /介绍一下你自己/,
        /介绍下你自己/,
        /介绍你自己/,
        /自我介绍/
    ]
    if (botIdentityPatterns.some(re => re.test(normalized))) {
        return 'bot_identity'
    }

    const adminActionPatterns = [
        /踢出/,
        /踢人/,
        /封禁/,
        /禁言/,
        /拉黑/,
        /移出/,
        /封号/,
        /权限(不足|不够|不行|拒绝|无法|没有|开启|关闭|执行|操作)/,
        /按群规.*(踢|封|禁)/,
        /(执行|处理).*(违规|踢|封|禁)/
    ]
    if (adminActionPatterns.some(re => re.test(normalized))) {
        return 'admin_action'
    }

    return 'general'
}

function getSpeakerId(msg, fallbackUserId = null) {
    const raw = msg?.speakerId || msg?.userId || fallbackUserId
    return normalizeId(raw, '')
}

function getSpeakerName(msg, fallbackName = '用户') {
    return msg?.speakerName || msg?.userName || fallbackName
}

function getMentionIds(msg) {
    if (!Array.isArray(msg?.mentionIds)) return []
    const ids = []
    for (const id of msg.mentionIds) {
        const normalized = normalizeId(id, '')
        if (normalized) ids.push(normalized)
    }
    return [...new Set(ids)]
}

function buildSpeakerTag(msg, fallbackUserId = null, fallbackName = '用户') {
    const speakerId = normalizeId(getSpeakerId(msg, fallbackUserId), 'unknown')
    const speakerName = escapeTagValue(getSpeakerName(msg, fallbackName))
    const mentionIds = getMentionIds(msg)
    const mentionText = mentionIds.length > 0 ? mentionIds.join(',') : 'none'
    return `[speaker_id=${speakerId}][speaker_name=${speakerName}][mentions=${mentionText}]`
}

function buildTurnFacts({ currentMsg, userId, groupId, intentType, botId, ownerId }) {
    const normalizedBotId = normalizeId(botId, 'unknown')
    const normalizedOwnerId = normalizeId(ownerId, 'unknown')
    const currentSpeakerId = normalizeId(getSpeakerId(currentMsg, userId), 'unknown')
    const currentSpeakerName = escapeTagValue(getSpeakerName(currentMsg, '用户'))
    const mentionIds = getMentionIds(currentMsg)
    const currentIsAtBot = currentMsg?.isAtBot === true || (normalizedBotId !== 'unknown' && mentionIds.includes(normalizedBotId))
    const currentIsOwner = normalizedOwnerId !== 'unknown' && currentSpeakerId === normalizedOwnerId
    const source = currentMsg?.source || (String(groupId || '').startsWith('private_') ? 'private' : 'group')

    return `\n[TURN_FACTS]
bot_id=${normalizedBotId}
owner_id=${normalizedOwnerId}
current_speaker_id=${currentSpeakerId}
current_speaker_name=${currentSpeakerName}
current_mention_ids=[${mentionIds.join(',')}]
current_is_at_bot=${currentIsAtBot}
current_is_owner=${currentIsOwner}
intent_type=${intentType}
conversation_source=${source}
[/TURN_FACTS]`
}

function buildAdminNoToolReply() {
    return '这类群管理操作我这边还没有拿到实际执行结果。你可以先用群管理命令或具备权限的客户端执行，我再根据结果继续协助。'
}

function applyAdminActionGuard(reply, intentType, hasToolResult, adminClaimRequiresTool) {
    if (!(adminClaimRequiresTool && intentType === 'admin_action' && !hasToolResult)) {
        return reply
    }
    return buildAdminNoToolReply()
}

module.exports = {
    detectIdentityIntent,
    getSpeakerId,
    getSpeakerName,
    getMentionIds,
    buildSpeakerTag,
    buildTurnFacts,
    buildAdminNoToolReply,
    applyAdminActionGuard
}
