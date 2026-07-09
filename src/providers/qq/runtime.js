let currentProvider = null

function setCurrentProvider(provider) {
    currentProvider = provider || null
    global.bot = global.bot || { groupList: new Map(), selfId: '0' }
    global.bot.provider = currentProvider
    return currentProvider
}

function getCurrentProvider() {
    return currentProvider || global.bot?.provider || null
}

function clearCurrentProvider(provider = null) {
    if (!provider || currentProvider === provider) {
        currentProvider = null
    }
    if (!provider || global.bot?.provider === provider) {
        if (global.bot) global.bot.provider = null
    }
}

function isOfficialProvider(provider = getCurrentProvider()) {
    return String(provider?.id || '').toLowerCase() === 'official'
}

function getProviderStatus() {
    const provider = getCurrentProvider()
    if (!provider) return null
    if (typeof provider.getStatus === 'function') {
        return provider.getStatus()
    }
    return {
        id: provider.id || 'unknown',
        name: provider.name || provider.id || 'unknown',
        state: provider.readyState === 1 ? 'ready' : 'unknown'
    }
}

module.exports = {
    setCurrentProvider,
    getCurrentProvider,
    clearCurrentProvider,
    isOfficialProvider,
    getProviderStatus
}
