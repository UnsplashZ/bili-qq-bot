'use strict'

// Deprecated in-memory compatibility shim. Production and tests must not read
// or write .qqOfficialClientSecret; migration code owns explicit legacy reads.

const QQ_OFFICIAL_SECRET_PATH = ''
let compatibilitySecret = ''

function getQqOfficialClientSecretPath() {
    return ''
}

function setQqOfficialClientSecretPathForTest() {
    compatibilitySecret = ''
}

function readQqOfficialClientSecret() {
    return compatibilitySecret
}

function writeQqOfficialClientSecret(secret) {
    const value = String(secret || '').trim()
    if (!value) return false
    compatibilitySecret = value
    return true
}

module.exports = {
    QQ_OFFICIAL_SECRET_PATH,
    getQqOfficialClientSecretPath,
    setQqOfficialClientSecretPathForTest,
    readQqOfficialClientSecret,
    writeQqOfficialClientSecret
}
