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
const linkService = require('../../src/services/link')
const requestApprovalService = require('../../src/services/requestApprovalService')
const { replyGateService } = require('../../src/services/ai/replyGateService')
const { runAgent: runAgentService } = require('../../src/services/ai/agentRunService')
const { classifyResponseModeHint } = require('../../src/services/ai/agent/responseModeClassifier')

const originals = {
    getReply: aiHandler.getReply,
    runAgent: aiHandler.runAgent,
    addMessageToContext: aiHandler.addMessageToContext,
    buildRuntime: aiHandler._buildRuntime,
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
    gateEvaluateAdmission: replyGateService.evaluateAdmission,
    gateRecordBotReply: replyGateService.recordBotReply,
    prepareIncomingMessageLinks: linkService.prepareIncomingMessageLinks,
    isCached: linkService.isCached,
    tryHandleAdminDecision: requestApprovalService.tryHandleAdminDecision,
    sendGroupMessage: messageHandler.sendGroupMessage,
    sendGroupMessageWithResponse: messageHandler.sendGroupMessageWithResponse
}

function restore() {
    aiHandler.getReply = originals.getReply
    aiHandler.runAgent = originals.runAgent
    aiHandler.addMessageToContext = originals.addMessageToContext
    aiHandler._buildRuntime = originals.buildRuntime
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
    replyGateService.evaluateAdmission = originals.gateEvaluateAdmission
    replyGateService.recordBotReply = originals.gateRecordBotReply
    linkService.prepareIncomingMessageLinks = originals.prepareIncomingMessageLinks
    linkService.isCached = originals.isCached
    requestApprovalService.tryHandleAdminDecision = originals.tryHandleAdminDecision
    messageHandler.sendGroupMessage = originals.sendGroupMessage
    messageHandler.sendGroupMessageWithResponse = originals.sendGroupMessageWithResponse
}

function buildDefaultMessageData(overrides = {}) {
    return {
        post_type: 'message',
        message_type: 'group',
        self_id: 1,
        message_id: 123,
        user_id: 2,
        group_id: 1000,
        raw_message: '现在怎么办？',
        message: [{ type: 'text', data: { text: '现在怎么办？' } }],
        sender: { nickname: '测试用户' },
        ...overrides
    }
}

function createDefaultBotControlRuntime(overrides = {}) {
    return {
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => null,
            clearCandidateSelectionSnapshot: () => {},
            ...overrides.botControl
        },
        ...overrides
    }
}

function useDefaultRuntimeStubs({ gateDecision, dispatchResult = false, descriptors = [], runtime } = {}) {
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

    commandManager.dispatch = async () => dispatchResult
    linkHandler.extractLinks = () => []
    linkHandler.shortLinkRegex = null
    linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({ rawMessage, descriptors })
    linkService.isCached = () => false
    vectorMemoryService.addMemory = async () => {}
    userProfileService.recordMessage = async () => {}
    userProfileService.maybeUpdateProfile = async () => {}
    userProfileService.maybeScheduleProfileUpdate = async () => {}
    aiHandler.addMessageToContext = () => {}
    aiContextService.getContext = () => []
    replyGateService.evaluate = () => gateDecision || {
        shouldReply: false,
        triggerLevel: 'none',
        busyMode: false,
        score: 0,
        reasons: ['test']
    }
    replyGateService.evaluateAdmission = () => gateDecision || {
        shouldReply: false,
        triggerLevel: 'none',
        busyMode: false,
        score: 0,
        reasons: ['test']
    }
    replyGateService.recordBotReply = () => {}
    aiHandler._buildRuntime = () => runtime || createDefaultBotControlRuntime()
    messageHandler.sendGroupMessage = () => {}
}

function trackMemoryWrites() {
    const calls = []

    aiHandler.addMessageToContext = (...args) => {
        calls.push({ type: 'context', args })
    }
    vectorMemoryService.addMemory = async (...args) => {
        calls.push({ type: 'vector', args })
    }
    userProfileService.recordMessage = async (...args) => {
        calls.push({ type: 'profile_record', args })
    }
    userProfileService.maybeScheduleProfileUpdate = async (...args) => {
        calls.push({ type: 'profile_schedule', args })
    }

    return calls
}

