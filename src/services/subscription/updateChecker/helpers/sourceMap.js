const { VALID_AT_ALL_SOURCES } = require('../constants')

function normalizeSourceList(value) {
    const list = Array.isArray(value) ? value : [value]
    const normalized = []
    for (const item of list) {
        const source = String(item || '').trim()
        if (!source || !VALID_AT_ALL_SOURCES.has(source)) continue
        if (!normalized.includes(source)) {
            normalized.push(source)
        }
    }
    return normalized
}

module.exports = {
    normalizeSourceList
}
