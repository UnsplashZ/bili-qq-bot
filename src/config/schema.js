const path = require('path')
const dotenv = require('dotenv')

const CONFIG_DIR = path.join(__dirname, '../../config')
dotenv.config({ path: path.join(CONFIG_DIR, '.env') })

const SUBSCRIPTION_AT_ALL_SOURCE_KEYS = ['manual', 'cookieSync']
const SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = [
    'video',
    'dynamic',
    'live',
    'article',
    'bangumi',
    'movie',
    'tv',
    'guocha',
    'doc',
    'variety'
]

const DEFAULT_LABEL_CONFIG = {
    video: true,
    bangumi: true,
    article: true,
    live: true,
    dynamic: true,
    user: true,
    interactive_video: true,
    favorite_list: true,
    audio: true,
    audio_list: true,
    topic: true,
    channel_series: true,
    article_list: true,
    note: true,
    cheese_video: true,
    movie: true,
    tv: true,
    guocha: true,
    doc: true,
    variety: true
}

const AI_EDITOR_SNAPSHOT_FIELDS = [
    'aiApiUrl',
    'aiApiKey',
    'aiProbability',
    'aiContextLimit',
    'aiTemperature',
    'aiHistoryMaxSize',
    'aiEnableVectorCache',
    'aiVectorSimilarityThreshold',
    'aiVectorSearchLimit',
    'aiMemorySafetyLimit',
    'aiChatApiUrl',
    'aiChatApiKey',
    'aiChatModel',
    'aiChatProxy',
    'aiChatSystemPrompt',
    'aiChatBaseTimeoutSeconds',
    'aiChatToolTimeoutSeconds',
    'aiChatMaxTimeoutSeconds',
    'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey',
    'aiEmbeddingModel',
    'aiEmbeddingProxy',
    'aiEnabled',
    'aiRagEnabled',
    'aiProfileEnabled'
]

const AI_SENSITIVE_FIELDS = new Set([
    'aiApiUrl',
    'aiApiKey',
    'aiChatApiUrl',
    'aiChatApiKey',
    'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey'
])

const parsers = {
    string: (val) => String(val),
    int: (val) => {
        const parsed = parseInt(val, 10)
        return isNaN(parsed) ? 0 : parsed
    },
    float: (val) => {
        const parsed = parseFloat(val)
        return isNaN(parsed) ? 0.0 : parsed
    },
    bool: (val) => {
        if (typeof val === 'boolean') return val
        if (typeof val === 'string') {
            const lower = val.toLowerCase().trim()
            if (lower === 'true' || lower === '1' || lower === 'yes') return true
            if (lower === 'false' || lower === '0' || lower === 'no') return false
        }
        return Boolean(val)
    },
    array: (val) => {
        if (Array.isArray(val)) return val
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val)
                return Array.isArray(parsed) ? parsed : []
            } catch {
                return []
            }
        }
        return []
    },
    object: (val) => {
        if (typeof val === 'object' && val !== null) return val
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val)
                return typeof parsed === 'object' ? parsed : {}
            } catch {
                return {}
            }
        }
        return {}
    }
}

function parseValue(val, type) {
    if (val === undefined || val === null) return val
    const parser = parsers[type]
    return parser ? parser(val) : val
}

