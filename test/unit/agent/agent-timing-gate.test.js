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

    const participationDisabled = runTimingGate({
        agentConfig: {
            ...config,
            participation: { enabled: false, timingGateEnabled: true }
        },
        agentMessage: message('m0', '42', 3000),
        memoryObservation: {
            groupState: { recentMessages: [message('m-2', '42', 1000), message('m-1', '42', 2000), message('m0', '42', 3000)] },
            chatPace: { crowded: true }
        },
        scoreResult: { score: 0, traits: {} }
    })
    assert.strictEqual(participationDisabled.timingAction, 'listen')
    assert.strictEqual(participationDisabled.reason, 'participation_disabled')

    const participationDisabledDirect = runTimingGate({
        agentConfig: {
            ...config,
            participation: { enabled: false, timingGateEnabled: true }
        },
        agentMessage: { ...message('m0-direct', '42', 4000), mentionsSelf: true },
        memoryObservation: { groupState: { recentMessages: [] }, chatPace: { crowded: true } },
        scoreResult: { score: 1, traits: { mentionedBot: true } }
    })
    assert.strictEqual(participationDisabledDirect.timingAction, 'continue')
    assert.strictEqual(participationDisabledDirect.reason, 'direct_addressed')

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

    const socialConfig = {
        ...config,
        social: {
            enabled: true,
            mode: 'active',
            planningMinScore: 0.3,
            topicAffinityMinScore: 0.8,
            avoidDuringRapidTwoPersonChat: true
        }
    }
    const agentTopic = runTimingGate({
        agentConfig: socialConfig,
        agentMessage: message('m5', '42', 50000, '我发现这个拟人化功能直接选择一句话不说'),
        memoryObservation: { groupState: { recentMessages: [] }, chatPace: { crowded: false } },
        scoreResult: { score: 0.04, traits: { privilegedActor: true } }
    })
    assert.strictEqual(agentTopic.timingAction, 'continue')
    assert.strictEqual(agentTopic.reason, 'timing_allows_planning')
    assert.strictEqual(agentTopic.signals.topicOpenForBot, true)

    const lowSocial = runTimingGate({
        agentConfig: {
            ...socialConfig,
            social: {
                ...socialConfig.social,
                planningMinScore: 0.9,
                topicAffinityMinScore: 1
            }
        },
        agentMessage: message('m6', '42', 60000, '包好玩的'),
        memoryObservation: { groupState: { recentMessages: [] }, chatPace: { crowded: false } },
        scoreResult: { score: 0, traits: {} }
    })
    assert.strictEqual(lowSocial.timingAction, 'listen')
    assert.strictEqual(lowSocial.reason, 'low_relation_to_bot')

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
