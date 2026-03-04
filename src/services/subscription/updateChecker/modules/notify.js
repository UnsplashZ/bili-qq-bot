const { notificationService, imageGenerator, config, logger, notificationHistory } = require('../adapters/deps')
const { normalizeSourceList } = require('../helpers/sourceMap')

module.exports = {
    notifyGroups(groupTargets, text, dedupKey = null, atAllMeta = {}) {
        if (!this.ws) return

        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)

        groupSourceMap.forEach((_sources, gid) => {
            // Check for deduplication if key is provided
            const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
            const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
            if (dedupKey && notificationHistory.has(gid, dedupKey, ttlMs)) {
                logger.info(`[UpdateChecker] Skipping duplicate text notification for group ${gid} (key: ${dedupKey})`)
                return
            }

            if (!config.isGroupEnabled(gid)) return

            const messageChain = [{ type: 'text', data: { text } }]
            const resolvedMeta = this.buildAtAllMetaForGroup(gid, groupSourceMap, atAllMeta)
            this.sendSubscriptionMessage(gid, messageChain, resolvedMeta).catch(e => {
                logger.error(`[UpdateChecker] Error in text notification task for group ${gid}:`, e)
            })

            // Record notification history if key provided
            if (dedupKey) {
                notificationHistory.add(gid, dedupKey, ttlMs)
            }
        })
    },

    async notifyGroupsWithImage(groupTargets, data, type, textUrl, descriptionText = '', atAllMeta = {}) {
        const fallbackSources = normalizeSourceList(atAllMeta?.fallbackSources || atAllMeta?.sources || ['manual'])
        const fallbackSource = fallbackSources[0] || 'manual'
        const groupSourceMap = this.normalizeGroupSourceMap(groupTargets, fallbackSource)
        const groupIds = this.getGroupIdsFromSourceMap(groupSourceMap)

        if (!this.ws || groupIds.length === 0) return

        // Deduplication Logic
        // Determine unique ID based on data
        let dedupId = null
        if (data && data.id) dedupId = data.id // dynamic id
        else if (data && data.ep_id) dedupId = data.ep_id // bangumi ep id (if available)
        else if (type === 'live' && data && data.id) dedupId = `live_${data.id}` // live room/user id

        // Filter out groups that already received this notification
        const pendingGroupIds = []
        if (dedupId) {
            for (const gid of groupIds) {
                const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
                const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
                if (notificationHistory.has(gid, dedupId, ttlMs)) {
                    logger.info(`[UpdateChecker] Skipping duplicate notification for group ${gid} (ID: ${dedupId})`)
                } else {
                    pendingGroupIds.push(gid)
                }
            }
        } else {
            // Fallback: process all if no ID found (shouldn't happen for std types)
            pendingGroupIds.push(...groupIds)
        }

        if (pendingGroupIds.length === 0) return

        // Group by config signature to handle Night Mode / Show ID differences
        const groupsByConfig = new Map() // Key: "night:T|F_label:T|F_showId:T|F" -> [groupIds]

        for (const groupId of pendingGroupIds) {
            if (!config.isGroupEnabled(groupId)) continue

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

                    // Record history
                    if (dedupId) {
                        const ttlSeconds = Number(config.getGroupConfig(gid, 'linkCacheTimeout'))
                        const ttlMs = Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : 0
                        notificationHistory.add(gid, dedupId, ttlMs)
                    }
                }))
            } catch (e) {
                logger.error(`[UpdateChecker] Error generating image for config group [${key}]:`, e)
                // Fallback to text for these groups
                const textMsg = descriptionText ? `${descriptionText}\n${textUrl}` : textUrl
                const fallbackGroupSourceMap = new Map()
                targetGroupIds.forEach(gid => {
                    const groupSources = groupSourceMap.get(String(gid))
                    this.mergeGroupSourceMap(
                        fallbackGroupSourceMap,
                        gid,
                        groupSources ? Array.from(groupSources) : fallbackSources
                    )
                })
                this.notifyGroups(
                    fallbackGroupSourceMap,
                    `预览生成失败，已降级为文本链接：\n${textMsg}`,
                    dedupId,
                    {
                        ...atAllMeta,
                        category: atAllMeta?.category || this.resolveAtAllCategory(type, data),
                        fallbackSources
                    }
                )
            }
        }
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
        if (groupIds.length === 0) return

        // 推送消息
        await this.notifyGroupsWithImage(groupSourceMap, data, type, textUrl, descriptionText, {
            ...atAllMeta,
            fallbackSources
        })

        // 添加链接到缓存
        const linkHandler = require('../../../../handlers/linkHandler')
        for (const groupId of groupIds) {
            linkHandler.addUrlToCache(textUrl, groupId)
        }
    }
}
