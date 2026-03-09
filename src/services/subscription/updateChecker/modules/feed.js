const { subscriptionManager, biliApi, config, logger } = require('../adapters/deps')
const { decideAdvance } = require('../helpers/stateAdvance')
const { resolveLiveState, normalizeRoomId } = require('../helpers/liveState')

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
        const liveCoverage = feedCoverage && feedCoverage.liveUids instanceof Set ? feedCoverage.liveUids : null

        // Loop through accounts
        for (const [uid, groupId] of accountGroups) {
            const dynamicCoveredCandidates = dynamicCoverage
                ? this.collectFeedCoveredUids(uid, activeGroups)
                : []

            let dynamicSucceeded = false
            try {
                // Process Dynamic Feed
                const dynamicResult = await this.processDynamicFeed(uid, groupId, activeGroups)
                dynamicSucceeded = dynamicResult?.ok === true

                if (dynamicSucceeded && dynamicCoverage && dynamicCoveredCandidates.length > 0) {
                    for (const fid of dynamicCoveredCandidates) {
                        dynamicCoverage.add(fid)
                    }
                }
            } catch (e) {
                logger.error(`[UpdateChecker] Dynamic feed update failed for account ${uid}:`, e)
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
                logger.error(`[UpdateChecker] Live feed update failed for account ${uid}:`, e)
            }

            logger.debug(`[UpdateChecker] Feed coverage commit for ${uid}: dynamic=${dynamicSucceeded}, live=${liveSucceeded}, dynamicCandidates=${dynamicCoveredCandidates.length}`)
        }
    },

    async processDynamicFeed(accountUid, groupId, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)]
        if (!followers || followers.length === 0) {
            return { ok: true, reason: 'no_followers' }
        }

        // Use safe ID generation
        const followerMap = new Map(followers.map(f => [subscriptionManager.getFollowerId(f), f]))
        let offset = ''
        let prevOffset = null
        let hasMore = true
        let page = 0
        // 使用 pendingUpdates 追踪变更，而非直接修改 followers 元素，
        // 避免 refreshCookieFollowings 并发替换数组引用时发生竞态条件
        const pendingUpdates = new Map() // uid → { lastDynamicId }

        while (hasMore && page < 5) {
            const res = await biliApi.getDynamicFeed(offset, groupId)
            if (res.status !== 'success' || !res.data) {
                logger.warn(`[UpdateChecker] Failed to get dynamic feed for account ${accountUid} (Group: ${groupId})`)
                return { ok: false, reason: 'dynamic_feed_fetch_failed' }
            }

            const allItems = res.data.items || []
            const items = allItems.filter(item => !this.shouldSkipDynamic(item))

            if (items.length < allItems.length) {
                logger.info(`[UpdateChecker] Feed: Filtered ${allItems.length - items.length} auto-post dynamics`)
            }

            hasMore = res.data.has_more
            offset = res.data.offset
            if (offset === prevOffset) break // Prevent infinite loop on unchanged offset
            prevOffset = offset
            page++

            if (items.length === 0) {
                logger.debug(`[UpdateChecker] Page ${page} all filtered, continuing to next page`)
                continue
            }

            for (const item of items) {
                const authorUid = String(item.modules?.module_author?.mid)
                if (!authorUid || !followerMap.has(authorUid)) continue

                const follower = followerMap.get(authorUid)
                const dynamicId = item.id_str

                // Check if new (ID > lastDynamicId)
                let isNew = false
                if (!follower.lastDynamicId) {
                    isNew = true // First time seeing this user's dynamic in feed?
                    // Maybe we shouldn't notify everything if it's the first run.
                    // But usually lastDynamicId is populated by sync.
                    // If it's missing, treat as seen to avoid spam, just update ID?
                    // Let's assume if missing, we just update it.
                    isNew = false
                } else {
                    try {
                        if (BigInt(dynamicId) > BigInt(follower.lastDynamicId)) {
                            isNew = true
                        }
                    } catch (e) {
                        // Fallback: zero-padded string comparison (safe for large IDs)
                        const a = dynamicId.padStart(20, '0')
                        const b = follower.lastDynamicId.padStart(20, '0')
                        if (a > b) isNew = true
                    }
                }

                if (isNew) {
                    let canAdvanceCurrentDynamic = false
                    // Check for live dynamic to skip (handled by processLiveFeed)
                    if (this.isLiveDynamic(item)) {
                        continue
                    }

                    const targetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
                    const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)

                    if (targetGroups.length > 0) {
                        // Fetch dynamic detail using standard API (unified with linkHandler)
                        // This ensures data format consistency with manual subscriptions
                        const info = await biliApi.getDynamicInfo(dynamicId, groupId)

                        if (info.status !== 'success') {
                            logger.warn(`[UpdateChecker] Failed to get dynamic detail for ${dynamicId} in feed, skipping`)
                            continue
                        }

                        const name = follower.uname || item.modules?.module_author?.name
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
                        const decision = decideAdvance(notifyResult)
                        canAdvanceCurrentDynamic = decision.action === 'advance'
                        if (!canAdvanceCurrentDynamic) {
                            logger.warn(`[UpdateChecker] Skip feed dynamic state advance for UID ${authorUid}: notify decision=${decision.action}, reason=${decision.reason}`)
                        }
                    }

                    if (!canAdvanceCurrentDynamic) {
                        continue
                    }
                }

                // 追踪最新 dynamicId（取 follower 原始值与已记录的 pending 值中的最大值作为基准）
                const pendingMax = pendingUpdates.has(authorUid)
                    ? pendingUpdates.get(authorUid).lastDynamicId
                    : follower.lastDynamicId
                try {
                    if (!pendingMax || BigInt(dynamicId) > BigInt(pendingMax || '0')) {
                        pendingUpdates.set(authorUid, { lastDynamicId: dynamicId })
                    }
                } catch (e) {
                    const a = String(dynamicId).padStart(20, '0')
                    const b = String(pendingMax || '0').padStart(20, '0')
                    if (!pendingMax || a > b) {
                        pendingUpdates.set(authorUid, { lastDynamicId: dynamicId })
                    }
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

        return { ok: true }
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
            const roomId = normalizeRoomId(item.room_id, item.roomid, follower.roomId)
            const liveState = resolveLiveState({
                liveRoom: {
                    live_status: item.live_status,
                    room_id: roomId
                },
                cachedRoomId: follower.roomId
            })

            if (roomId && follower.roomId !== roomId) {
                this.mergePendingLiveUpdate(pendingUpdates, uid, { roomId })
            }

            // Check if status changed from 0 to 1
            const cookieNeedsNotify = follower.lastLiveStatus !== 1
            const manualNeedsNotify = manualSub && manualSub.lastLiveStatus !== 1
            let canAdvanceCookieLive = cookieNeedsNotify
            let canAdvanceManualLive = manualNeedsNotify

            if (liveState.status === 'online' && (cookieNeedsNotify || manualNeedsNotify)) {
                const fullTargetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
                const allowedSources = []
                if (cookieNeedsNotify) allowedSources.push('cookieSync')
                if (manualNeedsNotify) allowedSources.push('manual')
                const targetGroupSourceMap = this.filterTargetGroupSourceMap(fullTargetGroupSourceMap, allowedSources)
                const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)

                if (targetGroups.length > 0) {
                    const name = item.uname

                    if (!liveState.roomId) {
                        logger.warn(`[UpdateChecker] No room ID for user ${uid} (${name}), skipping live notification`)
                        continue
                    }

                    // Fetch live room detail using standard API (unified with linkHandler)
                    const liveInfo = await biliApi.getLiveRoomInfo(liveState.roomId, groupId)
                    if (liveInfo.status !== 'success') {
                        logger.warn(`[UpdateChecker] Failed to get live room info for ${liveState.roomId} (${name}), skipping`)
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
                    const decision = decideAdvance(notifyResult)
                    const canAdvance = decision.action === 'advance'
                    canAdvanceCookieLive = cookieNeedsNotify && canAdvance
                    canAdvanceManualLive = manualNeedsNotify && canAdvance
                    if (!canAdvance) {
                        logger.warn(`[UpdateChecker] Skip feed live state advance for UID ${uid}: notify decision=${decision.action}, reason=${decision.reason}`)
                    }
                } else {
                    canAdvanceCookieLive = false
                    canAdvanceManualLive = false
                }
            }

            if (liveState.status === 'online' && cookieNeedsNotify && canAdvanceCookieLive) {
                this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 1 })
            }
            if (liveState.status === 'online' && manualNeedsNotify && canAdvanceManualLive) {
                await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 1 })
            }
            if (manualSub && (!manualNeedsNotify || canAdvanceManualLive)) {
                coveredUids.add(uid)
            }
        }

        // Handle offline users
        // If a user was live (lastLiveStatus === 1) but is no longer in the live list,
        // confirm offline via room info when possible. Treat fetch failures as unknown.
        for (const follower of followers) {
            const uid = subscriptionManager.getFollowerId(follower)
            const manualSub = this.findManualSub(uid)
            const cookieWasLive = follower.lastLiveStatus === 1
            const manualWasLive = manualSub?.lastLiveStatus === 1
            if ((cookieWasLive || manualWasLive) && !onlineUids.has(uid)) {
                const cachedRoomId = normalizeRoomId(follower.roomId)
                if (!cachedRoomId) {
                    let userInfo = null
                    try {
                        userInfo = await biliApi.getUserInfo(uid, groupId, 'fresh')
                    } catch (error) {
                        logger.warn(`[UpdateChecker] User live fallback failed for ${uid}: ${error?.message || error}`)
                    }

                    const liveState = resolveLiveState({
                        liveRoom: userInfo?.status === 'success' ? userInfo.data?.live_room : {},
                        cachedRoomId: ''
                    })
                    if (liveState.status === 'offline') {
                        if (cookieWasLive) {
                            this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 0 })
                        }
                        if (manualWasLive) {
                            await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 0 })
                            coveredUids.add(uid)
                        }
                    } else {
                        logger.debug(`[UpdateChecker] Missing cached roomId for live follower ${uid}; keeping previous live state`)
                    }
                    continue
                }

                let roomInfo = null
                try {
                    roomInfo = await biliApi.getLiveRoomInfo(cachedRoomId, groupId)
                } catch (error) {
                    logger.warn(`[UpdateChecker] Live room confirm failed for ${cachedRoomId} (${uid}): ${error?.message || error}`)
                }

                const liveState = resolveLiveState({
                    cachedRoomId,
                    roomInfo
                })

                if (liveState.status === 'offline') {
                    if (cookieWasLive) {
                        this.mergePendingLiveUpdate(pendingUpdates, uid, { lastLiveStatus: 0 })
                    }
                    if (manualWasLive) {
                        await subscriptionManager.updateUserSub(uid, { lastLiveStatus: 0 })
                        coveredUids.add(uid)
                    }
                } else if (liveState.status === 'unknown') {
                    logger.debug(`[UpdateChecker] Live status unknown for feed follower ${uid}; keeping previous live state`)
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

        // Skip video post auto-dynamic
        if (major?.type === 'MAJOR_TYPE_ARCHIVE' || item.type === 'DYNAMIC_TYPE_AV') {
            logger.debug(`[UpdateChecker] Skipping video dynamic: ${item.id_str}`)
            return true
        }

        // Skip article post auto-dynamic (check for cv ID in jump URL)
        if (major?.type === 'MAJOR_TYPE_OPUS') {
            const jumpUrl = major.opus?.jump_url || ''
            if (/\/read\/cv\d+/i.test(jumpUrl)) {
                logger.debug(`[UpdateChecker] Skipping article dynamic: ${item.id_str}`)
                return true
            }
        }

        return false
    }
}
