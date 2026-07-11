'use strict'

const {
    CONFIG_SCHEMA,
    CONFIG_SCHEMA_VERSION,
    createDefaultFromSchema
} = require('./schemaV1')
const { ConfigValidationError } = require('./errors')

const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function pathLabel(segments) {
    if (!segments.length) return '/'
    return `/${segments.map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
}

function fail(message, path) {
    throw new ConfigValidationError(message, { path: pathLabel(path) })
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function canonicalHttpOrigin(value) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null
    try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
            url.pathname !== '/' || url.search || url.hash || value !== url.origin) {
            return null
        }
        return url.origin
    } catch {
        return null
    }
}

function validateDashboardAllowedOrigins(value, path = ['dashboard', 'allowedOrigins']) {
    if (!Array.isArray(value)) fail('Expected array', path)
    const result = value.map((origin, index) => {
        const canonical = canonicalHttpOrigin(origin)
        if (!canonical) fail('Expected canonical HTTP(S) origin', [...path, index])
        return canonical
    })
    if (new Set(result).size !== result.length) fail('Array items must be unique', path)
    return result
}

function validateUnknown(value, path) {
    if (!value || typeof value !== 'object') return clone(value)
    if (Array.isArray(value)) return value.map((child, index) => validateUnknown(child, [...path, index]))
    const result = {}
    for (const [key, child] of Object.entries(value)) {
        if (DANGEROUS_SEGMENTS.has(key)) fail('Dangerous object key is not allowed', [...path, key])
        result[key] = validateUnknown(child, [...path, key])
    }
    return result
}

function validateScalar(value, schema, path) {
    if (schema.type === 'string') {
        if (typeof value !== 'string') fail('Expected string', path)
        if (schema.allowEmpty === false && value.length === 0) fail('Empty value is not allowed', path)
        if (schema.enum && !schema.enum.includes(value)) fail('Unsupported value', path)
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('Value does not match required format', path)
        if (schema.format === 'http-origin' && !canonicalHttpOrigin(value)) {
            fail('Expected canonical HTTP(S) origin', path)
        }
        if (schema.minimumLength !== undefined && value.length < schema.minimumLength) fail('String is too short', path)
        if (schema.maximumLength !== undefined && value.length > schema.maximumLength) fail('String is too long', path)
        return value
    }

    if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') fail('Expected boolean', path)
        return value
    }

    if (schema.type === 'integer') {
        if (!Number.isSafeInteger(value)) fail('Expected safe integer', path)
    } else if (schema.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('Expected finite number', path)
    }

    if (schema.enum && !schema.enum.includes(value)) fail('Unsupported value', path)
    if (schema.minimum !== undefined && value < schema.minimum) fail('Value is below minimum', path)
    if (schema.maximum !== undefined && value > schema.maximum) fail('Value is above maximum', path)
    return value
}

function validateNode(value, schema, path = [], options = {}) {
    const applyDefaults = options.applyDefaults !== false

    if (value === undefined) {
        if (schema.required === true) fail('Required value is missing', path)
        return applyDefaults ? createDefaultFromSchema(schema) : undefined
    }

    if (schema.type === 'unknown') return validateUnknown(value, path)

    if (schema.type === 'string' || schema.type === 'boolean' || schema.type === 'integer' || schema.type === 'number') {
        return validateScalar(value, schema, path)
    }

    if (schema.type === 'array') {
        if (!Array.isArray(value)) fail('Expected array', path)
        if (schema.minimumItems !== undefined && value.length < schema.minimumItems) fail('Array has too few items', path)
        if (schema.maximumItems !== undefined && value.length > schema.maximumItems) fail('Array has too many items', path)
        const result = value.map((item, index) => validateNode(item, schema.item, [...path, index], options))
        if (schema.uniqueItems) {
            const keys = result.map((item) => JSON.stringify(item))
            if (new Set(keys).size !== keys.length) fail('Array items must be unique', path)
        }
        return result
    }

    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected object', path)
        const result = {}
        for (const key of Object.keys(value)) {
            if (DANGEROUS_SEGMENTS.has(key)) fail('Dangerous object key is not allowed', [...path, key])
            if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) {
                if (schema.additionalProperties === false) fail('Unknown configuration key', [...path, key])
                continue
            }
        }
        for (const [key, childSchema] of Object.entries(schema.properties || {})) {
            if (schema.partial && value[key] === undefined) continue
            const childValue = validateNode(value[key], childSchema, [...path, key], options)
            if (childValue !== undefined || !schema.partial) result[key] = childValue
        }
        return result
    }

    if (schema.type === 'map') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected map object', path)
        const result = {}
        const keyPattern = new RegExp(schema.keyPattern || '^.+$')
        for (const [key, child] of Object.entries(value)) {
            if (DANGEROUS_SEGMENTS.has(key)) fail('Dangerous map key is not allowed', [...path, key])
            if (!keyPattern.test(key)) fail('Invalid map key', [...path, key])
            result[key] = validateNode(child, schema.value, [...path, key], options)
        }
        return result
    }

    fail('Unsupported schema type', path)
}

function validateConfig(input, options = {}) {
    const normalized = validateNode(input, options.schema || CONFIG_SCHEMA, [], options)
    if (normalized.version !== CONFIG_SCHEMA_VERSION) {
        throw new ConfigValidationError('Unsupported configuration version', { path: '/version' })
    }
    return normalized
}

function assertSafePath(segments) {
    for (const segment of segments) {
        if (DANGEROUS_SEGMENTS.has(String(segment))) {
            throw new ConfigValidationError('Dangerous path segment is not allowed', { path: pathLabel(segments) })
        }
    }
}

module.exports = {
    DANGEROUS_SEGMENTS,
    validateConfig,
    validateNode,
    assertSafePath,
    pathLabel,
    canonicalHttpOrigin,
    validateDashboardAllowedOrigins
}
