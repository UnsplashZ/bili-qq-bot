'use strict'

const { MigrationError } = require('../migrations/common/errors')

const PUBLIC_CODES = new Set([
    'CONFIG_BOOTSTRAP_INVALID_INPUT',
    'CONFIG_BOOTSTRAP_RECOVERY_REQUIRED',
    'CONFIG_BOOTSTRAP_HANDOFF_INVALID',
    'CONFIG_SCHEMA_FUTURE_VERSION',
    'DATA_MIGRATION_FAILED',
    'MIGRATION_LEGACY_WRITER_UNSAFE',
    'DEPLOYMENT_APPLY_REQUIRED'
])

class ApplicationBootstrapError extends MigrationError {
    constructor(code, options = {}) {
        super(code, code, options.details || {})
        this.code = code
        this.cause = options.cause
    }
}

function normalizeBootstrapError(error) {
    if (error instanceof ApplicationBootstrapError) return error
    const code = String(error?.code || '')
    if (code === 'CONFIG_FUTURE_VERSION' || code === 'CONFIG_SCHEMA_FUTURE_VERSION') {
        return new ApplicationBootstrapError('CONFIG_SCHEMA_FUTURE_VERSION', { cause: error })
    }
    if (code.startsWith('DATA_')) return new ApplicationBootstrapError('DATA_MIGRATION_FAILED', { cause: error })
    if (code.startsWith('LEGACY_') || code.startsWith('CONFIG_') || code.startsWith('MIGRATION_')) {
        return new ApplicationBootstrapError('CONFIG_BOOTSTRAP_INVALID_INPUT', { cause: error })
    }
    return new ApplicationBootstrapError('CONFIG_BOOTSTRAP_RECOVERY_REQUIRED', { cause: error })
}

function toPublicBootstrapError(error) {
    const normalized = normalizeBootstrapError(error)
    return { code: PUBLIC_CODES.has(normalized.code) ? normalized.code : 'CONFIG_BOOTSTRAP_RECOVERY_REQUIRED' }
}

module.exports = { ApplicationBootstrapError, normalizeBootstrapError, toPublicBootstrapError }
