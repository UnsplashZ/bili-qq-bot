'use strict'

const { EventEmitter } = require('events')
const { ReleaseEpochGate } = require('../../services/runtime/releaseEpochGate')

class ProviderLease {
    constructor(slot) {
        this.slot = slot
        this.provider = slot.provider
        this.generation = slot.generation
        this.released = false
        slot.leases += 1
    }

    release() {
        if (this.released) return
        this.released = true
        this.slot.leases = Math.max(0, this.slot.leases - 1)
        this.slot.notifyDrained()
    }
}

class ProviderSlot {
    constructor(options = {}) {
        this.generation = options.generation
        this.provider = options.provider
        this.state = options.state || 'candidate'
        this.supportsParallelSession = options.supportsParallelSession !== false
        this.abortController = new AbortController()
        this.reconnectTimers = new Set()
        this.leases = 0
        this.drainWaiters = new Set()
        this.sharedState = options.sharedState || null
        this.invalidated = false
        this.invalidationReason = null
        this.lifecycleListeners = []
        this.residualError = null
    }

    invalidate(reason = 'provider candidate became unavailable') {
        if (this.state === 'closed' || this.state === 'closing') return
        this.invalidated = true
        this.invalidationReason = reason instanceof Error ? reason : new Error(String(reason))
        if (this.state === 'ready' || this.state === 'active') this.state = 'failed'
    }

    observeCandidateLiveness() {
        const observe = (emitter, event, listener) => {
            if (!emitter?.on) return
            emitter.on(event, listener)
            this.lifecycleListeners.push({ emitter, event, listener })
        }
        const unavailable = (reason) => this.invalidate(reason)
        const stateChanged = (state) => {
            if (!['ready', 'active'].includes(this.state)) return
            if (!['ready', 'open'].includes(String(state || '').toLowerCase())) {
                unavailable(`provider candidate left ready state: ${state || 'unknown'}`)
            }
        }

        observe(this.provider, 'close', () => unavailable('provider candidate closed before commit'))
        observe(this.provider, 'error', (error) => unavailable(error || 'provider candidate errored before commit'))
        observe(this.provider, 'state', stateChanged)
        observe(this.provider?.gateway, 'close', () => unavailable('provider gateway closed before commit'))
        observe(this.provider?.gateway, 'error', (error) => unavailable(error || 'provider gateway errored before commit'))
        observe(this.provider?.gateway, 'state', stateChanged)
        observe(this.provider?.ws, 'close', () => unavailable('provider websocket closed before commit'))
        observe(this.provider?.ws, 'error', (error) => unavailable(error || 'provider websocket errored before commit'))
    }

    stopObservingCandidateLiveness() {
        for (const { emitter, event, listener } of this.lifecycleListeners) {
            emitter.removeListener?.(event, listener)
        }
        this.lifecycleListeners = []
    }

    assertReadyForAdmission() {
        if (!['ready', 'active'].includes(this.state) || this.invalidated || this.abortController.signal.aborted) {
            const error = new Error(this.invalidationReason?.message || 'Provider candidate is not ready')
            error.code = 'PROVIDER_CANDIDATE_NOT_READY'
            error.cause = this.invalidationReason || undefined
            throw error
        }
        if (typeof this.provider?.isRuntimeReady === 'function' && !this.provider.isRuntimeReady()) {
            const error = new Error('Provider candidate failed final readiness check')
            error.code = 'PROVIDER_CANDIDATE_NOT_READY'
            throw error
        }
        return true
    }

    acquireLease() {
        if (this.state !== 'active') {
            const error = new Error('Provider slot is not active')
            error.code = 'PROVIDER_SLOT_NOT_ACTIVE'
            throw error
        }
        return new ProviderLease(this)
    }

