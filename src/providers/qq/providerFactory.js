const config = require('../../config')
const NapcatProvider = require('./napcatProvider')
const OfficialQqProvider = require('./officialProvider')

function normalizeProviderName(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'official' || normalized === 'qq-official' || normalized === 'qq_official') return 'official'
    return 'napcat'
}

function createQqProvider(options = {}) {
    const providerName = normalizeProviderName(options.provider || config.qqProvider)
    if (providerName === 'official') {
        return new OfficialQqProvider(options)
    }
    return new NapcatProvider(options.ws || null)
}

module.exports = {
    normalizeProviderName,
    createQqProvider
}
