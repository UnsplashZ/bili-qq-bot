# Config 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/config.js`（1177 行）拆分为职责分明的子模块，同时保持对外 API（`require('./config')` 的调用方）完全兼容。

**Architecture:** 将配置系统拆为五层：schema（定义层）、store（持久层）、jwtSecretOwner（带副作用的 getter）、normalizers（归一化）、domain helpers（领域逻辑）、index（聚合兼容）。每层只做一件事，通过 `src/config/index.js` 聚合导出，复刻现有 `module.exports` 接口。

**Tech Stack:** 纯 Node.js（无新依赖），所有改动向前兼容，现有调用方无需修改。

---

## 文件结构

```
src/config/
├── index.js              # 聚合导出，复刻原 config 对象所有接口（向后兼容）
├── schema.js             # META、parsers、DEFAULT_* 常量、AI_EDITOR_SNAPSHOT_FIELDS、AI_SENSITIVE_FIELDS
├── store.js              # _overrides、文件读写、save/debounce、defineGetters（不含 jwtSecret）
├── jwtSecretOwner.js     # jwtSecret getter + 它的 authConfigLog、两个可变 flag、fs 读写（独立闭环）
├── normalizers.js        # normalizeSubscriptionAtAllRules、normalizeLabelConfig、normalizeIdList、ensureNormalizedLabelConfigObject
├── groupConfig.js        # groupConfigs 相关：ensureGroupConfig、getGroupConfig、setGroupConfig、appendGroupConfigArray、removeGroupConfigArray
├── aiConfig.js           # AI helper：isAiEnabledForGroup、isRagEnabledForGroup、isVideoDownloadEnabledForGroup、getVideoDownloadResolutionForGroup、getVideoDownloadMaxDurationForGroup、buildAiEditorSnapshot、buildDashboardConfigSnapshot
└── authConfig.js         # 鉴权 helper：getRootAdminQQ、isRootAdmin、isGroupAdmin、addGroupAdmin、removeGroupAdmin
```

**向后兼容：** `src/config.js`（在 `src/` 下）重导出 `require('./config/index')`，所有现有 `require('./config')` 和 `require('../config')` 调用方零改动。

---

## 任务分解

### Task 1: 建立目录骨架和 schema.js

**Files:**
- Create: `src/config/schema.js`
- Create: `src/config/index.js`（骨架）
- Modify: `src/config.js`（改为重导出 `require('./config/index')`）

- [ ] **Step 1: 创建 src/config/ 目录**

```bash
mkdir -p src/config
```

- [ ] **Step 2: 创建 src/config/schema.js**

从 `src/config.js`（行 1–44 文件加载、98–227 normalizer 函数、229–539 META 主体、503–539 snapshot 常量）移入以下内容。完整迁移内容如下，不留省略号：

