'use strict'

const { resolveScopedGroupId } = require('./subscriptionController')

function countRecent(values, windowMs, now) {
    if (!Array.isArray(values) || windowMs <= 0) {
        return 0
    }

    return values.filter(value => Number.isFinite(value) && now - value <= windowMs).length
}

function countRecentInteractions(interactions, windowMs, now) {
    if (!(interactions instanceof Map) || windowMs <= 0) {
        return 0
    }

    let count = 0
    for (const value of interactions.values()) {
        if (Number.isFinite(value) && now - value <= windowMs) {
            count += 1
        }
    }
    return count
}

function buildRuntimeReadSnapshot({ groupId, input = {} } = {}) {
    return {
        action: 'runtime.read',
        groupId: resolveScopedGroupId(groupId, input, 'read'),
        input: {}
    }
}

class RuntimeController {
    constructor({ config, aiContextService, replyGateService, now = () => Date.now() }) {
        this.config = config
        this.aiContextService = aiContextService
        this.replyGateService = replyGateService
        this.now = now
    }

    read({ action, groupId, input }) {
        const scopedGroupId = resolveScopedGroupId(groupId, input)
        const now = this.now()
        const busyWindowSeconds = Number(this.config.getGroupConfig(scopedGroupId, 'aiBusyWindowSeconds')) || 0
        const busyMessageCount = Number(this.config.getGroupConfig(scopedGroupId, 'aiBusyMessageCount')) || 0
        const maxRepliesPerWindow = Number(this.config.getGroupConfig(scopedGroupId, 'aiMaxRepliesPerWindow')) || 0
        const windowMs = busyWindowSeconds * 1000
        const context = this.aiContextService.getContext(scopedGroupId)
        const gateState = this.replyGateService?.groupStates instanceof Map
            ? this.replyGateService.groupStates.get(scopedGroupId)
            : null
        const cacheStats = typeof this.aiContextService.getCacheStats === 'function'
            ? this.aiContextService.getCacheStats()
            : null

        return {
            ok: true,
            action,
            namespace: 'runtime',
            scope: 'current_group',
            groupId: scopedGroupId,
            data: {
                ai: {
                    enabled: this.config.isAiEnabledForGroup(scopedGroupId),
                    ragEnabled: typeof this.config.isRagEnabledForGroup === 'function'
                        ? this.config.isRagEnabledForGroup(scopedGroupId)
                        : false,
                    probability: this.config.getGroupConfig(scopedGroupId, 'aiProbability'),
                    contextLimit: this.config.getGroupConfig(scopedGroupId, 'aiContextLimit'),
                    temperature: this.config.getGroupConfig(scopedGroupId, 'aiTemperature'),
                    promptAssemblerEnabled: this.config.getGroupConfig(scopedGroupId, 'aiPromptAssemblerEnabled') !== false,
                    structuredContextEnabled: this.config.getGroupConfig(scopedGroupId, 'aiStructuredContextEnabled') !== false
                },
                context: {
                    messageCount: Array.isArray(context) ? context.length : 0,
                    cached: this.aiContextService?.contexts instanceof Map
                        ? this.aiContextService.contexts.has(scopedGroupId)
                        : false,
                    lastAccessAt: this.aiContextService?.lastAccess instanceof Map
                        ? this.aiContextService.lastAccess.get(scopedGroupId) || null
                        : null,
                    cacheStats
                },
                replyGate: {
                    tracked: !!gateState,
                    busyWindowSeconds,
                    busyMessageCount,
                    maxRepliesPerWindow,
                    recentMessageCount: countRecent(gateState?.messageTimestamps, windowMs, now),
                    recentReplyCount: countRecent(gateState?.botReplyTimestamps, windowMs, now),
                    recentInteractionCount: countRecentInteractions(gateState?.recentBotInteractions, 60 * 1000, now),
                    busy: countRecent(gateState?.messageTimestamps, windowMs, now) >= busyMessageCount && busyMessageCount > 0,
                    replyLimited: countRecent(gateState?.botReplyTimestamps, windowMs, now) >= maxRepliesPerWindow && maxRepliesPerWindow > 0
                }
            }
        }
    }
}

module.exports = {
    buildRuntimeReadSnapshot,
    RuntimeController
}
