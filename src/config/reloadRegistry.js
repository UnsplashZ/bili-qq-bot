'use strict'

const { ConfigReloadError } = require('./errors')
const { applicationAdmissionGate } = require('../services/runtime/applicationAdmissionGate')

const NOOP = async () => {}

function normalizeHandler(handler) {
    if (!handler || typeof handler.id !== 'string' || !handler.id.trim()) {
        throw new TypeError('Reload handler requires a stable id')
    }
    return {
        id: handler.id,
        ownedPaths: Array.isArray(handler.ownedPaths) ? handler.ownedPaths.map(String) : [],
        effects: Array.isArray(handler.effects) ? handler.effects.map(String) : [],
        dependsOn: Array.isArray(handler.dependsOn) ? handler.dependsOn.map(String) : [],
        preflight: handler.preflight || NOOP,
        prepareParallel: handler.prepareParallel || NOOP,
        pauseIngress: handler.pauseIngress || NOOP,
        preCommitDrain: handler.preCommitDrain || NOOP,
        prepareExclusive: handler.prepareExclusive || NOOP,
        commitHandles: handler.commitHandles || NOOP,
        validateAdmission: handler.validateAdmission || NOOP,
        enableIngress: handler.enableIngress || NOOP,
        finalizeAdmission: handler.finalizeAdmission || (() => {}),
        commitAdmission: handler.commitAdmission || NOOP,
        rollbackAdmission: handler.rollbackAdmission || NOOP,
        afterAdmissionOpen: handler.afterAdmissionOpen || NOOP,
        rollbackExclusive: handler.rollbackExclusive || NOOP,
        rollbackPrepared: handler.rollbackPrepared || NOOP,
        restorePrevious: handler.restorePrevious || NOOP,
        resumePendingRecovery: typeof handler.resumePendingRecovery === 'function' ? handler.resumePendingRecovery : null,
        pausePendingRecovery: typeof handler.pausePendingRecovery === 'function' ? handler.pausePendingRecovery : null,
        completePendingRecovery: typeof handler.completePendingRecovery === 'function' ? handler.completePendingRecovery : null,
        postCommitDrain: handler.postCommitDrain || NOOP,
        disposeOld: handler.disposeOld || NOOP
    }
}

function isPathOwned(handler, path) {
    const label = Array.isArray(path) ? path.join('.') : String(path)
    return handler.ownedPaths.some((owned) => label === owned || label.startsWith(`${owned}.`))
}

class ReloadTransaction {
    constructor(registry, handlers, context) {
        this.registry = registry
        this.handlers = handlers
        this.context = context
        this.preparedParallel = []
        this.paused = []
        this.preparedExclusive = []
        this.committed = []
        this.enabled = []
        this.admissionCommitted = []
        this.admissionToken = null
        this.closed = false
        this.rollbackErrors = []
        this.postAdmissionErrors = []
    }

    async _invoke(handler, phase) {
        try {
            return await handler[phase](
                this.context.candidate,
                this.context.previous,
                this.context
            )
        } catch (error) {
            throw new ConfigReloadError(`Reload handler failed during ${phase}`, {
                phase,
                handlerId: handler.id,
                cause: error
            })
        }
    }

    _invokeSync(handler, phase) {
        try {
            const result = handler[phase](
                this.context.candidate,
                this.context.previous,
                this.context
            )
            if (result && typeof result.then === 'function') {
                const error = new TypeError(`${phase} must be synchronous`)
                error.code = 'CONFIG_ADMISSION_SYNC_REQUIRED'
                throw error
            }
            return result
        } catch (error) {
            throw new ConfigReloadError(`Reload handler failed during ${phase}`, {
                phase,
                handlerId: handler.id,
                cause: error
            })
        }
    }

    async _assertFinalAdmissionFence() {
        if (typeof this.context.assertTransactionCurrent !== 'function') return
        try {
            await this.context.assertTransactionCurrent()
        } catch (error) {
            throw new ConfigReloadError('Reload transaction token changed before admission opened', {
                phase: 'finalAdmissionFence',
                handlerId: 'config-transaction',
                cause: error
            })
        }
    }

    _extractUnresolvedCleanupErrors(error) {
        const candidates = [
            ...(Array.isArray(error?.cleanupErrors) ? error.cleanupErrors : []),
            ...(Array.isArray(error?.cause?.cleanupErrors) ? error.cause.cleanupErrors : []),
            ...(Array.isArray(error?.cause?.cause?.cleanupErrors) ? error.cause.cause.cleanupErrors : [])
        ]
        return candidates.map((cleanupError) => ({
            handlerId: error?.handlerId || 'reload-handler',
            phase: 'rollbackPrepared',
            code: cleanupError?.code || 'CONFIG_CANDIDATE_CLEANUP_ERROR'
        }))
    }

