#!/usr/bin/env node
'use strict'

const assert = require('assert')
const axios = require('axios')
const { toolExecutionGuard } = require('../../src/services/ai/toolExecutionGuard')
const { buildReplyRuntime } = require('../../src/services/ai/replyRuntimeService')
const { classifyResponseModeHint } = require('../../src/services/ai/agent/responseModeClassifier')

function run() {
    const runtime = buildReplyRuntime({
        groupId: '1065812436',
        traceId: 'trace-1',
        config: {
            aiChatApiKey: 'test-key',
            aiChatApiUrl: 'http://test.local',
            aiChatModel: 'test-model',
            aiChatSystemPrompt: '你是测试助手',
            aiChatProxy: 'http://127.0.0.1:7890',
            aiChatBaseTimeoutSeconds: 30,
            aiChatToolTimeoutSeconds: 2,
            aiChatMaxTimeoutSeconds: 45,
            getGroupConfig: (_groupId, key) => ({
                aiContextLimit: 20,
                aiTemperature: 0.7,
                aiIdentityRagMode: 'strict',
                aiProfileEnabled: true,
                aiPromptAssemblerEnabled: false,
                aiAdminClaimRequiresTool: true,
                aiStructuredContextEnabled: true,
                aiBusyWindowSeconds: 60,
                aiBusyMessageCount: 4,
                aiMaxRepliesPerWindow: 2,
                aiProbability: 0.5
            })[key],
            getRootAdminQQ: () => '793122294',
            isRagEnabledForGroup: () => true,
            isAiEnabledForGroup: () => true
        },
        globalBot: { selfId: '1099804769' },
        mcpManager: {
            getOpenAITools: () => [{
                type: 'function',
                function: {
                    name: 'mcp.test_lookup',
                    description: 'Test MCP lookup',
                    parameters: { type: 'object', properties: {}, additionalProperties: true }
                }
            }],
            executeTool: async (name, args, requestOptions = {}) => ({
                name,
                args,
                signalAborted: requestOptions.signal?.aborted === true
            })
        },
        aiContextService: { getContext: () => [], addMessageToContext: () => {} },
        vectorMemory: { search: async () => [], addMemory: async () => {} },
        userProfileService: { getActiveProfiles: async () => [] },
        axios,
        toolExecutionGuard,
        logger: () => {}
    })

    assert.strictEqual(runtime.apiKey, 'test-key')
    assert.strictEqual(runtime.coreInstructions.includes('身份与边界'), true)
    assert.strictEqual(runtime.coreInstructions.includes('主人规则'), true)
    assert.strictEqual(runtime.timeInstruction.includes('当前时间'), true)
    assert.strictEqual(runtime.conversationPolicy.includes('群聊策略'), true)
    assert.strictEqual(runtime.proxyConfig.host, '127.0.0.1')
    assert.strictEqual(runtime.promptAssemblerEnabled, false)
    assert.strictEqual(runtime.structuredContextEnabled, true)
    assert.strictEqual(runtime.config.aiChatApiKey, 'test-key')
    assert.strictEqual(typeof runtime.replyGateService.evaluate, 'function')
    assert.strictEqual(typeof runtime.replyGateService.evaluateAdmission, 'function')
    assert.strictEqual(typeof runtime.classifyResponseModeHint, 'function')
    assert.strictEqual(typeof runtime.classifyResponseMode, 'function')
    assert.strictEqual(runtime.classifyResponseModeHint, classifyResponseModeHint)
    assert.strictEqual(runtime.classifyResponseMode, classifyResponseModeHint)
    assert.strictEqual(typeof runtime.selectContext, 'function')
    assert.strictEqual(typeof runtime.generateLegacyReply, 'function')
    assert.strictEqual(typeof runtime.generateLegacyReplyResult, 'function')
    assert.strictEqual(Object.prototype.hasOwnProperty.call(runtime, 'generateAgentReply'), false)
    assert.strictEqual(typeof runtime.generateAgentReplyResult, 'function')
    assert.deepStrictEqual(runtime.buildBotFacts('1065812436', { currentMentionsBot: true, isReplyToBot: false }), {
        botId: '1099804769',
        botName: '',
        botAliases: [],
        ownerId: '793122294',
        currentMentionsBot: true,
        currentReplyToBot: false
    })
    assert.strictEqual(typeof runtime.buildTurnFacts, 'function')
    assert.strictEqual(typeof runtime.persistAssistantReply, 'function')
    assert.strictEqual(typeof runtime.computeDynamicTimeout, 'function')
    assert.strictEqual(typeof runtime.runChatLoop, 'function')
    assert.strictEqual(typeof runtime.buildNonStructuredMessages, 'function')
    assert.strictEqual(typeof runtime.botControl.read, 'function')
    assert.strictEqual(typeof runtime.botControl.write, 'function')
    assert.strictEqual(typeof runtime.toolRegistry.getTool, 'function')
    assert.strictEqual(typeof runtime.listToolsForModel, 'function')
    assert.strictEqual(typeof runtime.resolveLegacyTools, 'function')
    assert.strictEqual(typeof runtime.resolveAgentTools, 'function')
    assert.strictEqual(typeof runtime.executeTool, 'function')
    assert.deepStrictEqual(runtime.tools.map(tool => tool.function.name), ['mcp.test_lookup'])
    assert.deepStrictEqual(runtime.resolveLegacyTools({}).tools.map(tool => tool.function.name), ['mcp.test_lookup'])
    assert.deepStrictEqual(runtime.resolveLegacyTools({
        structuredSelectedContext: { currentTurn: { role: 'user', content: '处理一下' } },
        responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] }
    }), {
        toolsAllowed: false,
        visibilityContext: {
            groupId: '1065812436',
            traceId: 'trace-1',
            allowLocalTools: false,
            allowMcpTools: true,
            clientSurface: 'legacy_reply_runtime',
            legacyStructuredContext: 'selected',
            legacyResponseMode: 'confirm_needed'
        },
        tools: []
    })
    assert.deepStrictEqual(runtime.resolveLegacyTools({
        structuredSelectedContext: { currentTurn: { role: 'user', content: '处理一下' } },
        responseMode: { mode: 'action_ready', reasons: [] }
    }).tools.map(tool => tool.function.name), ['mcp.test_lookup'])
    assert.deepStrictEqual(runtime.resolveAgentTools({
        pipelineInput: {
            agentContextShape: {
                tools: {
                    visibilityContext: {
                        allowLocalTools: true,
                        allowMcpTools: true,
                        clientSurface: 'legacy_reply_runtime'
                    }
                }
            }
        }
    }), {
        toolsAllowed: true,
        visibilityContext: {
            groupId: '1065812436',
            traceId: 'trace-1',
            allowLocalTools: false,
            allowMcpTools: true,
            clientSurface: 'agent_reply_runtime_v2'
        },
        tools: [{
            type: 'function',
            function: {
                name: 'mcp.test_lookup',
                description: 'Test MCP lookup',
                parameters: { type: 'object', properties: {}, additionalProperties: true }
            }
        }]
    })
    assert.deepStrictEqual(runtime.listToolsForModel({ allowLocalTools: true }).map(tool => tool.function.name), [
        'subscription.search_user',
        'subscription.list_current_group',
        'subscription.add_user',
        'subscription.remove_user',
        'context.reset_current_group',
        'config.get_ai_status',
        'config.set_ai_enabled',
        'config.set_rag_enabled',
        'runtime.get_status',
        'mcp.test_lookup'
    ])
    assert.deepStrictEqual(runtime.botControl.listActions(), ['subscription.read', 'subscription.write', 'approval.read', 'approval.write', 'runtime.read', 'config.read', 'config.write', 'context.write'])
    console.log('✓ buildReplyRuntime 会提供完整运行时字段、统一工具注册表、LLM 依赖闭环、proxy wiring 与 bot-control 读写入口')
}

