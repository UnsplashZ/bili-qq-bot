'use strict'

const { CONFIG_SCHEMA_VERSION } = require('../../config/schemaV1')
const { validateConfig } = require('../../config/validator')
const { MigrationError } = require('../common/errors')

class ConfigSchemaMigrationRegistry {
    constructor(options = {}) {
        this.currentVersion = options.currentVersion || CONFIG_SCHEMA_VERSION
        this.validator = options.validator || validateConfig
        this.migrations = [...(options.migrations || [])].sort((left, right) => left.fromVersion - right.fromVersion)
    }

    migrate(value) {
        if (!value || !Number.isInteger(value.version)) throw new MigrationError('CONFIG_VERSION_INTEGER_REQUIRED')
        if (value.version > this.currentVersion) throw new MigrationError('CONFIG_SCHEMA_FUTURE_VERSION')
        let candidate = structuredClone(value)
        const applied = []
        while (candidate.version < this.currentVersion) {
            const migration = this.migrations.find((item) => item.fromVersion === candidate.version)
            if (!migration || migration.toVersion <= migration.fromVersion || typeof migration.migrate !== 'function') {
                throw new MigrationError('CONFIG_SCHEMA_MIGRATION_MISSING')
            }
            candidate = migration.migrate(structuredClone(candidate))
            if (!candidate || candidate.version !== migration.toVersion) throw new MigrationError('CONFIG_SCHEMA_MIGRATION_INVALID')
            applied.push(migration.id || `v${migration.fromVersion}-to-v${migration.toVersion}`)
        }
        try {
            candidate = this.validator(candidate)
        } catch (error) {
            throw new MigrationError('CONFIG_SCHEMA_VALIDATION_FAILED', 'CONFIG_SCHEMA_VALIDATION_FAILED', {
                path: typeof error?.path === 'string' ? error.path : ''
            })
        }
        return { config: candidate, applied }
    }
}

module.exports = { ConfigSchemaMigrationRegistry }
