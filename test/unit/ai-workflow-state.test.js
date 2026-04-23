#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { CONFIRMATION_STATES } = require('../../src/services/ai/agentTypes')
const { AgentConfirmationService } = require('../../src/services/ai/agentConfirmationService')
const { CandidateSelectionStateService, SNAPSHOT_TTL_MS } = require('../../src/services/ai/candidateSelectionStateService')
const { WorkflowStateService } = require('../../src/services/ai/workflow/workflowStateService')
const { WORKFLOW_KINDS } = require('../../src/services/ai/workflow/workflowTypes')

async function testWorkflowStateServiceStoresByGroupActorAndKind() {
    const workflowStateService = new WorkflowStateService({ now: () => 1000 })

    workflowStateService.setRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.CONFIRMATION,
        record: {
            confirmationId: 'confirm-1',
            state: CONFIRMATION_STATES.PENDING,
            summary: 'pending confirmation'
        }
    })
    workflowStateService.setRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.SELECTION,
        record: {
            query: '测试UP',
            state: 'ready',
            expiresAt: 1500
        }
    })
    workflowStateService.setRecord({
        groupId: 'group-2',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.CONFIRMATION,
        record: {
            confirmationId: 'confirm-2',
            state: CONFIRMATION_STATES.PENDING,
            summary: 'other group confirmation'
        }
    })

    assert.strictEqual(
        workflowStateService.getPendingRecord({
            groupId: 'group-1',
            actorUserId: 'actor-1',
            kind: WORKFLOW_KINDS.CONFIRMATION
        }).confirmationId,
        'confirm-1'
    )
    assert.strictEqual(
        workflowStateService.getRecord({
            groupId: 'group-1',
            actorUserId: 'actor-1',
            kind: WORKFLOW_KINDS.SELECTION
        }).query,
        '测试UP'
    )
    assert.strictEqual(
        workflowStateService.getPendingRecord({
            groupId: 'group-2',
            actorUserId: 'actor-1',
            kind: WORKFLOW_KINDS.CONFIRMATION
        }).confirmationId,
        'confirm-2'
    )
    assert.strictEqual(workflowStateService.getRecord({
        groupId: 'group-1',
        actorUserId: 'actor-2',
        kind: WORKFLOW_KINDS.SELECTION
    }), null)
}

async function testWorkflowStateServiceHandlesExpiryAndCleanup() {
    let now = 1000
    const workflowStateService = new WorkflowStateService({ now: () => now })

    workflowStateService.setRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.SELECTION,
        record: {
            query: '测试UP',
            expiresAt: 1100
        }
    })

    assert.strictEqual(workflowStateService.getRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.SELECTION,
        includeExpired: true
    }).query, '测试UP')

    now = 1101

    assert.strictEqual(workflowStateService.getRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.SELECTION
    }), null)
    assert.strictEqual(workflowStateService.getRecord({
        groupId: 'group-1',
        actorUserId: 'actor-1',
        kind: WORKFLOW_KINDS.SELECTION,
        includeExpired: true
    }), null)
}

async function testAgentConfirmationServicePreservesPendingConfirmRejectSemantics() {
    let now = 1710000000000
    const confirmationService = new AgentConfirmationService({
        now: () => now,
        random: () => 0.123456789
    })

    const created = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 42 添加到当前群订阅',
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '42' }
        }
    })

    assert.strictEqual(created.confirmationId, '1710000000000_123456789')
    assert.strictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: created.confirmationId
    }).summary, '将 UID 42 添加到当前群订阅')

    const duplicate = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        action: 'context.write',
        summary: '重置当前群聊上下文',
        snapshot: {
            action: 'context.write',
            input: { operation: 'reset' }
        }
    })

    assert.strictEqual(duplicate.ok, false)
    assert.strictEqual(duplicate.code, 'pending_confirmation_exists')
    assert.deepStrictEqual(confirmationService.setPendingConfirmationBotMessageId({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: created.confirmationId,
        botMessageId: 'bot-confirm-1'
    }), {
        confirmationId: '1710000000000_123456789',
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 42 添加到当前群订阅',
        state: CONFIRMATION_STATES.PENDING,
        createdAt: 1710000000000,
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '42' }
        },
        botMessageId: 'bot-confirm-1'
    })
    assert.strictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '3',
        confirmationId: created.confirmationId
    }), null)

    now += 10

    const rejected = confirmationService.reject({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: created.confirmationId
    })

    assert.strictEqual(rejected.state, CONFIRMATION_STATES.REJECTED)
    assert.strictEqual(rejected.rejectedAt, 1710000000010)
    assert.strictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: created.confirmationId
    }), null)

    assert.throws(
        () => confirmationService.confirm({
            groupId: '1000',
            actorUserId: '2',
            confirmationId: created.confirmationId
        }),
        /Pending confirmation not found/
    )
}

