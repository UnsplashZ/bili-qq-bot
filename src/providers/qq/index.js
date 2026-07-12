const { createQqProvider, normalizeProviderName } = require('./providerFactory')
const runtime = require('./runtime')
const capabilities = require('./capabilities')

module.exports = {
    createQqProvider,
    normalizeProviderName,
    ...runtime,
    ...capabilities
}