```javascript
// src/config/schema.js
const path = require('path');
const dotenv = require('dotenv');

const CONFIG_DIR = path.join(__dirname, '../../config');
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

const SUBSCRIPTION_AT_ALL_SOURCE_KEYS = ['manual', 'cookieSync'];
const SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = [
    'video', 'dynamic', 'live', 'article', 'bangumi',
    'movie', 'tv', 'guocha', 'doc', 'variety'
];

const DEFAULT_LABEL_CONFIG = {
    video: true, bangumi: true, article: true, live: true,
    dynamic: true, user: true, interactive_video: true,
    favorite_list: true, audio: true, audio_list: true,
    topic: true, channel_series: true, article_list: true,
    note: true, cheese_video: true, movie: true, tv: true,
    guocha: true, doc: true, variety: true
};

const AI_EDITOR_SNAPSHOT_FIELDS = [
    'aiApiUrl', 'aiApiKey', 'aiProbability', 'aiContextLimit',
    'aiTemperature', 'aiHistoryMaxSize', 'aiEnableVectorCache',
    'aiVectorSimilarityThreshold', 'aiVectorSearchLimit',
    'aiMemorySafetyLimit', 'aiChatApiUrl', 'aiChatApiKey',
    'aiChatModel', 'aiChatProxy', 'aiChatSystemPrompt',
    'aiChatBaseTimeoutSeconds', 'aiChatToolTimeoutSeconds',
    'aiChatMaxTimeoutSeconds', 'aiEmbeddingApiUrl',
    'aiEmbeddingApiKey', 'aiEmbeddingModel', 'aiEmbeddingProxy',
    'aiEnabled', 'aiRagEnabled', 'aiProfileEnabled'
];

const AI_SENSITIVE_FIELDS = new Set([
    'aiApiUrl', 'aiApiKey', 'aiChatApiUrl', 'aiChatApiKey',
    'aiEmbeddingApiUrl', 'aiEmbeddingApiKey'
]);

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
            } catch { return []; }
        }
        return [];
    },
    object: (val) => {
        if (typeof val === 'object' && val !== null) return val;
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                return typeof parsed === 'object' ? parsed : {};
            } catch { return {}; }
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
// env: Environment variable name | def: Default value
// type: Type for parsing | lazyInit: deep-clone default on first access
// 注意：jwtSecret 不在此处定义（由 jwtSecretOwner.js 提供）
const META = {
    wsUrl:            { env: 'WS_URL',                       def: 'ws://localhost:3001',                 type: 'string' },
    wsToken:          { env: 'WS_TOKEN',                      def: '',                                    type: 'string' },
    aiApiUrl:         { env: 'AI_API_URL',                    def: 'https://api.openai.com/v1/chat/completions', type: 'string' },
    aiApiKey:         { env: 'AI_API_KEY',                    def: '',                                    type: 'string' },
    aiModel:          { env: 'AI_MODEL',                      def: 'gpt-3.5-turbo',                       type: 'string' },
    aiSystemPrompt:   { env: 'AI_SYSTEM_PROMPT',              def: '你是一个有用的助手。',               type: 'string' },
    aiProbability:    { env: 'AI_PROBABILITY',                def: 0.1,                                   type: 'float' },
    aiContextLimit:   { env: null,                            def: 10,                                    type: 'int' },
    aiTemperature:    { env: 'AI_TEMPERATURE',                def: 1.0,                                   type: 'float' },
    aiEnabled:        { env: 'AI_ENABLED',                    def: true,                                  type: 'bool' },
    aiRagEnabled:      { env: 'AI_RAG_ENABLED',               def: true,                                  type: 'bool' },
    aiChatApiUrl:     {
        env: 'AI_CHAT_API_URL', def: null, type: 'string',
        get: function(_overrides) {
            if ('aiChatApiUrl' in _overrides) return _overrides.aiChatApiUrl;
            const envVal = process.env.AI_CHAT_API_URL;
            if (envVal) return envVal;
            if ('aiApiUrl' in _overrides) return _overrides.aiApiUrl;
            return process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
        }
    },
    aiChatApiKey: {
        env: 'AI_CHAT_API_KEY', def: null, type: 'string',
        get: function(_overrides) {
            if ('aiChatApiKey' in _overrides) return _overrides.aiChatApiKey;
            const envVal = process.env.AI_CHAT_API_KEY;
            if (envVal) return envVal;
            if ('aiApiKey' in _overrides) return _overrides.aiApiKey;
            return process.env.AI_API_KEY || '';
        }
    },
    aiChatModel: {
        env: 'AI_CHAT_MODEL', def: 'gpt-3.5-turbo', type: 'string',
        get: function(_overrides) {
            if ('aiChatModel' in _overrides) return _overrides.aiChatModel;
            const envVal = process.env.AI_CHAT_MODEL;
            if (envVal) return envVal;
            if ('aiModel' in _overrides) return _overrides.aiModel;
            return process.env.AI_MODEL || this.def;
        }
    },
    aiChatProxy:      { env: 'AI_CHAT_PROXY',                 def: null,                                  type: 'string' },
    aiChatSystemPrompt: {
        env: 'AI_CHAT_SYSTEM_PROMPT', def: '你是一个有用的助手', type: 'string',
        get: function(_overrides) {
            if ('aiChatSystemPrompt' in _overrides) return _overrides.aiChatSystemPrompt;
            const envVal = process.env.AI_CHAT_SYSTEM_PROMPT;
            if (envVal) return envVal;
            if ('aiSystemPrompt' in _overrides) return _overrides.aiSystemPrompt;
            return process.env.AI_SYSTEM_PROMPT || this.def;
        }
    },
    aiChatBaseTimeoutSeconds:  { env: null, def: 30,  type: 'int' },
    aiChatToolTimeoutSeconds: { env: null, def: 2,   type: 'int' },
    aiChatMaxTimeoutSeconds:   { env: null, def: 45,  type: 'int' },
    aiEmbeddingApiUrl: {
        env: 'AI_EMBEDDING_API_URL', def: 'https://api.openai.com/v1/embeddings', type: 'string',
        get: function(_overrides) {
            if ('aiEmbeddingApiUrl' in _overrides) return _overrides.aiEmbeddingApiUrl;
            const envVal = process.env.AI_EMBEDDING_API_URL;
            if (envVal) return envVal;
            const aiApiUrl = process.env.AI_API_URL;
            if (aiApiUrl) return aiApiUrl.replace('/chat/completions', '/embeddings');
            return this.def;
        }
    },
    aiEmbeddingApiKey: {
        env: 'AI_EMBEDDING_API_KEY', def: '', type: 'string',
        get: function(_overrides) {
            if ('aiEmbeddingApiKey' in _overrides) return _overrides.aiEmbeddingApiKey;
            const envVal = process.env.AI_EMBEDDING_API_KEY;
            if (envVal) return envVal;
            return process.env.AI_API_KEY || '';
        }
    },
    aiEmbeddingModel:   { env: 'AI_EMBEDDING_MODEL',   def: 'text-embedding-3-small', type: 'string' },
    aiEmbeddingProxy:   { env: 'AI_EMBEDDING_PROXY',   def: null,                     type: 'string' },
    aiHistoryMaxSize:   { env: null, def: 200 * 1024 * 1024, type: 'int' },
    aiVectorMaxSize:    { env: null, def: 200 * 1024 * 1024, type: 'int' },
    aiVectorSimilarityThreshold: { env: null, def: 0.4,  type: 'float' },
    aiVectorSearchLimit: { env: null, def: 3,     type: 'int' },
    aiShortMessageThreshold: { env: null, def: 5,  type: 'int' },
    aiMemorySafetyLimit: { env: null, def: 5000,  type: 'int' },
    aiVectorMemoryLimit: { env: null, def: 10000, type: 'int' },
    aiTrimRatio:         { env: null, def: 0.1,   type: 'float' },
    aiVectorBatchLoadSize: { env: null, def: 1000, type: 'int' },
    aiEnableVectorCache:  { env: null, def: true,  type: 'bool' },
    aiEnableSmartTrim:    { env: null, def: true,  type: 'bool' },
    aiStructuredContextEnabled: { env: null, def: true, type: 'bool' },
    aiIdentityRagMode:    { env: null, def: 'strict', type: 'string' },
    aiAdminClaimRequiresTool: { env: null, def: true, type: 'bool' },
    aiReplyGateEnabled:   { env: null, def: true,  type: 'bool' },
    aiContextSelectorEnabled: { env: null, def: true, type: 'bool' },
    aiResponseModeEnabled: { env: null, def: true, type: 'bool' },
    aiPromptAssemblerEnabled: { env: null, def: true, type: 'bool' },
    aiReplyScoreThreshold: { env: null, def: 45,  type: 'int' },
    aiBusyReplyScoreThreshold: { env: null, def: 80, type: 'int' },
    aiBusyWindowSeconds:  { env: null, def: 10,  type: 'int' },
    aiBusyMessageCount:   { env: null, def: 12,  type: 'int' },
    aiReplyCooldownMs:    { env: null, def: 15000, type: 'int' },
    aiMaxRepliesPerWindow: { env: null, def: 3,  type: 'int' },
    aiBotName:           { env: null, def: '',  type: 'string' },
    aiBotAliases:        { env: null, def: [], type: 'array', lazyInit: true },
    aiProfileEnabled:    { env: null, def: false, type: 'bool' },
    aiProfileMinMessages: { env: null, def: 30, type: 'int' },
    aiProfileUpdateInterval: { env: null, def: 50, type: 'int' },
    aiProfileMaxLength:  { env: null, def: 200, type: 'int' },
    pythonPath: {
        env: 'PYTHON_PATH', def: 'python3', type: 'string',
        get: function(_overrides) {
            if ('pythonPath' in _overrides) return _overrides.pythonPath;
            const envVal = process.env.PYTHON_PATH;
            if (envVal) return envVal;
            const venvPath = path.join(__dirname, '../../venv/bin/python');
            if (require('fs').existsSync(venvPath)) return venvPath;
            return this.def;
        }
    },
    dashboardPort:         { env: 'DASHBOARD_PORT',         def: 3000,  type: 'int' },
    dashboardPassword:      { env: 'DASHBOARD_PASSWORD',      def: 'admin', type: 'string' },
    dashboardAllowedOrigins: { env: 'DASHBOARD_ALLOWED_ORIGINS', def: '', type: 'string' },
    biliServerPort:         { env: 'BILI_SERVER_PORT',        def: 10001, type: 'int' },
    biliScriptPath:         { env: null,                       def: './src/services/bili_server.py', type: 'string' },
    useBase64Send:          { env: 'USE_BASE64_SEND',          def: false, type: 'bool' },
    napcatTempPath:         { env: 'NAPCAT_TEMP_PATH',         def: '/app/.config/QQ/tmp/', type: 'string' },
    napcatReadPath:         { env: 'NAPCAT_READ_PATH',         def: '/app/.config/QQ/tmp/', type: 'string' },
    linkCacheTimeout:       { env: null,                       def: 600,   type: 'int' },
    dataCacheTTL:           { env: 'DATA_CACHE_TTL',           def: 3600,  type: 'int' },
    subscriptionCheckInterval: { env: null,                     def: 60,    type: 'int' },
    showId:                 { env: null,                       def: true,  type: 'bool' },
    previewGradientColor1:  { env: null,                       def: '#D8C7F1', type: 'string' },
    previewGradientColor2:  { env: null,                       def: '#BFE6E2', type: 'string' },
    videoDownloadEnabled:    { env: null,                       def: false, type: 'bool' },
    videoDownloadResolution: { env: null,                      def: '1080p', type: 'string' },
    videoDownloadMaxDuration: { env: null,                     def: 600,   type: 'int' },
    videoDownloadAutoClean:  { env: null,                       def: true,  type: 'bool' },
    videoDownloadCleanTimeout: { env: null,                     def: 6,     type: 'int' },
    blacklistedQQs:         { env: null,                       def: [],    type: 'array', lazyInit: true },
    enabledGroups:          { env: null,                       def: [],    type: 'array', lazyInit: true },
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
        lazyInit: true
    },
    groupConfigs: { env: null, def: {}, type: 'object', lazyInit: true }
    // 注意：jwtSecret 由 jwtSecretOwner.js 独立管理，不在此定义
};

module.exports = {
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS,
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
    DEFAULT_LABEL_CONFIG,
    AI_EDITOR_SNAPSHOT_FIELDS,
    AI_SENSITIVE_FIELDS,
    parsers,
    parseValue,
    META
};
```

