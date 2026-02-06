const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');
const logger = require('../../utils/logger');
const sysConfig = require('../../config');
const authenticateToken = require('../middleware/auth');
const subscriptionService = require('../../services/subscriptionService');
const biliApi = require('../../services/biliApi');
const mcpManager = require('../../services/mcpManager');

const CONFIG_PATH = path.resolve(__dirname, '../../../config/config.json');
const MCP_CONFIG_PATH = path.resolve(__dirname, '../../../config/mcp_servers.json');

// Helper: Convert groupId from request params to string
function normalizeGroupId(groupId) {
    return groupId ? String(groupId) : null;
}

// 🆕 P2-1: 登录速率限制器（内存实现）
const loginAttempts = new Map(); // IP -> { count, lockUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(ip) {
    const now = Date.now();
    const attempt = loginAttempts.get(ip);

    // 清理过期记录
    if (attempt && attempt.lockUntil && now > attempt.lockUntil) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    // 检查是否被锁定
    if (attempt && attempt.lockUntil && now < attempt.lockUntil) {
        const remainingMs = attempt.lockUntil - now;
        return {
            allowed: false,
            remainingSeconds: Math.ceil(remainingMs / 1000)
        };
    }

    return { allowed: true };
}

function recordFailedAttempt(ip) {
    const now = Date.now();
    const attempt = loginAttempts.get(ip) || { count: 0, lockUntil: null };

    attempt.count++;

    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
        attempt.lockUntil = now + LOCKOUT_DURATION;
        logger.warn(`[Security] IP ${ip} locked out after ${MAX_LOGIN_ATTEMPTS} failed attempts`);
    }

    loginAttempts.set(ip, attempt);
}

function resetAttempts(ip) {
    loginAttempts.delete(ip);
}

// 定期清理过期记录（每10分钟）
setInterval(() => {
    const now = Date.now();
    for (const [ip, attempt] of loginAttempts.entries()) {
        if (attempt.lockUntil && now > attempt.lockUntil) {
            loginAttempts.delete(ip);
        }
    }
}, 10 * 60 * 1000);

// --- Public Routes ---

// POST /api/login - Dashboard Login
router.post('/login', (req, res) => {
    const { password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    // 🆕 检查速率限制
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
        logger.warn(`[Security] Login attempt from locked IP ${ip} (${rateLimit.remainingSeconds}s remaining)`);
        return res.status(429).json({
            error: 'Too many failed attempts',
            retryAfter: rateLimit.remainingSeconds
        });
    }

    // Compare with configured dashboard password
    if (password === sysConfig.dashboardPassword) {
        // 🆕 成功登录，重置失败计数
        resetAttempts(ip);

        // Generate JWT token
        const token = jwt.sign(
            { role: 'admin', timestamp: Date.now() },
            sysConfig.jwtSecret,
            { expiresIn: '24h' }
        );

        logger.info(`[Security] Successful login from ${ip}`);
        res.json({ token });
    } else {
        // 🆕 记录失败尝试
        recordFailedAttempt(ip);

        const attempt = loginAttempts.get(ip);
        const remainingAttempts = MAX_LOGIN_ATTEMPTS - (attempt?.count || 0);

        logger.warn(`[Security] Failed login attempt from ${ip} (${remainingAttempts} attempts remaining)`);
        res.status(401).json({
            error: 'Invalid password',
            remainingAttempts: Math.max(0, remainingAttempts)
        });
    }
});

// --- Authentication Middleware ---
// All routes defined below this line require a valid JWT token
router.use(authenticateToken);

// --- Protected Routes ---

// Helper to read config
async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error reading config file:', error);
        throw error;
    }
}

// Helper to write config
async function writeConfig(config) {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        logger.error('Error writing config file:', error);
        throw error;
    }
}

