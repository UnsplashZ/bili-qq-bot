const path = require('path')
const biliApi = require('./biliApi')
const logger = require('../utils/logger')
const storageUtils = require('../utils/storageUtils')

const COMPARE_WINDOW_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 2500
const RETRY_BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]
const DEFAULT_RECORD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_RECORDS = 5000
const DEFAULT_AVATAR_URL = 'https://i0.hdslb.com/bfs/face/member/noface.jpg'
const ENRICH_CONCURRENCY_LIMIT = 3
const CACHE_FILE = path.join(
    process.cwd(),
    'data',
    'subscription_user_meta_cache.json'
)

function normalizeUid(uid) {
    const value = String(uid || '').trim()
    return /^\d+$/.test(value) ? value : ''
}

function normalizeFace(raw) {
    const value = String(raw || '').trim()
    return value || ''
}

function resolveDisplayFace(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeFace(candidate)
        if (normalized) return normalized
    }
    return DEFAULT_AVATAR_URL
}

function normalizeName(raw, uid) {
    const value = String(raw || '').trim()
    if (value) return value
    return uid ? `UID_${uid}` : ''
}

function normalizeOfficialVerify(raw) {
    if (!raw || typeof raw !== 'object') return null

    const type = Number(raw.type)
    if (!Number.isFinite(type) || ![0, 1].includes(type)) return null

    return {
        type,
        desc: String(raw.desc || raw.title || '').trim()
    }
}

function extractOfficialVerify(data) {
    if (!data || typeof data !== 'object') return null

    const direct = normalizeOfficialVerify(data.officialVerify || data.official_verify)
    if (direct) return direct

    const dynamicVerify = normalizeOfficialVerify(
        data.dynamic?.modules?.module_author?.official_verify
    )
    if (dynamicVerify) return dynamicVerify

    return null
}

function isOfficialVerifyEqual(a, b) {
    const left = normalizeOfficialVerify(a)
    const right = normalizeOfficialVerify(b)

    if (!left && !right) return true
    if (!left || !right) return false

    return left.type === right.type && left.desc === right.desc
}

async function mapWithConcurrency(items, limit, mapper) {
    const safeItems = Array.isArray(items) ? items : []
    if (safeItems.length === 0) return []

    const maxConcurrency = Math.max(1, Number(limit) || 1)
    const results = new Array(safeItems.length)
    let nextIndex = 0

    async function worker() {
        while (nextIndex < safeItems.length) {
            const currentIndex = nextIndex
            nextIndex += 1
            results[currentIndex] = await mapper(safeItems[currentIndex], currentIndex)
        }
    }

    const workers = []
    const workerCount = Math.min(maxConcurrency, safeItems.length)
    for (let i = 0; i < workerCount; i += 1) {
        workers.push(worker())
    }
    await Promise.all(workers)
    return results
}

class SubscriptionUserMetaCacheService {
    constructor() {
        this.cacheFile = CACHE_FILE
        this.records = new Map()
        this._loaded = false
        this._loadingPromise = null
        this._savePromise = null
        this._saveScheduled = false
        this._inFlight = new Map()
        this._comparedInProcess = new Map()
        this.recordRetentionMs = DEFAULT_RECORD_RETENTION_MS
        this.maxRecords = DEFAULT_MAX_RECORDS
    }

    async ensureLoaded() {
        if (this._loaded) return
        if (this._loadingPromise) return this._loadingPromise

        this._loadingPromise = (async () => {
            const raw = await storageUtils.safeReadJSON(this.cacheFile, {})
            const records = raw && typeof raw === 'object' && raw.records && typeof raw.records === 'object'
                ? raw.records
                : {}

            this.records.clear()
            for (const [uid, record] of Object.entries(records)) {
                const safeUid = normalizeUid(uid)
                if (!safeUid) continue
                const normalized = this._normalizeRecord(record, safeUid)
                if (!normalized) continue
                this.records.set(safeUid, normalized)
            }
            const loadedCount = this.records.size
            this._cleanupStaleRecords(Date.now())
            if (this.records.size !== loadedCount) {
                this._scheduleSave()
            }
            this._loaded = true
        })().catch(error => {
            this._loadingPromise = null
            throw error
        })

        return this._loadingPromise
    }

    _normalizeRecord(raw, uid) {
        if (!raw || typeof raw !== 'object') return null

        const safeUid = normalizeUid(raw.uid || uid)
        if (!safeUid) return null

        const parsedLastComparedAt = Number(raw.lastComparedAt)
        const parsedLastChangedAt = Number(raw.lastChangedAt)
        const parsedNextRetryAt = Number(raw.nextRetryAt)
        const parsedFailCount = Number(raw.failCount)

        return {
            uid: safeUid,
            name: normalizeName(raw.name, safeUid),
            face: normalizeFace(raw.face),
            officialVerify: normalizeOfficialVerify(raw.officialVerify),
            lastComparedAt: Number.isFinite(parsedLastComparedAt) ? parsedLastComparedAt : 0,
            lastChangedAt: Number.isFinite(parsedLastChangedAt) ? parsedLastChangedAt : 0,
            nextRetryAt: Number.isFinite(parsedNextRetryAt) ? parsedNextRetryAt : 0,
            failCount: Number.isFinite(parsedFailCount) && parsedFailCount > 0
                ? Math.trunc(parsedFailCount)
                : 0
        }
    }

