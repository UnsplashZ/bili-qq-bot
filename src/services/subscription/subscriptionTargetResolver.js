const { normalizeSourceList } = require('./updateChecker/helpers/sourceMap')

function normalizeId(value) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

function cloneSourceMap(sourceMap) {
    const cloned = new Map()
    if (!(sourceMap instanceof Map)) return cloned
    for (const [groupId, sources] of sourceMap.entries()) {
        const gid = normalizeId(groupId)
        if (!gid) continue
        const sourceSet = new Set(normalizeSourceList(Array.from(sources || [])))
        if (sourceSet.size > 0) {
            cloned.set(gid, sourceSet)
        }
    }
    return cloned
}

class SubscriptionTargetResolver {
    constructor({ subscriptionManager, config }) {
        this.subscriptionManager = subscriptionManager
        this.config = config
    }

    mergeGroupSourceMap(targetMap, groupId, sources) {
        const gid = normalizeId(groupId)
        if (!gid) return
        const sourceList = normalizeSourceList(sources)
        const fallbackSources = sourceList.length > 0 ? sourceList : ['manual']

        if (!targetMap.has(gid)) {
            targetMap.set(gid, new Set(fallbackSources))
            return
        }

        const existing = targetMap.get(gid)
        fallbackSources.forEach(source => existing.add(source))
    }

    toGroupSourceMap(target) {
        return cloneSourceMap(target?.targetGroupSourceMap)
    }

    getFollowerId(follower) {
        if (typeof this.subscriptionManager.getFollowerId === 'function') {
            return normalizeId(this.subscriptionManager.getFollowerId(follower))
        }
        return normalizeId(follower?.mid ?? follower?.uid)
    }

    getFollowerTags(follower) {
        if (!Array.isArray(follower?.biliGroups)) return []
        return follower.biliGroups.map(tag => normalizeId(tag)).filter(Boolean)
    }

    getAllowedTags(groupId) {
        let allowedTags = this.config.getGroupConfig(groupId, 'cookieSyncGroupNames')
        if (typeof allowedTags === 'string') {
            allowedTags = allowedTags.split(',').map(tag => normalizeId(tag)).filter(Boolean)
        } else if (Array.isArray(allowedTags)) {
            allowedTags = allowedTags.map(tag => normalizeId(tag)).filter(Boolean)
        }
        return Array.isArray(allowedTags) ? allowedTags : []
    }

    isActiveGroup(groupId, activeGroups = null) {
        const gid = normalizeId(groupId)
        if (!gid) return false
        return !activeGroups || activeGroups.has(gid)
    }

    isCookieFollowerAllowedForGroup(accountUid, follower, groupId, activeGroups = null) {
        const gid = normalizeId(groupId)
        if (!gid || !this.isActiveGroup(gid, activeGroups)) return false
        if (normalizeId((this.subscriptionManager.groupToAccountMap || {})[gid]) !== normalizeId(accountUid)) return false
        if (!this.config.getGroupConfig(gid, 'enableCookieSync')) return false

        const allowedTags = this.getAllowedTags(gid)
        if (allowedTags.length === 0) return true

        const followerTags = this.getFollowerTags(follower)
        return allowedTags.some(tag => followerTags.includes(tag))
    }

    resolveForFollower(accountUid, follower, activeGroups = null) {
        const targetMap = new Map()
        const followerId = this.getFollowerId(follower)
        if (!followerId) return targetMap

        for (const groupId of Object.keys(this.subscriptionManager.groupToAccountMap || {})) {
            if (this.isCookieFollowerAllowedForGroup(accountUid, follower, groupId, activeGroups)) {
                this.mergeGroupSourceMap(targetMap, groupId, ['cookieSync'])
            }
        }

        const manualSub = (this.subscriptionManager.userSubs || []).find(sub => normalizeId(sub?.uid) === followerId)
        if (manualSub) {
            for (const groupId of manualSub.groupIds || []) {
                if (!this.isActiveGroup(groupId, activeGroups)) continue
                this.mergeGroupSourceMap(targetMap, groupId, ['manual'])
            }
        }

        return targetMap
    }

    resolve(activeGroups = null) {
        const targetByUid = new Map()

        const ensureTarget = (uid, seed = {}) => {
            const normalizedUid = normalizeId(uid)
            if (!normalizedUid) return null
            if (!targetByUid.has(normalizedUid)) {
                targetByUid.set(normalizedUid, {
                    uid: normalizedUid,
                    name: seed.name || `User_${normalizedUid}`,
                    targetGroups: [],
                    targetGroupSourceMap: new Map(),
                    source: '',
                    manualSub: null,
                    cookieFollower: null,
                    accountUid: null,
                    cookieTargets: []
                })
            }
            return targetByUid.get(normalizedUid)
        }

        for (const sub of this.subscriptionManager.userSubs || []) {
            const uid = normalizeId(sub?.uid)
            if (!uid) continue
            const target = ensureTarget(uid, { name: sub.name })
            if (!target) continue

            target.manualSub = sub
            if (sub.name) target.name = sub.name
            for (const groupId of sub.groupIds || []) {
                if (!this.isActiveGroup(groupId, activeGroups)) continue
                this.mergeGroupSourceMap(target.targetGroupSourceMap, groupId, ['manual'])
            }
        }

        for (const [accountUid, followers] of Object.entries(this.subscriptionManager.cookieFollowings || {})) {
            for (const follower of followers || []) {
                const uid = this.getFollowerId(follower)
                if (!uid) continue

                const followerSourceMap = this.resolveForFollower(accountUid, follower, activeGroups)
                if (followerSourceMap.size === 0) continue

                const target = ensureTarget(uid, { name: follower.name || follower.uname })
                if (!target) continue

                if (!target.manualSub && (follower.name || follower.uname)) {
                    target.name = follower.name || follower.uname
                }
                if (!target.cookieFollower) {
                    target.cookieFollower = follower
                    target.accountUid = normalizeId(accountUid)
                }
                target.cookieTargets.push({
                    accountUid: normalizeId(accountUid),
                    follower,
                    targetGroupSourceMap: cloneSourceMap(followerSourceMap)
                })

                for (const [groupId, sources] of followerSourceMap.entries()) {
                    this.mergeGroupSourceMap(target.targetGroupSourceMap, groupId, Array.from(sources || []))
                }
            }
        }

        for (const target of targetByUid.values()) {
            target.targetGroups = Array.from(target.targetGroupSourceMap.keys())
            const hasManual = Array.from(target.targetGroupSourceMap.values()).some(sources => sources.has('manual'))
            const hasCookie = Array.from(target.targetGroupSourceMap.values()).some(sources => sources.has('cookieSync'))
            target.source = hasManual && hasCookie ? 'both' : hasCookie ? 'cookie' : 'manual'
        }

        return Array.from(targetByUid.values()).filter(target => target.targetGroups.length > 0)
    }
}

module.exports = SubscriptionTargetResolver
