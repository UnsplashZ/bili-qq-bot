'use strict'

function assertExpectedGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        const error = new Error('expectedGeneration is required')
        error.code = 'CONFIG_EXPECTED_GENERATION_REQUIRED'
        throw error
    }
    return value
}

function assertCurrentGeneration(config, expectedGeneration) {
    if (config.getStatus().documentGeneration !== expectedGeneration) {
        const error = new Error('Configuration generation changed')
        error.code = 'CONFIG_GENERATION_CONFLICT'
        error.conflictPaths = []
        throw error
    }
}

function publicRecoveryStatus(status = {}) {
    const publicRollbackErrors = (value) => Array.isArray(value)
        ? value.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
            handlerId: typeof entry.handlerId === 'string' ? entry.handlerId : 'unknown',
            phase: typeof entry.phase === 'string' ? entry.phase : 'rollback',
            code: typeof entry.code === 'string' ? entry.code : 'CONFIG_ROLLBACK_ERROR'
        }))
        : []
    const recovery = status.recoveryRequired?.required === true
        ? {
            required: true,
            reason: typeof status.recoveryRequired.reason === 'string' ? status.recoveryRequired.reason : 'CONFIG_RECOVERY_REQUIRED',
            code: typeof status.recoveryRequired.code === 'string' ? status.recoveryRequired.code : 'CONFIG_RECOVERY_REQUIRED',
            since: typeof status.recoveryRequired.since === 'string' ? status.recoveryRequired.since : null,
            rollbackErrors: publicRollbackErrors(status.recoveryRequired.rollbackErrors),
            diskRestoreFailed: status.recoveryRequired.diskRestoreFailed === true
        }
        : null
    const pending = status.pendingRuntimeRecovery?.required === true
        ? {
            required: true,
            handlers: Array.isArray(status.pendingRuntimeRecovery.handlers)
                ? status.pendingRuntimeRecovery.handlers.filter((id) => typeof id === 'string')
                : [],
            rollbackErrors: publicRollbackErrors(status.pendingRuntimeRecovery.rollbackErrors)
        }
        : null
    return { recoveryRequired: recovery, pendingRuntimeRecovery: pending }
}

function configErrorResponse(config, error) {
    const detail = typeof config.service?.toPublicError === 'function'
        ? config.service.toPublicError(error)
        : {
            code: error?.code || 'CONFIG_ERROR',
            path: typeof error?.path === 'string' ? error.path : '',
            line: Number.isInteger(error?.line) ? error.line : null,
            column: Number.isInteger(error?.column) ? error.column : null
        }
    const status = config.getStatus()
    return {
        error: detail.code,
        ...detail,
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

function emptyMutationResult(config, origin = 'dashboard') {
    const status = config.getStatus()
    const pendingDeploymentApply = Array.isArray(status.pendingDeploymentApply)
        ? status.pendingDeploymentApply
        : (Array.isArray(status.deploymentApplyRequired) ? status.deploymentApplyRequired : [])
    return {
        origin,
        documentGeneration: status.documentGeneration,
        effectiveGeneration: status.effectiveGeneration,
        generation: status.documentGeneration,
        applied: [],
        reloaded: [],
        deploymentApplyRequired: [...pendingDeploymentApply],
        warnings: []
    }
}

module.exports = {
    assertExpectedGeneration,
    assertCurrentGeneration,
    configErrorResponse,
    configErrorStatus,
    emptyMutationResult,
    publicRecoveryStatus
}
