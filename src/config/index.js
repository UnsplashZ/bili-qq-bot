const {
    META,
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG
} = require('./schema')
const store = require('./store')
const {
    normalizeSubscriptionAtAllRules,
    createDefaultSubscriptionAtAllRules,
    normalizeLabelConfig
} = require('./normalizers')
const { attachToConfig } = require('./jwtSecretOwner')
const groupConfig = require('./groupConfig')
const authConfig = require('./authConfig')

const config = {
    _overrides: store._overrides,
    _saveTimer: null,
    _saveCount: 0,
    _saveErrorCount: 0,

    save: function() {
        return store.save(this)
    },

    _performSave: function() {
        return store.performSave(this)
    },

    getGroupConfig: function(groupId, key) {
        return groupConfig.getGroupConfig(this.groupConfigs, groupId, key, this[key])
    },

    setGroupConfig: function(groupId, key, value) {
        return groupConfig.setGroupConfig(this.groupConfigs, groupId, key, value, () => this.save())
    },

    appendGroupConfigArray: function(groupId, key, value) {
        return groupConfig.appendGroupConfigArray(this.groupConfigs, groupId, key, value, () => this.save())
    },

    removeGroupConfigArray: function(groupId, key, value) {
        return groupConfig.removeGroupConfigArray(this.groupConfigs, groupId, key, value, () => this.save())
    },

    getRootAdminQQ: authConfig.getRootAdminQQ,
    isRootAdmin: authConfig.isRootAdmin,

    isGroupAdmin: function(groupId, userId) {
        return authConfig.isGroupAdmin(groupId, userId, this.groupConfigs)
    },

    addGroupAdmin: function(groupId, userId) {
        return authConfig.addGroupAdmin(groupId, userId, this.groupConfigs, () => this.save())
    },

    removeGroupAdmin: function(groupId, userId) {
        return authConfig.removeGroupAdmin(groupId, userId, this.groupConfigs, () => this.save())
    },

    isGroupEnabled: function(groupId) {
        return groupConfig.isGroupEnabled(this.enabledGroups, groupId)
    },

    enableGroup: function(groupId) {
        if (!this.enabledGroups) this.enabledGroups = []
        return groupConfig.enableGroup(this.enabledGroups, groupId, () => this.save())
    },

    disableGroup: function(groupId) {
        return groupConfig.disableGroup(this.enabledGroups, groupId, () => this.save())
    },

    ensureGroupConfig: function(groupId) {
        return groupConfig.ensureGroupConfig(this.groupConfigs, this.enabledGroups, groupId, () => this.save())
    },

    applyOverridePatch: function(patch = {}) {
        return groupConfig.applyOverridePatch(this._overrides, patch, () => this.save())
    },

    deleteKeys: function(keys) {
        return groupConfig.deleteKeys(this._overrides, keys, () => this.save())
    },

    getConfigSnapshot: function() {
        const snapshot = {}
        Object.keys(META).forEach((key) => {
            const value = this[key]
            if (value && typeof value === 'object') {
                snapshot[key] = JSON.parse(JSON.stringify(value))
                return
            }
            snapshot[key] = value
        })
        snapshot.jwtSecret = this.jwtSecret
        return snapshot
    },

    getDashboardConfigSnapshot: function() {
        const snapshot = {}
        const keys = [
            'subscriptionCheckInterval',
            'linkCacheTimeout',
            'showId',
            'previewGradientColor1',
            'previewGradientColor2',
            'videoDownloadEnabled',
            'videoDownloadResolution',
            'videoDownloadMaxDuration',
            'videoDownloadAutoClean',
            'videoDownloadCleanTimeout'
        ]
        for (const key of keys) {
            snapshot[key] = this[key]
        }
        return snapshot
    }
}

store.defineGetters(config, META)
attachToConfig(config)

config.isVideoDownloadEnabledForGroup = function(groupId) {
    const currentGroupConfig = config.groupConfigs[String(groupId)]
    if (currentGroupConfig && 'videoDownloadEnabled' in currentGroupConfig) {
        return currentGroupConfig.videoDownloadEnabled
    }
    return config.videoDownloadEnabled
}

config.getVideoDownloadResolutionForGroup = function(groupId) {
    const currentGroupConfig = config.groupConfigs[String(groupId)]
    if (currentGroupConfig && 'videoDownloadResolution' in currentGroupConfig) {
        return currentGroupConfig.videoDownloadResolution
    }
    return config.videoDownloadResolution
}

config.getVideoDownloadMaxDurationForGroup = function(groupId) {
    const currentGroupConfig = config.groupConfigs[String(groupId)]
    if (currentGroupConfig && 'videoDownloadMaxDuration' in currentGroupConfig) {
        return currentGroupConfig.videoDownloadMaxDuration
    }
    return config.videoDownloadMaxDuration
}

config.createDefaultSubscriptionAtAllRules = createDefaultSubscriptionAtAllRules
config.normalizeSubscriptionAtAllRules = normalizeSubscriptionAtAllRules
config.SUBSCRIPTION_AT_ALL_SOURCE_KEYS = SUBSCRIPTION_AT_ALL_SOURCE_KEYS
config.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = SUBSCRIPTION_AT_ALL_CATEGORY_KEYS
config.DEFAULT_LABEL_CONFIG = DEFAULT_LABEL_CONFIG
config.normalizeLabelConfig = normalizeLabelConfig

module.exports = config
