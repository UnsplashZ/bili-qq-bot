'use strict'

class AiConfigValidationError extends Error {
    constructor(field, message) {
        super(message)
        this.name = 'AiConfigValidationError'
        this.field = field
    }
}

const AI_ALLOWED_FIELDS = new Set([
    'aiApiUrl',
    'aiApiKey',
    'aiModel',
    'aiSystemPrompt',
    'aiProbability',
    'aiContextLimit',
    'aiTemperature',
    'aiChatApiUrl',
    'aiChatApiKey',
    'aiChatModel',
    'aiChatProxy',
    'aiChatSystemPrompt',
    'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey',
    'aiEmbeddingModel',
    'aiEmbeddingProxy',
    'aiHistoryMaxSize',
    'aiVectorMaxSize',
    'aiVectorSimilarityThreshold',
    'aiVectorSearchLimit',
    'aiShortMessageThreshold',
    'aiMemorySafetyLimit',
    'aiVectorMemoryLimit',
    'aiTrimRatio',
    'aiVectorBatchLoadSize',
    'aiEnableVectorCache',
    'aiEnableSmartTrim',
    'aiStructuredContextEnabled',
    'aiIdentityRagMode',
    'aiAdminClaimRequiresTool',
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled'
])

const BOOLEAN_FIELDS = new Set([
    'aiEnableVectorCache',
    'aiEnableSmartTrim',
    'aiStructuredContextEnabled',
    'aiAdminClaimRequiresTool',
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled'
])

function _ensureIntInRange(field, value, min, max) {
    let parsed
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new AiConfigValidationError(field, `${field} must be an integer`)
        }
        parsed = value
    } else if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!/^[+-]?\d+$/.test(trimmed)) {
            throw new AiConfigValidationError(field, `${field} must be an integer`)
        }
        parsed = Number(trimmed)
    } else {
        throw new AiConfigValidationError(field, `${field} must be an integer`)
    }
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
        throw new AiConfigValidationError(field, `${field} must be between ${min} and ${max}`)
    }
    return parsed
}

function _ensureFloatInRange(field, value, min, max) {
    let parsed
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new AiConfigValidationError(field, `${field} must be a number`)
        }
        parsed = value
    } else if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
            throw new AiConfigValidationError(field, `${field} must be a number`)
        }
        parsed = Number(trimmed)
    } else {
        throw new AiConfigValidationError(field, `${field} must be a number`)
    }
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
        throw new AiConfigValidationError(field, `${field} must be between ${min} and ${max}`)
    }
    return parsed
}

function _ensureBoolean(field, value) {
    if (typeof value !== 'boolean') {
        throw new AiConfigValidationError(field, `${field} must be a boolean`)
    }
    return value
}

function normalizeAiContextLimit(value, range = { min: 1, max: 100 }) {
    return _ensureIntInRange('aiContextLimit', value, range.min, range.max)
}

function normalizeAiConfigField(field, value, options = {}) {
    if (!AI_ALLOWED_FIELDS.has(field)) {
        throw new AiConfigValidationError(field, `Unknown AI config field: ${field}`)
    }

    if (BOOLEAN_FIELDS.has(field)) {
        return _ensureBoolean(field, value)
    }

    switch (field) {
        case 'aiProbability':
        case 'aiVectorSimilarityThreshold':
        case 'aiTrimRatio':
            return _ensureFloatInRange(field, value, 0, 1)
        case 'aiTemperature':
            return _ensureFloatInRange(field, value, 0, 2)
        case 'aiContextLimit':
            return normalizeAiContextLimit(value, options.contextLimitRange || { min: 1, max: 100 })
        case 'aiVectorSearchLimit':
            return _ensureIntInRange(field, value, 1, 10)
        case 'aiShortMessageThreshold':
            return _ensureIntInRange(field, value, 1, 50)
        case 'aiMemorySafetyLimit':
            return _ensureIntInRange(field, value, 1, 10000)
        case 'aiHistoryMaxSize':
            return _ensureIntInRange(field, value, 1024 * 1024, 10000 * 1024 * 1024)
        case 'aiIdentityRagMode': {
            const mode = String(value).trim().toLowerCase()
            if (!['strict', 'normal'].includes(mode)) {
                throw new AiConfigValidationError(field, `${field} must be "strict" or "normal"`)
            }
            return mode
        }
        default:
            return value
    }
}

function normalizeAiConfigUpdates(updates, options = {}) {
    if (!updates || typeof updates !== 'object') {
        throw new AiConfigValidationError('payload', 'Invalid configuration data')
    }

    const normalized = {}
    const entries = Object.entries(updates)
    for (const [field, value] of entries) {
        if (!AI_ALLOWED_FIELDS.has(field)) {
            throw new AiConfigValidationError(field, `Unknown AI config field: ${field}`)
        }
        normalized[field] = normalizeAiConfigField(field, value, options)
    }
    return normalized
}

module.exports = {
    AiConfigValidationError,
    AI_ALLOWED_FIELDS,
    normalizeAiConfigField,
    normalizeAiConfigUpdates,
    normalizeAiContextLimit
}
