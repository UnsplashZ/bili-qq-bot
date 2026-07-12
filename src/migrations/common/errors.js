'use strict'

class MigrationError extends Error {
    constructor(code, message = code, details = {}) {
        super(message)
        this.name = 'MigrationError'
        this.code = String(code || 'MIGRATION_ERROR')
        this.details = details && typeof details === 'object' ? details : {}
    }
}

function publicError(error) {
    const code = error instanceof MigrationError
        ? error.code
        : (/^[A-Z][A-Z0-9_]{2,100}$/.test(String(error?.code || '')) ? String(error.code) : 'MIGRATION_INTERNAL_ERROR')
    return { code }
}

module.exports = {
    MigrationError,
    publicError
}