// Helper to read MCP config
async function readMcpConfig() {
    try {
        const data = await fs.readFile(MCP_CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        logger.error('Error reading MCP config file:', error);
        throw error;
    }
}

// Helper to write MCP config
async function writeMcpConfig(config) {
    try {
        await fs.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        logger.error('Error writing MCP config file:', error);
        throw error;
    }
}

// GET /api/config - Read config
router.get('/config', async (req, res) => {
    try {
        const config = await readConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read configuration' });
    }
});

// Allowed fields for global config update via WebUI
const ALLOWED_GLOBAL_CONFIG_KEYS = [
    'subscriptionCheckInterval',
    'linkCacheTimeout',
    'aiEnabled',
    'aiRagEnabled',
];

// POST /api/config - Update global config
router.post('/config', async (req, res) => {
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // Only accept whitelisted fields
        const filtered = {};
        for (const key of Object.keys(newConfig)) {
            if (ALLOWED_GLOBAL_CONFIG_KEYS.includes(key)) {
                filtered[key] = newConfig[key];
            }
        }
        if (Object.keys(filtered).length === 0) {
            return res.status(400).json({ error: 'No valid configuration keys provided' });
        }

        Object.assign(sysConfig, filtered);
        sysConfig.save();

        // Real-time update for subscriptionCheckInterval
        if (filtered.subscriptionCheckInterval !== undefined) {
            const interval = parseInt(filtered.subscriptionCheckInterval, 10);
            if (!isNaN(interval) && interval > 0) {
                subscriptionService.updateCheckInterval(interval);
                logger.info(`[API] Subscription check interval updated to ${interval}s`);
            }
        }

        res.json({ message: 'Configuration updated successfully', config: filtered });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// GET /api/groups - List all groups (including disabled and left ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot;
        const groupConfigs = sysConfig.groupConfigs || {};
        const enabledGroups = new Set(sysConfig.enabledGroups || []);

        // Collect all group IDs (currently in groups + have configs)
        const allGroupIds = new Set();

        // 1. Add groups bot is currently in
        if (bot && bot.groupList) {
            bot.groupList.forEach((info, groupId) => {
                allGroupIds.add(groupId);
            });
        }

        // 2. Add groups with configs (may have left)
        Object.keys(groupConfigs).forEach(groupId => {
            allGroupIds.add(groupId);
        });

        // 3. Add groups that are enabled (but might not have config or be in bot list)
        if (sysConfig.enabledGroups) {
            sysConfig.enabledGroups.forEach(groupId => {
                allGroupIds.add(groupId);
            });
        }

        // 4. Build response data
        const groupsData = Array.from(allGroupIds).map(groupId => {
            const groupIdStr = String(groupId);
            const groupIdNum = Number(groupIdStr);
            const groupInfo = bot?.groupList?.get(groupId) || bot?.groupList?.get(groupIdNum);
            const groupConfig = groupConfigs[groupIdStr] || {};
            
            // Determine if bot is in group
            let isInGroup = true;
            if (bot && bot.groupList) {
                isInGroup = bot.groupList.has(groupId) || bot.groupList.has(groupIdNum);
            } else {
                // Fallback if bot status unknown
                isInGroup = groupConfig.isInGroup !== false;
            }

            return {
                id: groupIdStr,
                name: groupInfo?.group_name || `群组 ${groupIdStr}`,
                isEnabled: enabledGroups.has(groupIdStr),
                isInGroup: isInGroup,
                config: groupConfig
            };
        });

        res.json(groupsData);
    } catch (error) {
        logger.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// POST /api/groups/:id/toggle - Toggle group enabled status
router.post('/groups/:id/toggle', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        const groupIdStr = String(groupId);
        const groupIdNum = Number(groupIdStr);

        // 验证群组是否存在
        if (!global.bot || !global.bot.groupList || (!global.bot.groupList.has(groupIdStr) && !global.bot.groupList.has(groupIdNum))) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!sysConfig.enabledGroups) {
            sysConfig.enabledGroups = [];
        }

        const index = sysConfig.enabledGroups.indexOf(groupIdStr);
        let isEnabled;

        if (index === -1) {
            sysConfig.enabledGroups.push(groupIdStr);
            isEnabled = true;
        } else {
            sysConfig.enabledGroups.splice(index, 1);
            isEnabled = false;
        }

        sysConfig.save();
        res.json({ message: `Group ${groupId} toggled`, isEnabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle group status' });
    }
});

// POST /api/groups/:id/config - Update specific group config
router.post('/groups/:id/config', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        const groupIdStr = String(groupId);
        const groupIdNum = Number(groupIdStr);
        const updates = req.body;

        // 验证群组是否存在
        if (!global.bot || !global.bot.groupList || (!global.bot.groupList.has(groupIdStr) && !global.bot.groupList.has(groupIdNum))) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // 验证AI配置覆盖（如果提供）
        if (updates.hasOwnProperty('aiProbability') && updates.aiProbability !== null) {
            const prob = parseFloat(updates.aiProbability);
            if (isNaN(prob) || prob < 0 || prob > 1) {
                return res.status(400).json({ error: 'aiProbability must be between 0 and 1' });
            }
            updates.aiProbability = prob;
        }

        if (updates.hasOwnProperty('aiContextLimit') && updates.aiContextLimit !== null) {
            const limit = parseInt(updates.aiContextLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res.status(400).json({ error: 'aiContextLimit must be between 1 and 100' });
            }
            updates.aiContextLimit = limit;
        }

        if (updates.hasOwnProperty('aiTemperature') && updates.aiTemperature !== null) {
            const temp = parseFloat(updates.aiTemperature);
            if (isNaN(temp) || temp < 0 || temp > 2) {
                return res.status(400).json({ error: 'aiTemperature must be between 0 and 2' });
            }
            updates.aiTemperature = temp;
        }

        // 验证 nightMode 配置（如果提供）
        if (updates.hasOwnProperty('nightMode')) {
            const nightMode = updates.nightMode;

            if (!nightMode || typeof nightMode !== 'object') {
                return res.status(400).json({ error: 'nightMode must be an object' });
            }

            // 校验 mode
            if (!['on', 'off', 'timed'].includes(nightMode.mode)) {
                return res.status(400).json({ error: 'nightMode.mode must be "on", "off", or "timed"' });
            }

            // 当 mode 为 timed 时，校验时间格式
            if (nightMode.mode === 'timed') {
                const timeRegex = /^\d{1,2}:\d{2}$/;

                if (!timeRegex.test(nightMode.startTime) || !timeRegex.test(nightMode.endTime)) {
                    return res.status(400).json({ error: 'Time format must be HH:mm' });
                }

                // 解析并校验时间范围
                const [startH, startM] = nightMode.startTime.split(':').map(Number);
                const [endH, endM] = nightMode.endTime.split(':').map(Number);

                if (startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
                    endH < 0 || endH > 23 || endM < 0 || endM > 59) {
                    return res.status(400).json({ error: 'Time values out of range (00:00-23:59)' });
                }
            }
        }

        if (!sysConfig.groupConfigs) {
            sysConfig.groupConfigs = {};
        }

        // 清理null值（表示使用全局默认）- 在合并前处理
        const cleanedUpdates = { ...updates };
        if (updates.hasOwnProperty('aiProbability') && updates.aiProbability === null) {
            delete cleanedUpdates.aiProbability;
            // 从现有配置中删除
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiProbability;
            }
        }
        if (updates.hasOwnProperty('aiContextLimit') && updates.aiContextLimit === null) {
            delete cleanedUpdates.aiContextLimit;
            // 从现有配置中删除
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiContextLimit;
            }
        }
        if (updates.hasOwnProperty('aiTemperature') && updates.aiTemperature === null) {
            delete cleanedUpdates.aiTemperature;
            // 从现有配置中删除
            if (sysConfig.groupConfigs[groupIdStr]) {
                delete sysConfig.groupConfigs[groupIdStr].aiTemperature;
            }
        }

        // 合并更新（已清理null值）
        sysConfig.groupConfigs[groupIdStr] = {
            ...(sysConfig.groupConfigs[groupIdStr] || {}),
            ...cleanedUpdates
        };

        sysConfig.save();

        res.json({
            message: `Group ${groupId} configuration updated`,
            config: sysConfig.groupConfigs[groupIdStr]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update group configuration' });
    }
});

