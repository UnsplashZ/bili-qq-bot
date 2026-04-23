#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
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
    runAgent: aiHandler.runAgent,
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
    getContext: aiContextService.getContext,
    gateEvaluate: replyGateService.evaluate,
    gateEvaluateAdmission: replyGateService.evaluateAdmission,
    gateRecordBotReply: replyGateService.recordBotReply,
    sendGroupMessage: messageHandler.sendGroupMessage
}

function restore() {
    aiHandler.getReply = originals.getReply
    aiHandler.runAgent = originals.runAgent
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
    aiContextService.getContext = originals.getContext
    replyGateService.evaluate = originals.gateEvaluate
    replyGateService.evaluateAdmission = originals.gateEvaluateAdmission
    replyGateService.recordBotReply = originals.gateRecordBotReply
    messageHandler.sendGroupMessage = originals.sendGroupMessage
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
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
        aiHandler.addMessageToContext = () => {}
        aiContextService.getContext = () => ([
            { role: 'user', speakerId: '2', speakerName: '测试用户', content: '之前报超时了', timestamp: 1000 },
            { role: 'user', speakerId: '2', speakerName: '测试用户', content: '现在怎么办？', timestamp: 2000 }
        ])
        replyGateService.evaluate = () => ({
            shouldReply: true,
            triggerLevel: 'followup',
            busyMode: true,
            score: 85,
            reasons: ['busy_mode', 'recent_bot_interaction']
        })
        replyGateService.evaluateAdmission = replyGateService.evaluate
        replyGateService.recordBotReply = () => {}
        aiHandler.runAgent = async () => ({ finalReply: 'ok' })
        messageHandler.sendGroupMessage = () => {}

        await messageHandler.handleMessage({}, {
            post_type: 'message',
            message_type: 'group',
            self_id: 1,
            message_id: 555,
            user_id: 2,
            group_id: 1000,
            raw_message: '现在怎么办？',
            message: [{ type: 'text', data: { text: '现在怎么办？' } }],
            sender: { nickname: '测试用户' }
        })

        const entryLoggedScope = logger.createMessageScope('1000', '2', '556')
        await messageHandler.handleMessage({}, {
            post_type: 'message',
            message_type: 'group',
            self_id: 1,
            message_id: 556,
            user_id: 2,
            group_id: 1000,
            raw_message: '这条消息的入口日志已经在 bot 侧记录过',
            message: [{ type: 'text', data: { text: '这条消息的入口日志已经在 bot 侧记录过' } }],
            sender: { nickname: '测试用户' },
            traceContext: {
                scope: entryLoggedScope,
                receivedLogged: true
            }
        })

        const scope = '[msg:1000:2:555]'
        assert.ok(logs.some(line => line.includes(`INF BOT`) && line.includes(scope) && line.includes('recv')))
        assert.ok(logs.some(line => line.includes(`INF AI`) && line.includes(scope) && line.includes('gate')))
        assert.ok(logs.some(line => line.includes(`INF AI`) && line.includes(scope) && line.includes('context')))
        assert.ok(logs.some(line => line.includes(`INF AI`) && line.includes(scope) && line.includes('mode')))
        const duplicateRecvLogs = logs.filter((line) => line.includes(`INF BOT`) && line.includes(`[${entryLoggedScope}]`) && line.includes('recv'))
        assert.strictEqual(duplicateRecvLogs.length, 0, '上游已经记录入口日志时，messageHandler 不应重复输出 recv')
        console.log('✓ messageHandler 会在同一 msg scope 下输出入口与 AI 摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
