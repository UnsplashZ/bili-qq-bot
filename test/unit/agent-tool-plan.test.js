#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const config = require(path.join(__dirname, '../../src/config'))
const agent = require(path.join(__dirname, '../../src/agent'))
const llmClient = require(path.join(__dirname, '../../src/agent/runtime/llmClient'))
const sessionStore = require(path.join(__dirname, '../../src/agent/session/sessionStore'))
const shortTermStore = require(path.join(__dirname, '../../src/agent/memory/shortTermStore'))
const longTermStore = require(path.join(__dirname, '../../src/agent/memory/longTermStore'))
const budgetGuard = require(path.join(__dirname, '../../src/agent/runtime/budgetGuard'))
const replyGuard = require(path.join(__dirname, '../../src/agent/runtime/replyGuard'))
const confirmationStore = require(path.join(__dirname, '../../src/agent/tools/confirmationStore'))
const notificationService = require(path.join(__dirname, '../../src/services/notificationService'))
const toolRegistry = require(path.join(__dirname, '../../src/agent/tools/registry'))
const { evaluateToolGuardrails } = require(path.join(__dirname, '../../src/agent/tools/toolGuardrails'))
const subscriptionService = require(path.join(__dirname, '../../src/services/subscriptionService'))
const biliApi = require(path.join(__dirname, '../../src/services/biliApi'))
const { normalizeMessage } = require(path.join(__dirname, '../../src/agent/ingress/messageNormalizer'))
const { resolveReplyContext, resolveReplyToSelf } = require(path.join(__dirname, '../../src/agent/ingress/agentIngress'))

const tempMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-agent-tool-memory-'))
const tempMemoryFile = path.join(tempMemoryDir, 'memories.json')

const originals = {
    agentConfig: config._overrides.agent,
    groupConfigs: config.groupConfigs,
    save: config.save,
    isRootAdmin: config.isRootAdmin,
    isGroupAdmin: config.isGroupAdmin,
    createChatCompletion: llmClient.createChatCompletion,
    callAction: notificationService.callAction,
    getSubscriptionsByGroup: subscriptionService.getSubscriptionsByGroup,
    getUserInfo: biliApi.getUserInfo,
    searchUsers: biliApi.searchUsers,
    getVideoInfo: biliApi.getVideoInfo,
    apiKey: process.env.AGENT_API_KEY
}

function restore() {
    if (originals.agentConfig === undefined) {
        delete config._overrides.agent
    } else {
        config._overrides.agent = originals.agentConfig
    }
    config.groupConfigs = originals.groupConfigs
    config.save = originals.save
    config.isRootAdmin = originals.isRootAdmin
    config.isGroupAdmin = originals.isGroupAdmin
    llmClient.createChatCompletion = originals.createChatCompletion
    notificationService.callAction = originals.callAction
    subscriptionService.getSubscriptionsByGroup = originals.getSubscriptionsByGroup
    biliApi.getUserInfo = originals.getUserInfo
    biliApi.searchUsers = originals.searchUsers
    biliApi.getVideoInfo = originals.getVideoInfo
    if (originals.apiKey === undefined) {
        delete process.env.AGENT_API_KEY
    } else {
        process.env.AGENT_API_KEY = originals.apiKey
    }
    sessionStore.reset()
    shortTermStore.reset()
    longTermStore.resetForTest()
    budgetGuard.resetBudget()
    replyGuard.resetReplyGuard()
    confirmationStore.resetConfirmations()
    fs.rmSync(tempMemoryDir, { recursive: true, force: true })
}

function makeWs() {
    return {
        readyState: 1,
        sent: [],
        send(payload, callback) {
            this.sent.push(JSON.parse(payload))
            if (callback) callback()
        }
    }
}

function makeMessage(rawMessage, extra = {}) {
    return {
        message_type: 'group',
        group_id: '1000',
        user_id: '42',
        self_id: '999',
        message_id: `msg_${Math.random().toString(36).slice(2, 8)}`,
        raw_message: rawMessage,
        message: [
            { type: 'text', data: { text: rawMessage } }
        ],
        sender: { nickname: 'Tester', role: 'admin' },
        ...extra
    }
}

