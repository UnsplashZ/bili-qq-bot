'use strict'

const {
    AiConfigValidationError,
    normalizeAiConfigField
} = require('./validation')

const GROUP_AI_SWITCH_FIELDS = Object.freeze([
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled'
])

const GROUP_AI_RUNTIME_FIELDS = Object.freeze([
    'aiProbability',
    'aiContextLimit',
    'aiTemperature',
    ...GROUP_AI_SWITCH_FIELDS
])

function pickGroupAiConfigUpdates(source, fields = GROUP_AI_RUNTIME_FIELDS) {
    if (!source || typeof source !== 'object') return {}

    const picked = {}
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            picked[field] = source[field]
        }
    }
    return picked
}

function normalizeGroupAiConfigPatch(updates, {
    fields = GROUP_AI_RUNTIME_FIELDS,
    contextLimitRange,
    requireAtLeastOne = false,
    requireAtLeastOneMessage
} = {}) {
    if (!updates || typeof updates !== 'object') {
        throw new AiConfigValidationError('payload', 'Invalid configuration data')
    }

    const allowedFields = new Set(fields)
    const normalized = {}
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined)

    if (requireAtLeastOne && entries.length === 0) {
        throw new AiConfigValidationError(
            'payload',
            requireAtLeastOneMessage || `At least one of ${fields.join(', ')} must be provided`
        )
    }

    for (const [field, value] of entries) {
        if (!allowedFields.has(field)) {
            throw new AiConfigValidationError(field, `Unknown AI config field: ${field}`)
        }

        normalized[field] = value === null
            ? null
            : normalizeAiConfigField(field, value, { contextLimitRange })
    }

    return normalized
}

function ensureGroupConfigContainer(config, groupId, { initialize = true } = {}) {
    const safeGroupId = String(groupId)

    if (!config.groupConfigs) {
        config.groupConfigs = {}
    }

    if (initialize && typeof config.ensureGroupConfig === 'function') {
        config.ensureGroupConfig(safeGroupId)
    } else if (!config.groupConfigs[safeGroupId]) {
        config.groupConfigs[safeGroupId] = {}
    }

    return config.groupConfigs[safeGroupId]
}

function applyGroupAiConfigPatch(groupConfig, normalizedPatch) {
    for (const [field, value] of Object.entries(normalizedPatch)) {
        if (value === null) {
            delete groupConfig[field]
            continue
        }
        groupConfig[field] = value
    }

    return groupConfig
}

function readGroupAiConfigSnapshot(config, groupId, {
    fields = GROUP_AI_SWITCH_FIELDS,
    includeGlobal = false,
    initialize = true
} = {}) {
    const groupConfig = ensureGroupConfigContainer(config, groupId, { initialize })
    const snapshot = {}

    for (const field of fields) {
        snapshot[field] = groupConfig[field] !== undefined ? groupConfig[field] : null
    }

    if (includeGlobal) {
        snapshot.global = {}
        for (const field of fields) {
            snapshot.global[field] = config[field]
        }
    }

    return snapshot
}

function updateGroupAiConfig(config, groupId, updates, options = {}) {
    const normalizedPatch = normalizeGroupAiConfigPatch(updates, options)
    const groupConfig = ensureGroupConfigContainer(config, groupId, {
        initialize: options.initialize !== false
    })

    applyGroupAiConfigPatch(groupConfig, normalizedPatch)

    if (options.save !== false && typeof config.save === 'function') {
        config.save()
    }

    return {
        groupConfig,
        normalizedPatch,
        snapshot: readGroupAiConfigSnapshot(config, groupId, {
            fields: options.fields,
            includeGlobal: options.includeGlobal,
            initialize: false
        })
    }
}

function resetGroupAiConfig(config, groupId, {
    fields = GROUP_AI_SWITCH_FIELDS,
    save = true,
    includeGlobal = false,
    initialize = true
} = {}) {
    const groupConfig = ensureGroupConfigContainer(config, groupId, { initialize })

    for (const field of fields) {
        delete groupConfig[field]
    }

    if (save && typeof config.save === 'function') {
        config.save()
    }

    return readGroupAiConfigSnapshot(config, groupId, {
        fields,
        includeGlobal,
        initialize: false
    })
}

module.exports = {
    GROUP_AI_SWITCH_FIELDS,
    GROUP_AI_RUNTIME_FIELDS,
    pickGroupAiConfigUpdates,
    normalizeGroupAiConfigPatch,
    applyGroupAiConfigPatch,
    readGroupAiConfigSnapshot,
    updateGroupAiConfig,
    resetGroupAiConfig
}
