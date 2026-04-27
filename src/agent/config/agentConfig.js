const { DEFAULT_AGENT_CONFIG } = require('../../config/schema')
const config = require('../../config')

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
}

function mergeDefaults(defaults, input) {
    const output = clone(defaults)
    const raw = isPlainObject(input) ? input : {}

    Object.keys(raw).forEach((key) => {
        if (isPlainObject(output[key]) && isPlainObject(raw[key])) {
            output[key] = mergeDefaults(output[key], raw[key])
            return
        }
        output[key] = raw[key]
    })

    return output
}

function parseNumber(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function parseBoolean(value, fallback = false) {
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

function getRawAgentConfig() {
    return Object.prototype.hasOwnProperty.call(config._overrides, 'agent')
        ? config._overrides.agent
        : undefined
}

function normalizeAgentConfig(rawConfig = getRawAgentConfig()) {
    const normalized = mergeDefaults(DEFAULT_AGENT_CONFIG, rawConfig)

    normalized.enabled = Boolean(normalized.enabled)
    normalized.observeOnly = normalized.observeOnly !== false
    normalized.logTrajectory = normalized.logTrajectory !== false
    normalized.defaultGroupEnabled = Boolean(normalized.defaultGroupEnabled)
    normalized.decisionMode = ['rule_only', 'llm_shadow', 'llm_live'].includes(normalized.decisionMode)
        ? normalized.decisionMode
        : DEFAULT_AGENT_CONFIG.decisionMode
    normalized.sendEnabled = Boolean(normalized.sendEnabled)
    normalized.aliases = Array.isArray(normalized.aliases)
        ? normalized.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : []
    normalized.persona = isPlainObject(normalized.persona) ? normalized.persona : clone(DEFAULT_AGENT_CONFIG.persona)
    normalized.persona.displayName = String(normalized.persona.displayName || DEFAULT_AGENT_CONFIG.persona.displayName).trim().slice(0, 80)
    normalized.persona.style = String(normalized.persona.style || DEFAULT_AGENT_CONFIG.persona.style).trim().slice(0, 500)
    normalized.persona.boundaries = String(normalized.persona.boundaries || DEFAULT_AGENT_CONFIG.persona.boundaries).trim().slice(0, 500)
    normalized.groups = isPlainObject(normalized.groups) ? normalized.groups : {}

    const shortTerm = normalized.shortTerm
    shortTerm.maxRecentMessagesPerGroup = Math.max(10, Math.trunc(parseNumber(shortTerm.maxRecentMessagesPerGroup, DEFAULT_AGENT_CONFIG.shortTerm.maxRecentMessagesPerGroup)))
    shortTerm.topicIdleMs = Math.max(60 * 1000, Math.trunc(parseNumber(shortTerm.topicIdleMs, DEFAULT_AGENT_CONFIG.shortTerm.topicIdleMs)))
    shortTerm.crowdedMessagesPerMinute = Math.max(1, Math.trunc(parseNumber(shortTerm.crowdedMessagesPerMinute, DEFAULT_AGENT_CONFIG.shortTerm.crowdedMessagesPerMinute)))
    shortTerm.promptRecentMessages = Math.max(4, Math.min(80, Math.trunc(parseNumber(shortTerm.promptRecentMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptRecentMessages))))
    shortTerm.promptTopicMessages = Math.max(0, Math.min(80, Math.trunc(parseNumber(shortTerm.promptTopicMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptTopicMessages))))
    shortTerm.promptAssistantMessages = Math.max(0, Math.min(40, Math.trunc(parseNumber(shortTerm.promptAssistantMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptAssistantMessages))))
    shortTerm.promptMaxMessages = Math.max(8, Math.min(120, Math.trunc(parseNumber(shortTerm.promptMaxMessages, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxMessages))))
    shortTerm.promptMaxCharsPerMessage = Math.max(80, Math.min(1000, Math.trunc(parseNumber(shortTerm.promptMaxCharsPerMessage, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxCharsPerMessage))))
    shortTerm.promptMaxContextChars = Math.max(1000, Math.min(200000, Math.trunc(parseNumber(shortTerm.promptMaxContextChars, DEFAULT_AGENT_CONFIG.shortTerm.promptMaxContextChars))))

    const longTerm = normalized.longTerm
    longTerm.retrieveLimit = Math.max(1, Math.min(10, Math.trunc(parseNumber(longTerm.retrieveLimit, DEFAULT_AGENT_CONFIG.longTerm.retrieveLimit))))
    longTerm.topicSummaryEnabled = Boolean(longTerm.topicSummaryEnabled)
    longTerm.topicSummaryMinMessages = Math.max(2, Math.trunc(parseNumber(longTerm.topicSummaryMinMessages, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinMessages)))
    longTerm.topicSummaryMinIntervalMs = Math.max(60 * 1000, Math.trunc(parseNumber(longTerm.topicSummaryMinIntervalMs, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinIntervalMs)))

    const replyPolicy = normalized.replyPolicy
    replyPolicy.minReplyScore = Math.min(1, Math.max(0, parseNumber(replyPolicy.minReplyScore, DEFAULT_AGENT_CONFIG.replyPolicy.minReplyScore)))
    replyPolicy.cooldownMs = Math.max(0, Math.trunc(parseNumber(replyPolicy.cooldownMs, DEFAULT_AGENT_CONFIG.replyPolicy.cooldownMs)))

    const participation = normalized.participation
    participation.enabled = participation.enabled !== false
    participation.timingGateEnabled = participation.timingGateEnabled !== false
    participation.replyerEnabled = participation.replyerEnabled !== false
    participation.expressionLearningEnabled = Boolean(participation.expressionLearningEnabled)
    participation.replyEffectTrackingEnabled = Boolean(participation.replyEffectTrackingEnabled)

    const replyer = normalized.replyer
    replyer.maxReactChars = Math.max(20, Math.min(500, Math.trunc(parseNumber(replyer.maxReactChars, DEFAULT_AGENT_CONFIG.replyer.maxReactChars))))
    replyer.maxReplyChars = Math.max(80, Math.min(2000, Math.trunc(parseNumber(replyer.maxReplyChars, DEFAULT_AGENT_CONFIG.replyer.maxReplyChars))))
    replyer.allowQuoteReply = replyer.allowQuoteReply !== false

    const timing = normalized.timing
    timing.quietWindowMs = Math.max(0, Math.min(60 * 1000, Math.trunc(parseNumber(timing.quietWindowMs, DEFAULT_AGENT_CONFIG.timing.quietWindowMs))))
    timing.maxWaitMs = Math.max(0, Math.min(5 * 60 * 1000, Math.trunc(parseNumber(timing.maxWaitMs, DEFAULT_AGENT_CONFIG.timing.maxWaitMs))))

    const social = normalized.social
    social.enabled = Boolean(social.enabled)
    social.mode = ['quiet', 'normal', 'active', 'debug'].includes(social.mode) ? social.mode : DEFAULT_AGENT_CONFIG.social.mode
    social.interjectProbability = Math.min(1, Math.max(0, parseNumber(social.interjectProbability, DEFAULT_AGENT_CONFIG.social.interjectProbability)))
    social.ambientReactProbability = Math.min(1, Math.max(0, parseNumber(social.ambientReactProbability, DEFAULT_AGENT_CONFIG.social.ambientReactProbability)))
    social.minInterjectScore = Math.min(1, Math.max(0, parseNumber(social.minInterjectScore, DEFAULT_AGENT_CONFIG.social.minInterjectScore)))
    social.minAmbientScore = Math.min(1, Math.max(0, parseNumber(social.minAmbientScore, DEFAULT_AGENT_CONFIG.social.minAmbientScore)))
    social.cooldownMs = Math.max(0, Math.trunc(parseNumber(social.cooldownMs, DEFAULT_AGENT_CONFIG.social.cooldownMs)))
    social.dailyInterjectLimit = Math.max(0, Math.trunc(parseNumber(social.dailyInterjectLimit, DEFAULT_AGENT_CONFIG.social.dailyInterjectLimit)))
    social.perTopicInterjectLimit = Math.max(0, Math.trunc(parseNumber(social.perTopicInterjectLimit, DEFAULT_AGENT_CONFIG.social.perTopicInterjectLimit)))
    social.avoidDuringRapidTwoPersonChat = social.avoidDuringRapidTwoPersonChat !== false
    social.maxCasualReplyChars = Math.max(20, Math.min(500, Math.trunc(parseNumber(social.maxCasualReplyChars, DEFAULT_AGENT_CONFIG.social.maxCasualReplyChars))))

    const tools = normalized.tools
    tools.enabled = Boolean(tools.enabled)
    tools.confirmationTtlMs = Math.max(10 * 1000, Math.trunc(parseNumber(tools.confirmationTtlMs, DEFAULT_AGENT_CONFIG.tools.confirmationTtlMs)))
    const requiredRisks = Array.isArray(tools.requireConfirmationFor)
        ? tools.requireConfirmationFor
            .map((risk) => String(risk).trim())
            .filter((risk) => ['low', 'medium', 'high'].includes(risk))
        : [...DEFAULT_AGENT_CONFIG.tools.requireConfirmationFor]
    tools.requireConfirmationFor = [...new Set([...requiredRisks, 'high'])]

    const llm = normalized.llm
    llm.enabled = parseBoolean(process.env.AGENT_LLM_ENABLED, Boolean(llm.enabled))
    llm.provider = String(envValue(process.env, 'AGENT_LLM_PROVIDER', llm.provider || DEFAULT_AGENT_CONFIG.llm.provider)).trim()
    llm.baseURL = String(envValue(process.env, 'AGENT_LLM_BASE_URL', llm.baseURL || '')).trim()
    llm.model = String(envValue(process.env, 'AGENT_LLM_MODEL', llm.model || '')).trim()
    llm.apiKeyEnv = String(envValue(process.env, 'AGENT_LLM_API_KEY_ENV', llm.apiKeyEnv || DEFAULT_AGENT_CONFIG.llm.apiKeyEnv)).trim()
    llm.timeoutMs = Math.max(1000, Math.trunc(parseNumber(envValue(process.env, 'AGENT_LLM_TIMEOUT_MS', llm.timeoutMs), DEFAULT_AGENT_CONFIG.llm.timeoutMs)))
    llm.temperature = Math.min(2, Math.max(0, parseNumber(envValue(process.env, 'AGENT_LLM_TEMPERATURE', llm.temperature), DEFAULT_AGENT_CONFIG.llm.temperature)))
    llm.maxTokens = Math.max(100, Math.trunc(parseNumber(envValue(process.env, 'AGENT_LLM_MAX_TOKENS', llm.maxTokens), DEFAULT_AGENT_CONFIG.llm.maxTokens)))

    const budget = normalized.budget
    budget.enabled = parseBoolean(process.env.AGENT_BUDGET_ENABLED, Boolean(budget.enabled))
    budget.windowMs = Math.max(1000, Math.trunc(parseNumber(envValue(process.env, 'AGENT_BUDGET_WINDOW_MS', budget.windowMs), DEFAULT_AGENT_CONFIG.budget.windowMs)))
    budget.maxLlmCallsPerGroupPerMinute = Math.max(1, Math.trunc(parseNumber(envValue(process.env, 'AGENT_BUDGET_MAX_LLM_CALLS_PER_GROUP_PER_MINUTE', budget.maxLlmCallsPerGroupPerMinute), DEFAULT_AGENT_CONFIG.budget.maxLlmCallsPerGroupPerMinute)))
    budget.maxLlmCallsPerUserPerMinute = Math.max(1, Math.trunc(parseNumber(envValue(process.env, 'AGENT_BUDGET_MAX_LLM_CALLS_PER_USER_PER_MINUTE', budget.maxLlmCallsPerUserPerMinute), DEFAULT_AGENT_CONFIG.budget.maxLlmCallsPerUserPerMinute)))

    return normalized
}

function isEnabledForGroup(groupId, agentConfig = normalizeAgentConfig()) {
    if (!agentConfig.enabled) return false

    const key = String(groupId || '')
    const groupConfig = agentConfig.groups && agentConfig.groups[key]
    if (groupConfig && typeof groupConfig.enabled === 'boolean') {
        return groupConfig.enabled
    }

    return agentConfig.defaultGroupEnabled
}

function getEffectiveAgentConfigForGroup(groupId, agentConfig = normalizeAgentConfig()) {
    const key = String(groupId || '')
    const groupConfig = agentConfig.groups && agentConfig.groups[key]
    if (!isPlainObject(groupConfig)) return agentConfig

    const effective = clone(agentConfig)
    if (typeof groupConfig.observeOnly === 'boolean') {
        effective.observeOnly = groupConfig.observeOnly
    }
    if (typeof groupConfig.sendEnabled === 'boolean') {
        effective.sendEnabled = groupConfig.sendEnabled
    }
    if (isPlainObject(groupConfig.replyPolicy)) {
        effective.replyPolicy = mergeDefaults(effective.replyPolicy, groupConfig.replyPolicy)
    }
    if (isPlainObject(groupConfig.social)) {
        effective.social = mergeDefaults(effective.social, groupConfig.social)
    }
    if (isPlainObject(groupConfig.participation)) {
        effective.participation = mergeDefaults(effective.participation, groupConfig.participation)
    }
    if (isPlainObject(groupConfig.timing)) {
        effective.timing = mergeDefaults(effective.timing, groupConfig.timing)
    }
    if (isPlainObject(groupConfig.replyer)) {
        effective.replyer = mergeDefaults(effective.replyer, groupConfig.replyer)
    }
    return effective
}

module.exports = {
    normalizeAgentConfig,
    isEnabledForGroup,
    getEffectiveAgentConfigForGroup,
    getRawAgentConfig
}