- [ ] **Step 3: 创建 src/config/index.js（骨架）**

```javascript
// src/config/index.js
// 骨架：完整内容在 Task 7 后写入
module.exports = {};
```

- [ ] **Step 4: 修改 src/config.js 变为重导出**

```javascript
// src/config.js
// 向后兼容重导出点，内部已迁移至 src/config/
module.exports = require('./config/index');
```

- [ ] **Step 5: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/
git commit
# message: "refactor(config): 建立 config/ 子目录骨架，迁入 schema.js"
# body: 说明迁移了哪些内容（META、parsers、DEFAULT_* 常量等）
```

---

### Task 2: 迁入 normalizers.js

**Files:**
- Create: `src/config/normalizers.js`
- Modify: `src/config/schema.js`（删除已迁出的 normalizer 函数）

- [ ] **Step 1: 创建 src/config/normalizers.js**

从 `src/config.js:98-227` 移入：

```javascript
// src/config/normalizers.js
const { SUBSCRIPTION_AT_ALL_SOURCE_KEYS, SUBSCRIPTION_AT_ALL_CATEGORY_KEYS, DEFAULT_LABEL_CONFIG } = require('./schema');

function normalizeIdList(values) {
    if (!Array.isArray(values)) return [];
    const normalized = [];
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const uid = String(value).trim();
        if (!/^\d+$/.test(uid)) continue;
        if (!normalized.includes(uid)) normalized.push(uid);
    }
    return normalized;
}

function createDefaultSubscriptionAtAllRules() {
    const sources = {};
    const categories = {};
    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => { sources[key] = true; });
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => { categories[key] = true; });
    return { sources, categories, manualDisabledIds: [], cookieSyncDisabledIds: [] };
}

function normalizeSubscriptionAtAllRules(input) {
    const defaults = createDefaultSubscriptionAtAllRules();
    const raw = input && typeof input === 'object' ? input : {};
    const sourceInput = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
    const categoryInput = raw.categories && typeof raw.categories === 'object' ? raw.categories : {};

    const normalizedSources = {};
    const normalizedCategories = {};

    SUBSCRIPTION_AT_ALL_SOURCE_KEYS.forEach((key) => {
        normalizedSources[key] = typeof sourceInput[key] === 'boolean'
            ? sourceInput[key] : defaults.sources[key];
    });
    SUBSCRIPTION_AT_ALL_CATEGORY_KEYS.forEach((key) => {
        normalizedCategories[key] = typeof categoryInput[key] === 'boolean'
            ? categoryInput[key] : defaults.categories[key];
    });

    return {
        sources: normalizedSources,
        categories: normalizedCategories,
        manualDisabledIds: normalizeIdList(raw.manualDisabledIds),
        cookieSyncDisabledIds: normalizeIdList(raw.cookieSyncDisabledIds)
    };
}

function ensureNormalizedLabelConfigObject(input) {
    const target = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        if (typeof target[key] !== 'boolean') target[key] = DEFAULT_LABEL_CONFIG[key];
    });
    return target;
}

function normalizeLabelConfig(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const normalized = {};
    Object.keys(DEFAULT_LABEL_CONFIG).forEach((key) => {
        normalized[key] = typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_LABEL_CONFIG[key];
    });
    return normalized;
}

