const logger = require('../../utils/logger')
const llmClient = require('../runtime/llmClient')
const { buildDecisionMessages, buildToolResultMessages } = require('../runtime/promptBuilder')
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

function isQqManagementText(text) {
    return /禁言|解禁|撤回|踢出?|群名片|全员禁言|精华|加群|好友申请|在线状态|输入状态|公告|头衔|申请/.test(String(text || ''))
}

function canManageQq(actor) {
    const qqRole = String(actor?.qqRole || '').toLowerCase()
    return Boolean(actor?.isRoot || qqRole === 'admin' || qqRole === 'owner')
}

function buildQqManagementFallbackDecision({ actor, errorMessage }) {
    if (!canManageQq(actor)) {
        return {
            action: 'short_reply',
            confidence: 0.2,
            reason: `LLM decision failed; fallback to QQ management permission denial: ${errorMessage}`,
            topic: 'qq_management_permission',
            replyStyle: 'serious',
            replyDraft: '这个操作需要 QQ 群主或管理员权限，我不能替普通群成员执行禁言、撤回、踢人等群管理操作。',
            memoryHints: [],
            toolIntent: null
        }
    }

    return {
        action: 'ask_clarify',
        confidence: 0.2,
        reason: `LLM decision failed; fallback to QQ management clarification: ${errorMessage}`,
        topic: 'qq_management_fallback',
        replyStyle: 'clarify',
        replyDraft: '我识别到这是 QQ 群管理操作，但刚才没有可靠解析出目标或参数。请明确动作、目标和必要参数，例如“禁言 123456 60 秒”，或回复目标消息说“撤回这条”。',
        memoryHints: [],
        toolIntent: null
    }
}

function buildErrorFallbackDecision({ agentMessage, scoreResult, ruleDecision, errorMessage, sessionContext }) {
    const text = String(agentMessage?.normalizedText || agentMessage?.rawText || '')
    const traits = scoreResult?.traits || {}
    const addressed = Boolean(
        traits.mentionedBot ||
        traits.aliasMatched ||
        traits.replyToBot ||
        agentMessage?.mentionsSelf ||
        agentMessage?.aliasMatched ||
        agentMessage?.replyToSelf ||
        ruleDecision?.wouldReply
    )
    const actor = sessionContext?.actor || {}

    if (addressed && /agent/i.test(text) && /(配置|状态|模式|开关|config|status)/i.test(text)) {
        return {
            action: 'tool_plan',
            confidence: 0.2,
            reason: `LLM decision failed; fallback to safe group config read: ${errorMessage}`,
            topic: 'agent_config',
            replyStyle: 'serious',
            replyDraft: '',
            memoryHints: [],
            toolIntent: {
                name: 'agent.get_group_config',
                arguments: {}
            }
        }
    }

    if (addressed && isQqManagementText(text)) {
        return buildQqManagementFallbackDecision({ actor, errorMessage })
    }

    if (addressed) {
        return {
            action: 'ask_clarify',
            confidence: 0.2,
            reason: `LLM decision failed; fallback to clarify: ${errorMessage}`,
            topic: 'llm_fallback',
            replyStyle: 'clarify',
            replyDraft: '我刚才没能正确解析这条请求。你可以再明确说一次吗？',
            memoryHints: [],
            toolIntent: null
        }
    }

    return fallbackDecision(`LLM decision failed; fallback to observe_only: ${errorMessage}`)
}

async function decideWithLlm({ agentConfig, agentMessage, memoryObservation, longTermMemories, scoreResult, ruleDecision, sessionContext, budgetDecision, inputGuardrail, socialScore }) {
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

    if (inputGuardrail && inputGuardrail.allowed === false) {
        return {
            status: 'skipped',
            reason: inputGuardrail.reason,
            decision: null,
            inputGuardrail
        }
    }

    try {
        const messages = buildDecisionMessages({
            agentConfig,
            agentMessage,
            memoryObservation,
            longTermMemories,
            scoreResult,
            ruleDecision,
            sessionContext,
            budgetDecision,
            inputGuardrail,
            socialScore
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
        const errorMessage = logger.getErrorMessage(error)
        logger.logEvent('warn', 'AGENT', sessionContext.traceScope, 'llm-decision-failed', {
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            error: errorMessage
        })
        return {
            status: 'error',
            reason: errorMessage,
            decision: buildErrorFallbackDecision({
                agentMessage,
                scoreResult,
                ruleDecision,
                errorMessage,
                sessionContext
            })
        }
    }
}

function shouldFinalizeToolOutcome(toolOutcome) {
    return ['executed', 'failed'].includes(toolOutcome?.status)
}

function isSendableToolReply(decision) {
    return ['short_reply', 'full_reply', 'ask_clarify'].includes(decision?.action) &&
        Boolean(String(decision?.replyDraft || '').trim())
}

async function finalizeToolResultReply({ agentConfig, agentMessage, sessionContext, toolOutcome }) {
    if (!shouldFinalizeToolOutcome(toolOutcome)) {
        return {
            status: 'skipped',
            reason: 'tool_outcome_not_finalizable',
            decision: toolOutcome?.decisionOverride || null
        }
    }

    const skipReason = validateLlmConfig(agentConfig)
    if (skipReason) {
        return {
            status: 'skipped',
            reason: skipReason,
            decision: toolOutcome.decisionOverride || null
        }
    }

    try {
        const response = await llmClient.createChatCompletion({
            llmConfig: agentConfig.llm,
            messages: buildToolResultMessages({
                agentConfig,
                agentMessage,
                sessionContext,
                toolOutcome
            }),
            traceScope: sessionContext.traceScope
        })
        const decision = parseAndNormalizeDecision(response.content)
        if (!isSendableToolReply(decision)) {
            return {
                status: 'skipped',
                reason: 'tool_reply_not_sendable',
                decision: toolOutcome.decisionOverride || null,
                model: response.model,
                usage: response.usage
            }
        }
        return {
            status: 'ok',
            reason: '',
            decision: {
                ...decision,
                memoryHints: [],
                toolIntent: null
            },
            model: response.model,
            usage: response.usage
        }
    } catch (error) {
        logger.logEvent('warn', 'AGENT', sessionContext.traceScope, 'tool-result-reply-failed', {
            groupId: sessionContext.groupId,
            userId: sessionContext.userId,
            toolName: toolOutcome?.plan?.name || '',
            error: logger.getErrorMessage(error)
        })
        return {
            status: 'error',
            reason: logger.getErrorMessage(error),
            decision: toolOutcome.decisionOverride || null
        }
    }
}

module.exports = {
    decideWithLlm,
    finalizeToolResultReply,
    shouldRunLlmDecision,
    validateLlmConfig,
    buildRepairMessages,
    buildErrorFallbackDecision,
    isQqManagementText
}
