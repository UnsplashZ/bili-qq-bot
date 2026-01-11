const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

const CONFIG_DIR = path.join(__dirname, '../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

let configData = {};
if (fs.existsSync(CONFIG_PATH)) {
    try {
        configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        logger.error('[Config] Failed to load config.json', e);
    }
}

const config = {
    // --- Environment Variables (.env) ---
    // NapCat WebSocket URL
    wsUrl: process.env.WS_URL || 'ws://localhost:3001',
    
    // AI Config (Static)
    aiApiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    aiApiKey: process.env.AI_API_KEY || '',
    aiModel: process.env.AI_MODEL || 'gpt-3.5-turbo',
    // Auto-infer embedding URL from API URL if not provided
    aiEmbeddingApiUrl: process.env.AI_EMBEDDING_API_URL || (process.env.AI_API_URL ? process.env.AI_API_URL.replace('/chat/completions', '/embeddings') : 'https://api.openai.com/v1/embeddings'),
    // Use dedicated embedding key if provided, otherwise fallback to main AI key
    aiEmbeddingApiKey: process.env.AI_EMBEDDING_API_KEY || process.env.AI_API_KEY || '',
    aiEmbeddingModel: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    // Proxy Config
    aiChatProxy: process.env.AI_CHAT_PROXY || process.env.AI_PROXY || '',
    aiEmbeddingProxy: process.env.AI_EMBEDDING_PROXY || process.env.AI_PROXY || '',
    aiProbability: parseFloat(process.env.AI_PROBABILITY || '0.1'),
    aiSystemPrompt: process.env.AI_SYSTEM_PROMPT || '你是一个有用的助手。',
    
    // System Paths & Admin
    pythonPath: process.env.PYTHON_PATH || (fs.existsSync(path.join(__dirname, '../venv/bin/python')) ? path.join(__dirname, '../venv/bin/python') : 'python3'),
    biliScriptPath: './src/services/bili_service.py',
    adminQQ: process.env.ADMIN_QQ,
    useBase64Send: process.env.USE_BASE64_SEND === 'true',
    // NapCat temporary file path (host path mapped to container)
    napcatTempPath: process.env.NAPCAT_TEMP_PATH || '/app/.config/QQ/tmp/',
    // Path sent to NapCat (where NapCat looks for the file inside ITS container)
    napcatReadPath: process.env.NAPCAT_READ_PATH || '/app/.config/QQ/tmp/',

    // --- Dynamic Configuration (config.json) ---
    // AI Context Limit (Number of messages sent to API)
    aiContextLimit: configData.aiContextLimit || 10,

    // AI History File Size Limit in Bytes (default 200MB)
    aiHistoryMaxSize: configData.aiHistoryMaxSize || 200 * 1024 * 1024,

    // AI Vector Memory File Size Limit in Bytes (default 200MB)
    aiVectorMaxSize: configData.aiVectorMaxSize || 200 * 1024 * 1024,

    // Blacklist QQ numbers
    blacklistedQQs: configData.blacklistedQQs || [],

    // Enabled Groups (empty means all allowed)
    enabledGroups: configData.enabledGroups || [],

    // Link processing cache timeout in seconds
    linkCacheTimeout: parseInt(configData.linkCacheTimeout || 600),

    // Subscription check interval in seconds
    subscriptionCheckInterval: parseInt(configData.subscriptionCheckInterval || 60),

    // Night Mode Config
    nightMode: configData.nightMode || {
        mode: 'off', // 'on', 'off', 'timed'
        startTime: '21:00',
        endTime: '06:00'
    },

    // Label Config (Show/Hide top-left label)
    labelConfig: configData.labelConfig || {
        video: true,
        bangumi: true,
        article: true,
        live: true,
        dynamic: true,
        user: true
    },

    // Show ID Config (Toggle UID display)
    showId: configData.showId !== undefined ? configData.showId : true,

    // Group Configs (overrides global settings per group)
    groupConfigs: configData.groupConfigs || {},

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

    // Save configuration to file (Only dynamic fields)
    // Uses a debounced queue to prevent excessive disk writes
    _saveTimer: null,
    _saveQueued: false,

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
        const data = {
            aiProbability: this.aiProbability,
            aiContextLimit: this.aiContextLimit,
            aiHistoryMaxSize: this.aiHistoryMaxSize,
            aiVectorMaxSize: this.aiVectorMaxSize,
            blacklistedQQs: this.blacklistedQQs,
            enabledGroups: this.enabledGroups,
            linkCacheTimeout: this.linkCacheTimeout,
            subscriptionCheckInterval: this.subscriptionCheckInterval,
            nightMode: this.nightMode,
            labelConfig: this.labelConfig,
            showId: this.showId,
            groupConfigs: this.groupConfigs
        };

        try {
            const jsonString = JSON.stringify(data, null, 2);
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

module.exports = config;