module.exports = {
    normalizeIdList,
    createDefaultSubscriptionAtAllRules,
    normalizeSubscriptionAtAllRules,
    ensureNormalizedLabelConfigObject,
    normalizeLabelConfig
};
```

- [ ] **Step 2: 更新 src/config/schema.js，删除已迁出的 normalizer 函数定义**

从 schema.js 中删除 `normalizeIdList`、`createDefaultSubscriptionAtAllRules`、`normalizeSubscriptionAtAllRules`、`ensureNormalizedLabelConfigObject`、`normalizeLabelConfig`（它们已在 normalizers.js 中）。

- [ ] **Step 3: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/normalizers.js src/config/schema.js
git commit
# message: "refactor(config): 迁入 normalizers.js"
# body: 说明 normalizeSubscriptionAtAllRules 等函数从 config.js 迁入此处
```

---

### Task 3: 迁入 store.js（不含 jwtSecret）

**Files:**
- Create: `src/config/store.js`
- Modify: `src/config/schema.js`（删除 CONFIG_PATH 等已迁移的文件级变量）

- [ ] **Step 1: 创建 src/config/store.js**

从 `src/config.js`（行 1–44 文件加载、986–1074 save + defineGetters）移入。注意：
- `jwtSecretLoadedLogged` / `jwtSecretGeneratedLogged` / `authConfigLog` / jwtSecret 相关 fs 读写逻辑**不迁入**，由 Task 3b 单独处理
- `parseValue` 从 `schema.js` 传入 getter，供自定义 `get` 函数使用

```javascript
// src/config/store.js
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { asyncWriteWithBackup } = require('../utils/storageUtils');
const { parseValue } = require('./schema');

const CONFIG_DIR = path.join(__dirname, '../../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function configLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:config', message, fields);
}

// Load overrides from config.json
let _overrides = {};
if (fs.existsSync(CONFIG_PATH)) {
    try {
        _overrides = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        configLog('error', 'config-load-failed', { path: CONFIG_PATH, error: logger.getErrorMessage(e) });
    }
}

function hasOwnOverride(key) {
    return Object.prototype.hasOwnProperty.call(_overrides, key);
}

function cloneConfigValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.parse(JSON.stringify(value));
    }
    return value;
}

// Save debounce
let _saveTimer = null;
let _saveCount = 0;
let _saveErrorCount = 0;

function save() {
    if (_saveTimer) clearTimeout(_saveTimer);
    configLog('info', 'STORE', 'svc:config', 'config-save-queued');
    _saveTimer = setTimeout(() => _performSave(), 100);
}

async function _performSave() {
    const startTime = Date.now();
    _saveCount++;
    try {
        await asyncWriteWithBackup(CONFIG_PATH, _overrides, false);
        const duration = Date.now() - startTime;
        logger.logEvent('info', 'STORE', 'svc:config', 'config-saved', { durationMs: duration, total: _saveCount });
        if (duration > 100) configLog('warn', 'config-save-slow', { durationMs: duration });
        _saveErrorCount = 0;
    } catch (e) {
        configLog('error', 'config-save-failed', { error: logger.getErrorMessage(e) });
        _saveErrorCount++;
        if (_saveErrorCount >= 5) {
            configLog('error', 'config-save-failure-threshold', { consecutiveFailures: _saveErrorCount });
            _saveErrorCount = 0;
        }
    }
}

// Define dynamic getters/setters for all META keys
// 注意：jwtSecret 不在此定义（由 jwtSecretOwner.js 独立提供）
function defineGetters(config, META) {
    Object.keys(META).forEach(key => {
        const meta = META[key];
        Object.defineProperty(config, key, {
            get: function() {
                if (meta.get) return meta.get.call(meta, _overrides);
                if (key in _overrides) return _overrides[key];
                if (meta.lazyInit) {
                    _overrides[key] = JSON.parse(JSON.stringify(meta.def));
                    return _overrides[key];
                }
                const envVal = meta.env ? process.env[meta.env] : undefined;
                const rawVal = envVal !== undefined ? envVal : meta.def;
                return parseValue(rawVal, meta.type);
            },
            set: function(val) {
                _overrides[key] = val;
                save();
            },
            enumerable: true,
            configurable: true
        });
    });
}

// Snapshot helper（需要在 aiConfig.js 中使用）
function getEffectiveConfigValueWithoutMutation(key, META) {
    const meta = META[key];
    if (!meta) return undefined;
    if (hasOwnOverride(key)) return cloneConfigValue(_overrides[key]);
    if (typeof meta.get === 'function') return cloneConfigValue(meta.get.call(meta, _overrides));
    const envVal = meta.env ? process.env[meta.env] : undefined;
    const rawVal = envVal !== undefined ? envVal : meta.def;
    return cloneConfigValue(parseValue(rawVal, meta.type));
}

module.exports = {
    _overrides,
    _performSave,
    save,
    defineGetters,
    cloneConfigValue,
    hasOwnOverride,
    getEffectiveConfigValueWithoutMutation
};
```

- [ ] **Step 2: 更新 src/config/schema.js，删除已迁移的文件级常量和函数**

从 schema.js 中删除 `CONFIG_DIR`、`CONFIG_PATH`（store.js 已定义）。

- [ ] **Step 3: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/store.js src/config/schema.js
git commit
# message: "refactor(config): 迁入 store.js（持久层 + getter 生成，不含 jwtSecret）"
# body: 说明 _overrides、save、defineGetters 从 config.js 迁入，jwtSecret 单独由 jwtSecretOwner 管理
```

---

### Task 3b: 迁入 jwtSecretOwner.js（P1-3 修复）

**Files:**
- Create: `src/config/jwtSecretOwner.js`
- Modify: `src/config/schema.js`（从 META 中移除 jwtSecret 条目）
- Modify: `src/config/index.js`（在 Task 7 中处理）

- [ ] **Step 1: 创建 src/config/jwtSecretOwner.js**

jwtSecret getter（`config.js:393-454`）依赖可变 flag、authConfigLog 和 fs 读写，必须与 store 的其他状态隔离，独立为闭环模块。

```javascript
// src/config/jwtSecretOwner.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, '../../config');
const secretPath = path.join(CONFIG_DIR, '.jwtSecret');

let jwtSecretLoadedLogged = false;
let jwtSecretGeneratedLogged = false;

function authConfigLog(level, message, fields = {}) {
    // Use main logger to avoid circular require
    const logger = require('../utils/logger');
    logger.logEvent(level, 'AUTH', 'svc:config', message, fields);
}

