#!/usr/bin/env node
'use strict'

const assert = require('assert')

const {
    selectContext
} = require('../../src/services/ai/contextSelectorService')

function testSameSpeakerPriority() {
    const context = [
        { role: 'user', speakerId: 'u2', speakerName: '李四', content: '我们晚点再说', timestamp: 1000 },
        { role: 'user', speakerId: 'u1', speakerName: '张三', content: '订阅刷新超时了', timestamp: 2000 },
        { role: 'assistant', speakerId: 'assistant', speakerName: 'AI助手', content: '先检查网络和 cookie', timestamp: 3000 },
        { role: 'user', speakerId: 'u1', speakerName: '张三', content: '网络恢复了', timestamp: 4000 }
    ]

    const selected = selectContext({
        context,
        currentTurn: { role: 'user', speakerId: 'u1', speakerName: '张三', content: '那现在要重试吗？', timestamp: 5000 },
        messageMeta: {},
        options: { threadLimit: 3, summaryThreshold: 10 }
    })

    assert.strictEqual(selected.threadMessages.length, 3)
    assert.strictEqual(selected.threadMessages[0].speakerId, 'u1')
    assert.strictEqual(selected.threadMessages[1].role, 'assistant')
    console.log('✓ 同一说话人与最近 bot 回复优先进入 thread context')
}

function testReplyLinkedMessageRetained() {
    const context = [
        { role: 'user', speakerId: 'u2', speakerName: '李四', content: '这里报 504', messageId: 'm1', timestamp: 1000 },
        { role: 'user', speakerId: 'u3', speakerName: '王五', content: '吃饭去吗', messageId: 'm2', timestamp: 2000 }
    ]

    const selected = selectContext({
        context,
        currentTurn: { role: 'user', speakerId: 'u1', speakerName: '张三', content: '这个 504 要重试吗', timestamp: 3000 },
        messageMeta: { replyToMessageId: 'm1' },
        options: { threadLimit: 3, summaryThreshold: 10 }
    })

    assert.strictEqual(selected.threadMessages[0].messageId, 'm1')
    console.log('✓ reply 链接到的消息会被保留')
}

function testUnrelatedChatterDroppedAndSummaryConservative() {
    const context = [
        { role: 'user', speakerId: 'u1', speakerName: '张三', content: '订阅又超时了', timestamp: 1000 },
        { role: 'assistant', speakerId: 'assistant', speakerName: 'AI助手', content: '先检查 cookie', timestamp: 2000 },
        { role: 'user', speakerId: 'u2', speakerName: '李四', content: '哈哈', timestamp: 2100 },
        { role: 'user', speakerId: 'u3', speakerName: '王五', content: '今晚吃啥', timestamp: 2200 },
        { role: 'user', speakerId: 'u4', speakerName: '赵六', content: '我在路上', timestamp: 2300 }
    ]

    const selected = selectContext({
        context,
        currentTurn: { role: 'user', speakerId: 'u1', speakerName: '张三', content: '那现在继续试试？', timestamp: 3000 },
        messageMeta: {},
        options: { threadLimit: 2, summaryThreshold: 4 }
    })

    assert.strictEqual(selected.threadMessages.length, 2)
    assert.ok(selected.backgroundSummary.includes('订阅'))
    assert.ok(!selected.backgroundSummary.includes('已经决定'))
    console.log('✓ 无关插话会被丢弃，摘要保持保守')
}

function testUnrelatedAssistantMessageDoesNotPolluteThread() {
    const context = [
        { role: 'assistant', speakerId: 'assistant', speakerName: 'AI助手', content: '天气不错，记得带伞', timestamp: 1000 },
        { role: 'user', speakerId: 'u1', speakerName: '张三', content: '订阅刷新超时了', timestamp: 2000 },
        { role: 'user', speakerId: 'u2', speakerName: '李四', content: '我先去吃饭', timestamp: 3000 }
    ]

    const selected = selectContext({
        context,
        currentTurn: { role: 'user', speakerId: 'u1', speakerName: '张三', content: '那现在还要重试吗', timestamp: 4000 },
        messageMeta: {},
        options: { threadLimit: 2, summaryThreshold: 10 }
    })

    assert.strictEqual(selected.threadMessages.length, 1)
    assert.strictEqual(selected.threadMessages[0].speakerId, 'u1')
    assert.ok(!selected.threadMessages.some(msg => msg.role === 'assistant'))
    console.log('✓ 无关 assistant 消息不会污染 thread context')
}

function run() {
    testSameSpeakerPriority()
    testReplyLinkedMessageRetained()
    testUnrelatedChatterDroppedAndSummaryConservative()
    testUnrelatedAssistantMessageDoesNotPolluteThread()
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