    _toPersistedRecord(record) {
        return {
            uid: record.uid,
            name: normalizeName(record.name, record.uid),
            face: normalizeFace(record.face),
            officialVerify: normalizeOfficialVerify(record.officialVerify),
            lastComparedAt: Number(record.lastComparedAt) || 0,
            lastChangedAt: Number(record.lastChangedAt) || 0,
            nextRetryAt: Number(record.nextRetryAt) || 0,
            failCount: Number(record.failCount) || 0
        }
    }

    _scheduleSave() {
        if (this._saveScheduled) return
        this._saveScheduled = true
        this._savePromise = new Promise(resolve => {
            setTimeout(async () => {
                this._saveScheduled = false
                try {
                    await this._saveNow()
                } catch (error) {
                    logger.error('[SubscriptionUserMetaCache] Failed to save cache:', error)
                } finally {
                    resolve()
                }
            }, 120)
        })
    }

    async _saveNow() {
        this._cleanupStaleRecords(Date.now())
        const records = {}
        for (const [uid, record] of this.records.entries()) {
            records[uid] = this._toPersistedRecord(record)
        }
        await storageUtils.asyncWriteWithBackup(this.cacheFile, {
            version: 1,
            compareWindowMs: COMPARE_WINDOW_MS,
            updatedAt: Date.now(),
            records
        })
    }

    _buildResultFromSources(sub, record, uid) {
        const safeSub = sub && typeof sub === 'object' ? sub : {}
        const baseName = normalizeName(safeSub.name, uid)
        const name = normalizeName(record?.name || baseName, uid)
        const face = resolveDisplayFace(record?.face, safeSub.face, safeSub.avatar)
        const officialVerify =
            normalizeOfficialVerify(record?.officialVerify) ||
            extractOfficialVerify(safeSub)

        return {
            ...safeSub,
            uid,
            name,
            face,
            ...(officialVerify ? { officialVerify } : {})
        }
    }

    _getRecordActivityAt(record) {
        if (!record || typeof record !== 'object') return 0
        return Math.max(
            Number(record.lastComparedAt) || 0,
            Number(record.lastChangedAt) || 0,
            Number(record.nextRetryAt) || 0
        )
    }

    _cleanupStaleRecords(now = Date.now()) {
        const retentionMs = Number(this.recordRetentionMs)
        const maxRecords = Number(this.maxRecords)
        const applyRetention = Number.isFinite(retentionMs) && retentionMs > 0

        if (applyRetention) {
            for (const [uid, record] of this.records.entries()) {
                const activityAt = this._getRecordActivityAt(record)
                if (activityAt > 0 && now - activityAt > retentionMs) {
                    this.records.delete(uid)
                }
            }
        }

        if (!Number.isFinite(maxRecords) || maxRecords <= 0 || this.records.size <= maxRecords) {
            return
        }

        const ranked = Array.from(this.records.entries()).sort((a, b) => {
            const diff = this._getRecordActivityAt(b[1]) - this._getRecordActivityAt(a[1])
            if (diff !== 0) return diff
            return String(a[0]).localeCompare(String(b[0]))
        })
        const keep = new Set(ranked.slice(0, maxRecords).map(([uid]) => uid))
        for (const uid of this.records.keys()) {
            if (!keep.has(uid)) {
                this.records.delete(uid)
            }
        }
    }

    _normalizeGroupScope(groupId) {
        const scope = String(groupId || '').trim()
        return scope || 'global'
    }

    _buildInFlightKey(uid, groupId) {
        return `${uid}:${this._normalizeGroupScope(groupId)}`
    }

    _cleanupComparedInProcess(now = Date.now()) {
        for (const [uid, comparedAt] of this._comparedInProcess.entries()) {
            if (!Number.isFinite(comparedAt) || now - comparedAt >= COMPARE_WINDOW_MS) {
                this._comparedInProcess.delete(uid)
            }
        }
    }

    _markComparedInProcess(uid, now = Date.now()) {
        this._cleanupComparedInProcess(now)
        this._comparedInProcess.set(uid, now)
    }

    _hasComparedInProcess(uid, now = Date.now()) {
        const comparedAt = this._comparedInProcess.get(uid)
        if (!Number.isFinite(comparedAt)) return false
        if (now - comparedAt >= COMPARE_WINDOW_MS) {
            this._comparedInProcess.delete(uid)
            return false
        }
        return true
    }

