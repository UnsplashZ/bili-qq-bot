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

function hasReplySegment(segments) {
    return segments.some((segment) => segment?.type === 'reply')
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
        hasReply: hasReplySegment(segments),
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
    includesAlias
}
