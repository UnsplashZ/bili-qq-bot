const PARTICIPATION_ACTIONS = new Set(['listen', 'wait', 'react', 'reply', 'act'])
const ALLOWED_ACTIONS = new Set([...PARTICIPATION_ACTIONS])
const SENDABLE_PARTICIPATION_ACTIONS = new Set(['react', 'reply'])

const LEGACY_TO_PARTICIPATION_ACTION = {
    observe_only: 'listen',
    defer: 'wait',
    react_only: 'react',
    casual_interject: 'react',
    ambient_react: 'react',
    short_reply: 'reply',
    full_reply: 'reply',
    ask_clarify: 'reply',
    tool_plan: 'act'
}

const PARTICIPATION_TO_LEGACY_ACTION = {
    listen: 'observe_only',
    wait: 'defer',
    react: 'casual_interject',
    reply: 'short_reply',
    act: 'tool_plan'
}

const ALLOWED_RELATIONS = new Set(['direct', 'mentioned', 'ambient', 'unrelated'])
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

function normalizeStringArray(value, limit = 5) {
    return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
        : []
}

function normalizeAction(value) {
    const rawAction = normalizeString(value, 'listen')
    const action = LEGACY_TO_PARTICIPATION_ACTION[rawAction] || rawAction
    return PARTICIPATION_ACTIONS.has(action) ? action : ''
}

function normalizeParticipation(input, fallbackAction) {
    const raw = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {}
    const action = normalizeAction(raw.action) || fallbackAction || 'listen'
    const relation = normalizeString(raw.relation, '')
    return {
        action,
        targetMessageId: normalizeString(raw.targetMessageId, ''),
        topic: normalizeString(raw.topic, ''),
        relation: ALLOWED_RELATIONS.has(relation) ? relation : 'unrelated',
        participationLevel: clampConfidence(raw.participationLevel),
        reason: normalizeString(raw.reason, ''),
        styleHints: normalizeStringArray(raw.styleHints, 5),
        toolPlan: raw.toolPlan && typeof raw.toolPlan === 'object' && !Array.isArray(raw.toolPlan)
            ? raw.toolPlan
            : null
    }
}

function normalizeDecision(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('decision_not_object')
    }

    const action = normalizeAction(input.action)
    if (!action) {
        throw new Error(`invalid_decision_action:${input.action || ''}`)
    }

    const participation = normalizeParticipation(input.participation, action)
    participation.action = action
    if (!participation.targetMessageId && input.targetMessageId) {
        participation.targetMessageId = normalizeString(input.targetMessageId, '')
    }
    if (!participation.topic && input.topic) {
        participation.topic = normalizeString(input.topic, '')
    }
    if (!participation.reason && input.reason) {
        participation.reason = normalizeString(input.reason, '')
    }
    if (participation.styleHints.length === 0) {
        participation.styleHints = normalizeStringArray(input.styleHints, 5)
    }

    const replyStyle = normalizeString(input.replyStyle, action === 'listen' || action === 'wait' || action === 'act' ? 'none' : 'friendly_brief')
    const normalizedReplyStyle = ALLOWED_REPLY_STYLES.has(replyStyle) ? replyStyle : 'none'
    let replyDraft = normalizeString(input.replyDraft, '')
    if (['listen', 'wait', 'act'].includes(action)) {
        replyDraft = ''
    }
    if (replyDraft.length > 500) {
        replyDraft = `${replyDraft.slice(0, 497)}...`
    }

    const toolIntent = input.toolIntent && typeof input.toolIntent === 'object' && !Array.isArray(input.toolIntent)
        ? input.toolIntent
        : (participation.toolPlan && action === 'act' ? participation.toolPlan : null)

    return {
        action,
        confidence: clampConfidence(input.confidence ?? participation.participationLevel),
        reason: normalizeString(input.reason || participation.reason, ''),
        topic: normalizeString(input.topic || participation.topic, 'unknown'),
        replyStyle: normalizedReplyStyle,
        replyDraft,
        participation,
        targetMessageId: normalizeString(input.targetMessageId || participation.targetMessageId, ''),
        styleHints: normalizeStringArray(input.styleHints || participation.styleHints, 5),
        memoryHints: Array.isArray(input.memoryHints) ? input.memoryHints.slice(0, 5) : [],
        toolIntent,
        social: input.social && typeof input.social === 'object' && !Array.isArray(input.social) ? input.social : null
    }
}

function fallbackDecision(reason) {
    return {
        action: 'listen',
        confidence: 0,
        reason,
        topic: 'unknown',
        replyStyle: 'none',
        replyDraft: '',
        participation: {
            action: 'listen',
            targetMessageId: '',
            topic: 'unknown',
            relation: 'unrelated',
            participationLevel: 0,
            reason,
            styleHints: [],
            toolPlan: null
        },
        targetMessageId: '',
        styleHints: [],
        memoryHints: [],
        toolIntent: null
    }
}

module.exports = {
    ALLOWED_ACTIONS,
    PARTICIPATION_ACTIONS,
    SENDABLE_PARTICIPATION_ACTIONS,
    LEGACY_TO_PARTICIPATION_ACTION,
    PARTICIPATION_TO_LEGACY_ACTION,
    parseDecisionJson,
    normalizeDecision,
    fallbackDecision,
    extractJsonObject,
    normalizeAction
}
