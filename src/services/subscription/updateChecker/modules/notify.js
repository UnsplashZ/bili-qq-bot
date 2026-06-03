const { notificationService, imageGenerator, config, logger, notificationHistory } = require('../adapters/deps')
const { normalizeSourceList } = require('../helpers/sourceMap')
const { resolveDedupKey } = require('../helpers/dedupKey')
const { getSubscriptionNotificationReachability } = require('../helpers/groupReachability')
const runtimeMetricsService = require('../../../runtimeMetricsService')
const { getPreviewLayoutSignature } = require('../../../previewLayout/merge')

function subLog(level, message, fields = {}, scope = 'svc:notify') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

function createNotifyResult(dedupKey = null) {
    return {
        successGroups: [],
        failedGroups: [],
        deliveredGroups: [],
        ledgerSkippedGroups: [],
        disabledSkippedGroups: [],
        dedupSkippedGroups: [],
        retryableGroups: [],
        fallbackUsedGroups: [],
        fallbackUsed: false,
        dedupKey
    }
}

function pushUniqueGroup(target, gid) {
    const value = String(gid)
    if (!target.includes(value)) {
        target.push(value)
    }
}

function isRetryableDeliveryFailure(sendResult = {}) {
    const reason = String(sendResult.reason || '')
    return reason.includes('ws_unavailable') ||
        reason.includes('send_failed') ||
        reason.includes('timeout') ||
        reason.includes('ECONN') ||
        reason.includes('network')
}

function recordDeliverySuccess(result, gid, sendResult = {}) {
    pushUniqueGroup(result.successGroups, gid)
    pushUniqueGroup(result.deliveredGroups, gid)
    if (sendResult.fallbackUsed) {
        pushUniqueGroup(result.fallbackUsedGroups, gid)
        result.fallbackUsed = true
    }
}

function recordDeliveryFailure(result, gid, sendResult = {}) {
    pushUniqueGroup(result.failedGroups, gid)
    if (isRetryableDeliveryFailure(sendResult)) {
        pushUniqueGroup(result.retryableGroups, gid)
    }
}

function recordLedgerSkipped(result, gid) {
    pushUniqueGroup(result.ledgerSkippedGroups, gid)
}

function recordDedupSkipped(result, gid) {
    pushUniqueGroup(result.dedupSkippedGroups, gid)
    recordLedgerSkipped(result, gid)
}

function recordDisabledSkipped(result, gid) {
    pushUniqueGroup(result.disabledSkippedGroups, gid)
    recordLedgerSkipped(result, gid)
}

function recordReachabilitySkipped(result, gid, reachability) {
    if (reachability?.reason === 'group_disabled') {
        recordDisabledSkipped(result, gid)
        return true
    }
    if (reachability && reachability.ok === false) {
        recordLedgerSkipped(result, gid)
        return true
    }
    return false
}

