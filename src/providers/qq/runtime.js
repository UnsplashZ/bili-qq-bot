const { ProviderRuntimeManager } = require('./providerSlotRuntime')

const providerRuntimeManager = new ProviderRuntimeManager()

function setCurrentProvider(provider) {
    if (!provider) return clearCurrentProvider()
    if (providerRuntimeManager.getCurrentProvider() === provider) return provider
    const previous = providerRuntimeManager.activeSlot
    providerRuntimeManager.setActiveProvider(provider)
    if (previous) {
        previous.state = 'draining'
        providerRuntimeManager.retireSlot(previous).catch((error) => {
            providerRuntimeManager.emit('cleanupError', error, previous)
        })
    }
    global.bot = global.bot || { groupList: new Map(), selfId: '0' }
    global.bot.provider = provider
    return provider
}

function getCurrentProvider() {
    return providerRuntimeManager.getCurrentProvider() || global.bot?.provider || null
}

function clearCurrentProvider(provider = null) {
    if (!provider || providerRuntimeManager.getCurrentProvider() === provider) {
        if (providerRuntimeManager.activeSlot) {
            providerRuntimeManager.activeSlot.provider?.cancelPendingRuntimeEvents?.()
            providerRuntimeManager.activeSlot.state = 'closed'
        }
        providerRuntimeManager.activeSlot = null
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
    const managerStatus = providerRuntimeManager.getStatus()
    const providerStatus = typeof provider.getStatus === 'function'
        ? provider.getStatus()
        : {
            id: provider.id || 'unknown',
            name: provider.name || provider.id || 'unknown',
            state: provider.readyState === 1 ? 'ready' : 'unknown'
        }
    return {
        ...providerStatus,
        generation: managerStatus.active?.generation ?? managerStatus.generation,
        resourceGeneration: managerStatus.active?.generation ?? managerStatus.generation,
        releaseEpoch: managerStatus.releaseEpoch,
        ingressPaused: managerStatus.ingressPaused
    }
}

function createReloadHandler(options) {
    return providerRuntimeManager.createReloadHandler(options)
}

module.exports = {
    setCurrentProvider,
    getCurrentProvider,
    clearCurrentProvider,
    isOfficialProvider,
    getProviderStatus,
    providerRuntimeManager,
    acquireProviderLease: () => providerRuntimeManager.acquireLease(),
    prepareProviderCandidate: (...args) => providerRuntimeManager.prepareCandidate(...args),
    commitProviderCandidate: () => providerRuntimeManager.commitCandidate(),
    rollbackProviderCandidate: () => providerRuntimeManager.rollbackCandidate(),
    retryResidualCleanup: (...args) => providerRuntimeManager.retryResidualCleanup(...args),
    resumePendingExternalRestore: (...args) => providerRuntimeManager.resumePendingExternalRestore(...args),
    pausePendingExternalRestore: (...args) => providerRuntimeManager.pausePendingExternalRestore(...args),
    stopAll: (...args) => providerRuntimeManager.stopAll(...args),
    forceCloseAll: (...args) => providerRuntimeManager.forceCloseAll(...args),
    createReloadHandler
}
