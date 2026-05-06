#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const llmClient = require(path.join(__dirname, '../../../src/agent/runtime/llmClient'))
const { runReplyer } = require(path.join(__dirname, '../../../src/agent/replyer/replyerService'))
const { buildReplyerMessages } = require(path.join(__dirname, '../../../src/agent/replyer/replyerPromptBuilder'))

const originalCreateChatCompletion = llmClient.createChatCompletion

async function run() {
    const baseArgs = {
        agentConfig: {
            participation: { replyerEnabled: true },
            replyer: { maxReactChars: 60, maxReplyChars: 500 },
            social: { maxCasualReplyChars: 60 },
            decisionMode: 'llm_live',
            llm: {
                enabled: true,
                provider: 'openai-compatible',
                baseURL: 'https://example.test/v1',
                model: 'test-model',
                apiKeyEnv: 'AGENT_API_KEY',
                timeoutMs: 12000,
                temperature: 0.2,
                maxTokens: 500
            }
        },
        agentMessage: {
            id: 'm1',
            groupId: '1000',
            userId: '42',
            normalizedText: '小助手，你在吗？',
            rawText: '小助手，你在吗？',
            mentionsSelf: true,
            aliasMatched: true,
            replyToSelf: false
        },
        memoryObservation: { groupState: { recentMessages: [] }, topicSnapshot: {}, chatPace: {} },
        longTermMemories: [],
        llmDecision: {
            status: 'ok',
            decision: {
                action: 'reply',
                confidence: 0.9,
                reason: '直接寻址',
                topic: 'bot',
                replyStyle: 'friendly_brief',
                replyDraft: '我在。',
                memoryHints: [],
                toolIntent: null
            }
        },
        policyDecision: {
            accepted: true,
            finalAction: 'reply',
            reason: 'accepted',
            replyDraft: '我在。',
            wouldSend: true
        },
        sessionContext: { traceScope: 'test:replyer', groupId: '1000', userId: '42' }
    }

    let called = false
    llmClient.createChatCompletion = async ({ purpose }) => {
        called = true
        assert.strictEqual(purpose, 'replyer')
        return {
            model: 'test-model',
            usage: { total_tokens: 3 },
            content: JSON.stringify({ text: '在，有事直接说。', quoteTargetMessageId: '', tone: 'casual', confidence: 0.9 })
        }
    }
    const ok = await runReplyer(baseArgs)
    assert.strictEqual(called, true)
    assert.strictEqual(ok.status, 'ok')
    assert.strictEqual(ok.policyDecision.replyDraft, '在，有事直接说。')

    llmClient.createChatCompletion = async () => ({ model: 'test-model', usage: {}, content: '不是 JSON' })
    const fallback = await runReplyer(baseArgs)
    assert.strictEqual(fallback.status, 'fallback')
    assert.strictEqual(fallback.policyDecision.replyDraft, '我在。')

    const skipped = await runReplyer({
        ...baseArgs,
        agentConfig: { ...baseArgs.agentConfig, participation: { replyerEnabled: false } },
        policyDecision: {
            accepted: true,
            finalAction: 'reply',
            reason: 'listen_direct_reply_forced',
            replyDraft: '__replyer_pending__',
            wouldSend: true
        }
    })
    assert.strictEqual(skipped.status, 'skipped')
    assert.strictEqual(skipped.policyDecision.replyDraft, '我在，具体想让我怎么处理？')

    const targetMessages = buildReplyerMessages({
        ...baseArgs,
        memoryObservation: {
            groupState: {
                recentMessages: [
                    { id: 'm-old', userId: '77', normalizedText: '被 planner 选中的目标消息', role: 'user' },
                    { id: 'm1', userId: '42', normalizedText: '当前消息', role: 'user' }
                ]
            },
            topicSnapshot: {},
            chatPace: {}
        },
        llmDecision: {
            ...baseArgs.llmDecision,
            decision: {
                ...baseArgs.llmDecision.decision,
                targetMessageId: 'm-old'
            }
        }
    })
    const targetPayload = JSON.parse(targetMessages[1].content)
    assert.strictEqual(targetPayload.targetMessage.messageId, 'm-old')
    assert.strictEqual(targetPayload.targetMessage.text, '被 planner 选中的目标消息')

    console.log('✓ Agent replyer 二阶段生成正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        llmClient.createChatCompletion = originalCreateChatCompletion
    })
