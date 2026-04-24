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

function parseAndNormalizeDecision(content) {
    const parsed = parseDecisionJson(content)
    return normalizeDecision(parsed)
}

function buildRepairMessages({ messages, invalidContent, errorMessage }) {
    return [
        ...messages,
        {
            role: 'assistant',
            content: String(invalidContent || '').slice(0, 2000)
        },
        {
            role: 'user',
            content: [
                '上一条输出不是可解析的严格 JSON。',
                `解析错误：${errorMessage}`,
                '请只根据原任务重新输出一个 JSON 对象，不要 Markdown，不要解释。',
                '必须包含字段：action, confidence, reason, topic, replyStyle, replyDraft, memoryHints, toolIntent。'
            ].join('\n')
        }
    ]
}

async function decideWithLlm({ agentConfig, agentMessage, memoryObservation, longTermMemories, scoreResult, ruleDecision, sessionContext, budgetDecision }) {
    const skipReason = validateLlmConfig(agentConfig)
    if (skipReason) {
        return {
            status: 'skipped',
            reason: skipReason,
            decision: null
        }
    }

    if (budgetDecision && budgetDecision.allowed === false) {
        return {
            status: 'skipped',
            reason: budgetDecision.reason,
            decision: null,
            budgetDecision
        }
    }

    try {
        const messages = buildDecisionMessages({
            agentMessage,
            memoryObservation,
            longTermMemories,
            scoreResult,
            ruleDecision,
            sessionContext,
            budgetDecision
        })
        const response = await llmClient.createChatCompletion({
            llmConfig: agentConfig.llm,
            messages,
            traceScope: sessionContext.traceScope
        })
        let decision
        let repaired = false
        let finalResponse = response

        try {
            decision = parseAndNormalizeDecision(response.content)
        } catch (parseError) {
            logger.logEvent('warn', 'AGENT', sessionContext.traceScope, 'llm-decision-parse-failed', {
                groupId: sessionContext.groupId,
                userId: sessionContext.userId,
                error: logger.getErrorMessage(parseError)
            })
            const repairResponse = await llmClient.createChatCompletion({
                llmConfig: agentConfig.llm,
                messages: buildRepairMessages({
                    messages,
                    invalidContent: response.content,
                    errorMessage: logger.getErrorMessage(parseError)
                }),
                traceScope: sessionContext.traceScope
            })
            decision = parseAndNormalizeDecision(repairResponse.content)
            finalResponse = repairResponse
            repaired = true
            logger.logEvent('info', 'AGENT', sessionContext.traceScope, 'llm-decision-repaired', {
                groupId: sessionContext.groupId,
                userId: sessionContext.userId
            })
        }

        return {
            status: 'ok',
            reason: '',
            decision,
            model: finalResponse.model,
            usage: finalResponse.usage,
            repaired
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
    validateLlmConfig,
    buildRepairMessages
}