// DELETE /api/groups/:id - Delete config for a left group
router.delete('/groups/:id', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        const groupIdStr = String(groupId);
        const groupIdNum = Number(groupIdStr);
        const groupConfig = sysConfig.groupConfigs?.[groupIdStr];

        // Check if bot is still in the group
        const bot = global.bot;
        let isInBotGroup = true;
        if (bot && bot.groupList) {
            isInBotGroup = bot.groupList.has(groupIdStr) || bot.groupList.has(groupIdNum);
        } else if (groupConfig) {
            isInBotGroup = groupConfig.isInGroup !== false;
        }

        if (isInBotGroup) {
            return res.status(400).json({
                error: 'Can only delete configs for groups that bot has left'
            });
        }

        let modified = false;

        // 1. Delete group config if exists
        if (groupConfig) {
            delete sysConfig.groupConfigs[groupIdStr];
            modified = true;
        }

        // 2. Remove from enabled groups list
        if (sysConfig.enabledGroups) {
            const index = sysConfig.enabledGroups.indexOf(groupIdStr);
            if (index !== -1) {
                sysConfig.enabledGroups.splice(index, 1);
                modified = true;
            }
        }

        if (!modified) {
            return res.status(404).json({ error: 'Group config not found' });
        }

        // 3. Remove group from all subscriptions
        const subscriptionManager = require('../../services/subscription/subscriptionManager');
        await subscriptionManager.removeGroupFromAllSubscriptions(groupId);

        // Save config (debounced, will save in background)
        sysConfig.save();

        logger.info(`[API] Deleted config for left group ${groupId}`);
        res.json({ success: true, message: `Config for group ${groupId} deleted` });
    } catch (error) {
        logger.error('Error deleting group config:', error);
        res.status(500).json({ error: 'Failed to delete group config' });
    }
});

// GET /api/groups/:groupId/ai-config - Get group-level AI configuration
router.get('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);

        // Ensure group config exists
        sysConfig.ensureGroupConfig(groupId);

        const groupConfig = sysConfig.groupConfigs[groupId];

        // Return group overrides (null means inherit from global)
        res.json({
            aiEnabled: groupConfig.aiEnabled !== undefined ? groupConfig.aiEnabled : null,
            aiRagEnabled: groupConfig.aiRagEnabled !== undefined ? groupConfig.aiRagEnabled : null,
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled
            }
        });
    } catch (error) {
        logger.error(`Error fetching AI config for group ${req.params.groupId}:`, error);
        res.status(500).json({ error: 'Failed to fetch AI configuration' });
    }
});

