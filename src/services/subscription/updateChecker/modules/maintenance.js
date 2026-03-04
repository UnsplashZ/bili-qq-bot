const { subscriptionManager, notificationService, biliApi, config, logger } = require('../adapters/deps')

module.exports = {
    /**
     * 向 Admin 发送私聊通知
     * @param {string} message
     */
    notifyAdmin(message) {
        const rootAdminQQ = config.getRootAdminQQ()
        if (!rootAdminQQ) return
        if (!this.ws) {
            logger.warn(`[UpdateChecker] Cannot notify admin (WebSocket not ready): ${message}`)
            return
        }
        notificationService.sendPrivateMessage(this.ws, rootAdminQQ, `[Bot通知] ${message}`)
    },

    /**
     * 检查并自动刷新 B站 Cookie
     */
    async checkAndRefreshCredential() {
        try {
            const result = await biliApi.refreshCredential()
            if (result.status === 'error') {
                logger.warn(`[UpdateChecker] Cookie状态异常: ${result.message}`)
                this.notifyAdmin(`⚠️ B站Cookie异常：${result.message}`)
            } else if (result.refreshed) {
                logger.info('[UpdateChecker] B站Cookie已自动刷新成功')
                this.notifyAdmin('✅ B站Cookie已自动刷新成功')
            } else {
                logger.debug('[UpdateChecker] B站Cookie有效，无需刷新')
            }
        } catch (e) {
            logger.error('[UpdateChecker] Cookie刷新检查失败:', e)
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
        const failedGroups = []

        for (const groupId of groupsWithSync) {
            try {
                // First, check who is logged in for this group
                const myInfo = await biliApi.getMyInfo(groupId)
                if (myInfo.status !== 'success') {
                    // Maybe cookie expired or not set
                    logger.warn(`[UpdateChecker] Failed to get user info for group ${groupId}: ${myInfo.message}`)
                    failedGroups.push(groupId)
                    continue
                }

                const myUid = String(myInfo.data.mid)

                // Update mapping
                await subscriptionManager.setGroupAccountMapping(groupId, myUid)

                // If we already refreshed this account in this cycle, skip fetching
                if (visitedUids.has(myUid)) {
                    continue
                }

                // Fetch followings
                logger.info(`[UpdateChecker] Refreshing followings for account ${myUid} via group ${groupId}`)
                const res = await biliApi.getMyFollowings(null, groupId)

                if (res.status === 'success' && res.data) {
                    await subscriptionManager.setCookieFollowings(myUid, res.data)
                    visitedUids.add(myUid)
                } else {
                    logger.error(`[UpdateChecker] Failed to refresh followings for group ${groupId}:`, res.message)
                    failedGroups.push(groupId)
                }

                // Sleep to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000))
            } catch (e) {
                logger.error(`[UpdateChecker] Error refreshing cookie followings for group ${groupId}:`, e)
                failedGroups.push(groupId)
            }
        }

        // 若所有群的 Cookie 同步均失败，通知 admin
        if (failedGroups.length > 0 && failedGroups.length === groupsWithSync.length) {
            this.notifyAdmin(`⚠️ B站关注列表同步失败（${failedGroups.length}个群均失败），订阅推送可能中断。请检查Cookie状态。`)
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
