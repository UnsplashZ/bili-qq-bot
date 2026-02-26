const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const storageUtils = require('../utils/storageUtils');
const { getAxiosProxyConfig } = require('../utils/proxyUtils');

class VectorMemoryService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'vectors');

        // L1 Cache: Vector data (existing)
        this.memories = new Map(); // groupId -> [{text, role, vector, timestamp, importance, accessCount}]
        this.maxL1MemoryBytes = 200 * 1024 * 1024; // 200MB 总内存限制

        // L2 Cache: Group-level LRU cache (max 3 active groups)
        this.groupCache = new Map(); // groupId -> {lastAccess: timestamp, queryCache: Map}
        this.maxCachedGroups = 3;
        this.maxQueryCacheSize = 20; // Max queries per group
        this.queryTTL = 5 * 60 * 1000; // 查询缓存 5 分钟过期

        // Debounced save timers
        this.saveTimers = new Map(); // groupId -> timer

        // 🆕 Eviction lock to prevent concurrent evictions
        this.evictionLock = false;

        // 🆕 Single group size limit (max 50% of total memory)
        this.maxSingleGroupSize = this.maxL1MemoryBytes * 0.5;

        logger.info('[VectorMemory] Service initialized', {
            maxL1Memory: `${(this.maxL1MemoryBytes / 1024 / 1024).toFixed(0)}MB`,
            maxCachedGroups: this.maxCachedGroups,
            maxQueryCacheSize: this.maxQueryCacheSize,
            maxSingleGroup: `${(this.maxSingleGroupSize / 1024 / 1024).toFixed(0)}MB`
        });

        this.init();
    }

    init() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
        } catch (e) {
            logger.error('[VectorMemory] Failed to init directory:', e);
        }
    }

    // Update L2 cache access time for a group
    updateCacheAccess(groupId) {
        if (!config.aiEnableVectorCache) return;

        let cache = this.groupCache.get(groupId);
        if (!cache) {
            cache = {
                lastAccess: Date.now(),
                queryCache: new Map() // Use Map for LRU behavior
            };
            this.groupCache.set(groupId, cache);

            // Evict LRU group if cache is full (async, fire and forget)
            if (this.groupCache.size > this.maxCachedGroups) {
                this.evictLRUGroup().catch(err => {
                    logger.error('[VectorMemory] Failed to evict during cache update:', err);
                });
            }
        } else {
            cache.lastAccess = Date.now();
            // Also touch queryCache to maintain LRU order within query cache
            if (cache.queryCache instanceof Map) {
                // Re-set to move to end (LRU)
                const entries = Array.from(cache.queryCache.entries());
                cache.queryCache = new Map(entries);
            }
        }
    }

    // 🆕 Evict least recently used group from L2 cache (with lock protection)
    async evictLRUGroup() {
        // Prevent concurrent evictions
        if (this.evictionLock) {
            logger.debug('[VectorMemory] Eviction already in progress, skipping');
            return;
        }

        this.evictionLock = true;
        try {
            const entries = Array.from(this.groupCache.entries());
            if (entries.length === 0) {
                logger.debug('[VectorMemory] No groups to evict');
                return;
            }

            // Sort by lastAccess time to find oldest
            entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
            const [oldestGroupId, cacheEntry] = entries[0];

            logger.info(`[VectorMemory] Evicting LRU group: ${oldestGroupId}`, {
                lastAccess: new Date(cacheEntry.lastAccess).toISOString(),
                memoryUsage: `${(this.calculateTotalL1Memory() / 1024 / 1024).toFixed(2)}MB`
            });

            // Save pending changes before eviction to prevent data loss
            if (this.saveTimers.has(oldestGroupId)) {
                await this._flushGroupToStorage(oldestGroupId);
            }

            // Clear caches
            this.groupCache.delete(oldestGroupId);
            this.memories.delete(oldestGroupId);

            logger.info(`[VectorMemory] Successfully evicted group ${oldestGroupId}`);
        } catch (error) {
            logger.error('[VectorMemory] Failed to evict LRU group:', error);
            throw error;
        } finally {
            this.evictionLock = false;
        }
    }

    /**
     * 🆕 Flush group data to storage (async)
     */
    async _flushGroupToStorage(groupId) {
        try {
            // Clear timer
            const timer = this.saveTimers.get(groupId);
            if (timer) {
                clearTimeout(timer);
                this.saveTimers.delete(groupId);
            }

            // Get memory data
            const memory = this.memories.get(groupId);
            if (!memory) {
                logger.debug(`[VectorMemory] No data to flush for group ${groupId}`);
                return;
            }

            // Async write
            const filePath = path.join(this.dataDir, `${groupId}.json`);
            await storageUtils.asyncWriteWithBackup(filePath, memory);

            logger.debug(`[VectorMemory] Flushed ${memory.length} memories for group ${groupId}`);
        } catch (error) {
            logger.error(`[VectorMemory] Failed to flush group ${groupId}:`, error);
            throw error;
        }
    }

    // Initialize group cache (called when loading memory)
    initGroupCache(groupId) {
        if (!config.aiEnableVectorCache) return;

        this.updateCacheAccess(groupId);
    }

    // Load memories for a group (Lazy load) - 🆕 Enhanced with memory limits
    async loadGroupMemory(groupId) {
        if (this.memories.has(groupId)) {
            this.updateCacheAccess(groupId);
            return this.memories.get(groupId);
        }

        logger.info(`[VectorMemory] Loading group ${groupId} into memory`);

        // 🆕 Pre-load memory check: ensure 80% space available
        let currentMemory = this.calculateTotalL1Memory();
        const targetMemory = this.maxL1MemoryBytes * 0.8;

        while (currentMemory > targetMemory && this.groupCache.size > 0) {
            logger.info(`[VectorMemory] Memory usage ${(currentMemory / 1024 / 1024).toFixed(2)}MB exceeds target ${(targetMemory / 1024 / 1024).toFixed(2)}MB, evicting...`);
            await this.evictLRUGroup();
            currentMemory = this.calculateTotalL1Memory();
        }

        const filePath = path.join(this.dataDir, `${groupId}.json`);
        try {
            let data = [];
            if (fs.existsSync(filePath)) {
                const startTime = Date.now();
                data = await storageUtils.safeReadJSON(filePath, []);
                const loadTime = Date.now() - startTime;

                // 🆕 Check single file size
                const fileSize = JSON.stringify(data).length;
                if (fileSize > this.maxSingleGroupSize) {
                    logger.warn(`[VectorMemory] Group ${groupId} exceeds max single group size`, {
                        currentSize: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
                        maxSize: `${(this.maxSingleGroupSize / 1024 / 1024).toFixed(2)}MB`,
                        memoryCount: data.length
                    });

                    // Trim to appropriate size (keep newest 70%)
                    const keepCount = Math.floor(data.length * 0.7);
                    const removed = data.length - keepCount;
                    data = data.slice(-keepCount); // Keep last keepCount items

                    logger.info(`[VectorMemory] Trimmed group ${groupId}: removed ${removed} oldest memories, kept ${keepCount}`);

                    // Immediately save trimmed data
                    await storageUtils.asyncWriteWithBackup(filePath, data);
                }

                logger.info(`[VectorMemory] Loaded ${data.length} memories for group ${groupId}`, {
                    size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
                    loadTime: `${loadTime}ms`,
                    totalMemory: `${(this.calculateTotalL1Memory() / 1024 / 1024).toFixed(2)}MB`
                });
            }

            this.memories.set(groupId, data);
            this.initGroupCache(groupId);

            // 🆕 Post-load memory check
            currentMemory = this.calculateTotalL1Memory();
            while (currentMemory > this.maxL1MemoryBytes && this.groupCache.size > 1) {
                logger.warn(`[VectorMemory] Memory usage ${(currentMemory / 1024 / 1024).toFixed(2)}MB exceeds limit ${(this.maxL1MemoryBytes / 1024 / 1024).toFixed(2)}MB, evicting...`);
                await this.evictLRUGroup();
                currentMemory = this.calculateTotalL1Memory();
            }

            return data;
        } catch (e) {
            logger.error(`[VectorMemory] Failed to load memory for group ${groupId}:`, e);
            const empty = [];
            this.memories.set(groupId, empty);
            this.initGroupCache(groupId);
            return empty;
        }
    }

    // Calculate Cosine Similarity
    cosineSimilarity(vecA, vecB) {
        let dot = 0.0;
        let normA = 0.0;
        let normB = 0.0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    // Get Embedding from API
    async getEmbedding(text) {
        if (!config.aiEmbeddingApiKey) return null;
        
        try {
            const proxyConfig = getAxiosProxyConfig(config.aiEmbeddingProxy);
            const response = await axios.post(config.aiEmbeddingApiUrl, {
                input: text,
                model: config.aiEmbeddingModel
            }, {
                headers: {
                    'Authorization': `Bearer ${config.aiEmbeddingApiKey}`,
                    'Content-Type': 'application/json'
                },
                proxy: proxyConfig,
                timeout: 10000
            });

            if (response.data && response.data.data && response.data.data.length > 0) {
                return response.data.data[0].embedding;
            }
        } catch (error) {
            // Silently fail if embedding is not supported or configured wrong
            logger.error(`[VectorMemory] Failed to get embedding: ${error.message}`);
            if (error.response) {
                logger.error(`[VectorMemory] Response data: ${JSON.stringify(error.response.data)}`);
            }
        }
        return null;
    }

    // Calculate importance score for a memory
    // Factors: time decay (40%), access frequency (40%), content length (20%)
    calculateImportance(text, role, timestamp = Date.now(), accessCount = 1) {
        let score = 0;

        // 1. Time decay factor (0-40 points)
        // Recent messages are more important
        const ageInDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
        const timeFactor = Math.max(0, 40 - (ageInDays * 2)); // Decays to 0 after 20 days
        score += timeFactor;

        // 2. Access frequency (0-40 points)
        // Frequently accessed memories are more important
        const accessFactor = Math.min(40, accessCount * 8); // 5 accesses = 40 points (max)
        score += accessFactor;

        // 3. Content length (0-20 points)
        // Longer, more detailed content is more valuable
        const lengthFactor = Math.min(20, text.length / 15); // 300 characters = 20 points (max)
        score += lengthFactor;

        return score; // Total: 0-100
    }

    // Add a new memory (with deduplication)
    async addMemory(groupId, text, role, userId = null, userName = null) {
        // Only index user messages or assistant replies that are meaningful
        const shortThreshold = config.getGroupConfig(groupId, 'aiShortMessageThreshold');
        if (!text || text.length < shortThreshold) {
            logger.info(`[VectorMemory] Skipping short message: "${text}"`);
            return;
        }

        try {
            const embeddingText = (role === 'user' && userName) ? `${userName}: ${text}` : text
            logger.info(`[VectorMemory] Getting embedding for: "${embeddingText.substring(0, 20)}..."`);
            const vector = await this.getEmbedding(embeddingText);
            if (!vector) {
                logger.warn('[VectorMemory] Failed to generate vector, skipping save.');
                return;
            }

            const memory = await this.loadGroupMemory(groupId);

            // Check for duplicates (only check recent memories for performance)
            const duplicateThreshold = 0.95;
            const recentMemories = memory.slice(-50); // Check last 50 memories

            for (const existing of recentMemories) {
                const similarity = this.cosineSimilarity(vector, existing.vector);
                if (similarity > duplicateThreshold) {
                    logger.info(`[VectorMemory] Duplicate detected (similarity: ${similarity.toFixed(3)}), updating existing memory`);
                    // Update timestamp and increment access count
                    existing.timestamp = Date.now();
                    existing.accessCount = (existing.accessCount || 1) + 1;
                    // Recalculate importance
                    existing.importance = this.calculateImportance(
                        existing.text,
                        existing.role,
                        existing.timestamp,
                        existing.accessCount
                    );
                    this.saveGroupMemory(groupId);
                    return;
                }
            }

            // Not a duplicate - add new memory with metadata
            const importance = this.calculateImportance(text, role, Date.now(), 1)
            const entry = {
                text,
                role,
                vector,
                timestamp: Date.now(),
                accessCount: 1,
                importance,
            }
            if (userId != null) entry.userId = userId
            if (userName != null) entry.userName = userName
            memory.push(entry);

            logger.info(`[VectorMemory] Added new memory (importance: ${importance.toFixed(1)})`);

            // Keep max vectors based on memory limit to prevent in-memory bloat
            // Use batch delete for efficiency
            const memoryLimit = config.getGroupConfig(groupId, 'aiVectorMemoryLimit');
            if (memory.length > memoryLimit) {
                const toRemove = memory.length - memoryLimit;
                memory.splice(0, toRemove);
                logger.debug(`[VectorMemory] Memory limit (${memoryLimit}) reached, removed ${toRemove} oldest entries`);
            }

            this.saveGroupMemory(groupId);
        } catch (e) {
            logger.error('[VectorMemory] Error adding memory:', e);
        }
    }

    // Smart trim with importance-based retention
    async smartTrim(groupId, memory) {
        if (!config.getGroupConfig(groupId, 'aiEnableSmartTrim')) {
            // Fall back to simple trim if smart trim is disabled
            const maxSize = config.getGroupConfig(groupId, 'aiVectorMaxSize');
            const trimRatio = config.getGroupConfig(groupId, 'aiTrimRatio');
            storageUtils.checkSizeAndTrim(memory, maxSize, trimRatio);
            return;
        }

        const maxSize = config.getGroupConfig(groupId, 'aiVectorMaxSize');
        let currentSize = storageUtils.calculateBufferSize(memory);

        if (currentSize <= maxSize) return;

        logger.info(
            `[VectorMemory] Smart trimming ${(currentSize / 1024 / 1024).toFixed(1)}MB -> ` +
            `${(maxSize / 1024 / 1024).toFixed(1)}MB for group ${groupId}`
        );

        // Update importance scores for all memories
        memory.forEach(m => {
            if (!m.importance) {
                m.importance = this.calculateImportance(
                    m.text,
                    m.role,
                    m.timestamp || Date.now(),
                    m.accessCount || 1
                );
            }
        });

        // Bucket-based retention strategy
        const bucket1 = memory.filter(m => m.importance > 70);  // Keep all
        const bucket2 = memory.filter(m => m.importance >= 40 && m.importance <= 70); // Keep 70%
        const bucket3 = memory.filter(m => m.importance < 40);  // Keep 30%

        // Sort by timestamp (newer first) within each bucket for better quality retention
        bucket2.sort((a, b) => b.timestamp - a.timestamp);
        bucket3.sort((a, b) => b.timestamp - a.timestamp);

        // Calculate how many to keep from each bucket
        const keep2 = Math.ceil(bucket2.length * 0.7);
        const keep3 = Math.ceil(bucket3.length * 0.3);

        // Combine retained memories
        const trimmed = [
            ...bucket1,
            ...bucket2.slice(0, keep2),
            ...bucket3.slice(0, keep3)
        ].sort((a, b) => a.timestamp - b.timestamp); // Re-sort by timestamp for chronological order

        // Clear and repopulate the memory array
        memory.length = 0;
        memory.push(...trimmed);

        const newSize = storageUtils.calculateBufferSize(memory);
        logger.info(
            `[VectorMemory] Smart trim complete: ${memory.length} memories retained ` +
            `(${(newSize / 1024 / 1024).toFixed(1)}MB), ` +
            `bucket distribution: [${bucket1.length}/${bucket2.length}/${bucket3.length}] ` +
            `kept [${bucket1.length}/${keep2}/${keep3}]`
        );
    }

    // Save memories for a group (with debouncing and size check)
    saveGroupMemory(groupId) {
        if (!this.memories.has(groupId)) return;

        // Clear existing timer if any
        if (this.saveTimers.has(groupId)) {
            clearTimeout(this.saveTimers.get(groupId));
        }

        // Debounce: wait 3 seconds before actually saving
        const timer = setTimeout(async () => {
            try {
                if (!fs.existsSync(this.dataDir)) {
                    fs.mkdirSync(this.dataDir, { recursive: true });
                }

                const memory = this.memories.get(groupId);
                if (!memory) return;

                // Use smart trim instead of simple trim
                await this.smartTrim(groupId, memory);

                const filePath = path.join(this.dataDir, `${groupId}.json`);

                // Use atomic write with backup
                await storageUtils.asyncWriteWithBackup(filePath, memory);

                this.saveTimers.delete(groupId);
            } catch (e) {
                logger.error(`[VectorMemory] Failed to save memory for group ${groupId}:`, e);
            }
        }, 3000); // Wait 3s after last change before saving

        this.saveTimers.set(groupId, timer);
    }

    // Search for relevant memories (with L3 query caching)
    async search(groupId, queryText, limit, currentUserId = null) {
        try {
            // Use config value if limit not specified
            if (!limit) {
                limit = config.getGroupConfig(groupId, 'aiVectorSearchLimit');
            }

            // Build L3 cache key that includes userId to avoid cross-user cache collisions
            const cacheKey = `${queryText}:${currentUserId || ''}`

            // Check L3 query cache if enabled (with TTL)
            if (config.aiEnableVectorCache) {
                const cache = this.groupCache.get(groupId);
                if (cache && cache.queryCache.has(cacheKey)) {
                    const cached = cache.queryCache.get(cacheKey);
                    // 检查是否过期
                    if (cached.expires > Date.now()) {
                        logger.debug(`[VectorMemory] L3 cache hit for query: "${queryText.substring(0, 20)}..."`);
                        return cached.results;
                    } else {
                        // 过期则删除
                        cache.queryCache.delete(cacheKey);
                        logger.debug(`[VectorMemory] L3 cache expired for query: "${queryText.substring(0, 20)}..."`);
                    }
                }
            }

            const queryVector = await this.getEmbedding(queryText);
            if (!queryVector) return [];

            const memory = await this.loadGroupMemory(groupId);
            if (memory.length === 0) return [];

            const scored = memory.map(m => {
                const semanticScore = this.cosineSimilarity(queryVector, m.vector)
                const userBoost = (currentUserId && String(currentUserId) === String(m.userId)) ? 0.05 : 0
                const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
                const timeBoost = Math.max(0, 0.03 * (1 - ageHours / (24 * 30)))
                return {
                    text: m.text,
                    role: m.role,
                    timestamp: m.timestamp,
                    userId: m.userId,
                    userName: m.userName,
                    score: semanticScore + userBoost + timeBoost,
                    memoryRef: m // Keep reference to update access count
                }
            });

            // Filter by relevance threshold and sort descending
            const threshold = config.getGroupConfig(groupId, 'aiVectorSimilarityThreshold');
            const results = scored
                .filter(m => m.score > threshold && m.text !== queryText)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            // Update access counts for retrieved memories
            results.forEach(r => {
                if (r.memoryRef) {
                    r.memoryRef.accessCount = (r.memoryRef.accessCount || 0) + 1;
                }
            });

            // Async save if any memories were accessed
            if (results.length > 0) {
                this.saveGroupMemory(groupId);
            }

            // Prepare clean results (without memoryRef)
            const cleanResults = results.map(r => ({
                text: r.text,
                role: r.role,
                timestamp: r.timestamp,
                userId: r.userId,
                userName: r.userName,
                score: r.score
            }));

            // Cache results in L3 if enabled (with TTL)
            if (config.aiEnableVectorCache) {
                const cache = this.groupCache.get(groupId);
                if (cache) {
                    // Limit query cache size using LRU eviction
                    // Map maintains insertion order, so we can use it as LRU cache
                    if (cache.queryCache.size >= this.maxQueryCacheSize) {
                        // Delete the first (oldest) entry
                        const firstKey = cache.queryCache.keys().next().value;
                        cache.queryCache.delete(firstKey);
                    }
                    // 存储结果时添加过期时间戳
                    cache.queryCache.set(cacheKey, {
                        results: cleanResults,
                        expires: Date.now() + this.queryTTL
                    });
                    logger.debug(`[VectorMemory] Cached query result for: "${queryText.substring(0, 20)}..."`);
                }
            }

            return cleanResults;
        } catch (e) {
            logger.error('[VectorMemory] Error searching memory:', e);
            return [];
        }
    }

    // 计算 L1 缓存总内存占用（估算）
    calculateTotalL1Memory() {
        let total = 0;
        for (const [_, memory] of this.memories) {
            // 使用 storageUtils 计算内存占用
            total += storageUtils.calculateBufferSize(memory);
        }
        return total;
    }

    // 获取缓存统计信息（用于监控和调试）
    getCacheStats() {
        const l1Memory = this.calculateTotalL1Memory();
        return {
            l1CachedGroups: this.memories.size,
            l1MemoryMB: (l1Memory / 1024 / 1024).toFixed(2),
            l1MaxMemoryMB: (this.maxL1MemoryBytes / 1024 / 1024).toFixed(0),
            l2CachedGroups: this.groupCache.size,
            l2MaxGroups: this.maxCachedGroups,
            queryTTLMinutes: this.queryTTL / 1000 / 60,
            maxQueryCacheSize: this.maxQueryCacheSize,
            pendingSaves: this.saveTimers.size
        };
    }
}

module.exports = new VectorMemoryService();
