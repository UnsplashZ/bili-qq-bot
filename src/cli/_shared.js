'use strict'

const path = require('path')
const { readPrivateText } = require('../migrations/common/privateFile')
const { MigrationError, publicError } = require('../migrations/common/errors')

function parseArgs(argv) {
    const result = { _: [] }
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index]
        if (!token.startsWith('--')) {
            result._.push(token)
            continue
        }
        const key = token.slice(2)
        if (!key) throw new MigrationError('CLI_ARGUMENT_INVALID')
        const next = argv[index + 1]
        if (next === undefined || next.startsWith('--')) {
            result[key] = true
        } else {
            result[key] = next
            index += 1
        }
    }
    return result
}

function requireOption(args, key) {
    const value = args[key]
    if (typeof value !== 'string' || !value) throw new MigrationError('CLI_REQUIRED_OPTION_MISSING')
    return value
}

function readProtectedJson(filePath, { required = true } = {}) {
    if (!filePath && !required) return {}
    if (!filePath) throw new MigrationError('CLI_INPUT_FILE_REQUIRED')
    let value
    try {
        value = JSON.parse(readPrivateText(filePath))
    } catch {
        throw new MigrationError('CLI_INPUT_JSON_INVALID')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MigrationError('CLI_INPUT_JSON_INVALID')
    return value
}

function writeOutput(value, asJson = false) {
    if (asJson) {
        process.stdout.write(`${JSON.stringify(value)}\n`)
        return
    }
    if (typeof value === 'string') {
        process.stdout.write(`${value}\n`)
        return
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function exitWithError(error, asJson = false) {
    const payload = { ok: false, error: publicError(error) }
    if (asJson) process.stderr.write(`${JSON.stringify(payload)}\n`)
    else process.stderr.write(`${payload.error.code}\n`)
    process.exitCode = 1
}

function resolvePath(value, fallback = null) {
    if (!value && fallback === null) return null
    return path.resolve(value || fallback)
}

function loadConfigValidator() {
    try {
        const validatorModule = require('../config/validator')
        const validate = validatorModule.validateConfig || validatorModule.validate || validatorModule
        if (typeof validate !== 'function') return null
        return (value) => {
            const result = validate(value, { source: 'migration-cli' })
            if (result && typeof result.then === 'function') throw new MigrationError('CONFIG_ASYNC_VALIDATOR_UNSUPPORTED')
            return { valid: true, value: result }
        }
    } catch (error) {
        if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('config/validator')) return null
        throw error
    }
}

module.exports = {
    parseArgs,
    requireOption,
    readProtectedJson,
    writeOutput,
    exitWithError,
    resolvePath,
    loadConfigValidator
}
