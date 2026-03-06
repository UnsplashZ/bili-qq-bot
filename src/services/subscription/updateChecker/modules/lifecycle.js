const { subscriptionManager, config, logger } = require('../adapters/deps')

module.exports = {
    setWs(ws) {
        this.ws = ws
        this.groupAtAllCapabilityCache.clear()
        this.groupAtAllCapabilityInFlight.clear()
        this.groupBotRoleCache.clear()
        this.groupBotRoleInFlight.clear()
    },

    /**
     * 启动订阅检查器
     * @param {boolean} skipInitialDelay - 是否跳过初始延迟
     */
    start(skipInitialDelay = false) {
        // 🆕 先停止现有定时器，防止泄漏
        this.stop()

        logger.info('[UpdateChecker] Starting subscription checker', {
            checkInterval: `${this.checkInterval / 1000}s`,
            syncInterval: `${this.syncInterval / 1000}s`,
            skipInitialDelay
        })

        // Initial check after 10 seconds (Feed & Subs) - or immediately if skipInitialDelay
        const initialDelay = skipInitialDelay ? 0 : 10000
        this.initTimer = setTimeout(() => {
            this.checkAll()
            this.initTimer = null
        }, initialDelay)

        this.timer = setInterval(() => {
            this.checkAll()
        }, this.checkInterval)

        // Initial check after 5 seconds (List Sync)
        const syncDelay = skipInitialDelay ? 0 : 5000
        this.initSyncTimer = setTimeout(() => {
            this.refreshCookieFollowings()
            this.initSyncTimer = null
        }, syncDelay)

        this.syncTimer = setInterval(() => {
            this.refreshCookieFollowings()
        }, this.syncInterval)

        // 5. Cookie 自动刷新：Bot 启动时立即检查，之后每24小时一次
        this.checkAndRefreshCredential().catch(e => {
            logger.error('[UpdateChecker] Unexpected error in credential refresh:', e)
        })
        this.credentialRefreshTimer = setInterval(
            () => {
                this.checkAndRefreshCredential().catch(e => {
                    logger.error('[UpdateChecker] Unexpected error in credential refresh:', e)
                })
            },
            this.CREDENTIAL_REFRESH_INTERVAL
        )

        this.warmupGroupAtAllCapabilities(true).catch(e => {
            logger.error('[UpdateChecker] Failed to warmup @all capabilities:', e)
        })

        logger.info('[UpdateChecker] All timers started successfully')
    },

    /**
     * 停止订阅检查器
     */
    stop() {
        let clearedCount = 0

        if (this.initTimer) {
            clearTimeout(this.initTimer)
            this.initTimer = null
            clearedCount++
        }

        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
            clearedCount++
        }

        if (this.initSyncTimer) {
            clearTimeout(this.initSyncTimer)
            this.initSyncTimer = null
            clearedCount++
        }

        if (this.syncTimer) {
            clearInterval(this.syncTimer)
            this.syncTimer = null
            clearedCount++
        }

        if (this.credentialRefreshTimer) {
            clearInterval(this.credentialRefreshTimer)
            this.credentialRefreshTimer = null
            clearedCount++
        }

        if (clearedCount > 0) {
            logger.info(`[UpdateChecker] Stopped subscription checker, cleared ${clearedCount} timers`)
        }
    },

    /**
     * 🆕 重启订阅检查器（先停止再启动）
     */
    restart() {
        logger.info('[UpdateChecker] Restarting subscription checker...')
        this.stop()
        this.start(true) // Skip initial delay on restart
    },

    /**
     * 🆕 获取定时器状态（用于调试）
     */
    getStatus() {
        return {
            running: !!(this.timer || this.syncTimer),
            timers: {
                initTimer: !!this.initTimer,
                mainTimer: !!this.timer,
                initSyncTimer: !!this.initSyncTimer,
                syncTimer: !!this.syncTimer,
                credentialRefreshTimer: !!this.credentialRefreshTimer
            },
            intervals: {
                check: `${this.checkInterval / 1000}s`,
                sync: `${this.syncInterval / 1000}s`,
                credentialRefresh: `${this.CREDENTIAL_REFRESH_INTERVAL / 1000}s`
            }
        }
    },

    updateCheckInterval(seconds) {
        this.checkInterval = seconds * 1000
        this.stop()
        this.start()
    },

    async checkAll() {
        if (this._checkAllInFlight) {
            logger.warn('[UpdateChecker] Scheduled check skipped: previous check is still running')
            return
        }
        this._checkAllInFlight = true
        logger.info('[UpdateChecker] Starting scheduled check...')
        try {
            // Ensure subscriptions are loaded before checking
            await subscriptionManager._ensureSubscriptionsLoaded()

            // Build active groups set (only groups where isInGroup !== false)
            const activeGroups = new Set()
            const groupConfigs = config.groupConfigs || {}
            const isGroupActive = (groupId) => {
                const gid = String(groupId)
                if (!gid) return false
                const groupConfig = groupConfigs[gid]
                return !groupConfig || groupConfig.isInGroup !== false
            }
            const tryAddActiveGroup = (groupId) => {
                const gid = String(groupId)
                if (!gid) return
                if (isGroupActive(gid)) {
                    activeGroups.add(gid)
                }
            }

            for (const [groupId, groupConfig] of Object.entries(groupConfigs)) {
                if (groupConfig.isInGroup !== false) {
                    activeGroups.add(groupId)
                }
            }

            for (const sub of subscriptionManager.userSubs || []) {
                for (const gid of sub.groupIds || []) {
                    tryAddActiveGroup(gid)
                }
            }

            for (const sub of subscriptionManager.bangumiSubs || []) {
                for (const gid of sub.groupIds || []) {
                    tryAddActiveGroup(gid)
                }
            }

            for (const gid of Object.keys(subscriptionManager.groupToAccountMap || {})) {
                tryAddActiveGroup(gid)
            }

            logger.debug(`[UpdateChecker] Active groups: ${activeGroups.size} of ${Object.keys(groupConfigs).length} total`)

            // Prepare split coverage sets for feed checks (dynamic/live are independent)
            const feedCoverage = {
                dynamicUids: new Set(),
                liveUids: new Set()
            }

            // 1. Check Feed Updates (Cookie Sync)
            // This will populate feedCoverage with UIDs covered by feed checks
            await this.checkFeedUpdate(feedCoverage, activeGroups)
            logger.debug(`[UpdateChecker] Feed coverage: dynamic=${feedCoverage.dynamicUids.size}, live=${feedCoverage.liveUids.size}`)

            // 2. Check User Dynamics (Manual Subs)
            for (const sub of subscriptionManager.userSubs) {
                // Skip dynamic fallback only if dynamic feed has covered this user
                if (feedCoverage.dynamicUids.has(String(sub.uid))) {
                    continue
                }

                // Filter out inactive groups
                const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
                if (targetGroups.length === 0) {
                    logger.debug(`[UpdateChecker] Skipped dynamic check for UID ${sub.uid} (${sub.name}): all subscribed groups have left`)
                    continue
                }

                await this.checkUserDynamic(sub, targetGroups)
                // Small delay to be nice to API
                await new Promise(r => setTimeout(r, 1000))
            }

            // 3. Build unified user check list (Manual Subs + Cookie Sync)
            const userCheckList = this.buildUserCheckList(activeGroups)
            logger.info(`[UpdateChecker] Built unified user check list: ${userCheckList.length} users (manual: ${subscriptionManager.userSubs.length}, after merge)`)

            // 4. Check User Videos (Manual Subs + Cookie Sync)
            logger.info('[UpdateChecker] Checking user videos (unified)...')
            for (const userItem of userCheckList) {
                await this.checkUserVideoUnified(userItem)
                // Slightly longer delay for video API
                await new Promise(r => setTimeout(r, 1500))
            }

            // 5. Check User Articles (Manual Subs + Cookie Sync)
            logger.info('[UpdateChecker] Checking user articles (unified)...')
            for (const userItem of userCheckList) {
                await this.checkUserArticleUnified(userItem)
                // Slightly longer delay for article API
                await new Promise(r => setTimeout(r, 1500))
            }

            // 6. Check User Live Status (Manual Subs)
            for (const sub of subscriptionManager.userSubs) {
                // Skip live fallback only if live feed has covered this user
                if (feedCoverage.liveUids.has(String(sub.uid))) {
                    continue
                }

                // Filter out inactive groups
                const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
                if (targetGroups.length === 0) {
                    logger.debug(`[UpdateChecker] Skipped live check for UID ${sub.uid} (${sub.name}): all subscribed groups have left`)
                    continue
                }

                await this.checkUserLive(sub, targetGroups)
                await new Promise(r => setTimeout(r, 1000))
            }

            // 7. Check Bangumi Updates
            for (const sub of subscriptionManager.bangumiSubs) {
                // Filter out inactive groups
                const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
                if (targetGroups.length === 0) {
                    logger.debug(`[UpdateChecker] Skipped bangumi check for ${sub.seasonId} (${sub.title}): all subscribed groups have left`)
                    continue
                }

                await this.checkBangumi(sub, targetGroups)
                await new Promise(r => setTimeout(r, 1000))
            }

            // 8. Refresh missing names (maintenance)
            await this.refreshMissingNames()
        } catch (error) {
            logger.error('[UpdateChecker] Scheduled check failed:', error)
        } finally {
            try {
                if (typeof subscriptionManager.flushPendingFollowerSaves === 'function') {
                    await subscriptionManager.flushPendingFollowerSaves()
                }
            } catch (flushError) {
                logger.error('[UpdateChecker] Failed to flush pending follower saves after scheduled check:', flushError)
            }
            this._checkAllInFlight = false
        }
    }
}
