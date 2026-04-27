#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const {
    extractFirstHttpUrl,
    isSafePublicHttpUrl,
    planFallbackTool
} = require(path.join(__dirname, '../../src/agent/cognition/fallbackToolPlanner'))
const { buildErrorFallbackDecision } = require(path.join(__dirname, '../../src/agent/cognition/agentDecisionService'))
const { buildDecisionMessages, buildToolResultMessages } = require(path.join(__dirname, '../../src/agent/runtime/promptBuilder'))

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
    assert.strictEqual(readPlan.action, 'tool_plan')
    assert.strictEqual(readPlan.toolIntent.name, 'browser.read_url')
    assert.strictEqual(readPlan.toolIntent.arguments.url, 'https://www.zhihu.com/question/2031494133160861736')

    const screenshotPlan = planFallbackTool({
        text: '@Bot 截图 https://example.com',
        addressed: true
    })
    assert.strictEqual(screenshotPlan.toolIntent.name, 'browser.screenshot_url')

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
    assert.strictEqual(fallbackDecision.action, 'tool_plan')
    assert.strictEqual(fallbackDecision.toolIntent.name, 'browser.read_url')

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

    console.log('✓ Agent fallback 工具规划正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