function getJwtSecret() {
    // Check override first
    const store = require('./store');
    if ('jwtSecret' in store._overrides) return store._overrides.jwtSecret;

    const envVal = process.env.JWT_SECRET;
    if (envVal) return envVal;

    // Try loading from persisted secret file
    try {
        if (fs.existsSync(secretPath)) {
            const saved = fs.readFileSync(secretPath, 'utf8').trim();
            if (saved && saved.length === 64) {
                if (!jwtSecretLoadedLogged) {
                    authConfigLog('info', 'jwt-secret-loaded', { path: secretPath });
                    jwtSecretLoadedLogged = true;
                }
                return saved;
            }
        }
    } catch (err) {
        authConfigLog('warn', 'jwt-secret-read-failed', { path: secretPath, error: err.message });
    }

    // Generate new secret and persist it
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        const dir = path.dirname(secretPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(secretPath, secret, { mode: 0o600 });
        if (!jwtSecretGeneratedLogged) {
            authConfigLog('warn', 'jwt-secret-generated', { path: secretPath, recommendedAction: 'move_to_env' });
            jwtSecretGeneratedLogged = true;
        }
    } catch (err) {
        authConfigLog('error', 'jwt-secret-save-failed', { path: secretPath, error: err.message });
    }

    return secret;
}

// 直接挂载到 config 对象（由 index.js 调用）
function attachToConfig(config) {
    Object.defineProperty(config, 'jwtSecret', {
        get: function() { return getJwtSecret(); },
        set: function(val) {
            const store = require('./store');
            store._overrides.jwtSecret = val;
            store.save();
        },
        enumerable: true,
        configurable: true
    });
}

module.exports = { attachToConfig, getJwtSecret };
```

- [ ] **Step 2: 从 src/config/schema.js 的 META 中移除 jwtSecret 条目**

jwtSecret 不再通过 META 定义，改为 jwtSecretOwner 独立管理。

- [ ] **Step 3: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/jwtSecretOwner.js src/config/schema.js
git commit
# message: "refactor(config): 迁入 jwtSecretOwner.js（jwtSecret 闭环管理）"
# body: 说明 jwtSecret getter、authConfigLog、两个可变 flag、fs 读写从 config.js 迁入独立闭环
```

---

### Task 4: 迁入 aiConfig.js

**Files:**
- Create: `src/config/aiConfig.js`
- Modify: `src/config/index.js`（在 Task 7 中处理）

- [ ] **Step 1: 创建 src/config/aiConfig.js**

从 `src/config.js:503-709`（snapshot 相关）和 `src/config.js:1082-1163`（isAiEnabledForGroup / isRagEnabledForGroup / 视频下载 helper）移入。

```javascript
// src/config/aiConfig.js
const { AI_EDITOR_SNAPSHOT_FIELDS, AI_SENSITIVE_FIELDS, META, parseValue } = require('./schema');
const { _overrides, cloneConfigValue, hasOwnOverride, getEffectiveConfigValueWithoutMutation } = require('./store');

function createSensitiveFieldMeta(source, configured, masked, inheritedFrom = '') {
    return { source, configured: Boolean(configured), masked: Boolean(masked), inheritedFrom };
}

// type explicitly passed (not inferred from META) to match original config.js:577-584
function getDirectEnvValue(envName, def, type) {
    if (!envName) return cloneConfigValue(def);
    const envVal = process.env[envName];
    if (envVal === undefined) return cloneConfigValue(def);
    return cloneConfigValue(parseValue(envVal, type));
}

function resolveSensitiveAiFieldSnapshot(field) {
    if (hasOwnOverride(field)) {
        const overrideValue = cloneConfigValue(_overrides[field]);
        return { value: overrideValue, meta: createSensitiveFieldMeta('override', Boolean(overrideValue), false) };
    }

    // aiChatApiUrl
    if (field === 'aiChatApiUrl') {
        if (process.env.AI_CHAT_API_URL) return { value: '', meta: createSensitiveFieldMeta('env', true, true) };
        if (hasOwnOverride('aiApiUrl')) return { value: '', meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiUrl), true, 'aiApiUrl') };
        if (process.env.AI_API_URL) return { value: '', meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl') };
        return { value: '', meta: createSensitiveFieldMeta('default', true, true) };
    }

    // aiChatApiKey
    if (field === 'aiChatApiKey') {
        if (process.env.AI_CHAT_API_KEY) return { value: '', meta: createSensitiveFieldMeta('env', true, true) };
        if (hasOwnOverride('aiApiKey')) return { value: '', meta: createSensitiveFieldMeta('override', Boolean(_overrides.aiApiKey), true, 'aiApiKey') };
        if (process.env.AI_API_KEY) return { value: '', meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey') };
        return { value: '', meta: createSensitiveFieldMeta('default', false, true) };
    }

    // aiEmbeddingApiUrl
    if (field === 'aiEmbeddingApiUrl') {
        if (process.env.AI_EMBEDDING_API_URL) return { value: '', meta: createSensitiveFieldMeta('env', true, true) };
        if (process.env.AI_API_URL) return { value: '', meta: createSensitiveFieldMeta('env', true, true, 'aiApiUrl') };
        return { value: '', meta: createSensitiveFieldMeta('default', true, true) };
    }

    // aiEmbeddingApiKey
    if (field === 'aiEmbeddingApiKey') {
        if (process.env.AI_EMBEDDING_API_KEY) return { value: '', meta: createSensitiveFieldMeta('env', true, true) };
        if (process.env.AI_API_KEY) return { value: '', meta: createSensitiveFieldMeta('env', true, true, 'aiApiKey') };
        return { value: '', meta: createSensitiveFieldMeta('default', false, true) };
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
        snapshot[field] = getEffectiveConfigValueWithoutMutation(field, META);
    });
    snapshot.aiEditorMeta = aiEditorMeta;
    return snapshot;
}

function buildDashboardConfigSnapshot() {
    return {
        subscriptionCheckInterval: getEffectiveConfigValueWithoutMutation('subscriptionCheckInterval', META),
        linkCacheTimeout:           getEffectiveConfigValueWithoutMutation('linkCacheTimeout', META),
        showId:                    getEffectiveConfigValueWithoutMutation('showId', META),
        previewGradientColor1:     getEffectiveConfigValueWithoutMutation('previewGradientColor1', META),
        previewGradientColor2:     getEffectiveConfigValueWithoutMutation('previewGradientColor2', META),
        videoDownloadEnabled:      getEffectiveConfigValueWithoutMutation('videoDownloadEnabled', META),
        videoDownloadResolution:   getEffectiveConfigValueWithoutMutation('videoDownloadResolution', META),
        videoDownloadMaxDuration:  getEffectiveConfigValueWithoutMutation('videoDownloadMaxDuration', META),
        videoDownloadAutoClean:    getEffectiveConfigValueWithoutMutation('videoDownloadAutoClean', META),
        videoDownloadCleanTimeout: getEffectiveConfigValueWithoutMutation('videoDownloadCleanTimeout', META),
        ...buildAiEditorSnapshot()
    };
}

function isAiEnabledForGroup(groupId, config) {
    if (!config.aiEnabled) return false;
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && typeof groupConfig.aiEnabled === 'boolean') return groupConfig.aiEnabled;
    return true;
}

function isRagEnabledForGroup(groupId, config) {
    if (!isAiEnabledForGroup(groupId, config)) return false;
    if (!config.aiRagEnabled) return false;
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && typeof groupConfig.aiRagEnabled === 'boolean') return groupConfig.aiRagEnabled;
    return true;
}

function isVideoDownloadEnabledForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) return groupConfig.videoDownloadEnabled;
    return config.videoDownloadEnabled;
}

function getVideoDownloadResolutionForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && 'videoDownloadResolution' in groupConfig) return groupConfig.videoDownloadResolution;
    return config.videoDownloadResolution;
}

function getVideoDownloadMaxDurationForGroup(groupId, config) {
    const groupConfig = config.groupConfigs[String(groupId)];
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) return groupConfig.videoDownloadMaxDuration;
    return config.videoDownloadMaxDuration;
}

module.exports = {
    buildAiEditorSnapshot,
    buildDashboardConfigSnapshot,
    isAiEnabledForGroup,
    isRagEnabledForGroup,
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup
};
```

