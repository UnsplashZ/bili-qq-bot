const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const { asyncWriteWithBackup } = require('./utils/storageUtils');

const CONFIG_DIR = path.join(__dirname, '../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

// 正在初始化的群组ID集合（防止并发创建）
const initializingGroups = new Set();
let jwtSecretLoadedLogged = false
let jwtSecretGeneratedLogged = false

function configLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:config', message, fields);
}

function authConfigLog(level, message, fields = {}) {
    logger.logEvent(level, 'AUTH', 'svc:config', message, fields);
}

// ============================================================================
// LAYERED CONFIG ARCHITECTURE
// ============================================================================
// Priority: Override (config.json) > Environment Variable > Default
// - _overrides: User-modified values (loaded from and saved to config.json)
// - META: Defines all config keys with { env, def, type, lazyInit }
// - Dynamic getters/setters for each config key
// ============================================================================

// Load overrides from config.json
let _overrides = {};
if (fs.existsSync(CONFIG_PATH)) {
    try {
        _overrides = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        configLog('error', 'config-load-failed', {
            path: CONFIG_PATH,
            error: logger.getErrorMessage(e)
        });
    }
}

// Type parsers
const parsers = {
    string: (val) => String(val),
    int: (val) => {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? 0 : parsed;
    },
    float: (val) => {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? 0.0 : parsed;
    },
    bool: (val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') {
            const lower = val.toLowerCase().trim();
            if (lower === 'true' || lower === '1' || lower === 'yes') return true;
            if (lower === 'false' || lower === '0' || lower === 'no') return false;
        }
        return Boolean(val);
    },
    array: (val) => {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    },
    object: (val) => {
        if (typeof val === 'object' && val !== null) return val;
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        }
        return {};
    }
};

function parseValue(val, type) {
    if (val === undefined || val === null) return val;
    const parser = parsers[type];
    return parser ? parser(val) : val;
}

const SUBSCRIPTION_AT_ALL_SOURCE_KEYS = ['manual', 'cookieSync'];
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
];
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
};

function normalizeLabelConfig(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const normalized = {};

    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        normalized[key] = typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_LABEL_CONFIG[key];
    });

    return normalized;
}

function ensureNormalizedLabelConfigObject(input) {
    const target = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};

    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        if (typeof target[key] !== 'boolean') {
            target[key] = DEFAULT_LABEL_CONFIG[key];
        }
    });

    return target;
}

function createDefaultSubscriptionAtAllRules() {
    const sources = {};
    const categories = {};

    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => {
        sources[key] = true;
    });
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => {
        categories[key] = true;
    });

    return {
        sources,
        categories,
        manualDisabledIds: [],
        cookieSyncDisabledIds: []
    };
}

function normalizeIdList(values) {
    if (!Array.isArray(values)) return [];

    const normalized = [];
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const uid = String(value).trim();
        if (!/^\d+$/.test(uid)) continue;
        if (!normalized.includes(uid)) {
            normalized.push(uid);
        }
    }
    return normalized;
}

function normalizeSubscriptionAtAllRules(input) {
    const defaults = createDefaultSubscriptionAtAllRules();
    const raw = input && typeof input === 'object' ? input : {};
    const sourceInput = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
    const categoryInput = raw.categories && typeof raw.categories === 'object' ? raw.categories : {};

    const normalizedSources = {};
    const normalizedCategories = {};

    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => {
        if (typeof sourceInput[key] === 'boolean') {
            normalizedSources[key] = sourceInput[key];
        } else {
            normalizedSources[key] = defaults.sources[key];
        }
    });

    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => {
        if (typeof categoryInput[key] === 'boolean') {
            normalizedCategories[key] = categoryInput[key];
        } else {
            normalizedCategories[key] = defaults.categories[key];
        }
    });

    const manualDisabledIds = normalizeIdList(raw.manualDisabledIds);
    const cookieSyncDisabledIds = normalizeIdList(raw.cookieSyncDisabledIds);

    return {
        sources: normalizedSources,
        categories: normalizedCategories,
        manualDisabledIds,
        cookieSyncDisabledIds
    };
}

