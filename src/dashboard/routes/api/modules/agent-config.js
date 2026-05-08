const express = require('express')
const sysConfig = require('../../../../config')
const { DEFAULT_AGENT_CONFIG } = require('../../../../config/schema')
const { normalizeAgentConfig } = require('../../../../agent/config/agentConfig')
const { dashLog } = require('../shared/logging')

const router = express.Router()
const DECISION_MODES = ['rule_only', 'llm_shadow', 'llm_live']
const RISK_LEVELS = ['low', 'medium', 'high']
const SOCIAL_MODES = ['quiet', 'normal', 'active', 'debug']

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
}

function getRawAgentConfig() {
    return isPlainObject(sysConfig.agent) ? clone(sysConfig.agent) : clone(DEFAULT_AGENT_CONFIG)
}

function parseBoolean(value, field) {
    if (typeof value === 'boolean') return value
    throw new Error(`${field} must be a boolean`)
}

function parseInteger(value, field, min, max) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`${field} must be an integer between ${min} and ${max}`)
    }
    return parsed
}

function parseFloatRange(value, field, min, max) {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw new Error(`${field} must be a number between ${min} and ${max}`)
    }
    return parsed
}

function parseString(value, field, maxLength = 500) {
    if (value === undefined || value === null) return ''
    const normalized = String(value).trim()
    if (normalized.length > maxLength) {
        throw new Error(`${field} is too long`)
    }
    return normalized
}

function parseAliases(value) {
    if (Array.isArray(value)) {
        return value.map((alias) => parseString(alias, 'aliases[]', 40)).filter(Boolean)
    }
    if (typeof value === 'string') {
        return value.split(/[,，\n]/).map((alias) => parseString(alias, 'aliases[]', 40)).filter(Boolean)
    }
    throw new Error('aliases must be an array or string')
}

function parseRiskList(value) {
    if (!Array.isArray(value)) throw new Error('requireConfirmationFor must be an array')
    const risks = value.map((risk) => String(risk || '').trim()).filter(Boolean)
    for (const risk of risks) {
        if (!RISK_LEVELS.includes(risk)) {
            throw new Error(`invalid risk level: ${risk}`)
        }
    }
    return [...new Set([...risks, 'high'])]
}

function assignBoolean(target, source, key) {
    if (source[key] !== undefined) target[key] = parseBoolean(source[key], key)
}

function assignInteger(target, source, key, min, max) {
    if (source[key] !== undefined) target[key] = parseInteger(source[key], key, min, max)
}

function assignFloat(target, source, key, min, max) {
    if (source[key] !== undefined) target[key] = parseFloatRange(source[key], key, min, max)
}


function sanitizeParticipationPatch(value, fieldPrefix = 'participation') {
    if (!isPlainObject(value)) return null
    const patch = {}
    for (const key of ['enabled', 'timingGateEnabled', 'replyerEnabled', 'expressionLearningEnabled', 'replyEffectTrackingEnabled', 'personProfileEnabled']) {
        assignBoolean(patch, value, key)
    }
    return patch
}

function sanitizeTimingPatch(value, fieldPrefix = 'timing') {
    if (!isPlainObject(value)) return null
    const patch = {}
    assignInteger(patch, value, 'quietWindowMs', 0, 60 * 1000)
    assignInteger(patch, value, 'maxWaitMs', 0, 5 * 60 * 1000)
    return patch
}

function sanitizeReplyerPatch(value, fieldPrefix = 'replyer') {
    if (!isPlainObject(value)) return null
    const patch = {}
    assignInteger(patch, value, 'maxReactChars', 20, 500)
    assignInteger(patch, value, 'maxReplyChars', 80, 2000)
    assignBoolean(patch, value, 'allowQuoteReply')
    return patch
}

function sanitizeExpressionPatch(value, fieldPrefix = 'expression') {
    if (!isPlainObject(value)) return null
    const patch = {}
    assignInteger(patch, value, 'learningMinMessages', 6, 200)
    assignInteger(patch, value, 'learningMinIntervalMs', 60 * 1000, 24 * 60 * 60 * 1000)
    return patch
}

