'use strict'

const { BotControlRegistry } = require('./registry')
const { ContextController, buildContextWriteSnapshot } = require('./contextController')
const { ConfigController, buildConfigWriteSnapshot, buildWriteSummary: buildConfigWriteSummary } = require('./configController')
const { SubscriptionController, buildSubscriptionWriteSnapshot } = require('./subscriptionController')
const { ApprovalController } = require('./approvalController')
const { RuntimeController } = require('./runtimeController')
const { candidateSelectionStateService: defaultCandidateSelectionStateService } = require('../candidateSelectionStateService')

function getDefaultConfig() {
    return require('../../../config')
}

function getDefaultSubscriptionService() {
    return require('../../subscriptionService')
}

function getDefaultAiContextService() {
    return require('../../aiContextService')
}

function getDefaultRequestApprovalService() {
    return require('../../requestApprovalService')
}

function getDefaultConfirmationService() {
    return require('../agentConfirmationService').agentConfirmationService
}

function getDefaultReplyGateService() {
    return require('../replyGateService').replyGateService
}

function createBotControlRegistry({
    config: resolvedConfig,
    subscriptionService: resolvedSubscriptionService,
    aiContextService: resolvedAiContextService,
    requestApprovalService: resolvedRequestApprovalService,
    confirmationService: resolvedConfirmationService,
    replyGateService: resolvedReplyGateService,
    now
} = {}) {
    resolvedConfig = resolvedConfig || getDefaultConfig()
    resolvedSubscriptionService = resolvedSubscriptionService || getDefaultSubscriptionService()
    resolvedAiContextService = resolvedAiContextService || getDefaultAiContextService()
    resolvedRequestApprovalService = resolvedRequestApprovalService || getDefaultRequestApprovalService()
    resolvedConfirmationService = resolvedConfirmationService || getDefaultConfirmationService()
    resolvedReplyGateService = resolvedReplyGateService || getDefaultReplyGateService()

    const registry = new BotControlRegistry()

    registry.registerNamespace('subscription', new SubscriptionController({
        subscriptionService: resolvedSubscriptionService
    }))

    registry.registerNamespace('approval', new ApprovalController({
        requestApprovalService: resolvedRequestApprovalService
    }))

    registry.registerNamespace('runtime', new RuntimeController({
        config: resolvedConfig,
        aiContextService: resolvedAiContextService,
        replyGateService: resolvedReplyGateService,
        now
    }))

    registry.registerNamespace('config', new ConfigController({
        config: resolvedConfig
    }))

    registry.registerNamespace('context', new ContextController({
        aiContextService: resolvedAiContextService,
        confirmationService: resolvedConfirmationService
    }))

    return registry
}

