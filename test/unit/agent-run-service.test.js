#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { runAgent } = require('../../src/services/ai/agentRunService')
const { RUN_STATES } = require('../../src/services/ai/agentTypes')

function assertLocalActionShape(localAction, expected = {}) {
    assert.strictEqual(localAction.type, 'bot_control')
    assert.strictEqual(localAction.kind, 'bot_control')
    assert.strictEqual(localAction.executor, 'local')
    assert.deepStrictEqual(localAction.errors, [])

    if (expected.action !== undefined) {
        assert.strictEqual(localAction.action, expected.action)
    }
    if (expected.status !== undefined) {
        assert.strictEqual(localAction.status, expected.status)
    }
    if (expected.input !== undefined) {
        assert.deepStrictEqual(localAction.input, expected.input)
    }
    if (expected.result !== undefined) {
        assert.deepStrictEqual(localAction.result, expected.result)
    }
    if (expected.confirmation !== undefined) {
        assert.deepStrictEqual(localAction.confirmation, expected.confirmation)
    }
}

async function testAbortWhenNoResponse() {
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => ({
                shouldReply: false,
                triggerLevel: 'none',
                reasons: ['below_threshold']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        }),
        getContext: () => {
            throw new Error('should not build context')
        }
    }

    const result = await runAgent({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: '路过',
            source: 'group',
            messageMeta: { source: 'group' }
        },
        runtime
    })

    assert.strictEqual(result.state, RUN_STATES.ABORTED)
    assert.strictEqual(result.finalReply, null)
    assert.strictEqual(result.steps[0].type, 'decision')
}

async function testChainsDecisionContextPlanAndPrimaryAgentReply() {
    const calls = []
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                calls.push('gate')
                return {
                    shouldReply: true,
                    triggerLevel: 'followup',
                    reasons: ['hit']
                }
            }
        },
        classifyResponseMode: () => {
            calls.push('mode')
            return {
                mode: 'answer_only',
                reasons: ['default']
            }
        },
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: (contextKey) => {
            calls.push(`context:${contextKey}`)
            return [{ role: 'user', content: '你好', speakerId: '2' }]
        },
        selectContext: ({ currentTurn }) => {
            calls.push('select')
            return {
                currentTurn,
                threadMessages: [],
                backgroundSummary: '',
                stats: {}
            }
        },
        detectIdentityIntent: () => {
            calls.push('intent')
            return 'general'
        },
        collectAugments: async () => {
            calls.push('augment')
            return {
                memories: [],
                profileText: ''
            }
        },
        buildBotFacts: () => {
            calls.push('botFacts')
            return { botId: '1' }
        },
        generateAgentReplyResult: async ({ pipelineInput }) => {
            calls.push('agentReplyResult')
            assert.strictEqual(pipelineInput.gateDecision.triggerLevel, 'followup')
            assert.strictEqual(pipelineInput.responseMode.mode, 'answer_only')
            assert.ok(pipelineInput.selectedContext)
            assert.strictEqual(pipelineInput.agentSignals.gate.triggerLevel, 'followup')
            assert.strictEqual(pipelineInput.agentSignals.responseMode.mode, 'answer_only')
            assert.strictEqual(pipelineInput.agentContextShape.message.text, '你好')
            assert.strictEqual(pipelineInput.agentContextShape.actor.groupId, '1000')
            assert.strictEqual(pipelineInput.agentContextShape.tools.visibleCount, 0)
            return { finalReply: '好的' }
        },
        generateLegacyReplyResult: async () => {
            throw new Error('primary v2 path should not use legacy reply result bridge when agent runtime succeeds')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-1',
            groupId: '1000',
            userId: '2',
            rawMessage: '你好',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '好的')
    assert.strictEqual(result.agentPlan.planType, 'tool_assisted_answer')
    assert.deepStrictEqual(result.localActions, [])
    assert.deepStrictEqual(calls, ['gate', 'mode', 'context:1000', 'select', 'intent', 'augment', 'botFacts', 'agentReplyResult'])
}

async function testMergesStructuredLegacyExecutionResult() {
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => ({
                shouldReply: true,
                triggerLevel: 'followup',
                reasons: ['hit']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        }),
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: () => [{ role: 'user', content: '你好', speakerId: '2' }],
        selectContext: ({ currentTurn }) => ({
            currentTurn,
            threadMessages: [],
            backgroundSummary: '',
            stats: {}
        }),
        detectIdentityIntent: () => 'general',
        collectAugments: async () => ({
            memories: [],
            profileText: ''
        }),
        buildBotFacts: () => ({ botId: '1' }),
        generateAgentReplyResult: async () => ({
            finalReply: '好的，已处理。',
            hasToolResult: true,
            steps: [
                { type: 'llm_request', loop: 1, toolCount: 1 },
                { type: 'tool_done', functionName: 'kick_user' },
                { type: 'reply_ready', hasToolResult: true }
            ],
            errors: ['tool-warning'],
            toolCalls: [{ id: 'call_1', functionName: 'kick_user', arguments: '{}' }]
        }),
        generateLegacyReplyResult: async () => {
            throw new Error('should not prefer legacy reply result bridge when primary runtime result exists')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-2',
            groupId: '1000',
            userId: '2',
            rawMessage: '帮我处理一下',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '好的，已处理。')
    assert.strictEqual(result.hasToolResult, true)
    assert.ok(result.steps.some(step => step.type === 'llm_request'))
    assert.ok(result.steps.some(step => step.type === 'tool_done' && step.functionName === 'kick_user'))
    assert.deepStrictEqual(result.errors, ['tool-warning'])
    assert.deepStrictEqual(result.toolCalls, [{ id: 'call_1', functionName: 'kick_user', arguments: '{}' }])
}

async function testFallsBackToLegacyReplyOnlyAfterPrimaryRuntimeHardFailure() {
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => ({
                shouldReply: true,
                triggerLevel: 'followup',
                reasons: ['hit']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        }),
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: () => [{ role: 'user', content: '你好', speakerId: '2' }],
        selectContext: ({ currentTurn }) => ({
            currentTurn,
            threadMessages: [],
            backgroundSummary: '',
            stats: {}
        }),
        detectIdentityIntent: () => 'general',
        collectAugments: async () => ({
            memories: [],
            profileText: ''
        }),
        buildBotFacts: () => ({ botId: '1' }),
        generateAgentReplyResult: async () => {
            throw new Error('runtime_v2_boom')
        },
        generateLegacyReplyResult: async () => ({
            finalReply: 'legacy fallback ok',
            hasToolResult: false,
            steps: [{ type: 'reply_ready', hasToolResult: false }],
            errors: [],
            toolCalls: []
        })
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-2b',
            groupId: '1000',
            userId: '2',
            rawMessage: '帮我处理一下',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.finalReply, 'legacy fallback ok')
    assert.ok(result.steps.some(step => step.type === 'reply_pipeline_fallback' && step.reason === 'runtime_v2_boom'))
}

