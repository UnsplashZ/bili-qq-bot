#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { AgentConfirmationService } = require('../../src/services/ai/agentConfirmationService')
const { CandidateSelectionStateService } = require('../../src/services/ai/candidateSelectionStateService')
const { createBotControlRegistry, createBotControlRuntime } = require('../../src/services/ai/botControl')
const { getBotControlActionDefinition } = require('../../src/services/ai/botControl/registry')

const TEST_ACTOR_USER_ID = '2'

function actorContext(actorUserId = TEST_ACTOR_USER_ID) {
    return {
        actorUserId,
        userId: actorUserId
    }
}

function createTestRuntime({ groupId = '1000', overrides = {} } = {}) {
    const confirmationService = overrides.confirmationService || new AgentConfirmationService({
        now: () => 1710000000000,
        random: () => 0.123456789
    })

    const config = overrides.config || {
        aiEnabled: true,
        aiRagEnabled: false,
        aiProfileEnabled: true,
        aiProbability: 0.25,
        aiContextLimit: 16,
        aiTemperature: 0.8,
        groupConfigs: {},
        isAiEnabledForGroup(groupId) {
            return this.getGroupConfig(groupId, 'aiEnabled')
        },
        isRagEnabledForGroup(groupId) {
            return this.getGroupConfig(groupId, 'aiRagEnabled')
        },
        getGroupConfig(groupId, key) {
            const groupConfig = this.groupConfigs[String(groupId)] || {}
            return Object.prototype.hasOwnProperty.call(groupConfig, key)
                ? groupConfig[key]
                : this[key]
        },
        ensureGroupConfig(groupId) {
            const safeGroupId = String(groupId)
            if (!this.groupConfigs[safeGroupId]) {
                this.groupConfigs[safeGroupId] = {}
            }
            return this.groupConfigs[safeGroupId]
        },
        saveCalls: 0,
        save() {
            this.saveCalls += 1
        }
    }

    const rawRuntime = createBotControlRuntime({
        groupId,
        confirmationService,
        candidateSelectionStateService: overrides.candidateSelectionStateService || new CandidateSelectionStateService({
            now: overrides.now || (() => Date.now())
        }),
        now: overrides.now,
        config,
        subscriptionService: overrides.subscriptionService || {
            getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
            searchUsers: async () => ({ status: 'success', data: { candidates: [], total: 0 } }),
            addUserSubscription: async () => {},
            removeUserSubscription: async () => {}
        },
        aiContextService: overrides.aiContextService || {
            getContext: () => [],
            getCacheStats: () => ({ cachedGroups: 0, maxCachedGroups: 50, pendingSaves: 0, ttlMinutes: 60 }),
            resetContext: () => {},
            contexts: new Map(),
            lastAccess: new Map()
        },
        requestApprovalService: overrides.requestApprovalService || {
            listPendingApprovals: () => ({ pendingCount: 0, items: [] }),
            handleExactApprovalDecision: async () => ({
                ok: false,
                mutation: false,
                status: 'missing_target',
                pendingCount: 0,
                target: null,
                actionResult: null,
                error: 'missing_target'
            })
        },
        replyGateService: overrides.replyGateService || { groupStates: new Map() }
    })

    const runtime = {
        ...rawRuntime,
        read(action, input = {}, context = actorContext()) {
            return rawRuntime.read(action, input, context)
        },
        write(action, input = {}, context = actorContext()) {
            return rawRuntime.write(action, input, context)
        },
        confirm(confirmationId, context = actorContext()) {
            return rawRuntime.confirm(confirmationId, context)
        },
        reject(confirmationId, context = actorContext()) {
            return rawRuntime.reject(confirmationId, context)
        },
        getPendingConfirmation(confirmationIdOrOptions, context = actorContext()) {
            return rawRuntime.getPendingConfirmation(confirmationIdOrOptions, context)
        },
        getCandidateSelectionSnapshot(options = {}, context = actorContext()) {
            return rawRuntime.getCandidateSelectionSnapshot(options, context)
        },
        setCandidateSelectionSnapshotBotMessageId(botMessageIdOrOptions, context = actorContext()) {
            return rawRuntime.setCandidateSelectionSnapshotBotMessageId(botMessageIdOrOptions, context)
        },
        clearCandidateSelectionSnapshot(options = {}, context = actorContext()) {
            return rawRuntime.clearCandidateSelectionSnapshot(options, context)
        }
    }

    return {
        runtime,
        rawRuntime,
        confirmationService,
        config
    }
}