function sanitizeGlobalPatch(body = {}) {
    if (!isPlainObject(body)) throw new Error('request body must be an object')
    const patch = {}

    for (const key of ['enabled', 'observeOnly', 'logTrajectory', 'defaultGroupEnabled', 'sendEnabled']) {
        assignBoolean(patch, body, key)
    }

    if (body.decisionMode !== undefined) {
        const mode = parseString(body.decisionMode, 'decisionMode', 30)
        if (!DECISION_MODES.includes(mode)) throw new Error('invalid decisionMode')
        patch.decisionMode = mode
    }

    if (body.aliases !== undefined) {
        patch.aliases = parseAliases(body.aliases)
    }

    if (isPlainObject(body.persona)) {
        patch.persona = {}
        if (body.persona.displayName !== undefined) patch.persona.displayName = parseString(body.persona.displayName, 'persona.displayName', 80)
        if (body.persona.style !== undefined) patch.persona.style = parseString(body.persona.style, 'persona.style', 500)
        if (body.persona.boundaries !== undefined) patch.persona.boundaries = parseString(body.persona.boundaries, 'persona.boundaries', 500)
    }

    if (isPlainObject(body.shortTerm)) {
        patch.shortTerm = {}
        assignInteger(patch.shortTerm, body.shortTerm, 'maxRecentMessagesPerGroup', 10, 1000)
        assignInteger(patch.shortTerm, body.shortTerm, 'topicIdleMs', 60 * 1000, 24 * 60 * 60 * 1000)
        assignInteger(patch.shortTerm, body.shortTerm, 'crowdedMessagesPerMinute', 1, 120)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptRecentMessages', 4, 80)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptTopicMessages', 0, 80)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptAssistantMessages', 0, 40)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptMaxMessages', 8, 120)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptMaxCharsPerMessage', 80, 1000)
        assignInteger(patch.shortTerm, body.shortTerm, 'promptMaxContextChars', 1000, 200000)
    }

    if (isPlainObject(body.longTerm)) {
        patch.longTerm = {}
        assignInteger(patch.longTerm, body.longTerm, 'retrieveLimit', 1, 10)
        assignBoolean(patch.longTerm, body.longTerm, 'topicSummaryEnabled')
        assignInteger(patch.longTerm, body.longTerm, 'topicSummaryMinMessages', 2, 100)
        assignInteger(patch.longTerm, body.longTerm, 'topicSummaryMinIntervalMs', 60 * 1000, 24 * 60 * 60 * 1000)
    }

    if (isPlainObject(body.replyPolicy)) {
        patch.replyPolicy = {}
        assignFloat(patch.replyPolicy, body.replyPolicy, 'minReplyScore', 0, 1)
        assignInteger(patch.replyPolicy, body.replyPolicy, 'cooldownMs', 0, 60 * 60 * 1000)
    }

    const participationPatch = sanitizeParticipationPatch(body.participation)
    if (participationPatch) patch.participation = participationPatch
    const timingPatch = sanitizeTimingPatch(body.timing)
    if (timingPatch) patch.timing = timingPatch
    const replyerPatch = sanitizeReplyerPatch(body.replyer)
    if (replyerPatch) patch.replyer = replyerPatch
    const expressionPatch = sanitizeExpressionPatch(body.expression)
    if (expressionPatch) patch.expression = expressionPatch

    if (isPlainObject(body.social)) {
        patch.social = {}
        assignBoolean(patch.social, body.social, 'enabled')
        if (body.social.mode !== undefined) {
            const mode = parseString(body.social.mode, 'social.mode', 30)
            if (!SOCIAL_MODES.includes(mode)) throw new Error('invalid social.mode')
            patch.social.mode = mode
        }
        assignFloat(patch.social, body.social, 'interjectProbability', 0, 1)
        assignFloat(patch.social, body.social, 'ambientReactProbability', 0, 1)
        assignFloat(patch.social, body.social, 'planningMinScore', 0, 1)
        assignFloat(patch.social, body.social, 'topicAffinityMinScore', 0, 1)
        assignFloat(patch.social, body.social, 'minInterjectScore', 0, 1)
        assignFloat(patch.social, body.social, 'minAmbientScore', 0, 1)
        assignInteger(patch.social, body.social, 'cooldownMs', 0, 60 * 60 * 1000)
        assignInteger(patch.social, body.social, 'dailyInterjectLimit', 0, 1000)
        assignInteger(patch.social, body.social, 'perTopicInterjectLimit', 0, 100)
        assignBoolean(patch.social, body.social, 'avoidDuringRapidTwoPersonChat')
        assignInteger(patch.social, body.social, 'maxCasualReplyChars', 20, 500)
    }

    if (isPlainObject(body.tools)) {
        patch.tools = {}
        assignBoolean(patch.tools, body.tools, 'enabled')
        assignInteger(patch.tools, body.tools, 'confirmationTtlMs', 10 * 1000, 60 * 60 * 1000)
        if (body.tools.requireConfirmationFor !== undefined) {
            patch.tools.requireConfirmationFor = parseRiskList(body.tools.requireConfirmationFor)
        }
    }

    if (isPlainObject(body.llm)) {
        patch.llm = {}
        assignBoolean(patch.llm, body.llm, 'enabled')
        if (body.llm.provider !== undefined) patch.llm.provider = parseString(body.llm.provider, 'llm.provider', 80)
        if (body.llm.baseURL !== undefined) patch.llm.baseURL = parseString(body.llm.baseURL, 'llm.baseURL', 300)
        if (body.llm.model !== undefined) patch.llm.model = parseString(body.llm.model, 'llm.model', 120)
        if (body.llm.apiKeyEnv !== undefined) patch.llm.apiKeyEnv = parseString(body.llm.apiKeyEnv, 'llm.apiKeyEnv', 80)
        assignInteger(patch.llm, body.llm, 'timeoutMs', 1000, 120000)
        assignFloat(patch.llm, body.llm, 'temperature', 0, 2)
        assignInteger(patch.llm, body.llm, 'maxTokens', 100, 8000)
    }

    if (isPlainObject(body.budget)) {
        patch.budget = {}
        assignBoolean(patch.budget, body.budget, 'enabled')
        assignInteger(patch.budget, body.budget, 'windowMs', 1000, 60 * 60 * 1000)
        assignInteger(patch.budget, body.budget, 'maxLlmCallsPerGroupPerMinute', 1, 1000)
        assignInteger(patch.budget, body.budget, 'maxLlmCallsPerUserPerMinute', 1, 1000)
    }

    return patch
}

