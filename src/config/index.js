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
    getOfficialRootOpenids: function() {
        return authConfig.getOfficialRootOpenids(this)
    },
    isRootAdmin: function(userId) {
        return authConfig.isRootAdmin(userId, this)
    },

    isGroupAdmin: function(groupId, userId) {
        return authConfig.isGroupAdmin(groupId, userId, this.groupConfigs, this)
    },

    addGroupAdmin: function(groupId, userId) {
        return authConfig.addGroupAdmin(groupId, userId, this.groupConfigs, () => this.save())
    },

    removeGroupAdmin: function(groupId, userId) {
        return authConfig.removeGroupAdmin(groupId, userId, this.groupConfigs, () => this.save())
    },

    isGroupEnabled: function(groupId) {
        return groupConfig.isGroupEnabled(this.getEnabledGroupsForProvider(), groupId)
    },

    enableGroup: function(groupId) {
        return groupConfig.enableGroup(this.getMutableEnabledGroupsForProvider(), groupId, () => this.save())
    },

    disableGroup: function(groupId) {
        return groupConfig.disableGroup(this.getMutableEnabledGroupsForProvider(), groupId, () => this.save())
    },

    ensureGroupConfig: function(groupId) {
        return groupConfig.ensureGroupConfig(this.groupConfigs, this.getMutableEnabledGroupsForProvider(), groupId, () => this.save())
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
            if (key === 'wsToken' || key === 'qqOfficialClientSecret') {
                snapshot[key] = this[key] ? '[REDACTED]' : ''
                return
            }
            const value = this[key]
            if (value && typeof value === 'object') {
                snapshot[key] = JSON.parse(JSON.stringify(value))
                return
            }
            snapshot[key] = value
        })
        snapshot.jwtSecret = this.jwtSecret ? '[REDACTED]' : ''
        return snapshot
    },

    getProviderScope: function(provider = null) {
        const raw = provider || this.qqProvider || 'napcat'
        return String(raw || '').trim().toLowerCase() === 'official' ? 'official' : 'napcat'
    },

    getEnabledGroupsForProvider: function(provider = null) {
        const scope = this.getProviderScope(provider)
        if (scope === 'napcat') return Array.isArray(this.enabledGroups) ? this.enabledGroups : []
        const scoped = this.providerScopedEnabledGroups || {}
        if (Array.isArray(scoped[scope])) return scoped[scope]
        return Array.isArray(this.enabledGroups) ? this.enabledGroups : []
    },

    getMutableEnabledGroupsForProvider: function(provider = null) {
        const scope = this.getProviderScope(provider)
        if (scope === 'napcat') {
            if (!Array.isArray(this.enabledGroups)) this.enabledGroups = []
            return this.enabledGroups
        }
        if (!this.providerScopedEnabledGroups || typeof this.providerScopedEnabledGroups !== 'object' || Array.isArray(this.providerScopedEnabledGroups)) {
            this.providerScopedEnabledGroups = {}
        }
        const scoped = this.providerScopedEnabledGroups
        if (!Array.isArray(scoped[scope])) {
            scoped[scope] = Array.isArray(this.enabledGroups) ? [...this.enabledGroups] : []
            this.providerScopedEnabledGroups = scoped
        }
        return scoped[scope]
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
            'videoDownloadCleanTimeout',
            'qqProvider',
            'qqOfficialAppId',
            'qqOfficialApiBase',
            'qqOfficialTokenUrl',
            'qqOfficialUseShardedGateway',
            'qqOfficialIntents',
            'qqOfficialGatewayAckTimeoutMs',
            'qqOfficialMediaUploadMode',
            'qqOfficialTempPublicBaseUrl',
            'qqOfficialRootOpenids',
            'qqOfficialAccountQpm',
            'qqOfficialGroupQpm',
            'qqOfficialQueueMaxSize'
        ]
        for (const key of keys) {
            snapshot[key] = this[key]
        }
        snapshot.qqOfficialClientSecretConfigured = Boolean(this.qqOfficialClientSecret)
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