async function testSubscriptionReadDispatchesWithinCurrentGroup() {
    const registry = createBotControlRegistry({
        subscriptionService: {
            getSubscriptionsByGroup: async (groupId) => {
                assert.strictEqual(groupId, '1000')
                return {
                    users: [
                        { uid: '42', name: '测试UP', roomId: 9001, groupIds: ['1000', '2000'] }
                    ],
                    bangumis: [
                        { seasonId: '77', title: '测试番剧', groupIds: ['1000'] }
                    ]
                }
            },
            searchUsers: async () => ({ status: 'success', data: { candidates: [], total: 0 } }),
            addUserSubscription: async () => {},
            removeUserSubscription: async () => {}
        },
        confirmationService: new AgentConfirmationService(),
        config: {
            getGroupConfig: () => 0,
            isAiEnabledForGroup: () => false,
            isRagEnabledForGroup: () => false
        },
        aiContextService: {
            getContext: () => [],
            getCacheStats: () => ({ cachedGroups: 0, maxCachedGroups: 50, pendingSaves: 0, ttlMinutes: 60 }),
            resetContext: () => {},
            contexts: new Map(),
            lastAccess: new Map()
        },
        replyGateService: { groupStates: new Map() }
    })

    const result = await registry.dispatch({
        action: 'subscription.read',
        groupId: '1000'
    })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'subscription')
    assert.strictEqual(result.scope, 'current_group')
    assert.deepStrictEqual(result.data.counts, {
        users: 1,
        bangumis: 1,
        total: 2
    })
    assert.deepStrictEqual(result.data.users[0], {
        type: 'user',
        uid: '42',
        name: '测试UP',
        roomId: '9001',
        groupIds: ['1000', '2000']
    })
    assert.deepStrictEqual(result.data.bangumis[0], {
        type: 'bangumi',
        seasonId: '77',
        title: '测试番剧',
        groupIds: ['1000']
    })
}

async function testSubscriptionReadSearchUserReturnsDeterministicCandidates() {
    const registry = createBotControlRegistry({
        subscriptionService: {
            getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
            searchUsers: async (query, groupId, options) => {
                assert.strictEqual(query, '测试UP')
                assert.strictEqual(groupId, '1000')
                assert.deepStrictEqual(options, { page: 1, pageSize: 5 })
                return {
                    status: 'success',
                    data: {
                        query,
                        total: 12,
                        candidates: [
                            {
                                uid: 42,
                                name: '测试UP官方',
                                sign: '这里是简介',
                                avatar: 'https://i0.hdslb.com/test.jpg',
                                room_id: 9001,
                                fans: 321000,
                                videos: 123,
                                level: 6,
                                official_verify_type: 0,
                                official_verify_desc: 'bilibili 知名UP主',
                                is_live: 1,
                                is_upuser: 1
                            },
                            {
                                uid: '',
                                name: '无效候选人'
                            },
                            {
                                uid: '84',
                                name: '测试UP搬运',
                                sign: '',
                                avatar: '',
                                room_id: 0,
                                fans: '12',
                                videos: '5',
                                level: '3',
                                official_verify_type: -1,
                                official_verify_desc: '',
                                is_live: 0,
                                is_upuser: 1
                            }
                        ]
                    }
                }
            },
            addUserSubscription: async () => {},
            removeUserSubscription: async () => {}
        },
        confirmationService: new AgentConfirmationService(),
        config: {
            getGroupConfig: () => 0,
            isAiEnabledForGroup: () => false,
            isRagEnabledForGroup: () => false
        },
        aiContextService: {
            getContext: () => [],
            getCacheStats: () => ({ cachedGroups: 0, maxCachedGroups: 50, pendingSaves: 0, ttlMinutes: 60 }),
            resetContext: () => {},
            contexts: new Map(),
            lastAccess: new Map()
        },
        replyGateService: { groupStates: new Map() }
    })

    const result = await registry.dispatch({
        action: 'subscription.read',
        groupId: '1000',
        input: {
            operation: 'search_user',
            query: '测试UP'
        }
    })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.data.operation, 'search_user')
    assert.strictEqual(result.data.query, '测试UP')
    assert.deepStrictEqual(result.data.counts, {
        returned: 2,
        total: 12
    })
    assert.deepStrictEqual(result.data.candidates[0], {
        rank: 1,
        uid: '42',
        name: '测试UP官方',
        sign: '这里是简介',
        avatarUrl: 'https://i0.hdslb.com/test.jpg',
        roomId: '9001',
        fans: 321000,
        videoCount: 123,
        level: 6,
        officialVerifyType: 0,
        officialVerifyDesc: 'bilibili 知名UP主',
        isLive: true,
        isUpUser: true
    })
    assert.deepStrictEqual(result.data.candidates[1], {
        rank: 2,
        uid: '84',
        name: '测试UP搬运',
        sign: '',
        avatarUrl: '',
        roomId: null,
        fans: 12,
        videoCount: 5,
        level: 3,
        officialVerifyType: -1,
        officialVerifyDesc: '',
        isLive: false,
        isUpUser: true
    })
}

