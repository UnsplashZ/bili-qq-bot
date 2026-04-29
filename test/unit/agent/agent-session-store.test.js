#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const sessionStore = require(path.join(__dirname, '../../../src/agent/session/sessionStore'))

function makeMessage(id, userId, text, timestamp) {
    return {
        id,
        groupId: '1000',
        userId,
        messageType: 'group',
        normalizedText: text,
        rawText: text,
        timestamp
    }
}

function run() {
    sessionStore.reset()

    const first = sessionStore.observe({
        agentMessage: makeMessage('m1', '42', '小助手 继续刚才的话题', 1000),
        topicSnapshot: { topicId: 'topic_a' },
        options: { topicIdleMs: 10 * 60 * 1000 }
    })
    const second = sessionStore.observe({
        agentMessage: makeMessage('m2', '43', '我补充一点背景', 2000),
        topicSnapshot: { topicId: 'topic_a' },
        options: { topicIdleMs: 10 * 60 * 1000 }
    })

    assert.strictEqual(second.sessionId, first.sessionId)
    assert.strictEqual(second.messageCount, 2)
    assert.deepStrictEqual(second.participants, ['42', '43'])
    assert.deepStrictEqual(second.recentMessageIds, ['m1', 'm2'])

    const afterReply = sessionStore.recordAgentOutcome({
        sessionId: second.sessionId,
        action: 'short_reply',
        executed: true,
        toolName: '',
        timestamp: 2500
    })
    assert.strictEqual(afterReply.lastAgentAction, 'short_reply')
    assert.strictEqual(afterReply.turnsSinceAgentReply, 0)

    const third = sessionStore.observe({
        agentMessage: makeMessage('m3', '42', '那继续', 3000),
        topicSnapshot: { topicId: 'topic_a' },
        options: { topicIdleMs: 10 * 60 * 1000 }
    })
    assert.strictEqual(third.turnsSinceAgentReply, 1)

    const expired = sessionStore.observe({
        agentMessage: makeMessage('m4', '42', '新话题', 20 * 60 * 1000),
        topicSnapshot: { topicId: 'topic_a' },
        options: { topicIdleMs: 10 * 60 * 1000 }
    })
    assert.notStrictEqual(expired.sessionId, first.sessionId)
    assert.strictEqual(expired.messageCount, 1)

    console.log('✓ Agent session store 会话摘要正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
