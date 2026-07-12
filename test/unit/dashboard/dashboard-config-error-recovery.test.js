'use strict'

const assert = require('assert')
const { configErrorResponse } = require('../../../src/dashboard/routes/api/modules/config')
const { configErrorResponse: sharedConfigErrorResponse } = require('../../../src/dashboard/routes/api/shared/config-mutation')

describe('Dashboard typed config error recovery projection', () => {
    function fakeConfig(status) {
        return {
            service: { toPublicError: (error) => ({ code: error.code, phase: error.phase || 'apply' }) },
            getStatus: () => status
        }
    }

    it('does not project recovery for a reload error that fully rolled back', () => {
        const payload = configErrorResponse(fakeConfig({
            documentGeneration: 7,
            fingerprint: 'public-fingerprint',
            recoveryRequired: null,
            pendingRuntimeRecovery: null
        }), Object.assign(new Error('private handler failure'), { code: 'CONFIG_RELOAD_ERROR' }))
        assert.strictEqual(payload.code, 'CONFIG_RELOAD_ERROR')
        assert.strictEqual(payload.recoveryRequired, null)
        assert.strictEqual(payload.pendingRuntimeRecovery, null)
        const sharedPayload = sharedConfigErrorResponse(fakeConfig({
            documentGeneration: 7,
            fingerprint: 'public-fingerprint',
            recoveryRequired: null,
            pendingRuntimeRecovery: null
        }), Object.assign(new Error('private handler failure'), { code: 'CONFIG_RELOAD_ERROR' }))
        assert.strictEqual(sharedPayload.recoveryRequired, null)
    })

    it('returns only typed, redacted recovery and pending-runtime fields', () => {
        const payload = configErrorResponse(fakeConfig({
            documentGeneration: 8,
            fingerprint: 'public-fingerprint',
            recoveryRequired: {
                required: true,
                reason: 'runtime-reload-failed',
                code: 'CONFIG_RECOVERY_REQUIRED',
                since: '2026-07-11T00:00:00.000Z',
                rollbackErrors: [{ handlerId: 'qq-provider-runtime', phase: 'restore', code: 'PROVIDER_RESTORE_FAILED', message: 'secret=value' }],
                diskRestoreFailed: false,
                privateToken: 'secret-token'
            },
            pendingRuntimeRecovery: {
                required: true,
                handlers: ['qq-provider-runtime'],
                rollbackErrors: [{ handlerId: 'qq-provider-runtime', phase: 'restore', code: 'PROVIDER_RESTORE_FAILED', error: 'secret=value' }],
                token: 'private-admission-token'
            }
        }), Object.assign(new Error('private handler failure'), { code: 'CONFIG_RELOAD_ERROR' }))
        assert.deepStrictEqual(payload.recoveryRequired.rollbackErrors, [{
            handlerId: 'qq-provider-runtime', phase: 'restore', code: 'PROVIDER_RESTORE_FAILED'
        }])
        assert.deepStrictEqual(payload.pendingRuntimeRecovery.handlers, ['qq-provider-runtime'])
        assert.ok(!JSON.stringify(payload).includes('secret'))
        assert.ok(!JSON.stringify(payload).includes('private-admission-token'))
    })
})