function captureOutgoingReplies({ messageId = 'bot-reply-1' } = {}) {
    const sent = []

    messageHandler.sendGroupMessageWithResponse = async (_ws, groupId, messageChain, userId) => {
        sent.push({ method: 'sendGroupMessageWithResponse', groupId, messageChain, userId })
        return {
            data: {
                message_id: messageId
            }
        }
    }
    messageHandler.sendGroupMessage = (_ws, groupId, messageChain, userId) => {
        sent.push({ method: 'sendGroupMessage', groupId, messageChain, userId })
    }

    return sent
}

function buildStructuredRuntime({
    isRootAdmin = false,
    isGroupAdmin = false,
    read,
    write,
    botControlOverrides = {}
} = {}) {
    return {
        config: {
            isRootAdmin: () => isRootAdmin,
            isGroupAdmin: () => isGroupAdmin
        },
        replyGateService: {
            evaluate: () => {
                throw new Error('structured bot-control path should not evaluate reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured bot-control path should not classify response mode')
        },
        botControl: {
            getPendingConfirmation: () => null,
            getCandidateSelectionSnapshot: () => null,
            clearCandidateSelectionSnapshot: () => {},
            read: read || (async () => ({
                ok: true,
                mutation: false,
                data: {
                    ok: true
                }
            })),
            write: write || (async () => ({
                ok: true,
                mutation: false,
                data: {
                    ok: true
                }
            })),
            ...botControlOverrides
        }
    }
}

async function testPipelinePayloadPassedToAiHandler() {
    useDefaultRuntimeStubs({
        gateDecision: {
            shouldReply: true,
            triggerLevel: 'followup',
            busyMode: false,
            score: 60,
            reasons: ['test']
        }
    })
    aiContextService.getContext = () => ([
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '前面超时了', timestamp: 1000 },
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '现在怎么办？', timestamp: 2000 }
    ])

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: 'ok' }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData())

    assert.ok(capturedAgentInput)
    assert.strictEqual(capturedAgentInput.pipelineInput.gateDecision.triggerLevel, 'followup')
    assert.strictEqual(capturedAgentInput.pipelineInput.responseMode.mode, 'answer_only')
    assert.ok(Array.isArray(capturedAgentInput.pipelineInput.selectedContext.threadMessages))
    assert.strictEqual(capturedAgentInput.traceId, 'msg:1000:2:123')
    console.log('✓ messageHandler 会把结构化 AI 管线输入组装为 agentInput 并传给 aiHandler.runAgent')
}

async function testPipelineUsesAdmissionAliasAndHelperSurface() {
    useDefaultRuntimeStubs({
        gateDecision: {
            shouldReply: true,
            triggerLevel: 'direct',
            busyMode: false,
            score: 120,
            reasons: ['at_bot']
        }
    })
    aiContextService.getContext = () => ([
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '前情', timestamp: 1000 },
        { role: 'user', speakerId: '2', speakerName: '测试用户', content: '帮我把AI关掉', timestamp: 2000 }
    ])

    let admissionCalls = 0
    replyGateService.evaluate = () => {
        throw new Error('messageHandler should use evaluateAdmission alias instead of evaluate')
    }
    replyGateService.evaluateAdmission = () => {
        admissionCalls += 1
        return {
            shouldReply: true,
            triggerLevel: 'direct',
            busyMode: false,
            score: 120,
            reasons: ['at_bot']
        }
    }

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 124,
        raw_message: '[CQ:at,qq=1]帮我把AI关掉',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '帮我把AI关掉' } }
        ]
    }))

    assert.strictEqual(admissionCalls, 1)
    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.responseMode, classifyResponseModeHint({
        rawMessage: '[CQ:at,qq=1]帮我把AI关掉',
        messageMeta: capturedAgentInput.messageMeta,
        triggerLevel: 'direct'
    }))
    console.log('✓ messageHandler 通过 admission alias 与 response mode helper 保持原有 AI 管线行为')
}

async function testProfileRefreshNoLongerDependsOnBotReply() {
    useDefaultRuntimeStubs()
    aiHandler.runAgent = async () => {
        throw new Error('should not request ai reply')
    }

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

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 456,
        raw_message: '今天也来签到',
        message: [{ type: 'text', data: { text: '今天也来签到' } }]
    }))

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(calls, ['vector', 'record', 'schedule'])
    console.log('✓ messageHandler 会在 bot 不回复时独立触发用户画像刷新检查')
}

