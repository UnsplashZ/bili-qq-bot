#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    buildPermissionFacts,
    evaluateStructuredBotControlPermission,
    mapResponseModeToTaskMode,
    evaluateAgentDecision
} = require('../../src/services/ai/agentDecisionService')
const { TASK_MODES, CONFIRMATION_STATES } = require('../../src/services/ai/agentTypes')

function createConfig() {
    return {
        isRootAdmin: (userId) => String(userId) === '1',
        isGroupAdmin: (groupId, userId) => String(groupId) === '1000' && String(userId) === '2'
    }
}

function run() {
    const config = createConfig()
    const permissionFacts = buildPermissionFacts({
        agentInput: {
            groupId: '1000',
            userId: '2',
            source: 'group'
        },
        config
    })

    assert.deepStrictEqual(permissionFacts, {
        source: 'group',
        isRootAdmin: false,
        isGroupAdmin: true,
        canManageCurrentGroup: true
    })
    assert.strictEqual(mapResponseModeToTaskMode({ mode: 'chat' }), TASK_MODES.CHAT)
    assert.strictEqual(mapResponseModeToTaskMode({ mode: 'confirm_needed' }), TASK_MODES.CONFIRM)

    let gateCalled = false
    let modeCalled = false
    const decision = evaluateAgentDecision({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: '帮我处理一下',
            messageMeta: { source: 'group' }
        },
        config,
        replyGateService: {
            evaluate: () => {
                gateCalled = true
                return {
                    shouldReply: true,
                    triggerLevel: 'direct',
                    reasons: ['at_bot']
                }
            }
        },
        classifyResponseMode: ({ triggerLevel }) => {
            modeCalled = true
            assert.strictEqual(triggerLevel, 'direct')
            return {
                mode: 'confirm_needed',
                reasons: ['mutation_candidate']
            }
        }
    })

    assert.strictEqual(gateCalled, true)
    assert.strictEqual(modeCalled, true)
    assert.strictEqual(decision.shouldRespond, true)
    assert.strictEqual(decision.taskMode, TASK_MODES.CONFIRM)
    assert.strictEqual(decision.confirmationState, CONFIRMATION_STATES.REQUIRED)
    assert.deepStrictEqual(decision.reasons, ['at_bot', 'mutation_candidate'])
    assert.deepStrictEqual(decision.response, {
        shouldRespond: true,
        triggerLevel: 'direct',
        reasons: ['at_bot', 'mutation_candidate']
    })
    assert.deepStrictEqual(decision.execution, {
        taskMode: TASK_MODES.CONFIRM,
        riskLevel: 'medium',
        confirmationState: CONFIRMATION_STATES.REQUIRED,
        toolPolicy: {
            allowMcpTools: true,
            allowBotControl: false,
            allowedActionNamespaces: []
        }
    })
    assert.deepStrictEqual(decision.permissions, {
        facts: decision.permissionFacts,
        structured: null
    })
    assert.deepStrictEqual(decision.runtimeSignals, {
        gate: {
            shouldReply: true,
            triggerLevel: 'direct',
            score: null,
            busyMode: false,
            reasons: ['at_bot']
        },
        responseMode: {
            mode: 'confirm_needed',
            reasons: ['mutation_candidate']
        },
        executionConstraints: {
            source: 'group',
            riskLevel: 'medium',
            confirmationState: CONFIRMATION_STATES.REQUIRED
        }
    })
    assert.deepStrictEqual(decision.signals, {
        replyGate: decision.runtimeSignals.gate,
        executionConstraints: decision.runtimeSignals.executionConstraints
    })
    assert.deepStrictEqual(decision.hints, {
        responseMode: decision.runtimeSignals.responseMode
    })

    const noReply = evaluateAgentDecision({
        agentInput: {
            groupId: '1000',
            userId: '3',
            rawMessage: '路过',
            messageMeta: { source: 'group' }
        },
        config,
        replyGateService: {
            evaluate: () => ({
                shouldReply: false,
                triggerLevel: 'none',
                reasons: ['below_threshold']
            })
        },
        classifyResponseMode: () => ({
            mode: 'answer_only',
            reasons: ['default']
        })
    })

    assert.strictEqual(noReply.shouldRespond, false)
    assert.strictEqual(noReply.confirmationState, CONFIRMATION_STATES.NOT_REQUIRED)

    const structuredDecision = evaluateAgentDecision({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: 'ignored',
            source: 'group',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'add_user',
                        uid: '42'
                    }
                }
            }
        },
        config,
        replyGateService: {
            evaluate: () => {
                throw new Error('structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('structured action should not classify response mode')
        }
    })

    assert.strictEqual(structuredDecision.shouldRespond, true)
    assert.strictEqual(structuredDecision.taskMode, TASK_MODES.ACT)
    assert.strictEqual(structuredDecision.confirmationState, CONFIRMATION_STATES.REQUIRED)
    assert.strictEqual(structuredDecision.structuredPermission.permissionClass, 'admin_write')
    assert.strictEqual(structuredDecision.structuredPermission.allowed, true)
    assert.strictEqual(structuredDecision.structuredAction.kind, 'supported')
    assert.strictEqual(structuredDecision.response.shouldRespond, true)
    assert.strictEqual(structuredDecision.runtimeSignals.gate.triggerLevel, 'structured_action')
    assert.strictEqual(structuredDecision.hints.responseMode.mode, 'action_ready')
    assert.strictEqual(structuredDecision.permissions.structured.permissionClass, 'admin_write')
    assert.deepStrictEqual(structuredDecision.structuredAction.snapshot, {
        action: 'subscription.write',
        groupId: '1000',
        input: {
            operation: 'add_user',
            uid: '42'
        }
    })

    const recognizedDecision = evaluateAgentDecision({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: '重置上下文',
            source: 'group',
            messageMeta: { source: 'group', isReplyToBot: true }
        },
        config,
        replyGateService: {
            evaluate: () => {
                throw new Error('recognized bot-control phrase should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('recognized bot-control phrase should not classify response mode')
        }
    })

    assert.strictEqual(recognizedDecision.structuredAction.kind, 'supported')
    assert.strictEqual(recognizedDecision.structuredPermission.permissionClass, 'admin_write')
    assert.deepStrictEqual(recognizedDecision.structuredAction.snapshot, {
        action: 'context.write',
        groupId: '1000',
        input: {
            operation: 'reset'
        }
    })

    const explicitPrecedenceDecision = evaluateAgentDecision({
        agentInput: {
            groupId: '1000',
            userId: '2',
            rawMessage: '重置上下文',
            source: 'group',
            messageMeta: { source: 'group' },
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'remove_user',
                        uid: '99'
                    }
                }
            }
        },
        config,
        replyGateService: {
            evaluate: () => {
                throw new Error('explicit structured action should not use reply gate')
            }
        },
        classifyResponseMode: () => {
            throw new Error('explicit structured action should not classify response mode')
        }
    })

    assert.deepStrictEqual(explicitPrecedenceDecision.structuredAction.snapshot, {
        action: 'subscription.write',
        groupId: '1000',
        input: {
            operation: 'remove_user',
            uid: '99'
        }
    })

    assert.deepStrictEqual(evaluateStructuredBotControlPermission({
        action: 'runtime.read',
        permissionFacts: {
            source: 'group',
            isRootAdmin: false,
            isGroupAdmin: false,
            canManageCurrentGroup: false
        },
        groupId: '1000'
    }), {
        allowed: true,
        permissionClass: 'public_read',
        reason: null,
        userMessage: null
    })

    const rootPrivatePermissionFacts = buildPermissionFacts({
        agentInput: {
            groupId: 'private_1',
            userId: '1',
            source: 'private'
        },
        config
    })

    assert.deepStrictEqual(rootPrivatePermissionFacts, {
        source: 'private',
        isRootAdmin: true,
        isGroupAdmin: false,
        canManageCurrentGroup: false
    })

    for (const action of ['config.read', 'config.write', 'subscription.read', 'subscription.write']) {
        const expectedMessage = action.endsWith('.read')
            ? '你没有权限查看当前群管理信息。'
            : '你没有权限执行当前群管理操作。'
        const expectedPermissionClass = action.endsWith('.read') ? 'admin_read' : 'admin_write'

        assert.deepStrictEqual(evaluateStructuredBotControlPermission({
            action,
            permissionFacts: rootPrivatePermissionFacts,
            groupId: 'private_1'
        }), {
            allowed: false,
            permissionClass: expectedPermissionClass,
            reason: 'permission_denied',
            userMessage: expectedMessage
        })
    }

    for (const action of ['approval.read', 'approval.write']) {
        assert.deepStrictEqual(evaluateStructuredBotControlPermission({
            action,
            permissionFacts: rootPrivatePermissionFacts,
            groupId: 'private_1'
        }), {
            allowed: true,
            permissionClass: 'root_private_only',
            reason: null,
            userMessage: null
        })
    }

    assert.deepStrictEqual(evaluateStructuredBotControlPermission({
        action: 'approval.read',
        permissionFacts: {
            source: 'group',
            isRootAdmin: true,
            isGroupAdmin: false,
            canManageCurrentGroup: true
        },
        groupId: '1000'
    }), {
        allowed: false,
        permissionClass: 'root_private_only',
        reason: 'root_private_only',
        userMessage: '该操作仅允许 Root 在私聊中执行。'
    })

    console.log('✓ agentDecisionService 会组合 gate/responseMode，并优先使用显式 structured action；命中文本短语时走既有 bot-control 语义，并按显式 permissionClass 产出权限结论')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
