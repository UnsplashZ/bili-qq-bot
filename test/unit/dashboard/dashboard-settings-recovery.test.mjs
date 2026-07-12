import assert from 'node:assert/strict'
import {
    createSettingsRecoveryCoordinator,
    isRecoveryRequiredResponse,
    toPublicRecoveryFailure
} from '../../../dashboard/src/pages/settings/hooks/settingsRecovery.js'

describe('Dashboard settings recovery coordinator', () => {
    it('serializes duplicate recovery clicks and refreshes a matching generation', async () => {
        let recoverCalls = 0
        let release
        const recoveryGate = new Promise(resolve => { release = resolve })
        const coordinator = createSettingsRecoveryCoordinator({
            recover: async () => {
                recoverCalls += 1
                await recoveryGate
                return { recovered: true, handlers: ['qq-provider-runtime'] }
            },
            fetchConfig: async () => ({ generation: 12, qqOfficialClientSecretConfigured: true }),
            fetchStatus: async () => ({ documentGeneration: 12, effectiveGeneration: 12, recoveryRequired: null })
        })

        const first = coordinator.run()
        const duplicate = coordinator.run()
        assert.strictEqual(first, duplicate)
        assert.equal(coordinator.isRunning(), true)
        assert.equal(recoverCalls, 1)
        release()
        const result = await first
        assert.equal(result.snapshot.generation, 12)
        assert.equal(result.status.effectiveGeneration, 12)
        assert.equal(coordinator.isRunning(), false)
    })

    it('allows a failed recovery to be retried successfully', async () => {
        let attempts = 0
        const coordinator = createSettingsRecoveryCoordinator({
            recover: async () => {
                attempts += 1
                if (attempts === 1) {
                    const error = new Error('private runtime detail')
                    error.response = { data: { code: 'CONFIG_RECOVERY_TOKEN_STALE', phase: 'recovery-required', error: 'secret=value' } }
                    throw error
                }
                return { recovered: true }
            },
            fetchConfig: async () => ({ generation: 13 }),
            fetchStatus: async () => ({ documentGeneration: 13, effectiveGeneration: 13 })
        })

        await assert.rejects(coordinator.run(), /private runtime detail/)
        assert.equal(coordinator.isRunning(), false)
        const result = await coordinator.run()
        assert.equal(attempts, 2)
        assert.equal(result.status.documentGeneration, 13)
    })

    it('projects only structured public error fields', () => {
        const failure = toPublicRecoveryFailure({
            response: { data: { code: 'CONFIG_RECOVERY_FAILED', phase: 'cleanup', error: 'clientSecret=do-not-render' } }
        })
        assert.deepEqual(failure, { code: 'CONFIG_RECOVERY_FAILED', phase: 'cleanup' })
        assert.equal(JSON.stringify(failure).includes('do-not-render'), false)
    })

    it('enters recovery only from the typed backend recovery state', () => {
        assert.equal(isRecoveryRequiredResponse({ response: { data: { code: 'CONFIG_RELOAD_ERROR', recoveryRequired: null } } }), false)
        assert.equal(isRecoveryRequiredResponse({ response: { data: { code: 'CONFIG_RECOVERY_TOKEN_STALE', recoveryRequired: null } } }), false)
        assert.equal(isRecoveryRequiredResponse({ response: { data: { recoveryRequired: { required: true, code: 'CONFIG_RECOVERY_REQUIRED' } } } }), true)
        assert.equal(isRecoveryRequiredResponse({ response: { data: { recoveryRequired: { required: false } } } }), false)
    })
})