    async drain(timeoutMs = 30000) {
        if (this.leases === 0) return true
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, timer: null }
            if (timeoutMs > 0) {
                waiter.timer = setTimeout(() => {
                    this.drainWaiters.delete(waiter)
                    const error = new Error('Provider slot drain timed out')
                    error.code = 'PROVIDER_SLOT_DRAIN_TIMEOUT'
                    reject(error)
                }, timeoutMs)
            }
            this.drainWaiters.add(waiter)
        })
    }

    notifyDrained() {
        if (this.leases !== 0) return
        for (const waiter of this.drainWaiters) {
            if (waiter.timer) clearTimeout(waiter.timer)
            waiter.resolve(true)
        }
        this.drainWaiters.clear()
    }

    addReconnectTimer(timer) {
        this.reconnectTimers.add(timer)
        return timer
    }

    clearReconnectTimers() {
        for (const timer of this.reconnectTimers) {
            clearTimeout(timer)
            clearInterval(timer)
        }
        this.reconnectTimers.clear()
    }

    async close(options = {}) {
        if (this.state === 'closed') return
        this.state = 'closing'
        this.abortController.abort(new Error(options.reason || 'provider slot closing'))
        this.clearReconnectTimers()
        this.provider?.cancelPendingRuntimeEvents?.()
        this.provider?.precommitInboundBuffer?.cancel?.()
        try {
            await this.drain(options.timeoutMs ?? 30000)
            if (typeof this.provider?.stop === 'function') await this.provider.stop()
            else if (typeof this.provider?.close === 'function') await this.provider.close()
            this.stopObservingCandidateLiveness()
            this.residualError = null
            this.state = 'closed'
        } catch (error) {
            this.residualError = error
            this.state = 'residual'
            throw error
        }
    }

    async forceClose(options = {}) {
        if (this.state === 'closed') return
        this.abortController.abort(new Error(options.reason || 'provider slot force closing'))
        this.clearReconnectTimers()
        this.provider?.cancelPendingRuntimeEvents?.()
        this.provider?.precommitInboundBuffer?.cancel?.()
        const failures = []
        const attempted = new Set()
        const invoke = async (owner, method) => {
            if (typeof method !== 'function' || attempted.has(method)) return false
            attempted.add(method)
            try {
                await method.call(owner)
                return true
            } catch (error) {
                failures.push(error)
                return false
            }
        }
        let closed = false
        closed = await invoke(this.provider, this.provider?.forceStop) || closed
        closed = await invoke(this.provider, this.provider?.stop) || closed
        closed = await invoke(this.provider, this.provider?.close) || closed
        closed = await invoke(this.provider?.gateway, this.provider?.gateway?.forceStop) || closed
        closed = await invoke(this.provider?.gateway, this.provider?.gateway?.stop) || closed
        for (const socket of [this.provider?.ws, this.provider?.gateway?.ws]) {
            if (!socket) continue
            try {
                if (typeof socket.terminate === 'function') socket.terminate()
                else if (typeof socket.close === 'function') socket.close()
                closed = true
            } catch (error) {
                failures.push(error)
            }
        }
        if (!closed) {
            const error = failures.length > 1
                ? new AggregateError(failures, 'Provider slot force close failed')
                : (failures[0] || this.residualError || new Error('Provider slot has no force-close mechanism'))
            error.code = error.code || 'PROVIDER_FORCE_CLOSE_FAILED'
            this.residualError = error
            this.state = 'residual'
            throw error
        }
        this.stopObservingCandidateLiveness()
        this.residualError = null
        this.state = 'closed'
    }

    getResourceCounts() {
        return {
            leases: this.leases,
            reconnectTimers: this.reconnectTimers.size,
            state: this.state,
            residual: this.state === 'residual',
            residualCode: this.residualError?.code || null
        }
    }
}

class ProviderRuntimeManager extends EventEmitter {
    constructor(options = {}) {
        super()
        this.activeSlot = null
        this.candidateSlot = null
        this.generation = 0
        this.ingressPaused = false
        this.sharedState = options.sharedState || null
        this.releaseGate = options.releaseGate || new ReleaseEpochGate()
        this.residualSlots = new Set()
        this.residualCleanupGeneration = 0
        this.pendingExternalRestore = null
    }