// META: Configuration schema
// - env: Environment variable name
// - def: Default value
// - type: Type for parsing (string, int, float, bool, array, object)
// - lazyInit: If true, initialize from default on first access and persist reference
//             (Use for mutable state like arrays/objects that get modified)
const META = {
    // WebSocket Configuration
    wsUrl: { env: 'WS_URL', def: 'ws://localhost:3001', type: 'string' },
    wsToken: { env: 'WS_TOKEN', def: '', type: 'string' },

    // AI LLM Configuration (General)
    aiApiUrl: { env: 'AI_API_URL', def: 'https://api.openai.com/v1/chat/completions', type: 'string' },
    aiApiKey: { env: 'AI_API_KEY', def: '', type: 'string' },
    aiModel: { env: 'AI_MODEL', def: 'gpt-3.5-turbo', type: 'string' },
    aiSystemPrompt: { env: 'AI_SYSTEM_PROMPT', def: '你是一个有用的助手。', type: 'string' },
    aiProbability: { env: 'AI_PROBABILITY', def: 0.1, type: 'float' },
    aiContextLimit: { env: null, def: 10, type: 'int' },
    aiTemperature: { env: 'AI_TEMPERATURE', def: 1.0, type: 'float' },

    // AI Function Toggles
    aiEnabled: { env: 'AI_ENABLED', def: true, type: 'bool' },
    aiRagEnabled: { env: 'AI_RAG_ENABLED', def: true, type: 'bool' },

    // AI Chat Service Configuration (priority over general AI config)
    aiChatApiUrl: {
        env: 'AI_CHAT_API_URL',
        def: null,
        type: 'string',
        get: function() {
            if ('aiChatApiUrl' in _overrides) return _overrides.aiChatApiUrl;
            const envVal = process.env.AI_CHAT_API_URL;
            if (envVal) return envVal;
            if ('aiApiUrl' in _overrides) return _overrides.aiApiUrl;
            return process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
        }
    },
    aiChatApiKey: {
        env: 'AI_CHAT_API_KEY',
        def: null,
        type: 'string',
        get: function() {
            if ('aiChatApiKey' in _overrides) return _overrides.aiChatApiKey;
            const envVal = process.env.AI_CHAT_API_KEY;
            if (envVal) return envVal;
            if ('aiApiKey' in _overrides) return _overrides.aiApiKey;
            return process.env.AI_API_KEY || '';
        }
    },
    aiChatModel: {
        env: 'AI_CHAT_MODEL',
        def: 'gpt-3.5-turbo',
        type: 'string',
        get: function() {
            if ('aiChatModel' in _overrides) return _overrides.aiChatModel;
            const envVal = process.env.AI_CHAT_MODEL;
            if (envVal) return envVal;
            if ('aiModel' in _overrides) return _overrides.aiModel;
            return process.env.AI_MODEL || this.def;
        }
    },
    aiChatProxy: { env: 'AI_CHAT_PROXY', def: null, type: 'string' },
    aiChatSystemPrompt: {
        env: 'AI_CHAT_SYSTEM_PROMPT',
        def: '你是一个有用的助手',
        type: 'string',
        get: function() {
            if ('aiChatSystemPrompt' in _overrides) return _overrides.aiChatSystemPrompt;
            const envVal = process.env.AI_CHAT_SYSTEM_PROMPT;
            if (envVal) return envVal;
            if ('aiSystemPrompt' in _overrides) return _overrides.aiSystemPrompt;
            return process.env.AI_SYSTEM_PROMPT || this.def;
        }
    },
    aiChatBaseTimeoutSeconds: { env: null, def: 30, type: 'int' },
    aiChatToolTimeoutSeconds: { env: null, def: 2, type: 'int' },
    aiChatMaxTimeoutSeconds: { env: null, def: 45, type: 'int' },

    // AI Embedding Configuration
    aiEmbeddingApiUrl: {
        env: 'AI_EMBEDDING_API_URL',
        def: 'https://api.openai.com/v1/embeddings',
        type: 'string',
        // Special handling: auto-infer from AI_API_URL if not provided
        get: function() {
            if ('aiEmbeddingApiUrl' in _overrides) return _overrides.aiEmbeddingApiUrl;
            const envVal = process.env.AI_EMBEDDING_API_URL;
            if (envVal) return envVal;
            // Auto-infer from AI_API_URL
            const aiApiUrl = process.env.AI_API_URL;
            if (aiApiUrl) {
                return aiApiUrl.replace('/chat/completions', '/embeddings');
            }
            return this.def;
        }
    },
    aiEmbeddingApiKey: {
        env: 'AI_EMBEDDING_API_KEY',
        def: '',
        type: 'string',
        // Special handling: fallback to AI_API_KEY
        get: function() {
            if ('aiEmbeddingApiKey' in _overrides) return _overrides.aiEmbeddingApiKey;
            const envVal = process.env.AI_EMBEDDING_API_KEY;
            if (envVal) return envVal;
            // Fallback to main AI key
            return process.env.AI_API_KEY || '';
        }
    },
    aiEmbeddingModel: { env: 'AI_EMBEDDING_MODEL', def: 'text-embedding-3-small', type: 'string' },
    aiEmbeddingProxy: { env: 'AI_EMBEDDING_PROXY', def: null, type: 'string' },

    // AI Memory Configuration
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
    aiIdentityRagMode: { env: null, def: 'strict', type: 'string' }, // strict | normal
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

    // AI User Profile Configuration
    aiProfileEnabled: { env: null, def: false, type: 'bool' },
    aiProfileMinMessages: { env: null, def: 30, type: 'int' },
    aiProfileUpdateInterval: { env: null, def: 50, type: 'int' },
    aiProfileMaxLength: { env: null, def: 200, type: 'int' },

    // System Configuration
    pythonPath: {
        env: 'PYTHON_PATH',
        def: 'python3',
        type: 'string',
        // Special handling: check for venv
        get: function() {
            if ('pythonPath' in _overrides) return _overrides.pythonPath;
            const envVal = process.env.PYTHON_PATH;
            if (envVal) return envVal;
            const venvPath = path.join(__dirname, '../venv/bin/python');
            if (fs.existsSync(venvPath)) return venvPath;
            return this.def;
        }
    },
    dashboardPort: { env: 'DASHBOARD_PORT', def: 3000, type: 'int' },
    dashboardPassword: { env: 'DASHBOARD_PASSWORD', def: 'admin', type: 'string' },
    dashboardAllowedOrigins: { env: 'DASHBOARD_ALLOWED_ORIGINS', def: '', type: 'string' },
    jwtSecret: {
        env: 'JWT_SECRET',
        def: '',
        type: 'string',
        // Special handling: generate random secret if not set, and persist it
        get: function() {
            if ('jwtSecret' in _overrides) return _overrides.jwtSecret;
            let envVal = process.env.JWT_SECRET;
            if (envVal) return envVal;

            // Check for persisted secret file
            const crypto = require('crypto');
            const fs = require('fs');
            const path = require('path');
            const secretPath = path.join(__dirname, '../config/.jwtSecret');

            try {
                if (fs.existsSync(secretPath)) {
                    const saved = fs.readFileSync(secretPath, 'utf8').trim();
                    if (saved && saved.length === 64) { // Validate format (32 bytes hex = 64 chars)
                        if (!jwtSecretLoadedLogged) {
                            authConfigLog('info', 'jwt-secret-loaded', {
                                path: secretPath
                            });
                            jwtSecretLoadedLogged = true;
                        }
                        return saved;
                    }
                }
            } catch (err) {
                authConfigLog('warn', 'jwt-secret-read-failed', {
                    path: secretPath,
                    error: logger.getErrorMessage(err)
                });
            }

            // Generate new secret and persist it
            const secret = crypto.randomBytes(32).toString('hex');
            try {
                // Ensure directory exists
                const dir = path.dirname(secretPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                // Write file with restricted permissions (owner read/write only)
                fs.writeFileSync(secretPath, secret, { mode: 0o600 });
                if (!jwtSecretGeneratedLogged) {
                    authConfigLog('warn', 'jwt-secret-generated', {
                        path: secretPath,
                        recommendedAction: 'move_to_env'
                    });
                    jwtSecretGeneratedLogged = true;
                }
            } catch (err) {
                authConfigLog('error', 'jwt-secret-save-failed', {
                    path: secretPath,
                    error: logger.getErrorMessage(err)
                });
            }

            return secret;
        }
    },
    biliServerPort: { env: 'BILI_SERVER_PORT', def: 10001, type: 'int' },
    biliScriptPath: { env: null, def: './src/services/bili_server.py', type: 'string' },
    useBase64Send: { env: 'USE_BASE64_SEND', def: false, type: 'bool' },
    napcatTempPath: { env: 'NAPCAT_TEMP_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },
    napcatReadPath: { env: 'NAPCAT_READ_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },

    // Dynamic Configuration (typically modified at runtime)
    linkCacheTimeout: { env: null, def: 600, type: 'int' },
    dataCacheTTL: { env: 'DATA_CACHE_TTL', def: 3600, type: 'int' },
    subscriptionCheckInterval: { env: null, def: 60, type: 'int' },
    showId: { env: null, def: true, type: 'bool' },
    previewGradientColor1: { env: null, def: '#FB7299', type: 'string' },
    previewGradientColor2: { env: null, def: '#87CEEB', type: 'string' },
    videoDownloadEnabled: { env: null, def: false, type: 'bool' },
    videoDownloadResolution: { env: null, def: '1080p', type: 'string' },
    videoDownloadMaxDuration: { env: null, def: 600, type: 'int' },
    videoDownloadAutoClean: { env: null, def: true, type: 'bool' },
    videoDownloadCleanTimeout: { env: null, def: 6, type: 'int' },

    // State Arrays (lazyInit = true for reference stability)
    blacklistedQQs: { env: null, def: [], type: 'array', lazyInit: true },
    enabledGroups: { env: null, def: [], type: 'array', lazyInit: true },

    // State Objects (lazyInit = true for reference stability)
    nightMode: {
        env: null,
        def: { mode: 'off', startTime: '21:00', endTime: '06:00' },
        type: 'object',
        lazyInit: true
    },
    labelConfig: {
        env: null,
        def: DEFAULT_LABEL_CONFIG,
        get: function() {
            if (!('labelConfig' in _overrides) || typeof _overrides.labelConfig !== 'object' || _overrides.labelConfig === null || Array.isArray(_overrides.labelConfig)) {
                _overrides.labelConfig = { ...DEFAULT_LABEL_CONFIG };
            } else {
                ensureNormalizedLabelConfigObject(_overrides.labelConfig);
            }
            return _overrides.labelConfig;
        },
        type: 'object',
        lazyInit: true
    },
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true }
};

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
];

const AI_SENSITIVE_FIELDS = new Set([
    'aiApiUrl',
    'aiApiKey',
    'aiChatApiUrl',
    'aiChatApiKey',
    'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey'
]);

function cloneConfigValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.parse(JSON.stringify(value));
    }
    return value;
}