- [ ] **Step 2: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/aiConfig.js
git commit
# message: "refactor(config): 迁入 aiConfig.js（AI + 视频下载 helper）"
# body: 说明 snapshot、isAiEnabledForGroup 等 helper 从 config.js 迁入
```

---

### Task 5: 迁入 authConfig.js

**Files:**
- Create: `src/config/authConfig.js`

- [ ] **Step 1: 创建 src/config/authConfig.js**

从 `src/config.js:805-856` 移入：

```javascript
// src/config/authConfig.js
function getRootAdminQQ() {
    const raw = process.env.ADMIN_QQ;
    if (raw === undefined || raw === null) return '';
    return String(raw).trim();
}

function isRootAdmin(userId) {
    const rootAdminQQ = getRootAdminQQ();
    if (!rootAdminQQ || userId === undefined || userId === null) return false;
    return String(userId) === rootAdminQQ;
}

function isGroupAdmin(groupId, userId, groupConfigs) {
    if (isRootAdmin(userId)) return true;
    if (!groupId) return false;
    const groupConfig = groupConfigs[groupId];
    if (groupConfig && groupConfig.admins && Array.isArray(groupConfig.admins)) {
        return groupConfig.admins.includes(userId.toString());
    }
    return false;
}

function addGroupAdmin(groupId, userId, groupConfigs, saveFn) {
    if (!groupId || !userId) return false;
    if (!groupConfigs[groupId]) groupConfigs[groupId] = {};
    if (!groupConfigs[groupId].admins) groupConfigs[groupId].admins = [];
    const strId = userId.toString();
    if (!groupConfigs[groupId].admins.includes(strId)) {
        groupConfigs[groupId].admins.push(strId);
        saveFn();
        return true;
    }
    return false;
}

function removeGroupAdmin(groupId, userId, groupConfigs, saveFn) {
    if (!groupId || !userId) return false;
    if (!groupConfigs[groupId] || !groupConfigs[groupId].admins) return false;
    const strId = userId.toString();
    const index = groupConfigs[groupId].admins.indexOf(strId);
    if (index > -1) {
        groupConfigs[groupId].admins.splice(index, 1);
        saveFn();
        return true;
    }
    return false;
}

module.exports = {
    getRootAdminQQ,
    isRootAdmin,
    isGroupAdmin,
    addGroupAdmin,
    removeGroupAdmin
};
```

- [ ] **Step 2: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/authConfig.js
git commit
# message: "refactor(config): 迁入 authConfig.js（鉴权 helper）"
# body: 说明 getRootAdminQQ、isGroupAdmin 等权限函数从 config.js 迁入
```

---

### Task 6: 迁入 groupConfig.js（含 P1-2 修复）

**Files:**
- Create: `src/config/groupConfig.js`

- [ ] **Step 1: 创建 src/config/groupConfig.js**

关键修复（P1-2）：`getGroupConfig` 增加 `globalFallback` 参数，群级未覆盖时回退全局配置值，保持与原实现 `return this[key]` 完全一致的语义。

从 `src/config.js:733-933` 移入：

