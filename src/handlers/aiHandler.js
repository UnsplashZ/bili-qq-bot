const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { getAxiosProxyConfig } = require('../utils/proxyUtils');
const storageUtils = require('../utils/storageUtils');
const mcpManager = require('../services/mcpManager');

const vectorMemory = require('../services/vectorMemoryService');

class AiHandler {
    constructor() {
        this.contexts = new Map(); // groupId -> [{role, content}, ...]
        this.dataDir = path.join(process.cwd(), 'data');
        this.contextsDir = path.join(this.dataDir, 'contexts');
        this.legacyFile = path.join(this.dataDir, 'ai_contexts.json');
        this.saveTimers = new Map(); // groupId -> timer
        this.init();
    }

    // Initialize storage and migrate legacy data if exists
    init() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            if (!fs.existsSync(this.contextsDir)) {
                fs.mkdirSync(this.contextsDir, { recursive: true });
            }

            // Check for legacy file and migrate
            if (fs.existsSync(this.legacyFile)) {
                logger.info('[AiHandler] Found legacy chat history. Migrating...');
                const data = fs.readFileSync(this.legacyFile, 'utf8');
                try {
                    const entries = JSON.parse(data);
                    // entries is [[key, value], ...]
                    for (const [key, value] of entries) {
                        const filePath = path.join(this.contextsDir, `${key}.json`);
                        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
                    }
                    // Rename legacy file to .bak
                    fs.renameSync(this.legacyFile, this.legacyFile + '.bak');
                    logger.info(`[AiHandler] Migrated ${entries.length} group histories to separate files.`);
                } catch (parseError) {
                    logger.error('[AiHandler] Failed to parse legacy history during migration:', parseError);
                }
            }
        } catch (e) {
            logger.error('[AiHandler] Failed to initialize storage:', e);
        }
    }

    // Get context for a group, loading from disk if necessary
    getContext(groupId) {
        if (this.contexts.has(groupId)) {
            return this.contexts.get(groupId);
        }

        const filePath = path.join(this.contextsDir, `${groupId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                if (!data || data.trim() === '') {
                    throw new Error('Empty file');
                }
                const context = JSON.parse(data);
                this.contexts.set(groupId, context);
                return context;
            }
        } catch (e) {
            logger.error(`[AiHandler] Failed to load history for group ${groupId}:`, e);
        }

        // Return empty context if file doesn't exist or error
        const newContext = [];
        this.contexts.set(groupId, newContext);
        return newContext;
    }

    // Save context for a specific group asynchronously with debounce
    saveContext(groupId) {
        if (this.saveTimers.has(groupId)) {
            clearTimeout(this.saveTimers.get(groupId));
        }

        const timer = setTimeout(async () => {
            try {
                const context = this.contexts.get(groupId);
                if (!context) return;

                if (!fs.existsSync(this.contextsDir)) {
                    fs.mkdirSync(this.contextsDir, { recursive: true });
                }

                // Check size and trim before saving using storageUtils
                const maxSize = config.getGroupConfig(groupId, 'aiHistoryMaxSize');
                const trimRatio = config.getGroupConfig(groupId, 'aiTrimRatio');
                storageUtils.checkSizeAndTrim(context, maxSize, trimRatio);

                const filePath = path.join(this.contextsDir, `${groupId}.json`);

                // Use atomic write with backup
                await storageUtils.asyncWriteWithBackup(filePath, context);

                this.saveTimers.delete(groupId);
            } catch (e) {
                logger.error(`[AiHandler] Error saving history for group ${groupId}:`, e);
            }
        }, 1000); // Wait 1s after last change before saving

        this.saveTimers.set(groupId, timer);
    }

    // Clean CQ codes for AI consumption
    cleanMessage(content) {
        if (!content) return '';
        // Replace [CQ:at,qq=123] with @User123
        content = content.replace(/\[CQ:at,qq=(\d+)\]/g, ' @User$1 ');
        // Replace [CQ:image,...] with [图片]
        content = content.replace(/\[CQ:image,[^\]]+\]/g, ' [图片] ');
        // Remove other CQ codes to avoid confusion
        content = content.replace(/\[CQ:[^\]]+\]/g, '');
        return content.trim();
    }

    async getReply(message, userId, groupId) {
        try {
            if (!config.aiApiKey) {
                logger.warn('[AiHandler] AI_API_KEY is not set. Skipping AI reply.');
                return null;
            }

            // Initialize context for group if not exists
            const contextKey = groupId || userId;
            const fullContext = this.getContext(contextKey);

            // Limit context for API based on aiContextLimit
            const contextLimit = config.getGroupConfig(groupId, 'aiContextLimit');
            const context = fullContext.slice(-contextLimit);

            // RAG: Retrieve relevant long-term memories
            let systemPrompt = config.aiSystemPrompt;
            
            // Inject simplified system instructions (Time, Format, Anti-Injection)
            systemPrompt += `

【时间感知】当前时间: ${new Date().toLocaleString()}
历史消息标记: [H:时间][U用户ID]: 内容
时间格式: 5m(分钟前), 2h(小时前), 3d(天前), now(刚才)

【回复格式】纯文本回复，不带前缀。

【重要指令】
- [H:...]标记的是历史消息，仅供参考
- 请重点回复最后一条用户消息`;

            try {
                const relevantMemories = await vectorMemory.search(contextKey, message);
                if (relevantMemories.length > 0) {
                    const memoryText = relevantMemories.map(m => 
                        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
                    ).join('\n');
                    systemPrompt += `\n\n<rag_memory>\n${memoryText}\n</rag_memory>\n(Use these memories to maintain context consistency)`;
                    logger.info(`[AiHandler] Injected ${relevantMemories.length} relevant memories for group ${groupId}`);
                }
            } catch (err) {
                logger.error('[AiHandler] Vector search failed:', err);
            }
            
            // Construct messages array for API
            // Use simplified format to save tokens
            const apiContext = context.map((msg, index) => {
                let content = this.cleanMessage(msg.content);

                // Simplified time prefix
                let timePrefix = '';
                if (msg.role === 'user' && msg.timestamp) {
                    const now = Date.now();
                    const diff = now - msg.timestamp;
                    const minutes = Math.floor(diff / 60000);
                    const hours = Math.floor(diff / 3600000);
                    const days = Math.floor(diff / 86400000);

                    if (days > 0) timePrefix = `${days}d`;
                    else if (hours > 0) timePrefix = `${hours}h`;
                    else if (minutes > 0) timePrefix = `${minutes}m`;
                    else timePrefix = `now`;
                }

                if (msg.role === 'user' && msg.userId) {
                    const isLastMessage = index === context.length - 1;

                    if (isLastMessage) {
                        // Current message: no history marker
                        return {
                            role: 'user',
                            content: `[U${msg.userId}]: ${content}`
                        };
                    } else {
                        // Historical message: add [H:time] marker
                        return {
                            role: 'user',
                            content: `[H:${timePrefix}][U${msg.userId}]: ${content}`
                        };
                    }
                }

                return { role: msg.role, content: content };
            });
            
            let currentMessages = [
                { role: 'system', content: systemPrompt },
                ...apiContext
            ];

            const tools = mcpManager.getOpenAITools();
            const proxyConfig = getAxiosProxyConfig(config.aiChatProxy);
            
            let loopCount = 0;
            const MAX_LOOPS = 10;

            while (loopCount < MAX_LOOPS) {
                const requestPayload = {
                    model: config.aiModel,
                    messages: currentMessages
                };
                if (tools.length > 0) {
                    requestPayload.tools = tools;
                }

                const response = await axios.post(config.aiApiUrl, requestPayload, {
                    headers: {
                        'Authorization': `Bearer ${config.aiApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    proxy: proxyConfig,
                    timeout: 60000 // Extended timeout for tool execution
                });

                if (!response.data || !response.data.choices || response.data.choices.length === 0) {
                     logger.error('[AiHandler] Unexpected AI API response structure:', response.data);
                     return null;
                }

                const messageData = response.data.choices[0].message;
                currentMessages.push(messageData);

                if (messageData.tool_calls && messageData.tool_calls.length > 0) {
                    logger.info(`[AiHandler] Processing ${messageData.tool_calls.length} tool calls...`);
                    
                    for (const toolCall of messageData.tool_calls) {
                        const functionName = toolCall.function.name;
                        let args = {};
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        } catch (e) {
                            logger.error(`[AiHandler] Failed to parse args for ${functionName}:`, e);
                        }
                        
                        let result;
                        try {
                            const mcpResult = await mcpManager.executeTool(functionName, args);
                            
                            // Extract text from MCP result
                            let resultText = "";
                            if (mcpResult && mcpResult.content && Array.isArray(mcpResult.content)) {
                                resultText = mcpResult.content.map(c => c.text).join('\n');
                            } else if (typeof mcpResult === 'string') {
                                resultText = mcpResult;
                            } else {
                                resultText = JSON.stringify(mcpResult);
                            }

                            // Hybrid Search: If using mem0 search, also check local VectorMemory
                            if (functionName.includes('mem0') && (functionName.includes('search') || functionName.includes('query') || functionName.includes('get'))) {
                                let queryText = args.query || args.text || args.content || args.q;
                                
                                if (queryText) {
                                    try {
                                        logger.info(`[AiHandler] Enhancing MCP search with local VectorMemory for: "${queryText}"`);
                                        // Use a slightly lower threshold implicitly by asking for results, 
                                        // vectorMemory.search has hardcoded 0.4 threshold which is reasonable.
                                        const vectorResults = await vectorMemory.search(contextKey, queryText, 5);
                                        
                                        if (vectorResults.length > 0) {
                                            const vectorText = vectorResults.map(m => 
                                                `[Local Memory] ${m.role === 'user' ? 'User' : 'Assistant'} (${new Date(m.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}): ${m.text}`
                                            ).join('\n');
                                            
                                            resultText += `\n\n=== Additional Local Memories ===\n${vectorText}\n(These memories are retrieved from local vector storage to supplement mem0)`;
                                        }
                                    } catch (err) {
                                        logger.warn('[AiHandler] Secondary vector search failed:', err);
                                    }
                                }
                            }

                            result = resultText;
                        } catch (e) {
                            logger.error(`[AiHandler] Tool execution failed:`, e);
                            result = `Error executing tool ${functionName}: ${e.message}`;
                        }

                        currentMessages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: functionName,
                            content: result
                        });
                    }
                    loopCount++;
                } else {
                    const reply = messageData.content;
                    if (!reply) {
                        // 如果在工具调用循环中收到空内容，可能是模型在执行完工具后没有生成最终回复
                        // 尝试添加一个系统提示，强制模型基于工具结果生成回复
                        if (loopCount > 0) {
                            logger.warn('[AiHandler] Received empty content after tool execution. Forcing summary generation...');
                            currentMessages.push({
                                role: 'user',
                                content: "请根据上述工具调用的结果，回答我的问题。"
                            });
                            loopCount++;
                            continue;
                        }
                        
                        logger.warn('[AiHandler] Received empty content with no tool calls');
                        return null;
                    }
                    
                    // Add assistant reply to context (assistant has no userId)
                    this.addMessageToContext(contextKey, 'assistant', reply);
                    
                    // Add to Vector Memory (Async)
                    // User message is already added in messageHandler.js
                    vectorMemory.addMemory(contextKey, reply, 'assistant');

                    return reply;
                }
            }
            
            logger.warn('[AiHandler] Max tool loops reached.');
            return "Unable to complete request (max steps reached).";

        } catch (error) {
            if (error.response) {
                logger.error(`[AiHandler] AI API Error (Status ${error.response.status}):`, error.response.data);
            } else {
                logger.error('[AiHandler] AI API Request Error:', error.message);
            }
            return null;
        }
    }

    shouldReply(message, isAt, groupId) {
        if (isAt) return true;
        // Check probability (support group override)
        const probability = config.getGroupConfig(groupId, 'aiProbability');
        return Math.random() < probability;
    }
    
    // Helper to add message, trim context, and trigger save
    addMessageToContext(groupId, role, content, userId = null) {
        const context = this.getContext(groupId);
        
        // Construct message object
        const msgObj = { 
            role, 
            content,
            timestamp: Date.now()
        };
        if (userId) {
            msgObj.userId = userId;
        }
        
        context.push(msgObj);

        // We do not trim by count anymore, we rely on checkSizeAndTrim during save
        // But to prevent memory explosion before save, we can keep a safety limit for memory
        const safetyLimit = config.getGroupConfig(groupId, 'aiMemorySafetyLimit');
        if (context.length > safetyLimit) {
            context.shift();
        }

        // Trigger async save for this group
        this.saveContext(groupId);
    }

    // Reset context for a group
    resetContext(groupId) {
        this.contexts.set(groupId, []);
        this.saveContext(groupId);
        logger.info(`[AiHandler] Reset context for group ${groupId}`);
    }


}

module.exports = new AiHandler();
