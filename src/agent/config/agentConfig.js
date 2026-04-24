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
