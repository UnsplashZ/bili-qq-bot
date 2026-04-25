#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { buildDecisionMessages, buildSystemPrompt } = require(path.join(__dirname, '../../src/agent/runtime/promptBuilder'))

function run() {
    const prompt = buildSystemPrompt({
        persona: {
            displayName: '测试助手',
            style: '冷静直接',
            boundaries: '不讨论无关八卦'
        }
    })

    assert.ok(prompt.includes('测试助手'))
    assert.ok(prompt.includes('冷静直接'))
    assert.ok(prompt.includes('不讨论无关八卦'))
    assert.ok(prompt.includes('只能输出 tool_plan 意图'))

    const messages = buildDecisionMessages({
        agentConfig: {},
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'msg_2',
            normalizedText: '@Bot 第一个',
            rawText: '[CQ:reply,id=bot_msg_1][CQ:at,qq=999] 第一个',
            mentionsSelf: true,
            hasReply: true,
            aliasMatched: false,
            replyTarget: {
                messageId: 'bot_msg_1',
                userId: '999',
                isBot: true,
                text: '你要第一个还是第二个？'
            },
            sender: { role: 'admin' }
        },
        memoryObservation: {
            groupState: {
                recentMessages: [
                    {
                        role: 'assistant',
                        userId: '999',
                        selfId: '999',
                        id: 'assistant:msg_1',
                        normalizedText: '你要第一个还是第二个？',
                        rawText: '你要第一个还是第二个？',
                        mentionsSelf: false,
                        aliasMatched: false
                    },
                    {
                        role: 'user',
                        userId: '42',
                        id: 'msg_2',
                        normalizedText: '@Bot 第一个',
                        rawText: '[CQ:reply,id=bot_msg_1][CQ:at,qq=999] 第一个',
                        mentionsSelf: true,
                        aliasMatched: false,
                        replyMessageId: 'bot_msg_1',
                        replyTarget: {
                            messageId: 'bot_msg_1',
                            userId: '999',
                            isBot: true,
                            text: '你要第一个还是第二个？'
                        }
                    }
                ]
            },
            topicSnapshot: { topicId: 'topic_1' },
            chatPace: {}
        },
        longTermMemories: [],
        scoreResult: { traits: {}, components: {}, score: 1, reasons: [], penalties: [] },
        ruleDecision: { action: 'short_reply', wouldReply: true, threshold: 0.65 },
        sessionContext: { actor: {} },
        budgetDecision: { allowed: true }
    })
    const payload = JSON.parse(messages[1].content)
    assert.strictEqual(payload.currentMessage.replyTarget.text, '你要第一个还是第二个？')
    assert.strictEqual(payload.currentMessage.replyTarget.isBot, true)
    assert.strictEqual(payload.recentMessages[0].role, 'assistant')
    assert.ok(payload.constraints.some((line) => line.includes('第一个/继续/这个/上面')))

    console.log('✓ Agent prompt persona 注入正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
