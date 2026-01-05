const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class AiHandler {
    async getReply(message, userId) {
        try {
            if (!config.aiApiKey) {
                logger.warn('AI_API_KEY is not set. Skipping AI reply.');
                return null;
            }

            const response = await axios.post(config.aiApiUrl, {
                model: config.aiModel,
                messages: [
                    { role: 'system', content: config.aiSystemPrompt },
                    { role: 'user', content: message }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${config.aiApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10s timeout
            });

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content.trim();
            }
            
            logger.error('Unexpected AI API response structure:', response.data);
            return null;
        } catch (error) {
            if (error.response) {
                logger.error(`AI API Error (Status ${error.response.status}):`, error.response.data);
            } else {
                logger.error('AI API Request Error:', error.message);
            }
            return null;
        }
    }

    shouldReply(message, isAt) {
        if (isAt) return true;
        return Math.random() < config.aiProbability;
    }
}

module.exports = new AiHandler();