```javascript
// src/config/groupConfig.js
const { DEFAULT_LABEL_CONFIG } = require('./schema');
const { createDefaultSubscriptionAtAllRules, ensureNormalizedLabelConfigObject } = require('./normalizers');
const { save } = require('./store');
const logger = require('../utils/logger');

const initializingGroups = new Set();

function configLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:config', message, fields);
}

// getGroupConfig: 群级未覆盖时回退 globalFallback（即全局配置值）
// 这保持了原实现 "return this[key]" 的语义，是 P1-2 修复的核心
function getGroupConfig(groupConfigs, groupId, key, globalFallback) {
    if (groupId && groupConfigs[groupId] && groupConfigs[groupId][key] != null) {
        if (key === 'labelConfig') {
            const currentLabelConfig = groupConfigs[groupId][key];
            if (typeof currentLabelConfig !== 'object' || currentLabelConfig === null || Array.isArray(currentLabelConfig)) {
                groupConfigs[groupId][key] = { ...DEFAULT_LABEL_CONFIG };
            } else {
                ensureNormalizedLabelConfigObject(currentLabelConfig);
            }
            return groupConfigs[groupId][key];
        }
        return groupConfigs[groupId][key];
    }
    return globalFallback;
}

function setGroupConfig(groupConfigs, groupId, key, value) {
    if (!groupId) return;
    if (!groupConfigs[groupId]) groupConfigs[groupId] = {};
    if (key === 'labelConfig') {
        const nextValue = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
        groupConfigs[groupId][key] = ensureNormalizedLabelConfigObject(nextValue);
    } else {
        groupConfigs[groupId][key] = value;
    }
    save();
}

function appendGroupConfigArray(groupConfigs, groupId, key, value) {
    if (!groupId) return false;
    if (!groupConfigs[groupId]) groupConfigs[groupId] = {};
    if (!Array.isArray(groupConfigs[groupId][key])) groupConfigs[groupId][key] = [];
    const arr = groupConfigs[groupId][key];
    if (!arr.includes(value)) { arr.push(value); save(); return true; }
    return false;
}

function removeGroupConfigArray(groupConfigs, groupId, key, value) {
    if (!groupId || !groupConfigs[groupId]) return false;
    const arr = groupConfigs[groupId][key];
    if (Array.isArray(arr)) {
        const index = arr.indexOf(value);
        if (index > -1) { arr.splice(index, 1); save(); return true; }
    }
    return false;
}

function ensureGroupConfig(groupConfigs, enabledGroups, groupId) {
    const key = String(groupId);
    if (initializingGroups.has(key)) return groupConfigs[key];
    if (!groupConfigs[key]) {
        initializingGroups.add(key);
        configLog('info', 'group-config-auto-created', { groupId });
        groupConfigs[key] = {
            linkCacheTimeout: 5,
            labelConfig: { ...DEFAULT_LABEL_CONFIG },
            enableCookieSync: false,
            subscriptionAtAll: false,
            subscriptionAtAllRules: createDefaultSubscriptionAtAllRules(),
            cookieSyncGroupNames: [],
            blacklistedQQs: [],
            admins: [],
            nightMode: { mode: 'off', startTime: '21:00', endTime: '06:00' }
        };
        const groups = enabledGroups;
        if (Array.isArray(groups) && groups.length > 0) {
            if (!groups.includes(key)) {
                groups.push(key);
                configLog('info', 'group-whitelist-auto-enabled', { groupId });
            }
        }
        save();
        initializingGroups.delete(key);
    }
    return groupConfigs[key];
}

function isGroupEnabled(enabledGroups, groupId) {
    if (!enabledGroups || enabledGroups.length === 0) return true;
    return enabledGroups.includes(groupId.toString());
}

function enableGroup(enabledGroups, groupId) {
    if (!enabledGroups) enabledGroups = [];
    const strId = groupId.toString();
    if (!enabledGroups.includes(strId)) { enabledGroups.push(strId); save(); }
}

function disableGroup(enabledGroups, groupId) {
    if (!enabledGroups) return;
    const strId = groupId.toString();
    const idx = enabledGroups.indexOf(strId);
    if (idx > -1) enabledGroups.splice(idx, 1);
    save();
}

function applyOverridePatch(overrides, { clear = [], set = {} } = {}) {
    const clearKeys = Array.isArray(clear) ? clear : [];
    const setEntries = set && typeof set === 'object' ? Object.entries(set) : [];
    if (clearKeys.length === 0 && setEntries.length === 0) return;
    clearKeys.forEach((key) => { delete overrides[key]; });
    setEntries.forEach(([key, value]) => { overrides[key] = value; });
    save();
}

function deleteKeys(overrides, keys) {
    if (!Array.isArray(keys)) return;
    applyOverridePatch(overrides, { clear: keys });
    logger.logEvent('info', 'STORE', 'svc:config', 'config-reset', { keys: keys.join(',') });
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
};
```

- [ ] **Step 2: Commit（需先获批准，body 描述迁移内容）**

```bash
git add src/config/groupConfig.js
git commit
# message: "refactor(config): 迁入 groupConfig.js（群配置 helper，含 getGroupConfig 回退修复）"
# body: 说明 getGroupConfig 等群配置函数从 config.js 迁入，getGroupConfig 增加 globalFallback 参数回退全局值
```

---

### Task 7: 完成 src/config/index.js 聚合导出（含 P1-1/P1-4 修复）

**Files:**
- Modify: `src/config/index.js`

- [ ] **Step 1: 写入完整的 src/config/index.js**

关键修复：
- P1-1：`src/config.js` 重导出 `require('./config/index')`（显式路径）
- P1-4：`defineGetters` 从 store 解构后直接调用，不通过 `store.` 前缀