async function testConfirmationFollowupSkipsNormalMemoryWrites() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: ({ actorUserId }) => {
                    assert.strictEqual(actorUserId, '2')
                    return {
                        confirmationId: 'confirm-1',
                        action: 'subscription.write',
                        snapshot: {
                            input: {
                                operation: 'add_user',
                                uid: '42'
                            }
                        }
                    }
                }
            }
        })
    })
    const memoryCalls = trackMemoryWrites()
    aiHandler.runAgent = async () => ({ finalReply: null })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 460,
        raw_message: '[CQ:reply,id=9001]确认',
        message: [
            { type: 'reply', data: { id: '9001', qq: '1' } },
            { type: 'text', data: { text: '确认' } }
        ]
    }))

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(memoryCalls, [])
    console.log('✓ confirmation follow-up 不会写入普通 context/vector memory')
}

async function testCandidateSelectionFollowupSkipsNormalMemoryWrites() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getCandidateSelectionSnapshot: ({ actorUserId, includeExpired }) => {
                    assert.strictEqual(actorUserId, '2')
                    assert.strictEqual(includeExpired, true)
                    return {
                        groupId: '1000',
                        actorUserId: '2',
                        botMessageId: 'bot-msg-1',
                        query: '老番茄',
                        candidates: [
                            { rank: 1, uid: '546195', name: '老番茄' },
                            { rank: 2, uid: '987654', name: '老番茄切片号' }
                        ],
                        createdAt: 1710000000000,
                        expiresAt: 2710000000000
                    }
                }
            }
        })
    })
    const memoryCalls = trackMemoryWrites()
    aiHandler.runAgent = async () => ({ finalReply: null })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 461,
        raw_message: '[CQ:reply,id=bot-msg-1]第2个',
        message: [
            { type: 'reply', data: { id: 'bot-msg-1', qq: '1' } },
            { type: 'text', data: { text: '第2个' } }
        ]
    }))

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(memoryCalls, [])
    console.log('✓ candidate selection follow-up 不会写入普通 context/vector memory')
}

async function testInitialBotControlIngressSkipsNormalMemoryWrites() {
    useDefaultRuntimeStubs()
    const memoryCalls = trackMemoryWrites()
    aiHandler.runAgent = async () => ({ finalReply: null })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 462,
        raw_message: '[CQ:at,qq=1]关闭AI',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '关闭AI' } }
        ]
    }))

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(memoryCalls, [])
    console.log('✓ 初始 bot-control 动作不会写入普通 context/vector memory')
}

async function testOrdinaryChatStillWritesNormalMemory() {
    useDefaultRuntimeStubs()
    const memoryCalls = trackMemoryWrites()
    aiHandler.runAgent = async () => ({ finalReply: null })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 463,
        raw_message: '今天也来签到',
        message: [{ type: 'text', data: { text: '今天也来签到' } }]
    }))

    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(memoryCalls.map(call => call.type), [
        'context',
        'vector',
        'profile_record',
        'profile_schedule'
    ])
    assert.strictEqual(memoryCalls[0].args[2], '今天也来签到')
    assert.strictEqual(memoryCalls[1].args[1], '今天也来签到')
    console.log('✓ 普通聊天仍然照常写入 context/vector memory')
}

async function testCommandStillWinsBeforeAiRuntime() {
    useDefaultRuntimeStubs({ dispatchResult: true })
    linkHandler.extractLinks = () => {
        throw new Error('command path should not fall back to legacy link extraction')
    }
    replyGateService.evaluate = () => {
        throw new Error('command path should not evaluate AI gate')
    }
    aiHandler._buildRuntime = () => {
        throw new Error('command path should not probe bot-control runtime')
    }

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: 'should not happen' }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 789,
        raw_message: '/菜单',
        message: [{ type: 'text', data: { text: '/菜单' } }]
    }))

    assert.strictEqual(runAgentCalled, false, '命令命中后不应进入 AI runtime')
    console.log('✓ command 仍然优先于新的 aiHandler.runAgent 入口')
}