    createSlot(provider, options = {}) {
        return new ProviderSlot({
            provider,
            generation: options.generation ?? this.generation + 1,
            supportsParallelSession: options.supportsParallelSession,
            sharedState: options.sharedState || this.sharedState,
            state: options.state || 'candidate'
        })
    }

    setActiveProvider(provider, options = {}) {
        const previous = this.activeSlot
        const slot = this.createSlot(provider, { ...options, state: 'active' })
        if (previous && previous.provider !== provider) {
            previous.provider?.cancelPendingRuntimeEvents?.()
        }
        this.generation = slot.generation
        this.activeSlot = slot
        this.emit('active', slot, previous)
        return slot
    }

    async prepareCandidate(providerOrFactory, options = {}) {
        if (this.pendingExternalRestore) {
            const error = new Error('Cannot prepare a Provider candidate while external recovery remains pending')
            error.code = 'PROVIDER_EXTERNAL_RESTORE_REQUIRED'
            throw error
        }
        if (this.residualSlots.size > 0) {
            const error = new Error('Cannot prepare a Provider candidate while residual Provider resources remain')
            error.code = 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
            error.residualCount = this.residualSlots.size
            throw error
        }
        if (this.candidateSlot) throw new Error('Provider candidate already exists')
        const provider = typeof providerOrFactory === 'function'
            ? await providerOrFactory({ sharedState: this.sharedState, signal: options.signal })
            : providerOrFactory
        const slot = this.createSlot(provider, options)
        this.candidateSlot = slot
        try {
            if (!options.skipPreflight && typeof provider?.preflight === 'function') await provider.preflight(options.preflightOptions)
            if (typeof provider?.start === 'function' && options.start !== false) await provider.start(options.startOptions)
            if (typeof provider?.waitUntilReady === 'function') await provider.waitUntilReady(options.timeoutMs)
            slot.state = 'ready'
            slot.observeCandidateLiveness()
            slot.assertReadyForAdmission()
            return slot
        } catch (error) {
            try {
                await slot.close({ reason: 'provider candidate prepare failed', timeoutMs: options.timeoutMs ?? 30000 })
                if (this.candidateSlot === slot) this.candidateSlot = null
            } catch (cleanupError) {
                this.residualSlots.add(slot)
                error.cleanupErrors = [cleanupError]
            }
            throw error
        }
    }

    commitCandidate() {
        if (!this.candidateSlot) throw new Error('Provider candidate is not ready')
        this.candidateSlot.assertReadyForAdmission()
        const previous = this.activeSlot
        const candidate = this.candidateSlot
        candidate.state = 'active'
        this.activeSlot = candidate
        this.candidateSlot = null
        this.generation = candidate.generation
        if (previous) {
            previous.state = 'draining'
            previous.provider?.cancelPendingRuntimeEvents?.()
        }
        this.emit('active', candidate, previous)
        return { active: candidate, previous }
    }

    async rollbackCandidate() {
        const candidate = this.candidateSlot
        if (!candidate) return
        try {
            await candidate.close({ reason: 'provider candidate rollback' })
            this.candidateSlot = null
            this.residualSlots.delete(candidate)
        } catch (error) {
            this.residualSlots.add(candidate)
            throw error
        }
    }

    pauseIngress() {
        this.ingressPaused = true
    }

    resumeIngress() {
        this.ingressPaused = false
    }

    acquireLease() {
        if (this.releaseGate.snapshot().epoch) this.releaseGate.assertAdmission()
        if (this.ingressPaused) {
            const error = new Error('Provider ingress is paused')
            error.code = 'PROVIDER_INGRESS_PAUSED'
            throw error
        }
        if (!this.activeSlot) {
            const error = new Error('No active Provider slot')
            error.code = 'PROVIDER_UNAVAILABLE'
            throw error
        }
        return this.activeSlot.acquireLease()
    }

    async retireSlot(slot, options = {}) {
        if (!slot) return
        try {
            await slot.close(options)
            this.residualSlots.delete(slot)
        } catch (error) {
            this.residualSlots.add(slot)
            throw error
        }
    }