async function testSubscriptionReadSearchUserPropagatesSearchFailure() {
    const { runtime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                searchUsers: async () => ({ status: 'error', message: '搜索服务异常' }),
                addUserSubscription: async () => {},
                removeUserSubscription: async () => {}
            }
        }
    })

    await assert.rejects(
        () => runtime.read('subscription.read', { operation: 'search_user', query: '测试UP' }),
        /搜索服务异常/
    )
}

async function testRuntimeReadReturnsStructuredCurrentGroupStatus() {
    const now = 1710000000000
    const groupStates = new Map([
        ['1000', {
            messageTimestamps: [now - 5000, now - 15000, now - 70000],
            botReplyTimestamps: [now - 4000],
            recentBotInteractions: new Map([
                ['2001', now - 3000],
                ['2002', now - 120000]
            ])
        }]
    ])
    const aiContextService = {
        getContext: (groupId) => {
            assert.strictEqual(groupId, '1000')
            return [{ role: 'user', content: '你好' }, { role: 'assistant', content: '在' }]
        },
        getCacheStats: () => ({
            cachedGroups: 1,
            maxCachedGroups: 50,
            pendingSaves: 0,
            ttlMinutes: 60
        }),
        resetContext: () => {},
        contexts: new Map([['1000', [{}, {}]]]),
        lastAccess: new Map([['1000', now - 1000]])
    }
    const { runtime } = createTestRuntime({
        overrides: {
            now: () => now,
            config: {
                isAiEnabledForGroup: () => true,
                isRagEnabledForGroup: () => true,
                getGroupConfig: (_groupId, key) => ({
                    aiBusyWindowSeconds: 60,
                    aiBusyMessageCount: 2,
                    aiMaxRepliesPerWindow: 1,
                    aiProbability: 0.35,
                    aiContextLimit: 20,
                    aiTemperature: 0.7,
                    aiPromptAssemblerEnabled: true,
                    aiStructuredContextEnabled: true
                })[key]
            },
            aiContextService,
            replyGateService: { groupStates }
        }
    })

    const result = await runtime.read('runtime.read')

    assert.deepStrictEqual(runtime.listActions(), ['subscription.read', 'subscription.write', 'approval.read', 'approval.write', 'runtime.read', 'config.read', 'config.write', 'context.write'])
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'runtime')
    assert.strictEqual(result.data.ai.enabled, true)
    assert.strictEqual(result.data.ai.ragEnabled, true)
    assert.strictEqual(result.data.context.messageCount, 2)
    assert.strictEqual(result.data.context.cached, true)
    assert.strictEqual(result.data.replyGate.tracked, true)
    assert.strictEqual(result.data.replyGate.recentMessageCount, 2)
    assert.strictEqual(result.data.replyGate.recentReplyCount, 1)
    assert.strictEqual(result.data.replyGate.recentInteractionCount, 1)
    assert.strictEqual(result.data.replyGate.busy, true)
    assert.strictEqual(result.data.replyGate.replyLimited, true)
}

async function testReadRejectsCrossGroupOverride() {
    const { runtime } = createTestRuntime()

    await assert.rejects(
        () => runtime.read('subscription.read', { groupId: '2000' }),
        /current group scope/
    )
}

async function testSubscriptionReadSearchUserRequiresQuery() {
    const { runtime } = createTestRuntime()

    await assert.rejects(
        () => runtime.read('subscription.read', { operation: 'search_user', query: '   ' }),
        /requires a non-empty query/
    )
}

async function testConfigReadReturnsCurrentGroupSnapshot() {
    const { runtime } = createTestRuntime({
        overrides: {
            config: {
                aiEnabled: true,
                aiRagEnabled: false,
                aiProfileEnabled: true,
                aiProbability: 0.25,
                aiContextLimit: 16,
                aiTemperature: 0.8,
                groupConfigs: {
                    '1000': {
                        aiEnabled: false,
                        aiProbability: 0.45,
                        aiContextLimit: 24
                    }
                },
                getGroupConfig(groupId, key) {
                    const groupConfig = this.groupConfigs[String(groupId)] || {}
                    return Object.prototype.hasOwnProperty.call(groupConfig, key)
                        ? groupConfig[key]
                        : this[key]
                },
                ensureGroupConfig(groupId) {
                    if (!this.groupConfigs[String(groupId)]) {
                        this.groupConfigs[String(groupId)] = {}
                    }
                    return this.groupConfigs[String(groupId)]
                },
                save() {},
                isAiEnabledForGroup(groupId) {
                    return this.getGroupConfig(groupId, 'aiEnabled')
                },
                isRagEnabledForGroup(groupId) {
                    return this.getGroupConfig(groupId, 'aiRagEnabled')
                }
            }
        }
    })

    const result = await runtime.read('config.read')

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'config')
    assert.strictEqual(result.scope, 'current_group')
    assert.deepStrictEqual(result.data.fields, [
        'aiEnabled',
        'aiRagEnabled',
        'aiProfileEnabled',
        'aiProbability',
        'aiContextLimit',
        'aiTemperature'
    ])
    assert.deepStrictEqual(result.data.overrides, {
        aiEnabled: false,
        aiRagEnabled: null,
        aiProfileEnabled: null,
        aiProbability: 0.45,
        aiContextLimit: 24,
        aiTemperature: null,
        global: {
            aiEnabled: true,
            aiRagEnabled: false,
            aiProfileEnabled: true,
            aiProbability: 0.25,
            aiContextLimit: 16,
            aiTemperature: 0.8
        }
    })
    assert.deepStrictEqual(result.data.effective, {
        aiEnabled: false,
        aiRagEnabled: false,
        aiProfileEnabled: true,
        aiProbability: 0.45,
        aiContextLimit: 24,
        aiTemperature: 0.8
    })
}