async function testReplyToBotConfirmationAdmitsBotControlIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: ({ actorUserId }) => {
                    assert.strictEqual(actorUserId, '2')
                    return {
                        confirmationId: 'confirm-1',
                        action: 'subscription.write',
                        snapshot: {
                            input: {
                                operation: 'add_user',
                                uid: '42'
                            }
                        }
                    }
                }
            }
        })
    })

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 801,
        raw_message: '[CQ:reply,id=9001]确认',
        message: [
            { type: 'reply', data: { id: '9001', qq: '1' } },
            { type: 'text', data: { text: '确认' } }
        ]
    }))

    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-1'
        }
    })
    console.log('✓ reply bot 的确认消息会在入口直接放行到 bot-control flow')
}

async function testExactReplyTargetConfirmationAdmitsBotControlIngressWithoutIsReplyToBotMetadata() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: ({ actorUserId }) => {
                    assert.strictEqual(actorUserId, '2')
                    return {
                        confirmationId: 'confirm-1b',
                        action: 'subscription.write',
                        botMessageId: 'bot-confirm-1',
                        snapshot: {
                            input: {
                                operation: 'add_user',
                                uid: '42'
                            }
                        }
                    }
                }
            }
        })
    })

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8012,
        raw_message: '[CQ:reply,id=bot-confirm-1]确认',
        message: [
            { type: 'reply', data: { id: 'bot-confirm-1' } },
            { type: 'text', data: { text: '确认' } }
        ]
    }))

    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-1b'
        }
    })
    console.log('✓ 精确 reply 目标命中的确认消息即使缺少 isReplyToBot 也会进入 bot-control flow')
}

async function testReplyToBotRejectAdmitsBotControlIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: ({ actorUserId }) => {
                    assert.strictEqual(actorUserId, '2')
                    return {
                        confirmationId: 'confirm-reject-1',
                        action: 'subscription.write',
                        snapshot: {
                            input: {
                                operation: 'add_user',
                                uid: '42'
                            }
                        }
                    }
                }
            }
        })
    })

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8011,
        raw_message: '[CQ:reply,id=9001]取消',
        message: [
            { type: 'reply', data: { id: '9001', qq: '1' } },
            { type: 'text', data: { text: '取消' } }
        ]
    }))

    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.botControlAction, {
        action: 'confirmation.reject',
        input: {
            confirmationId: 'confirm-reject-1'
        }
    })
    console.log('✓ reply bot 的取消消息会在入口直接放行到 reject flow')
}

async function testBareConfirmationDoesNotTriggerBotControl() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-1',
                    action: 'subscription.write',
                    snapshot: {
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                })
            }
        })
    })

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 802,
        raw_message: '确认',
        message: [{ type: 'text', data: { text: '确认' } }]
    }))

    assert.strictEqual(runAgentCalled, false)
    console.log('✓ 群里裸确认不会触发 bot-control')
}

async function testWrongActorCannotConsumePendingConfirmationAtIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getPendingConfirmation: ({ actorUserId }) => {
                    assert.strictEqual(actorUserId, '3')
                    return null
                }
            }
        })
    })

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8021,
        user_id: 3,
        sender: { nickname: '其他用户' },
        raw_message: '[CQ:reply,id=9001]确认',
        message: [
            { type: 'reply', data: { id: '9001', qq: '1' } },
            { type: 'text', data: { text: '确认' } }
        ]
    }))

    assert.strictEqual(runAgentCalled, false)
    console.log('✓ actor 作用域会阻止其他人消费 pending confirmation')
}

async function testCandidateSelectionRequiresReplyToBotAtIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getCandidateSelectionSnapshot: ({ actorUserId, includeExpired }) => {
                    assert.strictEqual(actorUserId, '2')
                    assert.strictEqual(includeExpired, true)
                    return {
                        groupId: '1000',
                        actorUserId: '2',
                        botMessageId: 'bot-msg-1',
                        query: '老番茄',
                        candidates: [
                            { rank: 1, uid: '546195', name: '老番茄' },
                            { rank: 2, uid: '987654', name: '老番茄切片号' }
                        ],
                        createdAt: 1710000000000,
                        expiresAt: 2710000000000
                    }
                }
            }
        })
    })

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 803,
        raw_message: '[CQ:reply,id=bot-msg-1]第2个',
        message: [
            { type: 'reply', data: { id: 'bot-msg-1', qq: '1' } },
            { type: 'text', data: { text: '第2个' } }
        ]
    }))

    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '987654'
        }
    })

    let bareRunAgentCalled = false
    aiHandler.runAgent = async () => {
        bareRunAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 804,
        raw_message: '1',
        message: [{ type: 'text', data: { text: '1' } }]
    }))

    assert.strictEqual(bareRunAgentCalled, false)
    console.log('✓ 候选选择 follow-up 只有 reply bot 时才会命中入口')
}