async function testCandidateSelectionStateServicePreservesSnapshotSemantics() {
    let now = 1710000000000
    const candidateSelectionStateService = new CandidateSelectionStateService({
        now: () => now,
        ttlMs: SNAPSHOT_TTL_MS
    })

    const savedSnapshot = candidateSelectionStateService.saveSnapshot({
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-1',
        query: '测试UP',
        candidates: [
            { uid: '42', name: '测试UP官方' },
            { uid: '', name: '无效候选' }
        ]
    })

    assert.deepStrictEqual(savedSnapshot, {
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-1',
        query: '测试UP',
        candidates: [
            { uid: '42', name: '测试UP官方' }
        ],
        createdAt: 1710000000000,
        expiresAt: 1710000600000
    })

    assert.deepStrictEqual(candidateSelectionStateService.setSnapshotBotMessageId({
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-2'
    }), {
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-2',
        query: '测试UP',
        candidates: [
            { uid: '42', name: '测试UP官方' }
        ],
        createdAt: 1710000000000,
        expiresAt: 1710000600000
    })

    assert.strictEqual(candidateSelectionStateService.getSnapshot({
        groupId: '1000',
        actorUserId: '3'
    }), null)

    now = 1710000600001

    assert.strictEqual(candidateSelectionStateService.getSnapshot({
        groupId: '1000',
        actorUserId: '2'
    }), null)
    assert.strictEqual(candidateSelectionStateService.clearSnapshot({
        groupId: '1000',
        actorUserId: '2'
    }), false)
}

async function testConfirmationBotMessageIdBackfillIgnoresLateSendForReplacedConfirmation() {
    let now = 1710000000000
    const confirmationService = new AgentConfirmationService({
        now: () => now,
        random: () => (now === 1710000000000 ? 0.111111111 : 0.222222222)
    })

    const firstConfirmation = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 42 添加到当前群订阅',
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '42' }
        }
    })

    const resolvedConfirmation = confirmationService.reject({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: firstConfirmation.confirmationId
    })

    assert.strictEqual(resolvedConfirmation.confirmationId, firstConfirmation.confirmationId)
    assert.strictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: firstConfirmation.confirmationId
    }), null)

    now += 10

    const secondConfirmation = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 84 添加到当前群订阅',
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '84' }
        }
    })

    const lateBackfillResult = confirmationService.setPendingConfirmationBotMessageId({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: firstConfirmation.confirmationId,
        botMessageId: 'late-bot-msg-1'
    })

    assert.deepStrictEqual(lateBackfillResult, {
        confirmationId: secondConfirmation.confirmationId,
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 84 添加到当前群订阅',
        state: CONFIRMATION_STATES.PENDING,
        createdAt: 1710000000010,
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '84' }
        }
    })
    assert.deepStrictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: secondConfirmation.confirmationId
    }), {
        confirmationId: secondConfirmation.confirmationId,
        groupId: '1000',
        actorUserId: '2',
        action: 'subscription.write',
        summary: '将 UID 84 添加到当前群订阅',
        state: CONFIRMATION_STATES.PENDING,
        createdAt: 1710000000010,
        snapshot: {
            action: 'subscription.write',
            input: { operation: 'add_user', uid: '84' }
        }
    })
}

async function testWrappersCanShareWorkflowStateWithoutCrossKindCollisions() {
    let now = 1710000000000
    const workflowStateService = new WorkflowStateService({ now: () => now })
    const confirmationService = new AgentConfirmationService({
        now: () => now,
        random: () => 0.5,
        workflowStateService
    })
    const candidateSelectionStateService = new CandidateSelectionStateService({
        now: () => now,
        workflowStateService
    })

    const pendingConfirmation = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        action: 'context.write',
        summary: '重置当前群聊上下文',
        snapshot: {
            action: 'context.write',
            input: { operation: 'reset' }
        }
    })

    candidateSelectionStateService.saveSnapshot({
        groupId: '1000',
        actorUserId: '2',
        query: '测试UP',
        candidates: [{ uid: '42', name: '测试UP官方' }]
    })

    assert.strictEqual(confirmationService.getPendingConfirmation({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: pendingConfirmation.confirmationId
    }).confirmationId, pendingConfirmation.confirmationId)
    assert.strictEqual(candidateSelectionStateService.getSnapshot({
        groupId: '1000',
        actorUserId: '2'
    }).query, '测试UP')

    now += 1

    const confirmed = confirmationService.confirm({
        groupId: '1000',
        actorUserId: '2',
        confirmationId: pendingConfirmation.confirmationId
    })

    assert.strictEqual(confirmed.state, CONFIRMATION_STATES.CONFIRMED)
    assert.strictEqual(candidateSelectionStateService.getSnapshot({
        groupId: '1000',
        actorUserId: '2'
    }).query, '测试UP')
}

async function run() {
    await testWorkflowStateServiceStoresByGroupActorAndKind()
    await testWorkflowStateServiceHandlesExpiryAndCleanup()
    await testAgentConfirmationServicePreservesPendingConfirmRejectSemantics()
    await testCandidateSelectionStateServicePreservesSnapshotSemantics()
    await testConfirmationBotMessageIdBackfillIgnoresLateSendForReplacedConfirmation()
    await testWrappersCanShareWorkflowStateWithoutCrossKindCollisions()
    console.log('✓ ai workflow state foundation preserves confirmation and candidate selection semantics')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
