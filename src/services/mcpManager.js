const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const logger = require('../utils/logger');

class McpManager {
    constructor() {
        this.clients = new Map(); // serverName -> Client
        this.toolsMap = new Map(); // toolName -> { serverName, toolName }
        this.configPath = path.join(process.cwd(), 'config', 'mcp_servers.json');
        this._lastWorkingConfig = null;  // Last successfully loaded config for rollback
        this._startupStartedAt = null;
        this._isReloading = false;  // Prevent reconnect during reload
        this._serverStates = new Map(); // serverName -> state
        const delayValue = parseInt(process.env.MCP_CALL_DELAY_MS || '10000', 10);
        this._startupDelayMs = Number.isFinite(delayValue) ? Math.max(delayValue, 0) : 0;
        this._baseRetryDelayMs = this._parseIntEnv('MCP_RETRY_DELAY_MS', 5000);
        this._maxRetryDelayMs = this._parseIntEnv('MCP_MAX_RETRY_DELAY_MS', 60000);
        this._maxRetries = this._parseIntEnv('MCP_MAX_RETRIES', 5);
        this._disconnectDedupMs = this._parseIntEnv('MCP_DISCONNECT_DEDUP_MS', 1200);
    }

    _parseIntEnv(name, fallback, min = 0) {
        const value = parseInt(process.env[name] || `${fallback}`, 10);
        if (!Number.isFinite(value)) return fallback;
        return Math.max(value, min);
    }

    _getServerState(serverName) {
        if (!this._serverStates.has(serverName)) {
            this._serverStates.set(serverName, {
                connecting: false,
                retryTimer: null,
                retryCount: 0,
                generation: 0,
                lastDisconnectAt: 0
            });
        }
        return this._serverStates.get(serverName);
    }

    _clearRetryTimer(serverName) {
        const state = this._serverStates.get(serverName);
        if (!state || !state.retryTimer) return;
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }

    _clearAllRetryTimers() {
        for (const [serverName] of this._serverStates.entries()) {
            this._clearRetryTimer(serverName);
        }
    }

    _snapshotServerStates() {
        const snapshot = new Map();
        for (const [name, state] of this._serverStates.entries()) {
            snapshot.set(name, {
                connecting: state.connecting,
                hadRetryTimer: !!state.retryTimer,
                retryCount: state.retryCount,
                generation: state.generation,
                lastDisconnectAt: state.lastDisconnectAt
            });
        }
        return snapshot;
    }

    _restoreServerStates(snapshot) {
        const restored = new Map();
        for (const [name, state] of snapshot.entries()) {
            restored.set(name, {
                connecting: state.connecting,
                retryTimer: null,
                retryCount: state.retryCount,
                generation: state.generation,
                lastDisconnectAt: state.lastDisconnectAt
            });
        }
        this._serverStates = restored;
    }

    _loadConfigFromDisk() {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }

    _getReconnectConfig(serverName, fallbackConfig) {
        try {
            const currentConfig = this._loadConfigFromDisk();
            const serverInConfig = currentConfig[serverName];
            if (!serverInConfig) return null;
            if (serverInConfig.enabled === false) return null;
            return serverInConfig;
        } catch (e) {
            logger.error('[McpManager] Failed to read config for reconnect decision:', e);
            if (!fallbackConfig || fallbackConfig.enabled === false) return null;
            return fallbackConfig;
        }
    }

