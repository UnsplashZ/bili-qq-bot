const fs = require('fs').promises
const path = require('path')
const logger = require('../../../../utils/logger')

const CONFIG_PATH = path.resolve(__dirname, '../../../../../config/config.json')
const MCP_CONFIG_PATH = path.resolve(__dirname, '../../../../../config/mcp_servers.json')

async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        logger.error('Error reading config file:', error)
        throw error
    }
}

async function writeConfig(config) {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    } catch (error) {
        logger.error('Error writing config file:', error)
        throw error
    }
}

async function readMcpConfig() {
    try {
        const data = await fs.readFile(MCP_CONFIG_PATH, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        if (error.code === 'ENOENT') return {}
        logger.error('Error reading MCP config file:', error)
        throw error
    }
}

async function writeMcpConfig(config) {
    try {
        await fs.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    } catch (error) {
        logger.error('Error writing MCP config file:', error)
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

