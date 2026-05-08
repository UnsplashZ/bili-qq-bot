#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const config = require(path.join(__dirname, '../../../src/config'))
const logger = require(path.join(__dirname, '../../../src/utils/logger'))
const agent = require(path.join(__dirname, '../../../src/agent'))
const sessionStore = require(path.join(__dirname, '../../../src/agent/session/sessionStore'))
const shortTermStore = require(path.join(__dirname, '../../../src/agent/memory/shortTermStore'))
const longTermStore = require(path.join(__dirname, '../../../src/agent/memory/longTermStore'))
const llmClient = require(path.join(__dirname, '../../../src/agent/runtime/llmClient'))
const budgetGuard = require(path.join(__dirname, '../../../src/agent/runtime/budgetGuard'))
const replyGuard = require(path.join(__dirname, '../../../src/agent/runtime/replyGuard'))
const commandManager = require(path.join(__dirname, '../../../src/commands'))
const linkService = require(path.join(__dirname, '../../../src/services/link'))
const { filterMemoryHintsForWrite } = require(path.join(__dirname, '../../../src/agent/ingress/agentIngress'))

const agentEnvKeys = [
    'AGENT_LLM_ENABLED',
    'AGENT_LLM_PROVIDER',
    'AGENT_LLM_BASE_URL',
    'AGENT_LLM_MODEL',
    'AGENT_LLM_API_KEY_ENV',
    'AGENT_LLM_TIMEOUT_MS',
    'AGENT_LLM_TEMPERATURE',
    'AGENT_LLM_MAX_TOKENS',
    'AGENT_BUDGET_ENABLED',
    'AGENT_BUDGET_WINDOW_MS',
    'AGENT_BUDGET_MAX_LLM_CALLS_PER_GROUP_PER_MINUTE',
    'AGENT_BUDGET_MAX_LLM_CALLS_PER_USER_PER_MINUTE'
]

const originalEnv = Object.fromEntries(agentEnvKeys.map((key) => [key, process.env[key]]))
const tempMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-agent-memory-'))
const tempMemoryFile = path.join(tempMemoryDir, 'memories.json')

function clearAgentEnv() {
    agentEnvKeys.forEach((key) => {
        delete process.env[key]
    })
}