async function testConfigWriteRequiresConfirmationBeforeMutation() {
    const { runtime, config } = createTestRuntime()

    const result = await runtime.write('config.write', {
        aiProbability: '0.5',
        aiContextLimit: '20'
    }, actorContext())

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'config')
    assert.strictEqual(result.confirmationRequired, true)
    assert.deepStrictEqual(config.groupConfigs, {})
    assert.strictEqual(config.saveCalls, 0)
    assert.deepStrictEqual(runtime.getPendingConfirmation(result.confirmation.confirmationId).snapshot, {
        action: 'config.write',
        groupId: '1000',
        input: {
            operation: 'patch',
            updates: {
                aiProbability: 0.5,
                aiContextLimit: 20
            }
        }
    })
}

async function testConfigWriteConfirmationExecutesSavedSnapshot() {
    const { runtime, config } = createTestRuntime()

    const pending = await runtime.write('config.write', {
        aiProbability: '0.5',
        aiContextLimit: '20'
    })
    const confirmationId = pending.confirmation.confirmationId
    const result = await runtime.write('config.write', {
        confirmationId,
        aiProbability: '0.9',
        aiContextLimit: '99'
    })

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.data.updates, {
        aiProbability: 0.5,
        aiContextLimit: 20
    })
    assert.deepStrictEqual(config.groupConfigs['1000'], {
        aiProbability: 0.5,
        aiContextLimit: 20
    })
    assert.strictEqual(config.saveCalls, 1)
    assert.strictEqual(runtime.getPendingConfirmation(confirmationId), null)
}

async function testConfigWriteRejectsCrossGroupAttempt() {
    const { runtime } = createTestRuntime()

    await assert.rejects(
        () => runtime.write('config.write', { aiProbability: 0.5, groupId: '2000' }),
        /current group scope/
    )
}

async function testConfigWriteSurfacesFacadeValidationErrors() {
    const { runtime, config } = createTestRuntime()

    await assert.rejects(
        () => runtime.write('config.write', { aiTemperature: '3' }),
        /aiTemperature must be between 0 and 2/
    )
    assert.deepStrictEqual(config.groupConfigs, {})
    assert.strictEqual(config.saveCalls, 0)
}

async function testManagedBotControlActionsRejectPrivatePseudoGroupScope() {
    const { runtime } = createTestRuntime({
        groupId: 'private_10000'
    })

    await assert.rejects(
        () => runtime.read('config.read'),
        /real group scope/
    )
    await assert.rejects(
        () => runtime.write('config.write', { aiEnabled: false }),
        /real group scope/
    )
    await assert.rejects(
        () => runtime.read('subscription.read', { operation: 'search_user', query: '测试UP' }),
        /real group scope/
    )
    await assert.rejects(
        () => runtime.write('subscription.write', { operation: 'add_user', uid: '42' }),
        /real group scope/
    )
    await assert.rejects(
        () => runtime.write('context.write', { operation: 'reset' }),
        /real group scope/
    )
}

async function testContextWriteRequiresConfirmationBeforeReset() {
    const resetCalls = []
    const { runtime } = createTestRuntime({
        overrides: {
            aiContextService: {
                getContext: () => [],
                getCacheStats: () => ({ cachedGroups: 0, maxCachedGroups: 50, pendingSaves: 0, ttlMinutes: 60 }),
                resetContext: (groupId) => resetCalls.push(groupId),
                contexts: new Map(),
                lastAccess: new Map()
            }
        }
    })

    const result = await runtime.write('context.write', { operation: 'reset' })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.confirmationRequired, true)
    assert.ok(result.confirmation.confirmationId)
    assert.deepStrictEqual(resetCalls, [])
    assert.strictEqual(runtime.getPendingConfirmation(result.confirmation.confirmationId).snapshot.action, 'context.write')
}

async function testContextWriteRejectsCrossGroupAttempt() {
    const { runtime } = createTestRuntime()

    await assert.rejects(
        () => runtime.write('context.write', { operation: 'reset', groupId: '2000' }),
        /current group scope/
    )
}

