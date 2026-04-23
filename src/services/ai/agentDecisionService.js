'use strict'

const { TASK_MODES, RISK_LEVELS, CONFIRMATION_STATES } = require('./agentTypes')
const { resolveBotControlActionInput } = require('./botControlActionResolutionService')
const { resolveStructuredBotControlAction } = require('./structuredBotControlActionService')
const { isRootPrivateGroupId } = require('./botControl/approvalController')
const { isRealGroupScope } = require('./botControl/subscriptionController')
const { BOT_CONTROL_PERMISSION_CLASSES, getBotControlActionPermissionClass } = require('./botControl/registry')

function buildPermissionFacts({ agentInput, config }) {
    const { groupId, userId, source } = agentInput

    return {
        source,
        isRootAdmin: config.isRootAdmin(userId),
        isGroupAdmin: source === 'group' ? config.isGroupAdmin(groupId, userId) : false,
        canManageCurrentGroup: isRealGroupScope(groupId)
            && (config.isGroupAdmin(groupId, userId) || config.isRootAdmin(userId))
    }
}

function mapResponseModeToTaskMode(responseMode) {
    switch (responseMode?.mode) {
        case 'chat':
            return TASK_MODES.CHAT
        case 'confirm_needed':
            return TASK_MODES.CONFIRM
        case 'action_ready':
            return TASK_MODES.ACT
        default:
            return TASK_MODES.ANSWER
    }
}

function isMutationStructuredBotControlAction(action) {
    const normalizedAction = String(action || '').trim()

    return normalizedAction === 'confirmation.reject' || normalizedAction.endsWith('.write')
}

function evaluateStructuredBotControlPermission({ action, permissionClass, permissionFacts, groupId }) {
    const normalizedAction = String(action || '').trim()
    const resolvedPermissionClass = permissionClass || getBotControlActionPermissionClass(normalizedAction)

    if (normalizedAction === 'confirmation.reject') {
        return {
            allowed: true,
            permissionClass: null,
            reason: null,
            userMessage: null
        }
    }

    switch (resolvedPermissionClass) {
        case BOT_CONTROL_PERMISSION_CLASSES.PUBLIC_READ:
            return {
                allowed: true,
                permissionClass: resolvedPermissionClass,
                reason: null,
                userMessage: null
            }
        case BOT_CONTROL_PERMISSION_CLASSES.ADMIN_READ:
            return {
                allowed: permissionFacts?.canManageCurrentGroup === true,
                permissionClass: resolvedPermissionClass,
                reason: permissionFacts?.canManageCurrentGroup === true ? null : 'permission_denied',
                userMessage: permissionFacts?.canManageCurrentGroup === true ? null : '你没有权限查看当前群管理信息。'
            }
        case BOT_CONTROL_PERMISSION_CLASSES.ADMIN_WRITE:
            return {
                allowed: permissionFacts?.canManageCurrentGroup === true,
                permissionClass: resolvedPermissionClass,
                reason: permissionFacts?.canManageCurrentGroup === true ? null : 'permission_denied',
                userMessage: permissionFacts?.canManageCurrentGroup === true ? null : '你没有权限执行当前群管理操作。'
            }
        case BOT_CONTROL_PERMISSION_CLASSES.ROOT_PRIVATE_ONLY: {
            const allowed = permissionFacts?.isRootAdmin === true
                && permissionFacts?.source === 'private'
                && isRootPrivateGroupId(String(groupId || '').trim())

            return {
                allowed,
                permissionClass: resolvedPermissionClass,
                reason: allowed ? null : 'root_private_only',
                userMessage: allowed ? null : '该操作仅允许 Root 在私聊中执行。'
            }
        }
        default:
            return {
                allowed: false,
                permissionClass: resolvedPermissionClass || null,
                reason: 'unknown_permission_class',
                userMessage: '当前结构化操作缺少权限声明。'
            }
    }
}

function buildRuntimeSignals({ gateDecision, responseMode, riskLevel, confirmationState, source, triggerLevel }) {
    return {
        gate: {
            shouldReply: gateDecision?.shouldReply === true,
            triggerLevel: gateDecision?.triggerLevel || triggerLevel || 'none',
            score: Number.isFinite(gateDecision?.score) ? gateDecision.score : null,
            busyMode: gateDecision?.busyMode === true,
            reasons: Array.isArray(gateDecision?.reasons) ? gateDecision.reasons : []
        },
        responseMode: {
            mode: responseMode?.mode || 'answer_only',
            reasons: Array.isArray(responseMode?.reasons) ? responseMode.reasons : []
        },
        executionConstraints: {
            source: source || 'group',
            riskLevel: riskLevel || RISK_LEVELS.LOW,
            confirmationState: confirmationState || CONFIRMATION_STATES.NOT_REQUIRED
        }
    }
}

