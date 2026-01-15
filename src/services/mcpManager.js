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
    }

    async init() {
        if (!fs.existsSync(this.configPath)) {
            logger.info('[McpManager] No config file found, skipping initialization.');
            return;
        }

        try {
            const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            
            for (const [serverName, serverConfig] of Object.entries(config)) {
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
