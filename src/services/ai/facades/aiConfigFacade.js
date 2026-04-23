'use strict'

const {
    readGroupAiConfigSnapshot,
    resetGroupAiConfig,
    updateGroupAiConfig
} = require('../groupConfigFacade')

function buildEffectiveGroupAiConfig(config, groupId, fields = []) {
    const effective = {}

    for (const field of fields) {
        effective[field] = typeof config.getGroupConfig === 'function'
            ? config.getGroupConfig(groupId, field)
            : config[field]
    }

    return effective
}

function readAiConfigSnapshot(config, groupId, {
    fields,
    includeGlobal = false,
    includeEffective = false,
    initialize = true
} = {}) {
    const snapshot = {
        overrides: readGroupAiConfigSnapshot(config, groupId, {
            fields,
            includeGlobal,
            initialize
        })
    }

    if (Array.isArray(fields)) {
        snapshot.fields = [...fields]
    }

    if (includeEffective) {
        snapshot.effective = buildEffectiveGroupAiConfig(config, groupId, fields || [])
    }

    return snapshot
}

function updateAiConfigSnapshot(config, groupId, updates, {
    fields,
    includeGlobal = false,
    includeEffective = false,
    initialize = true,
    save = true,
    contextLimitRange,
    requireAtLeastOne = false,
    requireAtLeastOneMessage
} = {}) {
    const result = updateGroupAiConfig(config, groupId, updates, {
        fields,
        includeGlobal,
        initialize,
        save,
        contextLimitRange,
        requireAtLeastOne,
        requireAtLeastOneMessage
    })

    const snapshot = {
        groupConfig: result.groupConfig,
        normalizedPatch: result.normalizedPatch,
        overrides: result.snapshot
    }

    if (Array.isArray(fields)) {
        snapshot.fields = [...fields]
    }

    if (includeEffective) {
        snapshot.effective = buildEffectiveGroupAiConfig(config, groupId, fields || [])
    }

    return snapshot
}

function resetAiConfigSnapshot(config, groupId, {
    fields,
    includeGlobal = false,
    includeEffective = false,
    initialize = true,
    save = true
} = {}) {
    const overrides = resetGroupAiConfig(config, groupId, {
        fields,
        includeGlobal,
        initialize,
        save
    })

    const snapshot = {
        overrides
    }

    if (Array.isArray(fields)) {
        snapshot.fields = [...fields]
    }

    if (includeEffective) {
        snapshot.effective = buildEffectiveGroupAiConfig(config, groupId, fields || [])
    }

    return snapshot
}

module.exports = {
    buildEffectiveGroupAiConfig,
    readAiConfigSnapshot,
    updateAiConfigSnapshot,
    resetAiConfigSnapshot
}