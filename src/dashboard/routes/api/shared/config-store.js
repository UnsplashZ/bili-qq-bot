const fs = require('fs').promises
const path = require('path')
const logger = require('../../../../utils/logger')
const { storeLog } = require('./logging')

const CONFIG_PATH = path.resolve(__dirname, '../../../../../config/config.json')
const MCP_CONFIG_PATH = path.resolve(__dirname, '../../../../../config/mcp_servers.json')

async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        storeLog('dashboard-config', 'error', 'config-read-failed', {
            path: CONFIG_PATH,
            error: logger.getErrorMessage(error)
        })
        throw error
    }
}

async function writeConfig(config) {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    } catch (error) {
        storeLog('dashboard-config', 'error', 'config-write-failed', {
            path: CONFIG_PATH,
            error: logger.getErrorMessage(error)
        })
        throw error
    }
}

async function readMcpConfig() {
    try {
        const data = await fs.readFile(MCP_CONFIG_PATH, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        if (error.code === 'ENOENT') return {}
        storeLog('dashboard-config', 'error', 'mcp-config-read-failed', {
            path: MCP_CONFIG_PATH,
            error: logger.getErrorMessage(error)
        })
        throw error
    }
}

async function writeMcpConfig(config) {
    try {
        await fs.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    } catch (error) {
        storeLog('dashboard-config', 'error', 'mcp-config-write-failed', {
            path: MCP_CONFIG_PATH,
            error: logger.getErrorMessage(error)
        })
        throw error
    }
}

module.exports = {
    CONFIG_PATH,
    MCP_CONFIG_PATH,
    readConfig,
    writeConfig,
    readMcpConfig,
    writeMcpConfig
}
