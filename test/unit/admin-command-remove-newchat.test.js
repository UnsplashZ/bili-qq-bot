#!/usr/bin/env node
'use strict'

const assert = require('assert')

const adminCommand = require('../../src/commands/admin')
const config = require('../../src/config')
const aiHandler = require('../../src/handlers/aiHandler')

const originals = {
    isRootAdmin: config.isRootAdmin,
    sendGroupMessage: adminCommand.sendGroupMessage,
    resetContext: aiHandler.resetContext
}

function restore() {
    config.isRootAdmin = originals.isRootAdmin
    adminCommand.sendGroupMessage = originals.sendGroupMessage
    aiHandler.resetContext = originals.resetContext
}

async function testManageNewchatShouldBeUnknownSubcommand() {
    config.isRootAdmin = () => true
    let resetCalled = 0
    aiHandler.resetContext = () => {
        resetCalled += 1
    }

    const replies = []
    adminCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        replies.push(chain?.[0]?.data?.text || '')
    }

    const handled = await adminCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/管理 新对话 2000'
    })

    assert.strictEqual(handled, true)
    assert.strictEqual(resetCalled, 0)
    assert.ok(replies.some(text => text.includes('未知指令。可用: /管理 <群列表|清理> [群号]')))
    console.log('✓ /管理 新对话 已移除，不再重置AI上下文')
}

async function testAdminAliasNewchatShouldBeUnknownSubcommand() {
    config.isRootAdmin = () => true
    let resetCalled = 0
    aiHandler.resetContext = () => {
        resetCalled += 1
    }

    const replies = []
    adminCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        replies.push(chain?.[0]?.data?.text || '')
    }

    const handled = await adminCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/admin newchat 2000'
    })

    assert.strictEqual(handled, true)
    assert.strictEqual(resetCalled, 0)
    assert.ok(replies.some(text => text.includes('未知指令。可用: /管理 <群列表|清理> [群号]')))
    console.log('✓ /admin newchat 已移除，不再重置AI上下文')
}

async function run() {
    await testManageNewchatShouldBeUnknownSubcommand()
    await testAdminAliasNewchatShouldBeUnknownSubcommand()
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