async function testSupportsLegacyReplyCompatibilityWhenReplyResultSurfaceIsMissing() {
    const calls = []
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => ({
                shouldReply: true,
                triggerLevel: 'followup',
                reasons: ['hit']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        }),
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: () => [{ role: 'user', content: '你好', speakerId: '2' }],
        selectContext: ({ currentTurn }) => ({
            currentTurn,
            threadMessages: [],
            backgroundSummary: '',
            stats: {}
        }),
        detectIdentityIntent: () => 'general',
        collectAugments: async () => ({
            memories: [],
            profileText: ''
        }),
        buildBotFacts: () => ({ botId: '1' }),
        generateLegacyReply: async ({ message, userId, groupId, traceId, pipelineInput }) => {
            calls.push({ message, userId, groupId, traceId, pipelineInput })
            return 'legacy string fallback ok'
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-2c',
            groupId: '1000',
            userId: '2',
            rawMessage: '帮我处理一下',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(calls.length, 1)
    assert.deepStrictEqual(calls[0], {
        message: '帮我处理一下',
        userId: '2',
        groupId: '1000',
        traceId: 'trace-2c',
        pipelineInput: calls[0].pipelineInput
    })
    assert.strictEqual(calls[0].pipelineInput.gateDecision.triggerLevel, 'followup')
    assert.strictEqual(calls[0].pipelineInput.responseMode.mode, 'answer_only')
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, 'legacy string fallback ok')
    assert.strictEqual(result.hasToolResult, false)
    assert.deepStrictEqual(result.errors, [])
    assert.deepStrictEqual(result.toolCalls, [])
}

async function testRunAgentIgnoresLegacyPreferenceFlagAndUsesRuntimeCapabilitySurface() {
    const calls = []
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => ({
                shouldReply: true,
                triggerLevel: 'followup',
                reasons: ['hit']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        }),
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: () => [{ role: 'user', content: '你好', speakerId: '2' }],
        selectContext: ({ currentTurn }) => ({
            currentTurn,
            threadMessages: [],
            backgroundSummary: '',
            stats: {}
        }),
        detectIdentityIntent: () => 'general',
        collectAugments: async () => ({
            memories: [],
            profileText: ''
        }),
        buildBotFacts: () => ({ botId: '1' }),
        generateAgentReplyResult: async () => {
            calls.push('agent')
            return { finalReply: 'agent runtime ok' }
        },
        generateLegacyReplyResult: async () => {
            calls.push('legacy')
            return { finalReply: 'legacy runtime ok' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-2c',
            groupId: '1000',
            userId: '2',
            rawMessage: '帮我处理一下',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.finalReply, 'agent runtime ok')
    assert.deepStrictEqual(calls, ['agent'])
}

async function testStructuredContextResetReturnsPendingConfirmationWithoutLegacyReply() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured action should not classify response mode')
        },
        botControl: {
            write: async (action, input) => {
                assert.strictEqual(action, 'context.write')
                assert.deepStrictEqual(input, { operation: 'reset' })
                return {
                    ok: true,
                    action,
                    namespace: 'context',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-1',
                        state: 'pending',
                        summary: 'reset current group conversation context'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-3',
            groupId: '1000',
            userId: '2',
            rawMessage: 'ignored',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'context.write',
                    input: { operation: 'reset' }
                }
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：reset current group conversation context。')
    assert.strictEqual(result.hasMutation, false)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.localActions.length, 1)
    assertLocalActionShape(result.localActions[0], {
        action: 'context.write',
        status: 'pending_confirmation',
        input: { operation: 'reset' },
        result: {
            ok: true,
            mutation: false,
            data: null
        },
        confirmation: {
            confirmationId: 'confirm-1',
            state: 'pending',
            summary: 'reset current group conversation context',
            createdAt: null,
            required: true
        }
    })
}

async function testStructuredSubscriptionConfirmationExecutesMutation() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured action should not classify response mode')
        },
        botControl: {
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '42',
                    confirmationId: 'confirm-42'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        operation: 'add_user',
                        subscriptionType: 'user',
                        uid: '42'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-4',
            groupId: '1000',
            userId: '2',
            rawMessage: 'ignored',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'add_user',
                        uid: '42',
                        confirmationId: 'confirm-42'
                    }
                }
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已在当前群订阅中添加 UID 42。')
    assert.strictEqual(result.hasMutation, true)
    assert.strictEqual(result.agentPlan.requiresConfirmation, false)
    assert.strictEqual(result.localActions.length, 1)
    assertLocalActionShape(result.localActions[0], {
        action: 'subscription.write',
        status: 'executed',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-42'
        },
        result: {
            ok: true,
            mutation: true,
            data: {
                operation: 'add_user',
                subscriptionType: 'user',
                uid: '42'
            }
        },
        confirmation: {
            confirmationId: 'confirm-42',
            state: 'confirmed',
            summary: null,
            createdAt: null,
            confirmedAt: null,
            required: false
        }
    })
}

async function testRecognizedConfigReadPhraseUsesExistingBotControlPath() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('recognized config phrase should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('recognized config phrase should not classify response mode')
        },
        botControl: {
            read: async (action, input) => {
                assert.strictEqual(action, 'config.read')
                assert.deepStrictEqual(input, { operation: 'get' })
                return {
                    ok: true,
                    action,
                    namespace: 'config',
                    operation: 'read',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        effective: {
                            aiEnabled: true,
                            aiRagEnabled: false
                        }
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-config-read-1',
            groupId: '1000',
            userId: '2',
            rawMessage: '查看AI配置',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isAtBot: true, currentMentionsBot: true }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.finalReply, '当前群 AI 配置如下：\naiEnabled: true\naiRagEnabled: false')
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'config.read',
        status: 'executed',
        input: { operation: 'get' },
        result: {
            ok: true,
            mutation: false,
            data: {
                effective: {
                    aiEnabled: true,
                    aiRagEnabled: false
                }
            }
        },
        confirmation: null
    })
}

async function testRecognizedConfigWritePhraseStillRequiresConfirmation() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('recognized config phrase should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('recognized config phrase should not classify response mode')
        },
        botControl: {
            write: async (action, input) => {
                assert.strictEqual(action, 'config.write')
                assert.deepStrictEqual(input, {
                    operation: 'patch',
                    updates: {
                        aiEnabled: false
                    }
                })
                return {
                    ok: true,
                    action,
                    namespace: 'config',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-config-text-1',
                        state: 'pending',
                        summary: 'update current group AI config: aiEnabled=false'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-config-write-1',
            groupId: '1000',
            userId: '2',
            rawMessage: '关闭AI',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isAtBot: true, currentMentionsBot: true }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：update current group AI config: aiEnabled=false。')
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'config.write',
        status: 'pending_confirmation',
        input: {
            operation: 'patch',
            updates: {
                aiEnabled: false
            }
        },
        result: {
            ok: true,
            mutation: false,
            data: null
        },
        confirmation: {
            confirmationId: 'confirm-config-text-1',
            state: 'pending',
            summary: 'update current group AI config: aiEnabled=false',
            createdAt: null,
            required: true
        }
    })
}

async function testRecognizedResetPhraseUsesExistingBotControlPath() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('recognized bot-control phrase should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('recognized bot-control phrase should not classify response mode')
        },
        botControl: {
            write: async (action, input) => {
                assert.strictEqual(action, 'context.write')
                assert.deepStrictEqual(input, { operation: 'reset' })
                return {
                    ok: true,
                    action,
                    namespace: 'context',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-text-1',
                        state: 'pending',
                        summary: 'reset current group conversation context'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-5',
            groupId: '1000',
            userId: '2',
            rawMessage: '重置上下文',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isReplyToBot: true }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.localActions.length, 1)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：reset current group conversation context。')
    assert.strictEqual(result.finalReply.includes('已'), false)
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'context.write',
        status: 'pending_confirmation',
        input: { operation: 'reset' },
        result: {
            ok: true,
            mutation: false,
            data: null
        },
        confirmation: {
            confirmationId: 'confirm-text-1',
            state: 'pending',
            summary: 'reset current group conversation context',
            createdAt: null,
            required: true
        }
    })
}

