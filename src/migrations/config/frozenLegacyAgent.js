'use strict'

// Frozen copy of the legacy-v0 Agent defaults and effective normalizer. This
// module intentionally imports no runtime config/Agent module, so later schema
// evolution cannot silently change first-adoption results.
const DEFAULT_AGENT_CONFIG = deepFreeze({
    enabled: false,
    observeOnly: true,
    logTrajectory: true,
    defaultGroupEnabled: false,
    decisionMode: 'rule_only',
    sendEnabled: false,
    aliases: [],
    persona: {
        displayName: '群聊 Bot',
        style: '像有分寸的群友一样自然接话；短、口语化、有观点但不抢话。',
        boundaries: 'Bilibili 是主要能力之一，但不是唯一职责；可以参与群聊、技术讨论、Bot 功能讨论和轻松闲聊，违法危险内容保持拒绝。'
    },
    shortTerm: {
        maxRecentMessagesPerGroup: 100,
        topicIdleMs: 1800000,
        crowdedMessagesPerMinute: 8,
        promptRecentMessages: 16,
        promptTopicMessages: 20,
        promptAssistantMessages: 6,
        promptMaxMessages: 32,
        promptMaxCharsPerMessage: 220,
        promptMaxContextChars: 6000
    },
    longTerm: {
        retrieveLimit: 5,
        topicSummaryEnabled: true,
        topicSummaryMinMessages: 6,
        topicSummaryMinIntervalMs: 600000
    },
    replyPolicy: { minReplyScore: 0.65, cooldownMs: 5000 },
    participation: {
        enabled: true,
        timingGateEnabled: true,
        replyerEnabled: true,
        expressionLearningEnabled: false,
        replyEffectTrackingEnabled: false,
        personProfileEnabled: true
    },
    replyer: { maxReactChars: 60, maxReplyChars: 500, allowQuoteReply: true },
    expression: { learningMinMessages: 20, learningMinIntervalMs: 600000 },
    timing: { quietWindowMs: 2500, maxWaitMs: 12000 },
    social: {
        enabled: false,
        mode: 'quiet',
        interjectProbability: 0.18,
        ambientReactProbability: 0.08,
        planningMinScore: 0.3,
        topicAffinityMinScore: 0.8,
        minInterjectScore: 0.72,
        minAmbientScore: 0.62,
        cooldownMs: 90000,
        dailyInterjectLimit: 30,
        perTopicInterjectLimit: 2,
        avoidDuringRapidTwoPersonChat: true,
        maxCasualReplyChars: 120
    },
    tools: { enabled: false, confirmationTtlMs: 60000, requireConfirmationFor: ['medium', 'high'] },
    llm: {
        enabled: false,
        provider: 'openai-compatible',
        baseURL: '',
        model: '',
        apiKeyEnv: 'AGENT_API_KEY',
        timeoutMs: 12000,
        temperature: 0.2,
        maxTokens: 500
    },
    budget: {
        enabled: true,
        windowMs: 60000,
        maxLlmCallsPerGroupPerMinute: 60,
        maxLlmCallsPerUserPerMinute: 20
    },
    groups: {}
})

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mergeDefaults(defaults, input) {
    const output = clone(defaults)
    const raw = isPlainObject(input) ? input : {}
    for (const [key, value] of Object.entries(raw)) {
        output[key] = isPlainObject(output[key]) && isPlainObject(value) ? mergeDefaults(output[key], value) : clone(value)
    }
    return output
}

function number(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return fallback
}

function envValue(env, key, fallback) {
    const value = env[key]
    return value === undefined || value === null || value === '' ? fallback : value
}

