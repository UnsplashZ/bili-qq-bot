#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { generateReply, generateReplyResult } = require('../../src/services/ai/replyOrchestratorService')

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
        resolveLegacyTools: ({ structuredSelectedContext, responseMode }) => {
            calls.push(`resolveLegacyTools:${structuredSelectedContext ? 'selected' : 'none'}:${responseMode?.mode || 'answer_only'}`)
            const toolsAllowed = !structuredSelectedContext || responseMode?.mode === 'action_ready'
            return {
                toolsAllowed,
                visibilityContext: {
                    groupId: '1065812436',
                    traceId: 'trace-1',
                    allowLocalTools: false,
                    allowMcpTools: true,
                    clientSurface: 'legacy_reply_runtime',
                    legacyStructuredContext: structuredSelectedContext ? 'selected' : 'none',
                    legacyResponseMode: responseMode?.mode || 'answer_only'
                },
                tools: toolsAllowed
                    ? [{ type: 'function', function: { name: 'helper_selected_tool', parameters: { type: 'object', properties: {} } } }]
                    : []
            }
        },
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
    let capturedToolExecutionContext = null
    const reply = await generateReply({
        message: '我是谁',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async ({ tools, messages, toolExecutionContext }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                capturedMessages = messages
                capturedToolExecutionContext = toolExecutionContext
                return { reply: '你是张三。', hasToolResult: false }
            }
        }
    })

    assert.strictEqual(reply, '你是张三。')
    assert.strictEqual(Array.isArray(capturedTools), true)
    assert.strictEqual(capturedTools.length, 1)
    assert.strictEqual(capturedTools[0].function.name, 'helper_selected_tool')
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])
    assert.deepStrictEqual(capturedToolExecutionContext, {
        groupId: '1065812436',
        traceId: 'trace-1',
        allowLocalTools: false,
        allowMcpTools: true,
        clientSurface: 'legacy_reply_runtime',
        legacyStructuredContext: 'none',
        legacyResponseMode: 'answer_only'
    })
    assert.deepStrictEqual(calls, ['detectIntent', 'collectAugments', 'assemblePrompt', 'resolveLegacyTools:none:answer_only', 'timeout:1', 'log:timeout-ready', 'runChatLoop', 'guard', 'persist', 'log:reply-ready'])

    calls.length = 0
    const structuredResult = await generateReplyResult({
        message: '帮我查一下',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1.1',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async () => {
                calls.push('runChatLoop')
                return {
                    reply: '查到了。',
                    hasToolResult: true,
                    steps: [
                        { type: 'llm_request', loop: 1, toolCount: 1 },
                        { type: 'tool_done', functionName: 'kick_user' },
                        { type: 'reply_ready', hasToolResult: true }
                    ],
                    rawMessages: [{
                        role: 'assistant',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'kick_user',
                                arguments: '{"user_id":"2"}'
                            }
                        }]
                    }]
                }
            }
        }
    })

    assert.strictEqual(structuredResult.finalReply, '查到了。')
    assert.strictEqual(structuredResult.hasToolResult, true)
    assert.ok(structuredResult.steps.some(step => step.type === 'tool_done' && step.functionName === 'kick_user'))
    assert.deepStrictEqual(structuredResult.toolCalls, [{
        id: 'call_1',
        type: 'function',
        functionName: 'kick_user',
        arguments: '{"user_id":"2"}'
    }])

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
    assert.ok(calls.includes('resolveLegacyTools:selected:confirm_needed'))

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
    assert.strictEqual(capturedTools[0].function.name, 'helper_selected_tool')
    assert.deepStrictEqual(capturedMessages, [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])

    calls.length = 0
    capturedTools = null
    capturedToolExecutionContext = null
    const v2Reply = await generateReply({
        message: '那就处理一下吧',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1.7',
        pipelineInput: {
            selectedContext: {
                currentTurn: { role: 'user', content: '那就处理一下吧', speakerId: '2402855757', speakerName: '张三', timestamp: Date.now() },
                threadMessages: [],
                backgroundSummary: ''
            },
            responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] },
            replyPath: 'agent_v2',
            agentContextShape: {
                tools: {
                    visibilityContext: {
                        groupId: '1065812436',
                        traceId: 'trace-1.7',
                        allowLocalTools: false,
                        allowMcpTools: true,
                        clientSurface: 'agent_reply_runtime_v2'
                    }
                }
            }
        },
        runtime: {
            ...baseRuntime,
            resolveAgentTools: ({ pipelineInput }) => {
                calls.push(`resolveAgentTools:${pipelineInput.replyPath}:${pipelineInput.agentContextShape.tools.visibilityContext.clientSurface}:${pipelineInput.agentContextShape.tools.visibilityContext.allowLocalTools}:${pipelineInput.agentContextShape.tools.visibilityContext.allowMcpTools}`)
                return {
                    toolsAllowed: true,
                    visibilityContext: pipelineInput.agentContextShape.tools.visibilityContext,
                    tools: [
                        { type: 'function', function: { name: 'agent_visible_mcp_tool', parameters: { type: 'object', properties: {} } } }
                    ]
                }
            },
            runChatLoop: async ({ tools, toolExecutionContext }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                capturedToolExecutionContext = toolExecutionContext
                return { reply: 'v2 继续执行。', hasToolResult: false }
            }
        }
    })

    assert.strictEqual(v2Reply, 'v2 继续执行。')
    assert.deepStrictEqual(capturedTools, [
        { type: 'function', function: { name: 'agent_visible_mcp_tool', parameters: { type: 'object', properties: {} } } }
    ])
    assert.deepStrictEqual(capturedToolExecutionContext, {
        groupId: '1065812436',
        traceId: 'trace-1.7',
        allowLocalTools: false,
        allowMcpTools: true,
        clientSurface: 'agent_reply_runtime_v2'
    })
    assert.ok(calls.includes('resolveAgentTools:agent_v2:agent_reply_runtime_v2:false:true'))
    assert.ok(!calls.some(entry => entry === 'resolveLegacyTools:selected:confirm_needed'))

    calls.length = 0
    capturedTools = null
    await generateReply({
        message: '那就处理一下吧',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-1.75',
        pipelineInput: {
            selectedContext: {
                currentTurn: { role: 'user', content: '那就处理一下吧', speakerId: '2402855757', speakerName: '张三', timestamp: Date.now() },
                threadMessages: [],
                backgroundSummary: ''
            },
            responseMode: { mode: 'confirm_needed', reasons: ['ambiguous_action'] },
            replyPath: 'agent_v2'
        },
        runtime: {
            ...baseRuntime,
            listToolsForModel: () => {
                calls.push('listToolsForModel:should_not_run')
                return [{ type: 'function', function: { name: 'unexpected_tool', parameters: { type: 'object', properties: {} } } }]
            },
            runChatLoop: async ({ tools }) => {
                calls.push('runChatLoop')
                capturedTools = tools
                return { reply: '缺少策略时回退 legacy gating。', hasToolResult: false }
            }
        }
    })
    assert.deepStrictEqual(capturedTools, [])
    assert.ok(!calls.includes('listToolsForModel:should_not_run'))
    assert.ok(calls.includes('resolveLegacyTools:selected:confirm_needed'))

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
    assert.deepStrictEqual(calls, ['detectIntent', 'collectAugments', 'assemblePrompt', 'resolveLegacyTools:none:answer_only', 'timeout:1', 'log:timeout-ready', 'runChatLoop'])

    calls.length = 0
    capturedTools = null
    await generateReply({
        message: '兼容旧 runtime',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-2.05',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            resolveLegacyTools: undefined,
            tools: [{ type: 'function', function: { name: 'fallback_runtime_tools', parameters: { type: 'object', properties: {} } } }],
            runChatLoop: async ({ tools }) => {
                capturedTools = tools
                return { reply: '兼容成功。', hasToolResult: false }
            }
        }
    })
    assert.strictEqual(capturedTools[0].function.name, 'fallback_runtime_tools')

    const timeoutResult = await generateReplyResult({
        message: '我是谁',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-2.1',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async () => ({
                reply: '抱歉，AI响应超时。请稍后重试。',
                hasToolResult: false,
                steps: [{ type: 'error', kind: 'api-timeout' }],
                rawMessages: []
            })
        }
    })
    assert.strictEqual(timeoutResult.finalReply, '抱歉，AI响应超时。请稍后重试。')
    assert.deepStrictEqual(timeoutResult.errors, ['api-timeout'])

    const networkResult = await generateReplyResult({
        message: '我是谁',
        userId: '2402855757',
        groupId: '1065812436',
        traceId: 'trace-2.2',
        pipelineInput: null,
        runtime: {
            ...baseRuntime,
            runChatLoop: async () => ({
                reply: null,
                hasToolResult: false,
                steps: [{ type: 'error', kind: 'api-request-failed' }],
                rawMessages: []
            })
        }
    })
    assert.strictEqual(networkResult.finalReply, null)
    assert.deepStrictEqual(networkResult.errors, ['api-request-failed'])
    console.log('✓ generateReply 只依赖 runtime 契约完成编排，并保留 tools gating 与空 reply 不持久化语义')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