async function testPendingConfirmPhraseExecutesSavedSnapshotThroughStructuredPath() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('pending confirmation follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('pending confirmation follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => ({
                confirmationId: 'confirm-followup-1',
                action: 'subscription.write',
                summary: 'add uid 42 to current group subscriptions',
                createdAt: 1234567890,
                snapshot: {
                    action: 'subscription.write',
                    groupId: '1000',
                    input: {
                        operation: 'add_user',
                        uid: '42'
                    }
                }
            }),
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '42',
                    confirmationId: 'confirm-followup-1'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        operation: 'add_user',
                        subscriptionType: 'user',
                        uid: '42'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-6',
            groupId: '1000',
            userId: '2',
            rawMessage: '确认',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isReplyToBot: true }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已在当前群订阅中添加 UID 42。')
    assert.strictEqual(result.hasMutation, true)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.agentPlan.requiresConfirmation, false)
    assert.strictEqual(result.localActions.length, 1)
    assertLocalActionShape(result.localActions[0], {
        action: 'subscription.write',
        status: 'executed',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-followup-1'
        },
        result: {
            ok: true,
            mutation: true,
            data: {
                operation: 'add_user',
                subscriptionType: 'user',
                uid: '42'
            }
        },
        confirmation: {
            confirmationId: 'confirm-followup-1',
            state: 'confirmed',
            summary: 'add uid 42 to current group subscriptions',
            createdAt: 1234567890,
            confirmedAt: null,
            required: false
        }
    })
}

async function testPendingRejectPhraseClearsConfirmationWithoutMutation() {
    let pendingConfirmation = {
        confirmationId: 'confirm-followup-2',
        action: 'context.write',
        snapshot: {
            action: 'context.write',
            groupId: '1000',
            input: {
                operation: 'reset'
            }
        }
    }
    let writeCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('pending rejection follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('pending rejection follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => pendingConfirmation,
            write: async () => {
                writeCalled = true
                throw new Error('reject follow-up should not execute write')
            },
            reject: async (confirmationId) => {
                assert.strictEqual(confirmationId, 'confirm-followup-2')
                const result = {
                    ...pendingConfirmation,
                    state: 'rejected'
                }
                pendingConfirmation = null
                return result
            }
        },
        generateLegacyReplyResult: async () => {
            throw new Error('pending rejection follow-up should not use legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-7',
            groupId: '1000',
            userId: '2',
            rawMessage: '取消',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isReplyToBot: true }
        },
        runtime
    })

    assert.strictEqual(writeCalled, false)
    assert.strictEqual(pendingConfirmation, null)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已取消当前待确认操作。')
    assert.strictEqual(result.hasMutation, false)
    assert.strictEqual(result.localActions.length, 1)
    assertLocalActionShape(result.localActions[0], {
        action: 'confirmation.reject',
        status: 'rejected',
        input: { confirmationId: 'confirm-followup-2' },
        result: {
            ok: true,
            mutation: false,
            data: null
        },
        confirmation: {
            confirmationId: 'confirm-followup-2',
            state: 'rejected',
            summary: null,
            createdAt: null,
            rejectedAt: null,
            required: false
        }
    })
}

async function testDifferentActorCannotConsumePendingConfirmationFollowup() {
    const calls = []
    let writeCalled = false
    let rejectCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                calls.push('gate')
                return {
                    shouldReply: true,
                    triggerLevel: 'mention',
                    reasons: ['hit']
                }
            }
        },
        classifyResponseMode: () => {
            calls.push('mode')
            return {
                mode: 'answer_only',
                reasons: ['default']
            }
        },
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        botControl: {
            getPendingConfirmation: ({ actorUserId } = {}) => {
                calls.push(`pending:${actorUserId || ''}`)
                if (actorUserId !== '2') {
                    return null
                }

                return {
                    confirmationId: 'confirm-followup-actor-a',
                    action: 'subscription.write',
                    snapshot: {
                        action: 'subscription.write',
                        groupId: '1000',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                }
            },
            write: async () => {
                writeCalled = true
                throw new Error('different actor should not execute bot-control write')
            },
            reject: async () => {
                rejectCalled = true
                throw new Error('different actor should not execute bot-control reject')
            }
        },
        getContext: (contextKey) => {
            calls.push(`context:${contextKey}`)
            return [{ role: 'user', content: '确认', speakerId: '3' }]
        },
        selectContext: ({ currentTurn }) => {
            calls.push('select')
            return {
                currentTurn,
                threadMessages: [],
                backgroundSummary: '',
                stats: {}
            }
        },
        detectIdentityIntent: () => {
            calls.push('intent')
            return 'general'
        },
        collectAugments: async () => {
            calls.push('augment')
            return {
                memories: [],
                profileText: ''
            }
        },
        buildBotFacts: () => {
            calls.push('botFacts')
            return { botId: '1' }
        },
        generateLegacyReplyResult: async () => {
            calls.push('legacyReplyResult')
            return '普通聊天回复'
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-7b',
            groupId: '1000',
            userId: '3',
            rawMessage: '确认',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(writeCalled, false)
    assert.strictEqual(rejectCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '普通聊天回复')
    assert.deepStrictEqual(calls, ['pending:3', 'gate', 'mode', 'context:1000', 'select', 'intent', 'augment', 'pending:3', 'botFacts', 'legacyReplyResult'])
}

async function testNoPendingConfirmationKeepsConfirmTextOnNormalChatPath() {
    const calls = []
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                calls.push('gate')
                return {
                    shouldReply: true,
                    triggerLevel: 'mention',
                    reasons: ['hit']
                }
            }
        },
        classifyResponseMode: () => {
            calls.push('mode')
            return {
                mode: 'answer_only',
                reasons: ['default']
            }
        },
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        botControl: {
            getPendingConfirmation: () => null,
            write: async () => {
                throw new Error('normal confirm text without pending should not execute bot-control write')
            },
            reject: async () => {
                throw new Error('normal confirm text without pending should not execute bot-control reject')
            }
        },
        getContext: (contextKey) => {
            calls.push(`context:${contextKey}`)
            return [{ role: 'user', content: '确认', speakerId: '2' }]
        },
        selectContext: ({ currentTurn }) => {
            calls.push('select')
            return {
                currentTurn,
                threadMessages: [],
                backgroundSummary: '',
                stats: {}
            }
        },
        detectIdentityIntent: () => {
            calls.push('intent')
            return 'general'
        },
        collectAugments: async () => {
            calls.push('augment')
            return {
                memories: [],
                profileText: ''
            }
        },
        buildBotFacts: () => {
            calls.push('botFacts')
            return { botId: '1' }
        },
        generateLegacyReplyResult: async () => {
            calls.push('legacyReplyResult')
            return '普通聊天回复'
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-8',
            groupId: '1000',
            userId: '2',
            rawMessage: '确认',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: false,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '普通聊天回复')
    assert.deepStrictEqual(calls, ['gate', 'mode', 'context:1000', 'select', 'intent', 'augment', 'botFacts', 'legacyReplyResult'])
}

