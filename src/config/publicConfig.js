'use strict'

const { CONFIG_SCHEMA, resolveSchemaNode, normalizePath } = require('./schemaV1')

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function publicValue(value, schema, inheritedSecret = false) {
    const secret = inheritedSecret || Boolean(schema?.secret)
    if (secret) return { configured: value !== undefined && value !== null && value !== '' }
    if (!schema) return undefined

    if (schema.type === 'object') {
        const result = {}
        for (const [key, childSchema] of Object.entries(schema.properties || {})) {
            if (value && Object.prototype.hasOwnProperty.call(value, key)) {
                result[key] = publicValue(value[key], childSchema, false)
            }
        }
        return result
    }
    if (schema.type === 'map') {
        const result = {}
        for (const [key, child] of Object.entries(value || {})) {
            result[key] = publicValue(child, schema.value, false)
        }
        return result
    }
    if (schema.type === 'array') {
        return Array.isArray(value) ? value.map((item) => publicValue(item, schema.item, false)) : []
    }
    return clone(value)
}

function toPublicConfig(value, schema = CONFIG_SCHEMA) {
    return publicValue(value, schema)
}

function toPublicDiff(diff) {
    if (!Array.isArray(diff)) return []
    return diff.map((entry) => {
        const schema = resolveSchemaNode(entry.path)
        return {
            path: Array.isArray(entry.path) ? [...entry.path] : normalizePath(entry.path),
            before: publicValue(entry.before, schema),
            after: publicValue(entry.after, schema),
            effects: Array.isArray(entry.effects) ? [...entry.effects] : [],
            deploymentApplyRequired: Boolean(entry.deploymentApplyRequired)
        }
    })
}

function toPublicError(error) {
    return {
        code: typeof error?.code === 'string' ? error.code : 'CONFIG_ERROR',
        path: typeof error?.path === 'string' ? error.path : '',
        line: Number.isInteger(error?.line) ? error.line : null,
        column: Number.isInteger(error?.column) ? error.column : null
    }
}

module.exports = {
    toPublicConfig,
    toPublicDiff,
    toPublicError,
    publicValue
}
