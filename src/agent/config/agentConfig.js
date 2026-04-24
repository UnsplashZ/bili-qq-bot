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
    normalized.groups = isPlainObject(normalized.groups) ? normalized.groups : {}

    const shortTerm = normalized.shortTerm
    shortTerm.maxRecentMessagesPerGroup = Math.max(10, Math.trunc(parseNumber(shortTerm.maxRecentMessagesPerGroup, DEFAULT_AGENT_CONFIG.shortTerm.maxRecentMessagesPerGroup)))
    shortTerm.topicIdleMs = Math.max(60 * 1000, Math.trunc(parseNumber(shortTerm.topicIdleMs, DEFAULT_AGENT_CONFIG.shortTerm.topicIdleMs)))
    shortTerm.crowdedMessagesPerMinute = Math.max(1, Math.trunc(parseNumber(shortTerm.crowdedMessagesPerMinute, DEFAULT_AGENT_CONFIG.shortTerm.crowdedMessagesPerMinute)))

    const replyPolicy = normalized.replyPolicy
    replyPolicy.minReplyScore = Math.min(1, Math.max(0, parseNumber(replyPolicy.minReplyScore, DEFAULT_AGENT_CONFIG.replyPolicy.minReplyScore)))
    replyPolicy.cooldownMs = Math.max(0, Math.trunc(parseNumber(replyPolicy.cooldownMs, DEFAULT_AGENT_CONFIG.replyPolicy.cooldownMs)))

    const llm = normalized.llm
    llm.enabled = parseBoolean(process.env.AGENT_LLM_ENABLED, Boolean(llm.enabled))
    llm.provider = String(envValue(process.env, 'AGENT_LLM_PROVIDER', llm.provider || DEFAULT_AGENT_CONFIG.llm.provider)).trim()
    llm.baseURL = String(envValue(process.env, 'AGENT_LLM_BASE_URL', llm.baseURL || '')).trim()
    llm.model = String(envValue(process.env, 'AGENT_LLM_MODEL', llm.model || '')).trim()
    llm.apiKeyEnv = String(envValue(process.env, 'AGENT_LLM_API_KEY_ENV', llm.apiKeyEnv || DEFAULT_AGENT_CONFIG.llm.apiKeyEnv)).trim()
    llm.timeoutMs = Math.max(1000, Math.trunc(parseNumber(envValue(process.env, 'AGENT_LLM_TIMEOUT_MS', llm.timeoutMs), DEFAULT_AGENT_CONFIG.llm.timeoutMs)))
    llm.temperature = Math.min(2, Math.max(0, parseNumber(envValue(process.env, 'AGENT_LLM_TEMPERATURE', llm.temperature), DEFAULT_AGENT_CONFIG.llm.temperature)))
    llm.maxTokens = Math.max(100, Math.trunc(parseNumber(envValue(process.env, 'AGENT_LLM_MAX_TOKENS', llm.maxTokens), DEFAULT_AGENT_CONFIG.llm.maxTokens)))

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

module.exports = {
    normalizeAgentConfig,
    isEnabledForGroup,
    getRawAgentConfig
}
