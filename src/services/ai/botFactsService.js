'use strict'

const config = require('../../config')

function normalizeId(value, fallback = 'unknown') {
    const raw = String(value ?? '').trim()
    return raw || fallback
}

function normalizeAliases(value) {
    if (!Array.isArray(value)) return []
    const normalized = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const trimmed = item.trim()
        if (!trimmed) continue
        if (!normalized.includes(trimmed)) {
            normalized.push(trimmed)
        }
    }
    return normalized
}

function buildBotFacts(groupId, turnMeta = {}) {
    const runtimeBot = global.bot || {}
    const configuredBotName = String(config.getGroupConfig(groupId, 'aiBotName') || '').trim()
    const botName = String(runtimeBot.nickname || configuredBotName || '').trim()

    return {
        botId: normalizeId(runtimeBot.selfId),
        botName,
        botAliases: normalizeAliases(config.getGroupConfig(groupId, 'aiBotAliases')),
        ownerId: normalizeId(config.getRootAdminQQ()),
        currentMentionsBot: turnMeta.currentMentionsBot === true,
        currentReplyToBot: turnMeta.isReplyToBot === true
    }
}

module.exports = {
    buildBotFacts
}
