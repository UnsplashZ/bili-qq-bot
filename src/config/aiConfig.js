const {
    AI_EDITOR_SNAPSHOT_FIELDS,
    AI_SENSITIVE_FIELDS,
    META,
    parseValue
} = require('./schema')
const {
    _overrides,
    cloneConfigValue,
    hasOwnOverride,
    getEffectiveConfigValueWithoutMutation
} = require('./store')

function createSensitiveFieldMeta(source, configured, masked, inheritedFrom = '') {
    return {
        source,
        configured: Boolean(configured),
        masked: Boolean(masked),
        inheritedFrom
    }
}

function getDirectEnvValue(envName, def, type) {
    if (!envName) return cloneConfigValue(def)
    const envVal = process.env[envName]
    if (envVal === undefined) return cloneConfigValue(def)
    return cloneConfigValue(parseValue(envVal, type))
}

function resolveSensitiveAiFieldSnapshot(field) {
    if (hasOwnOverride(field)) {
        const overrideValue = cloneConfigValue(_overrides[field])
        return {
            value: overrideValue,
            meta: createSensitiveFieldMeta('override', Boolean(overrideValue), false)
        }
    }

    if (field === 'aiChatApiUrl') {
        if (process.env.AI_CHAT_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            }
        }
        if (hasOwnOverride('aiApiUrl')) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiUrl), true, 'aiApiUrl')
            }
        }
        if (process.env.AI_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl')
            }
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', true, true)
        }
    }

    if (field === 'aiChatApiKey') {
        if (process.env.AI_CHAT_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            }
        }
        if (hasOwnOverride('aiApiKey')) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiKey), true, 'aiApiKey')
            }
        }
        if (process.env.AI_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey')
            }
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', false, true)
        }
    }

    if (field === 'aiEmbeddingApiUrl') {
        if (process.env.AI_EMBEDDING_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            }
        }
        if (process.env.AI_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl')
            }
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', true, true)
        }
    }

    if (field === 'aiEmbeddingApiKey') {
        if (process.env.AI_EMBEDDING_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            }
        }
        if (process.env.AI_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey')
            }
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', false, true)
        }
    }

    const meta = META[field]
    const directEnvValue = getDirectEnvValue(meta.env, meta.def, meta.type)
    const configured = Boolean(directEnvValue)
    return {
        value: '',
        meta: createSensitiveFieldMeta(
            meta.env && process.env[meta.env] !== undefined ? 'env' : 'default',
            configured,
            true
        )
    }
}

function buildAiEditorSnapshot() {
    const snapshot = {}
    const aiEditorMeta = {}

    AI_EDITOR_SNAPSHOT_FIELDS.forEach((field) => {
        if (AI_SENSITIVE_FIELDS.has(field)) {
            const resolved = resolveSensitiveAiFieldSnapshot(field)
            snapshot[field] = resolved.value
            aiEditorMeta[field] = resolved.meta
            return
        }

        snapshot[field] = getEffectiveConfigValueWithoutMutation(field, META)
    })

    snapshot.aiEditorMeta = aiEditorMeta
    return snapshot
}

function buildDashboardConfigSnapshot() {
    return {
        subscriptionCheckInterval: getEffectiveConfigValueWithoutMutation('subscriptionCheckInterval', META),
        linkCacheTimeout: getEffectiveConfigValueWithoutMutation('linkCacheTimeout', META),
        showId: getEffectiveConfigValueWithoutMutation('showId', META),
        previewGradientColor1: getEffectiveConfigValueWithoutMutation('previewGradientColor1', META),
        previewGradientColor2: getEffectiveConfigValueWithoutMutation('previewGradientColor2', META),
        videoDownloadEnabled: getEffectiveConfigValueWithoutMutation('videoDownloadEnabled', META),
        videoDownloadResolution: getEffectiveConfigValueWithoutMutation('videoDownloadResolution', META),
        videoDownloadMaxDuration: getEffectiveConfigValueWithoutMutation('videoDownloadMaxDuration', META),
        videoDownloadAutoClean: getEffectiveConfigValueWithoutMutation('videoDownloadAutoClean', META),
        videoDownloadCleanTimeout: getEffectiveConfigValueWithoutMutation('videoDownloadCleanTimeout', META),
        ...buildAiEditorSnapshot()
    }
}

function isAiEnabledForGroup(groupId, config) {
    if (!config.aiEnabled) return false

    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && typeof groupConfig.aiEnabled === 'boolean') {
        return groupConfig.aiEnabled
    }

    return true
}

function isRagEnabledForGroup(groupId, config) {
    if (!isAiEnabledForGroup(groupId, config)) {
        return false
    }

    if (!config.aiRagEnabled) {
        return false
    }

    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && typeof groupConfig.aiRagEnabled === 'boolean') {
        return groupConfig.aiRagEnabled
    }

    return true
}

function isVideoDownloadEnabledForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) {
        return groupConfig.videoDownloadEnabled
    }
    return config.videoDownloadEnabled
}

function getVideoDownloadResolutionForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadResolution' in groupConfig) {
        return groupConfig.videoDownloadResolution
    }
    return config.videoDownloadResolution
}

function getVideoDownloadMaxDurationForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) {
        return groupConfig.videoDownloadMaxDuration
    }
    return config.videoDownloadMaxDuration
}

module.exports = {
    buildAiEditorSnapshot,
    buildDashboardConfigSnapshot,
    isAiEnabledForGroup,
    isRagEnabledForGroup,
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup
}