async function verifyUnifiedToolExecution() {
    const runtime = buildReplyRuntime({
        groupId: '1065812436',
        traceId: 'trace-2',
        config: {
            aiChatApiKey: 'test-key',
            aiChatApiUrl: 'http://test.local',
            aiChatModel: 'test-model',
            aiChatSystemPrompt: '你是测试助手',
            getGroupConfig: () => 0,
            getRootAdminQQ: () => '793122294',
            isRagEnabledForGroup: () => true,
            isAiEnabledForGroup: () => true
        },
        globalBot: { selfId: '1099804769' },
        mcpManager: {
            getOpenAITools: () => [{
                type: 'function',
                function: {
                    name: 'mcp.test_lookup',
                    description: 'Test MCP lookup',
                    parameters: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false }
                }
            }],
            executeTool: async (name, args, requestOptions = {}, context = {}) => ({
                name,
                args,
                signalAborted: requestOptions.signal?.aborted === true,
                sawSignal: typeof requestOptions.signal === 'object',
                context
            })
        },
        aiContextService: { getContext: () => [], addMessageToContext: () => {} },
        vectorMemory: { search: async () => [], addMemory: async () => {} },
        userProfileService: { getActiveProfiles: async () => [] },
        axios,
        toolExecutionGuard,
        logger: () => {}
    })

    const result = await runtime.executeTool(
        'mcp.test_lookup',
        { q: 'hello' },
        { signal: new AbortController().signal },
        { legacyStructuredContext: 'selected', legacyResponseMode: 'action_ready' }
    )
    assert.deepStrictEqual(result, {
        name: 'mcp.test_lookup',
        args: { q: 'hello' },
        signalAborted: false,
        sawSignal: true,
        context: {}
    })

    await assert.rejects(
        () => runtime.executeTool('runtime.get_status', {}, {}),
        /not allowed in current context/
    )
}

async function main() {
    run()
    await verifyUnifiedToolExecution()
}

try {
    main().then(() => process.exit(0)).catch(error => {
        console.error(error)
        process.exit(1)
    })
} catch (error) {
    console.error(error)
    process.exit(1)
}
