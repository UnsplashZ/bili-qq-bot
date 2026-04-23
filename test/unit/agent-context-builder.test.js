#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { buildAgentContext } = require('../../src/services/ai/agentContextBuilderService')

async function run() {
    const calls = []
    const runtime = {
        contextLimit: 20,
        ragMode: 'strict',
        profileEnabled: true,
        toolContext: {
            allowLocalTools: false,
            allowMcpTools: true,
            clientSurface: 'test_runtime'
        },
        toolRegistry: {
            listToolsForContext: (context) => {
                calls.push('listToolsForContext')
                assert.strictEqual(context.allowLocalTools, false)
                assert.strictEqual(context.allowMcpTools, true)
                return [
                    { name: 'runtime.get_status', source: 'local' },
                    { name: 'mcp.search', source: 'mcp' }
                ]
            },
            getTools: () => [{ name: 'runtime.get_status' }, { name: 'mcp.search' }, { name: 'hidden.tool' }]
        },
        botControl: {
            getPendingConfirmation: ({ actorUserId }) => {
                calls.push(`pendingConfirmation:${actorUserId}`)
                return {
                    confirmationId: 'confirm-1',
                    state: 'pending',
                    action: 'context.write'
                }
            },
            getCandidateSelectionSnapshot: ({ actorUserId }) => {
                calls.push(`pendingSelection:${actorUserId}`)
                return {
                    state: 'pending',
                    query: '老番茄'
                }
            }
        },
        getContext: (contextKey) => {
            calls.push(`getContext:${contextKey}`)
            return [
                { role: 'user', content: '上一句', speakerId: '2' },
                { role: 'user', content: '这一句', speakerId: '2' }
            ]
        },
        selectContext: ({ currentTurn, messageMeta }) => {
            calls.push('selectContext')
            assert.strictEqual(currentTurn.content, '这一句')
            assert.strictEqual(messageMeta.currentMentionsBot, true)
            return {
                currentTurn,
                threadMessages: [{ role: 'user', content: '上一句' }],
                backgroundSummary: '摘要'
            }
        },
        detectIdentityIntent: (text) => {
            calls.push(`intent:${text}`)
            return 'general'
        },
        collectAugments: async (args) => {
            calls.push('collectAugments')
            assert.ok(args.structuredSelectedContext)
            return {
                memories: [{ text: '记忆A' }],
                profileText: '画像B'
            }
        },
        buildBotFacts: (groupId, turnMeta) => {
            calls.push(`botFacts:${groupId}`)
            return {
                groupId,
                currentMentionsBot: turnMeta.currentMentionsBot,
                currentReplyToBot: turnMeta.isReplyToBot
            }
        }
    }

    const result = await buildAgentContext({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: '这一句',
            source: 'group',
            contextKey: '1000',
            messageMeta: {
                currentMentionsBot: true,
                isReplyToBot: false
            }
        },
        agentDecision: {
            permissionFacts: { canManageCurrentGroup: true },
            riskLevel: 'low',
            confirmationState: 'not_required',
            execution: {
                toolPolicy: {
                    allowMcpTools: true,
                    allowBotControl: false
                }
            },
            runtimeSignals: {
                gate: {
                    shouldReply: true,
                    triggerLevel: 'direct',
                    reasons: ['at_bot']
                },
                responseMode: {
                    mode: 'answer_only',
                    reasons: ['question_like']
                },
                executionConstraints: {
                    source: 'group',
                    riskLevel: 'low',
                    confirmationState: 'not_required'
                }
            }
        },
        runtime
    })

    assert.strictEqual(result.contextKey, '1000')
    assert.strictEqual(result.currentTurn.content, '这一句')
    assert.strictEqual(result.selectedContext.backgroundSummary, '摘要')
    assert.deepStrictEqual(result.relevantMemories, [{ text: '记忆A' }])
    assert.strictEqual(result.profileText, '画像B')
    assert.deepStrictEqual(result.permissionFacts, { canManageCurrentGroup: true })
    assert.strictEqual(result.botFacts.currentMentionsBot, true)

    assert.strictEqual(result.message.text, '这一句')
    assert.strictEqual(result.actor.userId, '2')
    assert.strictEqual(result.scope.contextKey, '1000')
    assert.deepStrictEqual(result.permissions, { facts: { canManageCurrentGroup: true } })
    assert.strictEqual(result.history.selectedContext.backgroundSummary, '摘要')
    assert.strictEqual(result.workflows.hasPendingWorkflows, true)
    assert.strictEqual(result.workflows.pendingConfirmation.confirmationId, 'confirm-1')
    assert.strictEqual(result.workflows.pendingSelection.query, '老番茄')
    assert.strictEqual(result.tools.visibleCount, 2)
    assert.strictEqual(result.tools.totalCount, 3)
    assert.deepStrictEqual(result.tools.visibleToolNames, ['runtime.get_status', 'mcp.search'])
    assert.deepStrictEqual(result.tools.visibleSources, ['local', 'mcp'])
    assert.strictEqual(result.runtimeSignals.gate.triggerLevel, 'direct')
    assert.strictEqual(result.runtimeSignals.responseMode.mode, 'answer_only')
    assert.deepStrictEqual(result.executionConstraints, {
        source: 'group',
        riskLevel: 'low',
        confirmationState: 'not_required'
    })
    assert.deepStrictEqual(calls, [
        'getContext:1000',
        'selectContext',
        'intent:这一句',
        'collectAugments',
        'pendingConfirmation:2',
        'pendingSelection:2',
        'listToolsForContext',
        'botFacts:1000'
    ])
    console.log('✓ agentContextBuilder 会产出统一上下文结构，并保留 legacy 字段供现有路径复用')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
