const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const storageUtils = require('../utils/storageUtils');

function aiLog(level, scope, message, fields = {}) {
    logger.logEvent(level, 'AI', scope, message, fields);
}

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

    validateContextId(groupId) {
        const normalized = String(groupId || '').trim();
        if (/^\d+$/.test(normalized) || /^private_\d+$/.test(normalized)) {
            return normalized;
        }
        throw new Error(`Invalid context id: ${groupId}`);
    }

    _resolveContextFilePath(groupId) {
        const safeGroupId = this.validateContextId(groupId);
        const resolvedBaseDir = path.resolve(this.contextsDir);
        const resolvedPath = path.resolve(resolvedBaseDir, `${safeGroupId}.json`);
        if (resolvedPath !== resolvedBaseDir && !resolvedPath.startsWith(resolvedBaseDir + path.sep)) {
            throw new Error(`Unsafe context path for id: ${groupId}`);
        }
        return { safeGroupId, resolvedPath };
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
                aiLog('info', 'svc:ai-context', 'legacy-history-migration-started');
                const data = fs.readFileSync(this.legacyFile, 'utf8');
                try {
                    const entries = JSON.parse(data);
                    // entries is [[key, value], ...]
                    for (const [key, value] of entries) {
                        try {
                            const { resolvedPath } = this._resolveContextFilePath(key);
                            fs.writeFileSync(resolvedPath, JSON.stringify(value, null, 2), 'utf8');
                        } catch (e) {
                            aiLog('warn', 'svc:ai-context', 'legacy-context-key-skipped', {
                                groupId: key
                            });
                        }
                    }
                    // Rename legacy file to .bak
                    fs.renameSync(this.legacyFile, this.legacyFile + '.bak');
                    aiLog('info', 'svc:ai-context', 'legacy-history-migration-finished', {
                        groupCount: entries.length
                    });
                } catch (parseError) {
                    aiLog('error', 'svc:ai-context', 'legacy-history-migration-parse-failed', {
                        error: logger.getErrorMessage(parseError)
                    });
                }
            }
        } catch (e) {
            aiLog('error', 'svc:ai-context', 'storage-init-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    // Get context for a group, loading from disk if necessary
    getContext(groupId) {
        const safeGroupId = this.validateContextId(groupId);
        // 更新访问时间（用于 LRU 和 TTL）
        this.lastAccess.set(safeGroupId, Date.now());

        if (this.contexts.has(safeGroupId)) {
            return this.contexts.get(safeGroupId);
        }

        // 加载前检查是否超过最大缓存数量限制
        if (this.contexts.size >= this.maxCachedGroups) {
            this.evictLRUContext();
        }

        const { resolvedPath } = this._resolveContextFilePath(safeGroupId);
        try {
            if (fs.existsSync(resolvedPath)) {
                const data = fs.readFileSync(resolvedPath, 'utf8');
                if (!data || data.trim() === '') {
                    throw new Error('Empty file');
                }
                const context = JSON.parse(data);
                this.contexts.set(safeGroupId, context);
                aiLog('debug', logger.createScope('ctx', safeGroupId), 'context-loaded', {
                    messageCount: context.length
                });
                return context;
            }
        } catch (e) {
            aiLog('error', logger.createScope('ctx', safeGroupId), 'context-load-failed', {
                error: logger.getErrorMessage(e)
            });
        }

        // Return empty context if file doesn't exist or error
        const newContext = [];
        this.contexts.set(safeGroupId, newContext);
        return newContext;
    }

    // Save context for a specific group asynchronously with debounce
    saveContext(groupId) {
        const safeGroupId = this.validateContextId(groupId);

        if (this.saveTimers.has(safeGroupId)) {
            clearTimeout(this.saveTimers.get(safeGroupId));
        }

        const timer = setTimeout(async () => {
            try {
                const context = this.contexts.get(safeGroupId);
                if (!context) return;

                if (!fs.existsSync(this.contextsDir)) {
                    fs.mkdirSync(this.contextsDir, { recursive: true });
                }

                // Check size and trim before saving using storageUtils
                const maxSize = config.getGroupConfig(safeGroupId, 'aiHistoryMaxSize');
                const trimRatio = config.getGroupConfig(safeGroupId, 'aiTrimRatio');
                storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                const { resolvedPath } = this._resolveContextFilePath(safeGroupId);

                // Use atomic write with backup
                await storageUtils.asyncWriteWithBackup(resolvedPath, context);

                this.saveTimers.delete(safeGroupId);
            } catch (e) {
                aiLog('error', logger.createScope('ctx', safeGroupId), 'context-save-failed', {
                    error: logger.getErrorMessage(e)
                });
            }
        }, 1000); // Wait 1s after last change before saving

        this.saveTimers.set(safeGroupId, timer);
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
        if (safeMeta.messageId != null) {
            msgObj.messageId = String(safeMeta.messageId);
        }
        if (safeMeta.replyToMessageId != null) {
            msgObj.replyToMessageId = String(safeMeta.replyToMessageId);
        }
        if (safeMeta.replyToSpeakerId != null) {
            msgObj.replyToSpeakerId = String(safeMeta.replyToSpeakerId);
        }
        if (safeMeta.isReplyToBot === true) {
            msgObj.isReplyToBot = true;
        }
        if (typeof safeMeta.normalizedText === 'string' && safeMeta.normalizedText.trim()) {
            msgObj.normalizedText = safeMeta.normalizedText.trim();
        }
        if (Array.isArray(safeMeta.topicHints)) {
            msgObj.topicHints = safeMeta.topicHints
                .filter(item => typeof item === 'string')
                .map(item => item.trim())
                .filter(Boolean);
        }
        if (safeMeta.currentMentionsBot === true) {
            msgObj.currentMentionsBot = true;
        }
        if (typeof safeMeta.botNameHit === 'string' && safeMeta.botNameHit.trim()) {
            msgObj.botNameHit = safeMeta.botNameHit.trim();
        }
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
        const safeGroupId = this.validateContextId(groupId);
        this.contexts.set(safeGroupId, []);
        this.saveContext(safeGroupId);
        aiLog('info', logger.createScope('ctx', safeGroupId), 'context-reset');
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
            aiLog('info', 'svc:ai-context', 'stale-contexts-cleaned', {
                cleanedCount: cleaned,
                ttlMinutes: this.contextTTL / 1000 / 60
            });
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
            aiLog('info', logger.createScope('ctx', oldestGroupId), 'context-evicted-lru', {
                cachedGroups: this.contexts.size,
                maxCachedGroups: this.maxCachedGroups
            });
            this.unloadContext(oldestGroupId);
        }
    }

    // 卸载上下文（保存到磁盘后从内存移除）
    unloadContext(groupId) {
        const safeGroupId = this.validateContextId(groupId);
        // 先取消待保存的定时器，立即保存
        if (this.saveTimers.has(safeGroupId)) {
            clearTimeout(this.saveTimers.get(safeGroupId));
            this.saveTimers.delete(safeGroupId);
        }

        const context = this.contexts.get(safeGroupId);
        if (context) {
            try {
                if (!fs.existsSync(this.contextsDir)) {
                    fs.mkdirSync(this.contextsDir, { recursive: true });
                }

                // 使用 storageUtils 进行裁剪和保存
                const maxSize = config.getGroupConfig(safeGroupId, 'aiHistoryMaxSize');
                const trimRatio = config.getGroupConfig(safeGroupId, 'aiTrimRatio');
                storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                const { resolvedPath } = this._resolveContextFilePath(safeGroupId);
                fs.writeFileSync(resolvedPath, JSON.stringify(context, null, 2), 'utf8');
                aiLog('debug', logger.createScope('ctx', safeGroupId), 'context-saved-and-unloaded', {
                    messageCount: context.length
                });
            } catch (e) {
                aiLog('error', logger.createScope('ctx', safeGroupId), 'context-save-before-unload-failed', {
                    error: logger.getErrorMessage(e)
                });
            }
        }

        // 从内存中移除
        this.contexts.delete(safeGroupId);
        this.lastAccess.delete(safeGroupId);
    }

    // 清理所有定时器（进程退出时调用）
    dispose() {
        // 停止定期清理定时器
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            aiLog('debug', 'svc:ai-context', 'cleanup-timer-stopped');
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
                    aiLog('error', logger.createScope('ctx', groupId), 'context-save-on-dispose-failed', {
                        error: logger.getErrorMessage(e)
                    });
                }
            }
        }
        this.saveTimers.clear();

        aiLog('info', 'svc:ai-context', 'service-disposed');
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