    async prepare() {
        try {
            await Promise.all(this.handlers.map((handler) => this._invoke(handler, 'preflight')))
            for (const handler of this.handlers) {
                this.preparedParallel.push(handler)
                await this._invoke(handler, 'prepareParallel')
            }

            if (this.handlers.length > 0) {
                this.admissionToken = this.registry.admissionGate.close('configuration reload')
            }
            for (const handler of this.handlers) {
                this.paused.push(handler)
                await this._invoke(handler, 'pauseIngress')
            }
            for (const handler of this.handlers) await this._invoke(handler, 'preCommitDrain')
            for (const handler of this.handlers) {
                this.preparedExclusive.push(handler)
                await this._invoke(handler, 'prepareExclusive')
            }
            return this
        } catch (error) {
            const rollbackErrors = await this.rollback(error)
            if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors
            throw error
        }
    }

    async commit() {
        if (this.closed) throw new ConfigReloadError('Reload transaction is already closed')
        try {
            for (const handler of this.handlers) {
                this.committed.push(handler)
                await this._invoke(handler, 'commitHandles')
            }
            return this
        } catch (error) {
            const rollbackErrors = await this.rollback(error)
            if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors
            throw error
        }
    }

    async validateAdmission() {
        if (this.closed) throw new ConfigReloadError('Reload transaction is already closed')
        try {
            await Promise.all(this.handlers.map((handler) => this._invoke(handler, 'validateAdmission')))
            return this
        } catch (error) {
            const rollbackErrors = await this.rollback(error)
            if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors
            throw error
        }
    }

    async enableIngress() {
        if (this.closed) throw new ConfigReloadError('Reload transaction is already closed')
        try {
            for (const handler of this.handlers) {
                this.enabled.push(handler)
                await this._invoke(handler, 'enableIngress')
            }
            for (const handler of this.handlers) this._invokeSync(handler, 'finalizeAdmission')
            for (const handler of this.handlers) {
                this.admissionCommitted.push(handler)
                await this._invoke(handler, 'commitAdmission')
            }
            // This is the last fallible asynchronous ownership check. It remains inside
            // the compensatable transaction: admission commits can still be reversed and
            // the candidate snapshot restored if the lease was lost during their awaits.
            await this._assertFinalAdmissionFence()
            // No await or other fallible asynchronous work is allowed between this last
            // synchronous liveness check and the single gate open.
            for (const handler of this.handlers) this._invokeSync(handler, 'finalizeAdmission')
            if (this.admissionToken) {
                this.registry.admissionGate.open(this.admissionToken)
                this.admissionToken = null
            }
            this.closed = true
            this.registry._recordCommit(this.handlers, this.context)
            for (const handler of this.handlers) {
                try {
                    await this._invoke(handler, 'afterAdmissionOpen')
                } catch (error) {
                    this.postAdmissionErrors.push({ handlerId: handler.id, error })
                }
            }
            return this
        } catch (error) {
            const rollbackErrors = await this.rollback(error)
            if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors
            throw error
        }
    }

