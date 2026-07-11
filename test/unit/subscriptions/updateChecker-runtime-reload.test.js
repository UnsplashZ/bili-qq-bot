'use strict'

const assert = require('assert')

const updateChecker = require('../../../src/services/subscription/updateChecker')

function deferred() {
    let resolve
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise
    })
    return { promise, resolve }
}

describe('subscription runtime reload', function () {
    const originals = {
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        timer: updateChecker.timer,
        initTimer: updateChecker.initTimer,
        syncTimer: updateChecker.syncTimer,
        credentialRefreshTimer: updateChecker.credentialRefreshTimer,
        checkInterval: updateChecker.checkInterval,
        ws: updateChecker.ws,
        startToken: updateChecker._startToken,
        startState: updateChecker._subscriptionRuntimeStartState
    }

    afterEach(function () {
        global.setInterval = originals.setInterval
        global.clearInterval = originals.clearInterval
        updateChecker.timer = originals.timer
        updateChecker.initTimer = originals.initTimer
        updateChecker.syncTimer = originals.syncTimer
        updateChecker.credentialRefreshTimer = originals.credentialRefreshTimer
        updateChecker.checkInterval = originals.checkInterval
        updateChecker.ws = originals.ws
        updateChecker._startToken = originals.startToken
        updateChecker._subscriptionRuntimeStartState = originals.startState
        updateChecker.resumeOperations()
    })

    it('replaces only the main poll timer and preserves sync and credential timers', function () {
        const oldMain = { name: 'main' }
        const sync = { name: 'sync' }
        const credential = { name: 'credential' }
        const cleared = []
        const created = []
        updateChecker.timer = oldMain
        updateChecker.syncTimer = sync
        updateChecker.credentialRefreshTimer = credential
        updateChecker.ws = { readyState: 1 }
        updateChecker._startToken = Symbol('running')
        updateChecker._subscriptionRuntimeStartState = 'ready'
        global.clearInterval = timer => cleared.push(timer)
        global.setInterval = (callback, delay) => {
            const timer = { callback, delay, unref() {} }
            created.push(timer)
            return timer
        }

        updateChecker.updateCheckInterval(17)

        assert.deepEqual(cleared, [oldMain])
        assert.equal(created.length, 1)
        assert.equal(created[0].delay, 17000)
        assert.equal(updateChecker.syncTimer, sync)
        assert.equal(updateChecker.credentialRefreshTimer, credential)
        assert.equal(updateChecker.timer, created[0])
    })

    it('does not create a poll timer while stopped, initializing, probing, or disconnected', function () {
        const states = [
            { name: 'stopped', startState: 'stopped', token: null, ws: null },
            { name: 'initializing', startState: 'initializing', token: Symbol('init'), ws: { readyState: 1 } },
            { name: 'probe', startState: 'stopped', token: null, ws: null },
            { name: 'disconnected', startState: 'ready', token: Symbol('ready'), ws: { readyState: 3 } }
        ]
        let created = 0
        global.setInterval = () => {
            created += 1
            return { unref() {} }
        }
        for (const state of states) {
            updateChecker.timer = { name: `old-${state.name}` }
            updateChecker._subscriptionRuntimeStartState = state.startState
            updateChecker._startToken = state.token
            updateChecker.ws = state.ws
            updateChecker.updateCheckInterval(19)
            assert.equal(updateChecker.timer, null, `${state.name} must remain timer-free`)
        }
        assert.equal(created, 0)
    })

    it('lets an in-flight cycle finish, rejects new work while paused, and then drains', async function () {
        const active = deferred()
        const operation = updateChecker.operationRegistry.run('manual-check', () => active.promise, {
            generation: 7
        })
        updateChecker.pauseOperations('config-reload')

        await assert.rejects(
            () => updateChecker.operationRegistry.run('new-check', async () => {}),
            /ingress paused/
        )
        let drained = false
        const drain = updateChecker.drainOperations(1000).then(() => {
            drained = true
        })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(drained, false)

        active.resolve('done')
        assert.equal(await operation, 'done')
        await drain
        assert.equal(drained, true)
    })

    it('aborts active operations through the subscription service shutdown interface', async function () {
        const operation = updateChecker.operationRegistry.run('abortable-check', ({ abortSignal }) => new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }))
        await new Promise(resolve => setImmediate(resolve))
        const result = updateChecker.abortOperations('subscription-shutdown')
        assert.equal(result.requested, 1)
        await assert.rejects(() => operation, /subscription-shutdown/)
        await updateChecker.drainOperations(50)
        assert.equal(updateChecker.operationRegistry.getResourceCounts().activeOperations, 0)
    })
})
