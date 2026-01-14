const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const storageUtils = require('../utils/storageUtils');

class AiContextService {
    constructor() {
        this.contexts = new Map(); // groupId -> [{role, content}, ...]
        this.dataDir = path.join(process.cwd(), 'data');
        this.contextsDir = path.join(this.dataDir, 'contexts');
        this.legacyFile = path.join(this.dataDir, 'ai_contexts.json');
        this.saveTimers = new Map(); // groupId -> timer
        this.init();
    }

    // Initialize storage and migrate legacy data if exists
    init() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            if (!fs.existsSync(this.contextsDir)) {
                fs.mkdirSync(this.contextsDir, { recursive: true });
            }

            // Check for legacy file and migrate
            if (fs.existsSync(this.legacyFile)) {
                logger.info('[AiContextService] Found legacy chat history. Migrating...');
                const data = fs.readFileSync(this.legacyFile, 'utf8');
                try {
                    const entries = JSON.parse(data);
                    // entries is [[key, value], ...]
                    for (const [key, value] of entries) {
                        const filePath = path.join(this.contextsDir, `${key}.json`);
                        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
                    }
                    // Rename legacy file to .bak
                    fs.renameSync(this.legacyFile, this.legacyFile + '.bak');
                    logger.info(`[AiContextService] Migrated ${entries.length} group histories to separate files.`);
                } catch (parseError) {
                    logger.error('[AiContextService] Failed to parse legacy history during migration:', parseError);
                }
            }
        } catch (e) {
            logger.error('[AiContextService] Failed to initialize storage:', e);
        }
    }

    // Get context for a group, loading from disk if necessary
    getContext(groupId) {
        if (this.contexts.has(groupId)) {
            return this.contexts.get(groupId);
        }

        const filePath = path.join(this.contextsDir, `${groupId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                if (!data || data.trim() === '') {
                    throw new Error('Empty file');
                }
                const context = JSON.parse(data);
                this.contexts.set(groupId, context);
                return context;
            }
        } catch (e) {
            logger.error(`[AiContextService] Failed to load history for group ${groupId}:`, e);
        }

        // Return empty context if file doesn't exist or error
        const newContext = [];
        this.contexts.set(groupId, newContext);
        return newContext;
    }

    // Save context for a specific group asynchronously with debounce
    saveContext(groupId) {
        if (this.saveTimers.has(groupId)) {
            clearTimeout(this.saveTimers.get(groupId));
        }

        const timer = setTimeout(async () => {
            try {
                const context = this.contexts.get(groupId);
                if (!context) return;

                if (!fs.existsSync(this.contextsDir)) {
                    fs.mkdirSync(this.contextsDir, { recursive: true });
                }

                // Check size and trim before saving using storageUtils
                const maxSize = config.getGroupConfig(groupId, 'aiHistoryMaxSize');
                const trimRatio = config.getGroupConfig(groupId, 'aiTrimRatio');
                storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                const filePath = path.join(this.contextsDir, `${groupId}.json`);

                // Use atomic write with backup
                await storageUtils.asyncWriteWithBackup(filePath, context);

                this.saveTimers.delete(groupId);
            } catch (e) {
                logger.error(`[AiContextService] Error saving history for group ${groupId}:`, e);
            }
        }, 1000); // Wait 1s after last change before saving

        this.saveTimers.set(groupId, timer);
    }

    // Helper to add message, trim context, and trigger save
    addMessageToContext(groupId, role, content, userId = null, userName = null) {
        const context = this.getContext(groupId);
        
        // Construct message object
        const msgObj = { 
            role, 
            content,
            timestamp: Date.now()
        };
        if (userId) {
            msgObj.userId = userId;
        }
        if (userName) {
            msgObj.userName = userName;
        }
        
        context.push(msgObj);

        // We do not trim by count anymore, we rely on checkSizeAndTrim during save
        // But to prevent memory explosion before save, we can keep a safety limit for memory
        const safetyLimit = config.getGroupConfig(groupId, 'aiMemorySafetyLimit');
        if (context.length > safetyLimit) {
            context.shift();
        }

        // Trigger async save for this group
        this.saveContext(groupId);
    }

    // Reset context for a group
    resetContext(groupId) {
        this.contexts.set(groupId, []);
        this.saveContext(groupId);
        logger.info(`[AiContextService] Reset context for group ${groupId}`);
    }
}

module.exports = new AiContextService();
