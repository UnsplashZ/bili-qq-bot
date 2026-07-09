const qqRuntime = require('./runtime')

function getProviderId(transport) {
    return String(transport?.id || '').trim().toLowerCase()
}

function isOfficialTransport(transport) {
    if (getProviderId(transport) === 'official') return true
    const current = qqRuntime.getCurrentProvider()
    return transport && current === transport && qqRuntime.isOfficialProvider(current)
}

function isQqTransportReady(transport) {
    if (!transport) return false
    if (isOfficialTransport(transport)) {
        if (transport.readyState === 1) return true
        if (transport.state === 'ready') return true
        const status = typeof transport.getStatus === 'function' ? transport.getStatus() : null
        return status?.state === 'ready' || status?.connectionState === 'ready'
    }
    return transport.readyState === 1
}

function resolveOutboundTransport(preferred = null) {
    if (isOfficialTransport(preferred)) return preferred
    if (isOfficialTransport(global.bot?.provider)) return global.bot.provider
    const current = qqRuntime.getCurrentProvider()
    if (qqRuntime.isOfficialProvider(current) && !preferred) return current
    return preferred || global.bot?.ws || current || null
}

module.exports = {
    isOfficialTransport,
    isQqTransportReady,
    resolveOutboundTransport
}
