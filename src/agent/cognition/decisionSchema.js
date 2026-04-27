const ALLOWED_ACTIONS = new Set([
    'observe_only',
    'react_only',
    'short_reply',
    'full_reply',
    'ask_clarify',
    'casual_interject',
    'ambient_react',
    'tool_plan',
    'defer'
])

const ALLOWED_REPLY_STYLES = new Set([
    'none',
    'friendly_brief',
    'explain',
    'clarify',
    'serious',
    'casual',
    'casual_opinion',
    'ambient'
])

function extractJsonObject(text) {
    const raw = String(text || '').trim()
    if (!raw) throw new Error('empty_decision_text')

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fenced ? fenced[1].trim() : raw
    const start = candidate.indexOf('{')
    if (start < 0) throw new Error('decision_json_object_not_found')

    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < candidate.length; index += 1) {
        const char = candidate[index]
        if (escaped) {
            escaped = false
            continue
        }
        if (char === '\\') {
            escaped = true
            continue
        }
        if (char === '"') {
            inString = !inString
            continue
        }
        if (inString) continue
        if (char === '{') depth += 1
        if (char === '}') {
            depth -= 1
            if (depth === 0) return candidate.slice(start, index + 1)
        }
    }
    throw new Error('decision_json_object_not_found')
}

function parseDecisionJson(text) {
    return JSON.parse(extractJsonObject(text))
}

function clampConfidence(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.min(1, Math.max(0, parsed))
}

function normalizeString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback
}

function normalizeDecision(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('decision_not_object')
    }

    const action = normalizeString(input.action, 'observe_only')
    if (!ALLOWED_ACTIONS.has(action)) {
        throw new Error(`invalid_decision_action:${action}`)
    }

    const replyStyle = normalizeString(input.replyStyle, action === 'observe_only' ? 'none' : 'friendly_brief')
    const normalizedReplyStyle = ALLOWED_REPLY_STYLES.has(replyStyle) ? replyStyle : 'none'
    let replyDraft = normalizeString(input.replyDraft, '')

    if (['observe_only', 'defer'].includes(action)) {
        replyDraft = ''
    }
    if (replyDraft.length > 500) {
        replyDraft = `${replyDraft.slice(0, 497)}...`
    }

    return {
        action,
        confidence: clampConfidence(input.confidence),
        reason: normalizeString(input.reason, ''),
        topic: normalizeString(input.topic, 'unknown'),
        replyStyle: normalizedReplyStyle,
        replyDraft,
        memoryHints: Array.isArray(input.memoryHints) ? input.memoryHints.slice(0, 5) : [],
        toolIntent: input.toolIntent && typeof input.toolIntent === 'object' ? input.toolIntent : null,
        social: input.social && typeof input.social === 'object' && !Array.isArray(input.social) ? input.social : null
    }
}

function fallbackDecision(reason) {
    return {
        action: 'observe_only',
        confidence: 0,
        reason,
        topic: 'unknown',
        replyStyle: 'none',
        replyDraft: '',
        memoryHints: [],
        toolIntent: null
    }
}

module.exports = {
    ALLOWED_ACTIONS,
    parseDecisionJson,
    normalizeDecision,
    fallbackDecision,
    extractJsonObject
}
