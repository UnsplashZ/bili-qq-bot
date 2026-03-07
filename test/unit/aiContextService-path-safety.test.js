#!/usr/bin/env node
'use strict'

const assert = require('assert')

const aiContextService = require('../../src/services/aiContextService')
const aiCommand = require('../../src/commands/ai')
const aiHandler = require('../../src/handlers/aiHandler')
const config = require('../../src/config')

const originals = {
    isRootAdmin: config.isRootAdmin,
    isGroupAdmin: config.isGroupAdmin,
    resetContext: aiHandler.resetContext,
    sendGroupMessage: aiCommand.sendGroupMessage
}

function restore() {
    config.isRootAdmin = originals.isRootAdmin
    config.isGroupAdmin = originals.isGroupAdmin
    aiHandler.resetContext = originals.resetContext
    aiCommand.sendGroupMessage = originals.sendGroupMessage
}

function testValidateContextId() {
    assert.strictEqual(aiContextService.validateContextId('123456'), '123456')
    assert.strictEqual(aiContextService.validateContextId('private_123456'), 'private_123456')

    assert.throws(() => aiContextService.validateContextId('../escape'))
    assert.throws(() => aiContextService.validateContextId('abc/123'))
    assert.throws(() => aiContextService.validateContextId('private_abc'))
    assert.throws(() => aiContextService.validateContextId(''))
    console.log('✓ validateContextId 正确拒绝非法 ID')
}

async function testAiCommandRejectInvalidResetTarget() {
    config.isRootAdmin = () => true
    config.isGroupAdmin = () => true

    let resetCalled = false
    aiHandler.resetContext = () => {
        resetCalled = true
    }

    const replies = []
    aiCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        replies.push(chain?.[0]?.data?.text || '')
    }

    const handled = await aiCommand.handle({
        ws: {},
        groupId: '10001',
        userId: '42',
        rawMessage: '/AI 新对话 ../escape'
    })

    assert.strictEqual(handled, true)
    assert.strictEqual(resetCalled, false, '非法目标不应触发 resetContext')
    assert.ok(replies.some(text => text.includes('群号格式无效')))
    console.log('✓ /AI 新对话 拒绝非法目标群号')
}

async function run() {
    testValidateContextId()
    await testAiCommandRejectInvalidResetTarget()
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        restore()
        if (aiContextService.cleanupTimer && typeof aiContextService.cleanupTimer.unref === 'function') {
            aiContextService.cleanupTimer.unref()
        }
    })
