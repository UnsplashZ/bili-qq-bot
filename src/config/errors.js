'use strict'

class ConfigError extends Error {
    constructor(code, message, details = {}) {
        super(message)
        this.name = this.constructor.name
        this.code = code
        this.path = details.path || ''
        this.line = details.line ?? null
        this.column = details.column ?? null
        this.statusCode = details.statusCode || 400
        this.cause = details.cause
    }
}

class ConfigParseError extends ConfigError {
    constructor(message, details = {}) {
        super('CONFIG_PARSE_ERROR', message, details)
    }
}

class ConfigValidationError extends ConfigError {
    constructor(message, details = {}) {
        super('CONFIG_VALIDATION_ERROR', message, details)
    }
}

class ConfigConflictError extends ConfigError {
    constructor(message = 'Configuration generation conflict', details = {}) {
        super('CONFIG_GENERATION_CONFLICT', message, { ...details, statusCode: 409 })
        this.conflictPaths = Array.isArray(details.conflictPaths) ? details.conflictPaths : []
    }
}

class ConfigWriteError extends ConfigError {
    constructor(message, details = {}) {
        super('CONFIG_WRITE_ERROR', message, { ...details, statusCode: 500 })
    }
}

class ConfigReloadError extends ConfigError {
    constructor(message, details = {}) {
        super('CONFIG_RELOAD_ERROR', message, { ...details, statusCode: 503 })
        this.phase = details.phase || null
        this.handlerId = details.handlerId || null
    }
}

module.exports = {
    ConfigError,
    ConfigParseError,
    ConfigValidationError,
    ConfigConflictError,
    ConfigWriteError,
    ConfigReloadError
}
