#!/usr/bin/env node
'use strict'

const assert = require('assert')

const aiHandler = require('../../src/handlers/aiHandler')
const config = require('../../src/config')
const aiConfig = require('../../src/config/aiConfig')

const originals = {
    isAiAgentRuntimeV2Enabled: config.isAiAgentRuntimeV2Enabled,
    buildRuntime: aiHandler._buildRuntime,
    runLegacyAgent: aiHandler._runLegacyAgent,
    runAgentRuntimeV2: aiHandler._runAgentRuntimeV2
}

function restore() {
    config.isAiAgentRuntimeV2Enabled = originals.isAiAgentRuntimeV2Enabled
    aiHandler._buildRuntime = originals.buildRuntime
    aiHandler._runLegacyAgent = originals.runLegacyAgent
    aiHandler._runAgentRuntimeV2 = originals.runAgentRuntimeV2
}

async function testDefaultFlagKeepsLegacyPath() {
    assert.strictEqual(aiConfig.isAiAgentRuntimeV2Enabled({ aiAgentRuntimeV2: false }), false)

    const runtime = { kind: 'runtime' }
    const calls = []
    config.isAiAgentRuntimeV2Enabled = () => false
    aiHandler._buildRuntime = (groupId, traceId) => {
        calls.push(['buildRuntime', groupId, traceId])
        return runtime
    }
    aiHandler._runLegacyAgent = async (agentInput, receivedRuntime) => {
        calls.push(['legacy', agentInput.traceId, receivedRuntime])
        return { finalReply: 'legacy-ok' }
    }
    aiHandler._runAgentRuntimeV2 = async () => {
        throw new Error('default flag should not route to v2 runtime')
    }

    const result = await aiHandler.runAgent({
        traceId: 'trace-default',
        groupId: '1000',
        userId: '2',
        rawMessage: '你好'
    })

    assert.deepStrictEqual(calls, [
        ['buildRuntime', '1000', 'trace-default'],
        ['legacy', 'trace-default', runtime]
    ])
    assert.strictEqual(result.finalReply, 'legacy-ok')
    console.log('✓ aiHandler 在默认 flag=false 时仍走当前 legacy AI path')
}

async function testEnabledFlagRoutesToV2Path() {
    const runtime = { kind: 'runtime-v2' }
    const calls = []
    config.isAiAgentRuntimeV2Enabled = () => true
    aiHandler._buildRuntime = (groupId, traceId) => {
        calls.push(['buildRuntime', groupId, traceId])
        return runtime
    }
    aiHandler._runLegacyAgent = async () => {
        throw new Error('v2 flag should not route to legacy runtime')
    }
    aiHandler._runAgentRuntimeV2 = async (agentInput, receivedRuntime) => {
        calls.push(['v2', agentInput.traceId, receivedRuntime])
        return { finalReply: 'v2-ok' }
    }

    const result = await aiHandler.runAgent({
        traceId: 'trace-v2',
        groupId: '1000',
        userId: '2',
        rawMessage: '你好'
    })

    assert.deepStrictEqual(calls, [
        ['buildRuntime', '1000', 'trace-v2'],
        ['v2', 'trace-v2', runtime]
    ])
    assert.strictEqual(result.finalReply, 'v2-ok')
    console.log('✓ aiHandler 在 flag=true 时会切到预留的 v2 runtime 分支')
}

async function testLegacyRuntimeViewHidesAgentNativeReplySurface() {
    const baseRuntime = {
        keep: 'ok',
        generateLegacyReply: async () => 'legacy',
        generateLegacyReplyResult: async () => ({ finalReply: 'legacy-result' }),
        generateAgentReply: async () => 'agent',
        generateAgentReplyResult: async () => ({ finalReply: 'agent-result' })
    }

    const runtime = aiHandler._buildLegacyReplyRuntimeView(baseRuntime)

    assert.notStrictEqual(runtime, baseRuntime)
    assert.strictEqual(runtime.keep, 'ok')
    assert.strictEqual(runtime.generateLegacyReply, baseRuntime.generateLegacyReply)
    assert.strictEqual(runtime.generateLegacyReplyResult, baseRuntime.generateLegacyReplyResult)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(runtime, 'generateAgentReply'), false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(runtime, 'generateAgentReplyResult'), false)
    assert.strictEqual(baseRuntime.generateAgentReply, baseRuntime.generateAgentReply)
    assert.strictEqual(baseRuntime.generateAgentReplyResult, baseRuntime.generateAgentReplyResult)
    console.log('✓ aiHandler legacy runtime view 会隐藏 agent-native reply surface')
}

async function run() {
    await testDefaultFlagKeepsLegacyPath()
    await testEnabledFlagRoutesToV2Path()
    await testLegacyRuntimeViewHidesAgentNativeReplySurface()
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
