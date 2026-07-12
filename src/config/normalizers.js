const {
    AT_ALL_SOURCE_KEYS: SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    AT_ALL_CATEGORY_KEYS: SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG
} = require('./schemaV1')

function normalizeIdList(values) {
    if (!Array.isArray(values)) return []

    const normalized = []
    for (const value of values) {
        if (value === null || value === undefined) continue
        const uid = String(value).trim()
        if (!/^\d+$/.test(uid)) continue
        if (!normalized.includes(uid)) normalized.push(uid)
    }
    return normalized
}

function createDefaultSubscriptionAtAllRules() {
    const sources = {}
    const categories = {}

    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => {
        sources[key] = true
    })
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => {
        categories[key] = true
    })

    return {
        sources,
        categories,
        manualDisabledIds: [],
        cookieSyncDisabledIds: []
    }
}

function normalizeSubscriptionAtAllRules(input) {
    const defaults = createDefaultSubscriptionAtAllRules()
    const raw = input && typeof input === 'object' ? input : {}
    const sourceInput = raw.sources && typeof raw.sources === 'object' ? raw.sources : {}
    const categoryInput = raw.categories && typeof raw.categories === 'object' ? raw.categories : {}

    const normalizedSources = {}
    const normalizedCategories = {}

    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => {
        normalizedSources[key] = typeof sourceInput[key] === 'boolean'
            ? sourceInput[key]
            : defaults.sources[key]
    })
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => {
        normalizedCategories[key] = typeof categoryInput[key] === 'boolean'
            ? categoryInput[key]
            : defaults.categories[key]
    })

    return {
        sources: normalizedSources,
        categories: normalizedCategories,
        manualDisabledIds: normalizeIdList(raw.manualDisabledIds),
        cookieSyncDisabledIds: normalizeIdList(raw.cookieSyncDisabledIds)
    }
}

function ensureNormalizedLabelConfigObject(input) {
    const target = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {}

    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        if (typeof target[key] !== 'boolean') {
            target[key] = DEFAULT_LABEL_CONFIG[key]
        }
    })

    return target
}

function normalizeLabelConfig(input) {
    const raw = input && typeof input === 'object' ? input : {}
    const normalized = {}

    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        normalized[key] = typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_LABEL_CONFIG[key]
    })

    return normalized
}

module.exports = {
    normalizeIdList,
    createDefaultSubscriptionAtAllRules,
    normalizeSubscriptionAtAllRules,
    ensureNormalizedLabelConfigObject,
    normalizeLabelConfig
}
