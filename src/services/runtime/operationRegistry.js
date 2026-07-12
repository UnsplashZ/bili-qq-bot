'use strict'

const { AsyncLocalStorage } = require('async_hooks')
const crypto = require('crypto')
const { applicationAdmissionGate } = require('./applicationAdmissionGate')

class OperationPausedError extends Error {
    constructor(message = 'Runtime operation ingress is paused') {
        super(message)
        this.code = 'OPERATION_INGRESS_PAUSED'
    }
}

class OperationDrainTimeoutError extends Error {
    constructor(activeOperations) {
        super('Timed out waiting for runtime operations to drain')
        this.code = 'OPERATION_DRAIN_TIMEOUT'
        this.activeOperations = activeOperations
    }
}

class OperationRegistry {
    constructor(options = {}) {
        this.name = options.name || 'runtime'
        this.contextStorage = options.contextStorage || new AsyncLocalStorage()
        this.active = new Map()
        this.paused = false
        this.pauseReason = null
        this.drainWaiters = new Set()
        this.applicationAdmissionGate = options.applicationAdmissionGate || applicationAdmissionGate
    }

    pause(reason = 'reload') {
        this.paused = true
        this.pauseReason = String(reason)
    }

    resume() {
        this.paused = false
        this.pauseReason = null
    }

    getContext() {
        return this.contextStorage.getStore() || null
    }

    async run(kind, fn, context = {}) {
        this.applicationAdmissionGate.assertOpen()
        if (this.paused) throw new OperationPausedError(`${this.name} ingress paused: ${this.pauseReason || 'unknown'}`)
        if (typeof fn !== 'function') throw new TypeError('Operation callback must be a function')
        const id = `${this.name}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`
        const controller = new AbortController()
        const descendants = new Set()
        const trackPromise = (promise) => {
            const tracked = Promise.resolve(promise)
            descendants.add(tracked)
            tracked.catch(() => {})
            tracked.finally(() => descendants.delete(tracked)).catch(() => {})
            return tracked
        }
        const operation = {
            id,
            kind: String(kind || 'operation'),
            startedAt: Date.now(),
            generation: context.generation ?? null,
            controller,
            descendants,
            context: Object.freeze({
                ...context,
                abortSignal: context.abortSignal || controller.signal,
                trackPromise
            })
        }
        this.active.set(id, operation)
        try {
            const result = await this.contextStorage.run(operation.context, () => fn(operation.context))
            while (descendants.size > 0) {
                await Promise.allSettled([...descendants])
            }
            return result
        } finally {
            this.active.delete(id)
            this._notifyDrained()
        }
    }

    async drain(options = {}) {
        if (this.active.size === 0) return true
        const timeoutMs = Number(options.timeoutMs ?? 30000)
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, timer: null }
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    this.drainWaiters.delete(waiter)
                    reject(new OperationDrainTimeoutError(this.snapshot()))
                }, timeoutMs)
            }
            this.drainWaiters.add(waiter)
        })
    }

    abortAll(reason = 'shutdown') {
        for (const operation of this.active.values()) {
            operation.controller.abort(new Error(String(reason)))
        }
    }

    _notifyDrained() {
        if (this.active.size !== 0) return
        for (const waiter of this.drainWaiters) {
            if (waiter.timer) clearTimeout(waiter.timer)
            waiter.resolve(true)
        }
        this.drainWaiters.clear()
    }

    snapshot() {
        return [...this.active.values()].map((operation) => ({
            id: operation.id,
            kind: operation.kind,
            generation: operation.generation,
            startedAt: operation.startedAt,
            descendants: operation.descendants.size
        }))
    }

    getResourceCounts() {
        return {
            activeOperations: this.active.size,
            drainWaiters: this.drainWaiters.size,
            paused: this.paused
        }
    }
}

module.exports = {
    OperationRegistry,
    OperationPausedError,
    OperationDrainTimeoutError
}