async function testExplicitStructuredActionOverridesPendingFollowupPhrase() {
    let rejectCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => ({
                confirmationId: 'confirm-followup-3',
                action: 'subscription.write',
                snapshot: {
                    action: 'subscription.write',
                    groupId: '1000',
                    input: {
                        operation: 'add_user',
                        uid: '42'
                    }
                }
            }),
            write: async (action, input) => {
                assert.strictEqual(action, 'context.write')
                assert.deepStrictEqual(input, { operation: 'reset' })
                return {
                    ok: true,
                    action,
                    namespace: 'context',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-explicit-1',
                        state: 'pending',
                        summary: 'reset current group conversation context'
                    }
                }
            },
            reject: async () => {
                rejectCalled = true
                throw new Error('explicit structured action should not use pending rejection path')
            }
        },
        generateLegacyReplyResult: async () => {
            throw new Error('explicit structured action should not use legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-9',
            groupId: '1000',
            userId: '2',
            rawMessage: '取消',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'context.write',
                    input: { operation: 'reset' }
                }
            }
        },
        runtime
    })

    assert.strictEqual(rejectCalled, false)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：reset current group conversation context。')
    assertLocalActionShape(result.localActions[0], {
        action: 'context.write',
        status: 'pending_confirmation'
    })
}

async function testFuzzySubscribePhraseUsesDeterministicSearchPath() {
    let legacyCalled = false
    let writeCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('recognized fuzzy subscribe phrase should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('recognized fuzzy subscribe phrase should not classify response mode')
        },
        botControl: {
            read: async (action, input) => {
                assert.strictEqual(action, 'subscription.read')
                assert.deepStrictEqual(input, {
                    operation: 'search_user',
                    query: '老番茄',
                    limit: 5
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        operation: 'search_user',
                        query: '老番茄',
                        page: 1,
                        limit: 5,
                        candidates: [
                            {
                                rank: 1,
                                uid: '546195',
                                name: '老番茄',
                                roomId: null,
                                fans: 12345678
                            },
                            {
                                rank: 2,
                                uid: '987654',
                                name: '老番茄切片号',
                                roomId: '112233',
                                fans: 3210
                            }
                        ],
                        counts: {
                            returned: 2,
                            total: 2
                        }
                    }
                }
            },
            write: async () => {
                writeCalled = true
                throw new Error('fuzzy subscribe phrase should not execute write')
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-8',
            groupId: '1000',
            userId: '2',
            rawMessage: '订阅老番茄',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isAtBot: true, currentMentionsBot: true }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(writeCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.hasMutation, false)
    assert.strictEqual(result.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(result.agentPlan.requiresConfirmation, false)
    assert.strictEqual(result.finalReply, '找到 2 个候选：\n1. 老番茄（UID 546195，粉丝 12345678）\n2. 老番茄切片号（UID 987654，直播间 112233，粉丝 3210）\n如需订阅，可直接回复序号（如 1 / 第1个 / 选2），或发送“订阅 UID <uid>”。')
    assert.strictEqual(result.localActions.length, 1)
    assertLocalActionShape(result.localActions[0], {
        action: 'subscription.read',
        status: 'executed',
        input: {
            operation: 'search_user',
            query: '老番茄',
            limit: 5
        },
        result: {
            ok: true,
            mutation: false,
            data: {
                operation: 'search_user',
                query: '老番茄',
                page: 1,
                limit: 5,
                candidates: [
                    {
                        rank: 1,
                        uid: '546195',
                        name: '老番茄',
                        roomId: null,
                        fans: 12345678
                    },
                    {
                        rank: 2,
                        uid: '987654',
                        name: '老番茄切片号',
                        roomId: '112233',
                        fans: 3210
                    }
                ],
                counts: {
                    returned: 2,
                    total: 2
                }
            }
        },
        confirmation: null
    })
}

async function testSearchCandidateSelectionFollowupReusesWriteConfirmationFlow() {
    let legacyCalled = false
    let savedSnapshot = null
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('candidate selection flow should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('candidate selection flow should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => savedSnapshot,
            read: async (action, input) => {
                assert.strictEqual(action, 'subscription.read')
                assert.deepStrictEqual(input, {
                    operation: 'search_user',
                    query: '老番茄',
                    limit: 5
                })
                const result = {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        operation: 'search_user',
                        query: '老番茄',
                        page: 1,
                        limit: 5,
                        candidates: [
                            { rank: 1, uid: '546195', name: '老番茄', roomId: null, fans: 12345678 },
                            { rank: 2, uid: '987654', name: '老番茄切片号', roomId: '112233', fans: 3210 }
                        ],
                        counts: {
                            returned: 2,
                            total: 2
                        }
                    }
                }
                savedSnapshot = {
                    groupId: '1000',
                    actorUserId: '2',
                    botMessageId: 'bot-candidate-1',
                    query: result.data.query,
                    candidates: result.data.candidates,
                    createdAt: 1710000000000,
                    expiresAt: 2710000000000
                }
                return result
            },
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '987654'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-candidate-1',
                        state: 'pending',
                        summary: 'add uid 987654 to current group subscriptions'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const searchResult = await runAgent({
        agentInput: {
            traceId: 'trace-10',
            groupId: '1000',
            userId: '2',
            rawMessage: '订阅老番茄',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isAtBot: true, currentMentionsBot: true }
        },
        runtime
    })

    assert.strictEqual(searchResult.state, RUN_STATES.FINALIZED)
    assert.deepStrictEqual(savedSnapshot, {
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-candidate-1',
        query: '老番茄',
        candidates: [
            { rank: 1, uid: '546195', name: '老番茄', roomId: null, fans: 12345678 },
            { rank: 2, uid: '987654', name: '老番茄切片号', roomId: '112233', fans: 3210 }
        ],
        createdAt: 1710000000000,
        expiresAt: 2710000000000
    })

    const followupResult = await runAgent({
        agentInput: {
            traceId: 'trace-11',
            groupId: '1000',
            userId: '2',
            rawMessage: '2',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-1'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(followupResult.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(followupResult.finalReply, '这个操作需要确认。确认后将执行：add uid 987654 to current group subscriptions。')
    assert.strictEqual(followupResult.agentPlan.planType, 'structured_bot_control')
    assert.strictEqual(followupResult.agentPlan.requiresConfirmation, true)
    assertLocalActionShape(followupResult.localActions[0], {
        action: 'subscription.write',
        status: 'pending_confirmation',
        input: {
            operation: 'add_user',
            uid: '987654'
        },
        result: {
            ok: true,
            mutation: false,
            data: null
        },
        confirmation: {
            confirmationId: 'confirm-candidate-1',
            state: 'pending',
            summary: 'add uid 987654 to current group subscriptions',
            createdAt: null,
            required: true
        }
    })
}

async function testConfirmationFollowupStillBeatsCandidateSelectionAtExecutionTime() {
    let legacyCalled = false
    let writeCalls = 0
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('confirmation follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('confirmation follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => ({
                confirmationId: 'confirm-existing-1',
                action: 'subscription.write',
                summary: 'add uid 42 to current group subscriptions',
                createdAt: 1234567890,
                snapshot: {
                    action: 'subscription.write',
                    groupId: '1000',
                    input: {
                        operation: 'add_user',
                        uid: '42'
                    }
                }
            }),
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                actorUserId: '2',
                botMessageId: 'bot-candidate-2',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' }
                ],
                createdAt: 1710000000000,
                expiresAt: 2710000000000
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            },
            write: async (action, input) => {
                writeCalls += 1
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '42',
                    confirmationId: 'confirm-existing-1'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        operation: 'add_user',
                        subscriptionType: 'user',
                        uid: '42'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-12',
            groupId: '1000',
            userId: '2',
            rawMessage: '确认',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-2'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(writeCalls, 1)
    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已在当前群订阅中添加 UID 42。')
}

async function testInvalidCandidateSelectionFollowupReturnsDeterministicFailureReply() {
    let legacyCalled = false
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('invalid candidate selection follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('invalid candidate selection follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                actorUserId: '2',
                botMessageId: 'bot-candidate-invalid',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' },
                    { rank: 2, uid: '987654', name: '老番茄切片号' }
                ],
                createdAt: 1710000000000,
                expiresAt: 2710000000000
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-12-invalid',
            groupId: '1000',
            userId: '2',
            rawMessage: '第9个',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-invalid'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(clearCalls, 0)
    assert.strictEqual(result.state, RUN_STATES.FAILED)
    assert.strictEqual(result.finalReply, '当前候选列表中没有这个序号或 UID，请回复 1-2 之间的序号，或候选 UID。')
}

async function testExpiredCandidateSelectionFollowupReturnsExpiryReply() {
    let legacyCalled = false
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('expired candidate selection follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('expired candidate selection follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                actorUserId: '2',
                botMessageId: 'bot-candidate-expired',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' }
                ],
                createdAt: 1709990000000,
                expiresAt: 1709999999999
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-12-expired',
            groupId: '1000',
            userId: '2',
            rawMessage: '1',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-expired'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.FAILED)
    assert.strictEqual(result.finalReply, '候选已过期，请重新搜索。')
}

async function testCandidateSelectionClearsSnapshotAfterResolutionIntoConfirmation() {
    let legacyCalled = false
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('candidate selection follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('candidate selection follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                actorUserId: '2',
                botMessageId: 'bot-candidate-clear-1',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' },
                    { rank: 2, uid: '987654', name: '老番茄切片号' }
                ],
                createdAt: 1710000000000,
                expiresAt: 2710000000000
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            },
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '987654'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-candidate-clear-1',
                        state: 'pending',
                        summary: 'add uid 987654 to current group subscriptions'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-12-clear',
            groupId: '1000',
            userId: '2',
            rawMessage: '2',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-clear-1'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：add uid 987654 to current group subscriptions。')
}

async function testCandidateSelectionUsesSavedSnapshotWithoutFreshSearchReinterpretation() {
    let legacyCalled = false
    let readCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('candidate selection follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('candidate selection follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                actorUserId: '2',
                botMessageId: 'bot-candidate-saved-1',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' },
                    { rank: 2, uid: '987654', name: '老番茄切片号' }
                ],
                createdAt: 1710000000000,
                expiresAt: 2710000000000
            }),
            read: async () => {
                readCalled = true
                throw new Error('candidate selection follow-up should not rerun search')
            },
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '546195'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-candidate-2',
                        state: 'pending',
                        summary: 'add uid 546195 to current group subscriptions'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-13',
            groupId: '1000',
            userId: '2',
            rawMessage: '第1个',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-candidate-saved-1'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(readCalled, false)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：add uid 546195 to current group subscriptions。')
}