function enableAgent() {
    config._overrides.agent = {
        enabled: true,
        observeOnly: false,
        logTrajectory: false,
        defaultGroupEnabled: true,
        decisionMode: 'llm_live',
        sendEnabled: true,
        aliases: ['小助手'],
        replyPolicy: {
            minReplyScore: 0.65,
            cooldownMs: 0
        },
        tools: {
            enabled: true,
            confirmationTtlMs: 60000,
            requireConfirmationFor: ['medium', 'high']
        },
        llm: {
            enabled: true,
            provider: 'openai-compatible',
            baseURL: 'https://example.test/v1',
            model: 'test-model',
            apiKeyEnv: 'AGENT_API_KEY',
            timeoutMs: 12000,
            temperature: 0.2,
            maxTokens: 500
        },
        budget: {
            enabled: false,
            windowMs: 60000,
            maxLlmCallsPerGroupPerMinute: 60,
            maxLlmCallsPerUserPerMinute: 20
        },
        groups: {
            1000: {
                enabled: true,
                sendEnabled: true,
                observeOnly: false
            }
        }
    }
}

async function run() {
    longTermStore.resetForTest(tempMemoryFile)
    shortTermStore.reset()
    budgetGuard.resetBudget()
    replyGuard.resetReplyGuard()
    confirmationStore.resetConfirmations()
    process.env.AGENT_API_KEY = 'test-key'
    config.save = () => {}
    config.groupConfigs = { 1000: { admins: [] } }
    config.isRootAdmin = () => false
    config.isGroupAdmin = () => false
    enableAgent()

    const configReadPlan = toolRegistry.normalizeToolIntent({
        name: 'agent.get_group_config',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    assert.strictEqual(configReadPlan.risk, 'low')
    assert.strictEqual(configReadPlan.permission, 'read_group_config')
    const configReadResult = await toolRegistry.executeToolPlan(configReadPlan)
    assert.ok(configReadResult.message.includes('群 1000 Agent 配置'))

    await longTermStore.storeMemoryHints({
        hints: [
            { scope: 'group', type: 'fact', content: '楠哥喜欢看 B 站科技区视频', confidence: 0.8 },
            { scope: 'user', type: 'preference', content: 'Tester 喜欢简短回复', confidence: 0.7 }
        ],
        sessionContext: { groupId: '1000', userId: '42', topicId: 'topic_memory' },
        agentMessage: { id: 'memory_msg_1' },
        decision: { action: 'short_reply' }
    })
    await longTermStore.storeMemoryHints({
        hints: [
            { scope: 'user', type: 'preference', content: 'OtherUser 的私有记忆不应暴露', confidence: 0.7 }
        ],
        sessionContext: { groupId: '1000', userId: '43', topicId: 'topic_memory' },
        agentMessage: { id: 'memory_msg_2' },
        decision: { action: 'short_reply' }
    })
    const memorySummaryPlan = toolRegistry.normalizeToolIntent({
        name: 'agent.get_memory_summary',
        arguments: { groupId: '1000', query: '楠哥' }
    }, { groupId: '1000', userId: '42' })
    assert.strictEqual(memorySummaryPlan.risk, 'low')
    assert.strictEqual(memorySummaryPlan.permission, 'read_agent_memory')
    const memorySummary = await toolRegistry.executeToolPlan(memorySummaryPlan)
    assert.ok(memorySummary.message.includes('楠哥'))
    assert.strictEqual(memorySummary.data.memories.length, 1)

    const memoryListPlan = toolRegistry.normalizeToolIntent({
        name: 'agent.get_memory_summary',
        arguments: { groupId: '1000' }
    }, { groupId: '1000', userId: '42' })
    const memoryList = await toolRegistry.executeToolPlan(memoryListPlan)
    assert.ok(memoryList.message.includes('简短回复'))
    assert.ok(!memoryList.message.includes('私有记忆'))

    subscriptionService.getSubscriptionsByGroup = async () => ({
        users: [{ uid: '2402855757', name: '楠哥' }],
        bangumis: [{ seasonId: '12345', title: '测试番剧' }]
    })
    const subscriptionListPlan = toolRegistry.normalizeToolIntent({
        name: 'subscription.list',
        arguments: { groupId: '1000' }
    }, { groupId: '1000' })
    assert.strictEqual(subscriptionListPlan.risk, 'low')
    assert.strictEqual(subscriptionListPlan.permission, 'read_subscriptions')
    const subscriptionListResult = await toolRegistry.executeToolPlan(subscriptionListPlan)
    assert.ok(subscriptionListResult.message.includes('用户 1 个'))
    assert.ok(subscriptionListResult.message.includes('番剧 1 个'))

    subscriptionService.getSubscriptionsByGroup = async () => ({
        users: [{
            uid: '2402855757',
            name: '楠哥',
            lastDynamicId: 'dyn_1',
            lastVideoId: 'BV1xx411c7mD',
            lastLiveStatus: 'offline'
        }],
        bangumis: [{ seasonId: '12345', title: '测试番剧', lastEpId: 'ep_1' }]
    })
    const userSubscriptionStatusPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.subscription_status',
        arguments: { groupId: '1000', uid: '2402855757' }
    }, { groupId: '1000' })
    assert.strictEqual(userSubscriptionStatusPlan.risk, 'low')
    assert.strictEqual(userSubscriptionStatusPlan.permission, 'read_subscriptions')
    const userSubscriptionStatus = await toolRegistry.executeToolPlan(userSubscriptionStatusPlan)
    assert.ok(userSubscriptionStatus.message.includes('已订阅'))
    assert.strictEqual(userSubscriptionStatus.data.subscribed, true)
    assert.strictEqual(userSubscriptionStatus.data.lastVideoId, 'BV1xx411c7mD')

    const bangumiSubscriptionStatusPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.subscription_status',
        arguments: { groupId: '1000', seasonId: '12345' }
    }, { groupId: '1000' })
    const bangumiSubscriptionStatus = await toolRegistry.executeToolPlan(bangumiSubscriptionStatusPlan)
    assert.ok(bangumiSubscriptionStatus.message.includes('测试番剧'))
    assert.strictEqual(bangumiSubscriptionStatus.data.subscribed, true)

    const missingSubscriptionStatusPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.subscription_status',
        arguments: { groupId: '1000', uid: '1' }
    }, { groupId: '1000' })
    const missingSubscriptionStatus = await toolRegistry.executeToolPlan(missingSubscriptionStatusPlan)
    assert.strictEqual(missingSubscriptionStatus.data.subscribed, false)

    biliApi.getUserInfo = async (uid, groupId) => ({
        status: 'success',
        type: 'user',
        data: {
            uid,
            name: '楠哥',
            level: 6,
            sign: '测试签名',
            likes: 100,
            archive_view: 200,
            live_room: { roomid: 123 }
        },
        groupId
    })
    const userLookupPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.user_lookup',
        arguments: { groupId: '1000', uid: '2402855757' }
    }, { groupId: '1000' })
    assert.strictEqual(userLookupPlan.risk, 'low')
    assert.strictEqual(userLookupPlan.permission, 'read_bili')
    const userLookupResult = await toolRegistry.executeToolPlan(userLookupPlan)
    assert.ok(userLookupResult.message.includes('楠哥'))
    assert.strictEqual(userLookupResult.data.uid, '2402855757')

    biliApi.searchUsers = async (keyword, groupId, options) => ({
        status: 'success',
        type: 'user_search',
        data: {
            query: keyword,
            page: 1,
            page_size: options.pageSize,
            total: 1,
            candidates: [{ uid: '2402855757', name: '梦桦楠', fans: 1000 }]
        },
        groupId
    })
    const userSearchPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.user_lookup',
        arguments: { groupId: '1000', keyword: '梦桦楠' }
    }, { groupId: '1000' })
    const userSearchResult = await toolRegistry.executeToolPlan(userSearchPlan)
    assert.ok(userSearchResult.message.includes('梦桦楠'))
    assert.strictEqual(userSearchResult.data.candidates[0].uid, '2402855757')

    biliApi.getVideoInfo = async (bvid, groupId) => ({
        status: 'success',
        type: 'video',
        data: {
            bvid,
            aid: 123,
            title: '测试视频',
            owner: { mid: 42, name: '测试UP' },
            stat: { view: 1000, like: 50, reply: 3, danmaku: 2 },
            duration: 125,
            pubdate: 1710000000
        },
        groupId
    })
    const videoLookupPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.video_lookup',
        arguments: { groupId: '1000', bvid: 'BV1xx411c7mD' }
    }, { groupId: '1000' })
    assert.strictEqual(videoLookupPlan.risk, 'low')
    assert.strictEqual(videoLookupPlan.permission, 'read_bili')
    const videoLookupResult = await toolRegistry.executeToolPlan(videoLookupPlan)
    assert.ok(videoLookupResult.message.includes('测试视频'))
    assert.ok(videoLookupResult.message.includes('测试UP'))
    assert.strictEqual(videoLookupResult.data.bvid, 'BV1xx411c7mD')
    const videoUrlLookupPlan = toolRegistry.normalizeToolIntent({
        name: 'bili.video_lookup',
        arguments: { groupId: '1000', id: 'https://www.bilibili.com/video/BV1xx411c7mD/' }
    }, { groupId: '1000' })
    assert.strictEqual(videoUrlLookupPlan.args.bvid, 'BV1xx411c7mD')

    const adminActionCalls = []
    notificationService.callAction = async (_ws, action, params) => {
        adminActionCalls.push({ action, params })
        if (action === 'get_group_member_info') {
            const userId = String(params.user_id)
            const roleByUser = {
                999: 'admin',
                42: 'admin',
                123: 'member',
                888: 'owner'
            }
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: params.group_id,
                    user_id: params.user_id,
                    nickname: `User${userId}`,
                    card: '',
                    role: roleByUser[userId] || 'member',
                    shut_up_timestamp: 0
                }
            }
        }
        if (action === 'get_group_info') {
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: params.group_id,
                    group_name: '测试群',
                    member_count: 10,
                    max_member_count: 500,
                    group_all_shut: 0
                }
            }
        }
        if (action === 'get_msg') {
            return {
                status: 'ok',
                retcode: 0,
                data: {
                    group_id: 1000,
                    message_id: params.message_id,
                    user_id: 123,
                    sender: { user_id: 123 }
                }
            }
        }
        return { status: 'ok', retcode: 0, data: {} }
    }

    const qqContext = {
        ws: makeWs(),
        groupId: '1000',
        selfId: '999',
        userId: '42',
        actor: {
            isRoot: false,
            userId: '42',
            groupId: '1000',
            qqRole: 'admin'
        },
        replyTarget: {
            messageId: 'reply-msg-1',
            userId: '123',
            isBot: false,
            text: '广告消息'
        }
    }
    const groupInfoPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_group_info',
        arguments: { groupId: '1000' }
    }, qqContext)
    assert.strictEqual(groupInfoPlan.permission, 'read_qq_group')
    const groupInfoResult = await toolRegistry.executeToolPlan(groupInfoPlan, qqContext)
    assert.ok(groupInfoResult.message.includes('测试群'))

    const memberInfoPlan = toolRegistry.normalizeToolIntent({
        name: 'qq.get_member_info',
        arguments: {}
    }, qqContext)
    assert.strictEqual(memberInfoPlan.args.targetUserId, '123')
    const memberInfoResult = await toolRegistry.executeToolPlan(memberInfoPlan, qqContext)
    assert.ok(memberInfoResult.message.includes('User123'))

    const mutePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.mute_member',
        arguments: { duration: 600 }
    }, qqContext)
    assert.strictEqual(mutePlan.risk, 'high')
    assert.strictEqual(mutePlan.permission, 'manage_qq_member')
    assert.ok(mutePlan.guardrails.includes('target_user_required'))
    assert.strictEqual(mutePlan.sideEffect, 'qq_group_write')
    const muteGuardrail = evaluateToolGuardrails({ plan: mutePlan, actor: qqContext.actor })
    assert.strictEqual(muteGuardrail.allowed, true)
    assert.ok(muteGuardrail.checks.some((check) => check.name === 'permission' && check.passed))
    const muteResult = await toolRegistry.executeToolPlan(mutePlan, qqContext)
    assert.ok(muteResult.message.includes('已禁言'))
    assert.ok(adminActionCalls.some((call) => call.action === 'set_group_ban' && call.params.duration === 600))

    const unsafeMuteGuardrail = evaluateToolGuardrails({
        plan: {
            ...mutePlan,
            args: { groupId: '1000', duration: 60 }
        },
        actor: qqContext.actor
    })
    assert.strictEqual(unsafeMuteGuardrail.allowed, false)
    assert.strictEqual(unsafeMuteGuardrail.reason, 'invalid_target_user_id')

    const deletePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.delete_message',
        arguments: {}
    }, qqContext)
    assert.strictEqual(deletePlan.args.messageId, 'reply-msg-1')
    const deleteResult = await toolRegistry.executeToolPlan(deletePlan, qqContext)
    assert.ok(deleteResult.message.includes('已撤回'))
    assert.ok(adminActionCalls.some((call) => call.action === 'delete_msg' && call.params.message_id === 'reply-msg-1'))

    const ownerMutePlan = toolRegistry.normalizeToolIntent({
        name: 'qq.mute_member',
        arguments: { targetUserId: '888', duration: 60 }
    }, qqContext)
    await assert.rejects(
        () => toolRegistry.executeToolPlan(ownerMutePlan, qqContext),
        /target_is_group_owner/
    )

    let llmCalls = 0
    llmClient.createChatCompletion = async () => {
        llmCalls += 1
        return {
            model: 'test-model',
            usage: { total_tokens: 20 },
            content: JSON.stringify({
                action: 'tool_plan',
                confidence: 0.98,
                reason: '管理员要求关闭 Agent 发言',
                topic: 'agent_config',
                replyStyle: 'serious',
                replyDraft: '',
                memoryHints: [],
                toolIntent: {
                    name: 'agent.set_send_enabled',
                    arguments: {
                        groupId: '1000',
                        enabled: false
                    }
                }
            })
        }
    }

    const ws = makeWs()
    const planResult = await agent.agentIngress.observe({
        ws,
        groupId: '1000',
        userId: '42',
        rawMessage: '小助手，关闭本群 Agent 发言',
        messageData: makeMessage('小助手，关闭本群 Agent 发言'),
        traceContext: { scope: 'test:tool-plan' }
    })

    assert.strictEqual(planResult.toolPlanResult.status, 'confirmation_required')
    assert.strictEqual(config._overrides.agent.groups['1000'].sendEnabled, true)
    assert.strictEqual(ws.sent.length, 1)
    assert.ok(ws.sent[0].params.message[0].data.text.includes('需要你确认'))

    const shortId = planResult.toolPlanResult.confirmation.shortId
    let pendingConfirmations = confirmationStore.listPendingConfirmations({ groupId: '1000', userId: '42' })
    assert.strictEqual(pendingConfirmations.length, 1)
    assert.strictEqual(pendingConfirmations[0].shortId, shortId)
    llmClient.createChatCompletion = async () => {
        llmCalls += 1
        return {
            model: 'test-model',
            usage: { total_tokens: 8 },
            content: JSON.stringify({
                action: 'observe_only',
                confidence: 0.2,
                reason: '裸确认不是明确工具确认',
                topic: 'tool_management',
                replyStyle: 'none',
                replyDraft: '',
                memoryHints: [],
                toolIntent: null
            })
        }
    }

    const nakedConfirmResult = await agent.agentIngress.observe({
        ws,
        groupId: '1000',
        userId: '42',
        rawMessage: '确认',
        messageData: makeMessage('确认'),
        traceContext: { scope: 'test:tool-naked-confirm' }
    })
    assert.strictEqual(nakedConfirmResult.toolConfirmation, undefined)
    assert.strictEqual(config._overrides.agent.groups['1000'].sendEnabled, true)
    assert.strictEqual(ws.sent.length, 1)
    assert.deepStrictEqual(
        confirmationStore.parseDecisionText(`[CQ:at,qq=999] 取消${shortId}`, shortId),
        { action: 'cancel', hasCode: true }
    )

    llmClient.createChatCompletion = async () => {
        llmCalls += 1
        return {
            model: 'test-model',
            usage: { total_tokens: 10 },
            content: JSON.stringify({
                action: 'short_reply',
                confidence: 0.96,
                reason: '根据工具执行结果生成最终回复',
                topic: 'tool_result',
                replyStyle: 'serious',
                replyDraft: '已处理：本群 Agent 发言已关闭。',
                memoryHints: [],
                toolIntent: null
            })
        }
    }

    const confirmResult = await agent.agentIngress.observe({
        ws,
        groupId: '1000',
        userId: '42',
        rawMessage: `确认 ${shortId}`,
        messageData: makeMessage(`确认 ${shortId}`),
        traceContext: { scope: 'test:tool-confirm' }
    })

    assert.strictEqual(confirmResult.toolConfirmation.status, 'executed')
    assert.strictEqual(config._overrides.agent.groups['1000'].sendEnabled, false)
    assert.strictEqual(confirmResult.toolConfirmation.toolReplyDecision.status, 'ok')
    assert.strictEqual(llmCalls, 3)
    assert.strictEqual(ws.sent.length, 2)
    assert.strictEqual(ws.sent[1].params.message[0].data.text, '已处理：本群 Agent 发言已关闭。')
    pendingConfirmations = confirmationStore.listPendingConfirmations({ groupId: '1000', userId: '42' })
    assert.strictEqual(pendingConfirmations.length, 0)

    confirmationStore.resetConfirmations()
    config._overrides.agent.groups['1000'].sendEnabled = true
    llmClient.createChatCompletion = async () => ({
        model: 'test-model',
        usage: { total_tokens: 20 },
        content: JSON.stringify({
            action: 'tool_plan',
            confidence: 0.98,
            reason: '普通成员尝试跨群关闭 Bot',
            topic: 'bot_config',
            replyStyle: 'serious',
            replyDraft: '',
            memoryHints: [],
            toolIntent: {
                name: 'bot.set_group_enabled',
                arguments: {
                    groupId: '2000',
                    enabled: false
                }
            }
        })
    })

    const deniedWs = makeWs()
    const deniedResult = await agent.agentIngress.observe({
        ws: deniedWs,
        groupId: '1000',
        userId: '42',
        rawMessage: '小助手，关掉 2000 群的 Bot',
        messageData: makeMessage('小助手，关掉 2000 群的 Bot', {
            sender: { nickname: 'Tester', role: 'member' }
        }),
        traceContext: { scope: 'test:tool-denied' }
    })

    assert.strictEqual(deniedResult.toolPlanResult.status, 'denied')
    assert.ok(deniedWs.sent[0].params.message[0].data.text.includes('跨群操作需要 Root 权限'))

    confirmationStore.resetConfirmations()
    config._overrides.agent.groups['1000'].sendEnabled = false
    llmClient.createChatCompletion = async () => ({
        model: 'test-model',
        usage: { total_tokens: 20 },
        content: JSON.stringify({
            action: 'tool_plan',
            confidence: 0.98,
            reason: '管理员要求开启 Agent 发言',
            topic: 'agent_config',
            replyStyle: 'serious',
            replyDraft: '',
            memoryHints: [],
            toolIntent: {
                name: 'agent.set_send_enabled',
                arguments: {
                    groupId: '1000',
                    enabled: true
                }
            }
        })
    })
    const enableWs = makeWs()
    const enablePlanResult = await agent.agentIngress.observe({
        ws: enableWs,
        groupId: '1000',
        userId: '42',
        rawMessage: '小助手，开启本群 Agent 发言',
        messageData: makeMessage('小助手，开启本群 Agent 发言'),
        traceContext: { scope: 'test:tool-enable-send-plan' }
    })
    assert.strictEqual(enablePlanResult.toolPlanResult.status, 'confirmation_required')
    assert.strictEqual(enableWs.sent.length, 1)
    assert.ok(enableWs.sent[0].params.message[0].data.text.includes('确认'))

    const enableConfirmResult = await agent.agentIngress.observe({
        ws: enableWs,
        groupId: '1000',
        userId: '42',
        rawMessage: `确认 ${enablePlanResult.toolPlanResult.confirmation.shortId}`,
        messageData: makeMessage(`确认 ${enablePlanResult.toolPlanResult.confirmation.shortId}`),
        traceContext: { scope: 'test:tool-enable-send-confirm' }
    })
    assert.strictEqual(enableConfirmResult.toolConfirmation.status, 'executed')
    assert.strictEqual(config._overrides.agent.groups['1000'].sendEnabled, true)

    notificationService.callAction = async () => ({
        status: 'ok',
        retcode: 0,
        data: {
            message_id: 'source-message',
            sender: { user_id: '999' },
            message: [{ type: 'text', data: { text: '你要第一个还是第二个？' } }],
            raw_message: '你要第一个还是第二个？'
        }
    })
    const replyContext = await resolveReplyContext({
        ws: { readyState: 1 },
        agentMessage: {
            id: 'reply-test',
            hasReply: true,
            replyMessageId: 'source-message',
            selfId: '999'
        },
        messageData: {},
        traceScope: 'test:reply-context'
    })
    assert.strictEqual(replyContext.replyToSelf, true)
    assert.strictEqual(replyContext.replyTarget.isBot, true)
    assert.strictEqual(replyContext.replyTarget.text, '你要第一个还是第二个？')

    const replyToSelf = await resolveReplyToSelf({
        ws: { readyState: 1 },
        agentMessage: {
            id: 'reply-test',
            hasReply: true,
            replyMessageId: 'source-message',
            selfId: '999'
        },
        messageData: {},
        traceScope: 'test:reply-resolve'
    })
    assert.strictEqual(replyToSelf, true)

    const replyFallbackMessage = normalizeMessage({
        rawMessage: '回复 Bot 的消息',
        messageSegments: [{ type: 'text', data: { text: '回复 Bot 的消息' } }],
        messageData: makeMessage('回复 Bot 的消息', {
            reply: {
                message_id: 'reply-source',
                sender: { user_id: '999' },
                message: [{ type: 'text', data: { text: '上一条 Bot 回复' } }]
            }
        }),
        aliases: ['小助手']
    })
    assert.strictEqual(replyFallbackMessage.hasReply, true)
    assert.strictEqual(replyFallbackMessage.replyMessageId, 'reply-source')

    const atMessage = normalizeMessage({
        rawMessage: '[CQ:at,qq=999] 楠哥的qq是这个[CQ:at,qq=2402855757]',
        messageSegments: [
            { type: 'at', data: { qq: '999' } },
            { type: 'text', data: { text: '楠哥的qq是这个' } },
            { type: 'at', data: { qq: '2402855757' } }
        ],
        messageData: makeMessage('[CQ:at,qq=999] 楠哥的qq是这个[CQ:at,qq=2402855757]'),
        aliases: ['小助手']
    })
    assert.strictEqual(atMessage.normalizedText, '@Bot 楠哥的qq是这个 @2402855757')
    assert.strictEqual(atMessage.mentionsSelf, true)

    assert.strictEqual(await resolveReplyToSelf({
        ws: { readyState: 1 },
        agentMessage: replyFallbackMessage,
        messageData: {
            reply: {
                message_id: 'reply-source',
                sender: { user_id: '999' },
                message: [{ type: 'text', data: { text: '上一条 Bot 回复' } }]
            }
        },
        traceScope: 'test:reply-fallback'
    }), true)

    const listedTools = toolRegistry.listToolDefinitions()
    assert.ok(listedTools.length >= 40)
    for (const tool of listedTools) {
        assert.ok(tool.paramsSchema, `${tool.name} should expose paramsSchema`)
        assert.strictEqual(tool.paramsSchema.type, 'object', `${tool.name} paramsSchema should be object`)
        assert.ok(tool.sideEffect, `${tool.name} should expose sideEffect`)
        assert.ok(Number.isFinite(tool.timeoutMs), `${tool.name} should expose timeoutMs`)
        assert.ok(Array.isArray(tool.guardrails), `${tool.name} should expose guardrails`)
        assert.ok(tool.resultSchema, `${tool.name} should expose resultSchema`)
        assert.strictEqual(tool.resultSchema.type, 'object', `${tool.name} resultSchema should be object`)
    }

    const timeoutDefinition = toolRegistry.getToolDefinition('agent.get_group_config')
    const originalTimeoutExecute = timeoutDefinition.execute
    const originalTimeoutMs = timeoutDefinition.timeoutMs
    try {
        timeoutDefinition.timeoutMs = 1
        timeoutDefinition.execute = async () => new Promise((resolve) => setTimeout(() => resolve({ message: 'late' }), 20))
        await assert.rejects(
            () => toolRegistry.executeToolPlan({ name: 'agent.get_group_config', args: { groupId: '1000' } }),
            /tool_timeout:agent\.get_group_config:1/
        )
    } finally {
        timeoutDefinition.execute = originalTimeoutExecute
        timeoutDefinition.timeoutMs = originalTimeoutMs
    }

    console.log('✓ Agent 受限工具计划和确认链路正常')
}

run()
    .then(() => {
        restore()
        process.exit(0)
    })
    .catch((error) => {
        restore()
        console.error(error)
        process.exit(1)
    })
