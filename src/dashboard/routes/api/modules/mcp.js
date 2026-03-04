const express = require('express')
const logger = require('../../../../utils/logger')
const mcpManager = require('../../../../services/mcpManager')
const { readMcpConfig, writeMcpConfig } = require('../shared/config-store')
const { isMcpConfigContentEqual } = require('../shared/mcp-utils')

const router = express.Router()

// GET /api/mcp - Read MCP servers config
router.get('/mcp', async (req, res) => {
    try {
        logger.info('[API] Reading MCP configuration...')
        const config = await readMcpConfig()

        const version = config._version || 0

        const mcpServers = Object.entries(config)
            .filter(([key]) => key !== '_version')
            .map(([name, serverConfig]) => ({
                name,
                type: serverConfig.type || 'stdio',
                url: serverConfig.url || '',
                command: serverConfig.command || '',
                args: serverConfig.args || [],
                env: serverConfig.env || {},
                enabled: serverConfig.enabled !== false
            }))

        logger.info(`[API] Returning ${mcpServers.length} MCP servers to client`)
        res.json({ mcpServers, version })
    } catch (error) {
        logger.error('[API] Failed to read MCP configuration:', error)
        res
            .status(500)
            .json({ error: 'Failed to read MCP configuration', details: error.message })
    }
})

// POST /api/mcp - Update MCP servers config
router.post('/mcp', async (req, res) => {
    try {
        const { mcpServers, version, renameOperation } = req.body

        logger.info(
            `[API] Updating MCP configuration: ${mcpServers?.length || 0} servers`
        )

        if (renameOperation) {
            logger.info(
                `[API] Rename operation detected: ${renameOperation.from} → ${renameOperation.to}`
            )
        }

        if (!Array.isArray(mcpServers)) {
            logger.warn('[API] Invalid mcpServers format:', req.body)
            return res.status(400).json({
                error: 'Invalid mcpServers format, expected array',
                received: typeof req.body.mcpServers,
                expected: 'array'
            })
        }

        const currentConfig = await readMcpConfig()
        const currentVersion = currentConfig._version || 0

        if (version !== undefined && version !== currentVersion) {
            logger.warn('[API] Concurrent modification detected', {
                clientVersion: version,
                serverVersion: currentVersion
            })

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
                }))

            return res.status(409).json({
                error: 'Configuration has been modified by another user',
                conflict: true,
                serverVersion: currentVersion,
                currentConfig: latestServers
            })
        }

        const validationErrors = []
        const seenNames = new Set()
        const allowedTypes = new Set(['stdio', 'sse', 'streamable_http'])

        mcpServers.forEach((server, idx) => {
            const serverType = server.type || 'stdio'
            if (!server.name || typeof server.name !== 'string') {
                validationErrors.push(
                    `Server at index ${idx}: name is required and must be string`
                )
                return
            }
            if (server.name.trim() === '') {
                validationErrors.push(`Server "${server.name}": name cannot be empty`)
                return
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) {
                validationErrors.push(
                    `Server "${server.name}": name contains invalid characters (only a-z, A-Z, 0-9, _, - allowed)`
                )
                return
            }
            if (seenNames.has(server.name)) {
                validationErrors.push(`Duplicate server name: "${server.name}"`)
            }
            seenNames.add(server.name)

            if (!allowedTypes.has(serverType)) {
                validationErrors.push(
                    `Server "${server.name}": type must be one of stdio, sse, streamable_http`
                )
                return
            }

            if (serverType !== 'stdio') {
                if (
                    !server.url ||
                    typeof server.url !== 'string' ||
                    server.url.trim() === ''
                ) {
                    validationErrors.push(
                        `Server "${server.name}": url is required for ${serverType}`
                    )
                    return
                }
                try {
                    const parsedUrl = new URL(server.url)
                    if (
                        parsedUrl.protocol !== 'http:' &&
                        parsedUrl.protocol !== 'https:'
                    ) {
                        validationErrors.push(
                            `Server "${server.name}": url must start with http or https`
                        )
                        return
                    }
                } catch {
                    validationErrors.push(`Server "${server.name}": url is invalid`)
                    return
                }
            } else {
                if (!server.command || typeof server.command !== 'string') {
                    validationErrors.push(
                        `Server "${server.name}": command is required and must be string`
                    )
                    return
                }
            }

            if (server.args !== undefined && !Array.isArray(server.args)) {
                validationErrors.push(`Server "${server.name}": args must be an array`)
            }

            if (
                server.env !== undefined &&
                (typeof server.env !== 'object' || Array.isArray(server.env))
            ) {
                validationErrors.push(`Server "${server.name}": env must be an object`)
            }
        })

        if (validationErrors.length > 0) {
            logger.warn('[API] MCP configuration validation failed:', validationErrors)
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors
            })
        }

        const newVersion = currentVersion + 1
        const newConfig = { _version: newVersion }

        for (const server of mcpServers) {
            const serverType = server.type || 'stdio'
            newConfig[server.name] = {
                type: serverType,
                command: server.command,
                args: server.args || [],
                env: server.env || {},
                enabled: server.enabled !== undefined ? server.enabled : true
            }
            if (serverType !== 'stdio') {
                newConfig[server.name].url = server.url
            }
        }

        if (isMcpConfigContentEqual(currentConfig, newConfig)) {
            logger.info('[API] MCP configuration unchanged, skipping save and reload')
            return res.json({
                message: 'MCP配置未变化，已跳过重载',
                config: currentConfig,
                version: currentVersion,
                reloadSuccess: true,
                skippedReload: true
            })
        }

        await writeMcpConfig(newConfig)
        logger.info('[API] MCP configuration saved to file')

        try {
            await mcpManager.reload(newConfig)
            logger.info('[API] MCP servers reloaded successfully')

            res.json({
                message: 'MCP配置已更新并生效',
                config: newConfig,
                version: newVersion,
                reloadSuccess: true
            })
        } catch (reloadError) {
            logger.error(
                '[API] Failed to reload MCP servers after config update:',
                reloadError
            )

            res.status(207).json({
                message: '配置已保存，但服务重载失败',
                config: newConfig,
                version: newVersion,
                reloadSuccess: false,
                error: reloadError.message,
                warning: '配置已保存到文件，但MCP服务可能未更新，建议重启应用'
            })
        }
    } catch (error) {
        logger.error('[API] Failed to save MCP configuration:', error)
        res
            .status(500)
            .json({ error: 'Failed to save MCP configuration', details: error.message })
    }
})

module.exports = router