// PUT /api/groups/:groupId/ai-config - Update group-level AI configuration
router.put('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);
        const { aiEnabled, aiRagEnabled } = req.body;

        // Validate request body
        if (aiEnabled === undefined && aiRagEnabled === undefined) {
            return res.status(400).json({
                error: 'At least one of aiEnabled or aiRagEnabled must be provided'
            });
        }

        // Ensure group config exists
        sysConfig.ensureGroupConfig(groupId);

        const groupConfig = sysConfig.groupConfigs[groupId];

        // Update or delete fields based on null values
        if (aiEnabled !== undefined) {
            if (aiEnabled === null) {
                // null means delete override (revert to global)
                delete groupConfig.aiEnabled;
            } else if (typeof aiEnabled === 'boolean') {
                groupConfig.aiEnabled = aiEnabled;
            } else {
                return res.status(400).json({
                    error: 'aiEnabled must be a boolean or null'
                });
            }
        }

        if (aiRagEnabled !== undefined) {
            if (aiRagEnabled === null) {
                // null means delete override (revert to global)
                delete groupConfig.aiRagEnabled;
            } else if (typeof aiRagEnabled === 'boolean') {
                groupConfig.aiRagEnabled = aiRagEnabled;
            } else {
                return res.status(400).json({
                    error: 'aiRagEnabled must be a boolean or null'
                });
            }
        }

        // Save configuration
        sysConfig.save();

        logger.info(`[API] Updated AI config for group ${groupId}`);

        // Return updated configuration
        res.json({
            message: 'AI configuration updated successfully',
            aiEnabled: groupConfig.aiEnabled !== undefined ? groupConfig.aiEnabled : null,
            aiRagEnabled: groupConfig.aiRagEnabled !== undefined ? groupConfig.aiRagEnabled : null,
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled
            }
        });
    } catch (error) {
        logger.error(`Error updating AI config for group ${req.params.groupId}:`, error);
        res.status(500).json({ error: 'Failed to update AI configuration' });
    }
});

// DELETE /api/groups/:groupId/ai-config - Reset group-level AI configuration
router.delete('/groups/:groupId/ai-config', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.groupId);

        // Ensure group config exists
        sysConfig.ensureGroupConfig(groupId);

        const groupConfig = sysConfig.groupConfigs[groupId];

        // Delete AI config overrides
        delete groupConfig.aiEnabled;
        delete groupConfig.aiRagEnabled;

        // Save configuration
        sysConfig.save();

        logger.info(`[API] Reset AI config for group ${groupId} to global defaults`);

        res.json({
            message: 'AI configuration reset to global defaults',
            global: {
                aiEnabled: sysConfig.aiEnabled,
                aiRagEnabled: sysConfig.aiRagEnabled
            }
        });
    } catch (error) {
        logger.error(`Error resetting AI config for group ${req.params.groupId}:`, error);
        res.status(500).json({ error: 'Failed to reset AI configuration' });
    }
});

// GET /api/groups/:id/bili-groups - Get Bilibili follow groups
router.get('/groups/:id/bili-groups', async (req, res) => {
    try {
        // 🆕 使用全局Cookie获取关注分组列表（不再使用群组Cookie）
        const result = await biliApi.getFollowGroups(null);
        if (result && result.status === 'success') {
            res.json(result.data);
        } else {
            // Return empty array if failed or no data
            res.json([]);
        }
    } catch (error) {
        logger.error('Error fetching Bilibili groups (global cookie):', error);
        res.status(500).json({ error: 'Failed to fetch Bilibili groups' });
    }
});

// GET /api/bili/login-url - Get Bilibili Login QR
router.get('/bili/login-url', async (req, res) => {
    try {
        const result = await biliApi.getLoginUrl();
        res.json(result);
    } catch (error) {
        logger.error('Error getting login URL:', error);
        res.status(500).json({ error: 'Failed to get login URL' });
    }
});

// POST /api/bili/check-login - Check Login Status
router.post('/bili/check-login', async (req, res) => {
    try {
        const { key, groupId } = req.body;
        const result = await biliApi.checkLogin(key, groupId);
        res.json(result);
    } catch (error) {
        logger.error('Error checking login:', error);
        res.status(500).json({ error: 'Failed to check login' });
    }
});

