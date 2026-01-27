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

const CONFIG_PATH = path.resolve(__dirname, '../../../config/config.json');
const MCP_CONFIG_PATH = path.resolve(__dirname, '../../../config/mcp_servers.json');

// --- Public Routes ---

// POST /api/login - Dashboard Login
router.post('/login', (req, res) => {
    const { password } = req.body;

    // Compare with configured dashboard password
    if (password === sysConfig.dashboardPassword) {
        // Generate JWT token
        const token = jwt.sign(
            { role: 'admin', timestamp: Date.now() },
            sysConfig.jwtSecret,
            { expiresIn: '24h' }
        );

        logger.info(`Successful login from ${req.ip}`);
        res.json({ token });
    } else {
        logger.warn(`Failed login attempt from ${req.ip}`);
        res.status(401).json({ error: 'Invalid password' });
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

// POST /api/config - Update global config
router.post('/config', async (req, res) => {
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // Update in-memory config
        Object.assign(sysConfig, newConfig);
        sysConfig.save();

        res.json({ message: 'Configuration updated successfully', config: newConfig });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// GET /api/groups - List all groups (including disabled ones)
router.get('/groups', async (req, res) => {
    try {
        const bot = global.bot;
        if (!bot || !bot.groupList) {
            return res.json([]);
        }

        // 获取所有群组（不过滤 enabledGroups）
        const allGroups = Array.from(bot.groupList.keys());
        const enabledGroups = new Set(sysConfig.enabledGroups || []);
        const groupConfigs = sysConfig.groupConfigs || {};

        const groupsData = allGroups.map(groupId => {
            const groupInfo = bot.groupList.get(groupId);
            const isEnabled = enabledGroups.has(groupId);
            const groupConfig = groupConfigs[groupId] || {};

            return {
                id: groupId,
                name: groupInfo?.group_name || `群组 ${groupId}`,
                isEnabled: isEnabled,  // 添加启用状态
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
        const groupId = req.params.id;

        // 验证群组是否存在
        if (!global.bot || !global.bot.groupList || !global.bot.groupList.has(groupId)) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!sysConfig.enabledGroups) {
            sysConfig.enabledGroups = [];
        }

        const index = sysConfig.enabledGroups.indexOf(groupId);
        let isEnabled;

        if (index === -1) {
            sysConfig.enabledGroups.push(groupId);
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
        const groupId = req.params.id;
        const updates = req.body;

        // 验证群组是否存在
        if (!global.bot || !global.bot.groupList || !global.bot.groupList.has(groupId)) {
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

        if (!sysConfig.groupConfigs) {
            sysConfig.groupConfigs = {};
        }

        // 清理null值（表示使用全局默认）- 在合并前处理
        const cleanedUpdates = { ...updates };
        if (updates.hasOwnProperty('aiProbability') && updates.aiProbability === null) {
            delete cleanedUpdates.aiProbability;
            // 从现有配置中删除
            if (sysConfig.groupConfigs[groupId]) {
                delete sysConfig.groupConfigs[groupId].aiProbability;
            }
        }
        if (updates.hasOwnProperty('aiContextLimit') && updates.aiContextLimit === null) {
            delete cleanedUpdates.aiContextLimit;
            // 从现有配置中删除
            if (sysConfig.groupConfigs[groupId]) {
                delete sysConfig.groupConfigs[groupId].aiContextLimit;
            }
        }

        // 合并更新（已清理null值）
        sysConfig.groupConfigs[groupId] = {
            ...(sysConfig.groupConfigs[groupId] || {}),
            ...cleanedUpdates
        };

        sysConfig.save();

        res.json({
            message: `Group ${groupId} configuration updated`,
            config: sysConfig.groupConfigs[groupId]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update group configuration' });
    }
});

// GET /api/groups/:id/bili-groups - Get Bilibili follow groups
router.get('/groups/:id/bili-groups', async (req, res) => {
    try {
        const groupId = req.params.id;
        const result = await biliApi.getFollowGroups(groupId);
        if (result && result.status === 'success') {
            res.json(result.data);
        } else {
            // Return empty array if failed or no data
            res.json([]);
        }
    } catch (error) {
        logger.error(`Error fetching Bilibili groups for group ${req.params.id}:`, error);
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

// GET /api/groups/:id/subscriptions - List subscriptions for a group
router.get('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = req.params.id;
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
        const groupId = req.params.id;
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
        const groupId = req.params.id;
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
        const config = await readMcpConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read MCP configuration' });
    }
});

// POST /api/mcp - Update MCP servers config
router.post('/mcp', async (req, res) => {
    try {
        const newConfig = req.body;
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }
        await writeMcpConfig(newConfig);
        res.json({ message: 'MCP configuration updated', config: newConfig });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save MCP configuration' });
    }
});

// POST /api/ai - Update AI settings
router.post('/ai', async (req, res) => {
    try {
        const updates = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        // Merge updates into root config (AI settings are at root level)
        Object.assign(sysConfig, updates);

        sysConfig.save();
        res.json({ message: 'AI settings updated', config: sysConfig });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update AI settings' });
    }
});

// POST /api/ai/reset - Reset AI settings to defaults (.env)
router.post('/ai/reset', async (req, res) => {
    try {
        const aiKeys = [
            'aiApiUrl', 'aiApiKey', 'aiModel', 'aiSystemPrompt', 'aiProbability',
            'aiEmbeddingApiUrl', 'aiEmbeddingApiKey', 'aiEmbeddingModel', 'aiChatProxy', 'aiEmbeddingProxy',
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
