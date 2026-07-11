'use strict'

const YAML = require('yaml')
const { MigrationError } = require('../common/errors')

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_CONFIG_DEPTH = 40
const MAX_CONFIG_NODES = 20000
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function assertSafeObject(value, depth = 0, seen = new Set()) {
    if (depth > MAX_CONFIG_DEPTH) throw new MigrationError('CONFIG_MAX_DEPTH_EXCEEDED')
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) throw new MigrationError('CONFIG_CYCLIC_VALUE_FORBIDDEN')
    seen.add(value)
    if (Array.isArray(value)) {
        for (const item of value) assertSafeObject(item, depth + 1, seen)
    } else {
        for (const [key, item] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.has(key)) throw new MigrationError('CONFIG_FORBIDDEN_KEY')
            assertSafeObject(item, depth + 1, seen)
        }
    }
    seen.delete(value)
}

function parseConfigYaml(source, options = {}) {
    const text = String(source || '')
    if (Buffer.byteLength(text, 'utf8') > (options.maxBytes || MAX_CONFIG_BYTES)) {
        throw new MigrationError('CONFIG_MAX_SIZE_EXCEEDED')
    }
    const document = YAML.parseDocument(text, {
        schema: 'core',
        uniqueKeys: true,
        merge: false,
        prettyErrors: false,
        strict: true
    })
    if (document.errors.length > 0) {
        const first = document.errors[0]
        throw new MigrationError('CONFIG_YAML_PARSE_FAILED', 'CONFIG_YAML_PARSE_FAILED', {
            linePos: first.linePos?.[0] || null
        })
    }
    let aliasFound = false
    let nodeCount = 0
    YAML.visit(document, {
        Node() {
            nodeCount += 1
            if (nodeCount > (options.maxNodes || MAX_CONFIG_NODES)) {
                throw new MigrationError('CONFIG_MAX_NODES_EXCEEDED')
            }
        },
        Alias() {
            aliasFound = true
            return YAML.visit.BREAK
        }
    })
    if (aliasFound) throw new MigrationError('CONFIG_YAML_ALIAS_FORBIDDEN')
    let value
    try {
        value = document.toJS({ maxAliasCount: 0, mapAsMap: false })
    } catch {
        throw new MigrationError('CONFIG_YAML_CONVERSION_FAILED')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new MigrationError('CONFIG_ROOT_OBJECT_REQUIRED')
    }
    assertSafeObject(value)
    return { document, value }
}

function validateConfigObject(value, options = {}) {
    assertSafeObject(value)
    if (!Number.isInteger(value.version)) throw new MigrationError('CONFIG_VERSION_INTEGER_REQUIRED')
    if (value.version !== 1) throw new MigrationError(value.version > 1 ? 'CONFIG_FUTURE_VERSION' : 'CONFIG_VERSION_UNSUPPORTED')
    if (!value.qq || !['napcat', 'official'].includes(value.qq.provider)) throw new MigrationError('CONFIG_QQ_PROVIDER_INVALID')
    if (!value.dashboard || !Number.isInteger(value.dashboard.listenPort)) throw new MigrationError('CONFIG_DASHBOARD_PORT_INVALID')
    if (!value.pythonService || !Number.isInteger(value.pythonService.port)) throw new MigrationError('CONFIG_PYTHON_PORT_INVALID')
    if (typeof options.validator === 'function') {
        const result = options.validator(value)
        if (result === false) throw new MigrationError('CONFIG_VALIDATOR_REJECTED')
        if (result && result.valid === false) throw new MigrationError(result.code || 'CONFIG_VALIDATOR_REJECTED')
        if (result && result.value) return result.value
        if (result && typeof result === 'object' && !Array.isArray(result) && Number.isInteger(result.version)) return result
    }
    return value
}

function stringifyConfigYaml(value, options = {}) {
    const validated = validateConfigObject(value, options)
    return YAML.stringify(validated, {
        indent: 2,
        lineWidth: 0,
        minContentWidth: 0,
        defaultKeyType: 'PLAIN',
        defaultStringType: 'PLAIN'
    })
}

module.exports = {
    MAX_CONFIG_BYTES,
    MAX_CONFIG_DEPTH,
    MAX_CONFIG_NODES,
    parseConfigYaml,
    validateConfigObject,
    stringifyConfigYaml,
    assertSafeObject
}
