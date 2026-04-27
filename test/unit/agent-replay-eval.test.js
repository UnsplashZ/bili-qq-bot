#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const replayEval = require(path.join(__dirname, '../../tools/agent-replay-eval'))

function run() {
    const samples = replayEval.loadReplayCases()
    assert.ok(samples.length >= 8)
    assert.ok(samples.some((sample) => sample.id === 'thread-001'))
    assert.ok(samples.some((sample) => sample.id === 'social-001'))

    const report = replayEval.runReplayEval({ mode: 'deterministic' })
    assert.strictEqual(report.failed, 0, JSON.stringify(report.cases.filter((item) => !item.ok), null, 2))

    const threadCase = report.cases.find((item) => item.id === 'thread-001')
    assert.ok(threadCase.actual.contextMessageIds.includes('m2'))
    assert.ok(threadCase.actual.promptPayload.recentMessages.some((message) => message.messageId === 'm2'))

    const socialCase = report.cases.find((item) => item.id === 'social-001')
    assert.strictEqual(socialCase.actual.shouldSend, false)
    assert.notStrictEqual(socialCase.actual.action, 'tool_plan')

    console.log('✓ Agent replay deterministic eval 正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
