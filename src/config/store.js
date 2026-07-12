'use strict'

// Deprecated in-memory compatibility adapter. Production runtime persistence is
// owned exclusively by ConfigService/config.yaml. This module intentionally
// performs no filesystem or environment reads and never writes legacy files.

const { parseValue } = require('./schema')

const legacyState = {}

function hasOwnOverride(key) {
    return Object.prototype.hasOwnProperty.call(legacyState, key)
}

function cloneConfigValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return structuredClone(value)
    }
    return value
}

function legacyWriteDisabled() {
    const error = new Error('Legacy config store writes are disabled; use ConfigService.patch()')
    error.code = 'LEGACY_CONFIG_WRITE_DISABLED'
    return error
}

function save() {
    throw legacyWriteDisabled()
}

async function performSave() {
    throw legacyWriteDisabled()
}

function defineGetters(config, metaMap) {
    Object.keys(metaMap).forEach((key) => {
        const meta = metaMap[key]
        Object.defineProperty(config, key, {
            get() {
                if (meta.get) return meta.get.call(meta, legacyState)
                if (hasOwnOverride(key)) return legacyState[key]
                return cloneConfigValue(parseValue(meta.def, meta.type))
            },
            set() {
                throw legacyWriteDisabled()
            },
            enumerable: true,
            configurable: true
        })
    })
}

function getEffectiveConfigValueWithoutMutation(key, metaMap) {
    const meta = metaMap[key]
    if (!meta) return undefined
    if (hasOwnOverride(key)) return cloneConfigValue(legacyState[key])
    if (typeof meta.get === 'function') return cloneConfigValue(meta.get.call(meta, legacyState))
    return cloneConfigValue(parseValue(meta.def, meta.type))
}

module.exports = {
    legacyState,
    save,
    performSave,
    defineGetters,
    cloneConfigValue,
    hasOwnOverride,
    getEffectiveConfigValueWithoutMutation
}
