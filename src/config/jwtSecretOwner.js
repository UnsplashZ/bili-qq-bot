const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../utils/logger')

const CONFIG_DIR = path.join(__dirname, '../../config')
const secretPath = path.join(CONFIG_DIR, '.jwtSecret')

let jwtSecretLoadedLogged = false
let jwtSecretGeneratedLogged = false

function authConfigLog(level, message, fields = {}) {
    logger.logEvent(level, 'AUTH', 'svc:config', message, fields)
}

function getJwtSecret() {
    const store = require('./store')

    if ('jwtSecret' in store._overrides) return store._overrides.jwtSecret

    const envVal = process.env.JWT_SECRET
    if (envVal) return envVal

    try {
        if (fs.existsSync(secretPath)) {
            const saved = fs.readFileSync(secretPath, 'utf8').trim()
            if (saved && saved.length === 64) {
                if (!jwtSecretLoadedLogged) {
                    authConfigLog('info', 'jwt-secret-loaded', {
                        path: secretPath
                    })
                    jwtSecretLoadedLogged = true
                }
                return saved
            }
        }
    } catch (err) {
        authConfigLog('warn', 'jwt-secret-read-failed', {
            path: secretPath,
            error: logger.getErrorMessage(err)
        })
    }

    const secret = crypto.randomBytes(32).toString('hex')
    try {
        const dir = path.dirname(secretPath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(secretPath, secret, { mode: 0o600 })
        if (!jwtSecretGeneratedLogged) {
            authConfigLog('warn', 'jwt-secret-generated', {
                path: secretPath,
                recommendedAction: 'move_to_env'
            })
            jwtSecretGeneratedLogged = true
        }
    } catch (err) {
        authConfigLog('error', 'jwt-secret-save-failed', {
            path: secretPath,
            error: logger.getErrorMessage(err)
        })
    }

    return secret
}

function attachToConfig(config) {
    Object.defineProperty(config, 'jwtSecret', {
        get: function() {
            return getJwtSecret()
        },
        set: function(val) {
            const store = require('./store')
            store._overrides.jwtSecret = val
            this.save()
        },
        enumerable: true,
        configurable: true
    })
}

module.exports = {
    attachToConfig,
    getJwtSecret
}
