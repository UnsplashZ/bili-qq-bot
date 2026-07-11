const UpdateChecker = require('./UpdateChecker')
const { resolveArticleTitle } = require('./helpers/article')

const lifecycleMethods = require('./modules/lifecycle')
const targetingMethods = require('./modules/targeting')
const feedMethods = require('./modules/feed')
const manualCheckMethods = require('./modules/manualChecks')
const unifiedCheckMethods = require('./modules/unifiedChecks')
const atAllMethods = require('./modules/atAll')
const notifyMethods = require('./modules/notify')
const maintenanceMethods = require('./modules/maintenance')

Object.assign(
    UpdateChecker.prototype,
    lifecycleMethods,
    targetingMethods,
    feedMethods,
    manualCheckMethods,
    unifiedCheckMethods,
    atAllMethods,
    notifyMethods,
    maintenanceMethods
)

const config = require('../../../config')
const qqRuntime = require('../../../providers/qq/runtime')

function runtimeSnapshot() {
    try {
        return config.service?.getSnapshot?.() || null
    } catch {
        return null
    }
}

function wrapTrackedOperation(methodName) {
    const original = UpdateChecker.prototype[methodName]
    if (typeof original !== 'function') return
    UpdateChecker.prototype[methodName] = async function(...args) {
        if (this.operationRegistry?.getContext()) return original.apply(this, args)
        let providerLease = null
        try {
            providerLease = qqRuntime.acquireProviderLease()
        } catch (error) {
            if (error?.code === 'RUNTIME_ADMISSION_DISABLED' || error?.code === 'PROVIDER_INGRESS_PAUSED') {
                throw error
            }
            providerLease = null
        }
        try {
            return await this.operationRegistry.run(methodName, () => original.apply(this, args), {
                configSnapshot: runtimeSnapshot(),
                providerLease,
                providerSlotLease: providerLease,
                providerGeneration: providerLease?.generation ?? null,
                generation: providerLease?.generation ?? config.getStatus?.().effectiveGeneration ?? null
            })
        } finally {
            providerLease?.release?.()
        }
    }
}

;[
    'checkAll',
    'refreshCookieFollowings',
    'checkAndRefreshCredential',
    'warmupGroupAtAllCapabilities'
].forEach(wrapTrackedOperation)

const updateCheckerInstance = new UpdateChecker()

module.exports = updateCheckerInstance
module.exports.resolveArticleTitle = resolveArticleTitle