    trackResidualProvider(provider, error, options = {}) {
        const slot = options.slot || this.createSlot(provider, {
            generation: options.generation ?? this.generation + 1,
            state: 'residual'
        })
        slot.state = 'residual'
        slot.residualError = error || new Error('Provider cleanup remains pending')
        this.residualSlots.add(slot)
        return slot
    }

    async retryResidualCleanup(options = {}) {
        const failures = []
        for (const slot of [...this.residualSlots]) {
            try {
                await slot.close({
                    reason: options.reason || 'retry residual Provider cleanup',
                    timeoutMs: options.timeoutMs ?? 30000
                })
                this.residualSlots.delete(slot)
                if (this.activeSlot === slot) this.activeSlot = null
                if (this.candidateSlot === slot) this.candidateSlot = null
            } catch (error) {
                this.residualSlots.add(slot)
                failures.push(error)
            }
        }
        if (failures.length > 0) {
            const error = new AggregateError(failures, 'Residual Provider cleanup failed')
            error.code = 'PROVIDER_RESIDUAL_CLEANUP_FAILED'
            error.cleanupErrors = failures
            throw error
        }
        this.residualCleanupGeneration += 1
        return { residualCount: 0 }
    }

    async resumePendingExternalRestore() {
        const pending = this.pendingExternalRestore
        if (!pending) {
            const error = new Error('No pending Provider external restore is available')
            error.code = 'PROVIDER_EXTERNAL_RESTORE_NOT_PENDING'
            throw error
        }
        this.pauseIngress()
        try {
            if (this.residualSlots.size > 0 ||
                this.residualCleanupGeneration < pending.requiredCleanupGeneration) {
                await this.retryResidualCleanup({ reason: 'Provider recovery residual cleanup' })
            }
            if (this.residualSlots.size > 0) {
                const error = new Error('Provider residual cleanup remains incomplete')
                error.code = 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
                error.residualCount = this.residualSlots.size
                throw error
            }
            await pending.restoreExternal()
            await pending.resumeOperations()
            this.resumeIngress()
            pending.prepared = true
            return { prepared: true, residualCount: 0 }
        } catch (error) {
            this.pauseIngress()
            try {
                await pending.pauseOperations()
            } catch (pauseError) {
                error.cleanupErrors = [...(error.cleanupErrors || []), pauseError]
            }
            pending.prepared = false
            throw error
        }
    }

    async pausePendingExternalRestore() {
        this.pauseIngress()
        const pending = this.pendingExternalRestore
        if (!pending) return
        pending.prepared = false
        await pending.pauseOperations()
    }

    completePendingExternalRestore() {
        const pending = this.pendingExternalRestore
        if (!pending?.prepared) {
            const error = new Error('Provider external restore has not reached the prepared state')
            error.code = 'PROVIDER_EXTERNAL_RESTORE_NOT_PREPARED'
            throw error
        }
        this.pendingExternalRestore = null
        return { recovered: true }
    }

    async stopAll(options = {}) {
        this.pauseIngress()
        const failures = []
        const slots = new Set([
            ...(this.activeSlot ? [this.activeSlot] : []),
            ...(this.candidateSlot ? [this.candidateSlot] : []),
            ...this.residualSlots
        ])
        for (const slot of slots) {
            try {
                await slot.close({
                    reason: options.reason || 'Provider runtime shutdown',
                    timeoutMs: options.timeoutMs ?? 30000
                })
                this.residualSlots.delete(slot)
            } catch (error) {
                this.residualSlots.add(slot)
                failures.push(error)
            } finally {
                if (this.activeSlot === slot) this.activeSlot = null
                if (this.candidateSlot === slot) this.candidateSlot = null
            }
        }
        if (failures.length > 0) {
            const error = new AggregateError(failures, 'Provider runtime shutdown left residual resources')
            error.code = 'PROVIDER_RUNTIME_STOP_FAILED'
            error.cleanupErrors = failures
            error.residualCount = this.residualSlots.size
            throw error
        }
        return { residualCount: 0 }
    }

