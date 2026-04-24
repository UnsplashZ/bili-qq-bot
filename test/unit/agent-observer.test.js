#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const config = require(path.join(__dirname, '../../src/config'))
const logger = require(path.join(__dirname, '../../src/utils/logger'))
const agent = require(path.join(__dirname, '../../src/agent'))
const shortTermStore = require(path.join(__dirname, '../../src/agent/memory/shortTermStore'))
const llmClient = require(path.join(__dirname, '../../src/agent/runtime/llmClient'))
const commandManager = require(path.join(__dirname, '../../src/commands'))
const linkService = require(path.join(__dirname, '../../src/services/link'))

const originals = {
    agentConfig: config._overrides.agent,
    isRootAdmin: config.isRootAdmin,
    isGroupAdmin: config.isGroupAdmin,
    isGroupEnabled: config.isGroupEnabled,
    ensureGroupConfig: config.ensureGroupConfig,
    blacklistedQQs: config.blacklistedQQs,
    groupConfigs: config.groupConfigs,
    commandDispatch: commandManager.dispatch,
    prepareIncomingMessageLinks: linkService.prepareIncomingMessageLinks,
    agentObserve: agent.agentIngress.observe,
    createChatCompletion: llmClient.createChatCompletion
}

function restore() {
    if (originals.agentConfig === undefined) {
        delete config._overrides.agent
    } else {
        config._overrides.agent = originals.agentConfig
    }
    config.isRootAdmin = originals.isRootAdmin
    config.isGroupAdmin = originals.isGroupAdmin
    config.isGroupEnabled = originals.isGroupEnabled
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.blacklistedQQs = originals.blacklistedQQs
    config.groupConfigs = originals.groupConfigs
    commandManager.dispatch = originals.commandDispatch
    linkService.prepareIncomingMessageLinks = originals.prepareIncomingMessageLinks
    agent.agentIngress.observe = originals.agentObserve
    llmClient.createChatCompletion = originals.createChatCompletion
    shortTermStore.reset()
}

function enableAgent(overrides = {}) {
    config._overrides.agent = {
        enabled: true,
        observeOnly: true,
        logTrajectory: false,
        defaultGroupEnabled: true,
        aliases: ['小助手'],
        shortTerm: {
            maxRecentMessagesPerGroup: 100,
            topicIdleMs: 1800000,
            crowdedMessagesPerMinute: 8
        },
        replyPolicy: {
            minReplyScore: 0.72,
            cooldownMs: 30000
        },
        decisionMode: 'rule_only',
        sendEnabled: false,
        llm: {
            enabled: false,
            provider: 'openai-compatible',
            baseURL: '',
            model: '',
            apiKeyEnv: 'AGENT_API_KEY',
            timeoutMs: 12000,
            temperature: 0.2,
            maxTokens: 500
        },
        groups: {},
        ...overrides
    }
}

function makeMessageData(rawMessage, extra = {}) {
    return {
        message_type: 'group',
        group_id: '1000',
        user_id: '42',
        self_id: '999',
        message_id: 'm1',
        raw_message: rawMessage,
        message: [{ type: 'text', data: { text: rawMessage } }],
        sender: { nickname: 'Tester', role: 'member' },
        ...extra
    }
}

function prepareRuntime() {
    config.isRootAdmin = () => false
    config.isGroupAdmin = () => false
    config.isGroupEnabled = () => true
    config.ensureGroupConfig = () => {}
    config.blacklistedQQs = []
    config.groupConfigs = {}
    commandManager.dispatch = async () => false
    linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
        rawMessage,
        safeRawMessage: rawMessage,
        descriptors: []
    })
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        shortTermStore.reset()
        config._overrides.agent = {
            enabled: false,
            observeOnly: true,
            logTrajectory: false,
            defaultGroupEnabled: true
        }

        const disabledResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手在吗？',
            messageData: makeMessageData('小助手在吗？'),
            traceContext: { scope: 'test:disabled' }
        })
        assert.deepStrictEqual(disabledResult, { skipped: true, reason: 'agent_disabled' })

        shortTermStore.reset()
        enableAgent()
        const decisionResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，帮我看看订阅怎么设置？',
            messageData: makeMessageData('小助手，帮我看看订阅怎么设置？', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，帮我看看订阅怎么设置？' } }
                ],
                sender: { nickname: 'Tester', role: 'admin' }
            }),
            traceContext: { scope: 'test:observe' }
        })
        assert.strictEqual(decisionResult.skipped, false)
        assert.strictEqual(decisionResult.decision.action, 'observe_only')
        assert.strictEqual(decisionResult.decision.wouldReply, true)
        assert.ok(decisionResult.score.reasons.includes('mentioned_bot'))
        assert.ok(decisionResult.score.reasons.includes('bot_management_topic'))
        assert.strictEqual(decisionResult.session.actor.canManageGroupConfig, true)
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('observe-decision')))

        shortTermStore.reset()
        let capturedMessages = null
        enableAgent({
            decisionMode: 'llm_shadow',
            llm: {
                enabled: true,
                provider: 'openai-compatible',
                baseURL: 'https://example.test/v1',
                model: 'test-model',
                apiKeyEnv: 'AGENT_API_KEY',
                timeoutMs: 12000,
                temperature: 0.2,
                maxTokens: 500
            }
        })
        process.env.AGENT_API_KEY = 'test-key'
        llmClient.createChatCompletion = async ({ messages }) => {
            capturedMessages = messages
            return {
                model: 'test-model',
                usage: { total_tokens: 12 },
                content: JSON.stringify({
                    action: 'short_reply',
                    confidence: 0.93,
                    reason: '用户明确 @ 我并要求介绍自己',
                    topic: 'bot_identity',
                    replyStyle: 'friendly_brief',
                    replyDraft: '我是 Bilibili 助手，目前还在观察模式。',
                    memoryHints: [],
                    toolIntent: null
                })
            }
        }
        const llmResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，介绍一下你自己',
            messageData: makeMessageData('小助手，介绍一下你自己', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，介绍一下你自己' } }
                ]
            }),
            traceContext: { scope: 'test:llm-shadow' }
        })
        assert.strictEqual(llmResult.llmDecision.status, 'ok')
        assert.strictEqual(llmResult.llmDecision.decision.action, 'short_reply')
        assert.strictEqual(llmResult.llmDecision.decision.replyDraft, '我是 Bilibili 助手，目前还在观察模式。')
        assert.ok(Array.isArray(capturedMessages))
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('llm-decision')))

        prepareRuntime()
        const handler = require(path.join(__dirname, '../../src/handlers/messageHandler'))
        let observed = 0
        agent.agentIngress.observe = async () => {
            observed += 1
            return { skipped: false }
        }
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('普通群聊消息'))
        assert.strictEqual(observed, 1)

        observed = 0
        commandManager.dispatch = async () => true
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('/帮助'))
        assert.strictEqual(observed, 0)

        commandManager.dispatch = async () => false
        agent.agentIngress.observe = async () => {
            throw new Error('observe boom')
        }
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('触发失败隔离'))
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('observe-failed')))

        console.log('✓ Agent Phase 1 observer 默认关闭、只观察决策与接入顺序正常')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        restore()
        process.exit(1)
    })
