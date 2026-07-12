'use strict'

const PROBE_CHECKPOINTS = new Set(['data_applied', 'probe_started', 'probe_ready', 'release_prepared'])
const FINAL_CHECKPOINTS = new Set(['runtime_ready', 'upgrade_complete'])

function componentEffectApplied(component, documentGeneration) {
    if (!component) return false
    if (component.effectApplied !== undefined) return Boolean(component.effectApplied)
    const observed = Number(component.observedDocumentGeneration || 0)
    return observed >= documentGeneration &&
        component.appliedEffectHash !== null &&
        component.appliedEffectHash === component.desiredEffectHash &&
        !component.cleanupPending
}

function normalizeComponent(component, documentGeneration, defaults = {}) {
    const value = component || {}
    return {
        ...defaults,
        ...value,
        effectApplied: componentEffectApplied(value, documentGeneration)
    }
}

function buildReadinessPayload(context = {}) {
    const mode = context.mode === 'upgrade-probe' ? 'upgrade-probe' : 'normal'
    const config = context.config || {}
    const documentGeneration = Number(config.documentGeneration || 0)
    const migration = context.migration || null
    const applicationBootstrap = context.applicationBootstrap || (migration?.configSchemaVersion ? migration : null)
    const dashboard = normalizeComponent(context.dashboard, documentGeneration, {
        state: 'not-ready',
        observedDocumentGeneration: 0
    })
    const python = normalizeComponent(context.python, documentGeneration, {
        state: 'not-ready',
        resourceGeneration: 0,
        instanceId: null
    })
    const qqProvider = normalizeComponent(context.qqProvider, documentGeneration, {
        id: null,
        state: 'not-ready',
        resourceGeneration: 0,
        releaseEpoch: null
    })
    const subscription = normalizeComponent(context.subscription, documentGeneration, {
        state: 'not-ready',
        paused: true,
        observedDocumentGeneration: 0
    })

    const configReady = Boolean(config.valid) && documentGeneration > 0
    const baseEffectsReady = dashboard.effectApplied && python.effectApplied && qqProvider.effectApplied && subscription.effectApplied
    const providerCandidate = qqProvider.candidateSlot || qqProvider.candidate || null
    const providerActiveSlot = qqProvider.activeSlot || qqProvider.active || null
    const providerActiveGeneration = Number(providerActiveSlot?.generation || qqProvider.activeGeneration || 0)
    const providerResourceGeneration = Number(qqProvider.resourceGeneration || 0)
    const providerActiveReleaseEpoch = providerActiveSlot?.releaseEpoch || qqProvider.activeReleaseEpoch || null
    const providerQuiescent = !providerCandidate && !qqProvider.cleanupPending
    let migrationReady = applicationBootstrap?.status === 'ready'
    let providerReady = false
    let subscriptionReady = false

    if (mode === 'upgrade-probe') {
        migrationReady = applicationBootstrap?.status === 'ready'
        providerReady = ['preflight-ready', 'deferred'].includes(qqProvider.state) && providerQuiescent
        subscriptionReady = subscription.state === 'ready' && subscription.paused === true
    } else {
        const checkpointReady = applicationBootstrap?.status === 'ready'
        const epochReady = applicationBootstrap?.status === 'ready' && (migration?.releaseEpoch === null || migration?.releaseEpoch === undefined || (
            typeof migration.releaseEpoch === 'string' &&
            migration.releaseEpoch.length > 0 &&
            qqProvider.releaseEpoch === migration.releaseEpoch
        ))
        migrationReady = checkpointReady && epochReady
        const activeGenerationReady = Boolean(providerActiveSlot) &&
            providerActiveGeneration > 0 &&
            providerActiveGeneration === providerResourceGeneration
        const activeEpochReady = migration === null || providerActiveReleaseEpoch === migration.releaseEpoch
        providerReady = qqProvider.state === 'ready' &&
            qqProvider.effectApplied &&
            providerQuiescent &&
            activeGenerationReady &&
            activeEpochReady
        subscriptionReady = subscription.state === 'ready' && subscription.paused === false
    }

    const ready = configReady && baseEffectsReady && migrationReady && providerReady && subscriptionReady && python.state === 'ready' && dashboard.state === 'ready'
    return {
        ready,
        mode,
        config: {
            valid: Boolean(config.valid),
            documentGeneration,
            effectiveGeneration: Number(config.effectiveGeneration || 0),
            fingerprint: config.fingerprint || null
        },
        migration,
        applicationBootstrap,
        dashboard,
        python,
        qqProvider,
        subscription
    }
}

module.exports = {
    PROBE_CHECKPOINTS,
    FINAL_CHECKPOINTS,
    componentEffectApplied,
    buildReadinessPayload
}
