const express = require('express')
const sysConfig = require('../../../../config')
const { DEFAULT_AGENT_CONFIG } = require('../../../../config/schemaV1')
const { diffConfig } = require('../../../../config/configDiff')
const { normalizeAgentConfig } = require('../../../../agent/config/agentConfig')
const { dashLog } = require('../shared/logging')
const { isNumericGroupId, isOfficialOpaqueGroupId } = require('../shared/normalize')
const { emptyMutationResult, publicRecoveryStatus } = require('../shared/config-mutation')

const DECISION_MODES = ['rule_only', 'llm_shadow', 'llm_live']
const RISK_LEVELS = ['low', 'medium', 'high']
const SOCIAL_MODES = ['quiet', 'normal', 'active', 'debug']

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
}

function getRawAgentConfig(config = sysConfig) {
    const snapshot = typeof config.getSnapshot === 'function' ? config.getSnapshot() : null
    const agent = snapshot?.agent ?? config.agent
    return isPlainObject(agent) ? clone(agent) : clone(DEFAULT_AGENT_CONFIG)
}

function getQqProvider(config = sysConfig) {
    const snapshot = typeof config.getSnapshot === 'function' ? config.getSnapshot() : null
    return snapshot?.qq?.provider === 'official' ? 'official' : 'napcat'
}

function validateAgentGroupId(config, rawGroupId) {
    const groupId = parseString(rawGroupId, 'groupId', 128)
    const provider = getQqProvider(config)
    const valid = provider === 'official' ? isOfficialOpaqueGroupId(groupId) : isNumericGroupId(groupId)
    if (!valid) {
        const error = new Error(provider === 'official'
            ? 'groupId must be a valid Official group_openid'
            : 'groupId must be a numeric QQ group id')
        error.code = 'CONFIG_GROUP_ID_INVALID'
        throw error
    }
    return { groupId, provider }
}

function assertExpectedGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        const error = new Error('expectedGeneration is required')
        error.code = 'CONFIG_EXPECTED_GENERATION_REQUIRED'
        throw error
    }
    return value
}

function publicAgentConfig(rawConfig) {
    const agent = normalizeAgentConfig(rawConfig)
    delete agent.llm.baseURL
    agent.llm.apiKey = { configured: Boolean(rawConfig?.llm?.apiKey) }
    return agent
}

function publicDefaults() {
    const defaults = clone(DEFAULT_AGENT_CONFIG)
    defaults.llm.apiKey = { configured: false }
    return defaults
}

function configErrorResponse(config, error) {
    const publicError = typeof config.service?.toPublicError === 'function'
        ? config.service.toPublicError(error)
        : {
            code: typeof error?.code === 'string' ? error.code : 'CONFIG_ERROR',
            path: typeof error?.path === 'string' ? error.path : '',
            line: Number.isInteger(error?.line) ? error.line : null,
            column: Number.isInteger(error?.column) ? error.column : null
        }
    const status = config.getStatus()
    return {
        error: publicError.code,
        ...publicError,
        generation: status.documentGeneration,
        fingerprint: status.fingerprint,
        ...publicRecoveryStatus(status),
        ...(Array.isArray(error?.conflictPaths) ? { conflictPaths: [...error.conflictPaths] } : {})
    }
}

