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
            confirmationState: 'not_required'
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
    assert.deepStrictEqual(calls, ['getContext:1000', 'selectContext', 'intent:这一句', 'collectAugments', 'botFacts:1000'])
    console.log('✓ agentContextBuilder 会复用 selectContext/augment/runtime botFacts，整理 Phase 1 上下文对象')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
