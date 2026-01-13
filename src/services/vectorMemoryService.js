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

        // L2 Cache: Group-level LRU cache (max 3 active groups)
        this.groupCache = new Map(); // groupId -> {lastAccess: timestamp, queryCache: Map}
        this.maxCachedGroups = 3;

        // Debounced save timers
        this.saveTimers = new Map(); // groupId -> timer

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
                queryCache: new Map() // query text -> results
            };
            this.groupCache.set(groupId, cache);

            // Evict LRU group if cache is full
            if (this.groupCache.size > this.maxCachedGroups) {
                this.evictLRUGroup();
            }
        } else {
            cache.lastAccess = Date.now();
        }
    }

    // Evict least recently used group from L2 cache
    evictLRUGroup() {
        let oldestGroupId = null;
        let oldestTime = Infinity;

        for (const [groupId, cache] of this.groupCache.entries()) {
            if (cache.lastAccess < oldestTime) {
                oldestTime = cache.lastAccess;
                oldestGroupId = groupId;
            }
        }

        if (oldestGroupId) {
            this.groupCache.delete(oldestGroupId);
            logger.debug(`[VectorMemory] Evicted group ${oldestGroupId} from L2 cache`);
        }
    }

    // Initialize group cache (called when loading memory)
    initGroupCache(groupId) {
        if (!config.aiEnableVectorCache) return;

        this.updateCacheAccess(groupId);
    }

    // Load memories for a group (Lazy load)
    loadGroupMemory(groupId) {
        if (this.memories.has(groupId)) {
            this.updateCacheAccess(groupId);
            return this.memories.get(groupId);
        }

        const filePath = path.join(this.dataDir, `${groupId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                // Check file size and log if large
                const stats = fs.statSync(filePath);
                if (stats.size > 1024 * 1024) { // > 1MB
                    logger.info(`[VectorMemory] Loading large file (${(stats.size / 1024 / 1024).toFixed(1)}MB) for group ${groupId}`);
                }

                const startTime = Date.now();
                const content = fs.readFileSync(filePath, 'utf8');

                if (!content || content.trim() === '') {
                    this.memories.set(groupId, []);
                    this.initGroupCache(groupId);
                    return [];
                }

                const data = JSON.parse(content);
                const loadTime = Date.now() - startTime;

                if (loadTime > 100) {
                    logger.info(`[VectorMemory] Loaded ${data.length} memories in ${loadTime}ms for group ${groupId}`);
                }

                this.memories.set(groupId, data);
                this.initGroupCache(groupId);
                return data;
            }
        } catch (e) {
            logger.error(`[VectorMemory] Failed to load memory for group ${groupId}:`, e);
        }

        const empty = [];
        this.memories.set(groupId, empty);
        this.initGroupCache(groupId);
        return empty;
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
    async addMemory(groupId, text, role) {
        // Only index user messages or assistant replies that are meaningful
        const shortThreshold = config.getGroupConfig(groupId, 'aiShortMessageThreshold');
        if (!text || text.length < shortThreshold) {
            logger.info(`[VectorMemory] Skipping short message: "${text}"`);
            return;
        }

        try {
            logger.info(`[VectorMemory] Getting embedding for: "${text.substring(0, 20)}..."`);
            const vector = await this.getEmbedding(text);
            if (!vector) {
                logger.warn('[VectorMemory] Failed to generate vector, skipping save.');
                return;
            }

            const memory = this.loadGroupMemory(groupId);

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
            memory.push({
                text,
                role,
                vector,
                timestamp: Date.now(),
                accessCount: 1,
                importance: this.calculateImportance(text, role, Date.now(), 1)
            });

            logger.info(`[VectorMemory] Added new memory (importance: ${this.calculateImportance(text, role).toFixed(1)})`);

            // Keep max vectors based on file size limit (default 200MB)
            // We check size during saveGroupMemory, but here we can prevent in-memory bloat
            if (memory.length > 10000) {
                memory.shift();
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
    async search(groupId, queryText, limit) {
        try {
            // Use config value if limit not specified
            if (!limit) {
                limit = config.getGroupConfig(groupId, 'aiVectorSearchLimit');
            }

            // Check L3 query cache if enabled
            if (config.aiEnableVectorCache) {
                const cache = this.groupCache.get(groupId);
                if (cache && cache.queryCache.has(queryText)) {
                    logger.debug(`[VectorMemory] L3 cache hit for query: "${queryText.substring(0, 20)}..."`);
                    return cache.queryCache.get(queryText);
                }
            }

            const queryVector = await this.getEmbedding(queryText);
            if (!queryVector) return [];

            const memory = this.loadGroupMemory(groupId);
            if (memory.length === 0) return [];

            const scored = memory.map(m => ({
                text: m.text,
                role: m.role,
                timestamp: m.timestamp,
                score: this.cosineSimilarity(queryVector, m.vector),
                memoryRef: m // Keep reference to update access count
            }));

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
                score: r.score
            }));

            // Cache results in L3 if enabled
            if (config.aiEnableVectorCache) {
                const cache = this.groupCache.get(groupId);
                if (cache) {
                    // Limit query cache to 20 entries per group
                    if (cache.queryCache.size >= 20) {
                        const firstKey = cache.queryCache.keys().next().value;
                        cache.queryCache.delete(firstKey);
                    }
                    cache.queryCache.set(queryText, cleanResults);
                    logger.debug(`[VectorMemory] Cached query result for: "${queryText.substring(0, 20)}..."`);
                }
            }

            return cleanResults;
        } catch (e) {
            logger.error('[VectorMemory] Error searching memory:', e);
            return [];
        }
    }
}

module.exports = new VectorMemoryService();
