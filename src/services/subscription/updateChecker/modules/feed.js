const { subscriptionManager, biliApi, config, logger } = require('../adapters/deps')
const { classifyArchiveDynamic } = require('../helpers/archiveDynamic')
const { decideAdvance } = require('../helpers/stateAdvance')
const { resolveLiveState, normalizeRoomId } = require('../helpers/liveState')

function subLog(level, message, fields = {}, scope = 'svc:feed') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

module.exports = {
    mergePendingLiveUpdate(pendingUpdates, uid, updates) {
        if (!uid || !updates || typeof updates !== 'object') return
        const existing = pendingUpdates.get(uid) || {}
        pendingUpdates.set(uid, {
            ...existing,
            ...updates
        })
    },

    findManualSub(uid) {
        return (subscriptionManager.userSubs || []).find(sub => String(sub?.uid) === String(uid)) || null
    },

    filterTargetGroupSourceMap(targetGroupSourceMap, allowedSources = []) {
        if (!(targetGroupSourceMap instanceof Map)) return new Map()

        const allowed = new Set((allowedSources || []).map(source => String(source)))
        if (allowed.size === 0) return new Map()

        const filtered = new Map()
        for (const [gid, sources] of targetGroupSourceMap.entries()) {
            const sourceList = Array.isArray(sources) ? sources : Array.from(sources || [])
            const matchedSources = sourceList.filter(source => allowed.has(String(source)))
            if (matchedSources.length > 0) {
                filtered.set(gid, new Set(matchedSources))
            }
        }

        return filtered
    },

    async checkFeedUpdate(feedCoverage = null, activeGroups = null) {
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid => {
            // Only check groups that are active (not left)
            if (activeGroups && !activeGroups.has(gid)) {
                return false
            }
            return config.getGroupConfig(gid, 'enableCookieSync')
        })

        if (groupsWithSync.length === 0) return

        // Identify unique accounts
        const accountGroups = new Map() // uid -> groupId (representative)

        for (const gid of groupsWithSync) {
            const accountUid = subscriptionManager.groupToAccountMap[String(gid)]
            if (accountUid && !accountGroups.has(accountUid)) {
                accountGroups.set(accountUid, gid)
            }
        }

        const dynamicCoverage = feedCoverage && feedCoverage.dynamicUids instanceof Set ? feedCoverage.dynamicUids : null
        const dynamicOutcomes = feedCoverage && feedCoverage.dynamicOutcomes instanceof Map ? feedCoverage.dynamicOutcomes : null
        const liveCoverage = feedCoverage && feedCoverage.liveUids instanceof Set ? feedCoverage.liveUids : null

        // Loop through accounts
        for (const [uid, groupId] of accountGroups) {
            let dynamicOutcomeCount = 0

            let dynamicSucceeded = false
            try {
                // Process Dynamic Feed
                const dynamicResult = await this.processDynamicFeed(uid, groupId, activeGroups)
                dynamicSucceeded = dynamicResult?.ok === true
                const outcomes = Array.isArray(dynamicResult?.outcomes) ? dynamicResult.outcomes : []
                dynamicOutcomeCount = outcomes.length

                for (const outcome of outcomes) {
                    const fid = String(outcome?.uid || '')
                    if (!fid) continue
                    if (dynamicOutcomes) {
                        dynamicOutcomes.set(fid, outcome)
                    }
                    if (dynamicCoverage && outcome.status === 'covered') {
                        dynamicCoverage.add(fid)
                    }
                }
                if (dynamicSucceeded && outcomes.length === 0 && dynamicCoverage) {
                    for (const fid of this.collectFeedCoveredUids(uid, activeGroups)) {
                        dynamicCoverage.add(fid)
                    }
                }
            } catch (e) {
                subLog('error', 'dynamic-feed-update-failed', {
                    accountUid: uid,
                    error: logger.getErrorMessage(e)
                })
            }

            // Wait 2s between dynamic and live feed
            await new Promise(r => setTimeout(r, 2000))

            let liveSucceeded = false
            try {
                // Process Live Feed
                const liveResult = await this.processLiveFeed(uid, groupId, activeGroups)
                liveSucceeded = liveResult?.ok === true
                const coveredLiveUids = Array.isArray(liveResult?.coveredUids)
                    ? liveResult.coveredUids.map(fid => String(fid)).filter(Boolean)
                    : []

                if (liveSucceeded && liveCoverage && coveredLiveUids.length > 0) {
                    for (const fid of coveredLiveUids) {
                        liveCoverage.add(fid)
                    }
                }
            } catch (e) {
                subLog('error', 'live-feed-update-failed', {
                    accountUid: uid,
                    error: logger.getErrorMessage(e)
                })
            }

            subLog('debug', 'feed-coverage-commit', {
                accountUid: uid,
                dynamicSucceeded,
                liveSucceeded,
                dynamicOutcomeCount
            })
        }
    },

    async processDynamicFeed(accountUid, groupId, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)]
        if (!followers || followers.length === 0) {
            return { ok: true, reason: 'no_followers', outcomes: [] }
        }

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]))
        let offset = ''
        let prevOffset = null
        let hasMore = true
        let page = 0
        const latestCandidateByUid = new Map()

        while (hasMore && page < 5) {
            const res = await biliApi.getDynamicFeed(offset, groupId)
            if (res.status !== 'success' || !res.data) {
                subLog('warn', 'dynamic-feed-fetch-failed', {
                    accountUid,
                    groupId
                })
                return { ok: false, reason: 'dynamic_feed_fetch_failed', outcomes: [] }
            }

            const allItems = res.data.items || []
            const items = allItems.filter(item => !this.shouldSkipDynamic(item))

            if (items.length < allItems.length) {
                subLog('info', 'dynamic-feed-filtered', {
                    accountUid,
                    filteredCount: allItems.length - items.length
                })
            }

            hasMore = res.data.has_more
            offset = res.data.offset
            if (offset === prevOffset) break // Prevent infinite loop on unchanged offset
            prevOffset = offset
            page++

            if (items.length === 0) {
                subLog('debug', 'dynamic-feed-page-filtered', {
                    accountUid,
                    page
                })
                continue
            }

            for (const item of items) {
                const authorUid = String(item.modules?.module_author?.mid)
                if (!authorUid || !followerMap.has(authorUid)) continue

                const dynamicId = item.id_str
                if (!dynamicId || this.isLiveDynamic(item)) continue

                const current = latestCandidateByUid.get(authorUid)
                if (!current || this.compareContentId(dynamicId, current.dynamicId) > 0) {
                    latestCandidateByUid.set(authorUid, { dynamicId, item })
                }
            }
        }

        const outcomes = []

        for (const [authorUid, candidate] of latestCandidateByUid.entries()) {
            const follower = followerMap.get(authorUid)
            const dynamicId = candidate.dynamicId
            const item = candidate.item
            const userScope = logger.createScope('sub', 'user', authorUid)
            let unifiedState = await this.getUnifiedUserState(authorUid)
            const fullTargetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
            const ledgerTargetGroupSourceMap = this.findTargetGroupSourceMapForUid(authorUid, activeGroups)
            unifiedState = await this.ensureTargetBaselinesForUser({ uid: authorUid }, fullTargetGroupSourceMap, unifiedState)
            const legacyDynamicAnchor = unifiedState ? null : follower.lastDynamicId
            const unifiedAnchor = this.getDynamicAnchor(unifiedState, legacyDynamicAnchor)

            if (!unifiedAnchor) {
                await this.advanceDynamicState({ uid: authorUid, cookieFollower: follower, accountUid }, dynamicId)
                outcomes.push({ uid: authorUid, status: 'covered', reason: 'anchor_initialized', contentId: dynamicId })
                continue
            }

            const isNew = this.compareContentId(dynamicId, unifiedAnchor) > 0
            const targetGroupSourceMap = isNew
                ? fullTargetGroupSourceMap
                : await this.getUndeliveredGroupSourceMap({
                    uid: authorUid,
                    contentType: 'dynamic',
                    contentId: dynamicId,
                    targetGroupSourceMap: fullTargetGroupSourceMap,
                    ledgerTargetGroupSourceMap
                })
            const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)

            if (!isNew && targetGroups.length === 0) {
                outcomes.push({ uid: authorUid, status: 'covered', reason: 'already_delivered', contentId: dynamicId })
                continue
            }

            if (targetGroups.length === 0) {
                if (isNew) {
                    await this.advanceDynamicState({ uid: authorUid, cookieFollower: follower, accountUid }, dynamicId)
                }
                outcomes.push({ uid: authorUid, status: 'covered', reason: 'no_targets', contentId: dynamicId })
                continue
            }

            // Fetch dynamic detail using standard API (unified with linkHandler)
            // This ensures data format consistency with manual subscriptions
            const info = await biliApi.getDynamicInfo(dynamicId, groupId)

            if (info.status !== 'success') {
                subLog('warn', 'feed-dynamic-detail-fetch-failed', {
                    dynamicId,
                    groupId
                }, userScope)
                outcomes.push({ uid: authorUid, status: 'retry', reason: 'detail_fetch_failed', contentId: dynamicId })
                continue
            }

            const name = follower.uname || follower.name || item.modules?.module_author?.name
            const url = `https://t.bilibili.com/${dynamicId}`

            // Generate notification text using unified function
            const notificationText = this.generateNotificationText(name, info)

            // Prevent sending duplicate notifications if multiple accounts follow same user
            // handled by dedupKey in notifyGroupsWithImage (using dynamicId)
            const notifyResult = await this.notifyGroupsWithImageAndCache(
                targetGroupSourceMap,
                info,
                info.type || 'dynamic',
                url,
                notificationText,
                { actorUid: authorUid, fallbackSources: ['cookieSync'] }
            )
            await this.recordNotifyDeliveredGroups('dynamic', dynamicId, notifyResult)
            const decision = decideAdvance(notifyResult)
            const canAdvanceCurrentDynamic = decision.action === 'advance'
            if (canAdvanceCurrentDynamic && isNew) {
                await this.advanceDynamicState({ uid: authorUid, cookieFollower: follower, accountUid }, dynamicId)
            }
            if (!canAdvanceCurrentDynamic) {
                subLog('warn', 'feed-dynamic-state-advance-skipped', {
                    uid: authorUid,
                    decision: decision.action,
                    reason: decision.reason
                }, userScope)
                outcomes.push({ uid: authorUid, status: 'retry', reason: decision.reason, contentId: dynamicId })
                continue
            }

            const failedGroups = Array.isArray(notifyResult.failedGroups) ? notifyResult.failedGroups : []
            outcomes.push({
                uid: authorUid,
                status: failedGroups.length > 0 ? 'partial' : 'covered',
                reason: failedGroups.length > 0 ? 'partial_delivery' : 'delivered',
                contentId: dynamicId
            })
        }
        if (typeof subscriptionManager.flushPendingFollowerSaves === 'function') {
            await subscriptionManager.flushPendingFollowerSaves()
        }

        return {
            ok: true,
            outcomes,
            coveredUids: outcomes.filter(item => item.status === 'covered').map(item => item.uid)
        }
    },

    async processLiveFeed(accountUid, groupId, activeGroups = null) {
        const res = await biliApi.getLiveFeed(groupId)
        if (res.status !== 'success' || !res.data || !res.data.list) {
            return { ok: false, reason: 'live_feed_fetch_failed' }
        }

        const liveList = res.data.list
        const followers = subscriptionManager.cookieFollowings[String(accountUid)]
        if (!followers) {
            return { ok: true, reason: 'no_followers' }
        }

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]))
        // 使用 pendingUpdates 追踪变更，避免竞态条件
        const pendingUpdates = new Map() // uid → { lastLiveStatus }
        const onlineUids = new Set()
        const coveredUids = new Set()

        for (const item of liveList) {
            const uid = String(item.uid)
            onlineUids.add(uid)
            if (!followerMap.has(uid)) continue

            const follower = followerMap.get(uid)
            const manualSub = this.findManualSub(uid)
            const userScope = logger.createScope('sub', 'user', uid)
            let unifiedState = await this.getUnifiedUserState(uid)
            const hasUnifiedState = Boolean(unifiedState)
            const liveAnchor = this.getLiveAnchor(unifiedState, {
                liveStatus: follower.lastLiveStatus,
                roomId: follower.roomId
            })
            const roomId = normalizeRoomId(item.room_id, item.roomid, follower.roomId)
            const liveState = resolveLiveState({
                liveRoom: {
                    live_status: item.live_status,
                    room_id: roomId
                },
                cachedRoomId: follower.roomId
            })

            if (roomId && follower.roomId !== roomId) {
                if (hasUnifiedState) {
                    await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                        liveStatus: liveAnchor.liveStatus,
                        roomId
                    })
                } else {
                    this.mergePendingLiveUpdate(pendingUpdates, uid, { roomId })
                }
            }

            // Check if status changed from 0 to 1. If the unified live anchor is already
            // online, still retry current-room delivery gaps that were created by partial
            // send failures after the ledger was enabled.
            const cookieNeedsNotify = hasUnifiedState ? liveAnchor.liveStatus !== 1 : follower.lastLiveStatus !== 1
            const manualNeedsNotify = hasUnifiedState ? Boolean(manualSub && liveAnchor.liveStatus !== 1) : manualSub && manualSub.lastLiveStatus !== 1
            let canAdvanceCookieLive = cookieNeedsNotify
            let canAdvanceManualLive = manualNeedsNotify
            let manualRetryPending = false
            let manualRetrySucceeded = false

            if (liveState.status === 'online' && (cookieNeedsNotify || manualNeedsNotify) && !liveState.roomId) {
                subLog('warn', 'feed-live-room-missing', {
                    uid,
                    name: item.uname
                }, userScope)
                continue
            }

            if (liveState.status === 'online' && liveState.roomId) {
                const fullTargetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
                const ledgerTargetGroupSourceMap = this.findTargetGroupSourceMapForUid(uid, activeGroups)
                unifiedState = await this.ensureTargetBaselinesForUser({ uid }, fullTargetGroupSourceMap, unifiedState)
                const allowedSources = []
                if (cookieNeedsNotify) allowedSources.push('cookieSync')
                if (manualNeedsNotify) allowedSources.push('manual')
                const statusTargetGroupSourceMap = this.filterTargetGroupSourceMap(fullTargetGroupSourceMap, allowedSources)
                const canRetryLedgerGaps = hasUnifiedState &&
                    liveAnchor.liveStatus === 1 &&
                    unifiedState?.live?.meta?.source === 'updateChecker'
                const retryTargetGroupSourceMap = allowedSources.length === 0 && canRetryLedgerGaps
                    ? await this.getUndeliveredGroupSourceMap({
                        uid,
                        contentType: 'live',
                        contentId: liveState.roomId,
                        targetGroupSourceMap: fullTargetGroupSourceMap,
                        ledgerTargetGroupSourceMap
                    })
                    : new Map()
                const targetGroupSourceMap = allowedSources.length > 0
                    ? statusTargetGroupSourceMap
                    : retryTargetGroupSourceMap
                const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)
                const manualRetryGroupSourceMap = this.filterTargetGroupSourceMap(retryTargetGroupSourceMap, ['manual'])
                const manualRetryGroups = this.getGroupIdsFromSourceMap(manualRetryGroupSourceMap)
                manualRetryPending = manualRetryGroups.length > 0

                if (targetGroups.length > 0) {
                    const name = item.uname

                    // Fetch live room detail using standard API (unified with linkHandler)
                    const liveInfo = await biliApi.getLiveRoomInfo(liveState.roomId, groupId)
                    if (liveInfo.status !== 'success') {
                        subLog('warn', 'feed-live-room-fetch-failed', {
                            uid,
                            name,
                            roomId: liveState.roomId
                        }, userScope)
                        continue
                    }

                    liveInfo.id = liveState.roomId
                    const roomUrl = liveState.roomUrl || `https://live.bilibili.com/${liveState.roomId}`

                    const notifyResult = await this.notifyGroupsWithImageAndCache(
                        targetGroupSourceMap,
                        liveInfo,
                        'live',
                        roomUrl,
                        `${name} 开播了！`,
                        { actorUid: uid, fallbackSources: ['cookieSync'] }
                    )
                    await this.recordNotifyDeliveredGroups('live', liveState.roomId, notifyResult)
                    const decision = decideAdvance(notifyResult)
                    const canAdvance = decision.action === 'advance'
                    canAdvanceCookieLive = cookieNeedsNotify && canAdvance
                    canAdvanceManualLive = manualNeedsNotify && canAdvance
                    if (manualRetryPending) {
                        const successSet = new Set((notifyResult.successGroups || []).map(gid => String(gid)))
                        manualRetrySucceeded = manualRetryGroups.every(gid => successSet.has(String(gid)))
                    }
                    if (!canAdvance) {
                        subLog('warn', 'feed-live-state-advance-skipped', {
                            uid,
                            decision: decision.action,
                            reason: decision.reason
                        }, userScope)
                    }
                } else {
                    canAdvanceCookieLive = false
                    canAdvanceManualLive = false
                }
            }

            if (liveState.status === 'online' && cookieNeedsNotify && canAdvanceCookieLive) {
                if (hasUnifiedState) {
                    await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                        liveStatus: 1,
                        roomId: liveState.roomId
                    })
                } else {
                    this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 1 })
                }
            }
            if (liveState.status === 'online' && manualNeedsNotify && canAdvanceManualLive) {
                if (hasUnifiedState) {
                    await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                        liveStatus: 1,
                        roomId: liveState.roomId
                    })
                } else {
                    await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 1 })
                }
            }
            if (
                manualSub &&
                liveState.status === 'online' &&
                (
                    (manualNeedsNotify && canAdvanceManualLive) ||
                    (!manualNeedsNotify && (!manualRetryPending || manualRetrySucceeded))
                )
            ) {
                coveredUids.add(uid)
            }
        }

        // Handle offline users
        // If a user was live (lastLiveStatus === 1) but is no longer in the live list,
        // confirm offline via room info when possible. Treat fetch failures as unknown.
        for (const follower of followers) {
            const uid = subscriptionManager.getFollowerId(follower)
            const manualSub = this.findManualSub(uid)
            const unifiedState = await this.getUnifiedUserState(uid)
            const hasUnifiedState = Boolean(unifiedState)
            const liveAnchor = this.getLiveAnchor(unifiedState, {
                liveStatus: follower.lastLiveStatus,
                roomId: follower.roomId
            })
            const cookieWasLive = hasUnifiedState ? liveAnchor.liveStatus === 1 : follower.lastLiveStatus === 1
            const manualWasLive = hasUnifiedState ? Boolean(manualSub && liveAnchor.liveStatus === 1) : manualSub?.lastLiveStatus === 1
            if ((cookieWasLive || manualWasLive) && !onlineUids.has(uid)) {
                const cachedRoomId = normalizeRoomId(follower.roomId)
                const userScope = logger.createScope('sub', 'user', uid)
                if (!cachedRoomId) {
                    let userInfo = null
                    try {
                        userInfo = await biliApi.getUserInfo(uid, groupId, 'fresh')
                    } catch (error) {
                        subLog('warn', 'feed-user-live-fallback-failed', {
                            uid,
                            error: logger.getErrorMessage(error)
                        }, userScope)
                    }

                    const liveState = resolveLiveState({
                        liveRoom: userInfo?.status === 'success' ? userInfo.data?.live_room : {},
                        cachedRoomId: ''
                    })
                    if (liveState.status === 'offline') {
                        if (cookieWasLive) {
                            if (hasUnifiedState) {
                                await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                                    liveStatus: 0,
                                    roomId: cachedRoomId
                                })
                            } else {
                                this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 0 })
                            }
                        }
                        if (manualWasLive) {
                            if (hasUnifiedState) {
                                await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                                    liveStatus: 0,
                                    roomId: cachedRoomId
                                })
                            } else {
                                await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 0 })
                            }
                            coveredUids.add(uid)
                        }
                    } else {
                        subLog('debug', 'feed-live-room-cache-missing', {
                            uid
                        }, userScope)
                    }
                    continue
                }

                let roomInfo = null
                try {
                    roomInfo = await biliApi.getLiveRoomInfo(cachedRoomId, groupId)
                } catch (error) {
                    subLog('warn', 'feed-live-room-confirm-failed', {
                        uid,
                        roomId: cachedRoomId,
                        error: logger.getErrorMessage(error)
                    }, userScope)
                }

                const liveState = resolveLiveState({
                    cachedRoomId,
                    roomInfo
                })

                if (liveState.status === 'offline') {
                    if (cookieWasLive) {
                        if (hasUnifiedState) {
                            await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                                liveStatus: 0,
                                roomId: cachedRoomId
                            })
                        } else {
                            this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 0 })
                        }
                    }
                    if (manualWasLive) {
                        if (hasUnifiedState) {
                            await this.advanceLiveState({ uid, manualSub, cookieFollower: follower, accountUid }, {
                                liveStatus: 0,
                                roomId: cachedRoomId
                            })
                        } else {
                            await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 0 })
                        }
                        coveredUids.add(uid)
                    }
                } else if (liveState.status === 'unknown') {
                    subLog('debug', 'feed-live-state-unknown', {
                        uid
                    }, userScope)
                }
            }
        }

        // 使用 updateCookieFollowerState 逐一写入，始终操作 cookieFollowings 的当前引用，
        // 避免最终 setCookieFollowings 调用因竞态条件覆盖状态
        for (const [uid, updates] of pendingUpdates) {
            await subscriptionManager.updateCookieFollowerState(accountUid, uid, updates)
        }
        if (pendingUpdates.size > 0 && typeof subscriptionManager.flushPendingFollowerSaves === 'function') {
            await subscriptionManager.flushPendingFollowerSaves()
        }

        return { ok: true, coveredUids: Array.from(coveredUids) }
    },

    isLiveDynamic(card) {
        const t = card.type || (card.desc && card.desc.type)
        return t === 'DYNAMIC_TYPE_LIVE_RCMD' ||
            t === 4308 ||
            (card.modules?.module_dynamic?.major?.type === 'MAJOR_TYPE_LIVE_RCMD')
    },

    /**
     * Check if a dynamic should be skipped (video/article auto-post dynamics)
     * @param {object} item - Dynamic item from API
     * @returns {boolean} - True if should skip this dynamic
     */
    shouldSkipDynamic(item) {
        if (!item) return false

        const major = item?.modules?.module_dynamic?.major
        if (item.type === 'DYNAMIC_TYPE_ARTICLE') {
            subLog('debug', 'feed-article-dynamic-skipped', {
                dynamicId: item.id_str
            })
            return true
        }

        const archiveDynamicType = classifyArchiveDynamic(item)
        if (archiveDynamicType === 'video_auto_post') {
            subLog('debug', 'feed-video-dynamic-skipped', {
                dynamicId: item.id_str,
                archiveDynamicType
            })
            return true
        }
        if (archiveDynamicType === 'unknown_archive_dynamic') {
            subLog('debug', 'feed-unknown-archive-dynamic-skipped', {
                dynamicId: item.id_str,
                archiveDynamicType
            })
            return true
        }

        // Skip article post auto-dynamic (check for cv ID in jump URL)
        if (major?.type === 'MAJOR_TYPE_OPUS') {
            const jumpUrl = major.opus?.jump_url || ''
            if (/\/read\/cv\d+/i.test(jumpUrl)) {
                subLog('debug', 'feed-article-dynamic-skipped', {
                    dynamicId: item.id_str
                })
                return true
            }
        }

        return false
    }
}
