const { subscriptionManager, biliApi, logger } = require('../adapters/deps')
const { decideAdvance } = require('../helpers/stateAdvance')
const { resolveLiveState, normalizeRoomId } = require('../helpers/liveState')

module.exports = {
    /**
     * Generate notification text for different content types
     * Unified logic for both feed and manual subscription pushes
     * @param {string} userName - User name to display
     * @param {object} info - Content info object from API (standard format)
     * @returns {string} - Notification text
     */
    generateNotificationText(userName, info) {
        const type = info.type || 'dynamic'
        const data = info.data || {}
        const item = data.item || {}
        const modules = item.modules || {}
        const dynamic = modules.module_dynamic || {}
        const major = dynamic.major || {}
        const extractCvId = value => {
            if (!value) return ''
            const str = String(value)
            const match = str.match(/\/read\/cv(\d+)/i) || str.match(/(?:^|[^a-z0-9])cv(\d+)/i)
            if (match) return match[1]
            if (/^\d+$/.test(str)) return str
            return ''
        }
        const resolveCvId = (majorData, itemData, dataRoot) => {
            const jumpUrl = majorData?.opus?.jump_url || itemData?.basic?.jump_url || dataRoot?.basic?.jump_url
            let cvId = extractCvId(jumpUrl)
            if (!cvId) {
                cvId = extractCvId(dataRoot?.id || dataRoot?.cvid)
            }
            return cvId
        }

        // Video (in dynamic)
        if (type === 'video' || major.type === 'MAJOR_TYPE_ARCHIVE') {
            const title = major.archive?.title || ''
            return title ? `${userName} 投稿了新视频：\n${title}` : `${userName} 投稿了新视频`
        }

        // Article/Opus (in dynamic)
        if (type === 'article' || major.type === 'MAJOR_TYPE_OPUS') {
            const title = major.opus?.title || data.title || ''
            const cvId = resolveCvId(major, item, data)
            if (cvId) {
                return title ? `${userName} 投稿了新专栏：\n${title}` : `${userName} 投稿了新专栏`
            }
            return `${userName} 发布了新动态`
        }

        // Forward
        if (type === 'forward' || item.type === 'DYNAMIC_TYPE_FORWARD') {
            const orig = item.orig || {}
            const origItem = orig.item || orig
            const origModules = origItem.modules || {}
            const origDynamic = origModules.module_dynamic || {}
            const origMajor = origDynamic.major || {}

            if (origMajor.type === 'MAJOR_TYPE_ARCHIVE') {
                const title = origMajor.archive?.title || ''
                return title ? `${userName} 转发了视频：\n${title}` : `${userName} 转发了视频`
            }
            if (origMajor.type === 'MAJOR_TYPE_OPUS') {
                const title = origMajor.opus?.title || ''
                const cvId = resolveCvId(origMajor, origItem, orig)
                if (cvId) {
                    return title ? `${userName} 转发了专栏：\n${title}` : `${userName} 转发了专栏`
                }
                return `${userName} 转发了一条动态`
            }
            return `${userName} 转发了一条动态`
        }

        // Plain text dynamic
        if (item.type === 'DYNAMIC_TYPE_WORD') {
            return `${userName} 发布了新动态`
        }

        // Default
        return `${userName} 发布了新动态`
    },

    async checkUserDynamic(sub, targetGroups = null, force = false, options = {}) {
        const disableDedup = Boolean(options && options.disableDedup)
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        try {
            const res = await biliApi.getUserDynamic(sub.uid, null, true)
            if (res.status !== 'success') {
                logger.warn(`[UpdateChecker] Failed to fetch dynamics for ${sub.name} (${sub.uid}): ${res.message}`)
                return
            }

            // Compatible with both 'items' (new API) and 'cards' (old logic)
            // But actually bili_service.py get_user_dynamic now returns { data: { cards: [...] } }
            // Wait, looking at bili_service.py:
            // return {"status": "success", "data": {"cards": result_items}}
            // So res.data.cards IS correct for the Python output wrapper.
            // BUT, the fields INSIDE the card objects have changed/expanded.

            if (!res.data.cards || res.data.cards.length === 0) return

            const allCards = res.data.cards
            const cards = allCards.filter(card => !this.shouldSkipDynamic(card))

            if (cards.length < allCards.length) {
                logger.info(`[UpdateChecker] Filtered ${allCards.length - cards.length} auto-post dynamics for ${sub.name}`)
            }

            if (cards.length === 0) return

            // Sort cards by ID descending to handle sticky posts (which might be old but at top)
            // ensuring the first card is truly the latest one in time.
            cards.sort((a, b) => {
                try {
                    // Try id_str first (new API), then desc.dynamic_id_str (old API)
                    const idAStr = a.id_str || (a.desc && a.desc.dynamic_id_str)
                    const idBStr = b.id_str || (b.desc && b.desc.dynamic_id_str)

                    if (!idAStr || !idBStr) return 0

                    const idA = BigInt(idAStr)
                    const idB = BigInt(idBStr)
                    return idA < idB ? 1 : idA > idB ? -1 : 0
                } catch (e) {
                    return 0
                }
            })

            const latestCard = cards[0]
            const latestId = latestCard.id_str || (latestCard.desc && latestCard.desc.dynamic_id_str)

            if (!latestId) {
                logger.warn(`[UpdateChecker] Could not find dynamic ID for ${sub.name}`)
                return
            }

            let latestNonLiveCard = null
            let latestNonLiveId = null
            for (const c of cards) {
                if (!this.isLiveDynamic(c)) {
                    latestNonLiveCard = c
                    latestNonLiveId = c.id_str || (c.desc && c.desc.dynamic_id_str)
                    break
                }
            }

            if (!sub.lastDynamicId && !force) {
                if (latestNonLiveId) {
                    await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: latestNonLiveId })
                }
                return
            }

            if (latestId !== sub.lastDynamicId || force) {
                let newCards = []

                if (force) {
                    if (latestNonLiveCard) {
                        newCards = [latestNonLiveCard]
                        logger.info(`[UpdateChecker] Force checking dynamic for ${sub.name} (ID: ${latestNonLiveId})`)
                    } else {
                        newCards = []
                        logger.info(`[UpdateChecker] Force check found only live dynamic for ${sub.name}, skipping`)
                    }
                } else {
                    for (const card of cards) {
                        const currentId = card.id_str || (card.desc && card.desc.dynamic_id_str)
                        if (!currentId) continue

                        if (currentId === sub.lastDynamicId) break

                        // Prevent re-pushing old dynamics if the last seen dynamic was deleted
                        // If we encounter a dynamic ID smaller (older) than our last seen ID, stop.
                        try {
                            if (BigInt(currentId) < BigInt(sub.lastDynamicId)) break
                        } catch (e) {
                            // Fallback for non-numeric IDs if any
                        }
                        newCards.push(card)
                    }
                    // Process from oldest to newest
                    newCards.reverse()
                }

                for (const card of newCards) {
                    const cardId = card.id_str || (card.desc && card.desc.dynamic_id_str)

                    // Check if this is a live stream start notification
                    // These are auto-posted by Bilibili when a user starts streaming
                    // We want to skip these and let checkUserLive handle the notification to avoid duplicates
                    if (this.isLiveDynamic(card)) {
                        logger.info(`[UpdateChecker] Skipping live dynamic for ${sub.name} (ID: ${cardId}) - expecting checkUserLive to handle it`)
                        continue
                    }

                    // Fetch dynamic detail using standard API (unified with linkHandler)
                    // This ensures data format consistency and completeness
                    const groupId = groupsToNotify[0] // Use first group's cookie for API call
                    const info = await biliApi.getDynamicInfo(cardId, groupId)

                    if (info.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get dynamic detail for ${cardId}, skipping`)
                        continue
                    }

                    // Generate notification text using unified function
                    const notificationText = this.generateNotificationText(sub.name, info)

                    // Notify
                    let canAdvanceCurrentDynamic = false
                    try {
                        const url = `https://t.bilibili.com/${cardId}`
                        const notifyResult = await this.notifyGroupsWithImageAndCache(
                            targetGroupSourceMap,
                            info,
                            info.type || 'dynamic',
                            url,
                            notificationText,
                            { actorUid: sub.uid, fallbackSources: ['manual'], disableDedup }
                        )
                        const decision = decideAdvance(notifyResult)
                        canAdvanceCurrentDynamic = decision.action === 'advance'
                        if (!canAdvanceCurrentDynamic) {
                            logger.warn(`[UpdateChecker] Skip dynamic state advance for ${sub.name}: notify decision=${decision.action}, reason=${decision.reason}`)
                        }
                    } catch (e) {
                        logger.error(`[UpdateChecker] Failed to generate image for dynamic ${cardId}:`, e)
                        // Fallback text
                        const msg = `${notificationText}\nhttps://t.bilibili.com/${cardId}`
                        this.notifyGroups(
                            targetGroupSourceMap,
                            msg,
                            cardId,
                            { actorUid: sub.uid, category: info.type || 'dynamic', fallbackSources: ['manual'], disableDedup }
                        )
                    }

                    if (!force && canAdvanceCurrentDynamic) {
                        await subscriptionManager.updateUserSub(sub.uid, { lastDynamicId: cardId })
                    }
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking dynamic for ${sub.name}:`, e)
        }
    },

    async checkUserLive(sub, targetGroups = null, force = false, options = {}) {
        const disableDedup = Boolean(options && options.disableDedup)
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        // 使用第一个群组的cookie获取用户信息
        const groupId = groupsToNotify[0]
        try {
            const res = await biliApi.getUserInfo(sub.uid, groupId) // getUserInfo contains live_room
            if (res.status !== 'success') return

            const liveRoom = res.data.live_room || {}

            const directRoomId = normalizeRoomId(liveRoom.roomid, liveRoom.room_id)
            if (directRoomId && sub.roomId !== directRoomId) {
                logger.info(`[UpdateChecker] Caching roomId ${directRoomId} for user ${sub.uid} (${sub.name})`)
                await subscriptionManager.updateUserSub(sub.uid, { roomId: directRoomId })
                sub.roomId = directRoomId
            }

            let roomInfo = null
            let liveState = resolveLiveState({
                liveRoom,
                cachedRoomId: sub.roomId
            })

            if (liveState.status === 'unknown' && liveState.roomId) {
                logger.debug(`[UpdateChecker] Live status unknown for ${sub.uid} (${sub.name}), confirming via room ${liveState.roomId}`)
                roomInfo = await biliApi.getLiveRoomInfo(liveState.roomId, groupId)
                liveState = resolveLiveState({
                    liveRoom,
                    cachedRoomId: sub.roomId,
                    roomInfo
                })
            }

            if (!liveState.roomId && liveState.status === 'offline') {
                if (sub.lastLiveStatus !== 0) {
                    await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: 0 })
                }
                return
            }

            if (!liveState.roomId) {
                logger.warn(`[UpdateChecker] No room ID available for user ${sub.uid} (${sub.name}), skipping live check. User may not have a live room.`)
                return
            }

            const roomUrl = liveState.roomUrl || `https://live.bilibili.com/${liveState.roomId}`

            if ((liveState.status === 'online' && sub.lastLiveStatus !== 1) || (force && liveState.status === 'online')) {
                let canAdvanceLiveStatus = false
                // Started Streaming or Force Check
                // Fetch live room detail using standard API (unified with linkHandler)
                const liveInfo = roomInfo && roomInfo.status === 'success'
                    ? roomInfo
                    : await biliApi.getLiveRoomInfo(liveState.roomId, groupId)

                if (liveInfo.status !== 'success') {
                    logger.warn(`[UpdateChecker] Failed to get live room info for ${liveState.roomId} (${sub.name}), skipping notification`)
                } else {
                    liveInfo.id = liveState.roomId
                    const notifyResult = await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        liveInfo,
                        'live',
                        roomUrl,
                        `${sub.name} 开播了！`,
                        { actorUid: sub.uid, fallbackSources: ['manual'], disableDedup }
                    )
                    const decision = decideAdvance(notifyResult)
                    canAdvanceLiveStatus = decision.action === 'advance'
                    if (!canAdvanceLiveStatus) {
                        logger.warn(`[UpdateChecker] Skip live state advance for ${sub.name}: notify decision=${decision.action}, reason=${decision.reason}`)
                    }
                }

                if (canAdvanceLiveStatus && sub.lastLiveStatus !== 1) {
                    await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: 1 })
                }
                return
            }

            if (liveState.status === 'offline' && sub.lastLiveStatus !== 0) {
                await subscriptionManager.updateUserSub(sub.uid, { lastLiveStatus: 0 })
                return
            }

            if (liveState.status === 'unknown') {
                logger.debug(`[UpdateChecker] Live status remains unknown for ${sub.uid} (${sub.name}); keeping previous state ${sub.lastLiveStatus}`)
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking live for ${sub.name}:`, e)
        }
    },

    async checkBangumi(sub, targetGroups = null) {
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        try {
            const res = await biliApi.getBangumiInfo(sub.seasonId)
            if (res.status !== 'success') return

            const newEp = res.data.new_ep
            if (!newEp || !newEp.id) return

            // Initialize if needed
            if (!sub.lastEpId) {
                await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id })
                return
            }

            if (newEp.id !== sub.lastEpId) {
                // New Episode - use standard API response format (unified with linkHandler)
                const url = `https://www.bilibili.com/bangumi/play/ep${newEp.id}`
                const notificationText = `${sub.title} 更新了：${newEp.index_show}`
                let canAdvanceBangumi = false

                try {
                    const notifyResult = await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        res,
                        'bangumi',
                        url,
                        notificationText,
                        { actorUid: null, fallbackSources: ['manual'] }
                    )
                    const decision = decideAdvance(notifyResult)
                    canAdvanceBangumi = decision.action === 'advance'
                    if (!canAdvanceBangumi) {
                        logger.warn(`[UpdateChecker] Skip bangumi state advance for ${sub.title}: notify decision=${decision.action}, reason=${decision.reason}`)
                    }
                } catch (e) {
                    logger.error(`[UpdateChecker] Failed to generate image for bangumi ${sub.seasonId}:`, e)
                    this.notifyGroups(
                        targetGroupSourceMap,
                        `${notificationText}\n${url}`,
                        newEp.id,
                        { actorUid: null, category: 'bangumi', fallbackSources: ['manual'] }
                    )
                }

                if (canAdvanceBangumi) {
                    await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id })
                }
            }
        } catch (e) {
            logger.error(`[UpdateChecker] Error checking bangumi ${sub.title}:`, e)
        }
    }
}
