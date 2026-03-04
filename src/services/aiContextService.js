const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const storageUtils = require('../utils/storageUtils');

class AiContextService {
    constructor() {
        this.contexts = new Map(); // groupId -> [{role, content}, ...]
        this.lastAccess = new Map(); // groupId -> timestamp (for LRU tracking)
        this.maxCachedGroups = 50; // 最多缓存 50 个群组上下文
        this.contextTTL = 60 * 60 * 1000; // 1 小时未访问自动卸载
        this.dataDir = path.join(process.cwd(), 'data');
        this.contextsDir = path.join(this.dataDir, 'contexts');
        this.legacyFile = path.join(this.dataDir, 'ai_contexts.json');
        this.saveTimers = new Map(); // groupId -> timer

        // 定期清理过期上下文（每 30 分钟）
        this.cleanupTimer = setInterval(() => {
            this.cleanupStaleContexts();
        }, 30 * 60 * 1000);

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
        // 更新访问时间（用于 LRU 和 TTL）
        this.lastAccess.set(groupId, Date.now());

        if (this.contexts.has(groupId)) {
            return this.contexts.get(groupId);
        }

        // 加载前检查是否超过最大缓存数量限制
        if (this.contexts.size >= this.maxCachedGroups) {
            this.evictLRUContext();
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
                logger.debug(`[AiContext] Loaded context for group ${groupId} (${context.length} messages)`);
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
    addMessageToContext(groupId, role, content, userId = null, userName = null, meta = null) {
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

        const safeMeta = (meta && typeof meta === 'object') ? meta : {};
        if (safeMeta.speakerId != null) {
            msgObj.speakerId = String(safeMeta.speakerId);
        } else if (userId) {
            msgObj.speakerId = String(userId);
        }
        if (safeMeta.speakerName != null) {
            msgObj.speakerName = String(safeMeta.speakerName);
        } else if (userName) {
            msgObj.speakerName = String(userName);
        }
        if (Array.isArray(safeMeta.mentionIds)) {
            msgObj.mentionIds = safeMeta.mentionIds.map(id => String(id));
        } else {
            msgObj.mentionIds = [];
        }
        msgObj.isAtBot = safeMeta.isAtBot === true;
        if (typeof safeMeta.source === 'string' && safeMeta.source) {
            msgObj.source = safeMeta.source;
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

    // 清理超过 TTL 的上下文（基于时间）
    cleanupStaleContexts() {
        const now = Date.now();
        let cleaned = 0;

        for (const [groupId, lastTime] of this.lastAccess) {
            if (now - lastTime > this.contextTTL) {
                this.unloadContext(groupId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info(`[AiContext] Cleaned up ${cleaned} stale contexts (TTL: ${this.contextTTL/1000/60} min)`);
        }
    }

    // 驱逐最久未访问的上下文（LRU 策略）
    evictLRUContext() {
        let oldestGroupId = null;
        let oldestTime = Infinity;

        for (const [groupId, lastTime] of this.lastAccess) {
            if (lastTime < oldestTime) {
                oldestTime = lastTime;
                oldestGroupId = groupId;
            }
        }

        if (oldestGroupId) {
            logger.info(`[AiContext] Cache full (${this.contexts.size}/${this.maxCachedGroups}), evicting LRU group ${oldestGroupId}`);
            this.unloadContext(oldestGroupId);
        }
    }

    // 卸载上下文（保存到磁盘后从内存移除）
    unloadContext(groupId) {
        // 先取消待保存的定时器，立即保存
        if (this.saveTimers.has(groupId)) {
            clearTimeout(this.saveTimers.get(groupId));
            this.saveTimers.delete(groupId);
        }

        const context = this.contexts.get(groupId);
        if (context) {
            try {
                if (!fs.existsSync(this.contextsDir)) {
                    fs.mkdirSync(this.contextsDir, { recursive: true });
                }

                // 使用 storageUtils 进行裁剪和保存
                const maxSize = config.getGroupConfig(groupId, 'aiHistoryMaxSize');
                const trimRatio = config.getGroupConfig(groupId, 'aiTrimRatio');
                storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                const filePath = path.join(this.contextsDir, `${groupId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf8');
                logger.debug(`[AiContext] Saved and unloaded context for group ${groupId} (${context.length} messages)`);
            } catch (e) {
                logger.error(`[AiContext] Failed to save before unload for group ${groupId}:`, e);
            }
        }

        // 从内存中移除
        this.contexts.delete(groupId);
        this.lastAccess.delete(groupId);
    }

    // 清理所有定时器（进程退出时调用）
    dispose() {
        // 停止定期清理定时器
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            logger.debug('[AiContext] Cleanup timer stopped');
        }

        // 保存所有待保存的上下文
        for (const [groupId, timer] of this.saveTimers) {
            clearTimeout(timer);
            const context = this.contexts.get(groupId);
            if (context) {
                try {
                    const maxSize = config.getGroupConfig(groupId, 'aiHistoryMaxSize');
                    const trimRatio = config.getGroupConfig(groupId, 'aiTrimRatio');
                    storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                    const filePath = path.join(this.contextsDir, `${groupId}.json`);
                    fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf8');
                } catch (e) {
                    logger.error(`[AiContext] Failed to save on dispose for group ${groupId}:`, e);
                }
            }
        }
        this.saveTimers.clear();

        logger.info('[AiContext] Service disposed, all contexts saved');
    }

    // 获取缓存统计信息（用于监控）
    getCacheStats() {
        return {
            cachedGroups: this.contexts.size,
            maxCachedGroups: this.maxCachedGroups,
            pendingSaves: this.saveTimers.size,
            ttlMinutes: this.contextTTL / 1000 / 60
        };
    }
}

module.exports = new AiContextService();
