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
const aiContextService = require('../../src/services/aiContextService')
const { replyGateService } = require('../../src/services/ai/replyGateService')

const originals = {
    getReply: aiHandler.getReply,
    addMessageToContext: aiHandler.addMessageToContext,
    ensureGroupConfig: config.ensureGroupConfig,
    isGroupEnabled: config.isGroupEnabled,
    isGroupAdmin: config.isGroupAdmin,
    isRootAdmin: config.isRootAdmin,
    getGroupConfig: config.getGroupConfig,
    dispatch: commandManager.dispatch,
    extractLinks: linkHandler.extractLinks,
    shortLinkRegex: linkHandler.shortLinkRegex,
    addMemory: vectorMemoryService.addMemory,
    recordMessage: userProfileService.recordMessage,
    maybeUpdateProfile: userProfileService.maybeUpdateProfile,
    maybeScheduleProfileUpdate: userProfileService.maybeScheduleProfileUpdate,
    getContext: aiContextService.getContext,
    gateEvaluate: replyGateService.evaluate,
    gateRecordBotReply: replyGateService.recordBotReply,
    sendGroupMessage: messageHandler.sendGroupMessage
}

function restore() {
    aiHandler.getReply = originals.getReply
    aiHandler.addMessageToContext = originals.addMessageToContext
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.isGroupEnabled = originals.isGroupEnabled
    config.isGroupAdmin = originals.isGroupAdmin
    config.isRootAdmin = originals.isRootAdmin
    config.getGroupConfig = originals.getGroupConfig
    commandManager.dispatch = originals.dispatch
    linkHandler.extractLinks = originals.extractLinks
    linkHandler.shortLinkRegex = originals.shortLinkRegex
    vectorMemoryService.addMemory = originals.addMemory
    userProfileService.recordMessage = originals.recordMessage
    userProfileService.maybeUpdateProfile = originals.maybeUpdateProfile
    userProfileService.maybeScheduleProfileUpdate = originals.maybeScheduleProfileUpdate
    aiContextService.getContext = originals.getContext
    replyGateService.evaluate = originals.gateEvaluate
    replyGateService.recordBotReply = originals.gateRecordBotReply
    messageHandler.sendGroupMessage = originals.sendGroupMessage
}

async function testPipelinePayloadPassedToAiHandler() {
    config.ensureGroupConfig = () => {}
    config.isGroupEnabled = () => true
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    config.getGroupConfig = (_groupId, key) => {
        const map = {
            aiReplyGateEnabled: true,
            aiContextSelectorEnabled: true,
            aiResponseModeEnabled: true
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
        return originals.getGroupConfig.call(config, _groupId, key)
    }

    commandManager.dispatch = async () => false
    linkHandler.extractLinks = () => []
    linkHandler.shortLinkRegex = null
    vectorMemoryService.addMemory = async () => {}
    userProfileService.recordMessage = async () => {}
    userProfileService.maybeUpdateProfile = async () => {}
    userProfileService.maybeScheduleProfileUpdate = async () => {}
    aiHandler.addMessageToContext = () => {}
    aiContextService.getContext = () => ([
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '前面超时了', timestamp: 1000 },
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '现在怎么办？', timestamp: 2000 }
    ])
    replyGateService.evaluate = () => ({
        shouldReply: true,
        triggerLevel: 'followup',
        busyMode: false,
        score: 60,
        reasons: ['test']
    })
    replyGateService.recordBotReply = () => {}

    let capturedPipelineInput = null
    aiHandler.getReply = async (_message, _userId, _groupId, _traceId, pipelineInput) => {
        capturedPipelineInput = pipelineInput
        return 'ok'
    }

    messageHandler.sendGroupMessage = () => {}

    await messageHandler.handleMessage({}, {
        post_type: 'message',
        message_type: 'group',
        self_id: 1,
        message_id: 123,
        user_id: 2,
        group_id: 1000,
        raw_message: '现在怎么办？',
        message: [{ type: 'text', data: { text: '现在怎么办？' } }],
        sender: { nickname: '测试用户' }
    })

    assert.ok(capturedPipelineInput)
    assert.strictEqual(capturedPipelineInput.gateDecision.triggerLevel, 'followup')
    assert.strictEqual(capturedPipelineInput.responseMode.mode, 'answer_only')
    assert.ok(Array.isArray(capturedPipelineInput.selectedContext.threadMessages))
    console.log('✓ messageHandler 会把结构化 AI 管线输入传给 aiHandler')
}

async function testProfileRefreshNoLongerDependsOnBotReply() {
    config.ensureGroupConfig = () => {}
    config.isGroupEnabled = () => true
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    config.getGroupConfig = (_groupId, key) => {
        const map = {
            aiReplyGateEnabled: true,
            aiContextSelectorEnabled: true,
            aiResponseModeEnabled: true
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
        return originals.getGroupConfig.call(config, _groupId, key)
    }

    commandManager.dispatch = async () => false
    linkHandler.extractLinks = () => []
    linkHandler.shortLinkRegex = null
    aiHandler.addMessageToContext = () => {}
    aiContextService.getContext = () => []
    replyGateService.evaluate = () => ({
        shouldReply: false,
        triggerLevel: 'none',
        busyMode: false,
        score: 0,
        reasons: ['test']
    })
    replyGateService.recordBotReply = () => {}
    aiHandler.getReply = async () => {
        throw new Error('should not request ai reply')
    }
    messageHandler.sendGroupMessage = () => {}

    const calls = []
    vectorMemoryService.addMemory = async () => {
        calls.push('vector')
    }
    userProfileService.recordMessage = async () => {
        calls.push('record')
    }
    userProfileService.maybeScheduleProfileUpdate = async () => {
        calls.push('schedule')
    }
    userProfileService.maybeUpdateProfile = async () => {
        calls.push('legacy')
    }

    await messageHandler.handleMessage({}, {
        post_type: 'message',
        message_type: 'group',
        self_id: 1,
        message_id: 456,
        user_id: 2,
        group_id: 1000,
        raw_message: '今天也来签到',
        message: [{ type: 'text', data: { text: '今天也来签到' } }],
        sender: { nickname: '测试用户' }
    })

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(calls, ['vector', 'record', 'schedule'])
    console.log('✓ messageHandler 会在 bot 不回复时独立触发用户画像刷新检查')
}

async function run() {
    await testPipelinePayloadPassedToAiHandler()
    await testProfileRefreshNoLongerDependsOnBotReply()
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
