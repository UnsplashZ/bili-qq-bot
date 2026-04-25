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

    const longTerm = normalized.longTerm
    longTerm.retrieveLimit = Math.max(1, Math.min(10, Math.trunc(parseNumber(longTerm.retrieveLimit, DEFAULT_AGENT_CONFIG.longTerm.retrieveLimit))))
    longTerm.topicSummaryEnabled = Boolean(longTerm.topicSummaryEnabled)
    longTerm.topicSummaryMinMessages = Math.max(2, Math.trunc(parseNumber(longTerm.topicSummaryMinMessages, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinMessages)))
    longTerm.topicSummaryMinIntervalMs = Math.max(60 * 1000, Math.trunc(parseNumber(longTerm.topicSummaryMinIntervalMs, DEFAULT_AGENT_CONFIG.longTerm.topicSummaryMinIntervalMs)))

    const replyPolicy = normalized.replyPolicy
    replyPolicy.minReplyScore = Math.min(1, Math.max(0, parseNumber(replyPolicy.minReplyScore, DEFAULT_AGENT_CONFIG.replyPolicy.minReplyScore)))
    replyPolicy.cooldownMs = Math.max(0, Math.trunc(parseNumber(replyPolicy.cooldownMs, DEFAULT_AGENT_CONFIG.replyPolicy.cooldownMs)))

    const tools = normalized.tools
    tools.enabled = Boolean(tools.enabled)
    tools.confirmationTtlMs = Math.max(10 * 1000, Math.trunc(parseNumber(tools.confirmationTtlMs, DEFAULT_AGENT_CONFIG.tools.confirmationTtlMs)))
    tools.requireConfirmationFor = Array.isArray(tools.requireConfirmationFor)
        ? tools.requireConfirmationFor
            .map((risk) => String(risk).trim())
            .filter((risk) => ['low', 'medium', 'high'].includes(risk))
        : [...DEFAULT_AGENT_CONFIG.tools.requireConfirmationFor]

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
    return effective
}

module.exports = {
    normalizeAgentConfig,
    isEnabledForGroup,
    getEffectiveAgentConfigForGroup,
    getRawAgentConfig
}