    async forceCloseAll(options = {}) {
        const failures = []
        const slots = new Set([
            ...(this.activeSlot ? [this.activeSlot] : []),
            ...(this.candidateSlot ? [this.candidateSlot] : []),
            ...this.residualSlots
        ])
        for (const slot of slots) {
            try {
                await slot.forceClose({ reason: options.reason || 'Provider runtime forced shutdown' })
                this.residualSlots.delete(slot)
            } catch (error) {
                this.residualSlots.add(slot)
                failures.push(error)
            } finally {
                if (this.activeSlot === slot) this.activeSlot = null
                if (this.candidateSlot === slot) this.candidateSlot = null
            }
        }
        if (failures.length > 0) {
            const error = new AggregateError(failures, 'Provider runtime force close left residual resources')
            error.code = 'PROVIDER_RUNTIME_FORCE_CLOSE_FAILED'
            error.cleanupErrors = failures
            error.residualCount = this.residualSlots.size
            throw error
        }
        return { residualCount: 0 }
    }

    getCurrentProvider() {
        return this.activeSlot?.provider || null
    }

    getStatus() {
        return {
            generation: this.generation,
            ingressPaused: this.ingressPaused,
            releaseEpoch: this.releaseGate.snapshot().epoch,
            release: this.releaseGate.snapshot(),
            active: this.activeSlot ? {
                providerId: this.activeSlot.provider?.id || 'unknown',
                generation: this.activeSlot.generation,
                ...this.activeSlot.getResourceCounts()
            } : null,
            candidate: this.candidateSlot ? {
                providerId: this.candidateSlot.provider?.id || 'unknown',
                generation: this.candidateSlot.generation,
                ...this.candidateSlot.getResourceCounts()
            } : null,
            residualCount: this.residualSlots.size,
            externalRestorePending: Boolean(this.pendingExternalRestore),
            residual: [...this.residualSlots].map((slot) => ({
                providerId: slot.provider?.id || 'unknown',
                generation: slot.generation,
                ...slot.getResourceCounts()
            }))
        }
    }