function hasOwnOverride(key) {
    return Object.prototype.hasOwnProperty.call(_overrides, key);
}

function getEffectiveConfigValueWithoutMutation(key) {
    const meta = META[key];
    if (!meta) return undefined;

    if (hasOwnOverride(key)) {
        return cloneConfigValue(_overrides[key]);
    }

    if (typeof meta.get === 'function') {
        return cloneConfigValue(meta.get.call(meta));
    }

    const envVal = meta.env ? process.env[meta.env] : undefined;
    const rawVal = envVal !== undefined ? envVal : meta.def;
    return cloneConfigValue(parseValue(rawVal, meta.type));
}

function createSensitiveFieldMeta(source, configured, masked, inheritedFrom = '') {
    return {
        source,
        configured: Boolean(configured),
        masked: Boolean(masked),
        inheritedFrom
    };
}

function getDirectEnvValue(envName, def, type) {
    if (!envName) return cloneConfigValue(def);
    const envVal = process.env[envName];
    if (envVal === undefined) {
        return cloneConfigValue(def);
    }
    return cloneConfigValue(parseValue(envVal, type));
}

function resolveSensitiveAiFieldSnapshot(field) {
    if (hasOwnOverride(field)) {
        const overrideValue = cloneConfigValue(_overrides[field]);
        return {
            value: overrideValue,
            meta: createSensitiveFieldMeta('override', Boolean(overrideValue), false)
        };
    }

    if (field === 'aiChatApiUrl') {
        if (process.env.AI_CHAT_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            };
        }
        if (hasOwnOverride('aiApiUrl')) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiUrl), true, 'aiApiUrl')
            };
        }
        if (process.env.AI_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl')
            };
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', true, true)
        };
    }

    if (field === 'aiChatApiKey') {
        if (process.env.AI_CHAT_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            };
        }
        if (hasOwnOverride('aiApiKey')) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiKey), true, 'aiApiKey')
            };
        }
        if (process.env.AI_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey')
            };
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', false, true)
        };
    }

    if (field === 'aiEmbeddingApiUrl') {
        if (process.env.AI_EMBEDDING_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            };
        }
        if (process.env.AI_API_URL) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl')
            };
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', true, true)
        };
    }

    if (field === 'aiEmbeddingApiKey') {
        if (process.env.AI_EMBEDDING_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true)
            };
        }
        if (process.env.AI_API_KEY) {
            return {
                value: '',
                meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey')
            };
        }
        return {
            value: '',
            meta: createSensitiveFieldMeta('default', false, true)
        };
    }

    const meta = META[field];
    const directEnvValue = getDirectEnvValue(meta.env, meta.def, meta.type);
    const configured = Boolean(directEnvValue);
    return {
        value: '',
        meta: createSensitiveFieldMeta(meta.env && process.env[meta.env] !== undefined ? 'env' : 'default', configured, true)
    };
}