    async rollback(cause = null) {
        if (this.closed) return this.rollbackErrors
        if (this.rollbackErrors.length > 0) return this.rollbackErrors
        const reverse = (items) => [...items].reverse()
        const rollbackErrors = this._extractUnresolvedCleanupErrors(cause)
        const keepAdmissionClosed = () => {
            if (this.admissionToken) return
            try {
                this.admissionToken = this.registry.admissionGate.close('runtime cleanup recovery required')
            } catch (error) {
                // A gate that is already closed is the required fail-safe state. Do not
                // replace its owner token: only record failures that leave admission open.
                if (this.registry.admissionGate.snapshot?.().closed) return
                rollbackErrors.push({
                    handlerId: 'application-admission',
                    phase: 'pauseIngress',
                    code: error?.code || 'APPLICATION_ADMISSION_CLOSE_ERROR'
                })
            }
        }
        if (rollbackErrors.length > 0) keepAdmissionClosed()
        const invokeRollback = async (handler, phase, ...args) => {
            try {
                await handler[phase](...args)
            } catch (error) {
                rollbackErrors.push({
                    handlerId: handler.id,
                    phase,
                    code: error?.code || 'CONFIG_ROLLBACK_ERROR'
                })
                // The first failed compensating action changes the transaction from a
                // normal rollback into recovery-required. Close admission immediately,
                // including failures that happen before prepare() acquired a gate token.
                keepAdmissionClosed()
            }
        }
        for (const handler of reverse(this.admissionCommitted)) {
            await invokeRollback(
                handler,
                'rollbackAdmission',
                this.context.candidate,
                this.context.previous,
                this.context
            )
        }
        for (const handler of reverse(this.preparedExclusive)) {
            await invokeRollback(
                handler,
                'rollbackExclusive',
                this.context.candidate,
                this.context.previous,
                this.context
            )
        }
        for (const handler of reverse(this.preparedParallel)) {
            await invokeRollback(
                handler,
                'rollbackPrepared',
                this.context.candidate,
                this.context.previous,
                this.context
            )
        }
        for (const handler of reverse(this.paused)) {
            await invokeRollback(handler, 'restorePrevious', this.context.previous, this.context)
        }
        if (rollbackErrors.length === 0 && this.admissionToken) {
            try {
                this.registry.admissionGate.open(this.admissionToken)
                this.admissionToken = null
            } catch (error) {
                rollbackErrors.push({
                    handlerId: 'application-admission',
                    phase: 'restorePrevious',
                    code: error?.code || 'APPLICATION_ADMISSION_RESTORE_ERROR'
                })
            }
        }
        this.rollbackErrors = rollbackErrors
        this.closed = true
        if (rollbackErrors.length > 0 && this.admissionToken) {
            this.registry._recordPendingRecovery({
                token: this.admissionToken,
                handlers: this.handlers,
                rollbackErrors,
                context: this.context
            })
            this.admissionToken = null
        }
        return rollbackErrors
    }

    async postCommit() {
        const cleanupErrors = [...this.postAdmissionErrors]
        for (const handler of [...this.handlers].reverse()) {
            try {
                await this._invoke(handler, 'postCommitDrain')
                await this._invoke(handler, 'disposeOld')
                const status = this.registry.componentStatus.get(handler.id)
                if (status) status.cleanupPending = false
            } catch (error) {
                const status = this.registry.componentStatus.get(handler.id)
                if (status) status.cleanupPending = true
                cleanupErrors.push({ handlerId: handler.id, error })
            }
        }
        return cleanupErrors
    }
}

class ReloadRegistry {
    constructor(options = {}) {
        this.handlers = new Map()
        this.componentStatus = new Map()
        this.admissionGate = options.admissionGate || applicationAdmissionGate
        this.pendingRecovery = null
        this.recoveryPromise = null
    }

    register(handler) {
        const normalized = normalizeHandler(handler)
        if (this.handlers.has(normalized.id)) throw new Error(`Reload handler already registered: ${normalized.id}`)
        this.handlers.set(normalized.id, normalized)
        this.componentStatus.set(normalized.id, {
            resourceGeneration: 0,
            observedDocumentGeneration: 0,
            appliedEffectHash: null,
            desiredEffectHash: null,
            cleanupPending: false
        })
        return () => this.unregister(normalized.id)
    }

    unregister(id) {
        this.handlers.delete(id)
        this.componentStatus.delete(id)
    }

    _selectHandlers(diff) {
        const effects = new Set(diff.flatMap((entry) => entry.effects || []))
        const selected = new Set()
        for (const handler of this.handlers.values()) {
            if (handler.effects.some((effect) => effects.has(effect)) || diff.some((entry) => isPathOwned(handler, entry.path))) {
                selected.add(handler.id)
            }
        }

        const includeDependencies = (id) => {
            const handler = this.handlers.get(id)
            if (!handler) throw new ConfigReloadError(`Unknown reload handler dependency: ${id}`)
            for (const dependency of handler.dependsOn) {
                if (!selected.has(dependency)) {
                    selected.add(dependency)
                    includeDependencies(dependency)
                }
            }
        }
        for (const id of [...selected]) includeDependencies(id)
        return this._topologicalSort(selected)
    }

    _topologicalSort(selected) {
        const visiting = new Set()
        const visited = new Set()
        const output = []
        const visit = (id) => {
            if (visited.has(id)) return
            if (visiting.has(id)) throw new ConfigReloadError('Reload handler dependency cycle detected')
            visiting.add(id)
            const handler = this.handlers.get(id)
            if (!handler) throw new ConfigReloadError(`Unknown reload handler: ${id}`)
            for (const dependency of handler.dependsOn) {
                if (selected.has(dependency)) visit(dependency)
            }
            visiting.delete(id)
            visited.add(id)
            output.push(handler)
        }
        for (const id of selected) visit(id)
        return output
    }

    async prepare(context) {
        const handlers = this._selectHandlers(context.diff || [])
        const transaction = new ReloadTransaction(this, handlers, context)
        await transaction.prepare()
        return transaction
    }

