const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const logger = require('../utils/logger');

function mcpLog(level, message, fields = {}, scope = 'svc:mcp') {
    logger.logEvent(level, 'MCP', scope, message, fields);
}

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
            mcpLog('error', 'reconnect-config-read-failed', {
                serverName,
                error: logger.getErrorMessage(e)
            });
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
            mcpLog('info', 'init-skipped', {
                reason: 'config_missing'
            });
            return;
        }

        try {
            const config = this._loadConfigFromDisk();
            this._lastWorkingConfig = config;  // Save initial config for rollback

            for (const [serverName, serverConfig] of Object.entries(config)) {
                if (serverName === '_version') continue;  // Skip version field
                if (serverConfig.enabled === false) continue;
                this.connectToServer(serverName, serverConfig).catch(error => {
                    mcpLog('error', 'connect-crashed', {
                        serverName,
                        error: logger.getErrorMessage(error)
                    });
                });
            }
        } catch (e) {
            mcpLog('error', 'init-load-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    async connectToServer(serverName, serverConfig) {
        const state = this._getServerState(serverName);
        let client = null;

        if (state.connecting) {
            mcpLog('debug', 'connect-skipped', {
                serverName,
                reason: 'already_connecting'
            });
            return;
        }

        this._clearRetryTimer(serverName);
        state.connecting = true;
        state.generation += 1;
        const currentGeneration = state.generation;
        const attempt = state.retryCount + 1;

        try {
            mcpLog('info', 'connect-start', {
                serverName,
                attempt
            });
            const transport = this._createTransport(serverConfig);

            transport.onerror = (error) => {
                mcpLog('error', 'transport-error', {
                    serverName,
                    error: logger.getErrorMessage(error)
                });
                this.handleDisconnect(serverName, serverConfig, {
                    source: 'transport_error',
                    generation: currentGeneration
                }).catch(handleError => {
                    mcpLog('error', 'transport-error-handle-failed', {
                        serverName,
                        error: logger.getErrorMessage(handleError)
                    });
                });
            };

            transport.onclose = () => {
                mcpLog('warn', 'transport-closed', {
                    serverName
                });
                this.handleDisconnect(serverName, serverConfig, {
                    source: 'transport_close',
                    generation: currentGeneration
                }).catch(handleError => {
                    mcpLog('error', 'transport-close-handle-failed', {
                        serverName,
                        error: logger.getErrorMessage(handleError)
                    });
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
                mcpLog('debug', 'stale-connection-discarded', {
                    serverName
                });
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
                mcpLog('debug', 'stale-tool-cache-discarded', {
                    serverName
                });
                return;
            }

            this._cacheToolsForServer(serverName, result.tools);
            state.retryCount = 0;
            state.connecting = false;
            state.lastDisconnectAt = 0;
            this._clearRetryTimer(serverName);
            mcpLog('info', 'connect-ok', {
                serverName,
                toolCount: result.tools.length
            });

        } catch (e) {
            state.connecting = false;
            mcpLog('error', 'connect-failed', {
                serverName,
                attempt,
                error: logger.getErrorMessage(e)
            });
            if (client) {
                try {
                    await client.close();
                } catch (closeError) {
                    mcpLog('warn', 'failed-client-close-failed', {
                        serverName,
                        error: logger.getErrorMessage(closeError)
                    });
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
            mcpLog('debug', 'disconnect-ignored', {
                serverName,
                reason: 'stale_generation',
                generation,
                currentGeneration: state.generation
            });
            return;
        }

        const now = Date.now();
        if (state.lastDisconnectAt > 0 && now - state.lastDisconnectAt < this._disconnectDedupMs) {
            mcpLog('debug', 'disconnect-ignored', {
                serverName,
                reason: 'deduplicated'
            });
            return;
        }
        state.lastDisconnectAt = now;
        state.connecting = false;

        if (this._isReloading) {
            mcpLog('info', 'reconnect-skipped', {
                serverName,
                reason: 'reload_in_progress'
            });
            return;
        }

        this._cleanupServerArtifacts(serverName);
        const reconnectConfig = this._getReconnectConfig(serverName, serverConfig);
        if (!reconnectConfig) {
            mcpLog('info', 'reconnect-skipped', {
                serverName,
                reason: 'disabled_or_missing'
            });
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
            mcpLog('debug', 'reconnect-skipped', {
                serverName,
                reason: 'already_scheduled'
            });
            return;
        }
        if (state.connecting) {
            mcpLog('debug', 'reconnect-skipped', {
                serverName,
                reason: 'already_connecting'
            });
            return;
        }

        if (state.retryCount >= this._maxRetries) {
            mcpLog('error', 'reconnect-exhausted', {
                serverName,
                retryCount: state.retryCount
            });
            return;
        }

        state.retryCount += 1;
        const delay = Math.min(
            this._baseRetryDelayMs * (2 ** Math.max(state.retryCount - 1, 0)),
            this._maxRetryDelayMs
        );
        mcpLog('info', 'reconnect-scheduled', {
            serverName,
            delayMs: delay,
            retryCount: state.retryCount
        });

        state.retryTimer = setTimeout(() => {
            state.retryTimer = null;
            this.connectToServer(serverName, serverConfig).catch(error => {
                mcpLog('error', 'reconnect-crashed', {
                    serverName,
                    error: logger.getErrorMessage(error)
                });
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

    async executeTool(name, args, requestOptions = {}) {
        const toolInfo = this.toolsMap.get(name);
        if (!toolInfo) {
            mcpLog('warn', 'tool-missing', {
                toolName: name
            });
            throw new Error(`Tool ${name} not found`);
        }

        const client = this.clients.get(toolInfo.serverName);
        if (!client) {
            mcpLog('warn', 'tool-client-missing', {
                toolName: name,
                serverName: toolInfo.serverName
            });
            throw new Error(`Client for ${toolInfo.serverName} not found`);
        }

        try {
            if (requestOptions.signal && requestOptions.signal.aborted) {
                throw requestOptions.signal.reason || new Error(`Tool ${name} aborted before execution`);
            }

            if (this._startupStartedAt && this._startupDelayMs > 0) {
                const elapsed = Date.now() - this._startupStartedAt;
                const remaining = this._startupDelayMs - elapsed;
                if (remaining > 0) {
                    await new Promise(resolve => setTimeout(resolve, remaining));
                }
            }

            const callParams = {
                name: toolInfo.originalName,
                arguments: args
            };
            const callOptions = {};
            if (requestOptions.signal) {
                callOptions.signal = requestOptions.signal;
            }
            if (Number.isFinite(requestOptions.timeout) && requestOptions.timeout > 0) {
                callOptions.timeout = requestOptions.timeout;
            }

            const result = Object.keys(callOptions).length > 0
                ? await client.callTool(callParams, undefined, callOptions)
                : await client.callTool(callParams);
            
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
            mcpLog('error', 'tool-failed', {
                toolName: name,
                serverName: toolInfo.serverName,
                error: logger.getErrorMessage(e)
            });
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
            mcpLog('info', 'reload-start');

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
                        mcpLog('error', 'transport-error', {
                            serverName,
                            error: logger.getErrorMessage(error)
                        });
                        this.handleDisconnect(serverName, serverConfig, {
                            source: 'transport_error',
                            generation: currentGeneration
                        }).catch(handleError => {
                            mcpLog('error', 'transport-error-handle-failed', {
                                serverName,
                                error: logger.getErrorMessage(handleError)
                            });
                        });
                    };
                    transport.onclose = () => {
                        mcpLog('warn', 'transport-closed', {
                            serverName
                        });
                        this.handleDisconnect(serverName, serverConfig, {
                            source: 'transport_close',
                            generation: currentGeneration
                        }).catch(handleError => {
                            mcpLog('error', 'transport-close-handle-failed', {
                                serverName,
                                error: logger.getErrorMessage(handleError)
                            });
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
                    mcpLog('info', 'reload-connect-ok', {
                        serverName,
                        toolCount: result.tools.length
                    });

                } catch (error) {
                    state.connecting = false;
                    if (client) {
                        try {
                            await client.close();
                        } catch (closeError) {
                            mcpLog('warn', 'reload-client-close-failed', {
                                serverName,
                                error: logger.getErrorMessage(closeError)
                            });
                        }
                    }
                    mcpLog('error', 'reload-connect-failed', {
                        serverName,
                        error: logger.getErrorMessage(error)
                    });
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
                } catch (e) {
                    mcpLog('warn', 'reload-old-client-close-failed', {
                        serverName: name,
                        error: logger.getErrorMessage(e)
                    });
                }
            }

            mcpLog('info', 'reload-complete', {
                connectedCount: connectedServers.length
            });

            return {
                success: true,
                connected: connectedServers,
                oldConfigRetained: false
            };

        } catch (error) {
            mcpLog('error', 'reload-failed', {
                error: logger.getErrorMessage(error)
            });

            // Rollback: Clean up failed new connections, restore old connections
            mcpLog('warn', 'rollback-start');

            // Close any newly created clients from this reload attempt
            for (const [name, client] of newClients) {
                try {
                    await client.close();
                } catch (e) {
                    mcpLog('warn', 'rollback-client-close-failed', {
                        serverName: name,
                        error: logger.getErrorMessage(e)
                    });
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
                mcpLog('info', 'rollback-reconnect-restored', {
                    serverName: name
                });
                this._scheduleReconnect(name, config);
            }
        }
    }

    async cleanup() {
        this._clearAllRetryTimers();
        for (const [name, client] of this.clients.entries()) {
            try {
                await client.close();
                mcpLog('info', 'cleanup-client-closed', {
                    serverName: name
                });
            } catch (e) {
                mcpLog('error', 'cleanup-client-close-failed', {
                    serverName: name,
                    error: logger.getErrorMessage(e)
                });
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
