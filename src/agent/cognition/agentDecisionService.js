const logger = require('../../utils/logger')
const llmClient = require('../runtime/llmClient')
const { buildDecisionMessages } = require('../runtime/promptBuilder')
const { parseDecisionJson, normalizeDecision, fallbackDecision } = require('./decisionSchema')

function shouldRunLlmDecision(agentConfig) {
    return agentConfig.decisionMode === 'llm_shadow' || agentConfig.decisionMode === 'llm_live'
}

function validateLlmConfig(agentConfig) {
    const llm = agentConfig.llm || {}
    if (!shouldRunLlmDecision(agentConfig)) return 'decision_mode_rule_only'
    if (!llm.enabled) return 'llm_disabled'
    if (llm.provider !== 'openai-compatible') return `unsupported_provider:${llm.provider}`
    if (!llm.baseURL) return 'missing_base_url'
    if (!llm.model) return 'missing_model'
    return ''
}

async function decideWithLlm({ agentConfig, agentMessage, memoryObservation, scoreResult, ruleDecision, sessionContext }) {
    const skipReason = validateLlmConfig(agentConfig)
    if (skipReason) {
        return {
            status: 'skipped',
            reason: skipReason,
            decision: null
        }
    }

    try {
        const messages = buildDecisionMessages({
            agentMessage,
            memoryObservation,
            scoreResult,
            ruleDecision,
            sessionContext
        })
        const response = await llmClient.createChatCompletion({
            llmConfig: agentConfig.llm,
            messages,
            traceScope: sessionContext.traceScope
        })
        const parsed = parseDecisionJson(response.content)
        const decision = normalizeDecision(parsed)

        return {
            status: 'ok',
            reason: '',
            decision,
            model: response.model,
            usage: response.usage
        }
    } catch (error) {
        logger.logEvent('warn', 'AGENT', sessionContext.traceScope, 'llm-decision-failed', {
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            error: logger.getErrorMessage(error)
        })
        return {
            status: 'error',
            reason: logger.getErrorMessage(error),
            decision: fallbackDecision('LLM decision failed; fallback to observe_only')
        }
    }
}

module.exports = {
    decideWithLlm,
    shouldRunLlmDecision,
    validateLlmConfig
}
