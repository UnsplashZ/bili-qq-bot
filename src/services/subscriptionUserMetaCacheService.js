const path = require('path')
const biliApi = require('./biliApi')
const logger = require('../utils/logger')
const storageUtils = require('../utils/storageUtils')

const COMPARE_WINDOW_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 2500
const RETRY_BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]
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

class SubscriptionUserMetaCacheService {
    constructor() {
        this.cacheFile = CACHE_FILE
        this.records = new Map()
        this._loaded = false
        this._loadingPromise = null
        this._savePromise = null
        this._saveScheduled = false
        this._inFlight = new Map()
        this._comparedInProcess = new Set()
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
        const face = normalizeFace(record?.face || safeSub.face || safeSub.avatar)
        const officialVerify =
            normalizeOfficialVerify(record?.officialVerify) ||
            extractOfficialVerify(safeSub)

        return {
            ...safeSub,
            uid,
            name,
            ...(face ? { face } : {}),
            ...(officialVerify ? { officialVerify } : {})
        }
    }

    _shouldCompare(uid, record, now, forceCompare) {
        if (forceCompare) return true

        if (!this._comparedInProcess.has(uid)) return true
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
            this._comparedInProcess.add(uid)
            return this._buildResultFromSources(baseSub, existing, uid)
        }

        const info = await biliApi.getUserInfo(uid, groupId, true, {
            timeoutMs: FETCH_TIMEOUT_MS
        })
        this._comparedInProcess.add(uid)

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

        const existingFlight = this._inFlight.get(uid)
        if (existingFlight) {
            return existingFlight
        }

        const task = this._compareAndUpdate(
            uid,
            groupId,
            sub,
            Boolean(options.forceCompare)
        ).finally(() => {
            this._inFlight.delete(uid)
        })

        this._inFlight.set(uid, task)
        return task
    }

    async enrichSubscriptions(users, groupId) {
        const safeUsers = Array.isArray(users) ? users : []
        if (safeUsers.length === 0) return []
        await this.ensureLoaded()

        return Promise.all(
            safeUsers.map(sub => this.enrichSubscription(sub, groupId))
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
