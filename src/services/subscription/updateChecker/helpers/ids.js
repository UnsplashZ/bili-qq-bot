function toUidString(value) {
    if (value === null || value === undefined) return null
    const uid = String(value).trim()
    if (!/^\d+$/.test(uid)) return null
    return uid
}

module.exports = {
    toUidString
}