module.exports = {
    async notifyGroups(groupTargets, text, dedupKey = null, atAllMeta = {}) {
        const disableDedup = Boolean(atAllMeta && atAllMeta.disableDedup)
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)
        const result = createNotifyResult(dedupKey)
        const sendTasks = []

        groupSourceMap.forEach((_sources, gid) => {
            // Check for deduplication if key is provided
            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
            if (!disableDedup && dedupKey && notificationHistory.has(gid, dedupKey, ttlMs)) {
                subLog('info', 'text-notification-dedup-skipped', {
                    groupId: gid,
                    dedupKey
                })
                recordDedupSkipped(result, gid)
                return
            }

            const reachability = getSubscriptionNotificationReachability(gid)
            if (recordReachabilitySkipped(result, gid, reachability)) {
                return
            }

            if (!this.ws) {
                recordDeliveryFailure(result, gid, { reason: 'ws_unavailable' })
                return
            }

            const messageChain = [{ type: 'text', data: { text } }]
            const resolvedMeta = this.buildAtAllMetaForGroup(gid, groupSourceMap, atAllMeta)
            sendTasks.push((async () => {
                let sendResult
                try {
                    sendResult = await this.sendSubscriptionMessage(gid, messageChain, resolvedMeta)
                } catch (e) {
                    sendResult = {
                        ok: false,
                        reason: `exception:${logger.getErrorMessage(e)}`,
                        retcode: null,
                        fallbackUsed: false
                    }
                }

                if (sendResult?.ok) {
                    recordDeliverySuccess(result, gid, sendResult)
                    // Record notification history only after real delivery success
                    if (!disableDedup && dedupKey) {
                        notificationHistory.add(gid, dedupKey, ttlMs)
                    }
                    return
                }

                subLog('error', 'text-notification-send-failed', {
                    groupId: gid,
                    reason: sendResult?.reason || 'unknown',
                    retcode: sendResult?.retcode ?? 'N/A',
                    fallbackUsed: Boolean(sendResult?.fallbackUsed)
                })
                recordDeliveryFailure(result, gid, sendResult)
            })())
        })

        await Promise.all(sendTasks)
        return result
    },

    async notifyGroupsWithImage(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const startedAt = Date.now()
        const disableDedup = Boolean(atAllMeta && atAllMeta.disableDedup)
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap)

        const dedupId = resolveDedupKey(type, data)

        const result = createNotifyResult(dedupId)
        if (groupIds.length === 0) {
            runtimeMetricsService.record('subscriptionPush', {
                ok: true,
                durationMs: Date.now() - startedAt,
                latest: '无目标'
            })
            return result
        }

        // Filter out groups that already received this notification
        const pendingGroupIds = []
        if (!disableDedup && dedupId) {
            for (const gid of groupIds) {
                const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
                const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
                if (notificationHistory.has(gid, dedupId, ttlMs)) {
                    subLog('info', 'image-notification-dedup-skipped', {
                        groupId: gid,
                        dedupKey: dedupId
                    })
                    recordDedupSkipped(result, gid)
                } else {
                    pendingGroupIds.push(gid)
                }
            }
        } else {
            // Fallback: process all if no ID found (shouldn't happen for std types)
            pendingGroupIds.push(...groupIds)
        }

        if (pendingGroupIds.length === 0) {
            runtimeMetricsService.record('subscriptionPush', {
                ok: true,
                durationMs: Date.now() - startedAt,
                latest: '去重跳过'
            })
            return result
        }

        const receivableGroupIds = []
        // Group by config signature to handle Night Mode / Show ID differences
        const groupsByConfig = new Map() // Key: "night:T|F_label:T|F_showId:T|F" -> [groupIds]

        for (const groupId of pendingGroupIds) {
            const reachability = getSubscriptionNotificationReachability(groupId)
            if (recordReachabilitySkipped(result, groupId, reachability)) {
                continue
            }
            receivableGroupIds.push(groupId)
        }

        if (receivableGroupIds.length === 0) {
            runtimeMetricsService.record('subscriptionPush', {
                ok: true,
                durationMs: Date.now() - startedAt,
                latest: '无可接收目标'
            })
            return result
        }

        if (!this.ws) {
            for (const groupId of receivableGroupIds) {
                recordDeliveryFailure(result, groupId, { reason: 'ws_unavailable' })
            }
            runtimeMetricsService.record('subscriptionPush', {
                ok: false,
                durationMs: Date.now() - startedAt,
                latest: `0/${receivableGroupIds.length}`
            })
            return result
        }

        for (const groupId of receivableGroupIds) {
            const isNight = imageGenerator.isNightMode(groupId)
            const showId = config.getGroupConfig(groupId, 'showId')

            // Label Config Check
            const labelConfig = config.getGroupConfig(groupId, 'labelConfig')
            const subtype = this.resolveContentSubtype(type, data)

            const showLabel = (labelConfig && labelConfig[subtype] !== undefined)
                ? labelConfig[subtype]
                : (labelConfig && labelConfig[type] !== false) // Default true
            const layoutSignature = getPreviewLayoutSignature(type, groupId)

            const key = `night:${isNight}_showId:${showId}_showLabel:${showLabel}_layout:${layoutSignature}`

            if (!groupsByConfig.has(key)) {
                groupsByConfig.set(key, [])
            }
            groupsByConfig.get(key).push(groupId)
        }

        // Process each group configuration
        for (const [key, targetGroupIds] of groupsByConfig) {
            try {
                // Use the first group as representative for generation
                const representativeGroupId = targetGroupIds[0]
                const showId = config.getGroupConfig(representativeGroupId, 'showId')

                // Generate image for this configuration
                const base64Image = await imageGenerator.generatePreviewCard(data, type, representativeGroupId, showId)

                // Construct text message
                const textMsg = descriptionText ? `\n${descriptionText}\n${textUrl}` : textUrl

                // Send to all groups in this configuration batch
                await Promise.all(targetGroupIds.map(async gid => {
                    try {
                        const baseMessageChain = [
                            { type: 'image', data: { file: `base64://${base64Image}` } },
                            { type: 'text', data: { text: textMsg } }
                        ]
                        const resolvedMeta = this.buildAtAllMetaForGroup(
                            gid,
                            groupSourceMap,
                            {
                                ...atAllMeta,
                                category: atAllMeta?.category || this.resolveAtAllCategory(type, data),
                                fallbackSources
                            },
                            type,
                            data
                        )
                        const sendResult = await this.sendSubscriptionMessage(gid, baseMessageChain, resolvedMeta)
                        if (!sendResult?.ok) {
                            subLog('error', 'image-notification-send-failed', {
                                groupId: gid,
                                dedupKey: dedupId,
                                reason: sendResult?.reason || 'unknown',
                                retcode: sendResult?.retcode ?? 'N/A',
                                fallbackUsed: Boolean(sendResult?.fallbackUsed)
                            })
                            recordDeliveryFailure(result, gid, sendResult)
                            return
                        }

                        recordDeliverySuccess(result, gid, sendResult)

                        // Record history
                        if (!disableDedup && dedupId) {
                            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
                            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
                            notificationHistory.add(gid, dedupId, ttlMs)
                        }
                    } catch (sendError) {
                        subLog('error', 'image-notification-send-failed', {
                            groupId: gid,
                            dedupKey: dedupId,
                            error: logger.getErrorMessage(sendError)
                        })
                        recordDeliveryFailure(result, gid, {
                            reason: `exception:${logger.getErrorMessage(sendError)}`
                        })
                    }
                }))
            } catch (e) {
                subLog('error', 'image-notification-render-failed', {
                    configKey: key,
                    error: logger.getErrorMessage(e)
                })
                // Fallback to text for these groups
                const textMsg = descriptionText ? `${descriptionText}\n${textUrl}` : textUrl
                const fallbackText = `预览生成失败，已降级为文本链接：\n${textMsg}`
                for (const gid of targetGroupIds) {
                    try {
                        const resolvedMeta = this.buildAtAllMetaForGroup(
                            gid,
                            groupSourceMap,
                            {
                                ...atAllMeta,
                                category: atAllMeta?.category || this.resolveAtAllCategory(type, data),
                                fallbackSources
                            },
                            type,
                            data
                        )
                        const sendResult = await this.sendSubscriptionMessage(
                            gid,
                            [{ type: 'text', data: { text: fallbackText } }],
                            resolvedMeta
                        )
                        if (!sendResult?.ok) {
                            subLog('error', 'fallback-text-notification-send-failed', {
                                groupId: gid,
                                dedupKey: dedupId,
                                reason: sendResult?.reason || 'unknown',
                                retcode: sendResult?.retcode ?? 'N/A',
                                fallbackUsed: Boolean(sendResult?.fallbackUsed)
                            })
                            recordDeliveryFailure(result, gid, sendResult)
                            continue
                        }

                        recordDeliverySuccess(result, gid, {
                            ...sendResult,
                            fallbackUsed: true
                        })
                        if (!disableDedup && dedupId) {
                            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
                            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
                            notificationHistory.add(gid, dedupId, ttlMs)
                        }
                    } catch (fallbackError) {
                        subLog('error', 'fallback-text-notification-send-failed', {
                            groupId: gid,
                            dedupKey: dedupId,
                            error: logger.getErrorMessage(fallbackError)
                        })
                        recordDeliveryFailure(result, gid, {
                            reason: `exception:${logger.getErrorMessage(fallbackError)}`
                        })
                    }
                }
            }
        }

        runtimeMetricsService.record('subscriptionPush', {
            ok: result.failedGroups.length === 0,
            durationMs: Date.now() - startedAt,
            latest: `${result.successGroups.length}/${result.successGroups.length + result.failedGroups.length}`
        })
        return result
    },

    /**
     * 🆕 推送消息并添加链接到缓存
     * 封装notifyGroupsWithImage + 缓存逻辑，避免重复代码
     */
    async notifyGroupsWithImageAndCache(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap)
        if (groupIds.length === 0) return createNotifyResult(null)

        // 推送消息
        const notifyResult = await this.notifyGroupsWithImage(groupSourceMap, data, type, textUrl, descriptionText, {
            ...atAllMeta,
            fallbackSources
        })

        // 添加链接到缓存
        const { cacheResolvedText } = require('../../../../services/link')
        const cacheGroupIds = Array.isArray(notifyResult?.successGroups)
            ? notifyResult.successGroups
            : groupIds
        for (const groupId of cacheGroupIds) {
            cacheResolvedText(textUrl, groupId)
        }

        return {
            successGroups: Array.isArray(notifyResult?.successGroups) ? notifyResult.successGroups : [],
            failedGroups: Array.isArray(notifyResult?.failedGroups) ? notifyResult.failedGroups : [],
            deliveredGroups: Array.isArray(notifyResult?.deliveredGroups) ? notifyResult.deliveredGroups : [],
            ledgerSkippedGroups: Array.isArray(notifyResult?.ledgerSkippedGroups) ? notifyResult.ledgerSkippedGroups : [],
            disabledSkippedGroups: Array.isArray(notifyResult?.disabledSkippedGroups) ? notifyResult.disabledSkippedGroups : [],
            dedupSkippedGroups: Array.isArray(notifyResult?.dedupSkippedGroups) ? notifyResult.dedupSkippedGroups : [],
            retryableGroups: Array.isArray(notifyResult?.retryableGroups) ? notifyResult.retryableGroups : [],
            fallbackUsedGroups: Array.isArray(notifyResult?.fallbackUsedGroups) ? notifyResult.fallbackUsedGroups : [],
            fallbackUsed: Boolean(notifyResult?.fallbackUsed),
            dedupKey: notifyResult?.dedupKey ?? null
        }
    }
}
