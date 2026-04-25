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

const DEFAULT_AGENT_CONFIG = {
    enabled: false,
    observeOnly: true,
    logTrajectory: true,
    defaultGroupEnabled: false,
    decisionMode: 'rule_only',
    sendEnabled: false,
    aliases: [],
    persona: {
        displayName: 'Bilibili 助手',
        style: '友好、简洁、不过度热情；优先少说废话。',
        boundaries: '专注 B 站链接、订阅、群聊上下文和 Bot 配置管理；普通闲聊默认保持克制。'
    },
    shortTerm: {
        maxRecentMessagesPerGroup: 100,
        topicIdleMs: 30 * 60 * 1000,
        crowdedMessagesPerMinute: 8,
        promptRecentMessages: 16,
        promptTopicMessages: 20,
        promptAssistantMessages: 6,
        promptMaxMessages: 32,
        promptMaxCharsPerMessage: 220
    },
    longTerm: {
        retrieveLimit: 5,
        topicSummaryEnabled: true,
        topicSummaryMinMessages: 6,
        topicSummaryMinIntervalMs: 10 * 60 * 1000
    },
    replyPolicy: {
        minReplyScore: 0.65,
        cooldownMs: 5 * 1000
    },
    tools: {
        enabled: false,
        confirmationTtlMs: 60 * 1000,
        requireConfirmationFor: ['medium', 'high']
    },
    llm: {
        enabled: false,
        provider: 'openai-compatible',
        baseURL: '',
        model: '',
        apiKeyEnv: 'AGENT_API_KEY',
        timeoutMs: 12 * 1000,
        temperature: 0.2,
        maxTokens: 500
    },
    budget: {
        enabled: true,
        windowMs: 60 * 1000,
        maxLlmCallsPerGroupPerMinute: 60,
        maxLlmCallsPerUserPerMinute: 20
    },
    groups: {}
}

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
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true },
    agent: { env: null, def: DEFAULT_AGENT_CONFIG, type: 'object', lazyInit: true }
}

module.exports = {
    META,
    parsers,
    parseValue,
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG,
    DEFAULT_AGENT_CONFIG
}
