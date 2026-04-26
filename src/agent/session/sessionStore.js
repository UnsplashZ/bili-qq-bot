const crypto = require('crypto')

const MAX_SESSIONS = 1000

function hash(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10)
}

function normalizeId(value) {
    return value === undefined || value === null ? '' : String(value)
}

function previewText(value, limit = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function buildSessionKey({ groupId, userId, topicId, chatType }) {
    if (chatType === 'private') return `private:${normalizeId(userId)}`
    return `group:${normalizeId(groupId)}:${normalizeId(topicId) || 'general'}`
}

function serializeSession(session, now = Date.now()) {
    return {
        sessionId: session.sessionId,
        key: session.key,
        groupId: session.groupId,
        topicId: session.topicId,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        ageMs: Math.max(0, now - session.startedAt),
        idleMs: Math.max(0, now - session.lastActiveAt),
        messageCount: session.messageCount,
        participants: [...session.participants].slice(-12),
        recentMessageIds: session.recentMessageIds.slice(-12),
        lastUserMessage: session.lastUserMessage,
        lastAgentAction: session.lastAgentAction,
        lastAgentReplyAt: session.lastAgentReplyAt,
        turnsSinceAgentReply: session.turnsSinceAgentReply,
        lastToolName: session.lastToolName
    }
}

class SessionStore {
    constructor() {
        this.sessions = new Map()
    }

    reset() {
        this.sessions.clear()
    }

    getOrCreateSession({ groupId, userId, topicId, chatType, now, idleMs }) {
        this.prune(now, idleMs)
        const key = buildSessionKey({ groupId, userId, topicId, chatType })
        const current = this.sessions.get(key)
        if (current && now - current.lastActiveAt <= idleMs) return current

        const session = {
            sessionId: `sess_${hash(`${key}:${now}`)}`,
            key,
            groupId: normalizeId(groupId),
            topicId: normalizeId(topicId),
            startedAt: now,
            lastActiveAt: now,
            messageCount: 0,
            participants: new Set(),
            recentMessageIds: [],
            lastUserMessage: '',
            lastAgentAction: '',
            lastAgentReplyAt: 0,
            turnsSinceAgentReply: 0,
            lastToolName: ''
        }
        this.sessions.set(key, session)
        return session
    }

    prune(now = Date.now(), idleMs = 30 * 60 * 1000) {
        for (const [key, session] of this.sessions.entries()) {
            if (now - session.lastActiveAt > idleMs * 2) {
                this.sessions.delete(key)
            }
        }
        if (this.sessions.size <= MAX_SESSIONS) return

        const sorted = [...this.sessions.entries()]
            .sort((left, right) => left[1].lastActiveAt - right[1].lastActiveAt)
        const overflow = this.sessions.size - MAX_SESSIONS
        sorted.slice(0, overflow).forEach(([key]) => this.sessions.delete(key))
    }

    observe({ agentMessage, topicSnapshot, options = {} } = {}) {
        const now = agentMessage?.timestamp || Date.now()
        const idleMs = Math.max(60 * 1000, Number(options.topicIdleMs) || 30 * 60 * 1000)
        const groupId = normalizeId(agentMessage?.groupId)
        const userId = normalizeId(agentMessage?.userId)
        const topicId = normalizeId(topicSnapshot?.topicId)
        const chatType = agentMessage?.messageType || 'group'
        const session = this.getOrCreateSession({ groupId, userId, topicId, chatType, now, idleMs })

        session.lastActiveAt = now
        session.messageCount += 1
        if (userId) session.participants.add(userId)
        if (agentMessage?.id) {
            session.recentMessageIds.push(agentMessage.id)
            session.recentMessageIds = session.recentMessageIds.slice(-20)
        }
        session.lastUserMessage = previewText(agentMessage?.normalizedText || agentMessage?.rawText)
        if (session.lastAgentReplyAt > 0) {
            session.turnsSinceAgentReply += 1
        }

        return serializeSession(session, now)
    }

    recordAgentOutcome({ sessionId, action = '', executed = false, toolName = '', timestamp = Date.now() } = {}) {
        if (!sessionId) return null
        const session = [...this.sessions.values()].find((item) => item.sessionId === sessionId)
        if (!session) return null

        if (action) session.lastAgentAction = String(action)
        if (toolName) session.lastToolName = String(toolName)
        if (executed) {
            session.lastAgentReplyAt = timestamp
            session.turnsSinceAgentReply = 0
        }
        return serializeSession(session, timestamp)
    }
}

module.exports = new SessionStore()
module.exports.SessionStore = SessionStore
module.exports._private = {
    buildSessionKey,
    serializeSession
}
