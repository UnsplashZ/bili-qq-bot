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
        sessionContext: {
            actor: {},
            conversationSession: {
                sessionId: 'sess_test',
                messageCount: 2,
                participants: ['42', '999'],
                turnsSinceAgentReply: 1
            }
        },
        budgetDecision: { allowed: true }
    })
    const payload = JSON.parse(messages[1].content)
    assert.strictEqual(payload.currentMessage.replyTarget.text, '你要第一个还是第二个？')
    assert.strictEqual(payload.currentMessage.replyTarget.isBot, true)
    assert.strictEqual(payload.recentMessages[0].role, 'assistant')
    assert.ok(payload.recentMessages[0].relevance.includes('assistant_recent'))
    assert.ok(payload.constraints.some((line) => line.includes('第一个/继续/这个/上面')))
    assert.strictEqual(payload.contextPolicy.strategy, 'relevance_window')
    assert.strictEqual(payload.contextPolicy.budget.sourceMessageCount, 2)
    assert.strictEqual(payload.contextPolicy.budget.selectedMessageCount, 2)
    assert.ok(payload.contextPolicy.budget.relevanceCounts.assistant_recent >= 1)
    assert.strictEqual(payload.conversationSession.sessionId, 'sess_test')
    assert.strictEqual(payload.specialistContext.mode, 'general')
    assert.strictEqual(payload.specialistContext.availableToolCount, payload.specialistContext.totalToolCount)

    const longContextMessages = Array.from({ length: 14 }, (_, index) => ({
        role: 'user',
        userId: String(200 + index),
        id: `noise_${index}`,
        normalizedText: `无关闲聊 ${index}`,
        rawText: `无关闲聊 ${index}`,
        timestamp: 1000 + index
    }))
    longContextMessages.unshift({
        role: 'user',
        userId: '77',
        id: 'topic_old_1',
        normalizedText: '前面讨论过番剧订阅规则',
        rawText: '前面讨论过番剧订阅规则',
        timestamp: 500
    })
    longContextMessages.unshift({
        role: 'assistant',
        userId: '999',
        selfId: '999',
        id: 'assistant_old_1',
        normalizedText: '我刚才说第一个方案更稳',
        rawText: '我刚才说第一个方案更稳',
        timestamp: 400
    })
    longContextMessages.push({
        role: 'user',
        userId: '42',
        id: 'msg_current',
        normalizedText: '@Bot 那就按这个来',
        rawText: '@Bot 那就按这个来',
        mentionsSelf: true,
        timestamp: 3000
    })

    const relevanceMessages = buildDecisionMessages({
        agentConfig: {
            shortTerm: {
                promptRecentMessages: 4,
                promptTopicMessages: 4,
                promptAssistantMessages: 2,
                promptMaxMessages: 8,
                promptMaxCharsPerMessage: 220
            }
        },
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'msg_current',
            normalizedText: '@Bot 那就按这个来',
            rawText: '@Bot 那就按这个来',
            mentionsSelf: true,
            hasReply: false,
            aliasMatched: false,
            sender: { role: 'member' }
        },
        memoryObservation: {
            groupState: { recentMessages: longContextMessages },
            topicSnapshot: { topicId: 'topic_1', recentMessageIds: ['topic_old_1', 'msg_current'] },
            chatPace: {}
        },
        longTermMemories: [],
        scoreResult: { traits: {}, components: {}, score: 1, reasons: [], penalties: [] },
        ruleDecision: { action: 'short_reply', wouldReply: true, threshold: 0.65 },
        sessionContext: { actor: {} },
        budgetDecision: { allowed: true }
    })
    const relevancePayload = JSON.parse(relevanceMessages[1].content)
    const oldTopic = relevancePayload.recentMessages.find((message) => message.messageId === 'topic_old_1')
    const oldAssistant = relevancePayload.recentMessages.find((message) => message.messageId === 'assistant_old_1')
    assert.ok(oldTopic, 'should keep older active topic message')
    assert.ok(oldTopic.relevance.includes('topic'))
    assert.ok(oldAssistant, 'should keep older assistant context')
    assert.ok(oldAssistant.relevance.includes('assistant_recent'))
    assert.ok(relevancePayload.recentMessages.length <= 8)
    assert.strictEqual(relevancePayload.contextPolicy.budget.maxMessages, 8)
    assert.strictEqual(relevancePayload.contextPolicy.budget.maxContextChars, 6000)
    assert.strictEqual(relevancePayload.contextPolicy.budget.selectedMessageCount, relevancePayload.recentMessages.length)
    assert.ok(relevancePayload.contextPolicy.budget.droppedMessageCount > 0)

    const largeText = '这是一段很长的上下文噪声，用来模拟群聊里连续刷屏导致 prompt 过大的情况。'.repeat(8)
    const budgetMessages = [
        {
            role: 'assistant',
            userId: '999',
            selfId: '999',
            id: 'assistant_budget_keep',
            normalizedText: `我刚才给过一个关键结论：${largeText}`,
            rawText: `我刚才给过一个关键结论：${largeText}`,
            timestamp: 100
        },
        {
            role: 'user',
            userId: '88',
            id: 'topic_budget_keep',
            normalizedText: `这个话题的关键背景：${largeText}`,
            rawText: `这个话题的关键背景：${largeText}`,
            timestamp: 200
        },
        ...Array.from({ length: 12 }, (_, index) => ({
            role: 'user',
            userId: String(300 + index),
            id: `budget_noise_${index}`,
            normalizedText: `普通噪声 ${index} ${largeText}`,
            rawText: `普通噪声 ${index} ${largeText}`,
            timestamp: 300 + index
        })),
        {
            role: 'user',
            userId: '42',
            id: 'budget_current',
            normalizedText: '@Bot 继续刚才那个',
            rawText: '@Bot 继续刚才那个',
            mentionsSelf: true,
            timestamp: 1000
        }
    ]
    const budgetMessagesResult = buildDecisionMessages({
        agentConfig: {
            shortTerm: {
                promptRecentMessages: 12,
                promptTopicMessages: 4,
                promptAssistantMessages: 2,
                promptMaxMessages: 10,
                promptMaxCharsPerMessage: 160,
                promptMaxContextChars: 500
            }
        },
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'budget_current',
            normalizedText: '@Bot 继续刚才那个',
            rawText: '@Bot 继续刚才那个',
            mentionsSelf: true,
            hasReply: false,
            aliasMatched: false,
            sender: { role: 'member' }
        },
        memoryObservation: {
            groupState: { recentMessages: budgetMessages },
            topicSnapshot: { topicId: 'topic_budget', recentMessageIds: ['topic_budget_keep', 'budget_current'] },
            chatPace: {}
        },
        longTermMemories: [],
        scoreResult: { traits: {}, components: {}, score: 1, reasons: [], penalties: [] },
        ruleDecision: { action: 'short_reply', wouldReply: true, threshold: 0.65 },
        sessionContext: { actor: {} },
        budgetDecision: { allowed: true }
    })
    const budgetPayload = JSON.parse(budgetMessagesResult[1].content)
    assert.strictEqual(budgetPayload.contextPolicy.budget.charBudgetExceeded, true)
    assert.ok(budgetPayload.contextPolicy.budget.droppedByBudgetCount > 0)
    assert.ok(budgetPayload.contextPolicy.budget.estimatedChars <= 500)
    assert.ok(budgetPayload.recentMessages.some((message) => message.messageId === 'assistant_budget_keep'), 'should keep assistant context under char budget')
    assert.ok(budgetPayload.recentMessages.some((message) => message.messageId === 'topic_budget_keep'), 'should keep topic context under char budget')

    const specialistMessages = buildDecisionMessages({
        agentConfig: {},
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'specialist_msg',
            normalizedText: '小助手，订阅 uid 2',
            rawText: '小助手，订阅 uid 2',
            mentionsSelf: false,
            hasReply: false,
            aliasMatched: true,
            sender: { role: 'admin' }
        },
        memoryObservation: {
            groupState: { recentMessages: [] },
            topicSnapshot: { topicId: 'topic_bili' },
            chatPace: {}
        },
        longTermMemories: [],
        scoreResult: { traits: {}, components: {}, score: 1, reasons: [], penalties: [] },
        ruleDecision: { action: 'tool_plan', wouldReply: true, threshold: 0.65 },
        sessionContext: { actor: {} },
        budgetDecision: { allowed: true }
    })
    const specialistPayload = JSON.parse(specialistMessages[1].content)
    assert.strictEqual(specialistPayload.specialistContext.mode, 'specialist_scoped')
    assert.ok(specialistPayload.specialistContext.selectedSpecialists.some((specialist) => specialist.id === 'bili_agent'))
    assert.ok(specialistPayload.availableTools.some((tool) => tool.name === 'subscription.add_user'))
    assert.ok(!specialistPayload.availableTools.some((tool) => tool.name === 'qq.mute_member'))

    console.log('✓ Agent prompt persona 注入正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