async function testExactUidSubscribeClearsStaleCandidateSnapshotWhenConfirmationStarts() {
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('exact uid subscribe should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('exact uid subscribe should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' }
                ]
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            },
            write: async (action, input) => {
                assert.strictEqual(action, 'subscription.write')
                assert.deepStrictEqual(input, {
                    operation: 'add_user',
                    uid: '42'
                })
                return {
                    ok: true,
                    action,
                    namespace: 'subscription',
                    operation: 'write',
                    scope: 'current_group',
                    groupId: '1000',
                    confirmationRequired: true,
                    confirmation: {
                        confirmationId: 'confirm-exact-uid-1',
                        state: 'pending',
                        summary: 'add uid 42 to current group subscriptions'
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            throw new Error('exact uid subscribe should not call legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-14',
            groupId: '1000',
            userId: '2',
            rawMessage: '订阅 UID 42',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isAtBot: true, currentMentionsBot: true }
        },
        runtime
    })

    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.WAITING_CONFIRMATION)
    assert.strictEqual(result.finalReply, '这个操作需要确认。确认后将执行：add uid 42 to current group subscriptions。')
}

async function testRejectingPendingSubscriptionClearsStaleCandidateSnapshot() {
    let clearCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('pending reject follow-up should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('pending reject follow-up should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => ({
                confirmationId: 'confirm-existing-reject-1',
                action: 'subscription.write',
                summary: 'add uid 42 to current group subscriptions',
                createdAt: 1234567890,
                snapshot: {
                    action: 'subscription.write',
                    groupId: '1000',
                    input: {
                        operation: 'add_user',
                        uid: '42'
                    }
                }
            }),
            getCandidateSelectionSnapshot: () => ({
                groupId: '1000',
                query: '老番茄',
                candidates: [
                    { rank: 1, uid: '546195', name: '老番茄' }
                ]
            }),
            clearCandidateSelectionSnapshot: () => {
                clearCalls += 1
            },
            reject: async (confirmationId) => {
                assert.strictEqual(confirmationId, 'confirm-existing-reject-1')
                return {
                    ok: true,
                    confirmationId,
                    state: 'rejected',
                    summary: 'add uid 42 to current group subscriptions',
                    createdAt: 1234567890,
                    rejectedAt: 1234567999
                }
            }
        },
        generateLegacyReplyResult: async () => {
            throw new Error('pending reject follow-up should not call legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-15',
            groupId: '1000',
            userId: '2',
            rawMessage: '取消',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group', isReplyToBot: true }
        },
        runtime
    })

    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已取消当前待确认操作。')
    assertLocalActionShape(result.localActions[0], {
        action: 'confirmation.reject',
        status: 'rejected'
    })
}

async function testPrivateApprovalReplyUsesStructuredBotControlPathWithoutMutationOnInvalidTarget() {
    let legacyCalled = false
    const runtime = {
        config: {
            isRootAdmin: (userId) => String(userId) === '10000',
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('approval structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('approval structured action should not classify response mode')
        },
        botControl: {
            write: async (action, input) => {
                assert.strictEqual(action, 'approval.write')
                assert.deepStrictEqual(input, {
                    operation: 'reject',
                    shortId: '',
                    replyMessageId: '2001'
                })
                return {
                    ok: false,
                    action,
                    namespace: 'approval',
                    operation: 'write',
                    scope: 'root_private',
                    groupId: 'private_10000',
                    mutation: false,
                    data: {
                        operation: 'reject',
                        status: 'invalid_reply',
                        resolveMode: 'reply',
                        replyMessageId: '2001',
                        shortId: '',
                        pendingCount: 1,
                        target: null,
                        message: '引用的审批消息不存在、已过期或已处理。',
                        wording: ''
                    }
                }
            }
        },
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-16',
            groupId: 'private_10000',
            userId: '10000',
            rawMessage: '[CQ:reply,id=2001] 否',
            source: 'private',
            contextKey: 'private_10000',
            messageMeta: {
                source: 'private',
                replyToMessageId: '2001'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '引用的审批消息不存在、已过期或已处理。')
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'approval.write',
        status: 'failed',
        input: {
            operation: 'reject',
            shortId: '',
            replyMessageId: '2001'
        },
        result: {
            ok: false,
            mutation: false,
            data: {
                operation: 'reject',
                status: 'invalid_reply',
                resolveMode: 'reply',
                replyMessageId: '2001',
                shortId: '',
                pendingCount: 1,
                target: null,
                message: '引用的审批消息不存在、已过期或已处理。',
                wording: ''
            }
        },
        confirmation: null
    })
}

