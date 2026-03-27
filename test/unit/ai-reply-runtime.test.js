#!/usr/bin/env node
'use strict'

const assert = require('assert')
const axios = require('axios')
const { toolExecutionGuard } = require('../../src/services/ai/toolExecutionGuard')
const { buildReplyRuntime } = require('../../src/services/ai/replyRuntimeService')

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
                aiStructuredContextEnabled: true
            })[key],
            getRootAdminQQ: () => '793122294',
            isRagEnabledForGroup: () => true
        },
        globalBot: { selfId: '1099804769' },
        mcpManager: {
            getOpenAITools: () => [],
            executeTool: async () => ({ content: [{ text: 'ok' }] })
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
    console.log('✓ buildReplyRuntime 会提供完整运行时字段、LLM 依赖闭环与 proxy wiring')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
