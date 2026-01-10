const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class CacheManager {
    constructor() {
        this.cacheDir = path.resolve(process.cwd(), 'data', 'cache');
        this.maxSize = 1024 * 1024 * 1024; // 1GB
        this.initPromise = this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            logger.error('Failed to create cache directory:', error);
        }
    }

    /**
     * Get data from cache
     * @param {string} key - Cache key
     * @returns {Promise<object|null>} - Cached data or null
     */
    async get(key) {
        await this.initPromise;
        try {
            const filePath = path.join(this.cacheDir, `${key}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            // Update mtime to indicate recent access (LRU-like behavior)
            const now = new Date();
            // Use utimes to update access and modification time
            // We ignore errors here as it's not critical
            fs.utimes(filePath, now, now).catch(() => {});
            return JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error reading cache for ${key}:`, error);
            }
            return null;
        }
    }

    /**
     * Save data to cache
     * @param {string} key - Cache key
     * @param {object} data - Data to cache
     */
    async set(key, data) {
        await this.initPromise;
        try {
            const filePath = path.join(this.cacheDir, `${key}.json`);
            await fs.writeFile(filePath, JSON.stringify(data));
            // Trigger cleanup asynchronously
            this.checkSizeAndCleanup().catch(err => logger.error('Cache cleanup failed:', err));
        } catch (error) {
            logger.error(`Error writing cache for ${key}:`, error);
        }
    }

    /**
     * Check cache size and remove oldest files if limit exceeded
     */
    async checkSizeAndCleanup() {
        try {
            const files = await fs.readdir(this.cacheDir);
            let totalSize = 0;
            const fileStats = [];

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const filePath = path.join(this.cacheDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                    fileStats.push({ path: filePath, mtime: stats.mtime, size: stats.size });
                } catch (e) {
                    // File might be deleted or inaccessible
                }
            }

            if (totalSize > this.maxSize) {
                // Sort by mtime ascending (oldest first)
                fileStats.sort((a, b) => a.mtime - b.mtime);

                let currentSize = totalSize;
                let deletedCount = 0;
                
                for (const file of fileStats) {
                    if (currentSize <= this.maxSize) break;
                    
                    try {
                        await fs.unlink(file.path);
                        currentSize -= file.size;
                        deletedCount++;
                    } catch (e) {
                        logger.error(`Failed to delete cache file ${file.path}:`, e);
                    }
                }
                
                if (deletedCount > 0) {
                    logger.info(`Cache limit exceeded. Cleaned up ${deletedCount} files.`);
                }
            }
        } catch (error) {
            logger.error('Error during cache cleanup:', error);
        }
    }
}

module.exports = new CacheManager();
