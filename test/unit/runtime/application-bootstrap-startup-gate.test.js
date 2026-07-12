'use strict'

const assert = require('assert')
const bot = require('../../../src/bot')
const ServiceManager = require('../../../src/services/ServiceManager')
const dashboardServer = require('../../../src/dashboard/server')
const browserManager = require('../../../src/services/imageGenerator/core/browser')
const subscriptionService = require('../../../src/services/subscriptionService')
const qqProviderRuntime = require('../../../src/providers/qq/runtime')

describe('application bootstrap startup gate', () => {
    it('allows automatic legacy migration without an operator fencing flag', async () => {
        let receivedOptions = null
        const error = Object.assign(new Error('stop after option capture'), { code: 'CONFIG_BOOTSTRAP_INVALID_INPUT' })
        const previous = process.env.BILI_LEGACY_WRITER_FENCED
        delete process.env.BILI_LEGACY_WRITER_FENCED
        try {
            await assert.rejects(bot.startBot({
                bootstrap: {
                    async run(options) {
                        receivedOptions = options
                        throw error
                    }
                }
            }), (caught) => caught === error)
            assert.strictEqual(receivedOptions.allowLegacyMigration, true)
        } finally {
            if (previous === undefined) delete process.env.BILI_LEGACY_WRITER_FENCED
            else process.env.BILI_LEGACY_WRITER_FENCED = previous
            bot.__testHooks.resetRuntimeState()
        }
    })

    it('starts no runtime side effects when bootstrap fails', async () => {
        const calls = []
        const restore = []
        for (const [target, method, label] of [
            [ServiceManager, 'start', 'python'],
            [dashboardServer, 'start', 'dashboard'],
            [browserManager, 'initialize', 'browser'],
            [subscriptionService, 'start', 'subscription'],
            [qqProviderRuntime.providerRuntimeManager, 'prepare', 'provider']
        ]) {
            const original = target[method]
            target[method] = (...args) => { calls.push(label); return original?.apply(target, args) }
            restore.push(() => { target[method] = original })
        }
        const error = Object.assign(new Error('bootstrap rejected'), { code: 'CONFIG_BOOTSTRAP_INVALID_INPUT' })
        try {
            await assert.rejects(bot.startBot({ bootstrap: { run: async () => { throw error } } }), (caught) => caught === error)
            assert.deepStrictEqual(calls, [])
            assert.deepStrictEqual(bot.__testHooks.getRuntimeState(), { ws: null, officialProvider: null, activeProvider: null })
        } finally {
            for (const undo of restore.reverse()) undo()
            bot.__testHooks.resetRuntimeState()
        }
    })
})
