#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { runTimingGate } = require(path.join(__dirname, '../../../src/agent/timing/timingGate'))

function message(id, userId, timestamp, text = '闲聊') {
    return {
        id,
        userId,
        timestamp,
        normalizedText: text,
        rawText: text,
        role: 'user',
        mentionsSelf: false,
        aliasMatched: false,
        replyToSelf: false
    }
}

function run() {
    const config = {
        participation: { timingGateEnabled: true },
        timing: { quietWindowMs: 2500, maxWaitMs: 12000 },
        social: { enabled: false, mode: 'quiet' }
    }

    const direct = runTimingGate({
        agentConfig: config,
        agentMessage: { ...message('m1', '42', 1000), mentionsSelf: true },
        memoryObservation: { groupState: { recentMessages: [] }, chatPace: { crowded: false } },
        scoreResult: { score: 1, traits: { mentionedBot: true } }
    })
    assert.strictEqual(direct.timingAction, 'continue')
    assert.strictEqual(direct.signals.directAddressed, true)

    const rapid = runTimingGate({
        agentConfig: config,
        agentMessage: message('m3', '42', 3000),
        memoryObservation: {
            groupState: { recentMessages: [message('m1', '42', 1000), message('m2', '42', 2000), message('m3', '42', 3000)] },
            chatPace: { crowded: false }
        },
        scoreResult: { score: 0.5, traits: {} }
    })
    assert.strictEqual(rapid.timingAction, 'wait')
    assert.strictEqual(rapid.signals.userLikelyStillTyping, true)

    const twoPerson = runTimingGate({
        agentConfig: config,
        agentMessage: message('m4', '2', 40000),
        memoryObservation: {
            groupState: { recentMessages: [message('m1', '1', 10000), message('m2', '2', 20000), message('m3', '1', 30000), message('m4', '2', 40000)] },
            chatPace: { crowded: false }
        },
        scoreResult: { score: 0.2, traits: {} }
    })
    assert.strictEqual(twoPerson.timingAction, 'listen')

    console.log('✓ Agent timing gate 节奏判断正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