    _shouldCompare(uid, record, now, forceCompare) {
        if (forceCompare) return true

        if (!this._hasComparedInProcess(uid, now)) return true
        if (!record) return true
        if (!record.lastComparedAt) return true

        return now - record.lastComparedAt >= COMPARE_WINDOW_MS
    }

    _getRetryDelayMs(failCount) {
        const index = Math.max(0, Math.min(RETRY_BACKOFF_MS.length - 1, failCount))
        return RETRY_BACKOFF_MS[index]
    }

    async _compareAndUpdate(uid, groupId, baseSub, forceCompare = false) {
        const existing = this.records.get(uid) || null
        const now = Date.now()
        const shouldCompare = this._shouldCompare(uid, existing, now, forceCompare)

        if (!shouldCompare) {
            return this._buildResultFromSources(baseSub, existing, uid)
        }

        if (
            existing &&
            !forceCompare &&
            existing.nextRetryAt > 0 &&
            now < existing.nextRetryAt
        ) {
            this._markComparedInProcess(uid, now)
            return this._buildResultFromSources(baseSub, existing, uid)
        }

        const info = await biliApi.getUserInfo(uid, groupId, true, {
            timeoutMs: FETCH_TIMEOUT_MS
        })
        this._markComparedInProcess(uid, now)

        if (!info || info.status !== 'success' || !info.data) {
            const failCount = (existing?.failCount || 0) + 1
            const delayMs = this._getRetryDelayMs(failCount - 1)
            const nextRetryAt = now + delayMs
            const fallbackName = normalizeName(existing?.name || baseSub?.name, uid)
            const fallbackFace = normalizeFace(existing?.face || baseSub?.face || baseSub?.avatar)
            const fallbackVerify =
                normalizeOfficialVerify(existing?.officialVerify) ||
                extractOfficialVerify(baseSub)
            const failedRecord = this._normalizeRecord(
                {
                    ...(existing || { uid }),
                    uid,
                    name: fallbackName,
                    face: fallbackFace,
                    officialVerify: fallbackVerify,
                    failCount,
                    nextRetryAt
                },
                uid
            )
            if (failedRecord) {
                this.records.set(uid, failedRecord)
                this._scheduleSave()
            }
            return this._buildResultFromSources(baseSub, failedRecord || existing, uid)
        }

        const latest = info.data
        const nextRecord = this._normalizeRecord(
            {
                ...(existing || { uid }),
                uid,
                name: normalizeName(latest.name || baseSub?.name, uid),
                face: normalizeFace(latest.face),
                officialVerify: extractOfficialVerify(latest),
                lastComparedAt: now,
                failCount: 0,
                nextRetryAt: 0
            },
            uid
        )

        if (!nextRecord) {
            return this._buildResultFromSources(baseSub, existing, uid)
        }

        const nameChanged = normalizeName(existing?.name, uid) !== nextRecord.name
        const faceChanged = normalizeFace(existing?.face) !== nextRecord.face
        const verifyChanged = !isOfficialVerifyEqual(
            existing?.officialVerify,
            nextRecord.officialVerify
        )

        if (!existing || nameChanged || faceChanged || verifyChanged) {
            nextRecord.lastChangedAt = now
        } else {
            nextRecord.lastChangedAt = existing.lastChangedAt || 0
        }

        this.records.set(uid, nextRecord)
        this._scheduleSave()
        return this._buildResultFromSources(baseSub, nextRecord, uid)
    }

    async enrichSubscription(sub, groupId, options = {}) {
        await this.ensureLoaded()
        const uid = normalizeUid(sub?.uid)
        if (!uid) return sub

        const inFlightKey = this._buildInFlightKey(uid, groupId)
        const existingFlight = this._inFlight.get(inFlightKey)
        if (existingFlight) {
            return existingFlight
        }

        const task = this._compareAndUpdate(
            uid,
            groupId,
            sub,
            Boolean(options.forceCompare)
        ).finally(() => {
            this._inFlight.delete(inFlightKey)
        })

        this._inFlight.set(inFlightKey, task)
        return task
    }

    async enrichSubscriptions(users, groupId) {
        const safeUsers = Array.isArray(users) ? users : []
        if (safeUsers.length === 0) return []
        await this.ensureLoaded()

        return mapWithConcurrency(
            safeUsers,
            ENRICH_CONCURRENCY_LIMIT,
            sub => this.enrichSubscription(sub, groupId)
        )
    }

    async preheat(uid, groupId) {
        const safeUid = normalizeUid(uid)
        if (!safeUid) return null
        const baseSub = { uid: safeUid, name: '', face: '', officialVerify: null }
        return this.enrichSubscription(baseSub, groupId, { forceCompare: true })
    }
}

module.exports = new SubscriptionUserMetaCacheService()
