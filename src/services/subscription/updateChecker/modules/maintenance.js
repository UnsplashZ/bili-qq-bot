const { subscriptionManager, notificationService, biliApi, config, logger } = require('../adapters/deps')
const { classifyBiliApiError } = require('../../../biliApiErrorClassifier')

function subLog(level, message, fields = {}, scope = 'svc:maintenance') {
    logger.logEvent(level, 'SUB', scope, message, fields)
}

const RETRYABLE_ALERT_FAILURES = 3
const RETRYABLE_ALERT_DURATION_MS = 15 * 60 * 1000

function formatTimestamp(value) {
    return value ? new Date(value).toISOString() : null
}

module.exports = {
    /**
     * 向 Admin 发送私聊通知
     * @param {string} message
     */
    notifyAdmin(message) {
        const rootAdminQQ = config.getRootAdminQQ()
        const officialRootOpenids = typeof config.getOfficialRootOpenids === 'function'
            ? config.getOfficialRootOpenids()
            : []
        const isOfficialTransport = String(this.ws?.id || '').toLowerCase() === 'official'
        const adminTargets = isOfficialTransport
            ? officialRootOpenids
            : (rootAdminQQ ? [rootAdminQQ] : [])
        if (adminTargets.length === 0) return
        if (!this.ws) {
            subLog('warn', 'admin-notify-skipped', {
                reason: 'ws_unavailable',
                message
            })
            return
        }
        for (const adminId of adminTargets) {
            Promise.resolve(notificationService.sendPrivateMessage(this.ws, adminId, `[Bot通知] ${message}`))
                .catch((error) => {
                    subLog('warn', 'admin-notify-failed', {
                        targetType: isOfficialTransport ? 'official_openid' : 'qq',
                        error: logger.getErrorMessage(error)
                    })
                })
        }
    },

    getCookieSyncFailureState(groupId) {
        if (!this.cookieSyncFailureState) {
            this.cookieSyncFailureState = new Map()
        }
        const gid = String(groupId)
        if (!this.cookieSyncFailureState.has(gid)) {
            this.cookieSyncFailureState.set(gid, {
                consecutiveFailures: 0,
                firstFailureAt: null,
                lastFailureAt: null,
                lastSuccessAt: null,
                lastAlertAt: null
            })
        }
        return this.cookieSyncFailureState.get(gid)
    },

    recordCookieSyncSuccess(groupId, accountUid = null) {
        const state = this.getCookieSyncFailureState(groupId)
        state.consecutiveFailures = 0
        state.firstFailureAt = null
        state.lastFailureAt = null
        state.lastAlertAt = null
        state.lastSuccessAt = Date.now()
        subLog('info', 'cookie-sync-health-restored', {
            groupId,
            accountUid,
            consecutiveFailures: state.consecutiveFailures,
            lastSuccessAt: formatTimestamp(state.lastSuccessAt)
        })
    },

    recordCookieSyncFailure(groupId, resultOrError, context = {}) {
        const state = this.getCookieSyncFailureState(groupId)
        const now = Date.now()
        const classified = classifyBiliApiError(resultOrError)
        state.consecutiveFailures += 1
        state.firstFailureAt = state.firstFailureAt || now
        state.lastFailureAt = now

        const fields = {
            groupId,
            accountUid: context.accountUid || null,
            failureKind: classified.failureKind,
            endpoint: classified.endpoint || context.endpoint || null,
            consecutiveFailures: state.consecutiveFailures,
            lastSuccessAt: formatTimestamp(state.lastSuccessAt),
            retryable: classified.retryable,
            httpStatus: classified.httpStatus,
            biliCode: classified.biliCode,
            exceptionClass: classified.exceptionClass,
            error: classified.message || logger.getErrorMessage(resultOrError)
        }

        if (classified.errorType === 'auth_failed') {
            subLog('warn', 'cookie-sync-auth-failed', fields)
            this.notifyAdmin(`⚠️ B站Cookie未登录或已失效（群 ${groupId}），请重新配置 Cookie。`)
            return classified
        }

        if (classified.retryable) {
            const failureDurationMs = now - state.firstFailureAt
            const shouldAlert = state.consecutiveFailures >= RETRYABLE_ALERT_FAILURES ||
                failureDurationMs >= RETRYABLE_ALERT_DURATION_MS

            subLog(shouldAlert ? 'error' : 'warn', 'cookie-sync-retryable-failed', {
                ...fields,
                failureDurationMs
            })

            if (shouldAlert && (!state.lastAlertAt || state.lastAlertAt < state.firstFailureAt)) {
                this.notifyAdmin(
                    `⚠️ B站关注列表同步遇到网络/API异常（群 ${groupId}，连续 ${state.consecutiveFailures} 次），系统会继续重试。`
                )
                state.lastAlertAt = now
            }
            return classified
        }

        subLog('error', 'cookie-sync-nonretryable-failed', fields)
        return classified
    },

    recordCredentialRefreshFailure(resultOrError) {
        const state = this.getCookieSyncFailureState('__credential_refresh__')
        const now = Date.now()
        const classified = classifyBiliApiError(resultOrError)
        state.consecutiveFailures += 1
        state.firstFailureAt = state.firstFailureAt || now
        state.lastFailureAt = now

        const fields = {
            failureKind: classified.failureKind,
            endpoint: classified.endpoint || 'refresh_credential',
            consecutiveFailures: state.consecutiveFailures,
            lastSuccessAt: formatTimestamp(state.lastSuccessAt),
            retryable: classified.retryable,
            httpStatus: classified.httpStatus,
            biliCode: classified.biliCode,
            exceptionClass: classified.exceptionClass,
            error: classified.message || logger.getErrorMessage(resultOrError)
        }

        if (classified.errorType === 'auth_failed') {
            subLog('warn', 'credential-refresh-auth-failed', fields)
            this.notifyAdmin(`⚠️ B站Cookie异常：${fields.error}`)
            return classified
        }

        if (classified.retryable) {
            const failureDurationMs = now - state.firstFailureAt
            const shouldAlert = state.consecutiveFailures >= RETRYABLE_ALERT_FAILURES ||
                failureDurationMs >= RETRYABLE_ALERT_DURATION_MS

            subLog(shouldAlert ? 'error' : 'warn', 'credential-refresh-retryable-failed', {
                ...fields,
                failureDurationMs
            })

            if (shouldAlert && (!state.lastAlertAt || state.lastAlertAt < state.firstFailureAt)) {
                this.notifyAdmin(
                    `⚠️ B站Cookie自动刷新遇到网络/API异常（连续 ${state.consecutiveFailures} 次），系统会继续重试。`
                )
                state.lastAlertAt = now
            }
            return classified
        }

        subLog('error', 'credential-refresh-nonretryable-failed', fields)
        return classified
    },

    recordCredentialRefreshSuccess() {
        const state = this.getCookieSyncFailureState('__credential_refresh__')
        state.consecutiveFailures = 0
        state.firstFailureAt = null
        state.lastFailureAt = null
        state.lastAlertAt = null
        state.lastSuccessAt = Date.now()
    },

    /**
     * 检查并自动刷新 B站 Cookie
     */
    async checkAndRefreshCredential() {
        try {
            const result = await biliApi.refreshCredential()
            if (result.status === 'error') {
                this.recordCredentialRefreshFailure(result)
            } else if (result.refreshed) {
                this.recordCredentialRefreshSuccess()
                subLog('info', 'credential-refreshed')
                this.notifyAdmin('✅ B站Cookie已自动刷新成功')
            } else {
                this.recordCredentialRefreshSuccess()
                subLog('debug', 'credential-still-valid')
            }
        } catch (e) {
            subLog('error', 'credential-refresh-check-failed', {
                error: logger.getErrorMessage(e)
            })
            // Python 服务不可用时静默（ServiceManager 会处理重启通知）
        }
    },

    async refreshCookieFollowings() {
        // Ensure followers are loaded before updating to prevent overwriting with old data
        await subscriptionManager._ensureFollowersLoaded()

        // Get all groups with sync enabled and bot is still in
        const groupsWithSync = Object.keys(config.groupConfigs || {}).filter(gid => {
            const groupConfig = config.groupConfigs[gid]
            // Skip groups bot has left
            if (groupConfig && groupConfig.isInGroup === false) {
                return false
            }
            return config.getGroupConfig(gid, 'enableCookieSync')
        })

        if (groupsWithSync.length === 0) return

        const visitedUids = new Set()

        for (const groupId of groupsWithSync) {
            try {
                // First, check who is logged in for this group
                const myInfo = await biliApi.getMyInfo(groupId)
                if (myInfo.status !== 'success') {
                    this.recordCookieSyncFailure(groupId, myInfo, { endpoint: 'my_info' })
                    continue
                }

                const myUid = String(myInfo.data.mid)

                // Update mapping
                await subscriptionManager.setGroupAccountMapping(groupId, myUid)

                // If we already refreshed this account in this cycle, skip fetching
                if (visitedUids.has(myUid)) {
                    this.recordCookieSyncSuccess(groupId, myUid)
                    continue
                }

                // Fetch followings
                subLog('info', 'cookie-sync-refresh-start', {
                    accountUid: myUid,
                    groupId
                })
                const res = await biliApi.getMyFollowings(null, groupId)

                if (res.status === 'success' && res.data) {
                    await subscriptionManager.setCookieFollowings(myUid, res.data)
                    visitedUids.add(myUid)
                    this.recordCookieSyncSuccess(groupId, myUid)
                } else {
                    this.recordCookieSyncFailure(groupId, res, {
                        accountUid: myUid,
                        endpoint: 'my_followings'
                    })
                }

                // Sleep to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000))
            } catch (e) {
                const classified = this.recordCookieSyncFailure(groupId, e, {
                    endpoint: e?.endpoint || null
                })
                const state = this.getCookieSyncFailureState(groupId)
                subLog(classified.retryable ? 'warn' : 'error', 'cookie-sync-cycle-failed', {
                    groupId,
                    failureKind: classified.failureKind,
                    endpoint: classified.endpoint,
                    consecutiveFailures: state.consecutiveFailures,
                    lastSuccessAt: formatTimestamp(state.lastSuccessAt),
                    error: logger.getErrorMessage(e)
                })
            }
        }
    },

    async refreshMissingNames() {
        // For users with no name
        for (const sub of subscriptionManager.userSubs) {
            if (!sub.name) {
                try {
                    const info = await biliApi.getUserInfo(sub.uid)
                    if (info.status === 'success') {
                        await subscriptionManager.updateUserSub(sub.uid, { name: info.data.name })
                    }
                } catch (e) {}
            }
        }
    }
}
