const fs = require('fs')
const path = require('path')

const CONFIG_DIR = path.join(__dirname, '../../config')
const QQ_OFFICIAL_SECRET_PATH = path.join(CONFIG_DIR, '.qqOfficialClientSecret')
let qqOfficialSecretPathOverride = ''

function getQqOfficialClientSecretPath() {
    return qqOfficialSecretPathOverride || QQ_OFFICIAL_SECRET_PATH
}

function setQqOfficialClientSecretPathForTest(filePath = '') {
    qqOfficialSecretPathOverride = String(filePath || '')
}

function readQqOfficialClientSecret() {
    const secretPath = getQqOfficialClientSecretPath()
    try {
        if (!fs.existsSync(secretPath)) return ''
        return fs.readFileSync(secretPath, 'utf8').trim()
    } catch {
        return ''
    }
}

function writeQqOfficialClientSecret(secret) {
    const value = String(secret || '').trim()
    if (!value) return false
    const secretPath = getQqOfficialClientSecretPath()
    fs.mkdirSync(path.dirname(secretPath), { recursive: true })
    fs.writeFileSync(secretPath, `${value}\n`, { mode: 0o600 })
    try {
        fs.chmodSync(secretPath, 0o600)
    } catch {}
    return true
}

module.exports = {
    QQ_OFFICIAL_SECRET_PATH,
    getQqOfficialClientSecretPath,
    setQqOfficialClientSecretPathForTest,
    readQqOfficialClientSecret,
    writeQqOfficialClientSecret
}