function attachDecisionShape(decision) {
    const runtimeSignals = buildRuntimeSignals({
        gateDecision: decision?.gateDecision,
        responseMode: decision?.responseMode,
        riskLevel: decision?.riskLevel,
        confirmationState: decision?.confirmationState,
        source: decision?.permissionFacts?.source,
        triggerLevel: decision?.triggerLevel
    })

    return {
        ...decision,
        response: {
            shouldRespond: decision?.shouldRespond === true,
            triggerLevel: decision?.triggerLevel || runtimeSignals.gate.triggerLevel,
            reasons: Array.isArray(decision?.reasons) ? decision.reasons : []
        },
        execution: {
            taskMode: decision?.taskMode || TASK_MODES.ANSWER,
            riskLevel: decision?.riskLevel || runtimeSignals.executionConstraints.riskLevel,
            confirmationState: decision?.confirmationState || runtimeSignals.executionConstraints.confirmationState,
            toolPolicy: decision?.toolPolicy || {
                allowMcpTools: true,
                allowBotControl: false,
                allowedActionNamespaces: []
            }
        },
        permissions: {
            facts: decision?.permissionFacts || null,
            structured: decision?.structuredPermission || null
        },
        structured: {
            action: decision?.structuredAction || null,
            permission: decision?.structuredPermission || null
        },
        runtimeSignals,
        signals: {
            replyGate: runtimeSignals.gate,
            executionConstraints: runtimeSignals.executionConstraints
        },
        hints: {
            responseMode: runtimeSignals.responseMode
        }
    }
}

function evaluateAgentDecision({ agentInput, config, replyGateService, classifyResponseModeHint, classifyResponseMode }) {
    const effectiveAgentInput = resolveBotControlActionInput({ agentInput }).effectiveAgentInput
    const { groupId, userId, rawMessage, messageMeta, pipelineInput } = effectiveAgentInput
    const permissionFacts = buildPermissionFacts({ agentInput: effectiveAgentInput, config })
    const structuredAction = resolveStructuredBotControlAction(effectiveAgentInput)
    const structuredActionName = pipelineInput?.botControlAction?.action
    const isStructuredMutation = isMutationStructuredBotControlAction(structuredActionName)
    const structuredPermission = structuredAction.kind === 'supported'
        ? evaluateStructuredBotControlPermission({
            action: structuredAction.snapshot?.action,
            permissionClass: structuredAction.permissionClass,
            permissionFacts,
            groupId
        })
        : null

    if (structuredAction.kind === 'supported' || structuredAction.kind === 'invalid') {
        const reasons = structuredAction.kind === 'supported'
            ? ['structured_bot_control_action']
            : ['invalid_structured_bot_control_action']

        return attachDecisionShape({
            shouldRespond: true,
            triggerLevel: 'structured_action',
            taskMode: isStructuredMutation ? TASK_MODES.ACT : TASK_MODES.QUERY,
            riskLevel: isStructuredMutation ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW,
            confirmationState: messageMeta?.source === 'group' && isStructuredMutation
                ? CONFIRMATION_STATES.REQUIRED
                : CONFIRMATION_STATES.NOT_REQUIRED,
            toolPolicy: {
                allowMcpTools: true,
                allowBotControl: false,
                allowedActionNamespaces: []
            },
            gateDecision: {
                shouldReply: true,
                triggerLevel: 'structured_action',
                reasons
            },
            responseMode: {
                mode: isStructuredMutation ? 'action_ready' : 'answer_only',
                reasons
            },
            permissionFacts,
            structuredPermission,
            structuredAction,
            reasons
        })
    }

    const evaluateAdmission = typeof replyGateService?.evaluateAdmission === 'function'
        ? replyGateService.evaluateAdmission.bind(replyGateService)
        : replyGateService.evaluate.bind(replyGateService)
    const classifyResponseModeDecision = typeof classifyResponseModeHint === 'function'
        ? classifyResponseModeHint
        : classifyResponseMode
    const gateDecision = pipelineInput?.gateDecision || evaluateAdmission({
        groupId,
        userId,
        rawMessage,
        messageMeta
    })

    const responseMode = pipelineInput?.responseMode || classifyResponseModeDecision({
        rawMessage,
        messageMeta,
        triggerLevel: gateDecision.triggerLevel
    })

    const taskMode = mapResponseModeToTaskMode(responseMode)
    const isMutationCandidate = taskMode === TASK_MODES.ACT || taskMode === TASK_MODES.CONFIRM
    const riskLevel = isMutationCandidate ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW
    const confirmationRequired = messageMeta?.source === 'group' && isMutationCandidate

    return attachDecisionShape({
        shouldRespond: gateDecision.shouldReply,
        triggerLevel: gateDecision.triggerLevel,
        taskMode,
        riskLevel,
        confirmationState: confirmationRequired
            ? CONFIRMATION_STATES.REQUIRED
            : CONFIRMATION_STATES.NOT_REQUIRED,
        toolPolicy: {
            allowMcpTools: true,
            allowBotControl: false,
            allowedActionNamespaces: []
        },
        gateDecision,
        responseMode,
        permissionFacts,
        structuredPermission,
        structuredAction,
        reasons: [
            ...(gateDecision.reasons || []),
            ...((responseMode && responseMode.reasons) || [])
        ]
    })
}

module.exports = {
    attachDecisionShape,
    buildRuntimeSignals,
    buildPermissionFacts,
    evaluateStructuredBotControlPermission,
    isMutationStructuredBotControlAction,
    mapResponseModeToTaskMode,
    evaluateAgentDecision
}