    observeDocument(documentGeneration) {
        for (const status of this.componentStatus.values()) {
            status.observedDocumentGeneration = documentGeneration
        }
    }

    _recordCommit(handlers, context) {
        for (const handler of handlers) {
            const status = this.componentStatus.get(handler.id)
            status.resourceGeneration += 1
            status.observedDocumentGeneration = context.nextDocumentGeneration
            status.appliedEffectHash = context.desiredEffectHash
            status.desiredEffectHash = context.desiredEffectHash
        }
    }

    _recordPendingRecovery(recovery) {
        if (this.pendingRecovery && this.pendingRecovery.token !== recovery.token) {
            const error = new ConfigReloadError('A runtime recovery is already pending', {
                phase: 'recovery-required'
            })
            error.code = 'CONFIG_RECOVERY_ALREADY_PENDING'
            throw error
        }
        const failedHandlerIds = new Set(recovery.rollbackErrors.map((entry) => entry.handlerId))
        const handlers = recovery.handlers.filter((handler) => failedHandlerIds.has(handler.id))
        this.pendingRecovery = { ...recovery, handlers }
    }

    async resumePendingRecovery(context = {}) {
        if (this.recoveryPromise) return this.recoveryPromise
        const pending = this.pendingRecovery
        if (!pending) {
            const error = new ConfigReloadError('No runtime recovery is pending', { phase: 'recovery-required' })
            error.code = 'CONFIG_RECOVERY_NOT_PENDING'
            throw error
        }
        const unavailable = pending.handlers.filter((handler) => !handler.resumePendingRecovery)
        if (unavailable.length > 0 || pending.handlers.length === 0) {
            const error = new ConfigReloadError('Runtime recovery requires an unavailable component recovery handler', {
                phase: 'recovery-required'
            })
            error.code = 'CONFIG_RECOVERY_UNAVAILABLE'
            error.handlers = unavailable.map((handler) => handler.id)
            throw error
        }
        this.recoveryPromise = (async () => {
            const prepared = []
            let gateOpened = false
            try {
                if (!this.admissionGate.snapshot().closed || this.admissionGate.activeToken !== pending.token) {
                    const error = new ConfigReloadError('Runtime recovery admission token is stale', {
                        phase: 'recovery-required'
                    })
                    error.code = 'CONFIG_RECOVERY_TOKEN_STALE'
                    throw error
                }
                for (const handler of pending.handlers) {
                    prepared.push(handler)
                    await handler.resumePendingRecovery(pending.context.previous, {
                        ...pending.context,
                        ...context
                    })
                }
                if (!this.admissionGate.snapshot().closed || this.admissionGate.activeToken !== pending.token) {
                    const error = new ConfigReloadError('Runtime recovery admission token changed before reopen', {
                        phase: 'recovery-required'
                    })
                    error.code = 'CONFIG_RECOVERY_TOKEN_STALE'
                    throw error
                }
                this.admissionGate.open(pending.token)
                gateOpened = true
                for (const handler of pending.handlers) {
                    const result = handler.completePendingRecovery?.()
                    if (result && typeof result.then === 'function') {
                        const error = new TypeError('completePendingRecovery must be synchronous')
                        error.code = 'CONFIG_RECOVERY_COMPLETION_SYNC_REQUIRED'
                        throw error
                    }
                }
                this.pendingRecovery = null
                return { recovered: true, handlers: pending.handlers.map((handler) => handler.id) }
            } catch (error) {
                if (gateOpened) {
                    try {
                        pending.token = this.admissionGate.close('runtime recovery completion failed')
                    } catch (closeError) {
                        error.cleanupErrors = [...(error.cleanupErrors || []), closeError]
                    }
                }
                for (const handler of [...prepared].reverse()) {
                    try {
                        await handler.pausePendingRecovery?.()
                    } catch (pauseError) {
                        error.cleanupErrors = [...(error.cleanupErrors || []), pauseError]
                    }
                }
                throw error
            }
        })()
        try {
            return await this.recoveryPromise
        } finally {
            this.recoveryPromise = null
        }
    }

    getPendingRecoveryStatus() {
        return this.pendingRecovery
            ? {
                required: true,
                handlers: this.pendingRecovery.handlers.map((handler) => handler.id),
                rollbackErrors: this.pendingRecovery.rollbackErrors.map((entry) => ({ ...entry }))
            }
            : null
    }

    getStatus() {
        return Object.fromEntries([...this.componentStatus.entries()].map(([id, status]) => [id, { ...status }]))
    }
}

module.exports = {
    ReloadRegistry,
    ReloadTransaction
}