async function testSubscriptionWriteAddRequiresConfirmation() {
    const addCalls = []
    const { runtime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                addUserSubscription: async (uid, groupId) => addCalls.push({ uid, groupId }),
                removeUserSubscription: async () => {
                    throw new Error('remove should not be called during add confirmation setup')
                }
            }
        }
    })

    const result = await runtime.write('subscription.write', { operation: 'add_user', uid: '42' })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'subscription')
    assert.strictEqual(result.confirmationRequired, true)
    assert.deepStrictEqual(addCalls, [])
    assert.deepStrictEqual(runtime.getPendingConfirmation(result.confirmation.confirmationId).snapshot, {
        action: 'subscription.write',
        groupId: '1000',
        input: {
            operation: 'add_user',
            uid: '42'
        }
    })
}

async function testSubscriptionWriteRemoveRequiresConfirmation() {
    const removeCalls = []
    const { runtime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                addUserSubscription: async () => {
                    throw new Error('add should not be called during remove confirmation setup')
                },
                removeUserSubscription: async (uid, groupId) => removeCalls.push({ uid, groupId })
            }
        }
    })

    const result = await runtime.write('subscription.write', { operation: 'remove_user', uid: '42' })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.namespace, 'subscription')
    assert.strictEqual(result.confirmationRequired, true)
    assert.deepStrictEqual(removeCalls, [])
    assert.deepStrictEqual(runtime.getPendingConfirmation(result.confirmation.confirmationId).snapshot, {
        action: 'subscription.write',
        groupId: '1000',
        input: {
            operation: 'remove_user',
            uid: '42'
        }
    })
}

async function testSubscriptionWriteConfirmationExecutesWithoutReparsingUserText() {
    const addCalls = []
    const { runtime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                addUserSubscription: async (uid, groupId) => addCalls.push({ uid, groupId }),
                removeUserSubscription: async () => {
                    throw new Error('remove should not be called')
                }
            }
        }
    })

    const pending = await runtime.write('subscription.write', { operation: 'add_user', uid: '42' })
    const confirmationId = pending.confirmation.confirmationId
    const result = await runtime.write('subscription.write', {
        confirmationId,
        operation: 'remove_user',
        uid: '999'
    })

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.data, {
        operation: 'add_user',
        subscriptionType: 'user',
        uid: '42',
        status: 'updated'
    })
    assert.deepStrictEqual(addCalls, [{ uid: '42', groupId: '1000' }])
    assert.strictEqual(runtime.getPendingConfirmation(confirmationId), null)
}

async function testPendingConfirmationIsActorScopedWithinSameGroup() {
    const addCalls = []
    const { runtime, rawRuntime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                addUserSubscription: async (uid, groupId) => addCalls.push({ uid, groupId }),
                removeUserSubscription: async () => {
                    throw new Error('remove should not be called')
                }
            }
        }
    })

    const pending = await runtime.write('subscription.write', { operation: 'add_user', uid: '42' }, actorContext('actor-a'))
    const confirmationId = pending.confirmation.confirmationId

    assert.strictEqual(rawRuntime.getPendingConfirmation(confirmationId, actorContext('actor-b')), null)
    await assert.rejects(
        () => rawRuntime.confirm(confirmationId, actorContext('actor-b')),
        /current group actor/
    )
    assert.throws(
        () => rawRuntime.reject(confirmationId, actorContext('actor-b')),
        /current group actor/
    )

    const result = await rawRuntime.confirm(confirmationId, actorContext('actor-a'))
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.data.uid, '42')
    assert.deepStrictEqual(addCalls, [{ uid: '42', groupId: '1000' }])
    assert.strictEqual(rawRuntime.getPendingConfirmation(confirmationId, actorContext('actor-a')), null)
}

async function testSameActorCannotCreateSecondPendingConfirmationInSameGroup() {
    const { runtime } = createTestRuntime()

    const firstPending = await runtime.write('context.write', { operation: 'reset' }, actorContext('actor-a'))
    const secondAttempt = await runtime.write('subscription.write', { operation: 'add_user', uid: '42' }, actorContext('actor-a'))
    const otherActorPending = await runtime.write('subscription.write', { operation: 'add_user', uid: '84' }, actorContext('actor-b'))

    assert.strictEqual(firstPending.confirmationRequired, true)
    assert.strictEqual(secondAttempt.ok, false)
    assert.strictEqual(secondAttempt.confirmationRequired, false)
    assert.strictEqual(secondAttempt.data.status, 'pending_confirmation_exists')
    assert.strictEqual(secondAttempt.data.message, '请先处理当前待确认操作。')
    assert.strictEqual(secondAttempt.data.confirmation.confirmationId, firstPending.confirmation.confirmationId)
    assert.strictEqual(runtime.getPendingConfirmation(firstPending.confirmation.confirmationId, actorContext('actor-a')).confirmationId, firstPending.confirmation.confirmationId)
    assert.strictEqual(otherActorPending.confirmationRequired, true)
    assert.strictEqual(runtime.getPendingConfirmation(otherActorPending.confirmation.confirmationId, actorContext('actor-b')).snapshot.input.uid, '84')
}