async function testWrongActorCannotConsumeCandidateSnapshotAtIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getCandidateSelectionSnapshot: ({ actorUserId, includeExpired }) => {
                    assert.strictEqual(actorUserId, '3')
                    assert.strictEqual(includeExpired, true)
                    return {
                        groupId: '1000',
                        actorUserId: '2',
                        botMessageId: 'bot-msg-1',
                        query: '老番茄',
                        candidates: [
                            { rank: 1, uid: '546195', name: '老番茄' }
                        ],
                        createdAt: 1710000000000,
                        expiresAt: 2710000000000
                    }
                }
            }
        })
    })

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8041,
        user_id: 3,
        sender: { nickname: '其他用户' },
        raw_message: '[CQ:reply,id=bot-msg-1]1',
        message: [
            { type: 'reply', data: { id: 'bot-msg-1', qq: '1' } },
            { type: 'text', data: { text: '1' } }
        ]
    }))

    assert.strictEqual(runAgentCalled, false)
    console.log('✓ actor 作用域会阻止其他人消费候选快照')
}

async function testWrongReplyTargetDoesNotConsumeCandidateSnapshotAtIngress() {
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                getCandidateSelectionSnapshot: ({ actorUserId, includeExpired }) => {
                    assert.strictEqual(actorUserId, '2')
                    assert.strictEqual(includeExpired, true)
                    return {
                        groupId: '1000',
                        actorUserId: '2',
                        botMessageId: 'bot-msg-1',
                        query: '老番茄',
                        candidates: [
                            { rank: 1, uid: '546195', name: '老番茄' }
                        ],
                        createdAt: 1710000000000,
                        expiresAt: 2710000000000
                    }
                }
            }
        })
    })

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8042,
        raw_message: '[CQ:reply,id=bot-msg-2]1',
        message: [
            { type: 'reply', data: { id: 'bot-msg-2', qq: '1' } },
            { type: 'text', data: { text: '1' } }
        ]
    }))

    assert.strictEqual(runAgentCalled, false)
    console.log('✓ reply 到错误 bot 消息不会消费候选快照')
}

async function testExpiredCandidateSnapshotYieldsDeterministicIntegratedReply() {
    let clearCalls = 0
    const runtime = buildStructuredRuntime({
        isGroupAdmin: true,
        botControlOverrides: {
            getCandidateSelectionSnapshot: ({ actorUserId, includeExpired }) => {
                assert.strictEqual(actorUserId, '2')
                assert.strictEqual(includeExpired, true)
                return {
                    groupId: '1000',
                    actorUserId: '2',
                    botMessageId: 'bot-msg-expired',
                    query: '老番茄',
                    candidates: [
                        { rank: 1, uid: '546195', name: '老番茄' }
                    ],
                    createdAt: 1710000000000,
                    expiresAt: 1
                }
            },
            clearCandidateSelectionSnapshot: ({ actorUserId }) => {
                assert.strictEqual(actorUserId, '2')
                clearCalls += 1
            }
        }
    })

    useDefaultRuntimeStubs({ runtime })
    const sentReplies = captureOutgoingReplies({ messageId: 'expired-reply-1' })
    aiHandler.runAgent = async (agentInput) => runAgentService({ agentInput, runtime })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8043,
        raw_message: '[CQ:reply,id=bot-msg-expired]1',
        message: [
            { type: 'reply', data: { id: 'bot-msg-expired', qq: '1' } },
            { type: 'text', data: { text: '1' } }
        ]
    }))

    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(sentReplies.length, 1)
    assert.strictEqual(sentReplies[0].messageChain[0].data.text, '候选已过期，请重新搜索。')
    console.log('✓ 过期候选快照会在集成路径上返回稳定过期提示并清理快照')
}

