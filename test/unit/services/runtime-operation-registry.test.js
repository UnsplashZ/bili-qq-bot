'use strict'

const assert = require('assert')
const { OperationRegistry } = require('../../../src/services/runtime/operationRegistry')
const { ReleaseEpochGate } = require('../../../src/services/runtime/releaseEpochGate')
const { ApplicationAdmissionGate } = require('../../../src/services/runtime/applicationAdmissionGate')

describe('runtime operation contracts', () => {
    it('blocks every operation registry behind one token-fenced application admission gate', async () => {
        const gate = new ApplicationAdmissionGate()
        const first = new OperationRegistry({ name: 'first', applicationAdmissionGate: gate })
        const second = new OperationRegistry({ name: 'second', applicationAdmissionGate: gate })
        const token = gate.close('config-reload')
        let releasedCallbacks = 0
        gate.runWhenOpen(() => { releasedCallbacks += 1 })
        await assert.rejects(first.run('request', async () => true), { code: 'APPLICATION_INGRESS_PAUSED' })
        await assert.rejects(second.run('request', async () => true), { code: 'APPLICATION_INGRESS_PAUSED' })
        assert.throws(() => gate.open({ sequence: token.sequence }), { code: 'APPLICATION_ADMISSION_TOKEN_STALE' })
        gate.open(token)
        await new Promise((resolve) => queueMicrotask(resolve))
        assert.strictEqual(releasedCallbacks, 1)
        assert.strictEqual(await first.run('request', async () => true), true)
    })

    it('tracks async context until the full promise completes and drains without aborting it', async () => {
        const registry = new OperationRegistry({ name: 'test' })
        let finish
        const pending = new Promise((resolve) => { finish = resolve })
        const operation = registry.run('render', async (context) => {
            assert.strictEqual(registry.getContext(), context)
            await pending
            return context.generation
        }, { generation: 7 })

        assert.strictEqual(registry.getResourceCounts().activeOperations, 1)
        registry.pause('reload')
        await assert.rejects(registry.run('new', async () => {}), (error) => error.code === 'OPERATION_INGRESS_PAUSED')
        const drain = registry.drain({ timeoutMs: 500 })
        finish()
        assert.strictEqual(await operation, 7)
        await drain
        assert.strictEqual(registry.getResourceCounts().activeOperations, 0)
    })

    it('times out drain while leaving active work untouched', async () => {
        const registry = new OperationRegistry({ name: 'test' })
        let finish
        const operation = registry.run('send', () => new Promise((resolve) => { finish = resolve }))
        await assert.rejects(registry.drain({ timeoutMs: 20 }), (error) => (
            error.code === 'OPERATION_DRAIN_TIMEOUT' && error.activeOperations.length === 1
        ))
        assert.strictEqual(registry.getResourceCounts().activeOperations, 1)
        finish()
        await operation
    })

    it('keeps the parent operation leased until tracked async descendants finish', async () => {
        const registry = new OperationRegistry({ name: 'test' })
        let finishChild
        const child = new Promise(resolve => { finishChild = resolve })
        const operation = registry.run('message', async (context) => {
            context.trackPromise(child)
            return 'handler-returned'
        })

        await new Promise(resolve => setImmediate(resolve))
        assert.equal(registry.getResourceCounts().activeOperations, 1)
        const drain = registry.drain({ timeoutMs: 500 })
        finishChild()
        assert.equal(await operation, 'handler-returned')
        await drain
        assert.equal(registry.getResourceCounts().activeOperations, 0)
    })

    it('makes releaseEpoch admission idempotent and generation-specific', () => {
        const gate = new ReleaseEpochGate()
        gate.arm('epoch-1')
        gate.arm('epoch-1')
        gate.release('epoch-1')
        gate.release('epoch-1')
        gate.enableAdmission('epoch-1')
        assert.doesNotThrow(() => gate.assertAdmission())
        assert.throws(() => gate.arm('epoch-2'), /already armed/)
        assert.strictEqual(gate.snapshot().admissionEnabled, true)
    })
})