// GET /api/bili/my-info - Get current logged-in user info
router.get('/bili/my-info', async (req, res) => {
    try {
        const groupId = req.query.groupId ? parseInt(req.query.groupId) : null;
        if (groupId !== null && (isNaN(groupId) || groupId <= 0)) {
            return res.status(400).json({ error: 'Invalid groupId' });
        }
        const result = await biliApi.getMyInfo(groupId);
        res.json(result);
    } catch (error) {
        logger.error('Error getting my info:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// GET /api/bili/global-status - 获取全局Cookie登录状态
router.get('/bili/global-status', authenticateToken, async (req, res) => {
    try {
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const result = await biliApi.getGlobalCredentialInfo(refresh);

        if (result.status === 'success') {
            res.json({
                isLoggedIn: true,
                uid: result.data.uid,
                username: result.data.username,
                timestamp: result.data.timestamp
            });
        } else {
            // Cookie不存在或失效
            res.json({
                isLoggedIn: false,
                message: result.message || 'Not logged in'
            });
        }
    } catch (error) {
        logger.error('Error fetching global Bilibili status:', error);
        res.status(500).json({
            isLoggedIn: false,
            error: 'Failed to check login status'
        });
    }
});

// POST /api/bili/logout - Logout (clear cookies)
router.post('/bili/logout', async (req, res) => {
    try {
        const { groupId } = req.body;

        // 🆕 增强路径穿越防护
        if (groupId && (!/^\d+$/.test(String(groupId)) || String(groupId).includes('..'))) {
            return res.status(400).json({ error: 'Invalid groupId' });
        }

        // Delete cookie file
        const cookieFile = groupId
            ? path.resolve(__dirname, `../../../data/cookies_${groupId}.json`)
            : path.resolve(__dirname, '../../../data/cookies.json');

        // 🆕 三层安全验证
        // 1. 提取基础文件名（防止路径穿越）
        const fileName = path.basename(cookieFile);

        // 2. 白名单验证（只允许特定格式的cookie文件）
        const cookieFilePattern = /^cookies(_\d+)?\.json$/;
        if (!cookieFilePattern.test(fileName)) {
            logger.warn(`[Security] Attempted to delete non-cookie file: ${fileName}`);
            return res.status(400).json({ error: 'Invalid cookie file name' });
        }

        // 3. 路径前缀检查（确保文件在data目录下）
        const dataDir = path.resolve(__dirname, '../../../data');
        const resolvedPath = path.resolve(cookieFile);
        if (!resolvedPath.startsWith(dataDir + path.sep) && resolvedPath !== dataDir) {
            logger.warn(`[Security] Attempted path traversal: ${resolvedPath}`);
            return res.status(400).json({ error: 'Path traversal detected' });
        }

        try {
            await fs.unlink(cookieFile);
            logger.info(`[Security] Cookie file deleted: ${fileName}`);
        } catch (err) {
            // File doesn't exist - that's OK
            if (err.code !== 'ENOENT') {
                logger.warn('Error deleting cookie file:', err);
            }
        }

        // If group cookie, update mapping file
        if (groupId) {
            const mapFile = path.resolve(__dirname, '../../../data/cookies_map.json');
            try {
                const mapData = JSON.parse(await fs.readFile(mapFile, 'utf-8'));
                delete mapData[String(groupId)];
                await fs.writeFile(mapFile, JSON.stringify(mapData, null, 4));
            } catch (err) {
                // Mapping file doesn't exist or format error, ignore
                if (err.code !== 'ENOENT') {
                    logger.warn('Error updating cookie map:', err);
                }
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Error logging out:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// GET /api/groups/:id/subscriptions - List subscriptions for a group
router.get('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        const subs = await subscriptionService.getSubscriptionsByGroup(groupId);
        // Merge users and bangumis into a single array
        const mergedSubs = [
            ...(subs.users || []).map(u => ({ ...u, type: 'user', value: u.uid })),
            ...(subs.bangumis || []).map(b => ({ ...b, type: 'bangumi', value: b.seasonId }))
        ];
        res.json(mergedSubs);
    } catch (error) {
        logger.error(`Error fetching subscriptions for group ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

// POST /api/groups/:id/subscriptions - Add a subscription
router.post('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        const { type, value } = req.body;

        if (!type || !value) {
            return res.status(400).json({ error: 'Missing type or value' });
        }

        let resultName;
        if (type === 'user') {
            resultName = await subscriptionService.addUserSubscription(value, groupId);
        } else if (type === 'bangumi') {
            resultName = await subscriptionService.addBangumiSubscription(value, groupId);
        } else {
            return res.status(400).json({ error: 'Invalid subscription type. Must be "user" or "bangumi".' });
        }

        res.json({ message: 'Subscription added', name: resultName });
    } catch (error) {
        logger.error(`Error adding subscription for group ${req.params.id}:`, error);
        res.status(500).json({ error: error.message || 'Failed to add subscription' });
    }
});

// DELETE /api/groups/:id/subscriptions - Remove a subscription
router.delete('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id);
        // Support both body and query params
        const type = req.body.type || req.query.type;
        const value = req.body.value || req.query.value;

        if (!type || !value) {
            return res.status(400).json({ error: 'Missing type or value' });
        }

        let success = false;
        if (type === 'user') {
            success = await subscriptionService.removeUserSubscription(value, groupId);
        } else if (type === 'bangumi') {
            success = await subscriptionService.removeBangumiSubscription(value, groupId);
        } else {
            return res.status(400).json({ error: 'Invalid subscription type. Must be "user" or "bangumi".' });
        }

        if (success) {
            res.json({ message: 'Subscription removed' });
        } else {
            res.status(404).json({ error: 'Subscription not found' });
        }
    } catch (error) {
        logger.error(`Error removing subscription for group ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

// GET /api/blacklist/global - Get global blacklist
router.get('/blacklist/global', async (req, res) => {
    try {
        res.json(sysConfig.blacklistedQQs || []);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blacklist' });
    }
});

// POST /api/blacklist/global - Add to global blacklist
router.post('/blacklist/global', async (req, res) => {
    try {
        const { qq } = req.body;
        if (!qq) {
            return res.status(400).json({ error: 'Missing QQ number' });
        }

        if (!sysConfig.blacklistedQQs) {
            sysConfig.blacklistedQQs = [];
        }

        // Store as number if it looks like one, or string.
        const qqVal = Number(qq);
        const valToStore = isNaN(qqVal) ? qq : qqVal;

        if (!sysConfig.blacklistedQQs.includes(valToStore)) {
            sysConfig.blacklistedQQs.push(valToStore);
            sysConfig.save();
        }

        res.json({ message: 'Added to blacklist', blacklist: sysConfig.blacklistedQQs });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist' });
    }
});

// DELETE /api/blacklist/global/:qq - Remove from global blacklist
router.delete('/blacklist/global/:qq', async (req, res) => {
    try {
        const qqToRemove = req.params.qq;

        if (sysConfig.blacklistedQQs && sysConfig.blacklistedQQs.length > 0) {
            // Filter out loose match (string vs number)
            sysConfig.blacklistedQQs = sysConfig.blacklistedQQs.filter(q => String(q) !== String(qqToRemove));
            sysConfig.save();
        }

        res.json({ message: 'Removed from blacklist', blacklist: sysConfig.blacklistedQQs || [] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist' });
    }
});

// GET /api/mcp - Read MCP servers config
router.get('/mcp', async (req, res) => {
    try {
        logger.info('[API] Reading MCP configuration...');
        const config = await readMcpConfig();

        // Extract version number
        const version = config._version || 0;

        // Convert object format to array format for frontend
        const mcpServers = Object.entries(config)
            .filter(([key]) => key !== '_version')  // Filter out version field
            .map(([name, serverConfig]) => ({
                name,
                type: serverConfig.type || 'stdio',
                url: serverConfig.url || '',
                command: serverConfig.command || '',
                args: serverConfig.args || [],
                env: serverConfig.env || {},
                enabled: serverConfig.enabled !== false
            }));

        logger.info(`[API] Returning ${mcpServers.length} MCP servers to client`);
        res.json({ mcpServers, version });
    } catch (error) {
        logger.error('[API] Failed to read MCP configuration:', error);
        res.status(500).json({ error: 'Failed to read MCP configuration', details: error.message });
    }
});

// POST /api/mcp - Update MCP servers config
router.post('/mcp', async (req, res) => {
    try {
        const { mcpServers, version, renameOperation } = req.body;

        logger.info(`[API] Updating MCP configuration: ${mcpServers?.length || 0} servers`);

        // Rename operation logging
        if (renameOperation) {
            logger.info(`[API] Rename operation detected: ${renameOperation.from} → ${renameOperation.to}`);
        }

        // === Strong validation: Frontend must send array format ===
        if (!Array.isArray(mcpServers)) {
            logger.warn('[API] Invalid mcpServers format:', req.body);
            return res.status(400).json({
                error: 'Invalid mcpServers format, expected array',
                received: typeof req.body.mcpServers,
                expected: 'array'
            });
        }

        // === Version control: Concurrent conflict detection ===
        const currentConfig = await readMcpConfig();
        const currentVersion = currentConfig._version || 0;

        if (version !== undefined && version !== currentVersion) {
            logger.warn('[API] Concurrent modification detected', {
                clientVersion: version,
                serverVersion: currentVersion
            });

            // Return latest config for frontend merge
            const latestServers = Object.entries(currentConfig)
                .filter(([key]) => key !== '_version')
                .map(([name, serverConfig]) => ({
                    name,
                    type: serverConfig.type || 'stdio',
                    url: serverConfig.url || '',
                    command: serverConfig.command || '',
                    args: serverConfig.args || [],
                    env: serverConfig.env || {},
                    enabled: serverConfig.enabled !== false
                }));

            return res.status(409).json({
                error: 'Configuration has been modified by another user',
                conflict: true,
                serverVersion: currentVersion,
                currentConfig: latestServers
            });
        }

        // === Field-level validation: validate all servers ===
        const validationErrors = [];
        const seenNames = new Set();
        const allowedTypes = new Set(['stdio', 'sse', 'streamable_http']);

        mcpServers.forEach((server, idx) => {
            const serverType = server.type || 'stdio';
            // name validation
            if (!server.name || typeof server.name !== 'string') {
                validationErrors.push(`Server at index ${idx}: name is required and must be string`);
                return;
            }
            if (server.name.trim() === '') {
                validationErrors.push(`Server "${server.name}": name cannot be empty`);
                return;
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) {
                validationErrors.push(`Server "${server.name}": name contains invalid characters (only a-z, A-Z, 0-9, _, - allowed)`);
                return;
            }
            if (seenNames.has(server.name)) {
                validationErrors.push(`Duplicate server name: "${server.name}"`);
            }
            seenNames.add(server.name);

            if (!allowedTypes.has(serverType)) {
                validationErrors.push(`Server "${server.name}": type must be one of stdio, sse, streamable_http`);
                return;
            }

            if (serverType !== 'stdio') {
                if (!server.url || typeof server.url !== 'string' || server.url.trim() === '') {
                    validationErrors.push(`Server "${server.name}": url is required for ${serverType}`);
                    return;
                }
                try {
                    const parsedUrl = new URL(server.url);
                    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                        validationErrors.push(`Server "${server.name}": url must start with http or https`);
                        return;
                    }
                } catch {
                    validationErrors.push(`Server "${server.name}": url is invalid`);
                    return;
                }
            } else {
                if (!server.command || typeof server.command !== 'string') {
                    validationErrors.push(`Server "${server.name}": command is required and must be string`);
                    return;
                }
            }

            // args validation
            if (server.args !== undefined && !Array.isArray(server.args)) {
                validationErrors.push(`Server "${server.name}": args must be an array`);
            }

            // env validation
            if (server.env !== undefined && (typeof server.env !== 'object' || Array.isArray(server.env))) {
                validationErrors.push(`Server "${server.name}": env must be an object`);
            }
        });

        if (validationErrors.length > 0) {
            logger.warn('[API] MCP configuration validation failed:', validationErrors);
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors
            });
        }

        // === Format conversion: array → object (single source of truth) ===
        const newVersion = currentVersion + 1;
        const newConfig = { _version: newVersion };

        for (const server of mcpServers) {
            const serverType = server.type || 'stdio';
            newConfig[server.name] = {
                type: serverType,
                command: server.command,
                args: server.args || [],
                env: server.env || {},
                enabled: server.enabled !== undefined ? server.enabled : true
            };
            if (serverType !== 'stdio') {
                newConfig[server.name].url = server.url;
            }
        }

        // Write to file
        await writeMcpConfig(newConfig);
        logger.info('[API] MCP configuration saved to file');

        // === Reload mechanism: Wait for reload and return result ===
        try {
            await mcpManager.reload(newConfig);
            logger.info('[API] MCP servers reloaded successfully');

            res.json({
                message: 'MCP配置已更新并生效',
                config: newConfig,
                version: newVersion,
                reloadSuccess: true
            });

        } catch (reloadError) {
            logger.error('[API] Failed to reload MCP servers after config update:', reloadError);

            // Config saved but reload failed - return 207 Multi-Status
            res.status(207).json({
                message: '配置已保存，但服务重载失败',
                config: newConfig,
                version: newVersion,
                reloadSuccess: false,
                error: reloadError.message,
                warning: '配置已保存到文件，但MCP服务可能未更新，建议重启应用'
            });
        }

    } catch (error) {
        logger.error('[API] Failed to save MCP configuration:', error);
        res.status(500).json({ error: 'Failed to save MCP configuration', details: error.message });
    }
});

// POST /api/ai - Update AI settings
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // === AI配置字段验证 ===

        // aiProbability: 0-1
        if (updates.aiProbability !== undefined) {
            const prob = parseFloat(updates.aiProbability);
            if (isNaN(prob) || prob < 0 || prob > 1) {
                return res.status(400).json({
                    error: 'aiProbability must be between 0 and 1',
                    field: 'aiProbability',
                    expected: '0.0 - 1.0'
                });
            }
            updates.aiProbability = prob;
        }

        // aiContextLimit: 1-100
        if (updates.aiContextLimit !== undefined) {
            const limit = parseInt(updates.aiContextLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res.status(400).json({
                    error: 'aiContextLimit must be between 1 and 100',
                    field: 'aiContextLimit',
                    expected: '1 - 100'
                });
            }
            updates.aiContextLimit = limit;
        }

        if (updates.aiTemperature !== undefined) {
            const temp = parseFloat(updates.aiTemperature);
            if (isNaN(temp) || temp < 0 || temp > 2) {
                return res.status(400).json({
                    error: 'aiTemperature must be between 0 and 2',
                    field: 'aiTemperature',
                    expected: '0.0 - 2.0'
                });
            }
            updates.aiTemperature = temp;
        }

        // aiVectorSimilarityThreshold: 0-1
        if (updates.aiVectorSimilarityThreshold !== undefined) {
            const threshold = parseFloat(updates.aiVectorSimilarityThreshold);
            if (isNaN(threshold) || threshold < 0 || threshold > 1) {
                return res.status(400).json({
                    error: 'aiVectorSimilarityThreshold must be between 0 and 1',
                    field: 'aiVectorSimilarityThreshold',
                    expected: '0.0 - 1.0'
                });
            }
            updates.aiVectorSimilarityThreshold = threshold;
        }

        // aiVectorSearchLimit: 1-10
        if (updates.aiVectorSearchLimit !== undefined) {
            const limit = parseInt(updates.aiVectorSearchLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 10) {
                return res.status(400).json({
                    error: 'aiVectorSearchLimit must be between 1 and 10',
                    field: 'aiVectorSearchLimit',
                    expected: '1 - 10'
                });
            }
            updates.aiVectorSearchLimit = limit;
        }

        // aiMemorySafetyLimit: 1-10000
        if (updates.aiMemorySafetyLimit !== undefined) {
            const limit = parseInt(updates.aiMemorySafetyLimit, 10);
            if (isNaN(limit) || limit < 1 || limit > 10000) {
                return res.status(400).json({
                    error: 'aiMemorySafetyLimit must be between 1 and 10000',
                    field: 'aiMemorySafetyLimit',
                    expected: '1 - 10000'
                });
            }
            updates.aiMemorySafetyLimit = limit;
        }

        // aiHistoryMaxSize: 1MB - 10000MB
        if (updates.aiHistoryMaxSize !== undefined) {
            const size = parseInt(updates.aiHistoryMaxSize, 10);
            if (isNaN(size) || size < 1024 * 1024 || size > 10000 * 1024 * 1024) {
                return res.status(400).json({
                    error: 'aiHistoryMaxSize must be between 1MB and 10000MB',
                    field: 'aiHistoryMaxSize',
                    expected: '1048576 - 10485760000 (1MB - 10000MB)'
                });
            }
            updates.aiHistoryMaxSize = size;
        }

        // Merge updates into root config (AI settings are at root level)
        // Object.assign will trigger setters which internally call save()
        Object.assign(sysConfig, updates);

        // Return clean snapshot of AI fields (not sysConfig instance)
        const aiFields = [
            'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt',
            'aiProbability', 'aiContextLimit', 'aiTemperature',
            'aiChatApiUrl', 'aiChatApiKey', 'aiChatModel', 'aiChatProxy', 'aiChatSystemPrompt',
            'aiEmbeddingApiUrl', 'aiEmbeddingApiKey', 'aiEmbeddingModel', 'aiEmbeddingProxy',
            'aiHistoryMaxSize', 'aiVectorMaxSize', 'aiVectorSimilarityThreshold',
            'aiVectorSearchLimit', 'aiShortMessageThreshold', 'aiMemorySafetyLimit',
            'aiVectorMemoryLimit', 'aiTrimRatio', 'aiVectorBatchLoadSize',
            'aiEnableVectorCache', 'aiEnableSmartTrim'
        ];

        const snapshot = {};
        for (const field of aiFields) {
            snapshot[field] = sysConfig[field];
        }

        res.json({ message: 'AI settings updated', config: snapshot });
    } catch (error) {
        logger.error('Failed to update AI settings:', error);
        res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
    }
});

// POST /api/ai/reset - Reset AI settings to defaults (.env)
router.post('/ai/reset', async (req, res) => {
    try {
        const aiKeys = [
            // General AI Config
            'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt', 'aiProbability', 'aiTemperature',
            // Chat Service Config
            'aiChatApiUrl', 'aiChatApiKey', 'aiChatModel', 'aiChatProxy', 'aiChatSystemPrompt',
            // Embedding Service Config
            'aiEmbeddingApiUrl', 'aiEmbeddingApiKey', 'aiEmbeddingModel', 'aiEmbeddingProxy',
            // Other AI Settings
            'aiContextLimit', 'aiHistoryMaxSize', 'aiVectorMaxSize',
            'aiVectorSimilarityThreshold', 'aiVectorSearchLimit', 'aiShortMessageThreshold', 'aiMemorySafetyLimit',
            'aiVectorMemoryLimit', 'aiTrimRatio', 'aiVectorBatchLoadSize', 'aiEnableVectorCache', 'aiEnableSmartTrim'
        ];

        // Delete keys from config.json - getters will auto-fallback to .env or defaults
        sysConfig.deleteKeys(aiKeys);

        res.json({ message: 'AI settings reset to defaults', config: sysConfig });
    } catch (error) {
        logger.error('Error resetting AI settings:', error);
        res.status(500).json({ error: 'Failed to reset AI settings' });
    }
});

// POST /api/restart - Trigger graceful restart
router.post('/restart', async (req, res) => {
    res.json({ message: 'Restarting application...' });

    // Allow response to be sent before exiting
    setTimeout(() => {
        logger.info('Restart triggered via API');
        process.exit(0);
    }, 1000);
});

// GET /api/monitor - System stats
router.get('/monitor', async (req, res) => {
    try {
        // Fetch default network interface first for efficiency
        const defaultIface = await si.networkInterfaceDefault().catch(() => null);

        const [cpu, mem, network, time] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.networkStats(defaultIface || undefined),
            si.time()
        ]);

        // Calculate process uptime
        const processUptime = process.uptime();

        // Calculate network stats (sum if array, though with specific interface it should be one)
        let rx_sec = 0;
        let tx_sec = 0;

        if (Array.isArray(network)) {
            network.forEach(iface => {
                rx_sec += iface.rx_sec || 0;
                tx_sec += iface.tx_sec || 0;
            });
        } else if (network) {
             rx_sec = network.rx_sec || 0;
             tx_sec = network.tx_sec || 0;
        }

        const stats = {
            cpu: cpu.currentLoad,
            memory: {
                used: mem.active,
                total: mem.total
            },
            network: {
                up: tx_sec,
                down: rx_sec
            },
            uptime: processUptime
        };

        res.json(stats);
    } catch (error) {
        logger.error('Error fetching system stats:', error);
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

module.exports = router;
