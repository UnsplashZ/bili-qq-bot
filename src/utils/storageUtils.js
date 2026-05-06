const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function storeLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:storage', message, fields);
}

/**
 * Storage Utilities Module
 * Provides common storage operations for JSON-backed runtime data.
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
        storeLog('error', 'buffer-size-failed', {
            error: logger.getErrorMessage(error)
        });
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
        storeLog('warn', 'trim-skipped', {
            reason: 'invalid_array'
        });
        return false;
    }

    const currentSize = calculateBufferSize(data);

    if (currentSize <= maxSize) {
        return false;
    }

    const itemsToRemove = Math.ceil(data.length * trimRatio);

    if (itemsToRemove === 0 || data.length === 0) {
        storeLog('warn', 'trim-skipped', {
            reason: 'insufficient_items',
            itemCount: data.length,
            trimRatio
        });
        return false;
    }

    // Remove oldest items (from the beginning)
    data.splice(0, itemsToRemove);

    const newSize = calculateBufferSize(data);
    storeLog('info', 'trim-complete', {
        beforeBytes: currentSize,
        afterBytes: newSize,
        removedCount: itemsToRemove,
        remainingCount: data.length,
        trimRatio
    });

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
            } catch (backupError) {
                storeLog('warn', 'backup-create-failed', {
                    filePath,
                    backupPath,
                    error: logger.getErrorMessage(backupError)
                });
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

        return true;

    } catch (error) {
        storeLog('error', 'write-failed', {
            filePath,
            error: logger.getErrorMessage(error)
        });

        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempPath)) {
                await fs.promises.unlink(tempPath);
            }
        } catch (cleanupError) {
            storeLog('warn', 'temp-cleanup-failed', {
                filePath: tempPath,
                error: logger.getErrorMessage(cleanupError)
            });
        }

        // Attempt to restore from backup if write failed
        if (createBackup && fs.existsSync(backupPath) && !fs.existsSync(filePath)) {
            try {
                await fs.promises.copyFile(backupPath, filePath);
                storeLog('info', 'backup-restored', {
                    filePath,
                    backupPath
                });
            } catch (restoreError) {
                storeLog('error', 'backup-restore-failed', {
                    filePath,
                    backupPath,
                    error: logger.getErrorMessage(restoreError)
                });
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
            return defaultValue;
        }

        const content = await fs.promises.readFile(filePath, 'utf8');

        // Handle empty files
        if (!content || content.trim().length === 0) {
            return defaultValue;
        }

        const data = JSON.parse(content);

        return data;

    } catch (error) {
        storeLog('error', 'read-failed', {
            filePath,
            error: logger.getErrorMessage(error)
        });

        // Try to restore from backup if available
        const backupPath = `${filePath}.bak`;
        if (fs.existsSync(backupPath)) {
            try {
                const backupContent = await fs.promises.readFile(backupPath, 'utf8');
                const backupData = JSON.parse(backupContent);

                // Restore the main file from backup
                await fs.promises.copyFile(backupPath, filePath);
                storeLog('info', 'backup-restored', {
                    filePath,
                    backupPath
                });

                return backupData;
            } catch (backupError) {
                storeLog('error', 'backup-restore-failed', {
                    filePath,
                    backupPath,
                    error: logger.getErrorMessage(backupError)
                });
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
        storeLog('error', 'read-sync-failed', {
            filePath,
            error: logger.getErrorMessage(error)
        });

        // Try backup
        const backupPath = `${filePath}.bak`;
        if (fs.existsSync(backupPath)) {
            try {
                const backupContent = fs.readFileSync(backupPath, 'utf8');
                return JSON.parse(backupContent);
            } catch (backupError) {
                storeLog('error', 'backup-read-failed', {
                    filePath,
                    backupPath,
                    error: logger.getErrorMessage(backupError)
                });
            }
        }

        return defaultValue;
    }
}

/**
 * Synchronous atomic file write with backup protection
 * Uses tmp file → verification → rename pattern to prevent data loss
 * 
 * @param {string} filePath - Target file path
 * @param {*} data - Data to write (will be JSON.stringify'd)
 * @param {boolean} createBackup - Whether to create a .bak backup, default true
 * @returns {boolean} True if write succeeded
 */
function writeWithBackup(filePath, data, createBackup = true) {
    const backupPath = `${filePath}.bak`;
    const tempPath = `${filePath}.tmp`;

    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Step 1: Create backup if file exists and backup is enabled
        if (createBackup && fs.existsSync(filePath)) {
            try {
                fs.copyFileSync(filePath, backupPath);
            } catch (backupError) {
                storeLog('warn', 'backup-create-failed', {
                    filePath,
                    backupPath,
                    error: logger.getErrorMessage(backupError)
                });
            }
        }

        // Step 2: Write to temporary file
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(tempPath, jsonString, 'utf8');

        // Step 3: Validate the written data (Basic read-back)
        const verifyContent = fs.readFileSync(tempPath, 'utf8');
        JSON.parse(verifyContent); // Just ensure it parses

        // Step 4: Atomic replace via rename
        fs.renameSync(tempPath, filePath);

        return true;

    } catch (error) {
        storeLog('error', 'write-sync-failed', {
            filePath,
            error: logger.getErrorMessage(error)
        });

        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch (cleanupError) {
            storeLog('warn', 'temp-cleanup-failed', {
                filePath: tempPath,
                error: logger.getErrorMessage(cleanupError)
            });
        }
        throw error;
    }
}

module.exports = {
    calculateBufferSize,
    checkSizeAndTrim,
    asyncWriteWithBackup,
    writeWithBackup,
    safeReadJSON,
    safeReadJSONSync
};
