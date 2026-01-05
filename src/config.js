const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const CONFIG_DIR = path.join(__dirname, '../config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

let configData = {};
if (fs.existsSync(CONFIG_PATH)) {
    try {
        configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('Failed to load config.json', e);
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
    aiProbability: parseFloat(process.env.AI_PROBABILITY || '0.1'),
    aiSystemPrompt: process.env.AI_SYSTEM_PROMPT || '你是一个有用的助手。',
    
    // System Paths & Admin
    pythonPath: process.env.PYTHON_PATH || 'venv/bin/python',
    biliScriptPath: './src/services/bili_service.py',
    adminQQ: process.env.ADMIN_QQ,
    useBase64Send: process.env.USE_BASE64_SEND === 'true',

    // --- Dynamic Configuration (config.json) ---
    // AI Context Limit
    aiContextLimit: configData.aiContextLimit || 10,

    // Blacklist QQ numbers
    blacklistedQQs: configData.blacklistedQQs || [],

    // Enabled Groups (empty means all allowed)
    enabledGroups: configData.enabledGroups || [],

    // Link processing cache timeout in seconds
    linkCacheTimeout: parseInt(configData.linkCacheTimeout || 300),

    // Subscription check interval in seconds
    subscriptionCheckInterval: parseInt(configData.subscriptionCheckInterval || 60),

    // Save configuration to file (Only dynamic fields)
    save: function() {
        const data = {
            aiContextLimit: this.aiContextLimit,
            blacklistedQQs: this.blacklistedQQs,
            enabledGroups: this.enabledGroups,
            linkCacheTimeout: this.linkCacheTimeout,
            subscriptionCheckInterval: this.subscriptionCheckInterval
        };
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
            console.log('Configuration saved to config.json');
        } catch (e) {
            console.error('Failed to save configuration:', e);
        }
    }
};

module.exports = config;
