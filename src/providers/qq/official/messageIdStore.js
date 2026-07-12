function clone(value) {
    if (value === undefined) return undefined
    try { return structuredClone(value) } catch {}
    try { return JSON.parse(JSON.stringify(value)) } catch {}
    return value
}

class OfficialMessageIdStore {
    constructor(options = {}) {
        this.maxSize = Math.max(100, Number(options.maxSize || 5000))
        this.records = new Map()
        this.seqByTarget = new Map()
        this._dirtyRecords = new Set()
        this._dirtySequences = new Set()
        this._isFork = Boolean(options.isFork)
        this._committed = false
        if (options.snapshot) this._restoreSnapshot(options.snapshot)
    }

    snapshot() {
        return {
            maxSize: this.maxSize,
            records: [...this.records.entries()].map(([key, value]) => [key, clone(value)]),
            seqByTarget: [...this.seqByTarget.entries()]
        }
    }

    _restoreSnapshot(snapshot) {
        this.maxSize = Math.max(100, Number(snapshot?.maxSize || this.maxSize))
        this.records = new Map((snapshot?.records || []).map(([key, value]) => [String(key), clone(value)]))
        this.seqByTarget = new Map((snapshot?.seqByTarget || []).map(([key, value]) => [String(key), Number(value)]))
    }

    restoreSnapshot(snapshot) {
        this._restoreSnapshot(snapshot)
        this._dirtyRecords.clear()
        this._dirtySequences.clear()
        return this
    }

    fork() {
        return new OfficialMessageIdStore({ snapshot: this.snapshot(), isFork: true })
    }

    commitFrom(candidate) {
        if (!(candidate instanceof OfficialMessageIdStore) || !candidate._isFork) {
            throw new TypeError('OfficialMessageIdStore commit source must be a fork')
        }
        if (candidate._committed) return this
        for (const key of candidate._dirtyRecords) {
            const value = candidate.records.get(key)
            if (value === undefined) this.records.delete(key)
            else this.records.set(key, clone(value))
        }
        for (const key of candidate._dirtySequences) {
            const candidateSeq = Number(candidate.seqByTarget.get(key) || 0)
            const canonicalSeq = Number(this.seqByTarget.get(key) || 0)
            this.seqByTarget.set(key, Math.max(canonicalSeq, candidateSeq))
        }
        while (this.records.size > this.maxSize) {
            const firstKey = this.records.keys().next().value
            this.records.delete(firstKey)
        }
        candidate._committed = true
        return this
    }

    makeInternalId(record = {}) {
        return String(record.internalMessageId || record.messageId || record.id || `qqmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    }

    record(record = {}) {
        const internalMessageId = this.makeInternalId(record)
        const next = {
            internalMessageId,
            officialMessageId: String(record.officialMessageId || record.messageId || record.id || ''),
            targetType: record.targetType || '',
            targetId: String(record.targetId || ''),
            msgSeq: record.msgSeq ?? null,
            eventId: record.eventId || '',
            createdAt: record.createdAt || Date.now(),
            raw: record.raw || null
        }
        this.records.set(internalMessageId, next)
        this._dirtyRecords.add(internalMessageId)
        if (next.officialMessageId && next.officialMessageId !== internalMessageId) {
            this.records.set(next.officialMessageId, next)
            this._dirtyRecords.add(next.officialMessageId)
        }
        while (this.records.size > this.maxSize) {
            const firstKey = this.records.keys().next().value
            this.records.delete(firstKey)
        }
        return next
    }

    resolve(messageId) {
        const key = String(messageId || '').trim()
        if (!key) return null
        return this.records.get(key) || {
            internalMessageId: key,
            officialMessageId: key,
            targetType: '',
            targetId: '',
            msgSeq: null,
            eventId: '',
            createdAt: 0
        }
    }

    nextSeq(targetType, targetId) {
        const key = `${targetType}:${targetId}`
        const next = (this.seqByTarget.get(key) || 0) + 1
        const normalized = next > 1000000 ? 1 : next
        this.seqByTarget.set(key, normalized)
        this._dirtySequences.add(key)
        return normalized
    }

    getStatus() {
        return {
            recordCount: this.records.size,
            targetCount: this.seqByTarget.size
        }
    }
}

module.exports = OfficialMessageIdStore
