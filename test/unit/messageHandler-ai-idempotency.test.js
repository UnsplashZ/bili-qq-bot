#!/usr/bin/env node
'use strict'

const assert = require('assert')

const messageHandler = require('../../src/handlers/messageHandler')
const aiHandler = require('../../src/handlers/aiHandler')
const config = require('../../src/config')
const linkHandler = require('../../src/handlers/linkHandler')
const commandManager = require('../../src/commands')
const vectorMemoryService = require('../../src/services/vectorMemoryService')
const userProfileService = require('../../src/services/userProfileService')
const aiIdempotency = require('../../src/services/ai/idempotency')

const originals = {
    shouldReply: aiHandler.shouldReply,
    getReply: aiHandler.getReply,
    addMessageToContext: aiHandler.addMessageToContext,
    ensureGroupConfig: config.ensureGroupConfig,
    isGroupEnabled: config.isGroupEnabled,
    isGroupAdmin: config.isGroupAdmin,
    isRootAdmin: config.isRootAdmin,
    dispatch: commandManager.dispatch,
    extractLinks: linkHandler.extractLinks,
    shortLinkRegex: linkHandler.shortLinkRegex,
    addMemory: vectorMemoryService.addMemory,
    recordMessage: userProfileService.recordMessage,
    maybeUpdateProfile: userProfileService.maybeUpdateProfile,
    sendGroupMessage: messageHandler.sendGroupMessage
}

function restore() {
    aiHandler.shouldReply = originals.shouldReply
    aiHandler.getReply = originals.getReply
    aiHandler.addMessageToContext = originals.addMessageToContext
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.isGroupEnabled = originals.isGroupEnabled
    config.isGroupAdmin = originals.isGroupAdmin
    config.isRootAdmin = originals.isRootAdmin
    commandManager.dispatch = originals.dispatch
    linkHandler.extractLinks = originals.extractLinks
    linkHandler.shortLinkRegex = originals.shortLinkRegex
    vectorMemoryService.addMemory = originals.addMemory
    userProfileService.recordMessage = originals.recordMessage
    userProfileService.maybeUpdateProfile = originals.maybeUpdateProfile
    messageHandler.sendGroupMessage = originals.sendGroupMessage
    if (typeof aiIdempotency.reset === 'function') aiIdempotency.reset()
}

async function testDuplicateMessageIdOnlyRepliesOnce() {
    aiIdempotency.reset()
    config.ensureGroupConfig = () => {}
    config.isGroupEnabled = () => true
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true

    commandManager.dispatch = async () => false
    linkHandler.extractLinks = () => []
    linkHandler.shortLinkRegex = null
    vectorMemoryService.addMemory = async () => {}
    userProfileService.recordMessage = async () => {}
    userProfileService.maybeUpdateProfile = async () => {}
    aiHandler.addMessageToContext = () => {}
    aiHandler.shouldReply = () => true

    let getReplyCalled = 0
    aiHandler.getReply = async () => {
        getReplyCalled += 1
        return 'ok'
    }

    let sendCount = 0
    messageHandler.sendGroupMessage = () => {
        sendCount += 1
    }

    const payload = {
        post_type: 'message',
        message_type: 'group',
        self_id: 1,
        message_id: 999,
        user_id: 2,
        group_id: 1000,
        raw_message: '你好',
        message: [{ type: 'text', data: { text: '你好' } }],
        sender: { nickname: '测试用户' }
    }

    await messageHandler.handleMessage({}, payload)
    await messageHandler.handleMessage({}, payload)

    assert.strictEqual(getReplyCalled, 1, '重复消息不应重复调用 AI')
    assert.strictEqual(sendCount, 1, '重复消息不应重复回复')
    console.log('✓ 重复 message_id 仅回复一次')
}

async function testNonArrayMessageWillNotCrash() {
    aiIdempotency.reset()
    config.ensureGroupConfig = () => {}
    config.isGroupEnabled = () => true
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    commandManager.dispatch = async () => false
    linkHandler.extractLinks = () => []
    linkHandler.shortLinkRegex = null
    vectorMemoryService.addMemory = async () => {}
    userProfileService.recordMessage = async () => {}
    userProfileService.maybeUpdateProfile = async () => {}
    aiHandler.addMessageToContext = () => {}
    aiHandler.shouldReply = () => false
    messageHandler.sendGroupMessage = () => {}

    await messageHandler.handleMessage({}, {
        post_type: 'message',
        message_type: 'group',
        self_id: 1,
        message_id: 1000,
        user_id: 2,
        group_id: 1000,
        raw_message: '文本',
        message: '文本',
        sender: { nickname: '测试用户' }
    })
    console.log('✓ 非数组 message 输入不会导致崩溃')
}

async function run() {
    await testDuplicateMessageIdOnlyRepliesOnce()
    await testNonArrayMessageWillNotCrash()
}

run()
    .then(() => {
        process.exit(0)
    })
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
