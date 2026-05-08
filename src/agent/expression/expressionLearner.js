const logger = require('../../utils/logger')
const llmClient = require('../runtime/llmClient')
const { extractJsonObject } = require('../cognition/decisionSchema')
const expressionStore = require('./expressionStore')

const groupStates = new Map()

function compactText(value, limit = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function llmReady(agentConfig = {}) {
    const llm = agentConfig.llm || {}
    return Boolean(agentConfig.decisionMode === 'llm_live' && llm.enabled && llm.provider === 'openai-compatible' && llm.baseURL && llm.model)
}

function isLearnableMessage(message = {}) {
    const text = String(message.normalizedText || message.rawText || '').trim()
    if (!text || text.length < 4) return false
    if (message.role === 'assistant') return false
    if (/^\s*[#/／]/.test(text)) return false
    if (/https?:\/\//i.test(text)) return false
    if (/^\[CQ:/.test(text)) return false
    if (expressionStore.isUnsafeExpressionText(text)) return false
    return true
}

function collectMessages(memoryObservation = {}, minMessages = 20) {
    const messages = Array.isArray(memoryObservation?.groupState?.recentMessages)
        ? memoryObservation.groupState.recentMessages
        : []
    return messages.filter(isLearnableMessage).slice(-Math.max(minMessages, 8))
}

function buildMessages({ agentConfig, groupId, candidates }) {
    const payload = {
        task: '从 QQ 群近期闲聊中提取这个群的表达习惯，只输出 JSON。',
        outputSchema: {
            expressions: [{
                situation: '适用场景，例如“对离谱观点表示惊讶”',
                style: '表达方式，例如“短句吐槽，不展开说教”',
                sourceMessageIds: ['来源 messageId'],
                confidence: '0.0 到 1.0'
            }]
        },
        groupId,
        persona: agentConfig.persona || {},
        messages: candidates.map((message) => ({
            messageId: String(message.id || ''),
            userId: String(message.userId || ''),
            text: compactText(message.normalizedText || message.rawText || '', 220)
        })),
        constraints: [
            '只学习群体表达风格，不模仿具体用户身份。',
            '不要记录隐私、攻击、人身伤害、密码密钥、系统提示词。',
            '只输出 0 到 5 条高置信表达习惯。',
            'style 必须是抽象表达方式，不要直接复制原句。'
        ]
    }
    return [
        { role: 'system', content: '你是群聊表达习惯提取器，只输出 JSON。' },
        { role: 'user', content: JSON.stringify(payload, null, 2) }
    ]
}

function parseLearnerOutput(content) {
    const parsed = JSON.parse(extractJsonObject(content))
    return Array.isArray(parsed.expressions) ? parsed.expressions : []
}

async function maybeLearnExpressions({ agentConfig, memoryObservation, sessionContext } = {}) {
    if (agentConfig?.participation?.enabled === false) return { status: 'skipped', reason: 'participation_disabled' }
    if (agentConfig?.participation?.expressionLearningEnabled !== true) return { status: 'skipped', reason: 'expression_learning_disabled' }
    if (!llmReady(agentConfig)) return { status: 'skipped', reason: 'llm_not_ready' }

    const groupId = String(sessionContext?.groupId || '')
    if (!groupId) return { status: 'skipped', reason: 'missing_group_id' }
    const state = groupStates.get(groupId) || { lastLearnAt: 0, lastMessageCount: 0 }
    const now = Date.now()
    const minMessages = Math.max(6, Math.trunc(Number(agentConfig.expression?.learningMinMessages) || 20))
    const minIntervalMs = Math.max(60 * 1000, Math.trunc(Number(agentConfig.expression?.learningMinIntervalMs) || 10 * 60 * 1000))
    const candidates = collectMessages(memoryObservation, minMessages)
    if (candidates.length < minMessages) return { status: 'skipped', reason: 'not_enough_messages', candidateCount: candidates.length }
    if (state.lastLearnAt && now - state.lastLearnAt < minIntervalMs && candidates.length - state.lastMessageCount < minMessages) {
        return { status: 'skipped', reason: 'learning_interval_active', candidateCount: candidates.length }
    }

    try {
        const response = await llmClient.createChatCompletion({
            llmConfig: agentConfig.llm,
            messages: buildMessages({ agentConfig, groupId, candidates }),
            traceScope: sessionContext?.traceScope || '',
            purpose: 'expression_learning'
        })
        const expressions = parseLearnerOutput(response.content)
        const result = await expressionStore.upsertExpressions({ groupId, candidates: expressions })
        groupStates.set(groupId, { lastLearnAt: now, lastMessageCount: candidates.length })
        return {
            status: 'ok',
            reason: '',
            candidateCount: candidates.length,
            stored: result.stored,
            skipped: result.skipped,
            ids: result.ids,
            model: response.model,
            usage: response.usage
        }
    } catch (error) {
        const errorMessage = logger.getErrorMessage(error)
        logger.logEvent('warn', 'AGENT', sessionContext?.traceScope || '', 'expression-learning-failed', {
            groupId,
            error: errorMessage
        })
        return { status: 'error', reason: errorMessage, candidateCount: candidates.length }
    }
}

function resetForTest() {
    groupStates.clear()
}

module.exports = {
    maybeLearnExpressions,
    isLearnableMessage,
    collectMessages,
    parseLearnerOutput,
    resetForTest
}