    _createTransport(serverConfig) {
        if (serverConfig.type === 'streamable_http') {
            return new StreamableHTTPClientTransport(new URL(serverConfig.url));
        }
        if (serverConfig.type === 'sse') {
            return new SSEClientTransport(new URL(serverConfig.url));
        }
        return new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: { ...process.env, ...(serverConfig.env || {}) }
        });
    }

    _cleanupServerArtifacts(serverName) {
        if (this.clients.has(serverName)) {
            this.clients.delete(serverName);
        }

        for (const [key, value] of this.toolsMap.entries()) {
            if (value.serverName === serverName) {
                this.toolsMap.delete(key);
            }
        }
    }

    _cacheToolsForServer(serverName, tools = []) {
        for (const tool of tools) {
            const uniqueToolName = `${serverName}__${tool.name}`;
            this.toolsMap.set(uniqueToolName, {
                serverName,
                originalName: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            });
        }
    }

    async init() {
        this._startupStartedAt = Date.now();
        if (!fs.existsSync(this.configPath)) {
            logger.info('[McpManager] No config file found, skipping initialization.');
            return;
        }

        try {
            const config = this._loadConfigFromDisk();
            this._lastWorkingConfig = config;  // Save initial config for rollback

            for (const [serverName, serverConfig] of Object.entries(config)) {
                if (serverName === '_version') continue;  // Skip version field
                if (serverConfig.enabled === false) continue;
                this.connectToServer(serverName, serverConfig).catch(error => {
                    logger.error(`[McpManager] Unexpected connect error for ${serverName}:`, error);
                });
            }
        } catch (e) {
            logger.error('[McpManager] Failed to load config:', e);
        }
    }

    async connectToServer(serverName, serverConfig) {
        const state = this._getServerState(serverName);
        let client = null;

        if (state.connecting) {
            logger.info(`[McpManager] Connection already in progress for ${serverName}, skipping duplicate attempt`);
            return;
        }

        this._clearRetryTimer(serverName);
        state.connecting = true;
        state.generation += 1;
        const currentGeneration = state.generation;
        const attempt = state.retryCount + 1;

        try {
            logger.info(`[McpManager] Connecting to ${serverName}... (Attempt ${attempt})`);
            const transport = this._createTransport(serverConfig);

            transport.onerror = (error) => {
                logger.error(`[McpManager] Transport error for ${serverName}:`, error);
                this.handleDisconnect(serverName, serverConfig, {
                    source: 'transport_error',
                    generation: currentGeneration
                }).catch(handleError => {
                    logger.error(`[McpManager] Failed to handle transport error for ${serverName}:`, handleError);
                });
            };

            transport.onclose = () => {
                logger.warn(`[McpManager] Transport closed for ${serverName}`);
                this.handleDisconnect(serverName, serverConfig, {
                    source: 'transport_close',
                    generation: currentGeneration
                }).catch(handleError => {
                    logger.error(`[McpManager] Failed to handle transport close for ${serverName}:`, handleError);
                });
            };

            client = new Client({
                name: "NapCat-Bot",
                version: "1.0.0",
            }, {
                capabilities: {
                    tools: {},
                }
            });

            await client.connect(transport);
            if (this._isReloading || this._getServerState(serverName).generation !== currentGeneration) {
                try {
                    await client.close();
                } catch (_) {
                    // no-op
                }
                state.connecting = false;
                logger.info(`[McpManager] Discarded stale connection for ${serverName}`);
                return;
            }

            this._cleanupServerArtifacts(serverName);
            this.clients.set(serverName, client);

            const result = await client.listTools();
            if (this._isReloading || this._getServerState(serverName).generation !== currentGeneration) {
                try {
                    await client.close();
                } catch (_) {
                    // no-op
                }
                this._cleanupServerArtifacts(serverName);
                state.connecting = false;
                logger.info(`[McpManager] Discarded stale tool cache for ${serverName}`);
                return;
            }

            this._cacheToolsForServer(serverName, result.tools);
            state.retryCount = 0;
            state.connecting = false;
            state.lastDisconnectAt = 0;
            this._clearRetryTimer(serverName);
            logger.info(`[McpManager] Connected to ${serverName}, loaded ${result.tools.length} tools.`);

        } catch (e) {
            state.connecting = false;
            logger.error(`[McpManager] Failed to connect to ${serverName}:`, e);
            if (client) {
                try {
                    await client.close();
                } catch (closeError) {
                    logger.warn(`[McpManager] Failed to close failed client for ${serverName}:`, closeError);
                }
            }
            await this.handleDisconnect(serverName, serverConfig, {
                source: 'connect_error',
                generation: currentGeneration
            });
        }
    }

    async handleDisconnect(serverName, serverConfig, options = {}) {
        const { generation } = options;
        const state = this._getServerState(serverName);

        if (typeof generation === 'number' && generation !== state.generation) {
            logger.debug(`[McpManager] Ignoring stale disconnect event for ${serverName} (generation ${generation} != ${state.generation})`);
            return;
        }

        const now = Date.now();
        if (state.lastDisconnectAt > 0 && now - state.lastDisconnectAt < this._disconnectDedupMs) {
            logger.debug(`[McpManager] Deduplicated disconnect event for ${serverName}`);
            return;
        }
        state.lastDisconnectAt = now;
        state.connecting = false;

        if (this._isReloading) {
            logger.info(`[McpManager] Skipping reconnect for ${serverName} during reload`);
            return;
        }

        this._cleanupServerArtifacts(serverName);
        const reconnectConfig = this._getReconnectConfig(serverName, serverConfig);
        if (!reconnectConfig) {
            logger.info(`[McpManager] ${serverName} not in config or disabled, skipping reconnect`);
            state.retryCount = 0;
            this._clearRetryTimer(serverName);
            return;
        }

        this._scheduleReconnect(serverName, reconnectConfig);
    }

    _scheduleReconnect(serverName, serverConfig) {
        const state = this._getServerState(serverName);
        if (this._isReloading) return;

        if (state.retryTimer) {
            logger.debug(`[McpManager] Reconnect already scheduled for ${serverName}, skipping duplicate schedule`);
            return;
        }
        if (state.connecting) {
            logger.debug(`[McpManager] ${serverName} is connecting, skipping reconnect schedule`);
            return;
        }

        if (state.retryCount >= this._maxRetries) {
            logger.error(`[McpManager] Max retries reached for ${serverName}. Connection failed.`);
            return;
        }

        state.retryCount += 1;
        const delay = Math.min(
            this._baseRetryDelayMs * (2 ** Math.max(state.retryCount - 1, 0)),
            this._maxRetryDelayMs
        );
        logger.info(`[McpManager] Retrying connection to ${serverName} in ${Math.ceil(delay / 1000)}s...`);

        state.retryTimer = setTimeout(() => {
            state.retryTimer = null;
            this.connectToServer(serverName, serverConfig).catch(error => {
                logger.error(`[McpManager] Reconnect attempt crashed for ${serverName}:`, error);
            });
        }, delay);
    }

    getOpenAITools() {
        const tools = [];
        for (const [uniqueName, info] of this.toolsMap.entries()) {
            tools.push({
                type: 'function',
                function: {
                    name: uniqueName,
                    description: info.description,
                    parameters: info.inputSchema
                }
            });
        }
        return tools;
    }

    async executeTool(name, args) {
        const toolInfo = this.toolsMap.get(name);
        if (!toolInfo) {
            throw new Error(`Tool ${name} not found`);
        }

        const client = this.clients.get(toolInfo.serverName);
        if (!client) {
            throw new Error(`Client for ${toolInfo.serverName} not found`);
        }

        try {
            if (this._startupStartedAt && this._startupDelayMs > 0) {
                const elapsed = Date.now() - this._startupStartedAt;
                const remaining = this._startupDelayMs - elapsed;
                if (remaining > 0) {
                    await new Promise(resolve => setTimeout(resolve, remaining));
                }
            }
            const result = await client.callTool({
                name: toolInfo.originalName,
                arguments: args
            });
            
            // Format result for OpenAI
            // MCP result is { content: [{ type: 'text', text: '...' }] }
            // OpenAI expects a string usually, or we process it.
            // For now, let's join text content.
            const textContent = result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
                
            return textContent;
        } catch (e) {
            logger.error(`[McpManager] Tool execution failed: ${name}`, e);
            throw e;
        }
    }

    // Reload MCP servers with rollback support
    async reload(newConfig) {
        this._isReloading = true;
        const oldClients = new Map(this.clients);  // Backup old connections
        const oldToolsMap = new Map(this.toolsMap);
        const oldServerStates = this._snapshotServerStates();
        this._clearAllRetryTimers();
        const newClients = new Map();
        const newToolsMap = new Map();
        const rollbackReconnectCandidates = [];

        try {
            logger.info('[McpManager] Attempting to reload MCP servers...');

            // 1. Read config if not provided
            const configToLoad = newConfig || this._loadConfigFromDisk();

            // 2. Build new connections (without closing old ones)
            const connectedServers = [];
            const enabledServers = new Set();

            for (const [serverName, serverConfig] of Object.entries(configToLoad)) {
                // Skip version field
                if (serverName === '_version') continue;
                // Skip disabled servers
                if (serverConfig.enabled === false) continue;
                enabledServers.add(serverName);

                const state = this._getServerState(serverName);
                state.connecting = true;
                state.generation += 1;
                const currentGeneration = state.generation;
                let client = null;

                try {
                    const transport = this._createTransport(serverConfig);
                    transport.onerror = (error) => {
                        logger.error(`[McpManager] Transport error for ${serverName}:`, error);
                        this.handleDisconnect(serverName, serverConfig, {
                            source: 'transport_error',
                            generation: currentGeneration
                        }).catch(handleError => {
                            logger.error(`[McpManager] Failed to handle transport error for ${serverName}:`, handleError);
                        });
                    };
                    transport.onclose = () => {
                        logger.warn(`[McpManager] Transport closed for ${serverName}`);
                        this.handleDisconnect(serverName, serverConfig, {
                            source: 'transport_close',
                            generation: currentGeneration
                        }).catch(handleError => {
                            logger.error(`[McpManager] Failed to handle transport close for ${serverName}:`, handleError);
                        });
                    };

                    // Create client
                    client = new Client({
                        name: "NapCat-Bot",
                        version: "1.0.0",
                    }, {
                        capabilities: {
                            tools: {},
                        }
                    });

                    await client.connect(transport);
                    newClients.set(serverName, client);

                    // Cache tools
                    const result = await client.listTools();
                    for (const tool of (result.tools || [])) {
                        const uniqueToolName = `${serverName}__${tool.name}`;
                        newToolsMap.set(uniqueToolName, {
                            serverName,
                            originalName: tool.name,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        });
                    }

                    connectedServers.push(serverName);
                    state.connecting = false;
                    state.retryCount = 0;
                    state.lastDisconnectAt = 0;
                    logger.info(`[McpManager] Connected to ${serverName}, loaded ${result.tools.length} tools.`);

                } catch (error) {
                    state.connecting = false;
                    if (client) {
                        try {
                            await client.close();
                        } catch (closeError) {
                            logger.warn(`[McpManager] Failed to close failed reload client ${serverName}:`, closeError);
                        }
                    }
                    logger.error(`[McpManager] Failed to connect to ${serverName} during reload:`, error);
                    throw new Error(`Failed to connect to server "${serverName}": ${error.message}`);
                }
            }

            // 3. All new connections successful - replace and cleanup old connections
            this.clients = newClients;
            this.toolsMap = newToolsMap;
            this._lastWorkingConfig = configToLoad;

            // Invalidate removed/disabled servers and clear pending retries.
            for (const [name, state] of this._serverStates.entries()) {
                if (enabledServers.has(name)) continue;
                this._clearRetryTimer(name);
                state.connecting = false;
                state.retryCount = 0;
                state.lastDisconnectAt = 0;
                state.generation += 1;
            }

            // Close old connections (non-blocking)
            for (const [name, client] of oldClients) {
                try {
                    await client.close();
                    logger.info(`[McpManager] Closed old connection: ${name}`);
                } catch (e) {
                    logger.warn(`[McpManager] Failed to close old connection ${name}:`, e);
                }
            }

            logger.info(`[McpManager] Successfully reloaded ${connectedServers.length} servers.`);

            return {
                success: true,
                connected: connectedServers,
                oldConfigRetained: false
            };

        } catch (error) {
            logger.error('[McpManager] Failed to reload MCP servers:', error);

            // Rollback: Clean up failed new connections, restore old connections
            logger.warn('[McpManager] Rolling back to previous connections...');

            // Close any newly created clients from this reload attempt
            for (const [name, client] of newClients) {
                try {
                    await client.close();
                } catch (e) {
                    logger.warn(`[McpManager] Failed to close failed connection ${name}:`, e);
                }
            }

            // Restore old connections
            this.clients = oldClients;
            this.toolsMap = oldToolsMap;
            this._restoreServerStates(oldServerStates);

            // Restore reconnect chain for previously pending/in-flight reconnect states.
            for (const [name, prevState] of oldServerStates.entries()) {
                if (this.clients.has(name)) continue;
                if (!prevState.hadRetryTimer && !prevState.connecting) continue;

                const fallbackConfig = this._lastWorkingConfig?.[name];
                if (!fallbackConfig || fallbackConfig.enabled === false) continue;
                // `connecting` restored from snapshot may be stale after rollback.
                // Clear it before rescheduling, otherwise `_scheduleReconnect` will skip.
                const state = this._getServerState(name);
                state.connecting = false;
                rollbackReconnectCandidates.push({ name, config: fallbackConfig });
            }

            throw error;  // Re-throw to let API handler know reload failed
        } finally {
            this._isReloading = false;
            for (const { name, config } of rollbackReconnectCandidates) {
                logger.info(`[McpManager] Restoring reconnect schedule for ${name} after reload rollback`);
                this._scheduleReconnect(name, config);
            }
        }
    }

    async cleanup() {
        this._clearAllRetryTimers();
        for (const [name, client] of this.clients.entries()) {
            try {
                await client.close();
                logger.info(`[McpManager] Closed connection to ${name}`);
            } catch (e) {
                logger.error(`[McpManager] Error closing ${name}:`, e);
            }
        }
        this.clients.clear();
        this.toolsMap.clear();
        for (const state of this._serverStates.values()) {
            state.connecting = false;
            state.retryCount = 0;
            state.lastDisconnectAt = 0;
            state.generation += 1;
        }
    }
}

module.exports = new McpManager();