async function testPrivateApprovalWriteThreadsWsThroughBotControlRuntime() {
    let legacyCalled = false
    const ws = { marker: 'approval-runtime-ws' }
    const requestApprovalService = {
        listPendingApprovals: () => ({ pendingCount: 0, items: [] }),
        handleExactApprovalDecision: async (receivedWs, decisionInput) => {
            assert.strictEqual(receivedWs, ws)
            assert.deepStrictEqual(decisionInput, {
                decision: 'approve',
                shortId: 'REQ-ABCD12',
                replyMessageId: ''
            })

            return {
                ok: true,
                mutation: true,
                status: 'executed',
                shortId: 'REQ-ABCD12',
                replyMessageId: '',
                pendingCount: 0,
                target: {
                    shortId: 'REQ-ABCD12'
                },
                actionResult: {
                    wording: '已处理审批'
                }
            }
        }
    }
    const { createBotControlRuntime } = require('../../src/services/ai/botControl')
    const runtime = {
        config: {
            isRootAdmin: (userId) => String(userId) === '10000',
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('approval structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('approval structured action should not classify response mode')
        },
        botControl: createBotControlRuntime({
            groupId: 'private_10000',
            requestApprovalService,
            confirmationService: {
                createPendingConfirmation: () => {
                    throw new Error('approval.write should not request confirmation')
                },
                getPendingConfirmation: () => null,
                confirm: () => {
                    throw new Error('approval.write should not confirm pending action')
                },
                reject: () => {
                    throw new Error('approval.write should not reject pending action')
                }
            },
            candidateSelectionStateService: {
                getSnapshot: () => null,
                saveSnapshot: () => {},
                clearSnapshot: () => {}
            }
        }),
        generateLegacyReplyResult: async () => {
            legacyCalled = true
            return { finalReply: 'should not happen' }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-approval-ws-1',
            groupId: 'private_10000',
            userId: '10000',
            rawMessage: '同意 REQ-ABCD12',
            source: 'private',
            contextKey: 'private_10000',
            ws,
            messageMeta: {
                source: 'private'
            }
        },
        runtime
    })

    assert.strictEqual(legacyCalled, false)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '已同意审批请求 REQ-ABCD12。剩余待处理：0。接口回执：已处理审批')
    assert.strictEqual(result.hasMutation, true)
    assertLocalActionShape(result.localActions[0], {
        action: 'approval.write',
        status: 'executed',
        input: {
            operation: 'approve',
            shortId: 'REQ-ABCD12',
            replyMessageId: ''
        },
        result: {
            ok: true,
            mutation: true,
            data: {
                operation: 'approve',
                status: 'executed',
                resolveMode: 'short_id',
                shortId: 'REQ-ABCD12',
                replyMessageId: '',
                pendingCount: 0,
                target: {
                    shortId: 'REQ-ABCD12'
                },
                message: '',
                wording: '已处理审批'
            }
        },
        confirmation: null
    })
}

async function testStructuredSubscriptionAddNoOpReturnsTruthfulReply() {
    let addCalls = 0
    const pendingConfirmation = {
        confirmationId: 'confirm-noop-add-1',
        action: 'subscription.write',
        summary: 'add uid 42 to current group subscriptions',
        createdAt: 1710000000000,
        snapshot: {
            action: 'subscription.write',
            groupId: '1000',
            input: {
                operation: 'add_user',
                uid: '42'
            }
        }
    }
    const { createBotControlRuntime } = require('../../src/services/ai/botControl')
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured action should not classify response mode')
        },
        botControl: createBotControlRuntime({
            groupId: '1000',
            subscriptionService: {
                getSubscriptionsByGroup: async (groupId) => {
                    assert.strictEqual(groupId, '1000')
                    return {
                        users: [
                            { uid: '42', name: '测试UP', groupIds: ['1000'] }
                        ],
                        bangumis: []
                    }
                },
                searchUsers: async () => ({ status: 'success', data: { candidates: [], total: 0 } }),
                addUserSubscription: async () => {
                    addCalls += 1
                    throw new Error('already subscribed path should not mutate')
                },
                removeUserSubscription: async () => {
                    throw new Error('should not remove on add noop path')
                }
            },
            confirmationService: {
                createPendingConfirmation: () => {
                    throw new Error('confirmed noop path should not create new confirmation')
                },
                getPendingConfirmation: ({ confirmationId }) => confirmationId === pendingConfirmation.confirmationId ? pendingConfirmation : null,
                confirm: ({ confirmationId }) => {
                    assert.strictEqual(confirmationId, pendingConfirmation.confirmationId)
                    return pendingConfirmation
                },
                reject: () => {
                    throw new Error('confirmed noop path should not reject confirmation')
                }
            },
            candidateSelectionStateService: {
                getSnapshot: () => null,
                saveSnapshot: () => {},
                clearSnapshot: () => {}
            }
        }),
        generateLegacyReplyResult: async () => {
            throw new Error('structured action should not use legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-noop-add-1',
            groupId: '1000',
            userId: '2',
            rawMessage: 'ignored',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'add_user',
                        uid: '42',
                        confirmationId: 'confirm-noop-add-1'
                    }
                }
            }
        },
        runtime
    })

    assert.strictEqual(addCalls, 0)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, 'UID 42 已经在当前群订阅中，无需重复添加。')
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'subscription.write',
        status: 'executed',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-noop-add-1'
        },
        result: {
            ok: true,
            mutation: false,
            data: {
                operation: 'add_user',
                subscriptionType: 'user',
                uid: '42',
                status: 'already_subscribed'
            }
        },
        confirmation: {
            confirmationId: 'confirm-noop-add-1',
            state: 'confirmed',
            summary: 'add uid 42 to current group subscriptions',
            createdAt: 1710000000000,
            confirmedAt: null,
            required: false
        }
    })
}