function sanitizeGroupPatch(body = {}) {
    if (!isPlainObject(body)) throw new Error('request body must be an object')
    const patch = {}
    for (const key of ['enabled', 'observeOnly', 'sendEnabled']) {
        if (body[key] === null) {
            patch[key] = null
        } else {
            assignBoolean(patch, body, key)
        }
    }
    if (body.replyPolicy === null) {
        patch.replyPolicy = null
    } else if (isPlainObject(body.replyPolicy)) {
        patch.replyPolicy = {}
        assignFloat(patch.replyPolicy, body.replyPolicy, 'minReplyScore', 0, 1)
        assignInteger(patch.replyPolicy, body.replyPolicy, 'cooldownMs', 0, 60 * 60 * 1000)
    }
    if (body.participation === null) {
        patch.participation = null
    } else {
        const participationPatch = sanitizeParticipationPatch(body.participation)
        if (participationPatch) patch.participation = participationPatch
    }
    if (body.timing === null) {
        patch.timing = null
    } else {
        const timingPatch = sanitizeTimingPatch(body.timing)
        if (timingPatch) patch.timing = timingPatch
    }
    if (body.replyer === null) {
        patch.replyer = null
    } else {
        const replyerPatch = sanitizeReplyerPatch(body.replyer)
        if (replyerPatch) patch.replyer = replyerPatch
    }
    if (body.expression === null) {
        patch.expression = null
    } else {
        const expressionPatch = sanitizeExpressionPatch(body.expression)
        if (expressionPatch) patch.expression = expressionPatch
    }

    if (body.social === null) {
        patch.social = null
    } else if (isPlainObject(body.social)) {
        patch.social = {}
        assignBoolean(patch.social, body.social, 'enabled')
        if (body.social.mode !== undefined) {
            const mode = parseString(body.social.mode, 'social.mode', 30)
            if (!SOCIAL_MODES.includes(mode)) throw new Error('invalid social.mode')
            patch.social.mode = mode
        }
        assignFloat(patch.social, body.social, 'interjectProbability', 0, 1)
        assignFloat(patch.social, body.social, 'ambientReactProbability', 0, 1)
        assignFloat(patch.social, body.social, 'planningMinScore', 0, 1)
        assignFloat(patch.social, body.social, 'topicAffinityMinScore', 0, 1)
        assignFloat(patch.social, body.social, 'minInterjectScore', 0, 1)
        assignFloat(patch.social, body.social, 'minAmbientScore', 0, 1)
        assignInteger(patch.social, body.social, 'cooldownMs', 0, 60 * 60 * 1000)
        assignInteger(patch.social, body.social, 'dailyInterjectLimit', 0, 1000)
        assignInteger(patch.social, body.social, 'perTopicInterjectLimit', 0, 100)
        assignBoolean(patch.social, body.social, 'avoidDuringRapidTwoPersonChat')
        assignInteger(patch.social, body.social, 'maxCasualReplyChars', 20, 500)
    }
    return patch
}