```javascript
// src/config/index.js
// 聚合导出：兼容原 config 对象所有接口

const { META, AI_EDITOR_SNAPSHOT_FIELDS, AI_SENSITIVE_FIELDS,
        SUBSCRIPTION_AT_ALL_SOURCE_KEYS, SUBSCRIPTION_AT_ALL_CATEGORY_KEYS,
        DEFAULT_LABEL_CONFIG } = require('./schema');
const { _overrides, save, defineGetters,
        getEffectiveConfigValueWithoutMutation } = require('./store');
const { normalizeSubscriptionAtAllRules, normalizeLabelConfig,
        createDefaultSubscriptionAtAllRules } = require('./normalizers');
const { attachToConfig } = require('./jwtSecretOwner');
const groupConfig = require('./groupConfig');
const aiConfig = require('./aiConfig');
const authConfig = require('./authConfig');

// 延迟初始化引用（defineGetters 执行后 META lazyInit 已填充）
let _groupConfigs = undefined;
let _enabledGroups = undefined;

function getGroupConfigs() {
    if (_groupConfigs === undefined) _groupConfigs = config.groupConfigs;
    return _groupConfigs;
}
function getEnabledGroups() {
    if (_enabledGroups === undefined) _enabledGroups = config.enabledGroups;
    return _enabledGroups;
}

// 构建 config 对象（复刻原 config.js 的公共接口）
const config = {
    _overrides,

    // === 群级配置 helper ===
    // getGroupConfig: 传入全局回退值，保持原 "return this[key]" 语义（P1-2 修复）
    getGroupConfig: (groupId, key) => groupConfig.getGroupConfig(getGroupConfigs(), groupId, key, config[key]),
    setGroupConfig: (groupId, key, value) => groupConfig.setGroupConfig(getGroupConfigs(), groupId, key, value),
    appendGroupConfigArray: (groupId, key, value) => groupConfig.appendGroupConfigArray(getGroupConfigs(), groupId, key, value),
    removeGroupConfigArray: (groupId, key, value) => groupConfig.removeGroupConfigArray(getGroupConfigs(), groupId, key, value),
    ensureGroupConfig: (groupId) => groupConfig.ensureGroupConfig(getGroupConfigs(), getEnabledGroups(), groupId),
    isGroupEnabled: (groupId) => groupConfig.isGroupEnabled(getEnabledGroups(), groupId),
    enableGroup: (groupId) => groupConfig.enableGroup(getEnabledGroups(), groupId),
    disableGroup: (groupId) => groupConfig.disableGroup(getEnabledGroups(), groupId),
    applyOverridePatch: (patch) => groupConfig.applyOverridePatch(_overrides, patch),
    deleteKeys: (keys) => groupConfig.deleteKeys(_overrides, keys),

    // === 权限 helper ===
    getRootAdminQQ: authConfig.getRootAdminQQ,
    isRootAdmin: authConfig.isRootAdmin,
    isGroupAdmin: (groupId, userId) => authConfig.isGroupAdmin(groupId, userId, getGroupConfigs()),
    addGroupAdmin: (groupId, userId) => authConfig.addGroupAdmin(groupId, userId, getGroupConfigs(), save),
    removeGroupAdmin: (groupId, userId) => authConfig.removeGroupAdmin(groupId, userId, getGroupConfigs(), save),

    // === 快照 ===
    getConfigSnapshot: () => {
        const snapshot = {};
        Object.keys(META).forEach((key) => {
            const value = config[key];
            snapshot[key] = (value && typeof value === 'object') ? JSON.parse(JSON.stringify(value)) : value;
        });
        return snapshot;
    },
    getAiEditorSnapshot: aiConfig.buildAiEditorSnapshot,
    getDashboardConfigSnapshot: aiConfig.buildDashboardConfigSnapshot,

    // === 保存 ===
    save
};

// 定义所有 META getter/setter（jwtSecret 由 jwtSecretOwner 单独挂载）
defineGetters(config, META);

// jwtSecret 独立挂载（修复 jwtSecret 依赖链断裂问题）
attachToConfig(config);

// 导出兼容接口
module.exports = config;

// 导出独立 helper（保持向后兼容）
module.exports.isAiEnabledForGroup          = (groupId) => aiConfig.isAiEnabledForGroup(groupId, config);
module.exports.isRagEnabledForGroup         = (groupId) => aiConfig.isRagEnabledForGroup(groupId, config);
module.exports.isVideoDownloadEnabledForGroup   = (groupId) => aiConfig.isVideoDownloadEnabledForGroup(groupId, config);
module.exports.getVideoDownloadResolutionForGroup = (groupId) => aiConfig.getVideoDownloadResolutionForGroup(groupId, config);
module.exports.getVideoDownloadMaxDurationForGroup  = (groupId) => aiConfig.getVideoDownloadMaxDurationForGroup(groupId, config);
module.exports.createDefaultSubscriptionAtAllRules = createDefaultSubscriptionAtAllRules;
module.exports.normalizeSubscriptionAtAllRules    = normalizeSubscriptionAtAllRules;
module.exports.SUBSCRIPTION_AT_ALL_SOURCE_KEYS  = SUBSCRIPTION_AT_ALL_SOURCE_KEYS;
module.exports.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS = SUBSCRIPTION_AT_ALL_CATEGORY_KEYS;
module.exports.DEFAULT_LABEL_CONFIG             = DEFAULT_LABEL_CONFIG;
module.exports.normalizeLabelConfig             = normalizeLabelConfig;
```

- [ ] **Step 2: 验证语法**

```bash
node -e "require('./src/config/index')" && echo "OK"
```

- [ ] **Step 3: 运行测试**

```bash
npm test 2>&1 | tail -20
```

- [ ] **Step 4: Commit（需先获批准，body 描述聚合内容）**

```bash
git add src/config/index.js
git commit
# message: "refactor(config): 完成 index.js 聚合导出（src/config.js 重导出路径修复）"
# body: 说明 index.js 如何聚合各子模块，jwtSecretOwner.attachToConfig 如何挂载 jwtSecret
```

---

### Task 8: 回归验证

**Files:**
- Run: `npm test`
- Run: `node tools/preview-lab.js "https://www.bilibili.com/opus/1183668934980665366" --fresh --out-name config-refactor-check`

- [ ] **Step 1: 运行完整单元测试**

```bash
npm test
```

预期：全部通过。

- [ ] **Step 2: 验证关键行为**

```bash
# 验证 src/config.js 重导出正常
node -e "const c = require('./src/config'); console.log('aiEnabled:', c.aiEnabled, 'groupConfigs type:', typeof c.groupConfigs)"

# 验证 getGroupConfig 回退语义（群级未覆盖时应返回全局值）
node -e "const c = require('./src/config'); const v = c.getGroupConfig('999999', 'linkCacheTimeout'); console.log('fallback to global linkCacheTimeout:', v, '(should be 600)')"

# 验证 jwtSecret getter 正常（依赖 jwtSecretOwner）
node -e "const c = require('./src/config'); console.log('jwtSecret length:', c.jwtSecret.length, '(should be 64)')"

# 验证 isAiEnabledForGroup 导出
node -e "const f = require('./src/config'); console.log('isAiEnabledForGroup fn:', typeof f.isAiEnabledForGroup)"

# 验证 ensureGroupConfig 创建新群配置
node -e "const c = require('./src/config'); c.ensureGroupConfig('888888'); console.log('groupConfig created:', '888888' in c.groupConfigs)"
```

- [ ] **Step 3: Commit（需先获批准，body 描述验证内容）**

```bash
git commit
# message: "test(config): 添加 config 重构回归验证"
# body: 说明验证了哪些行为（重导出路径、getGroupConfig 回退、jwtSecret、isAiEnabledForGroup 等）
```

---

## 自检清单

- [ ] P1-1：`src/config.js` 重导出路径为 `require('./config/index')`
- [ ] P1-2：`getGroupConfig(groupId, key)` 群级未覆盖时回退全局配置值（传入 `config[key]` 作为 globalFallback）
- [ ] P1-3：jwtSecret 独立闭环，jwtSecretOwner.js 不依赖 store 中的可变 flag
- [ ] P1-4：`defineGetters` 调用为 `defineGetters(config, META)`，不是 `store.defineGetters`
- [ ] 所有 `require('./config')` 和 `require('../config')` 调用方无需修改
- [ ] `npm test` 全部通过
- [ ] 无新增依赖，无环境变更
