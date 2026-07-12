function normalizeContent(content) {
    return String(content || '').replace(/\r\n/g, '\n')
}

function stripLeadingBotMention(content, selfId = '') {
    let text = normalizeContent(content)
    const original = text
    const escapedSelfId = String(selfId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (escapedSelfId) {
        text = text.replace(new RegExp(`^\\s*(?:<@!?${escapedSelfId}>|@${escapedSelfId})\\s*`, 'i'), '')
    }
    text = text.replace(/^\s*(?:<@!?[^>]+>|@[^\s]+\s*)\s*/, '')
    return {
        content: text || original,
        mentionedSelf: text !== original
    }
}

function normalizeMessageContent(data = {}, eventType = '', selfId = '') {
    const content = normalizeContent(data.content)
    if (eventType !== 'GROUP_AT_MESSAGE_CREATE') {
        return { content, mentionedSelf: false }
    }
    return stripLeadingBotMention(content, selfId)
}

function buildMessageSegments(data = {}, options = {}) {
    const segments = []
    if (options.mentionedSelf) {
        segments.push({ type: 'at', data: { qq: String(options.selfId || 'all') } })
    }
    const content = normalizeContent(options.content !== undefined ? options.content : data.content)
    if (content) {
        segments.push({ type: 'text', data: { text: content } })
    }
    const attachments = Array.isArray(data.attachments) ? data.attachments : []
    for (const item of attachments) {
        const url = item.url || item.file_url || item.fileUrl
        const contentType = String(item.content_type || item.contentType || '').toLowerCase()
        if (!url) continue
        if (contentType.startsWith('image/')) {
            segments.push({ type: 'image', data: { file: url, url } })
        } else if (contentType.startsWith('video/')) {
            segments.push({ type: 'video', data: { file: url, url } })
        }
    }
    return segments
}

function resolveUserOpenId(data = {}) {
    return data.author?.user_openid ||
        data.author?.openid ||
        data.user_openid ||
        data.openid ||
        ''
}

function resolveMemberOpenId(data = {}) {
    return data.author?.member_openid ||
        data.member_openid ||
        data.member?.member_openid ||
        data.memberOpenid ||
        data.memberOpenId ||
        ''
}

function resolveGroupOpenId(data = {}) {
    return data.group_openid || data.group_id || data.groupOpenid || data.groupOpenId || ''
}

function mapMessageEvent(event) {
    const data = event.d || {}
    const type = event.t || ''
    const groupOpenId = resolveGroupOpenId(data)
    const userOpenId = resolveUserOpenId(data)
    const memberOpenId = resolveMemberOpenId(data)
    const messageId = String(data.id || data.msg_id || data.message_id || event.id || '')
    const normalizedContent = normalizeMessageContent(data, type, event.selfId || '')
    const rawMessage = normalizedContent.content
    const messageType = type === 'C2C_MESSAGE_CREATE' ? 'private' : 'group'
    const actorOpenId = messageType === 'private' ? userOpenId : (memberOpenId || userOpenId)
    const payload = {
        post_type: 'message',
        message_type: messageType,
        sub_type: 'normal',
        time: data.timestamp ? Math.floor(new Date(data.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
        self_id: event.selfId || '',
        user_id: actorOpenId,
        group_id: messageType === 'group' ? groupOpenId : undefined,
        message_id: messageId,
        raw_message: rawMessage,
        message: buildMessageSegments(data, {
            content: rawMessage,
            mentionedSelf: normalizedContent.mentionedSelf || type === 'GROUP_AT_MESSAGE_CREATE',
            selfId: event.selfId || ''
        }),
        sender: {
            user_id: actorOpenId,
            nickname: data.author?.nickname || data.author?.member_name || '',
            card: data.author?.member_name || '',
            role: data.member?.role || data.author?.member_role || data.author?.role || 'member'
        },
        official: {
            eventId: event.id || data.event_id || '',
            eventType: type,
            msgId: messageId,
            msgSeq: data.msg_seq ?? null,
            groupOpenId,
            memberOpenId,
            userOpenId,
            raw: data
        }
    }
    return payload
}

function mapGroupRobotEvent(event, noticeType) {
    const data = event.d || {}
    const groupOpenId = resolveGroupOpenId(data)
    return {
        post_type: 'notice',
        notice_type: noticeType,
        sub_type: noticeType === 'group_decrease' ? 'kick_me' : 'approve',
        self_id: event.selfId || '',
        group_id: groupOpenId,
        user_id: event.selfId || '',
        operator_id: '',
        time: Math.floor(Date.now() / 1000),
        official: {
            eventId: event.id || '',
            eventType: event.t || '',
            groupOpenId,
            raw: data
        }
    }
}

function mapReachabilityEvent(event, reachable) {
    const data = event.d || {}
    const groupOpenId = resolveGroupOpenId(data)
    return {
        post_type: 'notice',
        notice_type: 'group_reachability',
        group_id: groupOpenId,
        self_id: event.selfId || '',
        reachable,
        reason: reachable ? 'GROUP_MSG_RECEIVE' : 'GROUP_MSG_REJECT',
        time: Math.floor(Date.now() / 1000),
        official: {
            eventId: event.id || '',
            eventType: event.t || '',
            groupOpenId,
            raw: data
        }
    }
}

function mapOfficialEvent(event, options = {}) {
    const normalized = {
        ...event,
        selfId: options.selfId || event.selfId || ''
    }
    const type = normalized.t || ''
    if (['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'].includes(type)) {
        return mapMessageEvent(normalized)
    }
    if (type === 'GROUP_ADD_ROBOT') return mapGroupRobotEvent(normalized, 'group_increase')
    if (type === 'GROUP_DEL_ROBOT') return mapGroupRobotEvent(normalized, 'group_decrease')
    if (type === 'GROUP_MSG_RECEIVE') return mapReachabilityEvent(normalized, true)
    if (type === 'GROUP_MSG_REJECT') return mapReachabilityEvent(normalized, false)
    return null
}

module.exports = {
    mapOfficialEvent,
    buildMessageSegments,
    normalizeMessageContent,
    stripLeadingBotMention,
    resolveUserOpenId,
    resolveMemberOpenId,
    resolveGroupOpenId
}
