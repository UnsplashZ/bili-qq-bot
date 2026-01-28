const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

const CONFIG_DIR = path.join(__dirname, '../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

// 正在初始化的群组ID集合（防止并发创建）
const initializingGroups = new Set();

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
        logger.error('[Config] Failed to load config.json', e);
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

    // AI Chat Service Configuration (priority over general AI config)
    aiChatApiUrl: { env: 'AI_CHAT_API_URL', def: null, type: 'string' },
    aiChatApiKey: { env: 'AI_CHAT_API_KEY', def: null, type: 'string' },
    aiChatModel: { env: 'AI_CHAT_MODEL', def: 'gpt-3.5-turbo', type: 'string' },
    aiChatProxy: { env: 'AI_CHAT_PROXY', def: null, type: 'string' },
    aiChatSystemPrompt: { env: 'AI_CHAT_SYSTEM_PROMPT', def: '你是一个有用的助手', type: 'string' },

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
    jwtSecret: {
        env: 'JWT_SECRET',
        def: '',
        type: 'string',
        // Special handling: generate random secret if not set
        get: function() {
            if ('jwtSecret' in _overrides) return _overrides.jwtSecret;
            let envVal = process.env.JWT_SECRET;
            if (envVal) return envVal;
            // Generate random secret
            const crypto = require('crypto');
            const secret = crypto.randomBytes(32).toString('hex');
            process.env.JWT_SECRET = secret;
            logger.warn('JWT_SECRET not set in .env, generated a temporary random secret. Tokens will be invalid after restart.');
            return secret;
        }
    },
    biliServerPort: { env: 'BILI_SERVER_PORT', def: 10001, type: 'int' },
    biliScriptPath: { env: null, def: './src/services/bili_server.py', type: 'string' },
    adminQQ: { env: 'ADMIN_QQ', def: undefined, type: 'string' },
    useBase64Send: { env: 'USE_BASE64_SEND', def: false, type: 'bool' },
    napcatTempPath: { env: 'NAPCAT_TEMP_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },
    napcatReadPath: { env: 'NAPCAT_READ_PATH', def: '/app/.config/QQ/tmp/', type: 'string' },

    // Dynamic Configuration (typically modified at runtime)
    linkCacheTimeout: { env: null, def: 600, type: 'int' },
    dataCacheTTL: { env: 'DATA_CACHE_TTL', def: 3600, type: 'int' },
    subscriptionCheckInterval: { env: null, def: 60, type: 'int' },
    showId: { env: null, def: true, type: 'bool' },

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
        def: { video: true, bangumi: true, article: true, live: true, dynamic: true, user: true },
        type: 'object',
        lazyInit: true
    },
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true }
};

// Build the config object with dynamic getters/setters
const config = {
    // Internal state
    _overrides,
    _saveTimer: null,

    // Helper to get config value for a group
    getGroupConfig: function(groupId, key) {
        if (groupId && this.groupConfigs[groupId] && this.groupConfigs[groupId][key] !== undefined) {
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
        this.groupConfigs[groupId][key] = value;
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
    isRootAdmin: function(userId) {
        return this.adminQQ && userId.toString() === this.adminQQ.toString();
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

            logger.info(`[Config] 自动创建群组 ${groupId} 的配置`);

            this.groupConfigs[key] = {
                linkCacheTimeout: 5,
                labelConfig: {
                    video: true,
                    dynamic: true,
                    live: true,
                    article: true,
                    bangumi: true
                },
                enableCookieSync: false,
                cookieSyncGroupNames: [],
                blacklistedQQs: [],
                admins: []  // 群组管理员列表
            };

            // Trigger save
            this.save();

            // 标记初始化完成
            initializingGroups.delete(key);
        }

        return this.groupConfigs[key];
    },

    // Delete specific keys from overrides and revert to env/default
    deleteKeys: function(keys) {
        if (!Array.isArray(keys)) return;

        // Remove from overrides
        keys.forEach(key => {
            delete _overrides[key];
        });

        // Save changes
        this._performSave();
        logger.info(`[Config] Reset keys to default: ${keys.join(', ')}`);
    },

    // Save configuration to file (Only overrides)
    save: function() {
        // Clear existing timer if any
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }

        // Debounce: wait 500ms before actually saving
        this._saveTimer = setTimeout(() => {
            this._performSave();
        }, 500);
    },

    _performSave: function() {
        try {
            const jsonString = JSON.stringify(_overrides, null, 2);
            fs.writeFile(CONFIG_PATH, jsonString, 'utf8', (err) => {
                if (err) {
                    logger.error('[Config] Failed to save configuration:', err);
                } else {
                    logger.info('[Config] Configuration saved to config.json');
                }
            });
        } catch (e) {
            logger.error('[Config] Error preparing configuration data:', e);
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

module.exports = config;