function normalizeFrozenLegacyAgent(rawConfig, env = {}) {
    const normalized = mergeDefaults(DEFAULT_AGENT_CONFIG, rawConfig)
    normalized.enabled = Boolean(normalized.enabled)
    normalized.observeOnly = normalized.observeOnly !== false
    normalized.logTrajectory = normalized.logTrajectory !== false
    normalized.defaultGroupEnabled = Boolean(normalized.defaultGroupEnabled)
    normalized.decisionMode = ['rule_only', 'llm_shadow', 'llm_live'].includes(normalized.decisionMode) ? normalized.decisionMode : DEFAULT_AGENT_CONFIG.decisionMode
    normalized.sendEnabled = Boolean(normalized.sendEnabled)
    normalized.aliases = Array.isArray(normalized.aliases) ? normalized.aliases.map((item) => String(item).trim()).filter(Boolean) : []
    normalized.persona = isPlainObject(normalized.persona) ? normalized.persona : clone(DEFAULT_AGENT_CONFIG.persona)
    normalized.persona.displayName = String(normalized.persona.displayName || DEFAULT_AGENT_CONFIG.persona.displayName).trim().slice(0, 80)
    normalized.persona.style = String(normalized.persona.style || DEFAULT_AGENT_CONFIG.persona.style).trim().slice(0, 500)
    normalized.persona.boundaries = String(normalized.persona.boundaries || DEFAULT_AGENT_CONFIG.persona.boundaries).trim().slice(0, 500)
    normalized.groups = isPlainObject(normalized.groups) ? normalized.groups : {}

    const shortTerm = normalized.shortTerm
    shortTerm.maxRecentMessagesPerGroup = Math.max(10, Math.trunc(number(shortTerm.maxRecentMessagesPerGroup, DEFAULT_AGENT_CONFIG.shortTerm.maxRecentMessagesPerGroup)))
    shortTerm.topicIdleMs = Math.max(60000, Math.trunc(number(shortTerm.topicIdleMs, DEFAULT_AGENT_CONFIG.shortTerm.topicIdleMs)))
    shortTerm.crowdedMessagesPerMinute = Math.max(1, Math.trunc(number(shortTerm.crowdedMessagesPerMinute, DEFAULT_AGENT_CONFIG.shortTerm.crowdedMessagesPerMinute)))
    shortTerm.promptRecentMessages = Math.max(4, Math.min(80, Math.trunc(number(shortTerm.promptRecentMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptRecentMessages))))
    shortTerm.promptTopicMessages = Math.max(0, Math.min(80, Math.trunc(number(shortTerm.promptTopicMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptTopicMessages))))
    shortTerm.promptAssistantMessages = Math.max(0, Math.min(40, Math.trunc(number(shortTerm.promptAssistantMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptAssistantMessages))))
    shortTerm.promptMaxMessages = Math.max(8, Math.min(120, Math.trunc(number(shortTerm.promptMaxMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxMessages))))
    shortTerm.promptMaxCharsPerMessage = Math.max(80, Math.min(1000, Math.trunc(number(shortTerm.promptMaxCharsPerMessage, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxCharsPerMessage))))
    shortTerm.promptMaxContextChars = Math.max(1000, Math.min(200000, Math.trunc(number(shortTerm.promptMaxContextChars, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxContextChars))))

    const longTerm = normalized.longTerm
    longTerm.retrieveLimit = Math.max(1, Math.min(10, Math.trunc(number(longTerm.retrieveLimit, DEFAULT_AGENT_CONFIG.longTerm.retrieveLimit))))
    longTerm.topicSummaryEnabled = Boolean(longTerm.topicSummaryEnabled)
    longTerm.topicSummaryMinMessages = Math.max(2, Math.trunc(number(longTerm.topicSummaryMinMessages, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinMessages)))
    longTerm.topicSummaryMinIntervalMs = Math.max(60000, Math.trunc(number(longTerm.topicSummaryMinIntervalMs, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinIntervalMs)))

    normalized.replyPolicy.minReplyScore = Math.min(1, Math.max(0, number(normalized.replyPolicy.minReplyScore, DEFAULT_AGENT_CONFIG.replyPolicy.minReplyScore)))
    normalized.replyPolicy.cooldownMs = Math.max(0, Math.trunc(number(normalized.replyPolicy.cooldownMs, DEFAULT_AGENT_CONFIG.replyPolicy.cooldownMs)))

    const participation = normalized.participation
    participation.enabled = participation.enabled !== false
    participation.timingGateEnabled = participation.timingGateEnabled !== false
    participation.replyerEnabled = participation.replyerEnabled !== false
    participation.expressionLearningEnabled = Boolean(participation.expressionLearningEnabled)
    participation.replyEffectTrackingEnabled = Boolean(participation.replyEffectTrackingEnabled)
    participation.personProfileEnabled = participation.personProfileEnabled !== false

    normalized.replyer.maxReactChars = Math.max(20, Math.min(500, Math.trunc(number(normalized.replyer.maxReactChars, DEFAULT_AGENT_CONFIG.replyer.maxReactChars))))
    normalized.replyer.maxReplyChars = Math.max(80, Math.min(2000, Math.trunc(number(normalized.replyer.maxReplyChars, DEFAULT_AGENT_CONFIG.replyer.maxReplyChars))))
    normalized.replyer.allowQuoteReply = normalized.replyer.allowQuoteReply !== false
    normalized.expression.learningMinMessages = Math.max(6, Math.min(200, Math.trunc(number(normalized.expression.learningMinMessages, DEFAULT_AGENT_CONFIG.expression.learningMinMessages))))
    normalized.expression.learningMinIntervalMs = Math.max(60000, Math.min(86400000, Math.trunc(number(normalized.expression.learningMinIntervalMs, DEFAULT_AGENT_CONFIG.expression.learningMinIntervalMs))))
    normalized.timing.quietWindowMs = Math.max(0, Math.min(60000, Math.trunc(number(normalized.timing.quietWindowMs, DEFAULT_AGENT_CONFIG.timing.quietWindowMs))))
    normalized.timing.maxWaitMs = Math.max(0, Math.min(300000, Math.trunc(number(normalized.timing.maxWaitMs, DEFAULT_AGENT_CONFIG.timing.maxWaitMs))))

    const social = normalized.social
    social.enabled = Boolean(social.enabled)
    social.mode = ['quiet', 'normal', 'active', 'debug'].includes(social.mode) ? social.mode : DEFAULT_AGENT_CONFIG.social.mode
    for (const key of ['interjectProbability', 'ambientReactProbability', 'planningMinScore', 'topicAffinityMinScore', 'minInterjectScore', 'minAmbientScore']) {
        social[key] = Math.min(1, Math.max(0, number(social[key], DEFAULT_AGENT_CONFIG.social[key])))
    }
    social.cooldownMs = Math.max(0, Math.trunc(number(social.cooldownMs, DEFAULT_AGENT_CONFIG.social.cooldownMs)))
    social.dailyInterjectLimit = Math.max(0, Math.trunc(number(social.dailyInterjectLimit, DEFAULT_AGENT_CONFIG.social.dailyInterjectLimit)))
    social.perTopicInterjectLimit = Math.max(0, Math.trunc(number(social.perTopicInterjectLimit, DEFAULT_AGENT_CONFIG.social.perTopicInterjectLimit)))
    social.avoidDuringRapidTwoPersonChat = social.avoidDuringRapidTwoPersonChat !== false
    social.maxCasualReplyChars = Math.max(20, Math.min(500, Math.trunc(number(social.maxCasualReplyChars, DEFAULT_AGENT_CONFIG.social.maxCasualReplyChars))))

    normalized.tools.enabled = Boolean(normalized.tools.enabled)
    normalized.tools.confirmationTtlMs = Math.max(10000, Math.trunc(number(normalized.tools.confirmationTtlMs, DEFAULT_AGENT_CONFIG.tools.confirmationTtlMs)))
    const risks = Array.isArray(normalized.tools.requireConfirmationFor)
        ? normalized.tools.requireConfirmationFor.map((item) => String(item).trim()).filter((item) => ['low', 'medium', 'high'].includes(item))
        : [...DEFAULT_AGENT_CONFIG.tools.requireConfirmationFor]
    normalized.tools.requireConfirmationFor = [...new Set([...risks, 'high'])]

    const llm = normalized.llm
    llm.enabled = bool(env.AGENT_LLM_ENABLED, Boolean(llm.enabled))
    llm.provider = String(envValue(env, 'AGENT_LLM_PROVIDER', llm.provider || DEFAULT_AGENT_CONFIG.llm.provider)).trim()
    llm.baseUrl = String(envValue(env, 'AGENT_LLM_BASE_URL', llm.baseURL || llm.baseUrl || '')).trim()
    llm.model = String(envValue(env, 'AGENT_LLM_MODEL', llm.model || '')).trim()
    const apiKeyEnv = String(envValue(env, 'AGENT_LLM_API_KEY_ENV', llm.apiKeyEnv || 'AGENT_API_KEY')).trim()
    llm.apiKey = String(env[apiKeyEnv] || '').trim()
    llm.timeoutMs = Math.max(1000, Math.trunc(number(envValue(env, 'AGENT_LLM_TIMEOUT_MS', llm.timeoutMs), DEFAULT_AGENT_CONFIG.llm.timeoutMs)))
    llm.temperature = Math.min(2, Math.max(0, number(envValue(env, 'AGENT_LLM_TEMPERATURE', llm.temperature), DEFAULT_AGENT_CONFIG.llm.temperature)))
    llm.maxTokens = Math.max(100, Math.trunc(number(envValue(env, 'AGENT_LLM_MAX_TOKENS', llm.maxTokens), DEFAULT_AGENT_CONFIG.llm.maxTokens)))
    delete llm.baseURL
    delete llm.apiKeyEnv

    const budget = normalized.budget
    budget.enabled = bool(env.AGENT_BUDGET_ENABLED, Boolean(budget.enabled))
    budget.windowMs = Math.max(1000, Math.trunc(number(envValue(env, 'AGENT_BUDGET_WINDOW_MS', budget.windowMs), DEFAULT_AGENT_CONFIG.budget.windowMs)))
    budget.maxLlmCallsPerGroupPerMinute = Math.max(1, Math.trunc(number(envValue(env, 'AGENT_BUDGET_MAX_LLM_CALLS_PER_GROUP_PER_MINUTE', budget.maxLlmCallsPerGroupPerMinute), DEFAULT_AGENT_CONFIG.budget.maxLlmCallsPerGroupPerMinute)))
    budget.maxLlmCallsPerUserPerMinute = Math.max(1, Math.trunc(number(envValue(env, 'AGENT_BUDGET_MAX_LLM_CALLS_PER_USER_PER_MINUTE', budget.maxLlmCallsPerUserPerMinute), DEFAULT_AGENT_CONFIG.budget.maxLlmCallsPerUserPerMinute)))
    return normalized
}

module.exports = { DEFAULT_AGENT_CONFIG, normalizeFrozenLegacyAgent }
