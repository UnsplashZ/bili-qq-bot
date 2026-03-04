const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const subscriptionService = require('../../../../services/subscriptionService')
const {
    normalizeGroupId,
    normalizeSyncGroupNames,
    extractFollowerUid,
    resolveFollowerName
} = require('../shared/normalize')

const router = express.Router()

function normalizeSubscriptionInput(type, value) {
    const normalizedType = String(type || '').trim().toLowerCase()
    const normalizedValue = String(value || '').trim()

    if (!normalizedType || !normalizedValue) {
        return { ok: false, error: 'Missing type or value' }
    }

    if (!['user', 'bangumi'].includes(normalizedType)) {
        return {
            ok: false,
            error: 'Invalid subscription type. Must be "user" or "bangumi".'
        }
    }

    if (!/^\d+$/.test(normalizedValue)) {
        return {
            ok: false,
            error: `Invalid ${normalizedType} id: must be numeric`
        }
    }

    return {
        ok: true,
        type: normalizedType,
        value: normalizedValue
    }
}

// GET /api/groups/:id/subscriptions - List subscriptions for a group
router.get('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id)
        const subs = await subscriptionService.getSubscriptionsByGroup(groupId)
        const mergedSubs = [
            ...(subs.users || []).map(u => ({ ...u, type: 'user', value: u.uid })),
            ...(subs.bangumis || []).map(b => ({
                ...b,
                type: 'bangumi',
                value: b.seasonId
            }))
        ]
        res.json(mergedSubs)
    } catch (error) {
        logger.error(`Error fetching subscriptions for group ${req.params.id}:`, error)
        res.status(500).json({ error: 'Failed to fetch subscriptions' })
    }
})

// GET /api/groups/:id/atall-targets - Get source user lists for @all fine-grained settings
router.get('/groups/:id/atall-targets', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id)
        const groupIdStr = String(groupId)
        const groupIdNum = Number(groupIdStr)

        if (
            !global.bot ||
            !global.bot.groupList ||
            (!global.bot.groupList.has(groupIdStr) &&
                !global.bot.groupList.has(groupIdNum))
        ) {
            return res.status(404).json({ error: 'Group not found' })
        }

        const groupConfig =
            (sysConfig.groupConfigs && sysConfig.groupConfigs[groupIdStr]) || {}
        const syncGroupNames = normalizeSyncGroupNames(
            groupConfig.cookieSyncGroupNames
        )

        const subs = await subscriptionService.getSubscriptionsByGroup(groupId)
        const manualUsersRaw = Array.isArray(subs?.users) ? subs.users : []
        const manualUserMap = new Map()
        for (const user of manualUsersRaw) {
            const uid = String(user?.uid || '').trim()
            if (!/^\d+$/.test(uid)) continue
            if (!manualUserMap.has(uid)) {
                const name = String(user?.name || '').trim() || `User_${uid}`
                manualUserMap.set(uid, { uid, name })
            }
        }
        const manualUsers = Array.from(manualUserMap.values()).sort(
            (a, b) => Number(a.uid) - Number(b.uid)
        )

        const followings = await subscriptionService.getFollowingsForGroup(groupId)
        const cookieUsersRaw = Array.isArray(followings) ? followings : []
        const cookieUserMap = new Map()

        for (const follower of cookieUsersRaw) {
            const uid = extractFollowerUid(follower)
            if (!uid) continue

            const biliGroupsRaw = Array.isArray(follower?.biliGroups)
                ? follower.biliGroups
                : []
            const biliGroups = biliGroupsRaw
                .map(v => String(v).trim())
                .filter(Boolean)
            const matchedSyncGroup =
                syncGroupNames.length === 0
                    ? true
                    : biliGroups.some(tag => syncGroupNames.includes(tag))

            if (cookieUserMap.has(uid)) {
                const existing = cookieUserMap.get(uid)
                existing.matchedSyncGroup =
                    existing.matchedSyncGroup || matchedSyncGroup
                if (biliGroups.length > 0) {
                    const merged = new Set([
                        ...(existing.biliGroups || []),
                        ...biliGroups
                    ])
                    existing.biliGroups = Array.from(merged)
                }
                continue
            }

            cookieUserMap.set(uid, {
                uid,
                name: resolveFollowerName(follower, uid),
                biliGroups,
                matchedSyncGroup
            })
        }

        const cookieUsers = Array.from(cookieUserMap.values()).sort(
            (a, b) => Number(a.uid) - Number(b.uid)
        )

        return res.json({
            manualUsers,
            cookieUsers,
            syncGroupNames
        })
    } catch (error) {
        logger.error(`Error fetching @all targets for group ${req.params.id}:`, error)
        return res.status(500).json({ error: 'Failed to fetch @all target lists' })
    }
})

// POST /api/groups/:id/subscriptions - Add a subscription
router.post('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id)
        const { type, value } = req.body
        const normalized = normalizeSubscriptionInput(type, value)
        if (!normalized.ok) return res.status(400).json({ error: normalized.error })

        let resultName
        if (normalized.type === 'user') {
            resultName = await subscriptionService.addUserSubscription(normalized.value, groupId)
        } else if (normalized.type === 'bangumi') {
            resultName = await subscriptionService.addBangumiSubscription(
                normalized.value,
                groupId
            )
        }

        res.json({ message: 'Subscription added', name: resultName })
    } catch (error) {
        logger.error(`Error adding subscription for group ${req.params.id}:`, error)
        res.status(500).json({ error: error.message || 'Failed to add subscription' })
    }
})

// DELETE /api/groups/:id/subscriptions - Remove a subscription
router.delete('/groups/:id/subscriptions', async (req, res) => {
    try {
        const groupId = normalizeGroupId(req.params.id)
        const type = req.body.type || req.query.type
        const value = req.body.value || req.query.value
        const normalized = normalizeSubscriptionInput(type, value)
        if (!normalized.ok) return res.status(400).json({ error: normalized.error })

        let success = false
        if (normalized.type === 'user') {
            success = await subscriptionService.removeUserSubscription(normalized.value, groupId)
        } else if (normalized.type === 'bangumi') {
            success = await subscriptionService.removeBangumiSubscription(
                normalized.value,
                groupId
            )
        }

        if (success) {
            res.json({ message: 'Subscription removed' })
        } else {
            res.status(404).json({ error: 'Subscription not found' })
        }
    } catch (error) {
        logger.error(`Error removing subscription for group ${req.params.id}:`, error)
        res.status(500).json({ error: 'Failed to remove subscription' })
    }
})

module.exports = router