function configErrorStatus(error) {
    if (error?.code === 'CONFIG_GENERATION_CONFLICT') return 409
    if (String(error?.code || '').startsWith('CONFIG_')) return 400
    return 500
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
        if (Object.prototype.hasOwnProperty.call(body.llm, 'baseURL') || Object.prototype.hasOwnProperty.call(body.llm, 'apiKeyEnv')) {
            const error = new Error('Legacy LLM configuration fields are not supported')
            error.code = 'CONFIG_FIELD_UNKNOWN'
            throw error
        }
        patch.llm = {}
        assignBoolean(patch.llm, body.llm, 'enabled')
        if (body.llm.provider !== undefined) patch.llm.provider = parseString(body.llm.provider, 'llm.provider', 80)
        if (body.llm.baseUrl !== undefined) patch.llm.baseUrl = parseString(body.llm.baseUrl, 'llm.baseUrl', 300)
        if (body.llm.model !== undefined) patch.llm.model = parseString(body.llm.model, 'llm.model', 120)
        if (typeof body.llm.apiKey === 'string' && body.llm.apiKey !== '') {
            patch.llm.apiKey = parseString(body.llm.apiKey, 'llm.apiKey', 1000)
        }
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

function buildAgentOperations(currentSnapshot, nextAgent, options = {}) {
    const nextSnapshot = clone(currentSnapshot)
    nextSnapshot.agent = nextAgent
    return diffConfig(currentSnapshot, nextSnapshot).map((entry) => {
        if (entry.path.join('.') === 'agent.llm.apiKey' && options.clearApiKey) {
            return { op: 'clear-secret', path: entry.path }
        }
        if (entry.after === undefined) return { op: 'remove', path: entry.path }
        return { op: 'set', path: entry.path, value: entry.after }
    })
}

function assertSecretActions(value) {
    if (value === undefined) return { clearApiKey: false }
    if (!isPlainObject(value) || Object.keys(value).some((key) => key !== 'apiKey') || value.apiKey !== 'clear') {
        const error = new Error('Unsupported secret action')
        error.code = 'CONFIG_SECRET_ACTION_INVALID'
        throw error
    }
    return { clearApiKey: true }
}

function createAgentConfigRouter(options = {}) {
    const config = options.config || sysConfig
    const router = express.Router()

    router.get('/agent/config', async (req, res) => {
        try {
            const rawAgent = getRawAgentConfig(config)
            const status = config.getStatus()
            res.json({
                agent: publicAgentConfig(rawAgent),
                defaults: publicDefaults(),
                qqProvider: getQqProvider(config),
                documentGeneration: status.documentGeneration,
                effectiveGeneration: status.effectiveGeneration,
                generation: status.documentGeneration
            })
        } catch (error) {
            dashLog(req, 'error', 'agent-config-fetch-failed', { code: error?.code || 'CONFIG_ERROR' })
            res.status(500).json(configErrorResponse(config, error))
        }
    })

    router.put('/agent/config', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const { clearApiKey } = assertSecretActions(req.body?.secretActions)
            const patch = sanitizeGlobalPatch(req.body)
            const currentSnapshot = config.getSnapshot()
            const current = getRawAgentConfig(config)
            const next = mergePatch(current, patch)
            if (clearApiKey) next.llm.apiKey = ''
            const operations = buildAgentOperations(currentSnapshot, next, { clearApiKey })
            const status = config.getStatus()
            if (status.documentGeneration !== expectedGeneration) {
                const error = new Error('Configuration generation changed')
                error.code = 'CONFIG_GENERATION_CONFLICT'
                error.conflictPaths = []
                throw error
            }
            const result = operations.length > 0
                ? await config.patch(operations, { actor: 'dashboard', expectedGeneration })
                : emptyMutationResult(config)
            const saved = getRawAgentConfig(config)
            dashLog(req, 'info', 'agent-config-updated', {
                appliedCount: result.applied.length,
                reloadedCount: result.reloaded.length
            })
            res.json({ ...result, message: 'Agent config updated', agent: publicAgentConfig(saved) })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const statusCode = configErrorStatus(error)
            dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'agent-config-update-failed', { code: payload.code })
            res.status(statusCode).json(payload)
        }
    })

    router.put('/agent/groups/:groupId', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const { groupId, provider } = validateAgentGroupId(config, req.params.groupId)
            const patch = sanitizeGroupPatch(req.body)
            const current = getRawAgentConfig(config)
            const groups = isPlainObject(current.groups) ? clone(current.groups) : {}
            const groupConfig = mergePatch(isPlainObject(groups[groupId]) ? groups[groupId] : {}, patch)
            const result = await config.patch([
                { op: 'set', path: ['agent', 'groups', groupId], value: groupConfig }
            ], { actor: 'dashboard', expectedGeneration })
            const saved = getRawAgentConfig(config)
            const agent = publicAgentConfig(saved)
            dashLog(req, 'info', 'agent-group-config-updated', {
                groupId,
                provider,
                appliedCount: result.applied.length
            })
            res.json({ ...result, message: 'Agent group config updated', groupId, config: agent.groups[groupId], agent })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const statusCode = configErrorStatus(error)
            dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'agent-group-config-update-failed', { code: payload.code })
            res.status(statusCode).json(payload)
        }
    })

    router.delete('/agent/groups/:groupId', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const { groupId, provider } = validateAgentGroupId(config, req.params.groupId)
            const result = await config.patch([
                { op: 'remove', path: ['agent', 'groups', groupId] }
            ], { actor: 'dashboard', expectedGeneration })
            const agent = publicAgentConfig(getRawAgentConfig(config))
            dashLog(req, 'info', 'agent-group-config-deleted', { groupId, provider, appliedCount: result.applied.length })
            res.json({ ...result, message: 'Agent group config deleted', agent })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const statusCode = configErrorStatus(error)
            dashLog(req, statusCode >= 500 ? 'error' : 'warn', 'agent-group-config-delete-failed', { code: payload.code })
            res.status(statusCode).json(payload)
        }
    })

    return router
}

const router = createAgentConfigRouter()

module.exports = router
module.exports.createAgentConfigRouter = createAgentConfigRouter
module.exports.publicAgentConfig = publicAgentConfig
module.exports.buildAgentOperations = buildAgentOperations
module.exports.validateAgentGroupId = validateAgentGroupId
