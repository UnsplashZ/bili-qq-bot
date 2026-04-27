const logger = require('../../utils/logger')
const llmClient = require('../runtime/llmClient')
const { extractJsonObject } = require('../cognition/decisionSchema')
const { validateLlmConfig } = require('../cognition/agentDecisionService')
const { buildReplyerMessages } = require('./replyerPromptBuilder')

const SENDABLE_ACTIONS = new Set(['react', 'reply'])

function clampConfidence(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.min(1, Math.max(0, parsed))
}

function maxCharsForAction(agentConfig, action) {
    if (action === 'react') {
        return Math.max(20, Math.min(500, Number(agentConfig?.replyer?.maxReactChars || agentConfig?.social?.maxCasualReplyChars || 60)))
    }
    return Math.max(80, Math.min(2000, Number(agentConfig?.replyer?.maxReplyChars || 500)))
}

function normalizeReplyerOutput(content, maxChars) {
    const parsed = JSON.parse(extractJsonObject(content))
    const text = String(parsed.text || '').replace(/\s+/g, ' ').trim()
    if (!text) throw new Error('replyer_empty_text')
    return {
        text: text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text,
        quoteTargetMessageId: String(parsed.quoteTargetMessageId || '').trim(),
        tone: ['casual', 'helpful', 'dry', 'serious'].includes(parsed.tone) ? parsed.tone : 'casual',
        confidence: clampConfidence(parsed.confidence)
    }
}

function shouldRunReplyer({ agentConfig, policyDecision }) {
    return Boolean(
        agentConfig?.participation?.replyerEnabled !== false &&
        policyDecision?.accepted &&
        policyDecision?.wouldSend &&
        SENDABLE_ACTIONS.has(policyDecision.finalAction)
    )
}

function fallbackTextFromPlanner({ llmDecision, policyDecision, action }) {
    const draft = String(policyDecision?.replyDraft || llmDecision?.decision?.replyDraft || '').trim()
    if (draft && draft !== '__replyer_pending__') return draft
    if (action === 'react') return '这个说法有点意思。'
    return '我在，具体想让我怎么处理？'
}

async function runReplyer({ agentConfig, agentMessage, memoryObservation, longTermMemories, llmDecision, policyDecision, sessionContext }) {
    const isSendablePolicy = Boolean(
        policyDecision?.accepted &&
        policyDecision?.wouldSend &&
        SENDABLE_ACTIONS.has(policyDecision.finalAction)
    )
    const action = policyDecision?.finalAction
    const maxChars = maxCharsForAction(agentConfig, action)

    if (!isSendablePolicy) {
        return {
            status: 'skipped',
            reason: 'replyer_not_applicable',
            policyDecision
        }
    }

    if (!shouldRunReplyer({ agentConfig, policyDecision })) {
        const text = fallbackTextFromPlanner({ llmDecision, policyDecision, action })
        return {
            status: 'skipped',
            reason: 'replyer_disabled',
            output: { text: text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text, confidence: 0 },
            policyDecision: { ...policyDecision, replyDraft: text }
        }
    }

    const skipReason = validateLlmConfig(agentConfig)
    if (skipReason) {
        const text = fallbackTextFromPlanner({ llmDecision, policyDecision, action })
        return {
            status: 'skipped',
            reason: skipReason,
            output: { text: text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text, confidence: 0 },
            policyDecision: { ...policyDecision, replyDraft: text }
        }
    }

    try {
        const response = await llmClient.createChatCompletion({
            llmConfig: agentConfig.llm,
            messages: buildReplyerMessages({
                agentConfig,
                agentMessage,
                memoryObservation,
                longTermMemories,
                llmDecision,
                policyDecision
            }),
            traceScope: sessionContext?.traceScope || '',
            purpose: 'replyer'
        })
        const output = normalizeReplyerOutput(response.content, maxChars)
        return {
            status: 'ok',
            reason: '',
            output,
            model: response.model,
            usage: response.usage,
            policyDecision: {
                ...policyDecision,
                replyDraft: output.text,
                quoteTargetMessageId: output.quoteTargetMessageId
            }
        }
    } catch (error) {
        const errorMessage = logger.getErrorMessage(error)
        logger.logEvent('warn', 'AGENT', sessionContext?.traceScope || '', 'replyer-failed', {
            groupId: sessionContext?.groupId || '',
            userId: sessionContext?.userId || '',
            error: errorMessage
        })
        const text = fallbackTextFromPlanner({ llmDecision, policyDecision, action })
        return {
            status: 'fallback',
            reason: errorMessage,
            output: { text: text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text, confidence: 0 },
            policyDecision: {
                ...policyDecision,
                replyDraft: text
            }
        }
    }
}

module.exports = {
    shouldRunReplyer,
    runReplyer,
    normalizeReplyerOutput,
    maxCharsForAction
}