function createBotControlRuntime({ groupId, registry, ...deps } = {}) {
    const scopedGroupId = String(groupId || '').trim()
    const resolvedRegistry = registry || createBotControlRegistry(deps)
    const confirmationService = deps.confirmationService || getDefaultConfirmationService()
    const candidateSelectionStateService = deps.candidateSelectionStateService || defaultCandidateSelectionStateService

    function resolveActorUserId(context = {}) {
        return String(context?.actorUserId || context?.userId || '').trim()
    }

    function normalizeConfirmationLookup(confirmationIdOrOptions, context = {}) {
        if (confirmationIdOrOptions && typeof confirmationIdOrOptions === 'object' && !Array.isArray(confirmationIdOrOptions)) {
            return {
                confirmationId: String(confirmationIdOrOptions.confirmationId || '').trim(),
                actorUserId: String(confirmationIdOrOptions.actorUserId || context?.actorUserId || context?.userId || '').trim()
            }
        }

        return {
            confirmationId: String(confirmationIdOrOptions || '').trim(),
            actorUserId: resolveActorUserId(context)
        }
    }

    async function dispatch(action, input = {}, context = {}) {
        return resolvedRegistry.dispatch({
            action,
            groupId: scopedGroupId,
            input,
            context
        })
    }

    function createConfirmationResponse({ action, namespace, summary, snapshot, context = {} }) {
        const confirmation = confirmationService.createPendingConfirmation({
            groupId: scopedGroupId,
            actorUserId: resolveActorUserId(context),
            action,
            summary,
            snapshot
        })

        if (confirmation?.ok === false) {
            return {
                ok: false,
                action,
                namespace,
                operation: 'write',
                scope: 'current_group',
                groupId: scopedGroupId,
                confirmationRequired: false,
                data: {
                    status: confirmation.status || 'pending_confirmation_exists',
                    code: confirmation.code || 'pending_confirmation_exists',
                    message: confirmation.message || '请先处理当前待确认操作。',
                    confirmation: confirmation.confirmation || null
                }
            }
        }

        return {
            ok: true,
            action,
            namespace,
            operation: 'write',
            scope: 'current_group',
            groupId: scopedGroupId,
            confirmationRequired: true,
            confirmation: {
                confirmationId: confirmation.confirmationId,
                state: confirmation.state,
                summary: confirmation.summary,
                createdAt: confirmation.createdAt
            }
        }
    }

    async function executeConfirmedAction(action, confirmationId, context = {}) {
        const confirmation = confirmationService.confirm({
            groupId: scopedGroupId,
            actorUserId: resolveActorUserId(context),
            confirmationId
        })

        if (confirmation.snapshot?.action !== action) {
            throw new Error('Confirmation action does not match requested bot-control action')
        }

        return dispatch(confirmation.snapshot.action, confirmation.snapshot.input, context)
    }

    return {
        groupId: scopedGroupId,
        registry: resolvedRegistry,
        listActions() {
            return resolvedRegistry.getActions()
        },
        async read(action, input = {}, context = {}) {
            const result = await dispatch(action, input, context)

            if (action === 'subscription.read' && result?.data?.operation === 'search_user') {
                candidateSelectionStateService.saveSnapshot({
                    groupId: scopedGroupId,
                    actorUserId: resolveActorUserId(context),
                    botMessageId: context?.botMessageId || null,
                    query: result?.data?.query,
                    candidates: result?.data?.candidates
                })
            }

            return result
        },
        async write(action, input = {}, context = {}) {
            if (action === 'context.write') {
                const confirmationId = String(input.confirmationId || '').trim()

                if (confirmationId) {
                    return executeConfirmedAction(action, confirmationId, context)
                }

                const snapshot = buildContextWriteSnapshot({
                    groupId: scopedGroupId,
                    input
                })

                return createConfirmationResponse({
                    action,
                    namespace: 'context',
                    summary: '重置当前群聊上下文',
                    snapshot,
                    context
                })
            }

            if (action === 'subscription.write') {
                const confirmationId = String(input.confirmationId || '').trim()

                if (confirmationId) {
                    return executeConfirmedAction(action, confirmationId, context)
                }

                const snapshot = buildSubscriptionWriteSnapshot({
                    groupId: scopedGroupId,
                    input
                })
                const summary = snapshot.input.operation === 'add_user'
                    ? `将 UID ${snapshot.input.uid} 添加到当前群订阅`
                    : `将 UID ${snapshot.input.uid} 从当前群订阅中移除`

                return createConfirmationResponse({
                    action,
                    namespace: 'subscription',
                    summary,
                    snapshot,
                    context
                })
            }

            if (action === 'config.write') {
                const confirmationId = String(input.confirmationId || '').trim()

                if (confirmationId) {
                    return executeConfirmedAction(action, confirmationId, context)
                }

                const snapshot = buildConfigWriteSnapshot({
                    groupId: scopedGroupId,
                    input
                })

                return createConfirmationResponse({
                    action,
                    namespace: 'config',
                    summary: buildConfigWriteSummary(snapshot),
                    snapshot,
                    context
                })
            }

            return dispatch(action, input, context)
        },
        getPendingConfirmation(confirmationIdOrOptions, context = {}) {
            const lookup = normalizeConfirmationLookup(confirmationIdOrOptions, context)
            return confirmationService.getPendingConfirmation({
                groupId: scopedGroupId,
                actorUserId: lookup.actorUserId,
                confirmationId: lookup.confirmationId
            })
        },
        getCandidateSelectionSnapshot(options = {}, context = {}) {
            const actorUserId = String(options?.actorUserId || resolveActorUserId(context)).trim()
            return candidateSelectionStateService.getSnapshot({
                groupId: scopedGroupId,
                actorUserId,
                includeExpired: options?.includeExpired === true
            })
        },
        setCandidateSelectionSnapshotBotMessageId(botMessageIdOrOptions, context = {}) {
            const botMessageId = botMessageIdOrOptions && typeof botMessageIdOrOptions === 'object' && !Array.isArray(botMessageIdOrOptions)
                ? botMessageIdOrOptions.botMessageId
                : botMessageIdOrOptions
            const actorUserId = botMessageIdOrOptions && typeof botMessageIdOrOptions === 'object' && !Array.isArray(botMessageIdOrOptions)
                ? String(botMessageIdOrOptions.actorUserId || resolveActorUserId(context)).trim()
                : resolveActorUserId(context)

            return candidateSelectionStateService.setSnapshotBotMessageId({
                groupId: scopedGroupId,
                actorUserId,
                botMessageId
            })
        },
        clearCandidateSelectionSnapshot(options = {}, context = {}) {
            const actorUserId = String(options?.actorUserId || resolveActorUserId(context)).trim()
            return candidateSelectionStateService.clearSnapshot({
                groupId: scopedGroupId,
                actorUserId
            })
        },
        setPendingConfirmationBotMessageId(botMessageIdOrOptions, context = {}) {
            const isOptionsObject = botMessageIdOrOptions && typeof botMessageIdOrOptions === 'object' && !Array.isArray(botMessageIdOrOptions)
            const botMessageId = isOptionsObject
                ? botMessageIdOrOptions.botMessageId
                : botMessageIdOrOptions
            const actorUserId = isOptionsObject
                ? String(botMessageIdOrOptions.actorUserId || resolveActorUserId(context)).trim()
                : String(context?.actorUserId || resolveActorUserId(context)).trim()
            const confirmationId = isOptionsObject
                ? String(botMessageIdOrOptions.confirmationId || '').trim()
                : String(context?.confirmationId || '').trim()

            return confirmationService.setPendingConfirmationBotMessageId({
                groupId: scopedGroupId,
                actorUserId,
                confirmationId,
                botMessageId
            })
        },
        async confirm(confirmationId, context = {}) {
            const pendingConfirmation = confirmationService.getPendingConfirmation({
                groupId: scopedGroupId,
                actorUserId: resolveActorUserId(context),
                confirmationId
            })

            if (!pendingConfirmation) {
                throw new Error('Pending confirmation not found for current group actor')
            }

            return executeConfirmedAction(pendingConfirmation.action, confirmationId, context)
        },
        reject(confirmationId, context = {}) {
            return confirmationService.reject({
                groupId: scopedGroupId,
                actorUserId: resolveActorUserId(context),
                confirmationId
            })
        }
    }
}

let botControlRegistry

function getBotControlRegistry() {
    if (!botControlRegistry) {
        botControlRegistry = createBotControlRegistry()
    }

    return botControlRegistry
}

module.exports = {
    get botControlRegistry() {
        return getBotControlRegistry()
    },
    createBotControlRegistry,
    createBotControlRuntime
}
