'use strict'

const {
    FIELD_GROUPS,
    LIMITS,
    getTypeSchema,
    getElementSchema,
    isEditableType
} = require('./schema')

class PreviewLayoutValidationError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.name = 'PreviewLayoutValidationError'
        this.statusCode = details.statusCode || 400
        this.details = details
    }
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PreviewLayoutValidationError(`${label} must be an object`)
    }
}

function measureJsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8')
}

function assertJsonSize(value, limit = LIMITS.jsonBytes) {
    const bytes = measureJsonBytes(value)
    if (bytes > limit) {
        throw new PreviewLayoutValidationError('preview layout payload is too large', {
            statusCode: 413,
            bytes,
            limit
        })
    }
}

function hasKeys(value) {
    return value && typeof value === 'object' && Object.keys(value).length > 0
}

function normalizeNumber(value, spec, path) {
    if (value === null) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PreviewLayoutValidationError(`${path} must be a finite number`)
    }
    if (spec.integer && !Number.isInteger(value)) {
        throw new PreviewLayoutValidationError(`${path} must be an integer`)
    }
    if (value < spec.min || value > spec.max) {
        throw new PreviewLayoutValidationError(`${path} is out of range`, {
            path,
            min: spec.min,
            max: spec.max
        })
    }
    return value
}

function normalizeEnum(value, allowed, path) {
    if (value === null) return undefined
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new PreviewLayoutValidationError(`${path} must be one of: ${allowed.join(', ')}`)
    }
    return value
}

function normalizeVisible(value, path) {
    if (value === null) return undefined
    if (typeof value !== 'boolean') {
        throw new PreviewLayoutValidationError(`${path} must be a boolean`)
    }
    return value
}

function normalizeFieldGroup(groupName, rawValue, path) {
    if (rawValue === null) return undefined
    assertPlainObject(rawValue, path)

    const groupSchema = FIELD_GROUPS[groupName]
    const normalized = {}

    for (const key of Object.keys(rawValue)) {
        const fieldSchema = groupSchema[key]
        if (!fieldSchema) {
            throw new PreviewLayoutValidationError(`unknown preview layout field: ${path}.${key}`)
        }

        let value
        if (fieldSchema.kind === 'number') {
            value = normalizeNumber(rawValue[key], fieldSchema.limit, `${path}.${key}`)
        } else if (fieldSchema.kind === 'enum') {
            value = normalizeEnum(rawValue[key], fieldSchema.values, `${path}.${key}`)
        } else {
            throw new PreviewLayoutValidationError(`unsupported preview layout field: ${path}.${key}`)
        }

        if (value !== undefined) {
            normalized[key] = value
        }
    }

    return hasKeys(normalized) ? normalized : undefined
}

function normalizeElementPatch(type, elementKey, rawElement) {
    if (rawElement === null) return undefined
    assertPlainObject(rawElement, `elements.${elementKey}`)

    const elementSchema = getElementSchema(type, elementKey)
    if (!elementSchema) {
        throw new PreviewLayoutValidationError(`unknown preview layout element: ${elementKey}`)
    }

    const controls = new Set(elementSchema.controls || [])
    const normalized = {}

    for (const key of Object.keys(rawElement)) {
        if (key === 'visible') {
            if (!controls.has('visible')) {
                throw new PreviewLayoutValidationError(`visible is not supported for element: ${elementKey}`)
            }
            const value = normalizeVisible(rawElement[key], `elements.${elementKey}.visible`)
            if (value !== undefined) normalized.visible = value
            continue
        }

        if (key === 'layout' || key === 'typography' || key === 'media') {
            if (!controls.has(key)) {
                throw new PreviewLayoutValidationError(`${key} is not supported for element: ${elementKey}`)
            }
            const value = normalizeFieldGroup(key, rawElement[key], `elements.${elementKey}.${key}`)
            if (value !== undefined) normalized[key] = value
            continue
        }

        throw new PreviewLayoutValidationError(`unknown preview layout field: elements.${elementKey}.${key}`)
    }

    return hasKeys(normalized) ? normalized : undefined
}

function normalizePreviewLayoutPatch(type, patch = {}, options = {}) {
    const { requireEditable = true, checkSize = false } = options
    if (checkSize) assertJsonSize(patch)

    const typeSchema = getTypeSchema(type)
    if (!typeSchema) {
        throw new PreviewLayoutValidationError(`unknown preview layout type: ${type}`)
    }
    if (requireEditable && !isEditableType(type)) {
        throw new PreviewLayoutValidationError(`preview layout type is not editable: ${type}`)
    }

    assertPlainObject(patch, 'patch')
    const normalized = {}

    for (const key of Object.keys(patch)) {
        if (key !== 'elements') {
            throw new PreviewLayoutValidationError(`unknown preview layout field: ${key}`)
        }
    }

    if (patch.elements !== undefined && patch.elements !== null) {
        assertPlainObject(patch.elements, 'patch.elements')
        const elements = {}
        for (const elementKey of Object.keys(patch.elements)) {
            const value = normalizeElementPatch(type, elementKey, patch.elements[elementKey])
            if (value !== undefined) {
                elements[elementKey] = value
            }
        }
        if (hasKeys(elements)) {
            normalized.elements = elements
        }
    } else if (patch.elements !== undefined) {
        throw new PreviewLayoutValidationError('patch.elements must be an object')
    }

    return normalized
}

function cleanEmptyLayoutBranches(value) {
    if (Array.isArray(value) || !value || typeof value !== 'object') return value

    const cleaned = {}
    for (const [key, child] of Object.entries(value)) {
        const childValue = cleanEmptyLayoutBranches(child)
        if (childValue && typeof childValue === 'object' && !Array.isArray(childValue) && Object.keys(childValue).length === 0) {
            continue
        }
        if (childValue !== undefined && childValue !== null) {
            cleaned[key] = childValue
        }
    }
    return cleaned
}

module.exports = {
    PreviewLayoutValidationError,
    assertJsonSize,
    measureJsonBytes,
    normalizePreviewLayoutPatch,
    cleanEmptyLayoutBranches
}
