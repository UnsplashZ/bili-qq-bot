'use strict'

const { OperationRegistry } = require('./operationRegistry')

class BotOperationRegistry extends OperationRegistry {
    constructor(options = {}) {
        super({ name: 'bot', ...options })
        this.configSnapshotProvider = options.configSnapshotProvider || (() => null)
        this.providerLeaseProvider = options.providerLeaseProvider || (() => null)
    }

    async runBotOperation(kind, fn, context = {}) {
        const providerLease = context.providerSlotLease || this.providerLeaseProvider()
        const effectiveConfigSnapshot = context.effectiveConfigSnapshot || this.configSnapshotProvider()
        const generation = context.generation ?? providerLease?.generation ?? null
        try {
            return await this.run(kind, fn, {
                ...context,
                effectiveConfigSnapshot,
                providerSlotLease: providerLease,
                providerGeneration: providerLease?.generation ?? generation,
                generation
            })
        } finally {
            providerLease?.release?.()
        }
    }
}

const botOperationRegistry = new BotOperationRegistry({
    configSnapshotProvider: () => {
        try {
            return require('../../config').service?.getSnapshot?.() || null
        } catch {
            return null
        }
    },
    providerLeaseProvider: () => {
        try {
            return require('../../providers/qq/runtime').acquireProviderLease()
        } catch (error) {
            if (error?.code === 'RUNTIME_ADMISSION_DISABLED' || error?.code === 'PROVIDER_INGRESS_PAUSED') {
                throw error
            }
            return null
        }
    }
})

module.exports = {
    BotOperationRegistry,
    botOperationRegistry
}
