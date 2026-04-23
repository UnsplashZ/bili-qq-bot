'use strict'

const {
    normalizeGroupAiConfigPatch
} = require('../groupConfigFacade')
const {
    readAiConfigSnapshot,
    updateAiConfigSnapshot
} = require('../facades/aiConfigFacade')
const { resolveManagedGroupId } = require('./subscriptionController')

const BOT_CONTROL_CONFIG_FIELDS = Object.freeze([
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled',
    'aiProbability',
    'aiContextLimit',
    'aiTemperature'
])

function normalizeValue(value) {
    return String(value || '').trim()
}

function pickConfigUpdates(input = {}) {
    const source = input?.updates && typeof input.updates === 'object' && !Array.isArray(input.updates)
        ? input.updates
        : input
    const updates = {}

    for (const field of BOT_CONTROL_CONFIG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            updates[field] = source[field]
        }
    }

    return updates
}

function buildConfigReadSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveManagedGroupId(groupId, input, 'read')
    const targetGroupId = normalizeValue(input.targetGroupId)

    if (targetGroupId && targetGroupId !== scopedGroupId) {
        throw new Error('Bot-control read is limited to the current group scope')
    }

    return {
        action: 'config.read',
        groupId: scopedGroupId,
        input: {
            operation: 'get'
        }
    }
}

function buildConfigWriteSnapshot({ groupId, input = {}, contextLimitRange } = {}) {
    const scopedGroupId = resolveManagedGroupId(groupId, input, 'write')
    const targetGroupId = normalizeValue(input.targetGroupId)

    if (targetGroupId && targetGroupId !== scopedGroupId) {
        throw new Error('Bot-control write is limited to the current group scope')
    }

    const normalizedPatch = normalizeGroupAiConfigPatch(pickConfigUpdates(input), {
        fields: BOT_CONTROL_CONFIG_FIELDS,
        contextLimitRange,
        requireAtLeastOne: true,
        requireAtLeastOneMessage: `At least one of ${BOT_CONTROL_CONFIG_FIELDS.join(', ')} must be provided`
    })

    return {
        action: 'config.write',
        groupId: scopedGroupId,
        input: {
            operation: 'patch',
            updates: normalizedPatch
        }
    }
}

function buildConfigReadResult({ action, groupId, config }) {
    const snapshot = readAiConfigSnapshot(config, groupId, {
        fields: BOT_CONTROL_CONFIG_FIELDS,
        includeGlobal: true,
        includeEffective: true
    })

    return {
        ok: true,
        action,
        namespace: 'config',
        scope: 'current_group',
        groupId,
        data: {
            fields: snapshot.fields,
            overrides: snapshot.overrides,
            effective: snapshot.effective
        }
    }
}

function buildWriteSummary(snapshot) {
    const entries = Object.entries(snapshot?.input?.updates || {})
    const formatted = entries.map(([field, value]) => `${field}=${value === null ? '继承' : value}`)
    return `更新当前群 AI 配置：${formatted.join('，')}`
}

class ConfigController {
    constructor({ config, contextLimitRange = { min: 1, max: 100 } }) {
        this.config = config
        this.contextLimitRange = contextLimitRange
    }

    read({ action, groupId, input }) {
        const snapshot = buildConfigReadSnapshot({ groupId, input })
        return buildConfigReadResult({
            action,
            groupId: snapshot.groupId,
            config: this.config
        })
    }

    write({ action, groupId, input }) {
        const snapshot = buildConfigWriteSnapshot({
            groupId,
            input,
            contextLimitRange: this.contextLimitRange
        })

        const result = updateAiConfigSnapshot(this.config, snapshot.groupId, snapshot.input.updates, {
            fields: BOT_CONTROL_CONFIG_FIELDS,
            includeGlobal: true,
            includeEffective: true,
            contextLimitRange: this.contextLimitRange
        })

        return {
            ok: true,
            action,
            namespace: 'config',
            operation: 'write',
            scope: 'current_group',
            groupId: snapshot.groupId,
            data: {
                operation: snapshot.input.operation,
                updatedFields: Object.keys(result.normalizedPatch),
                updates: result.normalizedPatch,
                overrides: result.overrides,
                effective: result.effective
            }
        }
    }
}

module.exports = {
    BOT_CONTROL_CONFIG_FIELDS,
    ConfigController,
    buildConfigReadSnapshot,
    buildConfigWriteSnapshot,
    buildWriteSummary
}
