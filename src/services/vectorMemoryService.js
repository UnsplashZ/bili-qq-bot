const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { getAxiosProxyConfig } = require('../utils/proxyUtils');

class VectorMemoryService {
    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'vectors');
        this.memories = new Map(); // groupId -> [{text, role, vector, timestamp}]
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

    // Load memories for a group (Lazy load)
    loadGroupMemory(groupId) {
        if (this.memories.has(groupId)) return this.memories.get(groupId);

        const filePath = path.join(this.dataDir, `${groupId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                if (!content || content.trim() === '') {
                     this.memories.set(groupId, []);
                     return [];
                }
                const data = JSON.parse(content);
                this.memories.set(groupId, data);
                return data;
            }
        } catch (e) {
            logger.error(`[VectorMemory] Failed to load memory for group ${groupId}:`, e);
        }
        
        const empty = [];
        this.memories.set(groupId, empty);
        return empty;
    }

    // Save memories for a group (Async)
    saveGroupMemory(groupId) {
        const memory = this.memories.get(groupId);
        if (!memory) return;

        const filePath = path.join(this.dataDir, `${groupId}.json`);
        // Use async write to avoid blocking event loop
        const data = JSON.stringify(memory);
        fs.writeFile(filePath, data, 'utf8', (err) => {
            if (err) logger.error(`[VectorMemory] Failed to save memory for group ${groupId}:`, err);
        });
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

    // Add a new memory
    async addMemory(groupId, text, role) {
        // Only index user messages or assistant replies that are meaningful
        if (!text || text.length < 5) {
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
            memory.push({
                text,
                role,
                vector,
                timestamp: Date.now()
            });

            // Keep max 500 vectors per group to prevent massive files (approx 3-5MB)
            if (memory.length > 500) {
                memory.shift();
            }

            this.saveGroupMemory(groupId);
        } catch (e) {
            logger.error('[VectorMemory] Error adding memory:', e);
        }
    }

    // Search for relevant memories
    async search(groupId, queryText, limit = 3) {
        try {
            const queryVector = await this.getEmbedding(queryText);
            if (!queryVector) return [];

            const memory = this.loadGroupMemory(groupId);
            if (memory.length === 0) return [];

            const scored = memory.map(m => ({
                text: m.text,
                role: m.role,
                timestamp: m.timestamp,
                score: this.cosineSimilarity(queryVector, m.vector)
            }));

            // Filter by relevance threshold (e.g., 0.4) and sort descending
            // Exclude exact matches (duplicates) to avoid redundancy if recent history overlaps
            return scored
                .filter(m => m.score > 0.4 && m.text !== queryText)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
        } catch (e) {
            logger.error('[VectorMemory] Error searching memory:', e);
            return [];
        }
    }
}

module.exports = new VectorMemoryService();
