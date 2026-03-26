const { notificationService, imageGenerator, config, logger, notificationHistory } = require('../adapters/deps')
const { normalizeSourceList } = require('../helpers/sourceMap')
const { resolveDedupKey } = require('../helpers/dedupKey')
const { canReceiveSubscriptionNotification } = require('../helpers/groupReachability')

function subLog(level, message, fields = {}, scope = 'svc:notify') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

function createNotifyResult(dedupKey = null) {
    return {
        successGroups: [],
        failedGroups: [],
        dedupKey
    }
}

function pushUniqueGroup(target, gid) {
    const value = String(gid)
    if (!target.includes(value)) {
        target.push(value)
    }
}

module.exports = {
    notifyGroups(groupTargets, text, dedupKey = null, atAllMeta = {}) {
        if (!this.ws) return

        const disableDedup = Boolean(atAllMeta && atAllMeta.disableDedup)
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)

        groupSourceMap.forEach((_sources, gid) => {
            // Check for deduplication if key is provided
            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
            if (!disableDedup && dedupKey && notificationHistory.has(gid, dedupKey, ttlMs)) {
                subLog('info', 'text-notification-dedup-skipped', {
                    groupId: gid,
                    dedupKey
                })
                return
            }

            if (!canReceiveSubscriptionNotification(gid)) return

            const messageChain = [{ type: 'text', data: { text } }]
            const resolvedMeta = this.buildAtAllMetaForGroup(gid, groupSourceMap, atAllMeta)
            this.sendSubscriptionMessage(gid, messageChain, resolvedMeta).catch(e => {
                subLog('error', 'text-notification-send-failed', {
                    groupId: gid,
                    error: logger.getErrorMessage(e)
                })
            })

            // Record notification history if key provided
            if (!disableDedup && dedupKey) {
                notificationHistory.add(gid, dedupKey, ttlMs)
            }
        })
    },

    async notifyGroupsWithImage(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const disableDedup = Boolean(atAllMeta && atAllMeta.disableDedup)
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap)

        const dedupId = resolveDedupKey(type, data)

        const result = createNotifyResult(dedupId)
        if (!this.ws || groupIds.length === 0) return result

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
                } else {
                    pendingGroupIds.push(gid)
                }
            }
        } else {
            // Fallback: process all if no ID found (shouldn't happen for std types)
            pendingGroupIds.push(...groupIds)
        }

        if (pendingGroupIds.length === 0) return result

        // Group by config signature to handle Night Mode / Show ID differences
        const groupsByConfig = new Map() // Key: "night:T|F_label:T|F_showId:T|F" -> [groupIds]

        for (const groupId of pendingGroupIds) {
            if (!canReceiveSubscriptionNotification(groupId)) continue

            const isNight = imageGenerator.isNightMode(groupId)
            const showId = config.getGroupConfig(groupId, 'showId')

            // Label Config Check
            const labelConfig = config.getGroupConfig(groupId, 'labelConfig')
            const subtype = this.resolveContentSubtype(type, data)

            const showLabel = (labelConfig && labelConfig[subtype] !== undefined)
                ? labelConfig[subtype]
                : (labelConfig && labelConfig[type] !== false) // Default true

            const key = `night:${isNight}_showId:${showId}_showLabel:${showLabel}`

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
                        await this.sendSubscriptionMessage(gid, baseMessageChain, resolvedMeta)
                        pushUniqueGroup(result.successGroups, gid)

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
                        pushUniqueGroup(result.failedGroups, gid)
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
                        await this.sendSubscriptionMessage(
                            gid,
                            [{ type: 'text', data: { text: fallbackText } }],
                            resolvedMeta
                        )
                        pushUniqueGroup(result.successGroups, gid)
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
                        pushUniqueGroup(result.failedGroups, gid)
                    }
                }
            }
        }

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
            dedupKey: notifyResult?.dedupKey ?? null
        }
    }
}
