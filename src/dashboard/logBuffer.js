const logger = require('../utils/logger');

const LEVEL_ORDER = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
}

function normalizeLevel(level) {
    const normalized = String(level || 'info').trim().toLowerCase()
    return Object.prototype.hasOwnProperty.call(LEVEL_ORDER, normalized) ? normalized : 'info'
}

function normalizeChannels(channels) {
    if (!channels) return null
    const list = Array.isArray(channels) ? channels : String(channels).split(',')
    const normalized = list
        .map((item) => String(item).trim().toUpperCase())
        .filter(Boolean)
    return normalized.length > 0 ? new Set(normalized) : null
}

function matchesKeyword(event, keyword) {
    if (!keyword) return true
    const normalized = String(keyword).trim().toLowerCase()
    if (!normalized) return true

    const haystack = [
        event.rendered,
        event.message,
        event.action,
        event.scope,
        event.channel,
        event.level,
        event.timestampText,
        JSON.stringify(event.fields || {})
    ].join(' ').toLowerCase()

    return haystack.includes(normalized)
}

function matchesFilters(event, { level, channels, keyword } = {}) {
    const minSeverity = level ? LEVEL_ORDER[normalizeLevel(level)] : null
    const allowedChannels = normalizeChannels(channels)

    if (minSeverity !== null && Number(event.severity || 0) < minSeverity) {
        return false
    }
    if (allowedChannels && !allowedChannels.has(String(event.channel || '').toUpperCase())) {
        return false
    }
    return matchesKeyword(event, keyword)
}

function createLogBuffer({ maxSize } = {}) {
    const capacity = Number.isInteger(maxSize) && maxSize > 0 ? maxSize : logger.parseLoggerEnv().bufferSize
    const entries = []

    return {
        push(event) {
            if (!event || typeof event !== 'object') return
            entries.push({ ...event })
            if (entries.length > capacity) {
                entries.splice(0, entries.length - capacity)
            }
        },
        list({ level, channels, keyword, limit } = {}) {
            const maxItems = Number.isInteger(limit) && limit > 0 ? limit : null

            let result = entries.filter((event) => matchesFilters(event, { level, channels, keyword }))

            if (maxItems !== null && result.length > maxItems) {
                result = result.slice(-maxItems)
            }

            return result.map((event) => ({ ...event }))
        },
        clear() {
            entries.length = 0
        },
        size() {
            return entries.length
        }
    }
}

const logBuffer = createLogBuffer()

module.exports = {
    createLogBuffer,
    logBuffer,
    matchesFilters
}
