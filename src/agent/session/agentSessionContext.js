const { AsyncLocalStorage } = require('async_hooks')

const storage = new AsyncLocalStorage()

function runWithAgentSession(context, fn) {
    return storage.run(context, fn)
}

function getAgentSession() {
    return storage.getStore() || null
}

module.exports = {
    runWithAgentSession,
    getAgentSession
}
