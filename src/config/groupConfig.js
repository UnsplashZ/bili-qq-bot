const { DEFAULT_LABEL_CONFIG } = require('./schema')
const {
    createDefaultSubscriptionAtAllRules,
    ensureNormalizedLabelConfigObject
} = require('./normalizers')
const logger = require('../utils/logger')

const initializingGroups = new Set()

function configLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:config', message, fields)
}

function getGroupConfig(groupConfigs, groupId, key, globalFallback) {
    if (groupId && groupConfigs[groupId] && groupConfigs[groupId][key] != null) {
        if (key === 'labelConfig') {
            const currentLabelConfig = groupConfigs[groupId][key]
            if (typeof currentLabelConfig !== 'object' || currentLabelConfig === null || Array.isArray(currentLabelConfig)) {
                groupConfigs[groupId][key] = { ...DEFAULT_LABEL_CONFIG }
            } else {
                ensureNormalizedLabelConfigObject(currentLabelConfig)
            }
            return groupConfigs[groupId][key]
        }

        return groupConfigs[groupId][key]
    }

    return globalFallback
}

function setGroupConfig(groupConfigs, groupId, key, value, saveFn) {
    if (!groupId) return
    if (!groupConfigs[groupId]) {
        groupConfigs[groupId] = {}
    }

    if (key === 'labelConfig') {
        const nextValue = value && typeof value === 'object' && !Array.isArray(value)
            ? { ...value }
            : {}
        groupConfigs[groupId][key] = ensureNormalizedLabelConfigObject(nextValue)
    } else {
        groupConfigs[groupId][key] = value
    }
    saveFn()
}

function appendGroupConfigArray(groupConfigs, groupId, key, value, saveFn) {
    if (!groupId) return false
    if (!groupConfigs[groupId]) {
        groupConfigs[groupId] = {}
    }

    if (!Array.isArray(groupConfigs[groupId][key])) {
        groupConfigs[groupId][key] = []
    }

    const arr = groupConfigs[groupId][key]
    if (!arr.includes(value)) {
        arr.push(value)
        saveFn()
        return true
    }
    return false
}

function removeGroupConfigArray(groupConfigs, groupId, key, value, saveFn) {
    if (!groupId || !groupConfigs[groupId]) return false

    const arr = groupConfigs[groupId][key]
    if (Array.isArray(arr)) {
        const index = arr.indexOf(value)
        if (index > -1) {
            arr.splice(index, 1)
            saveFn()
            return true
        }
    }
    return false
}

function ensureGroupConfig(groupConfigs, enabledGroups, groupId, saveFn) {
    const key = String(groupId)

    if (initializingGroups.has(key)) {
        return groupConfigs[key]
    }

    if (!groupConfigs[key]) {
        initializingGroups.add(key)

        configLog('info', 'group-config-auto-created', {
            groupId
        })

        groupConfigs[key] = {
            linkCacheTimeout: 5,
            labelConfig: { ...DEFAULT_LABEL_CONFIG },
            enableCookieSync: false,
            subscriptionAtAll: false,
            subscriptionAtAllRules: createDefaultSubscriptionAtAllRules(),
            cookieSyncGroupNames: [],
            blacklistedQQs: [],
            admins: [],
            nightMode: {
                mode: 'off',
                startTime: '21:00',
                endTime: '06:00'
            }
        }

        if (Array.isArray(enabledGroups) && enabledGroups.length > 0) {
            if (!enabledGroups.includes(key)) {
                enabledGroups.push(key)
                configLog('info', 'group-whitelist-auto-enabled', {
                    groupId
                })
            }
        }

        saveFn()
        initializingGroups.delete(key)
    }

    return groupConfigs[key]
}

function isGroupEnabled(enabledGroups, groupId) {
    if (!enabledGroups || enabledGroups.length === 0) return true
    return enabledGroups.includes(groupId.toString())
}

function enableGroup(enabledGroups, groupId, saveFn) {
    if (!enabledGroups) return

    const strId = groupId.toString()
    if (!enabledGroups.includes(strId)) {
        enabledGroups.push(strId)
        saveFn()
    }
}

function disableGroup(enabledGroups, groupId, saveFn) {
    if (!enabledGroups) return

    const strId = groupId.toString()
    const index = enabledGroups.indexOf(strId)
    if (index > -1) {
        enabledGroups.splice(index, 1)
    }
    saveFn()
}

function applyOverridePatch(overrides, { clear = [], set = {} } = {}, saveFn) {
    const clearKeys = Array.isArray(clear) ? clear : []
    const setEntries = set && typeof set === 'object' ? Object.entries(set) : []
    if (clearKeys.length === 0 && setEntries.length === 0) return

    clearKeys.forEach((key) => {
        delete overrides[key]
    })

    setEntries.forEach(([key, value]) => {
        overrides[key] = value
    })

    saveFn()
}

function deleteKeys(overrides, keys, saveFn) {
    if (!Array.isArray(keys)) return

    applyOverridePatch(overrides, { clear: keys }, saveFn)
    logger.logEvent('info', 'STORE', 'svc:config', 'config-reset', {
        keys: keys.join(',')
    })
}

module.exports = {
    getGroupConfig,
    setGroupConfig,
    appendGroupConfigArray,
    removeGroupConfigArray,
    ensureGroupConfig,
    isGroupEnabled,
    enableGroup,
    disableGroup,
    applyOverridePatch,
    deleteKeys
}