async function testSameActorCanRejectOwnPendingConfirmation() {
    const { runtime, rawRuntime } = createTestRuntime()

    const pending = await runtime.write('context.write', { operation: 'reset' }, actorContext('actor-a'))
    const rejected = await rawRuntime.reject(pending.confirmation.confirmationId, actorContext('actor-a'))

    assert.strictEqual(rejected.state, 'rejected')
    assert.strictEqual(rejected.actorUserId, 'actor-a')
    assert.strictEqual(rawRuntime.getPendingConfirmation(pending.confirmation.confirmationId, actorContext('actor-a')), null)
}

async function testSubscriptionWriteCallsScopedAddAndRemoveMethods() {
    const calls = []
    let users = []
    const { runtime } = createTestRuntime({
        overrides: {
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users, bangumis: [] }),
                addUserSubscription: async (uid, groupId) => {
                    calls.push({ method: 'add', uid, groupId })
                    users = [{ uid, name: '测试UP', groupIds: [groupId] }]
                },
                removeUserSubscription: async (uid, groupId) => {
                    calls.push({ method: 'remove', uid, groupId })
                    users = []
                }
            }
        }
    })

    const addPending = await runtime.write('subscription.write', { operation: 'add_user', uid: '42' })
    await runtime.confirm(addPending.confirmation.confirmationId)

    const removePending = await runtime.write('subscription.write', { operation: 'remove_user', uid: '42' })
    await runtime.confirm(removePending.confirmation.confirmationId)

    assert.deepStrictEqual(calls, [
        { method: 'add', uid: '42', groupId: '1000' },
        { method: 'remove', uid: '42', groupId: '1000' }
    ])
}

async function testSubscriptionWriteRejectsCrossGroupAttempt() {
    const { runtime } = createTestRuntime()

    await assert.rejects(
        () => runtime.write('subscription.write', { operation: 'add_user', uid: '42', groupId: '2000' }),
        /current group scope/
    )
}

async function testConfirmationSnapshotExecutesWithoutReparsingUserText() {
    const resetCalls = []
    const { runtime } = createTestRuntime({
        overrides: {
            aiContextService: {
                getContext: () => [],
                getCacheStats: () => ({ cachedGroups: 0, maxCachedGroups: 50, pendingSaves: 0, ttlMinutes: 60 }),
                resetContext: (groupId) => resetCalls.push(groupId),
                contexts: new Map(),
                lastAccess: new Map()
            }
        }
    })

    const pending = await runtime.write('context.write', { operation: 'reset' })
    const confirmationId = pending.confirmation.confirmationId
    const result = await runtime.write('context.write', {
        confirmationId,
        operation: 'unsupported_mutation_from_followup_text'
    })

    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.data.operation, 'reset')
    assert.deepStrictEqual(resetCalls, ['1000'])
    assert.strictEqual(runtime.getPendingConfirmation(confirmationId), null)
}

