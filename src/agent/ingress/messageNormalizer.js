function segmentText(segment) {
    if (!segment || segment.type !== 'text') return ''
    return String(segment.data?.text || '')
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textifyCqAt(rawText, selfId = '') {
    const normalizedSelfId = String(selfId || '')
    return String(rawText || '').replace(/\[CQ:at,qq=([^\],]+)[^\]]*\]/g, (_, qq) => {
        const normalizedQq = String(qq || '').trim()
        if (!normalizedQq) return ' '
        return normalizedSelfId && normalizedQq === normalizedSelfId ? '@Bot' : `@${normalizedQq}`
    })
}

function textifySegment(segment, selfId = '') {
    if (!segment || typeof segment !== 'object') return ''
    if (segment.type === 'text') return String(segment.data?.text || '')
    if (segment.type === 'at') {
        const qq = String(segment.data?.qq || '').trim()
        if (!qq) return ''
        return selfId && qq === String(selfId) ? '@Bot' : `@${qq}`
    }
    if (segment.type === 'image') return '[图片]'
    if (segment.type === 'face') return '[表情]'
    return ''
}

function buildNormalizedText({ rawText, segments, selfId }) {
    const segmentTextified = Array.isArray(segments)
        ? segments.map((segment) => textifySegment(segment, selfId)).join(' ')
        : ''
    const sourceText = segmentTextified.trim() ? segmentTextified : textifyCqAt(rawText, selfId)
    return sourceText.replace(/\s+/g, ' ').trim()
}

function hasAtSelfSegment(segments, selfId) {
    const normalizedSelfId = String(selfId || '')
    if (!normalizedSelfId) return false
    return segments.some((segment) => (
        segment?.type === 'at' && String(segment.data?.qq || '') === normalizedSelfId
    ))
}

function hasReplySignal({ segments = [], messageData = {} } = {}) {
    if (segments.some((segment) => segment?.type === 'reply')) return true
    return Boolean(messageData?.reply)
}

function extractReplyMessageId({ segments = [], messageData = {} } = {}) {
    for (const segment of segments) {
        if (segment?.type !== 'reply') continue
        const value = segment?.data?.id ?? segment?.data?.message_id ?? segment?.data?.msg_id
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim()
        }
    }

    const fallback = messageData?.reply?.id ?? messageData?.reply?.message_id ?? messageData?.reply?.msg_id
    return fallback !== undefined && fallback !== null ? String(fallback).trim() : ''
}

function includesAlias(text, aliases = []) {
    const normalized = String(text || '').toLowerCase()
    return aliases.some((alias) => normalized.includes(String(alias).toLowerCase()))
}

function normalizeMessage({ rawMessage, messageSegments, messageData, aliases = [] }) {
    const segments = Array.isArray(messageSegments) ? messageSegments : []
    const rawText = rawMessage !== undefined && rawMessage !== null
        ? String(rawMessage)
        : segments.map(segmentText).join('')
    const selfId = messageData?.self_id != null ? String(messageData.self_id) : ''
    const messageId = messageData?.message_id != null ? String(messageData.message_id) : ''
    const groupId = messageData?.group_id != null ? String(messageData.group_id) : ''
    const userId = messageData?.user_id != null ? String(messageData.user_id) : ''
    const cqAtSelfPattern = selfId ? new RegExp(`\\[CQ:at,qq=${escapeRegExp(selfId)}(?:,|\\])`) : null
    const mentionsSelf = hasAtSelfSegment(segments, selfId) || (
        cqAtSelfPattern && cqAtSelfPattern.test(rawText)
    )
    const replyMessageId = extractReplyMessageId({ segments, messageData })
    const normalizedText = buildNormalizedText({ rawText, segments, selfId })

    return {
        id: messageId,
        groupId,
        userId,
        selfId,
        messageType: String(messageData?.message_type || 'group'),
        rawText,
        segments,
        normalizedText,
        mentionsSelf,
        replyToSelf: false,
        hasReply: hasReplySignal({ segments, messageData }),
        replyMessageId,
        aliasMatched: includesAlias(normalizedText || rawText, aliases),
        timestamp: Number(messageData?.time || 0) > 0 ? Number(messageData.time) * 1000 : Date.now(),
        sender: {
            nickname: String(messageData?.sender?.nickname || ''),
            card: String(messageData?.sender?.card || ''),
            role: String(messageData?.sender?.role || 'unknown')
        }
    }
}

module.exports = {
    normalizeMessage,
    includesAlias,
    extractReplyMessageId,
    textifyCqAt,
    textifySegment
}