function mergePatch(target, patch) {
    const next = clone(target)
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete next[key]
            continue
        }
        if (isPlainObject(value) && isPlainObject(next[key])) {
            next[key] = mergePatch(next[key], value)
            continue
        }
        next[key] = value
    }
    return next
}

function saveAgentConfig(nextConfig) {
    sysConfig.agent = nextConfig
}

function llmEnvStatus(agentConfig) {
    return {
        providerOverridden: Boolean(process.env.AGENT_LLM_PROVIDER),
        baseURLOverridden: Boolean(process.env.AGENT_LLM_BASE_URL),
        modelOverridden: Boolean(process.env.AGENT_LLM_MODEL),
        apiKeyEnvOverridden: Boolean(process.env.AGENT_LLM_API_KEY_ENV),
        apiKeyConfigured: Boolean(process.env[agentConfig.llm.apiKeyEnv])
    }
}

router.get('/agent/config', async (req, res) => {
    try {
        const rawAgent = getRawAgentConfig()
        const agent = normalizeAgentConfig(rawAgent)
        res.json({
            agent,
            defaults: clone(DEFAULT_AGENT_CONFIG),
            llmEnv: llmEnvStatus(agent)
        })
    } catch (error) {
        dashLog(req, 'error', 'agent-config-fetch-failed', { error: error.message })
        res.status(500).json({ error: 'Failed to read agent config' })
    }
})

router.put('/agent/config', async (req, res) => {
    try {
        const patch = sanitizeGlobalPatch(req.body)
        const current = getRawAgentConfig()
        const next = mergePatch(current, patch)
        saveAgentConfig(next)
        const agent = normalizeAgentConfig(next)
        dashLog(req, 'info', 'agent-config-updated', {
            keys: Object.keys(patch).join(',')
        })
        res.json({ message: 'Agent config updated', agent, llmEnv: llmEnvStatus(agent) })
    } catch (error) {
        dashLog(req, 'warn', 'agent-config-update-failed', { error: error.message })
        res.status(400).json({ error: error.message || 'Failed to update agent config' })
    }
})

router.put('/agent/groups/:groupId', async (req, res) => {
    try {
        const groupId = parseString(req.params.groupId, 'groupId', 30)
        if (!/^\d+$/.test(groupId)) return res.status(400).json({ error: 'groupId must be numeric' })
        const patch = sanitizeGroupPatch(req.body)
        const current = getRawAgentConfig()
        const groups = isPlainObject(current.groups) ? clone(current.groups) : {}
        groups[groupId] = mergePatch(isPlainObject(groups[groupId]) ? groups[groupId] : {}, patch)
        const next = { ...current, groups }
        saveAgentConfig(next)
        const agent = normalizeAgentConfig(next)
        dashLog(req, 'info', 'agent-group-config-updated', {
            groupId,
            keys: Object.keys(patch).join(',')
        })
        res.json({ message: 'Agent group config updated', groupId, config: agent.groups[groupId], agent })
    } catch (error) {
        dashLog(req, 'warn', 'agent-group-config-update-failed', { error: error.message })
        res.status(400).json({ error: error.message || 'Failed to update agent group config' })
    }
})

router.delete('/agent/groups/:groupId', async (req, res) => {
    try {
        const groupId = parseString(req.params.groupId, 'groupId', 30)
        if (!/^\d+$/.test(groupId)) return res.status(400).json({ error: 'groupId must be numeric' })
        const current = getRawAgentConfig()
        const groups = isPlainObject(current.groups) ? clone(current.groups) : {}
        delete groups[groupId]
        const next = { ...current, groups }
        saveAgentConfig(next)
        const agent = normalizeAgentConfig(next)
        dashLog(req, 'info', 'agent-group-config-deleted', { groupId })
        res.json({ message: 'Agent group config deleted', agent })
    } catch (error) {
        dashLog(req, 'warn', 'agent-group-config-delete-failed', { error: error.message })
        res.status(400).json({ error: error.message || 'Failed to delete agent group config' })
    }
})

module.exports = router
