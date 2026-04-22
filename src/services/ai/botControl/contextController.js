'use strict'

const { resolveManagedGroupId } = require('./subscriptionController')

function normalizeValue(value) {
    return String(value || '').trim()
}

function normalizeResetOperation(input = {}) {
    const operation = normalizeValue(input.operation || input.type || 'reset')

    if (!operation || operation === 'reset' || operation === 'reset_context' || operation === 'reset_current_group_context') {
        return 'reset'
    }

    throw new Error(`Unsupported context write operation: ${operation}`)
}

function buildContextWriteSnapshot({ groupId, input = {} } = {}) {
    const scopedGroupId = resolveManagedGroupId(groupId, input, 'write')
    const targetGroupId = normalizeValue(input.targetGroupId)

    if (targetGroupId && targetGroupId !== scopedGroupId) {
        throw new Error('Bot-control write is limited to the current group scope')
    }

    return {
        action: 'context.write',
        groupId: scopedGroupId,
        input: {
            operation: normalizeResetOperation(input)
        }
    }
}

class ContextController {
    constructor({ aiContextService }) {
        this.aiContextService = aiContextService
    }

    write({ action, groupId, input }) {
        const snapshot = buildContextWriteSnapshot({ groupId, input })

        this.aiContextService.resetContext(snapshot.groupId)

        return {
            ok: true,
            action,
            namespace: 'context',
            operation: 'write',
            scope: 'current_group',
            groupId: snapshot.groupId,
            data: {
                operation: snapshot.input.operation,
                reset: true
            }
        }
    }
}

module.exports = {
    ContextController,
    buildContextWriteSnapshot
}
