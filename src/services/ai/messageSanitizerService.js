'use strict'

function sanitizeMessage(content) {
    if (!content) return ''
    let sanitized = String(content)
    sanitized = sanitized.replace(/\[CQ:at,qq=(\d+)\]/g, ' <AT:$1> ')
    sanitized = sanitized.replace(/\[CQ:at,qq=all\]/g, ' <AT:all> ')
    sanitized = sanitized.replace(/\[CQ:image,[^\]]+\]/g, ' [图片] ')
    sanitized = sanitized.replace(/\[CQ:[^\]]+\]/g, '')
    sanitized = sanitized.replace(/\[系统.*?\]|<system.*?>|<\/system>/gi, '')
    sanitized = sanitized.replace(/\[System.*?\]|<SYSTEM.*?>|<\/SYSTEM>/gi, '')
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n')
    return sanitized.trim()
}

function markUserMessage(content) {
    const sanitized = sanitizeMessage(content)
    if (!sanitized) return ''
    return sanitized
        .split('\n')
        .map((line) => {
            const normalized = line.replace(/^\s*>+\s?/, '')
            return `> ${normalized.trimEnd()}`
        })
        .join('\n')
}

function sanitizeName(userId) {
    if (!userId) return undefined
    return `user_${String(userId)}`
}

function escapeTagValue(value, maxLen = 64) {
    const raw = String(value ?? '')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[\[\]]/g, ' ')
        .replace(/[<>]/g, '')
        .trim()
    if (!raw) return 'unknown'
    return raw.slice(0, maxLen)
}

function normalizeId(value, fallback = 'unknown') {
    const raw = String(value ?? '').trim()
    if (!raw) return fallback
    if (/^\d+$/.test(raw)) return raw
    if (/^(all|assistant|unknown)$/i.test(raw)) return raw.toLowerCase()
    return fallback
}

module.exports = {
    sanitizeMessage,
    markUserMessage,
    sanitizeName,
    escapeTagValue,
    normalizeId
}
