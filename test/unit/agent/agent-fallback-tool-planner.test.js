#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const {
    extractFirstHttpUrl,
    findSafeContextUrl,
    isSafePublicHttpUrl,
    planFallbackTool
} = require(path.join(__dirname, '../../../src/agent/cognition/fallbackToolPlanner'))
const { buildErrorFallbackDecision } = require(path.join(__dirname, '../../../src/agent/cognition/agentDecisionService'))
const { buildDecisionMessages, buildToolResultMessages } = require(path.join(__dirname, '../../../src/agent/runtime/promptBuilder'))

function makeScoreResult() {
    return {
        score: 0.82,
        reasons: ['mentioned_bot', 'question_like'],
        penalties: [],
        traits: {
            mentionedBot: true,
            aliasMatched: false,
            replyToBot: false
        }
    }
}

function run() {
    const zhihuText = '@Bot https://www.zhihu.com/question/2031494133160861736这个回答说了些啥？总结一下，截个图给我'
    assert.strictEqual(
        extractFirstHttpUrl(zhihuText),
        'https://www.zhihu.com/question/2031494133160861736'
    )
    assert.strictEqual(isSafePublicHttpUrl('https://www.zhihu.com/question/1'), true)
    assert.strictEqual(isSafePublicHttpUrl('http://localhost:3000'), false)
    assert.strictEqual(isSafePublicHttpUrl('http://127.0.0.1/a'), false)
    assert.strictEqual(isSafePublicHttpUrl('http://user:pass@example.com/a'), false)

    const readPlan = planFallbackTool({ text: zhihuText, addressed: true })
    assert.strictEqual(readPlan.action, 'act')
    assert.strictEqual(readPlan.toolIntent.name, 'browser.read_url')
    assert.strictEqual(readPlan.toolIntent.arguments.url, 'https://www.zhihu.com/question/2031494133160861736')

    const screenshotPlan = planFallbackTool({
        text: '@Bot 截图 https://example.com',
        addressed: true
    })
    assert.strictEqual(screenshotPlan.toolIntent.name, 'browser.screenshot_url')

    const contextualScreenshotPlan = planFallbackTool({
        text: '@Bot 为什么不能截图？',
        addressed: true,
        replyTarget: {
            isBot: true,
            text: '本轮先完成网页读取，截图可继续执行。'
        },
        recentMessages: [
            { normalizedText: '闲聊一句' },
            { normalizedText: '@Bot 总结 https://example.com/a 这个页面，截个图给我' },
            { role: 'assistant', normalizedText: '本轮先完成网页读取，截图可继续执行。' }
        ]
    })
    assert.strictEqual(contextualScreenshotPlan.toolIntent.name, 'browser.screenshot_url')
    assert.strictEqual(contextualScreenshotPlan.toolIntent.arguments.url, 'https://example.com/a')
    const contextualInspectionPlan = planFallbackTool({
        text: '@Bot 检查一下你截图的内容',
        addressed: true,
        replyTarget: {
            isBot: true,
            text: '已截取网页截图：https://example.com/a [图片]'
        },
        recentMessages: []
    })
    assert.strictEqual(contextualInspectionPlan.toolIntent.name, 'browser.read_url')
    assert.strictEqual(contextualInspectionPlan.toolIntent.arguments.url, 'https://example.com/a')
    assert.strictEqual(findSafeContextUrl({
        recentMessages: [{ normalizedText: '不要访问 http://127.0.0.1:3000' }]
    }), '')

    const unavailablePlan = planFallbackTool({
        text: '@Bot 总结 https://example.com',
        addressed: true,
        availableToolNames: ['browser.screenshot_url']
    })
    assert.strictEqual(unavailablePlan, null)

    const unsafePlan = planFallbackTool({
        text: '@Bot 总结 http://127.0.0.1:3000',
        addressed: true
    })
    assert.strictEqual(unsafePlan, null)

    const fallbackDecision = buildErrorFallbackDecision({
        agentMessage: {
            normalizedText: zhihuText,
            rawText: zhihuText,
            mentionsSelf: true,
            aliasMatched: false,
            replyToSelf: false
        },
        scoreResult: makeScoreResult(),
        ruleDecision: { wouldReply: true },
        errorMessage: 'agent_llm_empty_message_content',
        sessionContext: { actor: { isRoot: true, qqRole: 'owner' } }
    })
    assert.strictEqual(fallbackDecision.action, 'act')
    assert.strictEqual(fallbackDecision.toolIntent.name, 'browser.read_url')

    const contextualFallbackDecision = buildErrorFallbackDecision({
        agentMessage: {
            normalizedText: '@Bot 为什么不能截图？',
            rawText: '@Bot 为什么不能截图？',
            mentionsSelf: true,
            aliasMatched: false,
            replyToSelf: true,
            replyTarget: {
                isBot: true,
                text: '本轮先完成网页读取，截图可继续执行。'
            }
        },
        memoryObservation: {
            groupState: {
                recentMessages: [
                    { normalizedText: '@Bot 总结 https://example.com/a 这个页面，截个图给我' }
                ]
            }
        },
        scoreResult: {
            score: 1,
            reasons: ['mentioned_bot', 'reply_context'],
            penalties: [],
            traits: {
                mentionedBot: true,
                replyToBot: true
            }
        },
        ruleDecision: { wouldReply: true },
        errorMessage: 'decision_json_object_not_found',
        sessionContext: { actor: { isRoot: true, qqRole: 'owner' } }
    })
    assert.strictEqual(contextualFallbackDecision.action, 'act')
    assert.strictEqual(contextualFallbackDecision.toolIntent.name, 'browser.screenshot_url')
    assert.strictEqual(contextualFallbackDecision.toolIntent.arguments.url, 'https://example.com/a')

    const messages = buildDecisionMessages({
        agentConfig: {
            social: {},
            shortTerm: {}
        },
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'm1',
            normalizedText: zhihuText,
            rawText: zhihuText,
            mentionsSelf: true,
            hasReply: false,
            replyTarget: null,
            aliasMatched: false,
            sender: { role: 'owner' }
        },
        memoryObservation: {
            topicSnapshot: null,
            chatPace: null,
            topic: { topicId: 'topic_test' }
        },
        longTermMemories: [],
        scoreResult: makeScoreResult(),
        ruleDecision: { action: 'short_reply', wouldReply: true, threshold: 0.65 },
        sessionContext: {
            actor: { isRoot: true, qqRole: 'owner' },
            conversationSession: null
        },
        budgetDecision: null,
        inputGuardrail: null,
        socialScore: null
    })
    const payload = JSON.parse(messages[1].content)
    assert.strictEqual(payload.deterministicToolCandidate.toolIntent.name, 'browser.read_url')

    const toolResultMessages = buildToolResultMessages({
        agentConfig: {},
        agentMessage: {
            groupId: '1000',
            userId: '42',
            id: 'm1',
            normalizedText: zhihuText,
            rawText: zhihuText
        },
        sessionContext: {},
        toolOutcome: {
            status: 'executed',
            plan: { name: 'browser.read_url', risk: 'medium', permission: 'use_browser', summary: '读取网页', args: {} },
            result: {
                message: '已读取网页：示例',
                data: {
                    url: 'https://example.com',
                    status: 200,
                    title: '示例',
                    method: 'chromium',
                    quality: 'ok',
                    text: '这是网页正文，用于让最终回复生成摘要。'
                }
            }
        }
    })
    const toolPayload = JSON.parse(toolResultMessages[1].content)
    assert.ok(toolPayload.toolOutcome.result.data.text.includes('网页正文'))
    assert.ok(toolPayload.constraints.some((item) => item.includes('browser.read_url')))
    assert.ok(toolPayload.constraints.some((item) => item.includes('不要说“没法截图”')))

    console.log('✓ Agent fallback 工具规划正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