const META = {
    wsUrl: { env: 'WS_URL', def: 'ws://localhost:3001', type: 'string' },
    wsToken: { env: 'WS_TOKEN', def: '', type: 'string' },

    aiApiUrl: { env: 'AI_API_URL', def: 'https://api.openai.com/v1/chat/completions', type: 'string' },
    aiApiKey: { env: 'AI_API_KEY', def: '', type: 'string' },
    aiModel: { env: 'AI_MODEL', def: 'gpt-3.5-turbo', type: 'string' },
    aiSystemPrompt: { env: 'AI_SYSTEM_PROMPT', def: '你是一个有用的助手。', type: 'string' },
    aiProbability: { env: 'AI_PROBABILITY', def: 0.1, type: 'float' },
    aiContextLimit: { env: null, def: 10, type: 'int' },
    aiTemperature: { env: 'AI_TEMPERATURE', def: 1.0, type: 'float' },

    aiEnabled: { env: 'AI_ENABLED', def: true, type: 'bool' },
    aiRagEnabled: { env: 'AI_RAG_ENABLED', def: true, type: 'bool' },
    aiAgentRuntimeV2: { env: 'AI_AGENT_RUNTIME_V2', def: false, type: 'bool' },

    aiChatApiUrl: {
        env: 'AI_CHAT_API_URL',
        def: null,
        type: 'string',
        get: function(overrides) {
            if ('aiChatApiUrl' in overrides) return overrides.aiChatApiUrl
            const envVal = process.env.AI_CHAT_API_URL
            if (envVal) return envVal
            if ('aiApiUrl' in overrides) return overrides.aiApiUrl
            return process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions'
        }
    },
    aiChatApiKey: {
        env: 'AI_CHAT_API_KEY',
        def: null,
        type: 'string',
        get: function(overrides) {
            if ('aiChatApiKey' in overrides) return overrides.aiChatApiKey
            const envVal = process.env.AI_CHAT_API_KEY
            if (envVal) return envVal
            if ('aiApiKey' in overrides) return overrides.aiApiKey
            return process.env.AI_API_KEY || ''
        }
    },
    aiChatModel: {
        env: 'AI_CHAT_MODEL',
        def: 'gpt-3.5-turbo',
        type: 'string',
        get: function(overrides) {
            if ('aiChatModel' in overrides) return overrides.aiChatModel
            const envVal = process.env.AI_CHAT_MODEL
            if (envVal) return envVal
            if ('aiModel' in overrides) return overrides.aiModel
            return process.env.AI_MODEL || this.def
        }
    },
    aiChatProxy: { env: 'AI_CHAT_PROXY', def: null, type: 'string' },
    aiChatSystemPrompt: {
        env: 'AI_CHAT_SYSTEM_PROMPT',
        def: '你是一个有用的助手',
        type: 'string',
        get: function(overrides) {
            if ('aiChatSystemPrompt' in overrides) return overrides.aiChatSystemPrompt
            const envVal = process.env.AI_CHAT_SYSTEM_PROMPT
            if (envVal) return envVal
            if ('aiSystemPrompt' in overrides) return overrides.aiSystemPrompt
            return process.env.AI_SYSTEM_PROMPT || this.def
        }
    },
    aiChatBaseTimeoutSeconds: { env: null, def: 30, type: 'int' },
    aiChatToolTimeoutSeconds: { env: null, def: 2, type: 'int' },
    aiChatMaxTimeoutSeconds: { env: null, def: 45, type: 'int' },

    aiEmbeddingApiUrl: {
        env: 'AI_EMBEDDING_API_URL',
        def: 'https://api.openai.com/v1/embeddings',
        type: 'string',
        get: function(overrides) {
            if ('aiEmbeddingApiUrl' in overrides) return overrides.aiEmbeddingApiUrl
            const envVal = process.env.AI_EMBEDDING_API_URL
            if (envVal) return envVal
            const aiApiUrl = process.env.AI_API_URL
            if (aiApiUrl) return aiApiUrl.replace('/chat/completions', '/embeddings')
            return this.def
        }
    },
    aiEmbeddingApiKey: {
        env: 'AI_EMBEDDING_API_KEY',
        def: '',
        type: 'string',
        get: function(overrides) {
            if ('aiEmbeddingApiKey' in overrides) return overrides.aiEmbeddingApiKey
            const envVal = process.env.AI_EMBEDDING_API_KEY
            if (envVal) return envVal
            return process.env.AI_API_KEY || ''
        }
    },
    aiEmbeddingModel: { env: 'AI_EMBEDDING_MODEL', def: 'text-embedding-3-small', type: 'string' },
    aiEmbeddingProxy: { env: 'AI_EMBEDDING_PROXY', def: null, type: 'string' },

    aiHistoryMaxSize: { env: null, def: 200 * 1024 * 1024, type: 'int' },
    aiVectorMaxSize: { env: null, def: 200 * 1024 * 1024, type: 'int' },
    aiVectorSimilarityThreshold: { env: null, def: 0.4, type: 'float' },
    aiVectorSearchLimit: { env: null, def: 3, type: 'int' },
    aiShortMessageThreshold: { env: null, def: 5, type: 'int' },
    aiMemorySafetyLimit: { env: null, def: 5000, type: 'int' },
    aiVectorMemoryLimit: { env: null, def: 10000, type: 'int' },
    aiTrimRatio: { env: null, def: 0.1, type: 'float' },
    aiVectorBatchLoadSize: { env: null, def: 1000, type: 'int' },
    aiEnableVectorCache: { env: null, def: true, type: 'bool' },
    aiEnableSmartTrim: { env: null, def: true, type: 'bool' },
    aiStructuredContextEnabled: { env: null, def: true, type: 'bool' },
    aiIdentityRagMode: { env: null, def: 'strict', type: 'string' },
    aiAdminClaimRequiresTool: { env: null, def: true, type: 'bool' },
    aiReplyGateEnabled: { env: null, def: true, type: 'bool' },
    aiContextSelectorEnabled: { env: null, def: true, type: 'bool' },
    aiResponseModeEnabled: { env: null, def: true, type: 'bool' },
    aiPromptAssemblerEnabled: { env: null, def: true, type: 'bool' },
    aiReplyScoreThreshold: { env: null, def: 45, type: 'int' },
    aiBusyReplyScoreThreshold: { env: null, def: 80, type: 'int' },
    aiBusyWindowSeconds: { env: null, def: 10, type: 'int' },
    aiBusyMessageCount: { env: null, def: 12, type: 'int' },
    aiReplyCooldownMs: { env: null, def: 15000, type: 'int' },
    aiMaxRepliesPerWindow: { env: null, def: 3, type: 'int' },
    aiBotName: { env: null, def: '', type: 'string' },
    aiBotAliases: { env: null, def: [], type: 'array', lazyInit: true },

    aiProfileEnabled: { env: null, def: false, type: 'bool' },
    aiProfileMinMessages: { env: null, def: 30, type: 'int' },
    aiProfileUpdateInterval: { env: null, def: 50, type: 'int' },
    aiProfileMaxLength: { env: null, def: 200, type: 'int' },

    pythonPath: {
        env: 'PYTHON_PATH',
        def: 'python3',
        type: 'string',
        get: function(overrides) {
            if ('pythonPath' in overrides) return overrides.pythonPath
            const envVal = process.env.PYTHON_PATH
            if (envVal) return envVal
            const venvPath = path.join(__dirname, '../../venv/bin/python')
            if (require('fs').existsSync(venvPath)) return venvPath
            return this.def
        }
    },
    dashboardPort: { env: 'DASHBOARD_PORT', def: 3000, type: 'int' },
    dashboardPassword: { env: 'DASHBOARD_PASSWORD', def: 'admin', type: 'string' },
    dashboardAllowedOrigins: { env: 'DASHBOARD_ALLOWED_ORIGINS', def: '', type: 'string' },
    biliServerPort: { env: 'BILI_SERVER_PORT', def: 10001, type: 'int' },
    biliScriptPath: { env: null, def: './src/services/bili_server.py', type: 'string' },
    useBase64Send: { env: 'USE_BASE64_SEND', def: false, type: 'bool' },
    napcatTempPath: { env: 'NAPCAT_TEMP_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },
    napcatReadPath: { env: 'NAPCAT_READ_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },

    linkCacheTimeout: { env: null, def: 600, type: 'int' },
    dataCacheTTL: { env: 'DATA_CACHE_TTL', def: 3600, type: 'int' },
    subscriptionCheckInterval: { env: null, def: 60, type: 'int' },
    showId: { env: null, def: true, type: 'bool' },
    previewGradientColor1: { env: null, def: '#D8C7F1', type: 'string' },
    previewGradientColor2: { env: null, def: '#BFE6E2', type: 'string' },
    videoDownloadEnabled: { env: null, def: false, type: 'bool' },
    videoDownloadResolution: { env: null, def: '1080p', type: 'string' },
    videoDownloadMaxDuration: { env: null, def: 600, type: 'int' },
    videoDownloadAutoClean: { env: null, def: true, type: 'bool' },
    videoDownloadCleanTimeout: { env: null, def: 6, type: 'int' },

    blacklistedQQs: { env: null, def: [], type: 'array', lazyInit: true },
    enabledGroups: { env: null, def: [], type: 'array', lazyInit: true },

    nightMode: {
        env: null,
        def: { mode: 'off', startTime: '21:00', endTime: '06:00' },
        type: 'object',
        lazyInit: true
    },
    labelConfig: {
        env: null,
        def: DEFAULT_LABEL_CONFIG,
        type: 'object',
        lazyInit: true,
        get: function(overrides) {
            const { ensureNormalizedLabelConfigObject } = require('./normalizers')
            if (!('labelConfig' in overrides) || typeof overrides.labelConfig !== 'object' || overrides.labelConfig === null || Array.isArray(overrides.labelConfig)) {
                overrides.labelConfig = { ...DEFAULT_LABEL_CONFIG }
            } else {
                ensureNormalizedLabelConfigObject(overrides.labelConfig)
            }
            return overrides.labelConfig
        }
    },
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true }
}

module.exports = {
    META,
    parsers,
    parseValue,
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG,
    AI_EDITOR_SNAPSHOT_FIELDS,
    AI_SENSITIVE_FIELDS
}
