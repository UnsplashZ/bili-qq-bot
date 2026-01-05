require('dotenv').config();

module.exports = {
    // NapCat WebSocket URL
    wsUrl: process.env.WS_URL || 'ws://localhost:3001',
    
    // AI API Config
    aiApiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    aiApiKey: process.env.AI_API_KEY || '',
    aiModel: process.env.AI_MODEL || 'gpt-3.5-turbo',
    aiProbability: parseFloat(process.env.AI_PROBABILITY || '0.1'), // 0.0 to 1.0
    aiSystemPrompt: process.env.AI_SYSTEM_PROMPT || '你是一个有用的助手。',
    
    // Bilibili Python Script Path
    pythonPath: process.env.PYTHON_PATH || 'venv/bin/python', // Default to venv python
    biliScriptPath: './src/services/bili_service.py',
    
    // Admin QQ for certain commands (optional)
    adminQQ: process.env.ADMIN_QQ,
};
