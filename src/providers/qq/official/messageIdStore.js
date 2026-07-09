class OfficialMessageIdStore {
    constructor(options = {}) {
        this.maxSize = Math.max(100, Number(options.maxSize || 5000))
        this.records = new Map()
        this.seqByTarget = new Map()
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
        if (next.officialMessageId && next.officialMessageId !== internalMessageId) {
            this.records.set(next.officialMessageId, next)
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
