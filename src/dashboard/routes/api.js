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

        // Validate basic structure if needed, or just overwrite
        // For now, we assume the client sends a full or partial config object
        // that we want to save.
        // The requirement says "overwrite config/config.json", implying the body IS the new config.
        // But usually we might want to merge. Let's stick to "overwrite" as per requirements
        // or safer: read existing, merge, then write?
        // Requirement: "Receive JSON body, validate it (basic check), and overwrite config/config.json"

        await writeConfig(newConfig);
        res.json({ message: 'Configuration updated successfully', config: newConfig });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// GET /api/groups - List groups
router.get('/groups', async (req, res) => {
    try {
        const config = await readConfig();
        const enabledGroups = new Set(config.enabledGroups || []);
        const groupConfigs = config.groupConfigs || {};

        // Collect all unique group IDs from enabledGroups and groupConfigs keys
        const allGroupIds = new Set([
            ...enabledGroups,
            ...Object.keys(groupConfigs)
        ]);

        const groups = [];
        for (const id of allGroupIds) {
            groups.push({
                id: id,
                isEnabled: enabledGroups.has(id),
                config: groupConfigs[id] || {}
            });
        }

        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// POST /api/groups/:id/toggle - Toggle group enabled status
router.post('/groups/:id/toggle', async (req, res) => {
    try {
        const groupId = req.params.id;
        const config = await readConfig();

        if (!config.enabledGroups) {
            config.enabledGroups = [];
        }

        const index = config.enabledGroups.indexOf(groupId);
        let isEnabled;

        if (index === -1) {
            config.enabledGroups.push(groupId);
            isEnabled = true;
        } else {
            config.enabledGroups.splice(index, 1);
            isEnabled = false;
        }

        await writeConfig(config);
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

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }

        const config = await readConfig();

        if (!config.groupConfigs) {
            config.groupConfigs = {};
        }

        // Merging logic: Update provided fields, keep others
        config.groupConfigs[groupId] = {
            ...(config.groupConfigs[groupId] || {}),
            ...updates
        };

        await writeConfig(config);
        res.json({
            message: `Group ${groupId} configuration updated`,
            config: config.groupConfigs[groupId]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update group configuration' });
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
        const config = await readConfig();
        res.json(config.blacklistedQQs || []);
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

        const config = await readConfig();
        if (!config.blacklistedQQs) {
            config.blacklistedQQs = [];
        }

        // Store as number if it looks like one, or string.
        // Usually QQs are numbers, but JS handles them as numbers up to 2^53.
        // Config often stores them as numbers. Let's try to convert to number if safe.
        // But for safety against large numbers, maybe string is better?
        // Let's check if existing ones are numbers.
        // If the array is empty, we default to Number(qq) if valid, else string.

        const qqVal = Number(qq);
        const valToStore = isNaN(qqVal) ? qq : qqVal;

        if (!config.blacklistedQQs.includes(valToStore)) {
            config.blacklistedQQs.push(valToStore);
            await writeConfig(config);
        }

        res.json({ message: 'Added to blacklist', blacklist: config.blacklistedQQs });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist' });
    }
});

// DELETE /api/blacklist/global/:qq - Remove from global blacklist
router.delete('/blacklist/global/:qq', async (req, res) => {
    try {
        const qqToRemove = req.params.qq;
        const config = await readConfig();

        if (config.blacklistedQQs && config.blacklistedQQs.length > 0) {
            // Filter out loose match (string vs number)
            config.blacklistedQQs = config.blacklistedQQs.filter(q => String(q) !== String(qqToRemove));
            await writeConfig(config);
        }

        res.json({ message: 'Removed from blacklist', blacklist: config.blacklistedQQs || [] });
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

        const config = await readConfig();

        // Merge updates into root config (AI settings are at root level)
        Object.assign(config, updates);

        await writeConfig(config);
        res.json({ message: 'AI settings updated', config: config });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update AI settings' });
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
