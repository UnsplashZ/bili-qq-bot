'use strict'

const crypto = require('crypto')
const config = require('../../config')
const logger = require('../../utils/logger')
const { PREVIEW_LAYOUT_VERSION, isEditableType } = require('./schema')
const { normalizePreviewLayoutPatch, cleanEmptyLayoutBranches } = require('./normalizer')

function clone(value) {
    return JSON.parse(JSON.stringify(value || {}))
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeTwo(base = {}, override = {}) {
    const output = clone(base)

    for (const [key, value] of Object.entries(override || {})) {
        if (isPlainObject(value) && isPlainObject(output[key])) {
            output[key] = mergeTwo(output[key], value)
        } else {
            output[key] = clone(value)
        }
    }

    return output
}

function mergeLayoutConfigs(...configs) {
    return cleanEmptyLayoutBranches(configs.reduce((current, next) => {
        if (!next || Object.keys(next).length === 0) return current
        return mergeTwo(current, next)
    }, {}))
}

function getStoredPreviewLayoutConfig() {
    const raw = config.previewLayoutConfig
    if (!isPlainObject(raw)) {
        return {
            version: PREVIEW_LAYOUT_VERSION,
            global: {},
            groups: {}
        }
    }
    return {
        version: Number(raw.version) || PREVIEW_LAYOUT_VERSION,
        global: isPlainObject(raw.global) ? clone(raw.global) : {},
        groups: isPlainObject(raw.groups) ? clone(raw.groups) : {}
    }
}

function getScopePatch(rawConfig, scope, type, groupId) {
    if (scope === 'global') {
        return rawConfig.global?.[type] || {}
    }
    const groupKey = String(groupId || '')
    return rawConfig.groups?.[groupKey]?.[type] || {}
}

function normalizeStoredPatch(type, rawPatch, options = {}) {
    return normalizePreviewLayoutPatch(type, rawPatch || {}, {
        requireEditable: false,
        checkSize: false,
        ...options
    })
}

function getSavedEffectiveLayout(type, groupId = null, options = {}) {
    if (!isEditableType(type)) return {}

    const { tolerateInvalid = false, logScope = 'svc:preview-layout' } = options
    const rawConfig = getStoredPreviewLayoutConfig()

    try {
        const globalPatch = normalizeStoredPatch(type, getScopePatch(rawConfig, 'global', type))
        const groupPatch = groupId
            ? normalizeStoredPatch(type, getScopePatch(rawConfig, 'group', type, groupId))
            : {}
        return mergeLayoutConfigs(globalPatch, groupPatch)
    } catch (error) {
        if (!tolerateInvalid) throw error
        logger.logEvent('warn', 'PREVIEW_LAYOUT', logScope, 'saved-layout-invalid-fallback', {
            type,
            groupId: groupId ? String(groupId) : '',
            error: logger.getErrorMessage(error)
        })
        return {}
    }
}

function getPreviewLayoutConfigForScope(type, groupId = null, options = {}) {
    const rawConfig = getStoredPreviewLayoutConfig()
    const globalPatch = normalizeStoredPatch(type, getScopePatch(rawConfig, 'global', type), options)
    const groupPatch = groupId
        ? normalizeStoredPatch(type, getScopePatch(rawConfig, 'group', type, groupId), options)
        : {}
    const effective = mergeLayoutConfigs(globalPatch, groupPatch)

    return {
        global: globalPatch,
        group: groupPatch,
        effective,
        scopeMeta: {
            type,
            groupId: groupId ? String(groupId) : '',
            hasGlobalOverride: Object.keys(globalPatch).length > 0,
            hasGroupOverride: Object.keys(groupPatch).length > 0
        }
    }
}

function setNestedTypePatch(rawConfig, scope, type, groupId, patch) {
    const next = clone(rawConfig)
    next.version = PREVIEW_LAYOUT_VERSION
    if (!isPlainObject(next.global)) next.global = {}
    if (!isPlainObject(next.groups)) next.groups = {}

    if (scope === 'global') {
        if (Object.keys(patch).length > 0) {
            next.global[type] = patch
        } else {
            delete next.global[type]
        }
    } else {
        const groupKey = String(groupId)
        if (!isPlainObject(next.groups[groupKey])) next.groups[groupKey] = {}
        if (Object.keys(patch).length > 0) {
            next.groups[groupKey][type] = patch
        } else {
            delete next.groups[groupKey][type]
        }
        if (Object.keys(next.groups[groupKey]).length === 0) {
            delete next.groups[groupKey]
        }
    }

    if (Object.keys(next.global).length === 0) delete next.global
    if (Object.keys(next.groups).length === 0) delete next.groups
    return cleanEmptyLayoutBranches(next)
}

function savePreviewLayoutPatch(scope, type, patch, groupId = null) {
    const rawConfig = getStoredPreviewLayoutConfig()
    const normalizedPatch = normalizePreviewLayoutPatch(type, patch, {
        requireEditable: true,
        checkSize: true
    })
    const next = setNestedTypePatch(rawConfig, scope, type, groupId, normalizedPatch)
    config.previewLayoutConfig = next
    return normalizedPatch
}

function resetPreviewLayoutPatch(scope, type, groupId = null, element = null) {
    const rawConfig = getStoredPreviewLayoutConfig()
    const current = normalizePreviewLayoutPatch(type, getScopePatch(rawConfig, scope, type, groupId), {
        requireEditable: true
    })
    let nextPatch = {}

    if (element) {
        nextPatch = clone(current)
        if (nextPatch.elements) {
            delete nextPatch.elements[element]
            if (Object.keys(nextPatch.elements).length === 0) {
                delete nextPatch.elements
            }
        }
    }

    const next = setNestedTypePatch(rawConfig, scope, type, groupId, cleanEmptyLayoutBranches(nextPatch))
    config.previewLayoutConfig = next
    return nextPatch
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`
    }
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

function getPreviewLayoutSignature(type, groupId = null) {
    const effective = getSavedEffectiveLayout(type, groupId, {
        tolerateInvalid: true,
        logScope: 'svc:subscription'
    })
    if (!effective || Object.keys(effective).length === 0) {
        return 'default'
    }
    return crypto
        .createHash('sha256')
        .update(stableStringify(effective))
        .digest('hex')
        .slice(0, 16)
}

module.exports = {
    mergeLayoutConfigs,
    getStoredPreviewLayoutConfig,
    getSavedEffectiveLayout,
    getPreviewLayoutConfigForScope,
    savePreviewLayoutPatch,
    resetPreviewLayoutPatch,
    getPreviewLayoutSignature,
    stableStringify
}
