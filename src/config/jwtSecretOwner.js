'use strict'

// Deprecated compatibility shim. JWT Secret ownership moved to
// dashboard.jwtSecret in ConfigService/config.yaml. No legacy file or env reads
// are allowed here.

function getJwtSecret(config = null) {
    const value = config?.jwtSecret ?? config?.dashboard?.jwtSecret
    return typeof value === 'string' ? value : ''
}

function attachToConfig(config) {
    if (!config || typeof config !== 'object') return config
    Object.defineProperty(config, 'jwtSecret', {
        get() {
            const serviceValue = config.service?.get?.('dashboard.jwtSecret')
            return typeof serviceValue === 'string' ? serviceValue : getJwtSecret(config.dashboard || null)
        },
        set() {
            const error = new Error('Direct JWT Secret assignment is disabled; use ConfigService.patch()')
            error.code = 'LEGACY_CONFIG_WRITE_DISABLED'
            throw error
        },
        enumerable: true,
        configurable: true
    })
    return config
}

module.exports = {
    attachToConfig,
    getJwtSecret
}