async function testSubscriptionReadSearchUserSavesActorScopedCandidateSelectionSnapshot() {
    const now = 1710000000000
    let searchCallCount = 0
    const { runtime, confirmationService } = createTestRuntime({
        overrides: {
            now: () => now,
            subscriptionService: {
                getSubscriptionsByGroup: async () => ({ users: [], bangumis: [] }),
                searchUsers: async () => {
                    searchCallCount += 1

                    if (searchCallCount === 1) {
                        return {
                            status: 'success',
                            data: {
                                total: 2,
                                candidates: [
                                    { uid: '42', name: '测试UP官方', fans: 321000 },
                                    { uid: '84', name: '测试UP搬运', room_id: 9001, fans: 12 }
                                ]
                            }
                        }
                    }

                    return {
                        status: 'success',
                        data: {
                            total: 1,
                            candidates: [
                                { uid: '777', name: '新的测试UP', fans: 7 }
                            ]
                        }
                    }
                },
                addUserSubscription: async () => {},
                removeUserSubscription: async () => {}
            }
        }
    })

    const pendingConfirmation = confirmationService.createPendingConfirmation({
        groupId: '1000',
        actorUserId: TEST_ACTOR_USER_ID,
        action: 'subscription.write',
        summary: 'add uid 999 to current group subscriptions',
        snapshot: {
            action: 'subscription.write',
            groupId: '1000',
            input: {
                operation: 'add_user',
                uid: '999'
            }
        }
    })

    await runtime.read('subscription.read', {
        operation: 'search_user',
        query: '测试UP'
    }, {
        ...actorContext('2'),
        botMessageId: 'bot-msg-1'
    })

    assert.deepStrictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('2')), {
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-1',
        query: '测试UP',
        candidates: [
            { rank: 1, uid: '42', name: '测试UP官方', sign: '', avatarUrl: '', roomId: null, fans: 321000, videoCount: 0, level: 0, officialVerifyType: -1, officialVerifyDesc: '', isLive: false, isUpUser: false },
            { rank: 2, uid: '84', name: '测试UP搬运', sign: '', avatarUrl: '', roomId: '9001', fans: 12, videoCount: 0, level: 0, officialVerifyType: -1, officialVerifyDesc: '', isLive: false, isUpUser: false }
        ],
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000
    })
    assert.strictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('3')), null)
    assert.strictEqual(runtime.getPendingConfirmation(pendingConfirmation.confirmationId).confirmationId, pendingConfirmation.confirmationId)

    await runtime.read('subscription.read', {
        operation: 'search_user',
        query: '新的测试'
    }, actorContext('3'))

    assert.deepStrictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('3')), {
        groupId: '1000',
        actorUserId: '3',
        botMessageId: null,
        query: '新的测试',
        candidates: [
            { rank: 1, uid: '777', name: '新的测试UP', sign: '', avatarUrl: '', roomId: null, fans: 7, videoCount: 0, level: 0, officialVerifyType: -1, officialVerifyDesc: '', isLive: false, isUpUser: false }
        ],
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000
    })
    assert.deepStrictEqual(runtime.setCandidateSelectionSnapshotBotMessageId('bot-msg-3', actorContext('3')), {
        groupId: '1000',
        actorUserId: '3',
        botMessageId: 'bot-msg-3',
        query: '新的测试',
        candidates: [
            { rank: 1, uid: '777', name: '新的测试UP', sign: '', avatarUrl: '', roomId: null, fans: 7, videoCount: 0, level: 0, officialVerifyType: -1, officialVerifyDesc: '', isLive: false, isUpUser: false }
        ],
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000
    })
    assert.strictEqual(runtime.getPendingConfirmation(pendingConfirmation.confirmationId).confirmationId, pendingConfirmation.confirmationId)
    assert.strictEqual(runtime.clearCandidateSelectionSnapshot({}, actorContext('2')), true)
    assert.strictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('2')), null)
    assert.notStrictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('3')), null)
    assert.strictEqual(runtime.clearCandidateSelectionSnapshot({}, actorContext('3')), true)
    assert.strictEqual(runtime.getCandidateSelectionSnapshot({}, actorContext('3')), null)
    assert.strictEqual(runtime.getPendingConfirmation(pendingConfirmation.confirmationId).confirmationId, pendingConfirmation.confirmationId)
}

async function testApprovalReadListsPendingItemsInRootPrivateScope() {
    const { runtime } = createTestRuntime({
        groupId: 'private_10000',
        overrides: {
            requestApprovalService: {
                listPendingApprovals: () => ({
                    pendingCount: 2,
                    items: [
                        {
                            key: 'friend:-:flag_1',
                            shortId: 'REQ-AAAAAA',
                            requestType: 'friend',
                            requestTypeLabel: '好友申请',
                            userId: '30001',
                            groupId: '',
                            comment: '你好',
                            status: 'PENDING'
                        },
                        {
                            key: 'group:invite:flag_2',
                            shortId: 'REQ-BBBBBB',
                            requestType: 'group',
                            requestTypeLabel: '邀请入群',
                            userId: '30002',
                            groupId: '90001',
                            comment: '邀请你进群',
                            status: 'PENDING'
                        }
                    ]
                }),
                handleExactApprovalDecision: async () => {
                    throw new Error('should not write during approval.read')
                }
            }
        }
    })

    const result = await runtime.read('approval.read')
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.scope, 'root_private')
    assert.strictEqual(result.data.counts.pending, 2)
    assert.strictEqual(result.data.items[0].shortId, 'REQ-AAAAAA')
    assert.strictEqual(result.data.items[1].groupId, '90001')
}

async function testApprovalWriteRequiresRootPrivateScopeAndExactTarget() {
    const groupRuntime = createTestRuntime({
        groupId: '1000'
    }).runtime

    await assert.rejects(
        () => groupRuntime.write('approval.write', {
            operation: 'approve',
            shortId: 'REQ-AAAAAA'
        }),
        /Root private scope/
    )

    const { runtime } = createTestRuntime({
        groupId: 'private_10000',
        overrides: {
            requestApprovalService: {
                listPendingApprovals: () => ({ pendingCount: 0, items: [] }),
                handleExactApprovalDecision: async (_ws, payload) => {
                    assert.deepStrictEqual(payload, {
                        decision: 'approve',
                        shortId: 'REQ-AAAAAA',
                        replyMessageId: ''
                    })
                    return {
                        ok: true,
                        mutation: true,
                        status: 'executed',
                        resolveMode: 'short_id',
                        shortId: 'REQ-AAAAAA',
                        replyMessageId: '',
                        pendingCount: 1,
                        target: {
                            shortId: 'REQ-AAAAAA',
                            requestTypeLabel: '好友申请'
                        },
                        actionResult: {
                            ok: true,
                            wording: 'ok'
                        }
                    }
                }
            }
        }
    })

    const result = await runtime.write('approval.write', {
        operation: 'approve',
        shortId: 'REQ-AAAAAA'
    })
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.mutation, true)
    assert.strictEqual(result.data.status, 'executed')
    assert.strictEqual(result.data.shortId, 'REQ-AAAAAA')
    assert.strictEqual(result.data.pendingCount, 1)

    await assert.rejects(
        () => runtime.write('approval.write', { operation: 'approve' }),
        /exact target/
    )
}

