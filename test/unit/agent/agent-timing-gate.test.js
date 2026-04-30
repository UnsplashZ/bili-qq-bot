#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { runTimingGate } = require(path.join(__dirname, '../../../src/agent/timing/timingGate'))
const {
    scheduleTimingReentry,
    getScheduledTimingReentryCount,
    resetTimingState
} = require(path.join(__dirname, '../../../src/agent/timing/timingStateStore'))
const { AgentRunState } = require(path.join(__dirname, '../../../src/agent/runtime/runState'))

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run() {
    resetTimingState()
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

    let firstRan = false
    let secondRan = false
    scheduleTimingReentry({
        groupId: '1000',
        waitMs: 30,
        run: () => {
            firstRan = true
        }
    })
    scheduleTimingReentry({
        groupId: '1000',
        waitMs: 5,
        run: () => {
            secondRan = true
        }
    })
    assert.strictEqual(getScheduledTimingReentryCount(), 1)
    await sleep(30)
    assert.strictEqual(firstRan, false)
    assert.strictEqual(secondRan, true)
    assert.strictEqual(getScheduledTimingReentryCount(), 0)

    const runState = new AgentRunState({
        context: {},
        groupId: '1000',
        agentConfig: { sendEnabled: true },
        agentMessage: message('m10', 'u1', 1000),
        actor: {},
        memoryObservation: { topicSnapshot: {} },
        sessionContext: {}
    })
    const reentryState = runState.createTimingReentry({ agentConfig: { sendEnabled: false } })
    assert.strictEqual(reentryState.timingReentry, true)
    assert.strictEqual(reentryState.agentConfig.sendEnabled, false)

    console.log('✓ Agent timing gate 节奏判断正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
