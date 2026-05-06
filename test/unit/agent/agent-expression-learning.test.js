#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const llmClient = require(path.join(__dirname, '../../../src/agent/runtime/llmClient'))
const expressionStore = require(path.join(__dirname, '../../../src/agent/expression/expressionStore'))
const expressionLearner = require(path.join(__dirname, '../../../src/agent/expression/expressionLearner'))
const { buildReplyerMessages } = require(path.join(__dirname, '../../../src/agent/replyer/replyerPromptBuilder'))

const originalCreateChatCompletion = llmClient.createChatCompletion
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-expression-'))
const expressionFile = path.join(tempDir, 'expressions.json')

function message(index, text) {
    return {
        id: `m${index}`,
        groupId: '1000',
        userId: String(40 + index),
        role: 'user',
        normalizedText: text,
        rawText: text,
        timestamp: 1000 + index
    }
}

async function run() {
    expressionStore.resetForTest(expressionFile)
    expressionLearner.resetForTest()
    const candidates = [
        message(1, '这也太离谱了吧'),
        message(2, '绷不住了'),
        message(3, '这个说法有点逆天'),
        message(4, '先别急，让我想想'),
        message(5, '感觉可以再看看'),
        message(6, '确实有点东西')
    ]

    llmClient.createChatCompletion = async ({ purpose }) => {
        assert.strictEqual(purpose, 'expression_learning')
        return {
            model: 'test-model',
            usage: { total_tokens: 10 },
            content: JSON.stringify({
                expressions: [
                    {
                        situation: '对离谱观点表示惊讶',
                        style: '用很短的吐槽句，不展开说教',
                        sourceMessageIds: ['m1', 'm3'],
                        confidence: 0.8
                    },
                    {
                        situation: '需要降温观察',
                        style: '先说别急，再给一点保留意见',
                        sourceMessageIds: ['m4', 'm5'],
                        confidence: 0.65
                    }
                ]
            })
        }
    }

    const result = await expressionLearner.maybeLearnExpressions({
        agentConfig: {
            decisionMode: 'llm_live',
            participation: { expressionLearningEnabled: true },
            expression: { learningMinMessages: 6, learningMinIntervalMs: 60000 },
            llm: {
                enabled: true,
                provider: 'openai-compatible',
                baseURL: 'https://example.test/v1',
                model: 'test-model',
                apiKeyEnv: 'AGENT_API_KEY',
                timeoutMs: 12000,
                maxTokens: 500
            }
        },
        memoryObservation: { groupState: { recentMessages: candidates } },
        sessionContext: { groupId: '1000', traceScope: 'test:expression' }
    })
    assert.strictEqual(result.status, 'ok')
    assert.strictEqual(result.stored, 2)

    const selected = await expressionStore.selectExpressions({ groupId: '1000', text: '这观点有点离谱', replyMode: 'react', limit: 2 })
    assert.strictEqual(selected.length, 2)
    assert.ok(selected[0].style.includes('短'))

    const replyerMessages = buildReplyerMessages({
        agentConfig: { replyer: { maxReplyChars: 500, maxReactChars: 60 }, social: {} },
        agentMessage: { id: 'm7', userId: '42', normalizedText: '小助手你怎么看', rawText: '小助手你怎么看' },
        memoryObservation: { groupState: { recentMessages: [] }, topicSnapshot: {}, chatPace: {} },
        longTermMemories: [],
        personProfile: { userId: '42', displayNames: ['Tester'], preferences: ['喜欢短回复'] },
        expressionHints: selected,
        llmDecision: { decision: { action: 'reply', replyDraft: '我觉得可以再观察。' } },
        policyDecision: { finalAction: 'reply' }
    })
    const payload = JSON.parse(replyerMessages[1].content)
    assert.strictEqual(payload.expressionHints.length, 2)
    assert.strictEqual(payload.personProfile.preferences[0], '喜欢短回复')

    const adjusted = await expressionStore.adjustExpressionConfidence({ ids: [selected[0].id], delta: -0.2, reason: 'test' })
    assert.strictEqual(adjusted.adjusted, 1)

    console.log('✓ Agent 表达习惯学习与 Replyer 注入正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        llmClient.createChatCompletion = originalCreateChatCompletion
        fs.rmSync(tempDir, { recursive: true, force: true })
    })