async function testInitialBotControlRequiresAtBotOrReplyToBot() {
    useDefaultRuntimeStubs()

    let capturedAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 805,
        raw_message: '[CQ:at,qq=1]关闭AI',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '关闭AI' } }
        ]
    }))

    assert.ok(capturedAgentInput)
    assert.deepStrictEqual(capturedAgentInput.pipelineInput.botControlAction, {
        action: 'config.write',
        input: {
            aiEnabled: false
        }
    })

    let capturedConfigReadInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedConfigReadInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8050,
        raw_message: '[CQ:at,qq=1]查看AI配置',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '查看AI配置' } }
        ]
    }))

    assert.ok(capturedConfigReadInput)
    assert.deepStrictEqual(capturedConfigReadInput.pipelineInput.botControlAction, {
        action: 'config.read',
        input: {
            operation: 'get'
        }
    })

    let capturedReplyAgentInput = null
    aiHandler.runAgent = async (agentInput) => {
        capturedReplyAgentInput = agentInput
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8051,
        raw_message: '[CQ:reply,id=9002]重置上下文',
        message: [
            { type: 'reply', data: { id: '9002', qq: '1' } },
            { type: 'text', data: { text: '重置上下文' } }
        ]
    }))

    assert.ok(capturedReplyAgentInput)
    assert.deepStrictEqual(capturedReplyAgentInput.pipelineInput.botControlAction, {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    })

    let bareRunAgentCalled = false
    aiHandler.runAgent = async () => {
        bareRunAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 806,
        raw_message: '查看AI配置',
        message: [{ type: 'text', data: { text: '查看AI配置' } }]
    }))

    assert.strictEqual(bareRunAgentCalled, false)
    console.log('✓ 初始 bot-control 动作必须 @bot 或 reply bot 才会进入 runtime')
}

async function testIngressAdminReadPermissionBoundaryStillApplies() {
    let blockedReadCalled = false
    const blockedRuntime = buildStructuredRuntime({
        isGroupAdmin: false,
        read: async () => {
            blockedReadCalled = true
            throw new Error('non-admin actor should not reach admin_read runtime')
        }
    })

    useDefaultRuntimeStubs({ runtime: blockedRuntime })
    const blockedReplies = captureOutgoingReplies({ messageId: 'blocked-admin-read-reply' })
    aiHandler.runAgent = async (agentInput) => runAgentService({ agentInput, runtime: blockedRuntime })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8061,
        user_id: 9,
        sender: { nickname: '普通成员' },
        raw_message: '[CQ:at,qq=1]查看AI配置',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '查看AI配置' } }
        ]
    }))

    assert.strictEqual(blockedReadCalled, false)
    assert.strictEqual(blockedReplies.length, 1)
    assert.strictEqual(blockedReplies[0].messageChain[0].data.text, '你没有权限查看当前群管理信息。')

    let allowedReadCalls = 0
    const allowedRuntime = buildStructuredRuntime({
        isGroupAdmin: true,
        read: async (action, input, context) => {
            allowedReadCalls += 1
            assert.strictEqual(action, 'config.read')
            assert.deepStrictEqual(input, { operation: 'get' })
            assert.strictEqual(context.actorUserId, '2')
            return {
                ok: true,
                action: 'config.read',
                mutation: false,
                data: {
                    operation: 'get',
                    effective: {
                        aiEnabled: true,
                        aiRagEnabled: false
                    }
                }
            }
        }
    })

    useDefaultRuntimeStubs({ runtime: allowedRuntime })
    const allowedReplies = captureOutgoingReplies({ messageId: 'allowed-admin-read-reply' })
    aiHandler.runAgent = async (agentInput) => runAgentService({ agentInput, runtime: allowedRuntime })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 8062,
        raw_message: '[CQ:at,qq=1]查看AI配置',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '查看AI配置' } }
        ]
    }))

    assert.strictEqual(allowedReadCalls, 1)
    assert.strictEqual(allowedReplies.length, 1)
    assert.ok(allowedReplies[0].messageChain[0].data.text.includes('当前群 AI 配置如下'))
    console.log('✓ ingress 命中的 admin_read 动作仍然会在 runtime 权限边界内被拦截或放行')
}

async function testLinkStillWinsBeforeBotControlIngress() {
    useDefaultRuntimeStubs({
        descriptors: [{ cacheKey: 'link-1', url: 'https://example.com' }]
    })
    linkService.isCached = () => true

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: null }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 807,
        raw_message: '[CQ:at,qq=1]关闭AI https://example.com',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '关闭AI https://example.com' } }
        ]
    }))

    assert.strictEqual(runAgentCalled, false)
    console.log('✓ link 仍然优先于 bot-control ingress')
}