async function testStructuredSubscriptionRemoveNoOpReturnsTruthfulReply() {
    let removeCalls = 0
    const pendingConfirmation = {
        confirmationId: 'confirm-noop-remove-1',
        action: 'subscription.write',
        summary: 'remove uid 99 from current group subscriptions',
        createdAt: 1710000001000,
        snapshot: {
            action: 'subscription.write',
            groupId: '1000',
            input: {
                operation: 'remove_user',
                uid: '99'
            }
        }
    }
    const { createBotControlRuntime } = require('../../src/services/ai/botControl')
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured action should not classify response mode')
        },
        botControl: createBotControlRuntime({
            groupId: '1000',
            subscriptionService: {
                getSubscriptionsByGroup: async (groupId) => {
                    assert.strictEqual(groupId, '1000')
                    return {
                        users: [
                            { uid: '42', name: '测试UP', groupIds: ['1000'] }
                        ],
                        bangumis: []
                    }
                },
                searchUsers: async () => ({ status: 'success', data: { candidates: [], total: 0 } }),
                addUserSubscription: async () => {
                    throw new Error('should not add on remove noop path')
                },
                removeUserSubscription: async () => {
                    removeCalls += 1
                    throw new Error('not subscribed path should not mutate')
                }
            },
            confirmationService: {
                createPendingConfirmation: () => {
                    throw new Error('confirmed noop path should not create new confirmation')
                },
                getPendingConfirmation: ({ confirmationId }) => confirmationId === pendingConfirmation.confirmationId ? pendingConfirmation : null,
                confirm: ({ confirmationId }) => {
                    assert.strictEqual(confirmationId, pendingConfirmation.confirmationId)
                    return pendingConfirmation
                },
                reject: () => {
                    throw new Error('confirmed noop path should not reject confirmation')
                }
            },
            candidateSelectionStateService: {
                getSnapshot: () => null,
                saveSnapshot: () => {},
                clearSnapshot: () => {}
            }
        }),
        generateLegacyReplyResult: async () => {
            throw new Error('structured action should not use legacy reply')
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-noop-remove-1',
            groupId: '1000',
            userId: '2',
            rawMessage: 'ignored',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'remove_user',
                        uid: '99',
                        confirmationId: 'confirm-noop-remove-1'
                    }
                }
            }
        },
        runtime
    })

    assert.strictEqual(removeCalls, 0)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, 'UID 99 当前不在本群订阅中，无需移除。')
    assert.strictEqual(result.hasMutation, false)
    assertLocalActionShape(result.localActions[0], {
        action: 'subscription.write',
        status: 'executed',
        input: {
            operation: 'remove_user',
            uid: '99',
            confirmationId: 'confirm-noop-remove-1'
        },
        result: {
            ok: true,
            mutation: false,
            data: {
                operation: 'remove_user',
                subscriptionType: 'user',
                uid: '99',
                status: 'not_subscribed'
            }
        },
        confirmation: {
            confirmationId: 'confirm-noop-remove-1',
            state: 'confirmed',
            summary: 'remove uid 99 from current group subscriptions',
            createdAt: 1710000001000,
            confirmedAt: null,
            required: false
        }
    })
}

async function testAdminWriteStructuredActionBlocksNonAdminGroupActor() {
    let writeCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            write: async () => {
                writeCalled = true
                throw new Error('non-admin actor should not reach admin_write runtime')
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-admin-write-blocked',
            groupId: '1000',
            userId: '9',
            rawMessage: '关闭AI',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'config.write',
                    input: {
                        aiEnabled: false
                    }
                }
            }
        },
        runtime
    })

    assert.strictEqual(writeCalled, false)
    assert.strictEqual(result.state, RUN_STATES.BLOCKED)
    assert.strictEqual(result.finalReply, '你没有权限执行当前群管理操作。')
    assert.deepStrictEqual(result.errors, ['permission_denied'])
    assert.strictEqual(result.steps[result.steps.length - 1].permissionClass, 'admin_write')
}

async function testAdminReadStructuredActionFollowsDeclaredPolicy() {
    let allowedReadCalls = 0
    const allowedRuntime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            read: async (action, input) => {
                allowedReadCalls += 1
                assert.strictEqual(action, 'config.read')
                assert.deepStrictEqual(input, { operation: 'get' })
                return {
                    ok: true,
                    action,
                    namespace: 'config',
                    operation: 'read',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        effective: {
                            aiEnabled: true
                        }
                    }
                }
            }
        }
    }

    const allowedResult = await runAgent({
        agentInput: {
            traceId: 'trace-admin-read-allowed',
            groupId: '1000',
            userId: '2',
            rawMessage: '查看AI配置',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'config.read',
                    input: {}
                }
            }
        },
        runtime: allowedRuntime
    })

    assert.strictEqual(allowedReadCalls, 1)
    assert.strictEqual(allowedResult.state, RUN_STATES.FINALIZED)
    assert.strictEqual(allowedResult.localActions[0].action, 'config.read')

    let blockedReadCalled = false
    const blockedResult = await runAgent({
        agentInput: {
            traceId: 'trace-admin-read-blocked',
            groupId: '1000',
            userId: '3',
            rawMessage: '查看AI配置',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'config.read',
                    input: {}
                }
            }
        },
        runtime: {
            config: {
                isRootAdmin: () => false,
                isGroupAdmin: () => false
            },
            replyGateService: allowedRuntime.replyGateService,
            classifyResponseMode: allowedRuntime.classifyResponseMode,
            botControl: {
                read: async () => {
                    blockedReadCalled = true
                    throw new Error('non-admin actor should not reach admin_read runtime')
                }
            }
        }
    })

    assert.strictEqual(blockedReadCalled, false)
    assert.strictEqual(blockedResult.state, RUN_STATES.BLOCKED)
    assert.strictEqual(blockedResult.finalReply, '你没有权限查看当前群管理信息。')
    assert.deepStrictEqual(blockedResult.errors, ['permission_denied'])
    assert.strictEqual(blockedResult.steps[blockedResult.steps.length - 1].permissionClass, 'admin_read')
}

async function testRootPrivateAdminReadStructuredActionBlocksPseudoGroupScope() {
    let readCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => true,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            read: async () => {
                readCalled = true
                throw new Error('root private admin_read action should not reach runtime')
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-root-private-admin-read-blocked',
            groupId: 'private_1',
            userId: '1',
            rawMessage: '查看AI配置',
            source: 'private',
            contextKey: 'private_1',
            messageMeta: { source: 'private' },
            pipelineInput: {
                botControlAction: {
                    action: 'config.read',
                    input: {}
                }
            }
        },
        runtime
    })

    assert.strictEqual(readCalled, false)
    assert.strictEqual(result.state, RUN_STATES.BLOCKED)
    assert.strictEqual(result.finalReply, '你没有权限查看当前群管理信息。')
    assert.deepStrictEqual(result.errors, ['permission_denied'])
    assert.strictEqual(result.steps[result.steps.length - 1].permissionClass, 'admin_read')
}

async function testRootPrivateOnlyStructuredActionStillWorksInRootPrivateScope() {
    let readCalls = 0
    const runtime = {
        config: {
            isRootAdmin: () => true,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            read: async (action, input, context) => {
                readCalls += 1
                assert.strictEqual(action, 'approval.read')
                assert.deepStrictEqual(input, { operation: 'list' })
                assert.strictEqual(context.userId, '1')
                return {
                    ok: true,
                    action,
                    namespace: 'approval',
                    operation: 'read',
                    scope: 'root_private',
                    groupId: 'private_1',
                    data: {
                        operation: 'list',
                        counts: { pending: 0 },
                        items: []
                    }
                }
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-root-private-approval-read-allowed',
            groupId: 'private_1',
            userId: '1',
            rawMessage: '查看审批',
            source: 'private',
            contextKey: 'private_1',
            messageMeta: { source: 'private' },
            pipelineInput: {
                botControlAction: {
                    action: 'approval.read',
                    input: {}
                }
            }
        },
        runtime
    })

    assert.strictEqual(readCalls, 1)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.localActions[0].action, 'approval.read')
}

