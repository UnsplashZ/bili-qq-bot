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
        const delayValue = parseInt(process.env.MCP_CALL_DELAY_MS || '10000', 10);
        this._startupDelayMs = Number.isFinite(delayValue) ? Math.max(delayValue, 0) : 0;
    }

    async init() {
        this._startupStartedAt = Date.now();
        if (!fs.existsSync(this.configPath)) {
            logger.info('[McpManager] No config file found, skipping initialization.');
            return;
        }

        try {
            const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            this._lastWorkingConfig = config;  // Save initial config for rollback

            for (const [serverName, serverConfig] of Object.entries(config)) {
                if (serverName === '_version') continue;  // Skip version field
                if (serverConfig.enabled === false) continue;
                this.connectToServer(serverName, serverConfig);
            }
        } catch (e) {
            logger.error('[McpManager] Failed to load config:', e);
        }
    }

    async connectToServer(serverName, serverConfig, retryCount = 0) {
        const MAX_RETRIES = 5;
        const RETRY_DELAY = 5000; // 5 seconds

        try {
            logger.info(`[McpManager] Connecting to ${serverName}... (Attempt ${retryCount + 1})`);
            
            let transport;
            if (serverConfig.type === 'streamable_http') {
                transport = new StreamableHTTPClientTransport(new URL(serverConfig.url));
            } else if (serverConfig.type === 'sse') {
                transport = new SSEClientTransport(new URL(serverConfig.url));
            } else {
                transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args || [],
                    env: { ...process.env, ...(serverConfig.env || {}) }
                });
            }

            // Handle transport errors (e.g. process exit)
            transport.onerror = async (error) => {
                logger.error(`[McpManager] Transport error for ${serverName}:`, error);
                this.handleDisconnect(serverName, serverConfig);
            };
            
            // Handle transport close
            transport.onclose = async () => {
                 logger.warn(`[McpManager] Transport closed for ${serverName}`);
                 this.handleDisconnect(serverName, serverConfig);
            };

            const client = new Client({
                name: "NapCat-Bot",
                version: "1.0.0",
            }, {
                capabilities: {
                    tools: {},
                }
            });

            await client.connect(transport);
            this.clients.set(serverName, client);
            
            // Cache tools
            const result = await client.listTools();
            for (const tool of result.tools) {
                const uniqueToolName = `${serverName}__${tool.name}`;
                this.toolsMap.set(uniqueToolName, {
                    serverName,
                    originalName: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema
                });
            }
            
            logger.info(`[McpManager] Connected to ${serverName}, loaded ${result.tools.length} tools.`);

        } catch (e) {
            logger.error(`[McpManager] Failed to connect to ${serverName}:`, e);
            if (retryCount < MAX_RETRIES) {
                logger.info(`[McpManager] Retrying connection to ${serverName} in ${RETRY_DELAY/1000}s...`);
                setTimeout(() => {
                    this.connectToServer(serverName, serverConfig, retryCount + 1);
                }, RETRY_DELAY);
            } else {
                logger.error(`[McpManager] Max retries reached for ${serverName}. Connection failed.`);
            }
        }
    }

    async handleDisconnect(serverName, serverConfig) {
        // Skip reconnect during reload to avoid race conditions
        if (this._isReloading) {
            logger.info(`[McpManager] Skipping reconnect for ${serverName} during reload`);
            return;
        }

        // Clean up existing client if exists
        if (this.clients.has(serverName)) {
            this.clients.delete(serverName);
        }

        // Remove tools associated with this server
        for (const [key, value] of this.toolsMap.entries()) {
            if (value.serverName === serverName) {
                this.toolsMap.delete(key);
            }
        }

        try {
            const rawConfig = fs.readFileSync(this.configPath, 'utf8');
            const currentConfig = JSON.parse(rawConfig);
            const serverInConfig = currentConfig[serverName];
            if (!serverInConfig) {
                logger.info(`[McpManager] ${serverName} not in config, skipping reconnect`);
                return;
            }
            if (serverInConfig.enabled === false) {
                logger.info(`[McpManager] ${serverName} is disabled, skipping reconnect`);
                return;
            }
        } catch (e) {
            logger.error('[McpManager] Failed to read config for reconnect decision:', e);
        }

        logger.info(`[McpManager] Attempting to reconnect to ${serverName}...`);
        // Start reconnection loop (reset retry count or use a separate logic)
        // Here we start a new connection attempt loop
        setTimeout(() => {
             this.connectToServer(serverName, serverConfig, 0);
        }, 5000);
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
        const newClients = new Map();

        try {
            logger.info('[McpManager] Attempting to reload MCP servers...');

            // 1. Read config if not provided
            const configToLoad = newConfig || JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

            // 2. Build new connections (without closing old ones)
            const newToolsMap = new Map();
            const connectedServers = [];

            for (const [serverName, serverConfig] of Object.entries(configToLoad)) {
                // Skip version field
                if (serverName === '_version') continue;
                // Skip disabled servers
                if (serverConfig.enabled === false) continue;

                try {
                    // Create transport
                    let transport;
                    if (serverConfig.type === 'streamable_http') {
                        transport = new StreamableHTTPClientTransport(new URL(serverConfig.url));
                    } else if (serverConfig.type === 'sse') {
                        transport = new SSEClientTransport(new URL(serverConfig.url));
                    } else {
                        transport = new StdioClientTransport({
                            command: serverConfig.command,
                            args: serverConfig.args || [],
                            env: { ...process.env, ...(serverConfig.env || {}) }
                        });
                    }

                    // Create client
                    const client = new Client({
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
                    for (const tool of result.tools) {
                        const uniqueToolName = `${serverName}__${tool.name}`;
                        newToolsMap.set(uniqueToolName, {
                            serverName,
                            originalName: tool.name,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        });
                    }

                    connectedServers.push(serverName);
                    logger.info(`[McpManager] Connected to ${serverName}, loaded ${result.tools.length} tools.`);

                } catch (error) {
                    logger.error(`[McpManager] Failed to connect to ${serverName} during reload:`, error);
                    throw new Error(`Failed to connect to server "${serverName}": ${error.message}`);
                }
            }

            // 3. All new connections successful - replace and cleanup old connections
            this.clients = newClients;
            this.toolsMap = newToolsMap;
            this._lastWorkingConfig = configToLoad;

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

            throw error;  // Re-throw to let API handler know reload failed
        } finally {
            this._isReloading = false;
        }
    }

    async cleanup() {
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
    }
}

module.exports = new McpManager();
