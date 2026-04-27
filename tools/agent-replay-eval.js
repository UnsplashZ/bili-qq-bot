#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const { normalizeAgentConfig } = require('../src/agent/config/agentConfig')
const { normalizeMessage } = require('../src/agent/ingress/messageNormalizer')
const shortTermStore = require('../src/agent/memory/shortTermStore')
const { scoreMessage } = require('../src/agent/cognition/relevanceScorer')
const { decideReply } = require('../src/agent/cognition/replyDecision')
const { selectContext } = require('../src/agent/context/contextSelector')
const { buildDecisionMessages } = require('../src/agent/runtime/promptBuilder')

const FIXTURE_DIR = path.join(__dirname, '../test/fixtures/agent-replay')
const DEFAULT_ALIASES = ['小助手']

function parseArgs(argv) {
    const args = { mode: 'deterministic', fixturesDir: FIXTURE_DIR, out: '' }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === '--mode') args.mode = argv[++index] || args.mode
        else if (arg === '--fixtures') args.fixturesDir = path.resolve(argv[++index] || args.fixturesDir)
        else if (arg === '--out') args.out = path.resolve(argv[++index] || '')
    }
    return args
}

function readJsonl(filePath) {
    const content = fs.readFileSync(filePath, 'utf8')
    return content.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            try {
                return JSON.parse(line)
            } catch (error) {
                throw new Error(`${filePath}:${index + 1}: ${error.message}`)
            }
        })
}

function loadReplayCases(fixturesDir = FIXTURE_DIR) {
    if (!fs.existsSync(fixturesDir)) return []
    return fs.readdirSync(fixturesDir)
        .filter((fileName) => fileName.endsWith('.jsonl'))
        .sort()
        .flatMap((fileName) => readJsonl(path.join(fixturesDir, fileName)).map((item) => ({
            ...item,
            fixture: fileName
        })))
}

function buildMessageData({ sample, message }) {
    const selfId = String(sample.input.selfId || '999')
    const text = String(message.text || '')
    const segments = []
    if (message.replyTo) segments.push({ type: 'reply', data: { id: String(message.replyTo) } })
    const mentionIds = Array.isArray(message.mentions) ? message.mentions.map(String) : []
    for (const mention of mentionIds) {
        segments.push({ type: 'at', data: { qq: mention } })
    }
    segments.push({ type: 'text', data: { text } })

    return {
        self_id: selfId,
        message_id: String(message.id || ''),
        group_id: String(sample.input.groupId || ''),
        user_id: String(message.userId || ''),
        message_type: 'group',
        time: Math.floor(Number(message.timestamp || Date.now()) / 1000),
        message: segments,
        raw_message: text,
        sender: {
            user_id: String(message.userId || ''),
            nickname: String(message.nickname || ''),
            card: String(message.card || ''),
            role: String(message.senderRole || 'member')
        }
    }
}

function buildReplayMessage({ sample, message, aliases }) {
    const messageData = buildMessageData({ sample, message })
    const normalized = normalizeMessage({
        rawMessage: message.text,
        messageSegments: messageData.message,
        messageData,
        aliases
    })
    normalized.id = String(message.id || normalized.id)
    normalized.timestamp = Number(message.timestamp || normalized.timestamp)
    normalized.role = message.role || (String(message.userId) === String(sample.input.selfId) ? 'assistant' : 'user')
    normalized.replyToSelf = Boolean(message.replyTo && sample.input.messages.some((candidate) => (
        String(candidate.id) === String(message.replyTo) && String(candidate.userId) === String(sample.input.selfId)
    )))
    if (message.replyTo) {
        const target = sample.input.messages.find((candidate) => String(candidate.id) === String(message.replyTo))
        normalized.replyTarget = target
            ? {
                messageId: String(target.id),
                userId: String(target.userId),
                isBot: String(target.userId) === String(sample.input.selfId),
                text: String(target.text || '')
            }
            : null
    }
    return normalized
}

