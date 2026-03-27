'use strict'

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

function buildBotFacts({ bot = {}, botName = '', botAliases = [], ownerId, turnMeta = {} } = {}) {
    const runtimeBot = bot || {}
    const resolvedBotName = String(runtimeBot.nickname || botName || '').trim()

    return {
        botId: normalizeId(runtimeBot.selfId),
        botName: resolvedBotName,
        botAliases: normalizeAliases(botAliases),
        ownerId: normalizeId(ownerId),
        currentMentionsBot: turnMeta.currentMentionsBot === true,
        currentReplyToBot: turnMeta.isReplyToBot === true
    }
}

module.exports = {
    buildBotFacts
}
