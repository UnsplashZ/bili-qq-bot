const fs = require('fs')
const path = require('path')
const logger = require('../utils/logger')
const { asyncWriteWithBackup } = require('../utils/storageUtils')
const { parseValue } = require('./schema')

const CONFIG_DIR = path.join(__dirname, '../../config')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

function configLog(level, message, fields = {}) {
    logger.logEvent(level, 'STORE', 'svc:config', message, fields)
}

let _overrides = {}
if (fs.existsSync(CONFIG_PATH)) {
    try {
        _overrides = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    } catch (e) {
        configLog('error', 'config-load-failed', {
            path: CONFIG_PATH,
            error: logger.getErrorMessage(e)
        })
    }
}

function hasOwnOverride(key) {
    return Object.prototype.hasOwnProperty.call(_overrides, key)
}

function cloneConfigValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return JSON.parse(JSON.stringify(value))
    }
    return value
}

function save(config) {
    if (config._saveTimer) {
        clearTimeout(config._saveTimer)
    }

    logger.logEvent('info', 'STORE', 'svc:config', 'config-save-queued')

    config._saveTimer = setTimeout(() => {
        Promise.resolve(config._performSave()).catch((err) => {
            configLog('error', 'config-save-failed', {
                error: logger.getErrorMessage(err)
            })

            config._saveErrorCount = (config._saveErrorCount || 0) + 1
            if (config._saveErrorCount >= 5) {
                configLog('error', 'config-save-failure-threshold', {
                    consecutiveFailures: config._saveErrorCount
                })
                config._saveErrorCount = 0
            }
        })
    }, 100)
}

async function performSave(config) {
    const startTime = Date.now()
    const saveCount = (config._saveCount || 0) + 1

    try {
        await asyncWriteWithBackup(CONFIG_PATH, _overrides, false)
        config._saveCount = saveCount
        const duration = Date.now() - startTime
        logger.logEvent('info', 'STORE', 'svc:config', 'config-saved', {
            durationMs: duration,
            total: config._saveCount
        })
        if (duration > 100) {
            configLog('warn', 'config-save-slow', {
                durationMs: duration
            })
        }
    } catch (e) {
        configLog('error', 'config-save-failed', {
            error: logger.getErrorMessage(e)
        })
    }
}

function defineGetters(config, META) {
    Object.keys(META).forEach((key) => {
        const meta = META[key]

        Object.defineProperty(config, key, {
            get: function() {
                if (meta.get) {
                    return meta.get.call(meta, _overrides)
                }

                if (key in _overrides) {
                    return _overrides[key]
                }

                if (meta.lazyInit) {
                    _overrides[key] = JSON.parse(JSON.stringify(meta.def))
                    return _overrides[key]
                }

                const envVal = meta.env ? process.env[meta.env] : undefined
                const rawVal = envVal !== undefined ? envVal : meta.def
                return parseValue(rawVal, meta.type)
            },
            set: function(val) {
                _overrides[key] = val
                this.save()
            },
            enumerable: true,
            configurable: true
        })
    })
}

function getEffectiveConfigValueWithoutMutation(key, META) {
    const meta = META[key]
    if (!meta) return undefined

    if (hasOwnOverride(key)) {
        return cloneConfigValue(_overrides[key])
    }

    if (typeof meta.get === 'function') {
        return cloneConfigValue(meta.get.call(meta, _overrides))
    }

    const envVal = meta.env ? process.env[meta.env] : undefined
    const rawVal = envVal !== undefined ? envVal : meta.def
    return cloneConfigValue(parseValue(rawVal, meta.type))
}

module.exports = {
    _overrides,
    save,
    performSave,
    defineGetters,
    cloneConfigValue,
    hasOwnOverride,
    getEffectiveConfigValueWithoutMutation
}