async function testRootPrivateOnlyStructuredActionBlocksOutsideRootPrivateScope() {
    let readCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => true,
            isGroupAdmin: () => true
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            read: async () => {
                readCalled = true
                throw new Error('group-scope actor should not reach root_private_only runtime')
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-root-private-blocked',
            groupId: '1000',
            userId: '1',
            rawMessage: '查看审批',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'approval.read',
                    input: {}
                }
            }
        },
        runtime
    })

    assert.strictEqual(readCalled, false)
    assert.strictEqual(result.state, RUN_STATES.BLOCKED)
    assert.strictEqual(result.finalReply, '该操作仅允许 Root 在私聊中执行。')
    assert.deepStrictEqual(result.errors, ['root_private_only'])
    assert.strictEqual(result.steps[result.steps.length - 1].permissionClass, 'root_private_only')
}

async function testPublicReadStructuredActionDoesNotUseCoarseAdminGate() {
    let readCalled = false
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        },
        botControl: {
            read: async (action, input) => {
                readCalled = true
                assert.strictEqual(action, 'runtime.read')
                assert.deepStrictEqual(input, {})
                return {
                    ok: true,
                    action,
                    namespace: 'runtime',
                    operation: 'read',
                    scope: 'current_group',
                    groupId: '1000',
                    data: {
                        ai: { enabled: true },
                        context: { messageCount: 0, cached: false, lastAccessAt: null, cacheStats: null },
                        replyGate: {
                            tracked: false,
                            busyWindowSeconds: 0,
                            busyMessageCount: 0,
                            maxRepliesPerWindow: 0,
                            recentMessageCount: 0,
                            recentReplyCount: 0,
                            recentInteractionCount: 0,
                            busy: false,
                            replyLimited: false
                        }
                    }
                }
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-public-read-allowed',
            groupId: '1000',
            userId: '9',
            rawMessage: '查看运行时状态',
            source: 'group',
            contextKey: '1000',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'runtime.read',
                    input: {}
                }
            }
        },
        runtime
    })

    assert.strictEqual(readCalled, true)
    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.localActions[0].action, 'runtime.read')
    assert.strictEqual(result.localActions[0].status, 'executed')
}

async function testOrdinaryChatPathRemainsUnchangedForNonAdminActor() {
    const calls = []
    const runtime = {
        config: {
            isRootAdmin: () => false,
            isGroupAdmin: () => false
        },
        replyGateService: {
            evaluate: () => {
                calls.push('gate')
                return {
                    shouldReply: true,
                    triggerLevel: 'mention',
                    reasons: ['hit']
                }
            }
        },
        classifyResponseMode: () => {
            calls.push('mode')
            return {
                mode: 'answer_only',
                reasons: ['default']
            }
        },
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        getContext: (contextKey) => {
            calls.push(`context:${contextKey}`)
            return [{ role: 'user', content: '你好', speakerId: '9' }]
        },
        selectContext: ({ currentTurn }) => {
            calls.push('select')
            return {
                currentTurn,
                threadMessages: [],
                backgroundSummary: '',
                stats: {}
            }
        },
        detectIdentityIntent: () => {
            calls.push('intent')
            return 'general'
        },
        collectAugments: async () => {
            calls.push('augment')
            return {
                memories: [],
                profileText: ''
            }
        },
        buildBotFacts: () => {
            calls.push('botFacts')
            return { botId: '1' }
        },
        generateLegacyReplyResult: async () => {
            calls.push('legacyReplyResult')
            return '普通聊天回复'
        },
        botControl: {
            read: async () => {
                throw new Error('ordinary chat should not invoke bot-control read')
            },
            write: async () => {
                throw new Error('ordinary chat should not invoke bot-control write')
            }
        }
    }

    const result = await runAgent({
        agentInput: {
            traceId: 'trace-ordinary-chat-permission-b2',
            groupId: '1000',
            userId: '9',
            rawMessage: '今天天气真不错',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                source: 'group',
                currentMentionsBot: true,
                isReplyToBot: false
            }
        },
        runtime
    })

    assert.strictEqual(result.state, RUN_STATES.FINALIZED)
    assert.strictEqual(result.finalReply, '普通聊天回复')
    assert.strictEqual(result.localActions.length, 0)
    assert.deepStrictEqual(calls, ['gate', 'mode', 'context:1000', 'select', 'intent', 'augment', 'botFacts', 'legacyReplyResult'])
}

async function run() {
    await testAbortWhenNoResponse()
    await testChainsDecisionContextPlanAndPrimaryAgentReply()
    await testMergesStructuredLegacyExecutionResult()
    await testFallsBackToLegacyReplyOnlyAfterPrimaryRuntimeHardFailure()
    await testSupportsLegacyReplyCompatibilityWhenReplyResultSurfaceIsMissing()
    await testRunAgentIgnoresLegacyPreferenceFlagAndUsesRuntimeCapabilitySurface()
    await testStructuredContextResetReturnsPendingConfirmationWithoutLegacyReply()
    await testStructuredSubscriptionConfirmationExecutesMutation()
    await testRecognizedConfigReadPhraseUsesExistingBotControlPath()
    await testRecognizedConfigWritePhraseStillRequiresConfirmation()
    await testRecognizedResetPhraseUsesExistingBotControlPath()
    await testPendingConfirmPhraseExecutesSavedSnapshotThroughStructuredPath()
    await testPendingRejectPhraseClearsConfirmationWithoutMutation()
    await testDifferentActorCannotConsumePendingConfirmationFollowup()
    await testNoPendingConfirmationKeepsConfirmTextOnNormalChatPath()
    await testExplicitStructuredActionOverridesPendingFollowupPhrase()
    await testFuzzySubscribePhraseUsesDeterministicSearchPath()
    await testSearchCandidateSelectionFollowupReusesWriteConfirmationFlow()
    await testConfirmationFollowupStillBeatsCandidateSelectionAtExecutionTime()
    await testInvalidCandidateSelectionFollowupReturnsDeterministicFailureReply()
    await testExpiredCandidateSelectionFollowupReturnsExpiryReply()
    await testCandidateSelectionClearsSnapshotAfterResolutionIntoConfirmation()
    await testCandidateSelectionUsesSavedSnapshotWithoutFreshSearchReinterpretation()
    await testExactUidSubscribeClearsStaleCandidateSnapshotWhenConfirmationStarts()
    await testRejectingPendingSubscriptionClearsStaleCandidateSnapshot()
    await testPrivateApprovalReplyUsesStructuredBotControlPathWithoutMutationOnInvalidTarget()
    await testPrivateApprovalWriteThreadsWsThroughBotControlRuntime()
    await testStructuredSubscriptionAddNoOpReturnsTruthfulReply()
    await testStructuredSubscriptionRemoveNoOpReturnsTruthfulReply()
    await testAdminWriteStructuredActionBlocksNonAdminGroupActor()
    await testAdminReadStructuredActionFollowsDeclaredPolicy()
    await testRootPrivateAdminReadStructuredActionBlocksPseudoGroupScope()
    await testRootPrivateOnlyStructuredActionStillWorksInRootPrivateScope()
    await testRootPrivateOnlyStructuredActionBlocksOutsideRootPrivateScope()
    await testPublicReadStructuredActionDoesNotUseCoarseAdminGate()
    await testOrdinaryChatPathRemainsUnchangedForNonAdminActor()
    console.log('✓ agentRunService 会在普通聊天时复用 legacy reply，并让显式 structured action、待确认跟进文本、候选选择跟进、命中文本短语（含最小 AI 配置读写、Root 私聊审批写回 ws、显式 permissionClass 权限边界，以及订阅 no-op 语义）与模糊订阅搜索共用 bot-control 执行路径')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
