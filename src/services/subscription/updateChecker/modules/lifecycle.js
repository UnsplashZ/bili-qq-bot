const {
    subscriptionManager,
    config,
    logger,
    subscriptionStateStore,
    subscriptionDeliveryStore
} = require('../adapters/deps')

function subLog(level, message, fields = {}, scope = 'svc:lifecycle') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

function isProviderConnected(provider) {
    if (!provider) return false
    if (provider.readyState === 1) return true
    if (String(provider.state || '').toLowerCase() === 'ready') return true
    const status = typeof provider.getStatus === 'function' ? provider.getStatus() : null
    return ['ready', 'open'].includes(String(status?.connectionState || status?.state || '').toLowerCase())
}

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
    start(skipInitialDelay = false, options = {}) {
        // 🆕 先停止现有定时器，防止泄漏
        const stopPromise = this.stop()
        if (options.resumeOperations !== false) this.operationRegistry?.resume()
        const startToken = Symbol('subscription-checker-start')
        this._startToken = startToken
        this._subscriptionRuntimeStartState = 'initializing'
        this._subscriptionRuntimeStartRequestedAt = Date.now()
        this._subscriptionRuntimeReadyAt = null
        this._subscriptionRuntimeLastError = null
        this._subscriptionRuntimeLastErrorAt = null

        subLog('info', 'checker-started', {
            checkInterval: `${this.checkInterval / 1000}s`,
            syncInterval: `${this.syncInterval / 1000}s`,
            skipInitialDelay
        })

        const startPromise = (async () => {
            await stopPromise
            if (this._startToken !== startToken) return
            let result = await this.initializeSubscriptionRuntime({ startToken })
            if (result && result.cancelled && this._startToken === startToken) {
                result = await this.initializeSubscriptionRuntime({ startToken })
            }
            if (this._startToken !== startToken) {
                subLog('debug', 'checker-start-aborted', {
                    reason: 'stale_start_token'
                })
                return
            }
            if (result && result.cancelled) {
                this._subscriptionRuntimeStartState = 'stopped'
                subLog('debug', 'checker-start-aborted', {
                    reason: 'runtime_init_cancelled'
                })
                return
            }
            const maintenanceDeferred = this.scheduleRuntimeTimers(skipInitialDelay, { startToken })
            if (maintenanceDeferred) {
                this._subscriptionRuntimeStartState = 'admission-deferred'
                subLog('info', 'checker-admission-deferred')
            } else {
                this._subscriptionRuntimeStartState = 'ready'
                this._subscriptionRuntimeReadyAt = Date.now()
                subLog('info', 'checker-ready')
            }
        })().catch(error => {
            if (this._startToken !== startToken) {
                subLog('debug', 'checker-start-error-ignored', {
                    reason: 'stale_start_token',
                    error: logger.getErrorMessage(error)
                })
                return
            }
            this._subscriptionRuntimeStartState = 'error'
            this._subscriptionRuntimeLastError = logger.getErrorMessage(error)
            this._subscriptionRuntimeLastErrorAt = Date.now()
            subLog('error', 'checker-start-failed', {
                error: logger.getErrorMessage(error)
            })
            if (options.throwOnError) throw error
        })
        this._subscriptionRuntimeStartPromise = startPromise
        return startPromise
    },

    scheduleRuntimeTimers(skipInitialDelay = false, options = {}) {
        // Initial check after 10 seconds (Feed & Subs) - or immediately if skipInitialDelay
        const initialDelay = skipInitialDelay ? 0 : 10000
        this.initTimer = setTimeout(() => {
            this.checkAll().catch(e => subLog('debug', 'initial-check-skipped', { error: logger.getErrorMessage(e) }))
            this.initTimer = null
        }, initialDelay)

        this.timer = setInterval(() => {
            this.checkAll().catch(e => subLog('debug', 'scheduled-check-skipped', { error: logger.getErrorMessage(e) }))
        }, this.checkInterval)

        // Initial check after 5 seconds (List Sync)
        const syncDelay = skipInitialDelay ? 0 : 5000
        this.initSyncTimer = setTimeout(() => {
            this.refreshCookieFollowings().catch(e => subLog('debug', 'initial-sync-skipped', { error: logger.getErrorMessage(e) }))
            this.initSyncTimer = null
        }, syncDelay)

        this.syncTimer = setInterval(() => {
            this.refreshCookieFollowings().catch(e => subLog('debug', 'scheduled-sync-skipped', { error: logger.getErrorMessage(e) }))
        }, this.syncInterval)

        const startToken = options.startToken || this._startToken
        const activateAdmissionMaintenance = () => {
            if (!startToken || this._startToken !== startToken) return false
            this._cancelAdmissionMaintenance = null
            this.checkAndRefreshCredential().catch(e => {
                subLog('error', 'credential-refresh-failed', {
                    error: logger.getErrorMessage(e)
                })
            })
            if (!this.credentialRefreshTimer) {
                this.credentialRefreshTimer = setInterval(
                    () => {
                        this.checkAndRefreshCredential().catch(e => {
                            subLog('error', 'credential-refresh-failed', {
                                error: logger.getErrorMessage(e)
                            })
                        })
                    },
                    this.CREDENTIAL_REFRESH_INTERVAL
                )
            }
            this.warmupGroupAtAllCapabilities(true).catch(e => {
                subLog('error', 'at-all-warmup-failed', {
                    error: logger.getErrorMessage(e)
                })
            })
            if (this._subscriptionRuntimeStartState === 'admission-deferred') {
                this._subscriptionRuntimeStartState = 'ready'
                this._subscriptionRuntimeReadyAt = Date.now()
                subLog('info', 'checker-ready')
            }
            return true
        }
        this._cancelAdmissionMaintenance?.()
        this._cancelAdmissionMaintenance = null
        if (this.applicationAdmissionGate?.snapshot?.().closed) {
            this._cancelAdmissionMaintenance = this.applicationAdmissionGate.runWhenOpen(
                activateAdmissionMaintenance
            )
            return true
        }
        activateAdmissionMaintenance()
        return false
    },

    /**
     * 停止订阅检查器
     */
    stop() {
        this.operationRegistry?.pause('subscription-stopped')
        let clearedCount = 0
        const hadStartToken = Boolean(this._startToken)
        const pendingStartPromise = this._subscriptionRuntimeStartPromise

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

        if (this._cancelAdmissionMaintenance) {
            this._cancelAdmissionMaintenance()
            this._cancelAdmissionMaintenance = null
            clearedCount++
        }

        this._startToken = null
        if (['initializing', 'admission-deferred', 'ready'].includes(this._subscriptionRuntimeStartState)) {
            this._subscriptionRuntimeStartState = 'stopped'
        }
        this._subscriptionRuntimeReadyAt = null

        if (clearedCount > 0 || hadStartToken) {
            subLog('info', 'checker-stopped', {
                clearedCount,
                startupPending: hadStartToken && clearedCount === 0
            })
        }

        if (pendingStartPromise && typeof pendingStartPromise.then === 'function') {
            return pendingStartPromise.catch(() => {})
        }
        return Promise.resolve()
    },

    /**
     * 🆕 重启订阅检查器（先停止再启动）
     */
    async restart(options = {}) {
        subLog('info', 'checker-restarting')
        await this.stop()
        return this.start(true, options) // Skip initial delay on restart
    },

    async initializeSubscriptionRuntime(options = {}) {
        if (this._subscriptionRuntimeInitialized) return
        if (this._subscriptionRuntimeInitializing) return this._subscriptionRuntimeInitializing
        const startToken = options && options.startToken
        const isCancelled = () => startToken && this._startToken !== startToken

        this._subscriptionRuntimeInitializing = (async () => {
            await subscriptionManager._ensureSubscriptionsLoaded()
            if (isCancelled()) return { cancelled: true }

            if (typeof subscriptionManager._ensureFollowersLoaded === 'function') {
                await subscriptionManager._ensureFollowersLoaded()
            }
            if (isCancelled()) return { cancelled: true }

            if (subscriptionStateStore && typeof subscriptionStateStore.ensureLoaded === 'function') {
                await subscriptionStateStore.ensureLoaded()
            }
            if (isCancelled()) return { cancelled: true }

            if (subscriptionDeliveryStore && typeof subscriptionDeliveryStore.ensureLoaded === 'function') {
                await subscriptionDeliveryStore.ensureLoaded()
            }
            if (isCancelled()) return { cancelled: true }

            if (subscriptionStateStore && typeof subscriptionStateStore.initializeFromLegacy === 'function') {
                const result = await subscriptionStateStore.initializeFromLegacy({
                    userSubs: subscriptionManager.userSubs || [],
                    cookieFollowings: subscriptionManager.cookieFollowings || {}
                })
                if (isCancelled()) return { cancelled: true }
                subLog('info', 'subscription-state-initialized', {
                    migrated: Boolean(result && result.changed)
                })
            }

            if (subscriptionDeliveryStore && typeof subscriptionDeliveryStore.cleanupExpired === 'function') {
                const cleanup = await subscriptionDeliveryStore.cleanupExpired()
                if (isCancelled()) return { cancelled: true }
                subLog('debug', 'subscription-delivery-cleanup-done', {
                    removed: cleanup?.removed || 0
                })
            }

            this._subscriptionRuntimeInitialized = true
            return { initialized: true }
        })()

        try {
            return await this._subscriptionRuntimeInitializing
        } finally {
            this._subscriptionRuntimeInitializing = null
        }
    },

    /**
     * 🆕 获取定时器状态（用于调试）
     */
    getStatus() {
        const startupPending = Boolean(
            this._startToken &&
            (
                this._subscriptionRuntimeStartState === 'initializing' ||
                this._subscriptionRuntimeStartState === 'admission-deferred' ||
                this._subscriptionRuntimeInitializing
            )
        )
        const ready = this._subscriptionRuntimeStartState === 'ready' && Boolean(this._subscriptionRuntimeInitialized)
        return {
            running: this._subscriptionRuntimeStartState === 'ready' && !!(this.timer || this.syncTimer),
            runtime: {
                startState: this._subscriptionRuntimeStartState || 'stopped',
                startupPending,
                initialized: Boolean(this._subscriptionRuntimeInitialized),
                initializing: Boolean(this._subscriptionRuntimeInitializing),
                ready,
                lastError: this._subscriptionRuntimeLastError || null,
                lastErrorAt: this._subscriptionRuntimeLastErrorAt || null,
                startedAt: this._subscriptionRuntimeStartRequestedAt || null,
                readyAt: this._subscriptionRuntimeReadyAt || null
            },
            timers: {
                initTimer: !!this.initTimer,
                mainTimer: !!this.timer,
                initSyncTimer: !!this.initSyncTimer,
                syncTimer: !!this.syncTimer,
                credentialRefreshTimer: !!this.credentialRefreshTimer,
                admissionMaintenancePending: Boolean(this._cancelAdmissionMaintenance)
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
        if (this.initTimer) {
            clearTimeout(this.initTimer)
            this.initTimer = null
        }
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        const runtimeRunning = this._subscriptionRuntimeStartState === 'ready' &&
            Boolean(this._startToken) &&
            isProviderConnected(this.ws)
        if (runtimeRunning) {
            this.timer = setInterval(() => {
                this.checkAll().catch(e => {
                    subLog('error', 'scheduled-check-failed', { error: logger.getErrorMessage(e) })
                })
            }, this.checkInterval)
            this.timer.unref?.()
        }
        subLog('info', 'check-interval-updated', {
            checkInterval: `${this.checkInterval / 1000}s`,
            timerScheduled: runtimeRunning
        })
    },

    pauseOperations(reason = 'reload') {
        this.operationRegistry?.pause(reason)
    },

    resumeOperations() {
        this.operationRegistry?.resume()
    },

    drainOperations(timeoutMs = 30000) {
        return this.operationRegistry?.drain({ timeoutMs }) || Promise.resolve(true)
    },

    abortOperations(reason = 'forced-cleanup') {
        this.operationRegistry?.pause(reason)
        const operations = this.operationRegistry?.snapshot?.() || []
        this.operationRegistry?.abortAll(reason)
        return { requested: operations.length, operations }
    },

    async checkAll() {
        if (this._checkAllInFlight) {
            subLog('warn', 'cycle-skipped', {
                reason: 'already_running'
            })
            return
        }
        this._checkAllInFlight = true
        const pollScope = logger.createScope('poll', Date.now(), Math.random().toString(36).slice(2, 8))
        logger.logEvent('info', 'SUB', pollScope, 'cycle-start', {})
        try {
            // Ensure subscriptions, followers, unified state, and delivery ledger are ready before checking.
            await this.initializeSubscriptionRuntime()

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

            subLog('debug', 'active-groups-ready', {
                activeGroupCount: activeGroups.size,
                totalGroupCount: Object.keys(groupConfigs).length
            }, pollScope)

            // Prepare split coverage sets for feed checks (dynamic/live are independent)
            const feedCoverage = {
                dynamicUids: new Set(),
                liveUids: new Set()
            }

            // 1. Check Feed Updates (Cookie Sync)
            // This will populate feedCoverage with UIDs covered by feed checks
            await this.checkFeedUpdate(feedCoverage, activeGroups)
            subLog('debug', 'feed-coverage-ready', {
                dynamicCount: feedCoverage.dynamicUids.size,
                liveCount: feedCoverage.liveUids.size
            }, pollScope)

            // 2. Check User Dynamics (Manual Subs)
            for (const sub of subscriptionManager.userSubs) {
                // Skip dynamic fallback only if dynamic feed has covered this user
                if (feedCoverage.dynamicUids.has(String(sub.uid))) {
                    continue
                }

                // Filter out inactive groups
                const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
                if (targetGroups.length === 0) {
                    subLog('debug', 'dynamic-check-skipped', {
                        uid: sub.uid,
                        reason: 'no_active_groups'
                    }, logger.createScope('sub', 'user', sub.uid))
                    continue
                }

                logger.logEvent('info', 'SUB', logger.createScope('sub', 'user', sub.uid), 'dynamic-check', {
                    pollScope,
                    groupCount: targetGroups.length
                })
                await this.checkUserDynamic(sub, targetGroups)
                // Small delay to be nice to API
                await new Promise(r => setTimeout(r, 1000))
            }

            // 3. Build unified user check list (Manual Subs + Cookie Sync)
            const userCheckList = this.buildUserCheckList(activeGroups)
            logger.logEvent('info', 'SUB', pollScope, 'user-check-list-ready', {
                totalUsers: userCheckList.length,
                manualUsers: subscriptionManager.userSubs.length
            })

            // 4. Check User Videos (Manual Subs + Cookie Sync)
            for (const userItem of userCheckList) {
                logger.logEvent('info', 'SUB', logger.createScope('sub', 'user', userItem.uid), 'video-check', {
                    pollScope,
                    groupCount: Array.isArray(userItem.targetGroups) ? userItem.targetGroups.length : 0
                })
                await this.checkUserVideoUnified(userItem)
                // Slightly longer delay for video API
                await new Promise(r => setTimeout(r, 1500))
            }

            // 5. Check User Articles (Manual Subs + Cookie Sync)
            for (const userItem of userCheckList) {
                logger.logEvent('info', 'SUB', logger.createScope('sub', 'user', userItem.uid), 'article-check', {
                    pollScope,
                    groupCount: Array.isArray(userItem.targetGroups) ? userItem.targetGroups.length : 0
                })
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
                    subLog('debug', 'live-check-skipped', {
                        uid: sub.uid,
                        reason: 'no_active_groups'
                    }, logger.createScope('sub', 'user', sub.uid))
                    continue
                }

                logger.logEvent('info', 'SUB', logger.createScope('sub', 'user', sub.uid), 'live-check', {
                    pollScope,
                    groupCount: targetGroups.length
                })
                await this.checkUserLive(sub, targetGroups)
                await new Promise(r => setTimeout(r, 1000))
            }

            // 7. Check Bangumi Updates
            for (const sub of subscriptionManager.bangumiSubs) {
                // Filter out inactive groups
                const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
                if (targetGroups.length === 0) {
                    subLog('debug', 'bangumi-check-skipped', {
                        seasonId: sub.seasonId,
                        reason: 'no_active_groups'
                    }, logger.createScope('sub', 'bangumi', sub.seasonId))
                    continue
                }

                logger.logEvent('info', 'SUB', logger.createScope('sub', 'bangumi', sub.seasonId), 'bangumi-check', {
                    pollScope,
                    groupCount: targetGroups.length
                })
                await this.checkBangumi(sub, targetGroups)
                await new Promise(r => setTimeout(r, 1000))
            }

            // 8. Refresh missing names (maintenance)
            await this.refreshMissingNames()
        } catch (error) {
            subLog('error', 'cycle-failed', {
                error: logger.getErrorMessage(error)
            }, pollScope)
        } finally {
            try {
                if (typeof subscriptionManager.flushPendingFollowerSaves === 'function') {
                    await subscriptionManager.flushPendingFollowerSaves()
                }
            } catch (flushError) {
                subLog('error', 'pending-save-flush-failed', {
                    error: logger.getErrorMessage(flushError)
                }, pollScope)
            }
            logger.logEvent('info', 'SUB', pollScope, 'cycle-done', {})
            this._checkAllInFlight = false
        }
    }
}
