const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Storage Utilities Module
 * Provides common storage operations to eliminate code duplication
 * between aiHandler.js and vectorMemoryService.js
 */

/**
 * Calculate the size of data when serialized to JSON
 * @param {*} data - Data to calculate size for
 * @returns {number} Size in bytes
 */
function calculateBufferSize(data) {
    try {
        return Buffer.byteLength(JSON.stringify(data), 'utf8');
    } catch (error) {
        logger.error('[StorageUtils] Failed to calculate buffer size:', error);
        return 0;
    }
}

/**
 * Check data size and trim if necessary
 * @param {Array} data - Array of data to check and trim
 * @param {number} maxSize - Maximum size in bytes
 * @param {number} trimRatio - Ratio of items to remove (0-1), default 0.1 (10%)
 * @returns {boolean} True if data was trimmed
 */
function checkSizeAndTrim(data, maxSize, trimRatio = 0.1) {
    if (!Array.isArray(data)) {
        logger.warn('[StorageUtils] checkSizeAndTrim requires an array');
        return false;
    }

    const currentSize = calculateBufferSize(data);

    if (currentSize <= maxSize) {
        return false;
    }

    const itemsToRemove = Math.ceil(data.length * trimRatio);

    if (itemsToRemove === 0 || data.length === 0) {
        logger.warn('[StorageUtils] Cannot trim: insufficient items');
        return false;
    }

    logger.info(
        `[StorageUtils] Trimming data: ${(currentSize / 1024 / 1024).toFixed(2)}MB > ${(maxSize / 1024 / 1024).toFixed(2)}MB, ` +
        `removing ${itemsToRemove} items (${(trimRatio * 100).toFixed(0)}%)`
    );

    // Remove oldest items (from the beginning)
    data.splice(0, itemsToRemove);

    const newSize = calculateBufferSize(data);
    logger.info(
        `[StorageUtils] Trim complete: ${data.length} items remaining, ` +
        `size: ${(newSize / 1024 / 1024).toFixed(2)}MB`
    );

    return true;
}

/**
 * Atomic file write with backup protection
 * Uses tmp file → verification → rename pattern to prevent data loss
 *
 * @param {string} filePath - Target file path
 * @param {*} data - Data to write (will be JSON.stringify'd)
 * @param {boolean} createBackup - Whether to create a .bak backup, default true
 * @returns {Promise<boolean>} True if write succeeded
 */
async function asyncWriteWithBackup(filePath, data, createBackup = true) {
    const backupPath = `${filePath}.bak`;
    const tempPath = `${filePath}.tmp`;

    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }

        // Step 1: Create backup if file exists and backup is enabled
        if (createBackup && fs.existsSync(filePath)) {
            try {
                await fs.promises.copyFile(filePath, backupPath);
                logger.debug(`[StorageUtils] Backup created: ${backupPath}`);
            } catch (backupError) {
                logger.warn('[StorageUtils] Failed to create backup (non-fatal):', backupError.message);
            }
        }

        // Step 2: Write to temporary file
        const jsonString = JSON.stringify(data, null, 2);
        await fs.promises.writeFile(tempPath, jsonString, 'utf8');

        // Step 3: Validate the written data
        const verifyContent = await fs.promises.readFile(tempPath, 'utf8');
        const verifyData = JSON.parse(verifyContent);

        // Basic structure validation
        if (Array.isArray(data) && !Array.isArray(verifyData)) {
            throw new Error('Data validation failed: expected array');
        }
        if (typeof data === 'object' && data !== null && typeof verifyData !== 'object') {
            throw new Error('Data validation failed: expected object');
        }

        // Step 4: Atomic replace via rename
        await fs.promises.rename(tempPath, filePath);

        logger.debug(
            `[StorageUtils] Write successful: ${filePath} ` +
            `(${(Buffer.byteLength(jsonString, 'utf8') / 1024).toFixed(1)}KB)`
        );

        return true;

    } catch (error) {
        logger.error('[StorageUtils] Write failed:', error);

        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempPath)) {
                await fs.promises.unlink(tempPath);
            }
        } catch (cleanupError) {
            logger.warn('[StorageUtils] Failed to clean up temp file:', cleanupError.message);
        }

        // Attempt to restore from backup if write failed
        if (createBackup && fs.existsSync(backupPath) && !fs.existsSync(filePath)) {
            try {
                await fs.promises.copyFile(backupPath, filePath);
                logger.info('[StorageUtils] Restored from backup after write failure');
            } catch (restoreError) {
                logger.error('[StorageUtils] Failed to restore from backup:', restoreError);
            }
        }

        throw error;
    }
}

/**
 * Safely read and parse a JSON file
 * Returns default value if file doesn't exist or is invalid
 *
 * @param {string} filePath - Path to JSON file
 * @param {*} defaultValue - Default value to return on error, default []
 * @returns {Promise<*>} Parsed JSON data or default value
 */
async function safeReadJSON(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.debug(`[StorageUtils] File not found, using default: ${filePath}`);
            return defaultValue;
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        // Handle empty files
        if (!content || content.trim().length === 0) {
            logger.debug(`[StorageUtils] Empty file, using default: ${filePath}`);
            return defaultValue;
        }

        const data = JSON.parse(content);

        logger.debug(
            `[StorageUtils] Read successful: ${filePath} ` +
            `(${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)}KB)`
        );

        return data;

    } catch (error) {
        logger.error(`[StorageUtils] Failed to read JSON file: ${filePath}`, error);

        // Try to restore from backup if available
        const backupPath = `${filePath}.bak`;
        if (fs.existsSync(backupPath)) {
            try {
                logger.info('[StorageUtils] Attempting to restore from backup...');
                const backupContent = await fs.promises.readFile(backupPath, 'utf8');
                const backupData = JSON.parse(backupContent);

                // Restore the main file from backup
                await fs.promises.copyFile(backupPath, filePath);
                logger.info('[StorageUtils] Successfully restored from backup');

                return backupData;
            } catch (backupError) {
                logger.error('[StorageUtils] Failed to restore from backup:', backupError);
            }
        }

        return defaultValue;
    }
}

/**
 * Synchronously read and parse a JSON file (for compatibility with existing code)
 * @param {string} filePath - Path to JSON file
 * @param {*} defaultValue - Default value to return on error
 * @returns {*} Parsed JSON data or default value
 */
function safeReadJSONSync(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        if (!content || content.trim().length === 0) {
            return defaultValue;
        }

        return JSON.parse(content);

    } catch (error) {
        logger.error(`[StorageUtils] Failed to read JSON file: ${filePath}`, error);

        // Try backup
        const backupPath = `${filePath}.bak`;
        if (fs.existsSync(backupPath)) {
            try {
                const backupContent = fs.readFileSync(backupPath, 'utf8');
                return JSON.parse(backupContent);
            } catch (backupError) {
                logger.error('[StorageUtils] Failed to read backup:', backupError);
            }
        }

        return defaultValue;
    }
}

module.exports = {
    calculateBufferSize,
    checkSizeAndTrim,
    asyncWriteWithBackup,
    safeReadJSON,
    safeReadJSONSync
};
