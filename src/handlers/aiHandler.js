const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class AiHandler {
    constructor() {
        this.contexts = new Map(); // groupId -> [{role, content}, ...]
    }

    async getReply(message, userId, groupId) {
        try {
            if (!config.aiApiKey) {
                logger.warn('AI_API_KEY is not set. Skipping AI reply.');
                return null;
            }

            // Initialize context for group if not exists
            // Use userId for private messages if groupId is not provided
            const contextKey = groupId || userId;
            if (!this.contexts.has(contextKey)) {
                this.contexts.set(contextKey, []);
            }

            const context = this.contexts.get(contextKey);

            // Add user message to context
            context.push({ role: 'user', content: message });

            // Trim context to limit (keep recent messages)
            // config.aiContextLimit determines how many messages to keep
            const contextLimit = config.getGroupConfig(groupId, 'aiContextLimit');
            while (context.length > contextLimit) {
                context.shift();
            }

            // Construct messages array for API
            const messages = [
                { role: 'system', content: config.aiSystemPrompt },
                ...context
            ];

            const response = await axios.post(config.aiApiUrl, {
                model: config.aiModel,
                messages: messages
            }, {
                headers: {
                    'Authorization': `Bearer ${config.aiApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30s timeout
            });

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                const reply = response.data.choices[0].message.content.trim();
                
                // Add assistant reply to context
                context.push({ role: 'assistant', content: reply });
                
                // Trim context again
                while (context.length > contextLimit) {
                    context.shift();
                }

                return reply;
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

    shouldReply(message, isAt, groupId) {
        if (isAt) return true;
        // Check if AI is enabled for this group (if there's a switch, but currently it's probability)
        // User mentioned "AI context menu" -> "ai上下文菜单" switch?
        // If user wants a switch, we might need a boolean config like 'aiEnabled'
        // But for now, user said "AI context menu" which might be "aiContextLimit".
        // Let's stick to probability for now or check if there's a new requirement.
        // But user said "AI context menu... adjusted to follow group ID".
        // If it means "Probability", I should use getGroupConfig for probability too?
        // User didn't mention probability explicitly, but "AI context menu" usually implies the feature itself.
        // I'll leave probability global unless user asked, but I will pass groupId to be safe.
        return Math.random() < config.aiProbability;
    }
    
    // Clear context for a group
    clearContext(groupId) {
        this.contexts.delete(groupId);
    }
}

module.exports = new AiHandler();