    createReloadHandler(options = {}) {
        if (typeof options.createCandidate !== 'function') {
            throw new TypeError('Provider reload handler requires createCandidate')
        }
        let previousSlot = null
        let preparedSlot = null
        let committedSlot = null
        let descriptor = null
        let releaseEpoch = null
        let releaseSnapshot = this.releaseGate.snapshot()
        let externalRestoreCompleted = false
        let pendingExternalRestore = null

        const normalizeDescriptor = (value) => {
            if (value?.provider) return value
            return { provider: value }
        }
        const closePrepared = async () => {
            if (this.candidateSlot) {
                await this.rollbackCandidate()
            } else if (preparedSlot && preparedSlot !== this.activeSlot && preparedSlot.state !== 'closed') {
                await this.retireSlot(preparedSlot, { reason: 'provider reload rollback', timeoutMs: options.timeoutMs ?? 30000 })
            }
            preparedSlot = null
        }
        const restoreExternalPrevious = async (restore) => {
            if (externalRestoreCompleted || typeof options.restorePrevious !== 'function') return
            const restored = await options.restorePrevious({
                ...restore,
                previousSlot,
                manager: this
            })
            if (restored?.provider && previousSlot) previousSlot.provider = restored.provider
            externalRestoreCompleted = true
            pendingExternalRestore = null
        }
        const recoveryRequired = (failures = []) => {
            this.pauseIngress()
            const error = new AggregateError(
                failures,
                'Provider rollback left residual resources; cleanup is required before recovery'
            )
            error.code = 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
            error.cleanupErrors = failures
            error.residualCount = this.residualSlots.size
            return error
        }
        const restoreOldSlot = async (candidate, previous, context) => {
            const failures = []
            if (committedSlot && previousSlot) {
                const failed = this.activeSlot
                previousSlot.state = 'active'
                this.activeSlot = previousSlot
                this.generation = previousSlot.generation
                this.emit('active', previousSlot, failed)
                if (failed && failed !== previousSlot) {
                    failed.state = 'draining'
                    try {
                        await this.retireSlot(failed, {
                            reason: 'provider reload rollback',
                            timeoutMs: options.timeoutMs ?? 30000
                        })
                    } catch (error) {
                        failures.push(error)
                    }
                }
                committedSlot = null
            } else {
                try {
                    await closePrepared()
                } catch (error) {
                    failures.push(error)
                }
            }
            this.releaseGate.restore(releaseSnapshot)
            if (failures.length > 0 || this.residualSlots.size > 0) {
                pendingExternalRestore = {
                    candidate,
                    previous,
                    context,
                    requiredCleanupGeneration: this.residualCleanupGeneration + 1
                }
                this.pendingExternalRestore = {
                    requiredCleanupGeneration: pendingExternalRestore.requiredCleanupGeneration,
                    prepared: false,
                    restoreExternal: () => restoreExternalPrevious(pendingExternalRestore),
                    resumeOperations: () => options.resumeOperations?.({ previous, context, manager: this }),
                    pauseOperations: () => options.pauseRecovery?.({ previous, context, manager: this })
                }
                throw recoveryRequired(failures)
            }
            try {
                await restoreExternalPrevious({ candidate, previous, context })
            } catch (error) {
                failures.push(error)
            }
            if (failures.length > 0) {
                const error = new AggregateError(failures, 'Provider runtime rollback failed')
                error.code = 'PROVIDER_RUNTIME_ROLLBACK_FAILED'
                error.cleanupErrors = failures
                throw error
            }
        }

        return {
            id: options.id || 'qq-provider-runtime',
            effects: ['qqProvider'],
            ownedPaths: options.ownedPaths || ['qq'],
            preflight: async (candidate, previous, context) => {
                releaseSnapshot = this.releaseGate.snapshot()
                releaseEpoch = String(
                    context?.releaseEpoch ||
                    context?.migration?.releaseEpoch ||
                    candidate?.runtime?.releaseEpoch ||
                    ''
                ).trim() || null
                if (releaseEpoch) this.releaseGate.arm(releaseEpoch)
                await options.preflight?.({ candidate, previous, context, manager: this })
            },
            prepareParallel: async (candidate, previous, context) => {
                previousSlot = this.activeSlot
                externalRestoreCompleted = false
                pendingExternalRestore = null
                descriptor = normalizeDescriptor(await options.createCandidate({
                    candidate,
                    previous,
                    context,
                    previousSlot,
                    sharedState: this.sharedState,
                    manager: this
                }))
                if (!descriptor.provider) throw new Error('Provider candidate factory returned no provider')
                if (descriptor.prepareInExclusive) {
                    if (typeof descriptor.provider.preflight === 'function') {
                        await descriptor.provider.preflight(descriptor.preflightOptions)
                    }
                    return
                }
                preparedSlot = await this.prepareCandidate(descriptor.provider, {
                    supportsParallelSession: descriptor.supportsParallelSession,
                    timeoutMs: descriptor.timeoutMs ?? options.timeoutMs,
                    start: descriptor.start !== false,
                    startOptions: descriptor.startOptions,
                    preflightOptions: descriptor.preflightOptions,
                    sharedState: descriptor.sharedState || this.sharedState
                })
            },
            pauseIngress: async (candidate, previous, context) => {
                this.pauseIngress()
                await options.pauseOperations?.({ candidate, previous, context, manager: this })
            },
            preCommitDrain: async (candidate, previous, context) => {
                await options.drainOperations?.({ candidate, previous, context, manager: this })
                await previousSlot?.drain(options.timeoutMs ?? 30000)
            },
            prepareExclusive: async (candidate, previous, context) => {
                if (descriptor?.prepareInExclusive) {
                    if (typeof options.prepareExclusive === 'function') {
                        await options.prepareExclusive({
                            candidate,
                            previous,
                            context,
                            descriptor,
                            previousSlot,
                            manager: this
                        })
                    }
                    preparedSlot = await this.prepareCandidate(descriptor.provider, {
                        supportsParallelSession: false,
                        timeoutMs: descriptor.timeoutMs ?? options.timeoutMs,
                        start: descriptor.start !== false,
                        startOptions: descriptor.startOptions,
                        preflightOptions: descriptor.preflightOptions,
                        skipPreflight: true,
                        sharedState: descriptor.sharedState || this.sharedState
                    })
                }
            },
            commitHandles: async (candidate, previous, context) => {
                preparedSlot?.assertReadyForAdmission()
                const committed = this.commitCandidate()
                committedSlot = committed.active
                previousSlot = committed.previous
                await options.activateCandidate?.({
                    candidate,
                    previous,
                    context,
                    activeSlot: committed.active,
                    previousSlot: committed.previous,
                    manager: this
                })
            },
            validateAdmission: async (candidate, previous, context) => {
                this.activeSlot?.assertReadyForAdmission()
            },
            enableIngress: async (candidate, previous, context) => {
                this.resumeIngress()
                await options.resumeOperations?.({ candidate, previous, context, manager: this })
            },
            finalizeAdmission: () => {
                this.activeSlot?.assertReadyForAdmission()
            },
            commitAdmission: async (candidate, previous, context) => {
                await options.commitAdmission?.({
                    candidate,
                    previous,
                    context,
                    activeSlot: this.activeSlot,
                    previousSlot,
                    manager: this
                })
                if (releaseEpoch) {
                    this.releaseGate.release(releaseEpoch)
                    this.releaseGate.enableAdmission(releaseEpoch)
                }
            },
            rollbackAdmission: async (candidate, previous, context) => {
                await options.rollbackAdmission?.({
                    candidate,
                    previous,
                    context,
                    activeSlot: this.activeSlot,
                    previousSlot,
                    manager: this
                })
                this.releaseGate.restore(releaseSnapshot)
            },
            afterAdmissionOpen: async (candidate, previous, context) => {
                this.activeSlot?.stopObservingCandidateLiveness()
                await options.afterAdmissionOpen?.({
                    candidate,
                    previous,
                    context,
                    activeSlot: this.activeSlot,
                    previousSlot,
                    manager: this
                })
            },
            rollbackExclusive: restoreOldSlot,
            rollbackPrepared: closePrepared,
            restorePrevious: async (previous, context) => {
                this.releaseGate.restore(releaseSnapshot)
                if (this.residualSlots.size > 0) {
                    // A failed compensating close means either the old or candidate
                    // Provider can still own sockets/timers. Keep every local source of
                    // work fenced until explicit residual cleanup succeeds; the global
                    // admission gate is kept closed by the rollback error as well.
                    this.pauseIngress()
                    const error = new Error('Provider rollback left residual resources; local admission remains paused')
                    error.code = 'PROVIDER_RESIDUAL_CLEANUP_REQUIRED'
                    error.residualCount = this.residualSlots.size
                    throw error
                }
                if (pendingExternalRestore &&
                    this.residualCleanupGeneration < pendingExternalRestore.requiredCleanupGeneration) {
                    // rollbackPrepared may have completed a second cleanup attempt after
                    // rollbackExclusive failed. Only the explicit residual cleanup API
                    // advances this generation and authorizes a later Provider rebuild.
                    throw recoveryRequired([])
                }
                if (pendingExternalRestore) {
                    await restoreExternalPrevious(pendingExternalRestore)
                }
                this.resumeIngress()
                await options.resumeOperations?.({ previous, context, manager: this })
            },
            resumePendingRecovery: async () => this.resumePendingExternalRestore(),
            pausePendingRecovery: async () => this.pausePendingExternalRestore(),
            completePendingRecovery: () => this.completePendingExternalRestore(),
            postCommitDrain: async () => previousSlot?.drain(options.timeoutMs ?? 30000),
            disposeOld: async () => {
                if (!previousSlot || previousSlot === this.activeSlot) return
                const old = previousSlot
                await this.retireSlot(old, {
                    reason: 'provider reload committed',
                    timeoutMs: options.timeoutMs ?? 30000
                })
                previousSlot = null
            }
        }
    }
}

module.exports = {
    ProviderLease,
    ProviderSlot,
    ProviderRuntimeManager
}
