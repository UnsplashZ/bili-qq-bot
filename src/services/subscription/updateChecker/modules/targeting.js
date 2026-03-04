const { subscriptionManager, config } = require('../adapters/deps')
const { normalizeSourceList } = require('../helpers/sourceMap')

module.exports = {
    createGroupSourceMap(groupIds = [], sources = ['manual']) {
        const map = new Map()
        const normalizedSources = normalizeSourceList(sources)
        const fallbackSources = normalizedSources.length > 0 ? normalizedSources : ['manual']

        for (const groupId of groupIds || []) {
            const gid = String(groupId)
            if (!gid) continue
            const sourceSet = new Set()
            fallbackSources.forEach(source => sourceSet.add(source))
            map.set(gid, sourceSet)
        }

        return map
    },

    mergeGroupSourceMap(targetMap, groupId, sources) {
        if (!targetMap || !groupId) return
        const gid = String(groupId)
        const normalizedSources = normalizeSourceList(sources)
        const sourceList = normalizedSources.length > 0 ? normalizedSources : ['manual']

        if (!targetMap.has(gid)) {
            targetMap.set(gid, new Set(sourceList))
            return
        }

        const existing = targetMap.get(gid)
        sourceList.forEach(source => existing.add(source))
    },

    getGroupIdsFromSourceMap(sourceMap) {
        if (!(sourceMap instanceof Map)) return []
        return Array.from(sourceMap.keys())
    },

    normalizeGroupSourceMap(groupTargets, fallbackSource = 'manual') {
        if (groupTargets instanceof Map) {
            const cloned = new Map()
            for (const [groupId, sources] of groupTargets.entries()) {
                this.mergeGroupSourceMap(cloned, groupId, Array.isArray(sources) ? sources : Array.from(sources || []))
            }
            return cloned
        }

        if (Array.isArray(groupTargets)) {
            return this.createGroupSourceMap(groupTargets, [fallbackSource])
        }

        if (groupTargets && typeof groupTargets === 'object') {
            const normalized = new Map()
            for (const [groupId, sources] of Object.entries(groupTargets)) {
                this.mergeGroupSourceMap(normalized, groupId, Array.isArray(sources) ? sources : [sources])
            }
            return normalized
        }

        return new Map()
    },

    /**
     * 构建需要检查视频/专栏的统一用户列表
     * 合并手动订阅用户 + Cookie同步用户，自动去重
     * @param {Set} activeGroups - 活跃群组集合
     * @returns {Array<{uid, name, targetGroups, source, manualSub?, cookieFollower?, accountUid?}>} 用户检查列表
     */
    buildUserCheckList(activeGroups) {
        const userMap = new Map() // uid -> {uid, name, targetGroups, source}

        // 1. 添加手动订阅用户
        for (const sub of subscriptionManager.userSubs) {
            const manualUid = String(sub?.uid ?? '').trim()
            if (!manualUid) continue

            const targetGroups = sub.groupIds.filter(gid => activeGroups.has(gid))
            if (targetGroups.length === 0) continue
            const sourceMap = this.createGroupSourceMap(targetGroups, ['manual'])

            userMap.set(manualUid, {
                uid: manualUid,
                name: sub.name,
                targetGroups: targetGroups,
                targetGroupSourceMap: sourceMap,
                source: 'manual',
                manualSub: sub // 保留原始订阅对象的引用
            })
        }

        // 2. 添加Cookie同步用户
        for (const [accountUid, followers] of Object.entries(subscriptionManager.cookieFollowings)) {
            for (const follower of followers) {
                const fid = subscriptionManager.getFollowerId(follower)
                if (!fid) continue

                // 使用 findTargetGroupSourceMapForUser 判断哪些群组需要推送，并保留来源信息
                const targetGroupSourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
                const targetGroups = this.getGroupIdsFromSourceMap(targetGroupSourceMap)
                if (targetGroups.length === 0) continue

                // 如果用户已存在（手动订阅），合并目标群组
                if (userMap.has(fid)) {
                    const existing = userMap.get(fid)
                    // 合并群组和来源（去重）
                    targetGroupSourceMap.forEach((sources, gid) => {
                        this.mergeGroupSourceMap(existing.targetGroupSourceMap, gid, Array.from(sources))
                    })
                    existing.targetGroups = this.getGroupIdsFromSourceMap(existing.targetGroupSourceMap)
                    existing.source = 'both' // 标记为双重来源
                    existing.cookieFollower = follower // 添加Cookie follower引用
                    existing.accountUid = accountUid // Cookie所属账号
                } else {
                    userMap.set(fid, {
                        uid: fid,
                        name: follower.name || `User_${fid}`,
                        targetGroups: targetGroups,
                        targetGroupSourceMap,
                        source: 'cookie',
                        cookieFollower: follower,
                        accountUid: accountUid // Cookie所属账号
                    })
                }
            }
        }

        return Array.from(userMap.values())
    },

    collectFeedCoveredUids(accountUid, activeGroups = null) {
        const followers = subscriptionManager.cookieFollowings[String(accountUid)] || []
        const uidSet = new Set()

        for (const follower of followers) {
            const fid = subscriptionManager.getFollowerId(follower)
            if (!fid) continue

            // This includes both:
            // 1. Cookie sync + tag matching groups
            // 2. Manual subscription groups (regardless of tag)
            const targetGroups = this.findTargetGroupsForUser(accountUid, follower, activeGroups)
            if (targetGroups.length > 0) {
                uidSet.add(fid)
            }
        }

        return Array.from(uidSet)
    },

    findTargetGroupSourceMapForUser(accountUid, follower, activeGroups = null) {
        const targetMap = new Map()
        const followerId = subscriptionManager.getFollowerId(follower)
        const followerTags = Array.isArray(follower?.biliGroups)
            ? follower.biliGroups.map(tag => String(tag))
            : []

        // 1. Find all groups bound to this account (Cookie Sync)
        for (const [gid, uid] of Object.entries(subscriptionManager.groupToAccountMap)) {
            if (uid !== String(accountUid)) continue

            // Filter out inactive groups
            if (activeGroups && !activeGroups.has(gid)) continue

            // Check if sync enabled
            if (!config.getGroupConfig(gid, 'enableCookieSync')) continue

            // Check Tag filtering
            let allowedTags = config.getGroupConfig(gid, 'cookieSyncGroupNames')
            if (typeof allowedTags === 'string') {
                allowedTags = allowedTags.split(',').map(s => s.trim()).filter(Boolean)
            }
            if (!Array.isArray(allowedTags)) {
                allowedTags = []
            }
            if (allowedTags.length > 0) {
                const hasTag = allowedTags.some(tag => followerTags.includes(tag))
                if (!hasTag) continue
            }

            this.mergeGroupSourceMap(targetMap, gid, ['cookieSync'])
        }

        // 2. Find manual subscriptions for this user (Group Subscription)
        // Even if the group didn't enable sync, if they manually subscribed, they should get it.
        // And since we are in the Feed flow, we know this user updated.
        const manualSub = subscriptionManager.userSubs.find(s => String(s.uid) === followerId)
        if (manualSub) {
            manualSub.groupIds.forEach(gid => {
                // Filter out inactive groups
                if (activeGroups && !activeGroups.has(String(gid))) return
                this.mergeGroupSourceMap(targetMap, gid, ['manual'])
            })
        }

        return targetMap
    },

    findTargetGroupsForUser(accountUid, follower, activeGroups = null) {
        const sourceMap = this.findTargetGroupSourceMapForUser(accountUid, follower, activeGroups)
        return this.getGroupIdsFromSourceMap(sourceMap)
    }
}
