#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { generateReply } = require('../../src/services/ai/replyOrchestratorService')

async function run() {
    const calls = []
    const baseRuntime = {
        apiKey: 'test-key',
        apiUrl: 'http://test.local',
        model: 'test-model',
        systemPromptBase: '你是测试助手',
        coreInstructions: 'core',
        timeInstruction: 'time',
        conversationPolicy: 'policy',
        contextLimit: 20,
        temperature: 0.7,
        ragMode: 'strict',
        profileEnabled: true,
        adminClaimRequiresTool: true,
        baseTimeoutSeconds: 30,
        toolTimeoutSeconds: 2,
        maxTimeoutSeconds: 45,
        promptAssemblerEnabled: true,
        structuredContextEnabled: true,
        tools: [{ type: 'function', function: { name: 'kick_user', parameters: { type: 'object', properties: {} } } }],
        getContext: () => [{ role: 'user', content: '我是谁', speakerId: '2402855757', speakerName: '张三', timestamp: Date.now() }],
        detectIdentityIntent: () => { calls.push('detectIntent'); return 'self_identity' },
        collectAugments: async () => { calls.push('collectAugments'); return { memories: [], profileText: '', ragEnabled: true, hybridSearchOptions: {} } },
        assemblePrompt: () => {
            calls.push('assemblePrompt')
            return { messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }] }
        },
        buildNonStructuredMessages: () => [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }],
        applyAdminActionGuard: (reply) => { calls.push('guard'); return reply },
        persistAssistantReply: async () => { calls.push('persist') },
        buildTurnFacts: () => '[TURN_FACTS]\ncurrent_speaker_id=2402855757\n[/TURN_FACTS]',
        buildBotFacts: () => ({ botId: '1099804769', ownerId: '793122294' }),
        computeDynamicTimeout: ({ toolCount }) => {
            calls.push(`timeout:${toolCount}`)
            return 30000
        },
        log: (_level, message) => {
            calls.push(`log:${message}`)
        }
    }

    let capturedTools = null
    let capturedMessages = null
    const reply = await generateReply({
        message: '我是谁',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async ({ tools, messages }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                capturedMessages = messages
                return { reply: '你是张三。', hasToolResult: false }
            }
        }
    })

    assert.strictEqual(reply, '你是张三。')
    assert.strictEqual(Array.isArray(capturedTools), true)
    assert.strictEqual(capturedTools.length, 1)
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])
    assert.deepStrictEqual(calls, ['detectIntent', 'collectAugments', 'assemblePrompt', 'timeout:1', 'log:timeout-ready', 'runChatLoop', 'guard', 'persist', 'log:reply-ready'])

    calls.length = 0
    capturedTools = null
    capturedMessages = null
    const botFactsRuntime = {
        ...baseRuntime,
        buildBotFacts: () => ({
            botId: '1099804769',
            botName: '测试助手',
            botAliases: ['小助手'],
            ownerId: '793122294',
            currentMentionsBot: true,
            currentReplyToBot: false
        }),
        assemblePrompt: (args) => {
            calls.push('assemblePrompt')
            assert.ok(args.botFacts)
            assert.strictEqual(args.botFacts.botName, '测试助手')
            return { messages: [{ role: 'system', content: `[BOT_FACTS]\nbot_name=${args.botFacts.botName}` }, { role: 'user', content: 'y' }] }
        }
    }

    const gatedReply = await generateReply({
        message: '那就处理一下吧',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1.5',
        pipelineInput: {
            selectedContext: {
                currentTurn: { role: 'user', content: '那就处理一下吧', speakerId: '2402855757', speakerName: '张三', timestamp: Date.now() },
                threadMessages: [],
                backgroundSummary: ''
            },
            responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] }
        },
        runtime: {
            ...botFactsRuntime,
            runChatLoop: async ({ tools, messages }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                capturedMessages = messages
                return { reply: '先确认一下你的具体意思。', hasToolResult: false }
            }
        }
    })

    assert.strictEqual(gatedReply, '先确认一下你的具体意思。')
    assert.deepStrictEqual(capturedTools, [])
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: '[BOT_FACTS]\nbot_name=测试助手' }, { role: 'user', content: 'y' }])
    assert.ok(calls.includes('log:tool-withheld'))

    calls.length = 0
    capturedTools = null
    capturedMessages = null
    const legacyReply = await generateReply({
        message: '那就处理一下吧',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1.6',
        pipelineInput: {
            selectedContext: {
                currentTurn: { role: 'user', content: '那就处理一下吧', speakerId: '2402855757', speakerName: '张三', timestamp: Date.now() },
                threadMessages: [],
                backgroundSummary: ''
            },
            responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] }
        },
        runtime: {
            ...baseRuntime,
            promptAssemblerEnabled: false,
            runChatLoop: async ({ tools, messages }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                capturedMessages = messages
                return { reply: '继续走旧链路。', hasToolResult: false }
            }
        }
    })

    assert.strictEqual(legacyReply, '继续走旧链路。')
    assert.strictEqual(Array.isArray(capturedTools), true)
    assert.strictEqual(capturedTools.length, 1)
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])

    calls.length = 0
    const emptyReply = await generateReply({
        message: '我是谁',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-2',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async ({ messages }) => {
                calls.push('runChatLoop')
                capturedMessages = messages
                return { reply: null, hasToolResult: false }
            }
        }
    })

    assert.strictEqual(emptyReply, null)
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])
    assert.deepStrictEqual(calls, ['detectIntent', 'collectAugments', 'assemblePrompt', 'timeout:1', 'log:timeout-ready', 'runChatLoop'])
    console.log('✓ generateReply 只依赖 runtime 契约完成编排，并保留 tools gating 与空 reply 不持久化语义')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