async function testApprovalWriteSupportsReplyExactTarget() {
    const ws = { name: 'mock-ws' }
    const { runtime } = createTestRuntime({
        groupId: 'private_10000',
        overrides: {
            requestApprovalService: {
                listPendingApprovals: () => ({ pendingCount: 0, items: [] }),
                handleExactApprovalDecision: async (receivedWs, payload) => {
                    assert.strictEqual(receivedWs, ws)
                    assert.deepStrictEqual(payload, {
                        decision: 'reject',
                        shortId: '',
                        replyMessageId: '2001'
                    })
                    return {
                        ok: false,
                        mutation: false,
                        status: 'invalid_reply',
                        resolveMode: 'reply',
                        shortId: '',
                        replyMessageId: '2001',
                        pendingCount: 1,
                        target: null,
                        actionResult: null,
                        error: 'invalid_reply'
                    }
                }
            }
        }
    })

    const result = await runtime.write('approval.write', {
        operation: 'reject',
        replyMessageId: '2001',
        ws
    })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.mutation, false)
    assert.strictEqual(result.data.status, 'invalid_reply')
    assert.match(result.data.message, /引用的审批消息不存在/)
}

async function testBotControlActionDefinitionsExposeExplicitPermissionClasses() {
    assert.deepStrictEqual(getBotControlActionDefinition('runtime.read'), {
        permissionClass: 'public_read'
    })
    assert.deepStrictEqual(getBotControlActionDefinition('config.read'), {
        permissionClass: 'admin_read'
    })
    assert.deepStrictEqual(getBotControlActionDefinition('config.write'), {
        permissionClass: 'admin_write'
    })
    assert.deepStrictEqual(getBotControlActionDefinition('approval.read'), {
        permissionClass: 'root_private_only'
    })
    assert.deepStrictEqual(getBotControlActionDefinition('approval.write'), {
        permissionClass: 'root_private_only'
    })
}

async function run() {
    await testSubscriptionReadDispatchesWithinCurrentGroup()
    await testSubscriptionReadSearchUserReturnsDeterministicCandidates()
    await testSubscriptionReadSearchUserPropagatesSearchFailure()
    await testRuntimeReadReturnsStructuredCurrentGroupStatus()
    await testReadRejectsCrossGroupOverride()
    await testSubscriptionReadSearchUserRequiresQuery()
    await testConfigReadReturnsCurrentGroupSnapshot()
    await testConfigWriteRequiresConfirmationBeforeMutation()
    await testConfigWriteConfirmationExecutesSavedSnapshot()
    await testConfigWriteRejectsCrossGroupAttempt()
    await testConfigWriteSurfacesFacadeValidationErrors()
    await testManagedBotControlActionsRejectPrivatePseudoGroupScope()
    await testContextWriteRequiresConfirmationBeforeReset()
    await testContextWriteRejectsCrossGroupAttempt()
    await testSubscriptionWriteAddRequiresConfirmation()
    await testSubscriptionWriteRemoveRequiresConfirmation()
    await testSubscriptionWriteConfirmationExecutesWithoutReparsingUserText()
    await testPendingConfirmationIsActorScopedWithinSameGroup()
    await testSameActorCannotCreateSecondPendingConfirmationInSameGroup()
    await testSameActorCanRejectOwnPendingConfirmation()
    await testSubscriptionWriteCallsScopedAddAndRemoveMethods()
    await testSubscriptionWriteRejectsCrossGroupAttempt()
    await testConfirmationSnapshotExecutesWithoutReparsingUserText()
    await testSubscriptionReadSearchUserSavesActorScopedCandidateSelectionSnapshot()
    await testApprovalReadListsPendingItemsInRootPrivateScope()
    await testApprovalWriteRequiresRootPrivateScopeAndExactTarget()
    await testApprovalWriteSupportsReplyExactTarget()
    await testBotControlActionDefinitionsExposeExplicitPermissionClasses()
    console.log('✓ ai bot-control 支持当前群 AI 配置读取、带确认的配置写入，以及 Root 私聊审批读写、显式 permissionClass 元数据与订阅候选快照/context/subscription 写入')
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