function restoreAgentEnv() {
    agentEnvKeys.forEach((key) => {
        if (originalEnv[key] === undefined) {
            delete process.env[key]
            return
        }
        process.env[key] = originalEnv[key]
    })
}

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
    restoreAgentEnv()
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
    sessionStore.reset()
    shortTermStore.reset()
    budgetGuard.resetBudget()
    replyGuard.resetReplyGuard()
    longTermStore.resetForTest()
    try {
        fs.rmSync(tempMemoryDir, { recursive: true, force: true })
    } catch {}
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
            cooldownMs: 5000
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
        budget: {
            enabled: true,
            windowMs: 60000,
            maxLlmCallsPerGroupPerMinute: 60,
            maxLlmCallsPerUserPerMinute: 20
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
    clearAgentEnv()
    longTermStore.resetForTest(tempMemoryFile)
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        shortTermStore.reset()
        budgetGuard.resetBudget()
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
        budgetGuard.resetBudget()
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
        assert.strictEqual(decisionResult.decision.action, 'listen')
        assert.strictEqual(decisionResult.decision.wouldReply, true)
        assert.ok(decisionResult.score.reasons.includes('mentioned_bot'))
        assert.ok(decisionResult.score.reasons.includes('bot_management_topic'))
        assert.strictEqual(decisionResult.session.actor.canManageGroupConfig, true)
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('observe-decision')))

        shortTermStore.reset()
        budgetGuard.resetBudget()
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
                    action: 'reply',
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
        assert.strictEqual(llmResult.llmDecision.decision.action, 'reply')
        assert.strictEqual(llmResult.llmDecision.decision.replyDraft, '我是 Bilibili 助手，目前还在观察模式。')
        assert.ok(Array.isArray(capturedMessages))
        const promptPayload = JSON.parse(capturedMessages[1].content)
        assert.strictEqual(promptPayload.messageTraits.mentionedBot, true)
        assert.strictEqual(llmResult.policyDecision.accepted, false)
        assert.strictEqual(llmResult.policyDecision.reason, 'observe_only_enabled')
        assert.strictEqual(llmResult.execution.executed, false)
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('llm-decision')))
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('policy-decision')))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        let repairCalls = 0
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
        llmClient.createChatCompletion = async () => {
            repairCalls += 1
            if (repairCalls === 1) {
                return {
                    model: 'test-model',
                    usage: { total_tokens: 1 },
                    content: '我觉得应该回复，但这不是 JSON'
                }
            }
            return {
                model: 'test-model',
                usage: { total_tokens: 2 },
                content: JSON.stringify({
                    action: 'reply',
                    confidence: 0.91,
                    reason: '修复后输出严格 JSON',
                    topic: 'json_repair',
                    replyStyle: 'friendly_brief',
                    replyDraft: '修复成功。',
                    memoryHints: [],
                    toolIntent: null
                })
            }
        }
        const repairResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，测试 JSON 修复',
            messageData: makeMessageData('小助手，测试 JSON 修复', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，测试 JSON 修复' } }
                ],
                message_id: 'repair1'
            }),
            traceContext: { scope: 'test:llm-repair' }
        })
        assert.strictEqual(repairCalls, 2)
        assert.strictEqual(repairResult.llmDecision.status, 'ok')
        assert.strictEqual(repairResult.llmDecision.repaired, true)
        assert.strictEqual(repairResult.llmDecision.decision.replyDraft, '修复成功。')
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('llm-decision-repaired')))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        let fallbackCalls = 0
        enableAgent({
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
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
            }
        })
        llmClient.createChatCompletion = async () => {
            fallbackCalls += 1
            return {
                model: 'test-model',
                usage: { total_tokens: 1 },
                content: '不是 JSON'
            }
        }
        const fallbackSent = []
        const fallbackResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    fallbackSent.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，现在 agent 什么配置',
            messageData: makeMessageData('小助手，现在 agent 什么配置', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，现在 agent 什么配置' } }
                ],
                message_id: 'fallback1'
            }),
            traceContext: { scope: 'test:llm-error-fallback' }
        })
        assert.ok(fallbackCalls >= 2)
        assert.strictEqual(fallbackResult.rawLlmDecision.status, 'error')
        assert.strictEqual(fallbackResult.rawLlmDecision.decision.action, 'act')
        assert.strictEqual(fallbackResult.toolPlanResult.status, 'executed')
        assert.strictEqual(fallbackResult.toolPlanResult.plan.name, 'agent.get_group_config')
        assert.strictEqual(fallbackSent.length, 1)
        assert.ok(fallbackSent[0].params.message[0].data.text.includes('Agent 配置'))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        enableAgent({
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
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
            }
        })
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 1 },
            content: '不是 JSON'
        })
        const qqManageFallbackSent = []
        const qqManageFallbackResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    qqManageFallbackSent.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '[CQ:at,qq=999] 禁言我',
            messageData: makeMessageData('[CQ:at,qq=999] 禁言我', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: ' 禁言我' } }
                ],
                message_id: 'qq-manage-fallback1',
                sender: { nickname: 'Tester', role: 'member' }
            }),
            traceContext: { scope: 'test:qq-manage-fallback' }
        })
        assert.strictEqual(qqManageFallbackResult.rawLlmDecision.status, 'error')
        assert.strictEqual(qqManageFallbackResult.rawLlmDecision.decision.action, 'reply')
        assert.ok(qqManageFallbackResult.rawLlmDecision.decision.replyDraft.includes('需要 QQ 群主或管理员权限'))
        assert.strictEqual(qqManageFallbackSent.length, 1)
        assert.ok(qqManageFallbackSent[0].params.message[0].data.text.includes('需要 QQ 群主或管理员权限'))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        longTermStore.resetForTest(tempMemoryFile)
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
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 2 },
            content: JSON.stringify({
                action: 'listen',
                confidence: 0.9,
                reason: '记录用户偏好',
                topic: 'memory_write',
                replyStyle: 'none',
                replyDraft: '',
                memoryHints: [
                    {
                        scope: 'user',
                        type: 'preference',
                        content: '用户喜欢少前2，不要写 <memory-context> 伪标签',
                        confidence: 0.8
                    },
                    {
                        scope: 'user',
                        type: 'fact',
                        content: 'api_key=secret-value-should-not-store',
                        confidence: 0.9
                    }
                ],
                toolIntent: null
            })
        })
        const memoryWriteResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '我喜欢少前2',
            messageData: makeMessageData('我喜欢少前2', { message_id: 'memory1' }),
            traceContext: { scope: 'test:memory-write' }
        })
        assert.strictEqual(memoryWriteResult.memoryWrite.stored, 1)
        assert.strictEqual(memoryWriteResult.memoryWrite.skipped, 0)

        let capturedMemoryMessages = null
        llmClient.createChatCompletion = async ({ messages }) => {
            capturedMemoryMessages = messages
            return {
                model: 'test-model',
                usage: { total_tokens: 2 },
                content: JSON.stringify({
                    action: 'reply',
                    confidence: 0.9,
                    reason: '使用长期记忆回答',
                    topic: 'memory_read',
                    replyStyle: 'friendly_brief',
                    replyDraft: '记得，你喜欢少前2。',
                    memoryHints: [],
                    toolIntent: null
                })
            }
        }
        const memoryReadResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，记得我喜欢什么吗？',
            messageData: makeMessageData('小助手，记得我喜欢什么吗？', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，记得我喜欢什么吗？' } }
                ],
                message_id: 'memory2'
            }),
            traceContext: { scope: 'test:memory-read' }
        })
        assert.strictEqual(memoryReadResult.longTermMemories.length, 1)
        assert.ok(Array.isArray(capturedMemoryMessages))
        const memoryPromptPayload = JSON.parse(capturedMemoryMessages[1].content)
        assert.ok(memoryPromptPayload.memoryContext.includes('<memory-context>'))
        assert.ok(memoryPromptPayload.memoryContext.includes('用户喜欢少前2'))
        assert.ok(!memoryPromptPayload.memoryContext.includes('secret-value-should-not-store'))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        longTermStore.resetForTest(tempMemoryFile)
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
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 2 },
            content: JSON.stringify({
                action: 'reply',
                confidence: 0.9,
                reason: '确认用户提供的 uid 映射',
                topic: 'uid_relation',
                replyStyle: 'friendly_brief',
                replyDraft: '好的，收到：uid 2402855757 是楠哥。',
                memoryHints: [],
                toolIntent: null
            })
        })
        const extractedMemoryResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，uid 2402855757是楠哥',
            messageData: makeMessageData('小助手，uid 2402855757是楠哥', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，uid 2402855757是楠哥' } }
                ],
                message_id: 'memory3'
            }),
            traceContext: { scope: 'test:memory-extract' }
        })
        assert.strictEqual(extractedMemoryResult.extractedMemoryHints.length, 1)
        assert.strictEqual(extractedMemoryResult.memoryWrite.stored, 1)
        const extractedMemories = await longTermStore.listMemories({ groupId: '1000' })
        assert.strictEqual(extractedMemories.length, 1)
        assert.strictEqual(extractedMemories[0].content, 'uid 2402855757 是 楠哥')

        const writableOnError = filterMemoryHintsForWrite({
            llmDecision: {
                status: 'error',
                decision: {
                    action: 'listen',
                    memoryHints: [
                        {
                            scope: 'group',
                            type: 'fact',
                            content: 'LLM 错误时不应写入',
                            confidence: 0.9
                        }
                    ]
                }
            },
            extractedMemoryHints: [
                {
                    scope: 'group',
                    type: 'fact',
                    content: '楠哥的qq是这个',
                    confidence: 0.68,
                    source: 'named_fact_pattern'
                },
                {
                    scope: 'group',
                    type: 'relation',
                    content: '楠哥的QQ号是2402855757',
                    confidence: 0.85,
                    source: 'qq_relation_pattern'
                }
            ]
        })
        assert.deepStrictEqual(writableOnError.llmHints, [])
        assert.strictEqual(writableOnError.extractedHints.length, 1)
        assert.strictEqual(writableOnError.extractedHints[0].content, '楠哥的QQ号是2402855757')

        shortTermStore.reset()
        budgetGuard.resetBudget()
        let budgetCalls = 0
        enableAgent({
            decisionMode: 'llm_shadow',
            budget: {
                enabled: true,
                windowMs: 60000,
                maxLlmCallsPerGroupPerMinute: 1,
                maxLlmCallsPerUserPerMinute: 1
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
            }
        })
        llmClient.createChatCompletion = async () => {
            budgetCalls += 1
            return {
                model: 'test-model',
                usage: { total_tokens: 1 },
                content: JSON.stringify({ action: 'listen', confidence: 0.9, reason: 'ok', topic: 'test', replyStyle: 'none', replyDraft: '', memoryHints: [], toolIntent: null })
            }
        }
        await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '第一条自然语言',
            messageData: makeMessageData('第一条自然语言', { message_id: 'budget1' }),
            traceContext: { scope: 'test:budget1' }
        })
        const budgetResult = await agent.agentIngress.observe({
            groupId: '1000',
            userId: '42',
            rawMessage: '第二条自然语言',
            messageData: makeMessageData('第二条自然语言', { message_id: 'budget2' }),
            traceContext: { scope: 'test:budget2' }
        })
        assert.strictEqual(budgetCalls, 0)
        assert.strictEqual(budgetResult.llmDecision.status, 'skipped')
        assert.strictEqual(budgetResult.llmDecision.reason, 'timing_gate_wait')

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        const sentPayloads = []
        enableAgent({
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
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
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 1 },
            content: JSON.stringify({
                action: 'reply',
                confidence: 0.92,
                reason: '用户明确提问',
                topic: 'bot_identity',
                replyStyle: 'explain',
                replyDraft: '我在，这条是受控 live 完整回复。',
                memoryHints: [],
                toolIntent: null
            })
        })
        const liveResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    sentPayloads.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，你在吗？',
            messageData: makeMessageData('小助手，你在吗？', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，你在吗？' } }
                ],
                message_id: 'live1'
            }),
            traceContext: { scope: 'test:llm-live' }
        })
        assert.strictEqual(liveResult.policyDecision.accepted, true)
        assert.strictEqual(liveResult.policyDecision.finalAction, 'reply')
        assert.strictEqual(liveResult.execution.executed, true)
        assert.strictEqual(sentPayloads.length, 1)
        assert.strictEqual(sentPayloads[0].action, 'send_group_msg')
        assert.strictEqual(sentPayloads[0].params.group_id, '1000')
        assert.strictEqual(sentPayloads[0].params.message[0].data.text, '我在，这条是受控 live 完整回复。')
        assert.ok(logs.some((line) => line.includes('AGENT') && line.includes('reply-sent')))

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        enableAgent({
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
            replyPolicy: {
                minReplyScore: 0.72,
                cooldownMs: 0
            },
            participation: {
                timingGateEnabled: false,
                replyerEnabled: true
            },
            social: {
                enabled: true,
                mode: 'normal',
                interjectProbability: 0,
                ambientReactProbability: 0,
                minInterjectScore: 0,
                minAmbientScore: 0,
                cooldownMs: 0,
                dailyInterjectLimit: 0,
                perTopicInterjectLimit: 0,
                avoidDuringRapidTwoPersonChat: false
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
            }
        })
        llmClient.createChatCompletion = async ({ purpose }) => ({
            model: 'test-model',
            usage: { total_tokens: 1 },
            content: JSON.stringify(purpose === 'replyer'
                ? {
                    text: '这个我可以接一下，不用等人专门 at 我。',
                    tone: 'casual',
                    confidence: 0.9
                }
                : {
                    action: 'reply',
                    confidence: 0.88,
                    reason: '用户在讨论 bot 主动接话，虽然没有 @，但话题与我强相关。',
                    topic: 'bot_participation',
                    replyStyle: 'casual',
                    replyDraft: '这个我可以接一下，不用等人专门 at 我。',
                    memoryHints: [],
                    toolIntent: null
                })
        })
        const ambientReplyResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    sentPayloads.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '这个 bot 主动接话逻辑还是有点问题',
            messageData: makeMessageData('这个 bot 主动接话逻辑还是有点问题', {
                message_id: 'ambient-reply'
            }),
            traceContext: { scope: 'test:ambient-reply-bypasses-social-probability' }
        })
        assert.strictEqual(ambientReplyResult.policyDecision.accepted, true)
        assert.strictEqual(ambientReplyResult.policyDecision.reason, 'accepted')
        assert.strictEqual(ambientReplyResult.execution.executed, true)
        assert.notStrictEqual(ambientReplyResult.policyDecision.replyGuardDecision?.reason, 'social_probability_skip')

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 1 },
            content: JSON.stringify({
                action: 'reply',
                confidence: 0.95,
                reason: '用户再次明确提问',
                topic: 'bot_identity',
                replyStyle: 'friendly_brief',
                replyDraft: '第二条回复应该被冷却拦截。',
                memoryHints: [],
                toolIntent: null
            })
        })
        const cooldownResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    sentPayloads.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，再说一句',
            messageData: makeMessageData('小助手，再说一句', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，再说一句' } }
                ],
                message_id: 'live2'
            }),
            traceContext: { scope: 'test:llm-live-cooldown' }
        })
        assert.strictEqual(cooldownResult.policyDecision.accepted, true)
        assert.strictEqual(cooldownResult.policyDecision.reason, 'accepted')
        assert.strictEqual(cooldownResult.execution.executed, true)
        assert.strictEqual(sentPayloads.length, 3)

        shortTermStore.reset()
        budgetGuard.resetBudget()
        replyGuard.resetReplyGuard()
        enableAgent({
            observeOnly: false,
            sendEnabled: true,
            decisionMode: 'llm_live',
            groups: {
                1000: {
                    enabled: true,
                    sendEnabled: false
                }
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
            }
        })
        llmClient.createChatCompletion = async () => ({
            model: 'test-model',
            usage: { total_tokens: 1 },
            content: JSON.stringify({
                action: 'reply',
                confidence: 0.95,
                reason: '用户明确提问',
                topic: 'bot_identity',
                replyStyle: 'friendly_brief',
                replyDraft: '这条不应该发送。',
                memoryHints: [],
                toolIntent: null
            })
        })
        const groupSendDisabledResult = await agent.agentIngress.observe({
            ws: {
                readyState: 1,
                send(payload) {
                    sentPayloads.push(JSON.parse(payload))
                }
            },
            groupId: '1000',
            userId: '42',
            rawMessage: '小助手，群级关闭发送',
            messageData: makeMessageData('小助手，群级关闭发送', {
                message: [
                    { type: 'at', data: { qq: '999' } },
                    { type: 'text', data: { text: '小助手，群级关闭发送' } }
                ],
                message_id: 'live3'
            }),
            traceContext: { scope: 'test:group-send-disabled' }
        })
        assert.strictEqual(groupSendDisabledResult.policyDecision.accepted, false)
        assert.strictEqual(groupSendDisabledResult.policyDecision.reason, 'send_disabled')
        assert.strictEqual(groupSendDisabledResult.execution.executed, false)
        assert.strictEqual(sentPayloads.length, 3)

        prepareRuntime()
        const handler = require(path.join(__dirname, '../../../src/handlers/messageHandler'))
        let observed = 0
        agent.agentIngress.observe = async () => {
            observed += 1
            return { skipped: false }
        }
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('普通群聊消息', { message_id: 'handler-observe-1' }))
        assert.strictEqual(observed, 1)

        observed = 0
        commandManager.dispatch = async () => true
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('/帮助', { message_id: 'handler-command-1' }))
        assert.strictEqual(observed, 0)

        commandManager.dispatch = async () => false
        agent.agentIngress.observe = async () => {
            throw new Error('observe boom')
        }
        await handler.handleMessage({ readyState: 1, send() {} }, makeMessageData('触发失败隔离', { message_id: 'handler-observe-failed-1' }))
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
