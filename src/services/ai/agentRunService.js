'use strict'

const crypto = require('crypto')
const { createEmptyRunResult, RUN_STATES } = require('./agentTypes')
const { evaluateAgentDecision, evaluateStructuredBotControlPermission } = require('./agentDecisionService')
const { buildAgentContext } = require('./agentContextBuilderService')
const { planAgentRun } = require('./agentPlannerService')
const { resolveBotControlActionInput } = require('./botControlActionResolutionService')
const { executeLocalBotControlAction } = require('./localBotControlExecutionHelper')
const { finalizeAgentRunResult } = require('./agent/finalizer')

function createRunId() {
    return `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

function normalizeLegacyExecutionResult(replyResult) {
    if (replyResult && typeof replyResult === 'object' && !Array.isArray(replyResult)) {
        return {
            finalReply: replyResult.finalReply ?? null,
            hasToolResult: replyResult.hasToolResult === true,
            steps: Array.isArray(replyResult.steps) ? replyResult.steps : [],
            errors: Array.isArray(replyResult.errors) ? replyResult.errors : [],
            toolCalls: Array.isArray(replyResult.toolCalls) ? replyResult.toolCalls : []
        }
    }

    return {
        finalReply: replyResult || null,
        hasToolResult: false,
        steps: [],
        errors: [],
        toolCalls: []
    }
}

function resolveEffectiveAgentInput({ agentInput, runtime }) {
    return resolveBotControlActionInput({ agentInput, runtime }).effectiveAgentInput
}

function shouldClearCandidateSelectionSnapshot({ resolvedActionInput, runResult }) {
    const localAction = runResult?.localActions?.[runResult.localActions.length - 1]

    if (!localAction) {
        return false
    }

    if (localAction.action === 'subscription.write') {
        return localAction.status === 'pending_confirmation' || localAction.status === 'executed'
    }

    if (localAction.action !== 'confirmation.reject') {
        return false
    }

    return resolvedActionInput?.source === 'pending_followup'
        && resolvedActionInput?.pendingConfirmation?.action === 'subscription.write'
}

function buildLegacyPipelineInput({ agentDecision, agentContext, messageMeta }) {
    return {
        gateDecision: agentDecision.gateDecision,
        selectedContext: agentContext.selectedContext,
        responseMode: agentDecision.responseMode,
        messageMeta,
        agentSignals: agentDecision.runtimeSignals || null,
        agentContextShape: {
            message: agentContext.message,
            actor: agentContext.actor,
            permissions: agentContext.permissions,
            history: agentContext.history,
            workflows: agentContext.workflows,
            tools: agentContext.tools,
            runtimeSignals: agentContext.runtimeSignals
        }
    }
}

async function executeStructuredBotControlAction({ agentDecision, agentPlan, runtime, runResult, agentInput }) {
    const candidateAction = agentPlan.candidateActions[0]

    if (!candidateAction) {
        throw new Error('Structured bot-control plan is missing candidate action')
    }
    const permissionCheck = evaluateStructuredBotControlPermission({
        action: candidateAction.action,
        permissionClass: agentDecision.structuredPermission?.permissionClass || agentDecision.structuredAction?.permissionClass,
        permissionFacts: agentDecision.permissionFacts,
        groupId: agentInput?.groupId
    })

    if (!permissionCheck.allowed) {
        runResult.state = RUN_STATES.BLOCKED
        runResult.errors.push(permissionCheck.reason || 'permission_denied')
        runResult.steps.push({
            type: 'local_action_blocked',
            state: RUN_STATES.BLOCKED,
            action: candidateAction.action,
            permissionClass: permissionCheck.permissionClass,
            reason: permissionCheck.reason || 'permission_denied'
        })
        runResult.finalReply = permissionCheck.userMessage || '你没有权限执行当前操作。'
        runResult.stepCount = runResult.steps.length
        return runResult
    }
    if (!runtime.botControl) {
        throw new Error('Bot-control runtime is unavailable')
    }

    runResult.state = RUN_STATES.EXECUTING
    runResult.steps.push({
        type: 'local_action_start',
        state: RUN_STATES.EXECUTING,
        action: candidateAction.action,
        input: candidateAction.input
    })

    const executionResult = await executeLocalBotControlAction({
        botControl: runtime.botControl,
        candidateAction,
        agentInput
    })
    const { localActionRecord } = executionResult

    runResult.localActions.push(localActionRecord)

    if (executionResult.outcome === 'rejected') {
        runResult.state = RUN_STATES.FINALIZED
        runResult.steps.push({
            type: 'local_action_done',
            state: RUN_STATES.FINALIZED,
            action: candidateAction.action
        })
        runResult.hasMutation = executionResult.hasMutation
        return finalizeAgentRunResult({ runResult })
    }

    if (executionResult.outcome === 'pending_confirmation') {
        runResult.state = RUN_STATES.WAITING_CONFIRMATION
        runResult.steps.push({
            type: 'local_action_pending_confirmation',
            state: RUN_STATES.WAITING_CONFIRMATION,
            action: candidateAction.action,
            confirmationId: localActionRecord.confirmation?.confirmationId || null
        })
        runResult.hasMutation = executionResult.hasMutation
    } else {
        runResult.state = RUN_STATES.FINALIZED
        runResult.steps.push({
            type: 'local_action_done',
            state: RUN_STATES.FINALIZED,
            action: candidateAction.action
        })
        runResult.hasMutation = executionResult.hasMutation
    }

    return finalizeAgentRunResult({ runResult })
}

async function executeLegacyReplyBridge({ runtime, effectiveAgentInput, legacyPipelineInput }) {
    const legacyReplyResult = runtime.generateLegacyReplyResult
        ? await runtime.generateLegacyReplyResult({
            message: effectiveAgentInput.rawMessage,
            userId: effectiveAgentInput.userId,
            groupId: effectiveAgentInput.groupId,
            traceId: effectiveAgentInput.traceId,
            pipelineInput: legacyPipelineInput
        })
        : await runtime.generateLegacyReply({
            message: effectiveAgentInput.rawMessage,
            userId: effectiveAgentInput.userId,
            groupId: effectiveAgentInput.groupId,
            traceId: effectiveAgentInput.traceId,
            pipelineInput: legacyPipelineInput
        })

    return normalizeLegacyExecutionResult(legacyReplyResult)
}

async function executeReplyPipeline({ runtime, effectiveAgentInput, legacyPipelineInput, runResult, preferLegacyReplyPipeline = false }) {
    if (preferLegacyReplyPipeline) {
        return executeLegacyReplyBridge({ runtime, effectiveAgentInput, legacyPipelineInput })
    }

    if (typeof runtime.generateAgentReplyResult !== 'function') {
        return executeLegacyReplyBridge({ runtime, effectiveAgentInput, legacyPipelineInput })
    }

    try {
        const replyResult = await runtime.generateAgentReplyResult({
            message: effectiveAgentInput.rawMessage,
            userId: effectiveAgentInput.userId,
            groupId: effectiveAgentInput.groupId,
            traceId: effectiveAgentInput.traceId,
            pipelineInput: legacyPipelineInput
        })

        return normalizeLegacyExecutionResult(replyResult)
    } catch (error) {
        runResult.steps.push({
            type: 'reply_pipeline_fallback',
            from: 'runtime_v2',
            to: 'legacy',
            reason: String(error?.message || 'agent_reply_result_failed')
        })

        return executeLegacyReplyBridge({ runtime, effectiveAgentInput, legacyPipelineInput })
    }
}

async function runAgent({ agentInput, runtime, preferLegacyReplyPipeline = false }) {
    const resolvedActionInput = resolveBotControlActionInput({ agentInput, runtime })
    const effectiveAgentInput = resolvedActionInput.effectiveAgentInput
    const runResult = createEmptyRunResult({
        runId: createRunId(),
        state: RUN_STATES.ADMITTED
    })

    const agentDecision = evaluateAgentDecision({
        agentInput: effectiveAgentInput,
        config: runtime.config,
        replyGateService: runtime.replyGateService,
        classifyResponseMode: runtime.classifyResponseMode
    })

    runResult.steps.push({ type: 'decision', state: RUN_STATES.ADMITTED, decision: agentDecision })

    const structuredAction = agentDecision.structuredAction

    if (structuredAction?.kind === 'invalid') {
        runResult.state = RUN_STATES.FAILED
        runResult.agentDecision = agentDecision
        runResult.errors.push(structuredAction.error)
        runResult.steps.push({
            type: 'structured_action_invalid',
            state: RUN_STATES.FAILED,
            error: structuredAction.error
        })
        runResult.finalReply = structuredAction.userMessage || `无法执行结构化操作：${structuredAction.error}`
        runResult.stepCount = runResult.steps.length
        return runResult
    }

    if (!agentDecision.shouldRespond) {
        runResult.state = RUN_STATES.ABORTED
        runResult.stepCount = runResult.steps.length
        runResult.agentDecision = agentDecision
        return runResult
    }

    if (structuredAction?.kind === 'supported') {
        const agentPlan = planAgentRun({
            agentInput: effectiveAgentInput,
            agentDecision,
            agentContext: null
        })

        runResult.state = RUN_STATES.PLANNED
        runResult.steps.push({ type: 'plan', state: RUN_STATES.PLANNED, plan: agentPlan })
        runResult.agentDecision = agentDecision
        runResult.agentContext = null
        runResult.agentPlan = agentPlan

        const structuredRunResult = await executeStructuredBotControlAction({
            agentDecision,
            agentPlan,
            runtime,
            runResult,
            agentInput: effectiveAgentInput
        })

        if (shouldClearCandidateSelectionSnapshot({ resolvedActionInput, runResult: structuredRunResult })
            && runtime?.botControl
            && typeof runtime.botControl.clearCandidateSelectionSnapshot === 'function') {
            runtime.botControl.clearCandidateSelectionSnapshot({
                actorUserId: effectiveAgentInput?.userId
            })
        }

        return structuredRunResult
    }

    const agentContext = await buildAgentContext({
        agentInput: effectiveAgentInput,
        agentDecision,
        runtime
    })

    runResult.state = RUN_STATES.CONTEXT_READY
    runResult.steps.push({ type: 'context', state: RUN_STATES.CONTEXT_READY })

    const agentPlan = planAgentRun({
        agentInput: effectiveAgentInput,
        agentDecision,
        agentContext
    })

    runResult.state = RUN_STATES.PLANNED
    runResult.steps.push({ type: 'plan', state: RUN_STATES.PLANNED, plan: agentPlan })

    if (agentPlan.requiresConfirmation && agentDecision.confirmationState !== 'not_required') {
        runResult.state = RUN_STATES.WAITING_CONFIRMATION
    }

    const legacyPipelineInput = buildLegacyPipelineInput({
        agentDecision,
        agentContext,
        messageMeta: effectiveAgentInput.messageMeta
    })

    const replyResult = await executeReplyPipeline({
        runtime,
        effectiveAgentInput,
        legacyPipelineInput,
        runResult,
        preferLegacyReplyPipeline
    })

    runResult.state = replyResult.finalReply ? RUN_STATES.FINALIZED : RUN_STATES.FAILED
    runResult.agentDecision = agentDecision
    runResult.agentContext = agentContext
    runResult.agentPlan = agentPlan

    return finalizeAgentRunResult({ runResult, replyResult })
}

module.exports = {
    resolveEffectiveAgentInput,
    runAgent,
    createRunId,
    buildLegacyPipelineInput,
    normalizeLegacyExecutionResult,
    shouldClearCandidateSelectionSnapshot,
    executeReplyPipeline
}
