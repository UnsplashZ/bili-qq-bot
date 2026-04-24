#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const config = require(path.join(__dirname, '../../src/config'))
const agent = require(path.join(__dirname, '../../src/agent'))
const llmClient = require(path.join(__dirname, '../../src/agent/runtime/llmClient'))
const shortTermStore = require(path.join(__dirname, '../../src/agent/memory/shortTermStore'))
const longTermStore = require(path.join(__dirname, '../../src/agent/memory/longTermStore'))
const budgetGuard = require(path.join(__dirname, '../../src/agent/runtime/budgetGuard'))
const replyGuard = require(path.join(__dirname, '../../src/agent/runtime/replyGuard'))
const confirmationStore = require(path.join(__dirname, '../../src/agent/tools/confirmationStore'))
const notificationService = require(path.join(__dirname, '../../src/services/notificationService'))
const { normalizeMessage } = require(path.join(__dirname, '../../src/agent/ingress/messageNormalizer'))
const { resolveReplyToSelf } = require(path.join(__dirname, '../../src/agent/ingress/agentIngress'))

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
    if (originals.apiKey === undefined) {
        delete process.env.AGENT_API_KEY
    } else {
        process.env.AGENT_API_KEY = originals.apiKey
    }
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
    assert.strictEqual(llmCalls, 2)
    assert.strictEqual(ws.sent.length, 2)
    assert.ok(ws.sent[1].params.message[0].data.text.includes('已关闭群 1000 的 Agent 发言'))

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
            sender: { user_id: '999' }
        }
    })
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
                sender: { user_id: '999' }
            }
        }),
        aliases: ['小助手']
    })
    assert.strictEqual(replyFallbackMessage.hasReply, true)
    assert.strictEqual(replyFallbackMessage.replyMessageId, 'reply-source')
    assert.strictEqual(await resolveReplyToSelf({
        ws: { readyState: 1 },
        agentMessage: replyFallbackMessage,
        messageData: {
            reply: {
                message_id: 'reply-source',
                sender: { user_id: '999' }
            }
        },
        traceScope: 'test:reply-fallback'
    }), true)

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
