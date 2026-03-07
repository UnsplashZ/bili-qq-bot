#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const aiHandler = require(path.join(__dirname, '../../src/handlers/aiHandler'))
const vectorMemoryService = require(path.join(__dirname, '../../src/services/vectorMemoryService'))
const commandManager = require(path.join(__dirname, '../../src/commands'))
const config = require(path.join(__dirname, '../../src/config'))
const handler = require(path.join(__dirname, '../../src/handlers/messageHandler'))

const originals = {
    shouldReply: aiHandler.shouldReply,
    addMessageToContext: aiHandler.addMessageToContext,
    addMemory: vectorMemoryService.addMemory,
    dispatch: commandManager.dispatch,
    isRootAdmin: config.isRootAdmin,
    isGroupEnabled: config.isGroupEnabled,
    ensureGroupConfig: config.ensureGroupConfig,
    blacklistedQQs: config.blacklistedQQs,
    groupConfigs: config.groupConfigs,
}

function makeWs() {
    return {
        readyState: 1,
        send() {},
    }
}

function makeMessage({ userId, groupId }) {
    return {
        message_type: 'group',
        group_id: String(groupId),
        user_id: String(userId),
        self_id: '999999',
        message_id: 10001,
        raw_message: 'hello',
        message: [],
        sender: { nickname: 'tester' }
    }
}

async function run() {
    let dispatchCalled = false
    let aiCalled = false

    aiHandler.shouldReply = () => { aiCalled = true; return false }
    aiHandler.addMessageToContext = () => {}
    vectorMemoryService.addMemory = async () => {}
    commandManager.dispatch = async () => { dispatchCalled = true; return false }

    config.isRootAdmin = () => false
    config.isGroupEnabled = () => true
    config.ensureGroupConfig = () => {}

    // Case 1: 全局黑名单中的 number 格式应命中 string userId
    dispatchCalled = false
    aiCalled = false
    config.blacklistedQQs = [123456]
    config.groupConfigs = {}
    await handler.handleMessage(makeWs(), makeMessage({ userId: '123456', groupId: '1000' }))
    assert.strictEqual(dispatchCalled, false, '全局黑名单命中时不应进入命令分发')
    assert.strictEqual(aiCalled, false, '全局黑名单命中时不应进入 AI 分支')

    // Case 2: 群黑名单中的 number 格式应命中 string userId
    dispatchCalled = false
    aiCalled = false
    config.blacklistedQQs = []
    config.groupConfigs = {
        '1000': {
            blacklistedQQs: [234567]
        }
    }
    await handler.handleMessage(makeWs(), makeMessage({ userId: '234567', groupId: '1000' }))
    assert.strictEqual(dispatchCalled, false, '群黑名单命中时不应进入命令分发')
    assert.strictEqual(aiCalled, false, '群黑名单命中时不应进入 AI 分支')

    // Case 3: 未命中黑名单时应继续处理（至少进入命令分发）
    dispatchCalled = false
    aiCalled = false
    config.blacklistedQQs = []
    config.groupConfigs = {}
    await handler.handleMessage(makeWs(), makeMessage({ userId: '345678', groupId: '1000' }))
    assert.strictEqual(dispatchCalled, true, '未命中黑名单时应继续执行后续流程')

    console.log('✅ MessageHandler blacklist type compatibility tests passed')
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        aiHandler.shouldReply = originals.shouldReply
        aiHandler.addMessageToContext = originals.addMessageToContext
        vectorMemoryService.addMemory = originals.addMemory
        commandManager.dispatch = originals.dispatch
        config.isRootAdmin = originals.isRootAdmin
        config.isGroupEnabled = originals.isGroupEnabled
        config.ensureGroupConfig = originals.ensureGroupConfig
        config.blacklistedQQs = originals.blacklistedQQs
        config.groupConfigs = originals.groupConfigs
    })