function buildAiEditorSnapshot() {
    const snapshot = {};
    const aiEditorMeta = {};

    AI_EDITOR_SNAPSHOT_FIELDS.forEach((field) => {
        if (AI_SENSITIVE_FIELDS.has(field)) {
            const resolved = resolveSensitiveAiFieldSnapshot(field);
            snapshot[field] = resolved.value;
            aiEditorMeta[field] = resolved.meta;
            return;
        }

        snapshot[field] = getEffectiveConfigValueWithoutMutation(field);
    });

    snapshot.aiEditorMeta = aiEditorMeta;
    return snapshot;
}

function buildDashboardConfigSnapshot() {
    return {
        subscriptionCheckInterval: getEffectiveConfigValueWithoutMutation('subscriptionCheckInterval'),
        linkCacheTimeout: getEffectiveConfigValueWithoutMutation('linkCacheTimeout'),
        showId: getEffectiveConfigValueWithoutMutation('showId'),
        previewGradientColor1: getEffectiveConfigValueWithoutMutation('previewGradientColor1'),
        previewGradientColor2: getEffectiveConfigValueWithoutMutation('previewGradientColor2'),
        videoDownloadEnabled: getEffectiveConfigValueWithoutMutation('videoDownloadEnabled'),
        videoDownloadResolution: getEffectiveConfigValueWithoutMutation('videoDownloadResolution'),
        videoDownloadMaxDuration: getEffectiveConfigValueWithoutMutation('videoDownloadMaxDuration'),
        videoDownloadAutoClean: getEffectiveConfigValueWithoutMutation('videoDownloadAutoClean'),
        videoDownloadCleanTimeout: getEffectiveConfigValueWithoutMutation('videoDownloadCleanTimeout'),
        ...buildAiEditorSnapshot()
    };
}

