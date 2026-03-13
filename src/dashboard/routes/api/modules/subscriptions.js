const express = require('express')
const logger = require('../../../../utils/logger')
const sysConfig = require('../../../../config')
const subscriptionService = require('../../../../services/subscriptionService')
const subscriptionUserMetaCacheService = require('../../../../services/subscriptionUserMetaCacheService')
const {
    normalizeSyncGroupNames,
    extractFollowerUid,
    resolveFollowerName
} = require('../shared/normalize')
const { assertWebuiManageableGroup } = require('../shared/group-guard')
const { dashLog } = require('../shared/logging')

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
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const subs = await subscriptionService.getSubscriptionsByGroup(groupId)
        const enrichedUsers = await subscriptionUserMetaCacheService.enrichSubscriptions(
            subs.users,
            groupId
        )
        const mergedSubs = [
            ...enrichedUsers.map(u => ({ ...u, type: 'user', value: u.uid })),
            ...(subs.bangumis || []).map(b => ({
                ...b,
                type: 'bangumi',
                value: b.seasonId
            }))
        ]
        dashLog(req, 'info', 'subscriptions-fetched', {
            groupId,
            count: mergedSubs.length
        })
        res.json(mergedSubs)
    } catch (error) {
        dashLog(req, 'error', 'subscriptions-fetch-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to fetch subscriptions' })
    }
})

// GET /api/groups/:id/atall-targets - Get source user lists for @all fine-grained settings
router.get('/groups/:id/atall-targets', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const groupIdStr = String(groupId)

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

        dashLog(req, 'info', 'subscription-atall-targets-fetched', {
            groupId,
            manualCount: manualUsers.length,
            cookieCount: cookieUsers.length,
            syncGroupCount: syncGroupNames.length
        })
        return res.json({
            manualUsers,
            cookieUsers,
            syncGroupNames
        })
    } catch (error) {
        dashLog(req, 'error', 'subscription-atall-targets-fetch-failed', {
            groupId: req.params.id,
            error: logger.getErrorMessage(error)
        })
        return res.status(500).json({ error: 'Failed to fetch @all target lists' })
    }
})

// POST /api/groups/:id/subscriptions - Add a subscription
router.post('/groups/:id/subscriptions', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
        const { type, value } = req.body
        const normalized = normalizeSubscriptionInput(type, value)
        if (!normalized.ok) return res.status(400).json({ error: normalized.error })

        let resultName
        if (normalized.type === 'user') {
            resultName = await subscriptionService.addUserSubscription(normalized.value, groupId)
            subscriptionUserMetaCacheService
                .preheat(normalized.value, groupId)
                .catch(error => {
                    dashLog(req, 'warn', 'subscription-preheat-failed', {
                        groupId,
                        uid: normalized.value,
                        error: logger.getErrorMessage(error)
                    })
                })
        } else if (normalized.type === 'bangumi') {
            resultName = await subscriptionService.addBangumiSubscription(
                normalized.value,
                groupId
            )
        }

        dashLog(req, 'info', 'subscription-added', {
            groupId,
            subscriptionType: normalized.type,
            targetId: normalized.value
        })
        res.json({ message: 'Subscription added', name: resultName })
    } catch (error) {
        dashLog(req, 'error', 'subscription-add-failed', {
            groupId: req.params.id,
            subscriptionType: req.body && req.body.type,
            targetId: req.body && req.body.value,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: error.message || 'Failed to add subscription' })
    }
})

// DELETE /api/groups/:id/subscriptions - Remove a subscription
router.delete('/groups/:id/subscriptions', async (req, res) => {
    try {
        const guarded = assertWebuiManageableGroup(req, res, sysConfig, {
            paramName: 'id',
            requireInGroup: true
        })
        if (!guarded) return
        const groupId = guarded.groupId
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
            dashLog(req, 'info', 'subscription-removed', {
                groupId,
                subscriptionType: normalized.type,
                targetId: normalized.value
            })
            res.json({ message: 'Subscription removed' })
        } else {
            dashLog(req, 'warn', 'subscription-remove-miss', {
                groupId,
                subscriptionType: normalized.type,
                targetId: normalized.value
            })
            res.status(404).json({ error: 'Subscription not found' })
        }
    } catch (error) {
        dashLog(req, 'error', 'subscription-remove-failed', {
            groupId: req.params.id,
            subscriptionType: req.body && req.body.type,
            targetId: req.body && req.body.value,
            error: logger.getErrorMessage(error)
        })
        res.status(500).json({ error: 'Failed to remove subscription' })
    }
})

module.exports = router
