'use strict'

const { buildContextWriteSnapshot } = require('./botControl/contextController')
const { buildConfigReadSnapshot, buildConfigWriteSnapshot } = require('./botControl/configController')
const { buildSubscriptionReadSnapshot, buildSubscriptionWriteSnapshot } = require('./botControl/subscriptionController')
const { buildApprovalReadSnapshot, buildApprovalWriteSnapshot, isRootPrivateGroupId } = require('./botControl/approvalController')
const { buildRuntimeReadSnapshot } = require('./botControl/runtimeController')
const { getBotControlActionPermissionClass } = require('./botControl/registry')
const { resolveExplicitBotControlActionCandidate } = require('./botControlActionResolutionService')

function resolveBotControlActionCandidate(agentInput = {}) {
    return resolveExplicitBotControlActionCandidate(agentInput)
}

function resolveStructuredBotControlAction(agentInput = {}) {
    const candidate = resolveBotControlActionCandidate(agentInput)

    if (candidate == null) {
        return {
            kind: 'absent',
            permissionClass: null,
            snapshot: null,
            error: null,
            userMessage: null
        }
    }

    const action = String(candidate?.action || '').trim()
    const permissionClass = getBotControlActionPermissionClass(action)
    const input = candidate && typeof candidate.input === 'object' && !Array.isArray(candidate.input)
        ? candidate.input
        : {}
    const groupId = agentInput.groupId

    const confirmationId = String(input.confirmationId || '').trim()
    const baseInput = confirmationId
        ? { ...input, confirmationId: undefined }
        : input

    try {
        if (action === 'candidate_selection.invalid') {
            return {
                kind: 'invalid',
                permissionClass: null,
                snapshot: null,
                error: String(input.error || '').trim() || '候选选择无效，请重新选择。',
                userMessage: String(input.error || '').trim() || '候选选择无效，请重新选择。'
            }
        }

        if (action === 'confirmation.reject') {
            if (!confirmationId) {
                throw new Error('confirmation.reject requires confirmationId')
            }

            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    action,
                    groupId,
                    input: { confirmationId }
                }
            }
        }

        if (action === 'context.write') {
            const snapshot = buildContextWriteSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    ...snapshot,
                    input: confirmationId
                        ? { ...snapshot.input, confirmationId }
                        : snapshot.input
                }
            }
        }

        if (action === 'config.write') {
            const snapshot = buildConfigWriteSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    ...snapshot,
                    input: confirmationId
                        ? { ...snapshot.input, confirmationId }
                        : snapshot.input
                }
            }
        }

        if (action === 'subscription.write') {
            const snapshot = buildSubscriptionWriteSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    ...snapshot,
                    input: confirmationId
                        ? { ...snapshot.input, confirmationId }
                        : snapshot.input
                }
            }
        }

        if (action === 'approval.write') {
            if (!isRootPrivateGroupId(groupId)) {
                return {
                    kind: 'supported',
                    permissionClass,
                    snapshot: {
                        action,
                        groupId,
                        input: confirmationId
                            ? { ...baseInput, confirmationId }
                            : baseInput
                    }
                }
            }

            const snapshot = buildApprovalWriteSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    ...snapshot,
                    input: confirmationId
                        ? { ...snapshot.input, confirmationId }
                        : snapshot.input
                }
            }
        }

        if (action === 'config.read') {
            const snapshot = buildConfigReadSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot
            }
        }

        if (action === 'subscription.read') {
            const snapshot = buildSubscriptionReadSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot
            }
        }

        if (action === 'runtime.read') {
            const snapshot = buildRuntimeReadSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot
            }
        }

        if (action === 'approval.read') {
            if (!isRootPrivateGroupId(groupId)) {
                return {
                    kind: 'supported',
                    permissionClass,
                    snapshot: {
                        action,
                        groupId,
                        input: baseInput
                    }
                }
            }

            const snapshot = buildApprovalReadSnapshot({ groupId, input: baseInput })
            return {
                kind: 'supported',
                permissionClass,
                snapshot
            }
        }

        throw new Error(`Unsupported structured bot-control action: ${action || '<empty>'}`)
    } catch (error) {
        if (/requires a real group scope/i.test(error?.message || '')
            && (permissionClass === 'admin_read' || permissionClass === 'admin_write')) {
            return {
                kind: 'supported',
                permissionClass,
                snapshot: {
                    action,
                    groupId,
                    input: confirmationId
                        ? { ...baseInput, confirmationId }
                        : baseInput
                }
            }
        }

        return {
            kind: 'invalid',
            permissionClass: null,
            snapshot: null,
            error: error?.message || 'Invalid structured bot-control action',
            userMessage: null
        }
    }
}

module.exports = {
    resolveBotControlActionCandidate,
    resolveStructuredBotControlAction
}