async function testConfirmationPromptReplyStoresPendingConfirmationBotMessageId() {
    const sent = captureOutgoingReplies({ messageId: 'bot-confirm-store-1' })
    let storedBotMessageId = null
    useDefaultRuntimeStubs({
        runtime: createDefaultBotControlRuntime({
            botControl: {
                setPendingConfirmationBotMessageId: (botMessageId, context = {}) => {
                    storedBotMessageId = { botMessageId, context }
                }
            }
        })
    })
    aiHandler.runAgent = async () => ({
        finalReply: '这个操作需要确认。确认后将执行：将 UID 42 添加到当前群订阅。',
        localActions: [{
            action: 'subscription.write',
            status: 'pending_confirmation',
            confirmation: {
                confirmationId: 'confirm-store-1',
                required: true
            }
        }]
    })

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_id: 809,
        raw_message: '[CQ:at,qq=1]订阅测试UP',
        message: [
            { type: 'at', data: { qq: '1' } },
            { type: 'text', data: { text: '订阅测试UP' } }
        ]
    }))

    assert.strictEqual(sent.length, 1)
    assert.deepStrictEqual(storedBotMessageId, {
        botMessageId: 'bot-confirm-store-1',
        context: {
            actorUserId: '2',
            userId: '2',
            confirmationId: 'confirm-store-1'
        }
    })
    console.log('✓ confirmation prompt 发送后会回写 pending confirmation 的 botMessageId')
}

async function testRootPrivateApprovalInterceptStillWinsBeforeAiRuntime() {
    useDefaultRuntimeStubs()
    config.isRootAdmin = () => true
    requestApprovalService.tryHandleAdminDecision = async (_ws, messageData) => {
        assert.strictEqual(messageData.message_type, 'private')
        assert.strictEqual(String(messageData.user_id), '2')
        return true
    }
    commandManager.dispatch = async () => {
        throw new Error('approval intercept should return before command dispatch')
    }

    let runAgentCalled = false
    aiHandler.runAgent = async () => {
        runAgentCalled = true
        return { finalReply: 'should not happen' }
    }

    await messageHandler.handleMessage({}, buildDefaultMessageData({
        message_type: 'private',
        group_id: null,
        message_id: 808,
        raw_message: '是',
        message: [{ type: 'text', data: { text: '是' } }]
    }))

    assert.strictEqual(runAgentCalled, false, 'root private approval intercept 命中后不应进入 AI runtime')
    console.log('✓ root private approval intercept 仍然优先于 AI runtime')
}

async function run() {
    await testPipelinePayloadPassedToAiHandler()
    await testPipelineUsesAdmissionAliasAndHelperSurface()
    await testProfileRefreshNoLongerDependsOnBotReply()
    await testConfirmationFollowupSkipsNormalMemoryWrites()
    await testCandidateSelectionFollowupSkipsNormalMemoryWrites()
    await testInitialBotControlIngressSkipsNormalMemoryWrites()
    await testOrdinaryChatStillWritesNormalMemory()
    await testCommandStillWinsBeforeAiRuntime()
    await testReplyToBotConfirmationAdmitsBotControlIngress()
    await testExactReplyTargetConfirmationAdmitsBotControlIngressWithoutIsReplyToBotMetadata()
    await testReplyToBotRejectAdmitsBotControlIngress()
    await testBareConfirmationDoesNotTriggerBotControl()
    await testWrongActorCannotConsumePendingConfirmationAtIngress()
    await testCandidateSelectionRequiresReplyToBotAtIngress()
    await testWrongActorCannotConsumeCandidateSnapshotAtIngress()
    await testWrongReplyTargetDoesNotConsumeCandidateSnapshotAtIngress()
    await testExpiredCandidateSnapshotYieldsDeterministicIntegratedReply()
    await testInitialBotControlRequiresAtBotOrReplyToBot()
    await testIngressAdminReadPermissionBoundaryStillApplies()
    await testLinkStillWinsBeforeBotControlIngress()
    await testConfirmationPromptReplyStoresPendingConfirmationBotMessageId()
    await testRootPrivateApprovalInterceptStillWinsBeforeAiRuntime()
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
