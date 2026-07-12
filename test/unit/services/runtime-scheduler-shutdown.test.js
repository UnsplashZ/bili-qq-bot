'use strict'

const assert = require('assert')

const notificationService = require('../../../src/services/notificationService')
const requestApprovalService = require('../../../src/services/requestApprovalService')
const subscriptionService = require('../../../src/services/subscriptionService')
const updateChecker = require('../../../src/services/subscription/updateChecker')

function deferred() {
    let resolve
    const promise = new Promise(resolvePromise => { resolve = resolvePromise })
    return { promise, resolve }
}

describe('runtime scheduler shutdown', () => {
    const originalCleanup = notificationService.cleanupExpiredTempImages
    const originalSendPrivateMessage = notificationService.sendPrivateMessage
    const originalUpdateCheckerStop = updateChecker.stop

    afterEach(async () => {
        await notificationService.stopTempImageCleanupScheduler()
        notificationService.cleanupExpiredTempImages = originalCleanup
        notificationService.sendPrivateMessage = originalSendPrivateMessage
        updateChecker.stop = originalUpdateCheckerStop
    })

    it('does not start the notification cleanup scheduler merely by importing the module', () => {
        assert.equal(notificationService._tempImageCleanupTimer, null)
    })

    it('awaits an in-flight cleanup and supports idempotent async stop', async () => {
        const cleanup = deferred()
        notificationService.cleanupExpiredTempImages = () => cleanup.promise
        notificationService.startTempImageCleanupScheduler()
        assert.ok(notificationService._tempImageCleanupTimer)

        let stopped = false
        const first = notificationService.stop().then(() => { stopped = true })
        const second = notificationService.stop()
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(stopped, false)
        assert.equal(notificationService._tempImageCleanupTimer, null)

        cleanup.resolve()
        await Promise.all([first, second])
        assert.equal(stopped, true)
    })

    it('returns the complete fallback notification promise and stops approval cleanup once', async () => {
        assert.equal(requestApprovalService.cleanupTimer, null)
        const firstTimer = requestApprovalService.start()
        assert.ok(firstTimer)
        assert.equal(requestApprovalService.start(), firstTimer)
        const send = deferred()
        notificationService.sendPrivateMessage = () => send.promise
        let settled = false
        const notifying = requestApprovalService._sendAdminText({}, '10000', 'pending').then(() => {
            settled = true
        })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled, false)
        send.resolve({ ok: true })
        await notifying
        assert.equal(settled, true)

        await Promise.all([requestApprovalService.stop(), requestApprovalService.stop()])
        assert.equal(requestApprovalService.cleanupTimer, null)

        const restartedTimer = await requestApprovalService.restart()
        assert.ok(restartedTimer)
        assert.notEqual(restartedTimer, firstTimer)
        await requestApprovalService.stop()
    })

    it('returns the update checker stop promise so shutdown can await pending startup', async () => {
        const stopping = deferred()
        updateChecker.stop = () => stopping.promise
        let settled = false
        const result = subscriptionService.stop().then(() => { settled = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(settled, false)
        stopping.resolve()
        await result
        assert.equal(settled, true)
    })
})
