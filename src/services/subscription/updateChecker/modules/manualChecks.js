const { subscriptionManager, subscriptionDeliveryStore, biliApi, logger } = require('../adapters/deps')
const { classifyArchiveDynamic } = require('../helpers/archiveDynamic')
const { decideAdvance } = require('../helpers/stateAdvance')
const { resolveLiveState, normalizeRoomId } = require('../helpers/liveState')

function subLog(level, message, fields = {}, scope = 'svc:manual-checks') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

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
        const archiveDynamicType = classifyArchiveDynamic(item)
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
        if (type === 'video' || archiveDynamicType === 'video_auto_post') {
            const title = major.archive?.title || ''
            return title ? `${userName} 投稿了新视频：\n${title}` : `${userName} 投稿了新视频`
        }

        if (archiveDynamicType === 'dynamic_video') {
            const title = major.archive?.title || ''
            return title ? `${userName} 发布了动态视频：\n${title}` : `${userName} 发布了动态视频`
        }

        // Article/Opus (in dynamic)
        if (type === 'article' || item.type === 'DYNAMIC_TYPE_ARTICLE' || major.type === 'MAJOR_TYPE_OPUS') {
            const title = major.opus?.title || data.title || ''
            const cvId = resolveCvId(major, item, data)
            if (cvId || item.type === 'DYNAMIC_TYPE_ARTICLE') {
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
            const origArchiveDynamicType = classifyArchiveDynamic(origItem)

            if (origArchiveDynamicType === 'video_auto_post') {
                const title = origMajor.archive?.title || ''
                return title ? `${userName} 转发了视频：\n${title}` : `${userName} 转发了视频`
            }
            if (origArchiveDynamicType === 'dynamic_video') {
                const title = origMajor.archive?.title || ''
                return title ? `${userName} 转发了动态视频：\n${title}` : `${userName} 转发了动态视频`
            }
            if (origMajor.type === 'MAJOR_TYPE_OPUS') {
                const title = origMajor.opus?.title || ''
                const cvId = resolveCvId(origMajor, origItem, orig)
                if (cvId || origItem.type === 'DYNAMIC_TYPE_ARTICLE') {
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
        const persistDelivery = options?.persistDelivery !== false && !force
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        const userScope = logger.createScope('sub', 'user', sub.uid)
        try {
            let unifiedState = await this.getUnifiedUserState(sub.uid)
            unifiedState = await this.ensureTargetBaselinesForUser(sub, targetGroupSourceMap, unifiedState)
            const legacyDynamicAnchor = unifiedState ? null : sub.lastDynamicId
            const unifiedAnchor = this.getDynamicAnchor(unifiedState, legacyDynamicAnchor)
            const res = await biliApi.getUserDynamic(sub.uid, null, 'fresh')
            if (res.status !== 'success') {
                subLog('warn', 'dynamic-fetch-failed', {
                    uid: sub.uid,
                    name: sub.name,
                    error: res.message
                }, userScope)
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
                subLog('info', 'dynamic-auto-posts-filtered', {
                    uid: sub.uid,
                    name: sub.name,
                    filteredCount: allCards.length - cards.length
                }, userScope)
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
                subLog('warn', 'dynamic-id-missing', {
                    uid: sub.uid,
                    name: sub.name
                }, userScope)
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

            if (!latestNonLiveId) return

            if (!unifiedAnchor && !force) {
                if (latestNonLiveId) {
                    await this.advanceDynamicState({ uid: sub.uid, manualSub: sub }, latestNonLiveId)
                }
                return
            }

            const latestCompare = unifiedAnchor ? this.compareContentId(latestNonLiveId, unifiedAnchor) : 1
            const shouldTryLatest = force || latestCompare > 0
            const missingGroupSourceMap = !shouldTryLatest
                ? await this.getUndeliveredGroupSourceMap({
                    uid: sub.uid,
                    contentType: 'dynamic',
                    contentId: latestNonLiveId,
                    targetGroupSourceMap
                })
                : targetGroupSourceMap
            const effectiveTargetGroupSourceMap = shouldTryLatest
                ? targetGroupSourceMap
                : missingGroupSourceMap
            const effectiveTargetGroups = this.getGroupIdsFromSourceMap(effectiveTargetGroupSourceMap)

            if (!shouldTryLatest && effectiveTargetGroups.length === 0) return

            if (shouldTryLatest || effectiveTargetGroups.length > 0) {
                const newCards = [latestNonLiveCard]
                if (force) {
                    subLog('info', 'dynamic-force-check-selected', {
                        uid: sub.uid,
                        name: sub.name,
                        dynamicId: latestNonLiveId
                    }, userScope)
                }

                for (const card of newCards) {
                    const cardId = card.id_str || (card.desc && card.desc.dynamic_id_str)

                    // Check if this is a live stream start notification
                    // These are auto-posted by Bilibili when a user starts streaming
                    // We want to skip these and let checkUserLive handle the notification to avoid duplicates
                    if (this.isLiveDynamic(card)) {
                        subLog('info', 'dynamic-live-post-skipped', {
                            uid: sub.uid,
                            name: sub.name,
                            dynamicId: cardId
                        }, userScope)
                        continue
                    }

                    // Fetch dynamic detail using standard API (unified with linkHandler)
                    // This ensures data format consistency and completeness
                    const groupId = groupsToNotify[0] // Use first group's cookie for API call
                    const info = await biliApi.getDynamicInfo(cardId, groupId)

                    if (info.status !== 'success') {
                        subLog('warn', 'dynamic-detail-fetch-failed', {
                            uid: sub.uid,
                            dynamicId: cardId
                        }, userScope)
                        continue
                    }

                    // Generate notification text using unified function
                    const notificationText = this.generateNotificationText(sub.name, info)

                    // Notify
                    let notifyResult = null
                    try {
                        const url = `https://t.bilibili.com/${cardId}`
                        notifyResult = await this.notifyGroupsWithImageAndCache(
                            effectiveTargetGroupSourceMap,
                            info,
                            info.type || 'dynamic',
                            url,
                            notificationText,
                            { actorUid: sub.uid, fallbackSources: ['manual'], disableDedup }
                        )
                    } catch (e) {
                        subLog('error', 'dynamic-render-failed', {
                            uid: sub.uid,
                            dynamicId: cardId,
                            error: logger.getErrorMessage(e)
                        }, userScope)
                        // Fallback text
                        const msg = `${notificationText}\nhttps://t.bilibili.com/${cardId}`
                        notifyResult = await this.notifyGroups(
                            effectiveTargetGroupSourceMap,
                            msg,
                            cardId,
                            { actorUid: sub.uid, category: info.type || 'dynamic', fallbackSources: ['manual'], disableDedup }
                        )
                    }

                    const decision = decideAdvance(notifyResult)
                    const canAdvanceCurrentDynamic = decision.action === 'advance'
                    if (!canAdvanceCurrentDynamic) {
                        subLog('warn', 'dynamic-state-advance-skipped', {
                            uid: sub.uid,
                            name: sub.name,
                            dynamicId: cardId,
                            decision: decision.action,
                            reason: decision.reason
                        }, userScope)
                    }
                    if (persistDelivery) {
                        await this.recordNotifyDeliveredGroups('dynamic', cardId, notifyResult)
                    }

                    if (!force && canAdvanceCurrentDynamic && shouldTryLatest) {
                        await this.advanceDynamicState({ uid: sub.uid, manualSub: sub }, latestNonLiveId)
                    }
                }
            }
        } catch (e) {
            subLog('error', 'dynamic-check-failed', {
                uid: sub.uid,
                name: sub.name,
                error: logger.getErrorMessage(e)
            }, userScope)
        }
    },

    async checkUserLive(sub, targetGroups = null, force = false, options = {}) {
        const disableDedup = Boolean(options && options.disableDedup)
        const persistState = options.persistState !== false
        const persistDelivery = options?.persistDelivery !== false && !force
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        // 使用第一个群组的cookie获取用户信息
        const groupId = groupsToNotify[0]
        const userScope = logger.createScope('sub', 'user', sub.uid)
        try {
            let unifiedState = await this.getUnifiedUserState(sub.uid)
            unifiedState = await this.ensureTargetBaselinesForUser(sub, targetGroupSourceMap, unifiedState)
            const hasUnifiedState = Boolean(unifiedState)
            const liveAnchor = this.getLiveAnchor(unifiedState, {
                liveStatus: sub.lastLiveStatus,
                roomId: sub.roomId
            })
            const res = await biliApi.getUserInfo(sub.uid, groupId, 'fresh') // getUserInfo contains live_room
            if (res.status !== 'success') return

            const liveRoom = res.data.live_room || {}

            const directRoomId = normalizeRoomId(liveRoom.roomid, liveRoom.room_id)
            if (directRoomId && liveAnchor.roomId !== directRoomId) {
                subLog('info', 'live-room-cached', {
                    uid: sub.uid,
                    name: sub.name,
                    roomId: directRoomId
                }, userScope)
                if (!persistState) {
                    liveAnchor.roomId = directRoomId
                } else if (hasUnifiedState) {
                    await this.advanceLiveState({ uid: sub.uid, manualSub: sub }, {
                        liveStatus: liveAnchor.liveStatus,
                        roomId: directRoomId
                    })
                } else {
                    await subscriptionManager.updateUserSub(sub.uid, { roomId: directRoomId })
                    sub.roomId = directRoomId
                }
                liveAnchor.roomId = directRoomId
            }

            let roomInfo = null
            let liveState = resolveLiveState({
                liveRoom,
                cachedRoomId: liveAnchor.roomId
            })

            if (liveState.status === 'unknown' && liveState.roomId) {
                subLog('debug', 'live-status-unknown-confirming', {
                    uid: sub.uid,
                    name: sub.name,
                    roomId: liveState.roomId
                }, userScope)
                roomInfo = await biliApi.getLiveRoomInfo(liveState.roomId, groupId)
                liveState = resolveLiveState({
                    liveRoom,
                    cachedRoomId: liveAnchor.roomId,
                    roomInfo
                })
            }

            if (!liveState.roomId && liveState.status === 'offline') {
                if (persistState && liveAnchor.liveStatus !== 0) {
                    await this.advanceLiveState({ uid: sub.uid, manualSub: sub }, {
                        liveStatus: 0,
                        roomId: liveAnchor.roomId
                    })
                }
                return
            }

            if (!liveState.roomId) {
                subLog('warn', 'live-room-missing', {
                    uid: sub.uid,
                    name: sub.name
                }, userScope)
                return
            }

            const roomUrl = liveState.roomUrl || `https://live.bilibili.com/${liveState.roomId}`

            const shouldNotifyLiveStart = liveState.status === 'online' && (liveAnchor.liveStatus !== 1 || force)
            const canRetryLiveLedgerGaps = hasUnifiedState &&
                liveAnchor.liveStatus === 1 &&
                unifiedState?.live?.meta?.source === 'updateChecker'
            const shouldRetryMissingLiveDelivery = liveState.status === 'online' &&
                !shouldNotifyLiveStart &&
                liveState.roomId &&
                !force &&
                canRetryLiveLedgerGaps
            const liveRetryGroupSourceMap = shouldRetryMissingLiveDelivery
                ? await this.getUndeliveredGroupSourceMap({
                    uid: sub.uid,
                    contentType: 'live',
                    contentId: liveState.roomId,
                    targetGroupSourceMap
                })
                : new Map()
            const effectiveLiveGroupSourceMap = shouldNotifyLiveStart ? targetGroupSourceMap : liveRetryGroupSourceMap
            const effectiveLiveGroups = this.getGroupIdsFromSourceMap(effectiveLiveGroupSourceMap)

            if ((shouldNotifyLiveStart || effectiveLiveGroups.length > 0) && liveState.status === 'online') {
                let canAdvanceLiveStatus = false
                // Started Streaming or Force Check
                // Fetch live room detail using standard API (unified with linkHandler)
                const liveInfo = roomInfo && roomInfo.status === 'success'
                    ? roomInfo
                    : await biliApi.getLiveRoomInfo(liveState.roomId, groupId)

                if (liveInfo.status !== 'success') {
                    subLog('warn', 'live-room-fetch-failed', {
                        uid: sub.uid,
                        name: sub.name,
                        roomId: liveState.roomId
                    }, userScope)
                } else {
                    liveInfo.id = liveState.roomId
                    const notifyResult = await this.notifyGroupsWithImageAndCache(
                        effectiveLiveGroupSourceMap,
                        liveInfo,
                        'live',
                        roomUrl,
                        `${sub.name} 开播了！`,
                        { actorUid: sub.uid, fallbackSources: ['manual'], disableDedup }
                    )
                    if (persistDelivery) {
                        await this.recordNotifyDeliveredGroups('live', liveState.roomId, notifyResult)
                    }
                    const decision = decideAdvance(notifyResult)
                    canAdvanceLiveStatus = decision.action === 'advance'
                    if (!canAdvanceLiveStatus) {
                        subLog('warn', 'live-state-advance-skipped', {
                            uid: sub.uid,
                            name: sub.name,
                            roomId: liveState.roomId,
                            decision: decision.action,
                            reason: decision.reason
                        }, userScope)
                    }
                }

                if (persistState && canAdvanceLiveStatus && liveAnchor.liveStatus !== 1) {
                    await this.advanceLiveState({ uid: sub.uid, manualSub: sub }, {
                        liveStatus: 1,
                        roomId: liveState.roomId
                    })
                }
                return
            }

            if (persistState && liveState.status === 'offline' && liveAnchor.liveStatus !== 0) {
                await this.advanceLiveState({ uid: sub.uid, manualSub: sub }, {
                    liveStatus: 0,
                    roomId: liveState.roomId || liveAnchor.roomId
                })
                return
            }

            if (liveState.status === 'unknown') {
                subLog('debug', 'live-status-remains-unknown', {
                    uid: sub.uid,
                    name: sub.name,
                    lastLiveStatus: liveAnchor.liveStatus
                }, userScope)
            }
        } catch (e) {
            subLog('error', 'live-check-failed', {
                uid: sub.uid,
                name: sub.name,
                error: logger.getErrorMessage(e)
            }, userScope)
        }
    },

    async checkBangumi(sub, targetGroups = null) {
        if (this.operationRegistry && !this.operationRegistry.getContext()) {
            return this.operationRegistry.run(
                'checkBangumi',
                () => this.checkBangumi(sub, targetGroups),
                { seasonId: String(sub?.seasonId || '') }
            )
        }
        // Use provided targetGroups or fall back to sub.groupIds
        const groupsToNotify = targetGroups || sub.groupIds
        const targetGroupSourceMap = this.createGroupSourceMap(groupsToNotify, ['manual'])
        const bangumiScope = logger.createScope('sub', 'bangumi', sub.seasonId)
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
                const allTargetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)
                let pendingTargetMap = targetGroupSourceMap

                if (subscriptionDeliveryStore?.getDeliveryCoverage) {
                    const coverage = await subscriptionDeliveryStore.getDeliveryCoverage(
                        allTargetGroups,
                        'bangumi',
                        String(newEp.id)
                    )
                    if (coverage.hasAnyRecord) {
                        pendingTargetMap = this.filterGroupSourceMapByGroups(
                            targetGroupSourceMap,
                            coverage.undeliveredGroups
                        )
                    }
                    if (coverage.hasAnyRecord && coverage.undeliveredGroups.length === 0) {
                        canAdvanceBangumi = true
                    }
                }

                if (canAdvanceBangumi) {
                    await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id })
                    return
                }

                let notifyResult
                try {
                    notifyResult = await this.notifyGroupsWithImageAndCache(
                        pendingTargetMap,
                        res,
                        'bangumi',
                        url,
                        notificationText,
                        { actorUid: null, fallbackSources: ['manual'] }
                    )
                } catch (e) {
                    subLog('error', 'bangumi-render-failed', {
                        seasonId: sub.seasonId,
                        error: logger.getErrorMessage(e)
                    }, bangumiScope)
                    notifyResult = await this.notifyGroups(
                        pendingTargetMap,
                        `${notificationText}\n${url}`,
                        newEp.id,
                        { actorUid: null, category: 'bangumi', fallbackSources: ['manual'] }
                    )
                    notifyResult.fallbackUsed = true
                    notifyResult.fallbackUsedGroups = [
                        ...(Array.isArray(notifyResult.fallbackUsedGroups) ? notifyResult.fallbackUsedGroups : []),
                        ...(Array.isArray(notifyResult.successGroups) ? notifyResult.successGroups : [])
                    ]
                }

                await this.recordNotifyDeliveredGroups('bangumi', newEp.id, notifyResult)
                let decision = decideAdvance(notifyResult)
                if (subscriptionDeliveryStore?.getDeliveryCoverage) {
                    const coverage = await subscriptionDeliveryStore.getDeliveryCoverage(
                        allTargetGroups,
                        'bangumi',
                        String(newEp.id)
                    )
                    canAdvanceBangumi = coverage.undeliveredGroups.length === 0
                    decision = canAdvanceBangumi
                        ? { action: 'advance', reason: 'delivery_ledger_complete' }
                        : { action: 'retry', reason: 'delivery_ledger_incomplete' }
                } else {
                    canAdvanceBangumi = decision.action === 'advance' &&
                        (!Array.isArray(notifyResult?.failedGroups) || notifyResult.failedGroups.length === 0)
                }
                if (!canAdvanceBangumi) {
                    subLog('warn', 'bangumi-state-advance-skipped', {
                        seasonId: sub.seasonId,
                        title: sub.title,
                        decision: decision.action,
                        reason: decision.reason
                    }, bangumiScope)
                }

                if (canAdvanceBangumi) {
                    await subscriptionManager.updateBangumiSub(sub.seasonId, { lastEpId: newEp.id })
                }
            }
        } catch (e) {
            subLog('error', 'bangumi-check-failed', {
                seasonId: sub.seasonId,
                title: sub.title,
                error: logger.getErrorMessage(e)
            }, bangumiScope)
        }
    }
}
