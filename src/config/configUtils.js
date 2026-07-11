'use strict'

const crypto = require('crypto')
const { normalizePath } = require('./schemaV1')
const { assertSafePath } = require('./validator')

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value
    seen.add(value)
    for (const child of Object.values(value)) deepFreeze(child, seen)
    return Object.freeze(value)
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        const result = {}
        for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key])
        return result
    }
    return value
}

function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value))
}

function hashBytes(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function hashValue(value) {
    return hashBytes(canonicalStringify(value))
}

function getIn(value, pathOrKey) {
    const segments = normalizePath(pathOrKey)
    let current = value
    for (const segment of segments) {
        if (current === null || current === undefined) return undefined
        current = current[segment]
    }
    return current
}

function setIn(value, pathOrKey, nextValue) {
    const segments = normalizePath(pathOrKey)
    assertSafePath(segments)
    if (segments.length === 0) throw new TypeError('Configuration path cannot be empty')
    let current = value
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index]
        if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
            current[segment] = {}
        }
        current = current[segment]
    }
    current[segments.at(-1)] = clone(nextValue)
    return value
}

function deleteIn(value, pathOrKey) {
    const segments = normalizePath(pathOrKey)
    assertSafePath(segments)
    if (segments.length === 0) throw new TypeError('Configuration path cannot be empty')
    let current = value
    for (let index = 0; index < segments.length - 1; index += 1) {
        current = current?.[segments[index]]
        if (!current || typeof current !== 'object') return false
    }
    return delete current[segments.at(-1)]
}

function valuesEqual(left, right) {
    return canonicalStringify(left) === canonicalStringify(right)
}

module.exports = {
    clone,
    deepFreeze,
    canonicalize,
    canonicalStringify,
    hashBytes,
    hashValue,
    getIn,
    setIn,
    deleteIn,
    valuesEqual
}
