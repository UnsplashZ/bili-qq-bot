'use strict'

const path = require('path')
const storageUtils = require('../../utils/storageUtils')

const SCHEMA_VERSION = 2
const TARGET_BASELINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CONTENT_TYPES = ['dynamic', 'video', 'article', 'live']

function normalizeId(value) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

function normalizeTimestamp(value) {
    if (value === null || value === undefined || value === '') return null
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeLiveStatus(value) {
    if (value === null || value === undefined || value === '') return null
    if (value === true) return 1
    if (value === false) return 0
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function nowMs() {
    return Date.now()
}

function defaultUserState(uid) {
    return {
        uid,
        dynamic: {
            lastDynamicId: null,
            meta: {}
        },
        video: {
            videoId: null,
            lastCreated: null,
            meta: {}
        },
        article: {
            articleId: null,
            lastPublishTime: null,
            meta: {}
        },
        live: {
            lastStatus: 0,
            roomId: null,
            meta: {}
        },
        targets: {}
    }
}

function compareDynamicIds(nextId, currentId) {
    const next = normalizeId(nextId)
    const current = normalizeId(currentId)

    if (!next) return 0
    if (!current) return 1

    try {
        const nextBigInt = BigInt(next)
        const currentBigInt = BigInt(current)
        if (nextBigInt > currentBigInt) return 1
        if (nextBigInt < currentBigInt) return -1
        return 0
    } catch {
        const width = Math.max(next.length, current.length)
        const paddedNext = next.padStart(width, '0')
        const paddedCurrent = current.padStart(width, '0')
        if (paddedNext > paddedCurrent) return 1
        if (paddedNext < paddedCurrent) return -1
        return 0
    }
}

class SubscriptionStateStore {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(process.cwd(), 'data')
        this.stateFile = options.stateFile || path.join(this.dataDir, 'subscription_state.json')
        this.schemaVersion = SCHEMA_VERSION

        this.users = {}
        this._loaded = false
        this._loadingPromise = null
        this._writeChain = Promise.resolve()
    }

    async ensureLoaded() {
        if (this._loaded) return
        if (this._loadingPromise) return this._loadingPromise

        this._loadingPromise = this.load()
        try {
            await this._loadingPromise
        } finally {
            this._loadingPromise = null
        }
    }

    async load() {
        const data = await storageUtils.safeReadJSON(this.stateFile, {
            schemaVersion: this.schemaVersion,
            users: {}
        })

        this.users = this._normalizeUsers(data && data.users)
        this._loaded = true
        return this.getSnapshot()
    }

    async reload() {
        this._loaded = false
        this._loadingPromise = null
        return this.load()
    }

    getSnapshot() {
        return {
            schemaVersion: this.schemaVersion,
            users: clone(this.users)
        }
    }

    getUserState(uid) {
        const normalizedUid = normalizeId(uid)
        if (!normalizedUid) return null
        return clone(this.users[normalizedUid] || defaultUserState(normalizedUid))
    }

    async advanceDynamic(uid, id, meta = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const nextId = normalizeId(id)
        if (!normalizedUid || !nextId) {
            return { advanced: false, reason: 'invalid_input', state: null }
        }

        const state = this._ensureUserState(normalizedUid)
        if (compareDynamicIds(nextId, state.dynamic.lastDynamicId) <= 0) {
            return { advanced: false, reason: 'not_newer', state: clone(state) }
        }

        state.dynamic = {
            lastDynamicId: nextId,
            meta: this._mergeMeta(state.dynamic.meta, meta)
        }
        await this.save()
        return { advanced: true, reason: 'advanced', state: clone(state) }
    }

    async advanceVideo(uid, video, meta = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const videoId = normalizeId(video && video.videoId)
        const lastCreated = normalizeTimestamp(video && video.lastCreated)
        if (!normalizedUid || !videoId) {
            return { advanced: false, reason: 'invalid_input', state: null }
        }

        const state = this._ensureUserState(normalizedUid)
        const advanced = this._advanceTimestampState({
            state: state.video,
            idKey: 'videoId',
            timeKey: 'lastCreated',
            nextId: videoId,
            nextTime: lastCreated,
            meta
        })

        if (!advanced) {
            return { advanced: false, reason: 'not_newer', state: clone(state) }
        }

        await this.save()
        return { advanced: true, reason: 'advanced', state: clone(state) }
    }

    async advanceArticle(uid, article, meta = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const articleId = normalizeId(article && article.articleId)
        const lastPublishTime = normalizeTimestamp(article && article.lastPublishTime)
        if (!normalizedUid || !articleId) {
            return { advanced: false, reason: 'invalid_input', state: null }
        }

        const state = this._ensureUserState(normalizedUid)
        const advanced = this._advanceTimestampState({
            state: state.article,
            idKey: 'articleId',
            timeKey: 'lastPublishTime',
            nextId: articleId,
            nextTime: lastPublishTime,
            meta
        })

        if (!advanced) {
            return { advanced: false, reason: 'not_newer', state: clone(state) }
        }

        await this.save()
        return { advanced: true, reason: 'advanced', state: clone(state) }
    }

    async advanceLive(uid, live, meta = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        if (!normalizedUid || !live || typeof live !== 'object') {
            return { advanced: false, reason: 'invalid_input', state: null }
        }

        const nextStatus = normalizeLiveStatus(live.lastStatus)
        const roomId = normalizeId(live.roomId) || null
        const state = this._ensureUserState(normalizedUid)
        const current = state.live

        let changed = false
        if (nextStatus !== null && current.lastStatus !== nextStatus) {
            current.lastStatus = nextStatus
            changed = true
        }
        if (roomId && current.roomId !== roomId) {
            current.roomId = roomId
            changed = true
        }
        if (Object.keys(meta || {}).length > 0) {
            current.meta = this._mergeMeta(current.meta, meta)
            changed = true
        }

        if (!changed) {
            return { advanced: false, reason: 'unchanged', state: clone(state) }
        }

        await this.save()
        return { advanced: true, reason: 'advanced', state: clone(state) }
    }

    async ensureTargetBaseline(uid, groupId, contentType, currentAnchor = {}, options = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const normalizedGroupId = normalizeId(groupId)
        const normalizedType = normalizeId(contentType)
        if (!normalizedUid || !normalizedGroupId || !CONTENT_TYPES.includes(normalizedType)) {
            return { changed: false, reason: 'invalid_input', baseline: null }
        }

        const state = this._ensureUserState(normalizedUid)
        const target = this._ensureTargetState(state, normalizedGroupId)
        const existing = target[normalizedType]
        const baselineSource = options.baselineSource || this._resolveBaselineSource(state, normalizedGroupId)
        const anchor = this._buildTargetBaselineAnchor(normalizedType, currentAnchor)
        const timestamp = normalizeTimestamp(options.now) ?? nowMs()

        if (!existing) {
            target[normalizedType] = this._buildTargetBaselineRecord(normalizedType, anchor, baselineSource, timestamp)
            await this.save()
            return { changed: true, reason: 'created', baseline: clone(target[normalizedType]) }
        }

        let changed = false
        if (options.refreshBaseline === true) {
            changed = this._replaceTargetBaseline(existing, normalizedType, anchor, baselineSource, timestamp)
            if (changed) {
                await this.save()
            }
            return { changed, reason: changed ? 'refreshed' : 'exists', baseline: clone(existing) }
        }
        if (existing.active !== true) {
            existing.active = true
            existing.activatedAt = timestamp
            existing.removedAt = null
            changed = true
        }
        if (!existing.baselineSource) {
            existing.baselineSource = baselineSource
            changed = true
        }
        if (this._mergeMissingBaselineAnchor(existing, normalizedType, anchor)) {
            changed = true
        }

        if (changed) {
            await this.save()
        }
        return { changed, reason: changed ? 'updated' : 'exists', baseline: clone(existing) }
    }

    async ensureTargetBaselines(uid, groupIds, currentState = {}, options = {}) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const normalizedGroups = Array.isArray(groupIds)
            ? groupIds.map(groupId => normalizeId(groupId)).filter(Boolean)
            : []
        if (!normalizedUid || normalizedGroups.length === 0) {
            return { changed: false, state: normalizedUid ? this.getUserState(normalizedUid) : null }
        }

        let changed = false
        const state = this._ensureUserState(normalizedUid)
        const timestamp = normalizeTimestamp(options.now) ?? nowMs()
        const sourceByGroup = new Map()
        const migrateExistingBatch = !this._hasAnyTargetBaseline(state) && this._hasAnyContentAnchor(state)

        for (const groupId of normalizedGroups) {
            const target = this._ensureTargetState(state, groupId)
            if (!sourceByGroup.has(groupId)) {
                sourceByGroup.set(groupId, options.baselineSource || (migrateExistingBatch ? 'existing_target' : this._resolveBaselineSource(state, groupId)))
            }
            const baselineSource = sourceByGroup.get(groupId)

            for (const contentType of CONTENT_TYPES) {
                const anchor = this._buildTargetBaselineAnchor(contentType, currentState)
                const existing = target[contentType]
                if (!existing) {
                    target[contentType] = this._buildTargetBaselineRecord(contentType, anchor, baselineSource, timestamp)
                    changed = true
                    continue
                }

                if (options.refreshBaseline === true) {
                    if (this._replaceTargetBaseline(existing, contentType, anchor, baselineSource, timestamp)) {
                        changed = true
                    }
                    continue
                }

                if (existing.active !== true) {
                    existing.active = true
                    existing.activatedAt = timestamp
                    existing.removedAt = null
                    changed = true
                }
                if (!existing.baselineSource) {
                    existing.baselineSource = baselineSource
                    changed = true
                }
                if (this._mergeMissingBaselineAnchor(existing, contentType, anchor)) {
                    changed = true
                }
            }
        }

        if (changed) {
            await this.save()
        }
        return { changed, state: clone(state) }
    }

    async markTargetInactive(uid, groupId, removedAt = nowMs()) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const normalizedGroupId = normalizeId(groupId)
        if (!normalizedUid || !normalizedGroupId) {
            return { changed: false, reason: 'invalid_input' }
        }

        const state = this.users[normalizedUid]
        const target = state?.targets?.[normalizedGroupId]
        if (!target) return { changed: false, reason: 'not_found' }

        const timestamp = normalizeTimestamp(removedAt) ?? nowMs()
        let changed = false
        for (const contentType of CONTENT_TYPES) {
            if (!target[contentType]) continue
            if (target[contentType].active !== false || target[contentType].removedAt !== timestamp) {
                target[contentType].active = false
                target[contentType].removedAt = timestamp
                changed = true
            }
        }

        if (changed) {
            await this.save()
        }
        return { changed, reason: changed ? 'updated' : 'unchanged' }
    }

    async reactivateTargetBaseline(uid, groupId) {
        await this.ensureLoaded()
        const normalizedUid = normalizeId(uid)
        const normalizedGroupId = normalizeId(groupId)
        if (!normalizedUid || !normalizedGroupId) {
            return { changed: false, reason: 'invalid_input' }
        }

        const state = this.users[normalizedUid]
        const target = state?.targets?.[normalizedGroupId]
        if (!target) return { changed: false, reason: 'not_found' }

        let changed = false
        const timestamp = nowMs()
        for (const contentType of CONTENT_TYPES) {
            if (!target[contentType]) continue
            if (target[contentType].active !== true || target[contentType].removedAt !== null) {
                target[contentType].active = true
                target[contentType].activatedAt = timestamp
                target[contentType].removedAt = null
                changed = true
            }
        }

        if (changed) {
            await this.save()
        }
        return { changed, reason: changed ? 'updated' : 'unchanged' }
    }

    getTargetBaseline(userState, groupId, contentType) {
        const normalizedGroupId = normalizeId(groupId)
        const normalizedType = normalizeId(contentType)
        if (!userState || !normalizedGroupId || !CONTENT_TYPES.includes(normalizedType)) return null
        const baseline = userState.targets?.[normalizedGroupId]?.[normalizedType]
        return baseline && typeof baseline === 'object' ? clone(baseline) : null
    }

    async cleanupInactiveTargetBaselines(now = nowMs(), retentionMs = TARGET_BASELINE_RETENTION_MS) {
        await this.ensureLoaded()
        const cutoff = (normalizeTimestamp(now) ?? nowMs()) - retentionMs
        let removed = 0

        for (const state of Object.values(this.users)) {
            if (!state?.targets) continue
            for (const [groupId, target] of Object.entries(state.targets)) {
                for (const contentType of CONTENT_TYPES) {
                    const baseline = target[contentType]
                    if (!baseline || baseline.active !== false) continue
                    const removedAt = normalizeTimestamp(baseline.removedAt)
                    if (removedAt !== null && removedAt < cutoff) {
                        delete target[contentType]
                        removed += 1
                    }
                }
                if (Object.keys(target).length === 0) {
                    delete state.targets[groupId]
                }
            }
        }

        if (removed > 0) {
            await this.save()
        }
        return { removed }
    }

    async initializeFromLegacy({ userSubs = [], cookieFollowings = {} } = {}) {
        await this.ensureLoaded()

        let changed = false
        const entries = []

        if (Array.isArray(userSubs)) {
            for (const sub of userSubs) {
                entries.push(sub)
            }
        }

        if (cookieFollowings && typeof cookieFollowings === 'object') {
            for (const followers of Object.values(cookieFollowings)) {
                if (!Array.isArray(followers)) continue
                for (const follower of followers) {
                    entries.push(follower)
                }
            }
        }

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue
            const uid = normalizeId(entry.uid || entry.mid || entry.id)
            if (!uid) continue
            const state = this._ensureUserState(uid)

            if (this._mergeLegacyDynamic(state, entry)) changed = true
            if (this._mergeLegacyVideo(state, entry)) changed = true
            if (this._mergeLegacyArticle(state, entry)) changed = true
            if (this._mergeLegacyLive(state, entry)) changed = true
        }

        if (changed) {
            await this.save()
        }

        return { changed, state: this.getSnapshot() }
    }

    async save() {
        const payload = {
            schemaVersion: this.schemaVersion,
            users: this.users
        }

        const next = this._writeChain
            .catch(() => {})
            .then(() => storageUtils.asyncWriteWithBackup(this.stateFile, payload))
        this._writeChain = next
        return next
    }

    _normalizeUsers(rawUsers) {
        if (!rawUsers || typeof rawUsers !== 'object' || Array.isArray(rawUsers)) {
            return {}
        }

        const users = {}
        for (const [uidRaw, rawState] of Object.entries(rawUsers)) {
            const uid = normalizeId(uidRaw)
            if (!uid) continue
            users[uid] = this._normalizeUserState(uid, rawState)
        }
        return users
    }

    _normalizeUserState(uid, rawState) {
        const state = defaultUserState(uid)
        if (!rawState || typeof rawState !== 'object') return state

        const dynamic = rawState.dynamic || {}
        const video = rawState.video || {}
        const article = rawState.article || {}
        const live = rawState.live || {}
        const targets = rawState.targets || {}

        state.dynamic.lastDynamicId = normalizeId(dynamic.lastDynamicId) || null
        state.dynamic.meta = this._normalizeMeta(dynamic.meta)

        state.video.videoId = normalizeId(video.videoId) || null
        state.video.lastCreated = normalizeTimestamp(video.lastCreated)
        state.video.meta = this._normalizeMeta(video.meta)

        state.article.articleId = normalizeId(article.articleId) || null
        state.article.lastPublishTime = normalizeTimestamp(article.lastPublishTime)
        state.article.meta = this._normalizeMeta(article.meta)

        const liveStatus = normalizeLiveStatus(live.lastStatus)
        state.live.lastStatus = liveStatus === null ? 0 : liveStatus
        state.live.roomId = normalizeId(live.roomId) || null
        state.live.meta = this._normalizeMeta(live.meta)
        state.targets = this._normalizeTargetStates(targets)

        return state
    }

    _ensureUserState(uid) {
        if (!this.users[uid]) {
            this.users[uid] = defaultUserState(uid)
        }
        return this.users[uid]
    }

    _normalizeMeta(meta) {
        return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
    }

    _normalizeTargetStates(rawTargets) {
        if (!rawTargets || typeof rawTargets !== 'object' || Array.isArray(rawTargets)) {
            return {}
        }

        const targets = {}
        for (const [groupIdRaw, rawTarget] of Object.entries(rawTargets)) {
            const groupId = normalizeId(groupIdRaw)
            if (!groupId || !rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) continue

            const target = {}
            for (const contentType of CONTENT_TYPES) {
                const baseline = this._normalizeTargetBaseline(contentType, rawTarget[contentType])
                if (baseline) target[contentType] = baseline
            }
            if (Object.keys(target).length > 0) {
                targets[groupId] = target
            }
        }
        return targets
    }

    _normalizeTargetBaseline(contentType, rawBaseline) {
        if (!rawBaseline || typeof rawBaseline !== 'object' || Array.isArray(rawBaseline)) return null
        const baseline = {
            baselineSource: rawBaseline.baselineSource === 'new_target' ? 'new_target' : 'existing_target',
            active: rawBaseline.active !== false,
            activatedAt: normalizeTimestamp(rawBaseline.activatedAt),
            removedAt: normalizeTimestamp(rawBaseline.removedAt)
        }

        if (contentType === 'dynamic') {
            baseline.baselineId = normalizeId(rawBaseline.baselineId) || null
        } else if (contentType === 'video') {
            baseline.baselineId = normalizeId(rawBaseline.baselineId) || null
            baseline.baselineTime = normalizeTimestamp(rawBaseline.baselineTime)
        } else if (contentType === 'article') {
            baseline.baselineId = normalizeId(rawBaseline.baselineId) || null
            baseline.baselineTime = normalizeTimestamp(rawBaseline.baselineTime)
        } else if (contentType === 'live') {
            const status = normalizeLiveStatus(rawBaseline.baselineStatus)
            baseline.baselineStatus = status === null ? null : status
            baseline.baselineRoomId = normalizeId(rawBaseline.baselineRoomId) || null
        }

        return baseline
    }

    _ensureTargetState(state, groupId) {
        if (!state.targets || typeof state.targets !== 'object' || Array.isArray(state.targets)) {
            state.targets = {}
        }
        if (!state.targets[groupId]) {
            state.targets[groupId] = {}
        }
        return state.targets[groupId]
    }

    _resolveBaselineSource(state, groupId) {
        const target = state.targets?.[groupId]
        if (target) {
            const baselines = Object.values(target).filter(Boolean)
            if (baselines.some(baseline => baseline.baselineSource === 'existing_target')) return 'existing_target'
            if (baselines.some(baseline => baseline.baselineSource === 'new_target')) return 'new_target'
        }

        if (!this._hasAnyTargetBaseline(state) && this._hasAnyContentAnchor(state)) {
            return 'existing_target'
        }
        return 'new_target'
    }

    _hasAnyTargetBaseline(state) {
        return Object.values(state.targets || {}).some(targetState =>
            targetState && typeof targetState === 'object' && CONTENT_TYPES.some(contentType => targetState[contentType])
        )
    }

    _hasAnyContentAnchor(state) {
        return Boolean(
            normalizeId(state?.dynamic?.lastDynamicId) ||
            normalizeId(state?.video?.videoId) ||
            normalizeId(state?.article?.articleId) ||
            normalizeLiveStatus(state?.live?.lastStatus) === 1 ||
            normalizeId(state?.live?.roomId)
        )
    }

    _buildTargetBaselineAnchor(contentType, currentState = {}) {
        const state = currentState && typeof currentState === 'object' ? currentState : {}
        if (contentType === 'dynamic') {
            return {
                baselineId: normalizeId(state.dynamic?.lastDynamicId || state.lastDynamicId || state.dynamicId) || null
            }
        }
        if (contentType === 'video') {
            return {
                baselineId: normalizeId(state.video?.videoId || state.lastVideoId || state.videoId) || null,
                baselineTime: normalizeTimestamp(state.video?.lastCreated ?? state.lastVideoCreated ?? state.videoCreated)
            }
        }
        if (contentType === 'article') {
            return {
                baselineId: normalizeId(state.article?.articleId || state.lastArticleId || state.articleId) || null,
                baselineTime: normalizeTimestamp(state.article?.lastPublishTime ?? state.lastArticlePublishTime ?? state.articlePublishTime)
            }
        }
        if (contentType === 'live') {
            const status = normalizeLiveStatus(state.live?.lastStatus ?? state.lastLiveStatus ?? state.liveStatus)
            return {
                baselineStatus: status === null ? null : status,
                baselineRoomId: normalizeId(state.live?.roomId || state.roomId || state.lastRoomId) || null
            }
        }
        return {}
    }

    _buildTargetBaselineRecord(contentType, anchor, baselineSource, timestamp) {
        const record = {
            baselineSource,
            active: true,
            activatedAt: timestamp,
            removedAt: null
        }

        if (contentType === 'dynamic') {
            record.baselineId = anchor.baselineId || null
        } else if (contentType === 'video') {
            record.baselineId = anchor.baselineId || null
            record.baselineTime = normalizeTimestamp(anchor.baselineTime)
        } else if (contentType === 'article') {
            record.baselineId = anchor.baselineId || null
            record.baselineTime = normalizeTimestamp(anchor.baselineTime)
        } else if (contentType === 'live') {
            const status = normalizeLiveStatus(anchor.baselineStatus)
            record.baselineStatus = status === null ? null : status
            record.baselineRoomId = anchor.baselineRoomId || null
        }

        return record
    }

    _replaceTargetBaseline(existing, contentType, anchor, baselineSource, timestamp) {
        const next = this._buildTargetBaselineRecord(contentType, anchor, baselineSource, timestamp)
        let changed = false

        for (const key of Object.keys(existing)) {
            if (!(key in next)) {
                delete existing[key]
                changed = true
            }
        }
        for (const [key, value] of Object.entries(next)) {
            if (existing[key] !== value) {
                existing[key] = value
                changed = true
            }
        }

        return changed
    }

    _mergeMissingBaselineAnchor(existing, contentType, anchor) {
        let changed = false
        if ((contentType === 'dynamic' || contentType === 'video' || contentType === 'article') && !existing.baselineId && anchor.baselineId) {
            existing.baselineId = anchor.baselineId
            changed = true
        }
        if ((contentType === 'video' || contentType === 'article') && existing.baselineTime === null && anchor.baselineTime !== null) {
            existing.baselineTime = anchor.baselineTime
            changed = true
        }
        if (contentType === 'live') {
            if (existing.baselineStatus === null && anchor.baselineStatus !== null) {
                existing.baselineStatus = anchor.baselineStatus
                changed = true
            }
            if (!existing.baselineRoomId && anchor.baselineRoomId) {
                existing.baselineRoomId = anchor.baselineRoomId
                changed = true
            }
        }
        return changed
    }

    _mergeMeta(current, next) {
        return {
            ...this._normalizeMeta(current),
            ...this._normalizeMeta(next)
        }
    }

    _advanceTimestampState({ state, idKey, timeKey, nextId, nextTime, meta }) {
        const currentTime = normalizeTimestamp(state[timeKey])
        const currentId = normalizeId(state[idKey])

        if (nextTime === null) {
            if (currentId) return false
            state[idKey] = nextId
            state[timeKey] = null
            state.meta = this._mergeMeta(state.meta, {
                legacyMissingTimestamp: true,
                replayGuard: true,
                ...meta
            })
            return true
        }

        if (currentTime !== null && nextTime <= currentTime) {
            return false
        }

        state[idKey] = nextId
        state[timeKey] = nextTime
        state.meta = this._mergeMeta(state.meta, meta)
        return true
    }

    _mergeLegacyDynamic(state, entry) {
        const dynamicId = normalizeId(entry.lastDynamicId)
        if (!dynamicId || compareDynamicIds(dynamicId, state.dynamic.lastDynamicId) <= 0) {
            return false
        }

        state.dynamic = {
            lastDynamicId: dynamicId,
            meta: this._mergeMeta(state.dynamic.meta, { source: 'legacy' })
        }
        return true
    }

    _mergeLegacyVideo(state, entry) {
        const videoId = normalizeId(entry.lastVideoId)
        if (!videoId) return false

        return this._advanceTimestampState({
            state: state.video,
            idKey: 'videoId',
            timeKey: 'lastCreated',
            nextId: videoId,
            nextTime: normalizeTimestamp(entry.lastVideoCreated),
            meta: { source: 'legacy' }
        })
    }

    _mergeLegacyArticle(state, entry) {
        const articleId = normalizeId(entry.lastArticleId)
        if (!articleId) return false

        return this._advanceTimestampState({
            state: state.article,
            idKey: 'articleId',
            timeKey: 'lastPublishTime',
            nextId: articleId,
            nextTime: normalizeTimestamp(entry.lastArticlePublishTime),
            meta: { source: 'legacy' }
        })
    }

    _mergeLegacyLive(state, entry) {
        const status = normalizeLiveStatus(entry.lastLiveStatus)
        const roomId = normalizeId(entry.roomId) || null
        if (status === null && !roomId) return false

        let changed = false
        if (status !== null) {
            const currentStatus = normalizeLiveStatus(state.live.lastStatus) ?? 0
            if (currentStatus !== 1 || status === 1) {
                if (currentStatus !== status) {
                    state.live.lastStatus = status
                    changed = true
                }
            }
        }

        if (roomId && !state.live.roomId) {
            state.live.roomId = roomId
            changed = true
        }

        if (status === 1) {
            const nextMeta = this._mergeMeta(state.live.meta, {
                source: 'legacy',
                needsConfirm: true
            })
            if (
                state.live.meta.source !== nextMeta.source ||
                state.live.meta.needsConfirm !== nextMeta.needsConfirm
            ) {
                state.live.meta = nextMeta
                changed = true
            }
        } else if (changed) {
            state.live.meta = this._mergeMeta(state.live.meta, { source: 'legacy' })
        }

        return changed
    }
}

const subscriptionStateStore = new SubscriptionStateStore()

module.exports = subscriptionStateStore
module.exports.SubscriptionStateStore = SubscriptionStateStore
module.exports.compareDynamicIds = compareDynamicIds