// Build the config object with dynamic getters/setters
const config = {
    // Internal state
    _overrides,
    _saveTimer: null,

    // Helper to get config value for a group
    getGroupConfig: function(groupId, key) {
        // use != null to check for both null and undefined
        if (groupId && this.groupConfigs[groupId] && this.groupConfigs[groupId][key] != null) {
            if (key === 'labelConfig') {
                const currentLabelConfig = this.groupConfigs[groupId][key];
                if (typeof currentLabelConfig !== 'object' || currentLabelConfig === null || Array.isArray(currentLabelConfig)) {
                    this.groupConfigs[groupId][key] = { ...DEFAULT_LABEL_CONFIG };
                } else {
                    ensureNormalizedLabelConfigObject(currentLabelConfig);
                }
                return this.groupConfigs[groupId][key];
            }
            return this.groupConfigs[groupId][key];
        }
        return this[key];
    },

    // Helper to set config value for a group
    setGroupConfig: function(groupId, key, value) {
        if (!groupId) return;
        if (!this.groupConfigs[groupId]) {
            this.groupConfigs[groupId] = {};
        }
        if (key === 'labelConfig') {
            const nextValue = value && typeof value === 'object' && !Array.isArray(value)
                ? { ...value }
                : {};
            this.groupConfigs[groupId][key] = ensureNormalizedLabelConfigObject(nextValue);
        } else {
            this.groupConfigs[groupId][key] = value;
        }
        this.save();
    },

    // Helper to append value to a group config array
    appendGroupConfigArray: function(groupId, key, value) {
        if (!groupId) return false;
        if (!this.groupConfigs[groupId]) {
            this.groupConfigs[groupId] = {};
        }

        // Ensure it's an array
        if (!Array.isArray(this.groupConfigs[groupId][key])) {
            this.groupConfigs[groupId][key] = [];
        }

        const arr = this.groupConfigs[groupId][key];
        if (!arr.includes(value)) {
            arr.push(value);
            this.save();
            return true;
        }
        return false;
    },

    // Helper to remove value from a group config array
    removeGroupConfigArray: function(groupId, key, value) {
        if (!groupId || !this.groupConfigs[groupId]) return false;

        const arr = this.groupConfigs[groupId][key];
        if (Array.isArray(arr)) {
            const index = arr.indexOf(value);
            if (index > -1) {
                arr.splice(index, 1);
                this.save();
                return true;
            }
        }
        return false;
    },

    // Permission Checks
    getRootAdminQQ: function() {
        const raw = process.env.ADMIN_QQ;
        if (raw === undefined || raw === null) return '';
        return String(raw).trim();
    },

    isRootAdmin: function(userId) {
        const rootAdminQQ = this.getRootAdminQQ();
        if (!rootAdminQQ || userId === undefined || userId === null) return false;
        return String(userId) === rootAdminQQ;
    },

    isGroupAdmin: function(groupId, userId) {
        if (this.isRootAdmin(userId)) return true;
        if (!groupId) return false;

        const groupConfig = this.groupConfigs[groupId];
        if (groupConfig && groupConfig.admins && Array.isArray(groupConfig.admins)) {
            return groupConfig.admins.includes(userId.toString());
        }
        return false;
    },

    // Admin Management
    addGroupAdmin: function(groupId, userId) {
        if (!groupId || !userId) return false;
        if (!this.groupConfigs[groupId]) this.groupConfigs[groupId] = {};
        if (!this.groupConfigs[groupId].admins) this.groupConfigs[groupId].admins = [];

        const strId = userId.toString();
        if (!this.groupConfigs[groupId].admins.includes(strId)) {
            this.groupConfigs[groupId].admins.push(strId);
            this.save();
            return true;
        }
        return false;
    },

    removeGroupAdmin: function(groupId, userId) {
        if (!groupId || !userId) return false;
        if (!this.groupConfigs[groupId] || !this.groupConfigs[groupId].admins) return false;

        const strId = userId.toString();
        const index = this.groupConfigs[groupId].admins.indexOf(strId);
        if (index > -1) {
            this.groupConfigs[groupId].admins.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    },

    isGroupEnabled: function(groupId) {
        // If whitelist is empty, all allowed
        if (!this.enabledGroups || this.enabledGroups.length === 0) return true;
        return this.enabledGroups.includes(groupId.toString());
    },

    enableGroup: function(groupId) {
        if (!this.enabledGroups) this.enabledGroups = [];
        const strId = groupId.toString();
        if (!this.enabledGroups.includes(strId)) {
            this.enabledGroups.push(strId);
            this.save();
        }
    },

    disableGroup: function(groupId) {
        if (!this.enabledGroups) return;
        const strId = groupId.toString();
        this.enabledGroups = this.enabledGroups.filter(id => id !== strId);
        this.save();
    },

    // Ensure group config exists (auto-initialize with defaults)
    ensureGroupConfig: function(groupId) {
        const key = String(groupId);

        // 如果正在初始化，等待完成
        if (initializingGroups.has(key)) {
            return this.groupConfigs[key];
        }

        if (!this.groupConfigs[key]) {
            // 标记为正在初始化
            initializingGroups.add(key);

            configLog('info', 'group-config-auto-created', {
                groupId
            });

            this.groupConfigs[key] = {
                linkCacheTimeout: 5,
                labelConfig: { ...DEFAULT_LABEL_CONFIG },
                enableCookieSync: false,
                subscriptionAtAll: false,
                subscriptionAtAllRules: createDefaultSubscriptionAtAllRules(),
                cookieSyncGroupNames: [],
                blacklistedQQs: [],
                admins: [],  // 群组管理员列表
                nightMode: {
                    mode: "off",
                    startTime: "21:00",
                    endTime: "06:00"
                }
            };

            // 确保新群默认开启（自动加入白名单）
            const enabledGroups = this.enabledGroups;
            if (Array.isArray(enabledGroups) && enabledGroups.length > 0) {
                const strId = groupId.toString();
                if (!enabledGroups.includes(strId)) {
                    enabledGroups.push(strId);
                    configLog('info', 'group-whitelist-auto-enabled', {
                        groupId
                    });
                }
            }

            // Trigger save
            this.save();

            // 标记初始化完成
            initializingGroups.delete(key);
        }

        return this.groupConfigs[key];
    },

    // Delete specific keys from overrides and revert to env/default
    applyOverridePatch: function({ clear = [], set = {} } = {}) {
        const clearKeys = Array.isArray(clear) ? clear : [];
        const setEntries = set && typeof set === 'object' ? Object.entries(set) : [];
        if (clearKeys.length === 0 && setEntries.length === 0) return;

        clearKeys.forEach((key) => {
            delete _overrides[key];
        });

        setEntries.forEach(([key, value]) => {
            _overrides[key] = value;
        });

        this.save();
    },

    // Delete specific keys from overrides and revert to env/default
    deleteKeys: function(keys) {
        if (!Array.isArray(keys)) return;

        this.applyOverridePatch({ clear: keys });
        configLog('info', 'config-reset', {
            keys: keys.join(',')
        });
    },

    getConfigSnapshot: function() {
        // Legacy helper for debugging only.
        // Do not use this to initialize editable forms because some getters
        // resolve env/fallback values and some keys lazily initialize overrides.
        const snapshot = {};
        Object.keys(META).forEach((key) => {
            const value = this[key];
            if (value && typeof value === 'object') {
                snapshot[key] = JSON.parse(JSON.stringify(value));
                return;
            }
            snapshot[key] = value;
        });
        return snapshot;
    },

    getAiEditorSnapshot: function() {
        return buildAiEditorSnapshot();
    },

    getDashboardConfigSnapshot: function() {
        return buildDashboardConfigSnapshot();
    },

    // Save configuration to file (Only overrides)
    save: function() {
        // Clear existing timer if any
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }

        logger.logEvent('info', 'STORE', 'svc:config', 'config-save-queued');

        // Debounce: wait 100ms before actually saving (shortened from 500ms)
        // 100ms is sufficient to merge multiple setter calls from Object.assign
        this._saveTimer = setTimeout(() => {
            this._performSave().catch((err) => {
                configLog('error', 'config-save-failed', {
                    error: logger.getErrorMessage(err)
                });

                // Track repeated failures
                this._saveErrorCount = (this._saveErrorCount || 0) + 1;
                if (this._saveErrorCount >= 5) {
                    configLog('error', 'config-save-failure-threshold', {
                        consecutiveFailures: this._saveErrorCount
                    });
                    this._saveErrorCount = 0; // Reset counter
                }
            });
        }, 100);
    },

    _performSave: async function() {
        const startTime = Date.now();
        const saveCount = (this._saveCount || 0) + 1;

        try {
            await asyncWriteWithBackup(CONFIG_PATH, _overrides, false);
            this._saveCount = saveCount;
            const duration = Date.now() - startTime;
            logger.logEvent('info', 'STORE', 'svc:config', 'config-saved', {
                durationMs: duration,
                total: this._saveCount
            });
            if (duration > 100) {
                configLog('warn', 'config-save-slow', {
                    durationMs: duration
                });
            }
        } catch (e) {
            configLog('error', 'config-save-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }
};

// Define dynamic getters/setters for all META keys
Object.keys(META).forEach(key => {
    const meta = META[key];

    Object.defineProperty(config, key, {
        get: function() {
            // If custom getter exists, use it
            if (meta.get) {
                return meta.get.call(meta);
            }

            // Priority: Override > Env > Default
            if (key in _overrides) {
                return _overrides[key];
            }

            // LazyInit: Initialize from default on first access
            if (meta.lazyInit) {
                // Deep clone the default value
                _overrides[key] = JSON.parse(JSON.stringify(meta.def));
                return _overrides[key];
            }

            // Parse from env or use default
            const envVal = meta.env ? process.env[meta.env] : undefined;
            const rawVal = envVal !== undefined ? envVal : meta.def;
            return parseValue(rawVal, meta.type);
        },
        set: function(val) {
            _overrides[key] = val;
            this.save();
        },
        enumerable: true,
        configurable: true
    });
});

/**
 * Check if AI is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean} - True if AI is enabled for this group
 */
function isAiEnabledForGroup(groupId) {
    // 1. Global AI switch must be on
    if (!config.aiEnabled) {
        return false;
    }

    // 2. Check group-level override
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && typeof groupConfig.aiEnabled === 'boolean') {
        return groupConfig.aiEnabled;
    }

    // 3. Default: inherit global setting
    return true;
}

/**
 * Check if RAG is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean} - True if RAG is enabled for this group
 */
function isRagEnabledForGroup(groupId) {
    // 1. AI must be enabled first
    if (!isAiEnabledForGroup(groupId)) {
        return false;
    }

    // 2. Global RAG switch must be on
    if (!config.aiRagEnabled) {
        return false;
    }

    // 3. Check group-level override
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && typeof groupConfig.aiRagEnabled === 'boolean') {
        return groupConfig.aiRagEnabled;
    }

    // 4. Default: inherit global setting
    return true;
}

/**
 * Check if video download is enabled for a specific group
 * @param {string} groupId - Group ID
 * @returns {boolean}
 */
function isVideoDownloadEnabledForGroup(groupId) {
    // 群级配置可独立覆盖全局开关（设计要求：群可"独立覆盖"）
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) {
        return groupConfig.videoDownloadEnabled
    }
    // 无群级配置则继承全局
    return config.videoDownloadEnabled
}

