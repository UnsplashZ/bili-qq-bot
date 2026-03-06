const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const storageUtils = require('../utils/storageUtils');
const { getAxiosProxyConfig } = require('../utils/proxyUtils');

// 向量搜索评分加权常量
const SEARCH_USER_BOOST = 0.05        // 当前用户消息的相关性加成
const SEARCH_TIME_BOOST_MAX = 0.03    // 时间新鲜度最大加成
const SEARCH_TIME_DECAY_DAYS = 30     // 时间衰减窗口（天）

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

        // Embedding write queue (protect external embedding API from request storms)
        const concurrency = parseInt(process.env.AI_EMBEDDING_CONCURRENCY || '2', 10);
        const queueSize = parseInt(process.env.AI_EMBEDDING_QUEUE_SIZE || '200', 10);
        this.maxEmbeddingConcurrency = Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2;
        this.maxEmbeddingQueueSize = Number.isFinite(queueSize) && queueSize > 0 ? queueSize : 200;
        this.embeddingQueue = [];
        this.activeEmbeddingJobs = 0;

        logger.info('[VectorMemory] Service initialized', {
            maxL1Memory: `${(this.maxL1MemoryBytes / 1024 / 1024).toFixed(0)}MB`,
            maxCachedGroups: this.maxCachedGroups,
            maxQueryCacheSize: this.maxQueryCacheSize,
            maxSingleGroup: `${(this.maxSingleGroupSize / 1024 / 1024).toFixed(0)}MB`,
            embeddingConcurrency: this.maxEmbeddingConcurrency,
            embeddingQueueSize: this.maxEmbeddingQueueSize
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

    _isLowPriorityMemory(role, text, shortThreshold) {
        if (role !== 'user') return false;
        const len = String(text || '').length;
        return len < shortThreshold * 2;
    }

    _drainEmbeddingQueue() {
        while (this.activeEmbeddingJobs < this.maxEmbeddingConcurrency && this.embeddingQueue.length > 0) {
            const job = this.embeddingQueue.shift();
            this.activeEmbeddingJobs += 1;

            Promise.resolve()
                .then(job.run)
                .then(result => job.resolve({ dropped: false, result }))
                .catch(error => job.reject(error))
                .finally(() => {
                    this.activeEmbeddingJobs -= 1;
                    this._drainEmbeddingQueue();
                });
        }
    }

    _enqueueEmbeddingJob(run, lowPriority, meta = {}) {
        if (this.embeddingQueue.length >= this.maxEmbeddingQueueSize) {
            if (lowPriority) {
                logger.debug(`[VectorMemory] Dropping low-priority embedding task (queue full): group=${meta.groupId}, role=${meta.role}`);
                return Promise.resolve({ dropped: true });
            }

            const removableIndex = this.embeddingQueue.findIndex(job => job.lowPriority);
            if (removableIndex >= 0) {
                const [removed] = this.embeddingQueue.splice(removableIndex, 1);
                removed.resolve({ dropped: true, reason: 'evicted_low_priority' });
                logger.warn(`[VectorMemory] Queue full, evicted a low-priority embedding task for group=${meta.groupId}`);
            } else {
                logger.warn(`[VectorMemory] Queue full, dropping high-priority task for group=${meta.groupId}`);
                return Promise.resolve({ dropped: true, reason: 'queue_full' });
            }
        }

        return new Promise((resolve, reject) => {
            this.embeddingQueue.push({ run, resolve, reject, lowPriority });
            this._drainEmbeddingQueue();
        });
    }

    // Get Embedding from API
    async getEmbedding(text) {
        if (!config.aiEmbeddingApiKey) return null;

        const retryMax = parseInt(process.env.AI_EMBEDDING_RETRY_MAX || '2', 10);
        const retryDelayBaseMs = parseInt(process.env.AI_EMBEDDING_RETRY_DELAY_MS || '300', 10);
        const maxRetries = Number.isFinite(retryMax) && retryMax >= 0 ? retryMax : 2;
        const baseDelayMs = Number.isFinite(retryDelayBaseMs) && retryDelayBaseMs > 0 ? retryDelayBaseMs : 300;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
                return null;
            } catch (error) {
                const status = error && error.response ? error.response.status : null;
                const retryable = status === 429 || (status >= 500 && status < 600);
                const canRetry = retryable && attempt < maxRetries;

                if (canRetry) {
                    const delayMs = baseDelayMs * (2 ** attempt);
                    logger.warn(`[VectorMemory] Embedding request retry (${attempt + 1}/${maxRetries}) after ${delayMs}ms, status=${status}`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                logger.error(`[VectorMemory] Failed to get embedding: ${error.message}`);
                if (error.response) {
                    logger.error(`[VectorMemory] Response data: ${JSON.stringify(error.response.data)}`);
                }
                return null;
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

        const lowPriority = this._isLowPriorityMemory(role, text, shortThreshold);

        try {
            const queued = await this._enqueueEmbeddingJob(
                async () => this._addMemoryCore(groupId, text, role, userId, userName),
                lowPriority,
                { groupId, role }
            );

            if (queued && queued.dropped) {
                logger.debug(`[VectorMemory] Memory write dropped for group ${groupId}`);
            }
        } catch (e) {
            logger.error('[VectorMemory] Error adding memory:', e);
        }
    }

    async _addMemoryCore(groupId, text, role, userId = null, userName = null) {
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
            if (userId != null) entry.userId = String(userId)
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
    async search(groupId, queryText, limit, currentUserId = null, options = {}) {
        try {
            // Use config value if limit not specified
            if (!limit) {
                limit = config.getGroupConfig(groupId, 'aiVectorSearchLimit');
            }

            const strictUserId = options.strictUserId != null ? String(options.strictUserId) : null;
            const crossUserPenalty = typeof options.crossUserPenalty === 'number' ? options.crossUserPenalty : 0;
            const includeRoles = Array.isArray(options.includeRoles) && options.includeRoles.length > 0
                ? new Set(options.includeRoles.map(r => String(r)))
                : null;
            const excludeRoles = Array.isArray(options.excludeRoles) && options.excludeRoles.length > 0
                ? new Set(options.excludeRoles.map(r => String(r)))
                : null;

            // Build L3 cache key that includes userId to avoid cross-user cache collisions
            const cacheKey = [
                queryText,
                limit,
                currentUserId || '',
                strictUserId || '',
                crossUserPenalty,
                includeRoles ? Array.from(includeRoles).join(',') : '',
                excludeRoles ? Array.from(excludeRoles).join(',') : ''
            ].join(':');

            // Check L3 query cache if enabled (with TTL)
            if (config.aiEnableVectorCache) {
                const cache = this.groupCache.get(groupId);
                if (cache && cache.queryCache.has(cacheKey)) {
                    const cached = cache.queryCache.get(cacheKey);
                    // 检查是否过期
                    if (cached.expires > Date.now()) {
                        logger.debug(`[VectorMemory] L3 cache hit for query: "${queryText.substring(0, 20)}..."`);
                        return cached.results.slice(0, limit);
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
                if (strictUserId && String(m.userId || '') !== strictUserId) {
                    return null;
                }
                if (includeRoles && !includeRoles.has(String(m.role || ''))) {
                    return null;
                }
                if (excludeRoles && excludeRoles.has(String(m.role || ''))) {
                    return null;
                }

                const semanticScore = this.cosineSimilarity(queryVector, m.vector)
                const userBoost = (currentUserId && String(currentUserId) === String(m.userId)) ? SEARCH_USER_BOOST : 0
                const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
                const timeBoost = Math.max(0, SEARCH_TIME_BOOST_MAX * (1 - ageHours / (24 * SEARCH_TIME_DECAY_DAYS)))
                const crossUserPenaltyScore = (currentUserId && m.userId && String(currentUserId) !== String(m.userId))
                    ? crossUserPenalty
                    : 0
                return {
                    text: m.text,
                    role: m.role,
                    timestamp: m.timestamp,
                    userId: m.userId,
                    userName: m.userName,
                    score: semanticScore + userBoost + timeBoost - crossUserPenaltyScore,
                    memoryRef: m // Keep reference to update access count
                }
            });

            // Filter by relevance threshold and sort descending
            const threshold = config.getGroupConfig(groupId, 'aiVectorSimilarityThreshold');
            const results = scored
                .filter(Boolean)
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

    /**
     * 按用户 ID 过滤记忆（供画像生成使用）
     * 只能过滤存储了 userId 字段的记忆（Task 1 之后存储的新记录）
     * 旧记忆无 userId 字段，自动被过滤掉
     */
    async getMemoriesByUser(groupId, userId, limit = 100) {
        const memory = await this.loadGroupMemory(groupId)
        return memory
            .filter(m => m.userId && String(m.userId) === String(userId))
            .slice(-limit)
            .map(m => ({ text: m.text, role: m.role, timestamp: m.timestamp }))
    }
}

module.exports = new VectorMemoryService();
