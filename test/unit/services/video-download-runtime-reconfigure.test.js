'use strict'

const assert = require('assert')

const { VideoDownloadService } = require('../../../src/services/videoDownloadService')
const biliApi = require('../../../src/services/biliApi')
const qqRuntime = require('../../../src/providers/qq/runtime')
const notificationService = require('../../../src/services/notificationService')

function deferred() {
    let resolve
    const promise = new Promise(resolvePromise => { resolve = resolvePromise })
    return { promise, resolve }
}

describe('VideoDownloadService runtime paths', function () {
    const originalRuntimeStatus = biliApi.getRuntimeStatus
    const originalTaskStatus = biliApi.getDownloadTaskStatus
    const originalAcquireProviderLease = qqRuntime.acquireProviderLease
    const originalSendGroupMessage = notificationService.sendGroupMessage

    afterEach(function () {
        biliApi.getRuntimeStatus = originalRuntimeStatus
        biliApi.getDownloadTaskStatus = originalTaskStatus
        qqRuntime.acquireProviderLease = originalAcquireProviderLease
        notificationService.sendGroupMessage = originalSendGroupMessage
    })

    it('captures task paths, blocks new work, and switches only after active tasks drain', async function () {
        const service = new VideoDownloadService()
        service.currentPaths = service.resolvePaths({
            paths: { napcatTemp: '/tmp/download-old', napcatRead: '/tmp/read-old' }
        })
        const active = deferred()
        let capturedPaths = null
        const task = service.runDownloadTask('test', null, async (context) => {
            capturedPaths = context.paths
            return active.promise
        })

        const reload = service.reconfigure({
            paths: { napcatTemp: '/tmp/download-new', napcatRead: '/tmp/read-new' }
        }, { timeoutMs: 1000 })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(service.currentPaths.writeBase, '/tmp/download-old')
        await assert.rejects(
            () => service.runDownloadTask('blocked', null, async () => {}),
            /ingress paused/
        )

        active.resolve('done')
        assert.equal(await task, 'done')
        const result = await reload
        assert.equal(result.changed, true)
        assert.equal(capturedPaths.writeBase, '/tmp/download-old')
        assert.equal(service.currentPaths.writeBase, '/tmp/download-new')
        assert.equal(service.currentPaths.readBase, '/tmp/read-new')
        assert.equal(service.getResourceCounts().activeOperations, 0)
        await service.cleanup()
    })

    it('blocks path reload while the same Python instance cannot prove task termination', async function () {
        const service = new VideoDownloadService()
        service._unconfirmedTasks.set('task-1', { instanceId: 'python-1', generation: 1 })
        biliApi.getRuntimeStatus = () => ({ running: true, instanceId: 'python-1' })
        biliApi.getDownloadTaskStatus = async () => ({ terminal: false, state: 'running' })

        await assert.rejects(
            () => service.reconfigure({ paths: { napcatTemp: '/tmp/new-write', napcatRead: '/tmp/new-read' } }),
            error => error.code === 'DOWNLOAD_TASK_TERMINAL_UNCONFIRMED'
        )
        assert.equal(service.pathGeneration, 1)

        biliApi.getDownloadTaskStatus = async () => ({ terminal: true, state: 'cancelled' })
        const result = await service.reconfigure({
            paths: { napcatTemp: '/tmp/new-write', napcatRead: '/tmp/new-read' }
        })
        assert.equal(result.changed, true)
        assert.equal(service.getResourceCounts().unconfirmedTasks, 0)
        await service.cleanup()
    })

    it('keeps the Provider lease until descendant notification promises settle', async function () {
        const service = new VideoDownloadService()
        const send = deferred()
        let released = false
        qqRuntime.acquireProviderLease = () => ({
            provider: { id: 'official' },
            generation: 9,
            release() { released = true }
        })
        notificationService.sendGroupMessage = () => send.promise

        const task = service.runDownloadTask('notify', null, (context) => (
            service._notifyTarget(context.transport, 'group-openid', [{ type: 'text', data: { text: 'hello' } }])
        ))
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(released, false)
        send.resolve({ ok: true })
        await task
        assert.equal(released, true)
        await service.cleanup()
    })

    it('aborts download operations after a bounded cleanup drain timeout', async function () {
        const service = new VideoDownloadService()
        const task = service.operationRegistry.run('stuck-download', ({ abortSignal }) => new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }))
        await new Promise(resolve => setImmediate(resolve))
        const startedAt = Date.now()
        await assert.rejects(
            () => service.cleanup({ drainTimeoutMs: 5, abortDrainTimeoutMs: 50 }),
            error => ['OPERATION_DRAIN_TIMEOUT', 'VIDEO_DOWNLOAD_CLEANUP_FAILED'].includes(error.code)
        )
        await assert.rejects(() => task, /shutdown-drain-timeout/)
        assert.ok(Date.now() - startedAt < 500)
        assert.equal(service.getResourceCounts().activeOperations, 0)
    })
})