/**
 * Get effective video download resolution for a group (group > global > default)
 * @param {string} groupId
 * @returns {string}
 */
function getVideoDownloadResolutionForGroup(groupId) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadResolution' in groupConfig) {
        return groupConfig.videoDownloadResolution
    }
    return config.videoDownloadResolution
}

/**
 * Get effective max duration limit for a group, in seconds. 0 means no limit.
 * @param {string} groupId
 * @returns {number}
 */
function getVideoDownloadMaxDurationForGroup(groupId) {
    const groupConfig = config.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) {
        return groupConfig.videoDownloadMaxDuration
    }
    return config.videoDownloadMaxDuration
}

module.exports = config;
module.exports.isAiEnabledForGroup = isAiEnabledForGroup;
module.exports.isRagEnabledForGroup = isRagEnabledForGroup;
module.exports.isVideoDownloadEnabledForGroup = isVideoDownloadEnabledForGroup;
module.exports.getVideoDownloadResolutionForGroup = getVideoDownloadResolutionForGroup;
module.exports.getVideoDownloadMaxDurationForGroup = getVideoDownloadMaxDurationForGroup;
module.exports.createDefaultSubscriptionAtAllRules = createDefaultSubscriptionAtAllRules;
module.exports.normalizeSubscriptionAtAllRules = normalizeSubscriptionAtAllRules;
module.exports.SUBSCRIPTION_AT_ALL_SOURCE_KEYS = SUBSCRIPTION_AT_ALL_SOURCE_KEYS;
module.exports.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = SUBSCRIPTION_AT_ALL_CATEGORY_KEYS;
module.exports.DEFAULT_LABEL_CONFIG = DEFAULT_LABEL_CONFIG;
module.exports.normalizeLabelConfig = normalizeLabelConfig;
