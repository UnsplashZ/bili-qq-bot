function segmentText(segment) {
    if (!segment || segment.type !== 'text') return ''
    return String(segment.data?.text || '')
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
    const mentionsSelf = hasAtSelfSegment(segments, selfId) || (
        selfId && new RegExp(`\\[CQ:at,qq=${selfId}\\]`).test(rawText)
    )
    const replyMessageId = extractReplyMessageId({ segments, messageData })

    return {
        id: messageId,
        groupId,
        userId,
        selfId,
        messageType: String(messageData?.message_type || 'group'),
        rawText,
        segments,
        normalizedText: rawText.replace(/\s+/g, ' ').trim(),
        mentionsSelf,
        replyToSelf: false,
        hasReply: hasReplySignal({ segments, messageData }),
        replyMessageId,
        aliasMatched: includesAlias(rawText, aliases),
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
    extractReplyMessageId
}