function replaySample(sample, options = {}) {
    shortTermStore.reset()
    const aliases = options.aliases || DEFAULT_ALIASES
    const agentConfig = normalizeAgentConfig({
        enabled: true,
        defaultGroupEnabled: true,
        observeOnly: false,
        sendEnabled: true,
        decisionMode: 'rule_only',
        aliases,
        shortTerm: {
            promptRecentMessages: 16,
            promptTopicMessages: 20,
            promptAssistantMessages: 8,
            promptMaxMessages: 32,
            promptMaxCharsPerMessage: 220,
            promptMaxContextChars: 6000
        },
        replyPolicy: {
            minReplyScore: 0.65,
            cooldownMs: 5000
        }
    })
    const messages = Array.isArray(sample.input?.messages) ? sample.input.messages : []
    const currentMessageId = String(sample.input?.currentMessageId || messages.at(-1)?.id || '')
    let memoryObservation = null
    let currentMessage = null
    for (const message of messages) {
        const normalized = buildReplayMessage({ sample, message, aliases })
        memoryObservation = shortTermStore.observe(normalized, agentConfig.shortTerm)
        if (String(message.id) === currentMessageId) currentMessage = normalized
    }
    if (!currentMessage) throw new Error(`current message not found: ${sample.id}`)

    const actor = { groupId: sample.input.groupId, userId: currentMessage.userId, qqRole: currentMessage.sender.role }
    const scoreResult = scoreMessage({ agentMessage: currentMessage, memoryObservation, actor })
    const ruleDecision = decideReply({ scoreResult, agentConfig })
    const contextSelection = selectContext(memoryObservation, agentConfig, currentMessage)
    const promptMessages = buildDecisionMessages({
        agentConfig,
        agentMessage: currentMessage,
        memoryObservation,
        longTermMemories: [],
        scoreResult,
        ruleDecision,
        sessionContext: { actor, conversationSession: null },
        budgetDecision: { allowed: true },
        inputGuardrail: { allowed: true }
    })
    const promptPayload = JSON.parse(promptMessages[1].content)

    return {
        id: sample.id,
        fixture: sample.fixture,
        description: sample.description,
        action: ruleDecision.action,
        shouldSend: ruleDecision.wouldReply,
        score: scoreResult.score,
        reasons: scoreResult.reasons,
        penalties: scoreResult.penalties,
        traits: scoreResult.traits,
        contextMessageIds: contextSelection.messages.map((message) => message.messageId),
        contextDigest: contextSelection.digest,
        contextPolicy: contextSelection.stats,
        promptPayload
    }
}

function assertSample(sample, actual) {
    const failures = []
    const expected = sample.expected || {}
    if (Array.isArray(expected.allowedActions) && expected.allowedActions.length > 0 && !expected.allowedActions.includes(actual.action)) {
        failures.push(`action ${actual.action} not in allowedActions ${expected.allowedActions.join(',')}`)
    }
    if (expected.shouldSend === true && !actual.shouldSend) failures.push('expected shouldSend=true')
    if (expected.shouldSend === false && actual.shouldSend) failures.push('expected shouldSend=false')
    if (Array.isArray(expected.contextMustInclude)) {
        for (const messageId of expected.contextMustInclude) {
            if (!actual.contextMessageIds.includes(String(messageId))) failures.push(`missing context message ${messageId}`)
        }
    }
    if (expected.mustNotUseTool && actual.action === 'tool_plan') failures.push('unexpected tool_plan')
    return failures
}

function runReplayEval(options = {}) {
    const samples = loadReplayCases(options.fixturesDir || FIXTURE_DIR)
    const cases = samples.map((sample) => {
        try {
            const actual = replaySample(sample, options)
            const failures = assertSample(sample, actual)
            return { id: sample.id, fixture: sample.fixture, ok: failures.length === 0, failures, actual }
        } catch (error) {
            return { id: sample.id, fixture: sample.fixture, ok: false, failures: [error.message], actual: null }
        }
    })
    const passed = cases.filter((item) => item.ok).length
    return {
        mode: options.mode || 'deterministic',
        total: cases.length,
        passed,
        failed: cases.length - passed,
        cases
    }
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2))
    const report = runReplayEval(args)
    if (args.out) {
        fs.mkdirSync(path.dirname(args.out), { recursive: true })
        fs.writeFileSync(args.out, JSON.stringify(report, null, 2))
    }
    console.log(JSON.stringify({ mode: report.mode, total: report.total, passed: report.passed, failed: report.failed }, null, 2))
    if (report.failed > 0) {
        for (const item of report.cases.filter((candidate) => !candidate.ok)) {
            console.error(`${item.id}: ${item.failures.join('; ')}`)
        }
        process.exit(1)
    }
}

module.exports = {
    FIXTURE_DIR,
    loadReplayCases,
    replaySample,
    runReplayEval,
    assertSample
}
