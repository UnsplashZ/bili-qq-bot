'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const {
    CONFIG_SCHEMA,
    CONFIG_SCHEMA_VERSION,
    FLAT_KEY_TO_PATH,
    createDefaultConfig,
    normalizePath,
    normalizePatchPath,
    resolveSchemaNode
} = require('./schemaV1')
const { validateConfig, assertSafePath } = require('./validator')
const {
    parseYamlDocument,
    createYamlDocument,
    cloneYamlDocument,
    stringifyYamlDocument
} = require('./yamlDocument')
const { ConfigWriter, readAnchoredPrivateFile } = require('./configWriter')
const { ReloadRegistry } = require('./reloadRegistry')
const { diffConfig } = require('./configDiff')
const { toPublicConfig, toPublicDiff, toPublicError } = require('./publicConfig')
const {
    DEPLOYMENT_BASELINE_FILE,
    readDeploymentBaseline,
    deploymentStatus
} = require('./deploymentBaseline')
const {
    clone,
    deepFreeze,
    hashBytes,
    hashValue,
    getIn
} = require('./configUtils')
const {
    ConfigConflictError,
    ConfigParseError,
    ConfigReloadError,
    ConfigValidationError
} = require('./errors')

const DEFAULT_LOGGER = Object.freeze({
    debug() {},
    info() {},
    warn() {},
    error() {}
})

function createJwtSecret() {
    return crypto.randomBytes(32).toString('hex')
}

function normalizePatch(patch) {
    if (Array.isArray(patch)) return patch
    if (!patch || typeof patch !== 'object') throw new TypeError('Configuration patch must be an object or array')

    const operations = []
    const remove = patch.remove || patch.clear || []
    for (const pathValue of Array.isArray(remove) ? remove : []) {
        operations.push({ op: 'remove', path: pathValue })
    }

    if (patch.set && typeof patch.set === 'object' && !Array.isArray(patch.set)) {
        for (const [pathValue, value] of Object.entries(patch.set)) {
            operations.push({ op: 'set', path: pathValue, value })
        }
    } else {
        for (const [pathValue, value] of Object.entries(patch)) {
            if (pathValue === 'remove' || pathValue === 'clear') continue
            operations.push({ op: 'set', path: pathValue, value })
        }
    }
    return operations
}

function normalizeOrigin(value) {
    const normalized = String(value || 'unknown').trim().toLowerCase()
    return /^[a-z0-9:_-]{1,64}$/.test(normalized) ? normalized : 'unknown'
}

class ProcessLocalTransactionBoundary {
    constructor() {
        this.token = Symbol('config-process-transaction')
    }

    async current() {
        return this.token
    }

    async assertCurrent(expectedToken = null) {
        if (expectedToken !== null && expectedToken !== this.token) {
            throw new ConfigConflictError('Configuration transaction token changed')
        }
        return this.token
    }
}

class ConfigService extends EventEmitter {
    constructor(options = {}) {
        super()
        this.fs = options.fsModule || fs
        this.fsPromises = options.fsPromises || this.fs.promises
        this.configDir = options.configDir || path.join(__dirname, '../../config')
        this.configPath = options.configPath || path.join(this.configDir, 'config.yaml')
        this.stateDir = options.stateDir || path.join(path.dirname(this.configDir), 'data/config-state')
        this.deploymentBaselinePath = options.deploymentBaselinePath || path.join(this.stateDir, DEPLOYMENT_BASELINE_FILE)
        this.schema = options.schema || CONFIG_SCHEMA
        this.debounceMs = options.debounceMs ?? 100
        this.unlinkGraceMs = options.unlinkGraceMs ?? 500
        this.logger = options.logger || DEFAULT_LOGGER
        this.writer = options.writer || new ConfigWriter({
            configPath: this.configPath,
            stateDir: this.stateDir,
            fsPromises: this.fsPromises
        })
        this.reloadRegistry = options.reloadRegistry || new ReloadRegistry()
        this.transactionBoundary = options.transactionBoundary || new ProcessLocalTransactionBoundary()

        this.documentGeneration = 0
        this.effectiveGeneration = 0
        this.activeDocument = null
        this.activeSource = ''
        this.activeSnapshot = null
        this.sourceHash = null
        this.effectiveHash = null
        this.publicFingerprint = null
        this.desiredSourceHash = null
        this.rejectedSourceHash = null
        this.lastRejectedError = null
        this.lastSuccessfulReloadAt = null
        this.lastFailedReloadAt = null
        this.lastReloadResult = null
        this.pendingSelfWriteHash = null
        this.recoveryState = null
        this.deploymentBaselineError = null

        this.watcher = null
        this.watcherTimer = null
        this.unlinkTimer = null
        this.stopped = false
        this.transactionChain = Promise.resolve()
    }

    async initialize(options = {}) {
        try {
            const transactionToken = await this.transactionBoundary.current()
            const createIfMissing = Boolean(options.createIfMissing)
            try {
                await this.fsPromises.access(this.configPath, fs.constants.F_OK)
            } catch (error) {
                if (error?.code !== 'ENOENT' || !createIfMissing) {
                    throw new ConfigParseError('Configuration file is missing')
                }
                const initial = clone(options.initialConfig || createDefaultConfig())
                if (!initial.dashboard) initial.dashboard = {}
                if (!initial.dashboard.jwtSecret) initial.dashboard.jwtSecret = createJwtSecret()
                const normalized = validateConfig(initial, { schema: this.schema })
                const document = createYamlDocument(normalized)
                const source = stringifyYamlDocument(document)
                await this.writer.ensureDirectories()
                await this.writer.writeConfig(source, {
                    validate: (candidate) => this._parseAndValidate(candidate),
                    beforeRename: () => this.transactionBoundary.assertCurrent(transactionToken)
                })
            }
            await this.load({ startup: true })
            return this
        } catch (error) {
            throw error
        }
    }

    async load(options = {}) {
        const transactionToken = await this.transactionBoundary.current()
        return this._enqueueTransaction(async (queuedTransactionToken) => {
            if (queuedTransactionToken !== transactionToken) throw new ConfigConflictError('Configuration transaction token changed before load')
            const stable = await this._readStableSource()
            const candidate = this._parseAndValidate(stable.source)
            await this._publishInitial(candidate, stable.source, stable.hash, queuedTransactionToken)
            if (options.startWatcher) this.startWatcher()
            return this.getStatus()
        })
    }

    async start(options = {}) {
        this.stopped = false
        if (!this.activeSnapshot) await this.load({ startup: true })
        if (options.watch !== false) this.startWatcher()
        return this
    }

    async stop() {
        this.stopped = true
        this.stopWatcher()
        await this.transactionChain.catch(() => {})
    }

    startWatcher() {
        if (this.watcher) return this.watcher
        this.stopped = false
        this.watcher = this.fs.watch(this.configDir, { persistent: false }, (_eventType, filename) => {
            if (filename && String(filename) !== path.basename(this.configPath)) return
            this._scheduleWatcherReload()
        })
        this.watcher.on('error', (error) => {
            this._recordFailure(error)
            this.emit('watcherError', toPublicError(error))
        })
        return this.watcher
    }

    stopWatcher() {
        if (this.watcherTimer) clearTimeout(this.watcherTimer)
        if (this.unlinkTimer) clearTimeout(this.unlinkTimer)
        this.watcherTimer = null
        this.unlinkTimer = null
        this.watcher?.close()
        this.watcher = null
    }

    _scheduleWatcherReload() {
        if (this.stopped) return
        if (this.watcherTimer) clearTimeout(this.watcherTimer)
        this.watcherTimer = setTimeout(() => {
            this.watcherTimer = null
            this._handleWatcherEvent().catch((error) => {
                this._recordFailure(error)
                this.emit('rejected', toPublicError(error))
            })
        }, this.debounceMs)
    }

    async _handleWatcherEvent() {
        try {
            await this.fsPromises.access(this.configPath, fs.constants.F_OK)
            if (this.unlinkTimer) clearTimeout(this.unlinkTimer)
            this.unlinkTimer = null
            return this.reload({ source: 'watcher' })
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            if (this.unlinkTimer) clearTimeout(this.unlinkTimer)
            this.unlinkTimer = setTimeout(() => {
                this.unlinkTimer = null
                this.reload({ source: 'watcher-unlink-grace' }).catch((reloadError) => {
                    this._recordFailure(reloadError)
                    this.emit('rejected', toPublicError(reloadError))
                })
            }, this.unlinkGraceMs)
        }
    }

    async reload(options = {}) {
        return this._enqueueTransaction((transactionToken) => this._reloadFromDiskLocked(options, transactionToken))
    }

    async recover(options = {}) {
        return this._enqueueTransaction(async () => {
            this._assertLoaded()
            if (!this.recoveryState?.required) {
                return { recovered: false, reason: 'not-required' }
            }
            if (this.recoveryState.diskRestoreFailed) {
                const error = new ConfigReloadError('Configuration disk recovery must be completed before runtime recovery', {
                    phase: 'recovery-required'
                })
                error.code = 'CONFIG_DISK_RECOVERY_REQUIRED'
                throw error
            }
            const result = await this.reloadRegistry.resumePendingRecovery({
                source: options.source || 'config-recovery',
                activeSnapshot: this.activeSnapshot
            })
            const previousRecovery = this.recoveryState
            this.recoveryState = null
            await this.writer.writeJournal({
                phase: 'recovery-complete',
                recoveredAt: new Date().toISOString(),
                reason: previousRecovery.reason,
                handlers: result.handlers
            }).catch((error) => {
                this.logger.warn('config-recovery-journal-failed', {
                    code: error?.code || 'CONFIG_JOURNAL_PERSIST_FAILED'
                })
            })
            return {
                recovered: true,
                handlers: result.handlers,
                documentGeneration: this.documentGeneration,
                effectiveGeneration: this.effectiveGeneration
            }
        })
    }

    async _reloadFromDiskLocked(options = {}, transactionToken = null) {
        this._assertLoaded()
        this._assertRecoverySafe()
        const stable = await this._readStableSource()
        if (stable.hash === this.sourceHash) {
            if (stable.hash === this.pendingSelfWriteHash) this.pendingSelfWriteHash = null
            return this._emptyResult(options.source || 'reload')
        }
        if (stable.hash === this.rejectedSourceHash && this.lastRejectedError) {
            return {
                ...this._emptyResult(options.source || 'reload'),
                rejected: true,
                error: this.lastRejectedError
            }
        }
        if (stable.hash === this.pendingSelfWriteHash) {
            this.pendingSelfWriteHash = null
            return this._emptyResult('self-write')
        }

        let candidate
        try {
            candidate = this._parseAndValidate(stable.source)
        } catch (error) {
            this.rejectedSourceHash = stable.hash
            this.lastRejectedError = toPublicError(error)
            this._recordFailure(error)
            throw error
        }
        return this._applyCandidate({
            candidate,
            source: stable.source,
            sourceHash: stable.hash,
            origin: normalizeOrigin(options.source || 'reload'),
            persist: false,
            expectedDiskHash: stable.hash,
            transactionToken
        })
    }

    async patch(patch, options = {}) {
        return this._enqueueTransaction(async (transactionToken) => {
            this._assertLoaded()
            this._assertRecoverySafe()
            await this._synchronizeDiskBeforeMutation(options.expectedGeneration)
            this._assertExpectedGeneration(options.expectedGeneration)

            const document = cloneYamlDocument(this.activeDocument)
            const operations = normalizePatch(patch)
            for (const operation of operations) {
                const segments = normalizePatchPath(operation.path)
                assertSafePath(segments)
                if (segments.length === 0) throw new ConfigValidationError('Patch path cannot be empty')
                const schemaNode = resolveSchemaNode(segments, this.schema)
                if (!schemaNode) throw new ConfigValidationError('Unknown configuration path')
                if (schemaNode.secret) {
                    if (operation.op === 'clear-secret') {
                        if (schemaNode.allowEmpty === false) {
                            throw new ConfigValidationError('This secret cannot be cleared')
                        }
                        document.setIn(segments, '')
                        continue
                    }
                    if (operation.op === 'remove' || operation.value === '') {
                        throw new ConfigValidationError('Secret clearing requires clear-secret operation')
                    }
                } else if (operation.op === 'clear-secret') {
                    throw new ConfigValidationError('clear-secret is only valid for secret paths')
                }
                if (operation.op === 'remove') {
                    document.deleteIn(segments)
                } else if (operation.op === 'set' || operation.op === 'replace' || operation.op === 'add') {
                    document.setIn(segments, clone(operation.value))
                } else {
                    throw new ConfigValidationError('Unsupported patch operation')
                }
            }

            const source = stringifyYamlDocument(document)
            const candidate = this._parseAndValidate(source)
            return this._applyCandidate({
                candidate,
                source,
                sourceHash: hashBytes(source),
                origin: normalizeOrigin(options.actor || 'api'),
                persist: options.persist !== false,
                expectedDiskHash: this.sourceHash,
                operations,
                transactionToken
            })
        })
    }

    async update(mutator, options = {}) {
        if (typeof mutator !== 'function') throw new TypeError('Configuration mutator must be a function')
        this._assertLoaded()
        const expectedGeneration = options.expectedGeneration ?? this.documentGeneration
        const draft = clone(this.activeSnapshot)
        const returned = mutator(draft)
        if (returned && typeof returned.then === 'function') {
            throw new TypeError('Configuration mutator must be synchronous')
        }
        const next = returned === undefined ? draft : returned
        const diff = diffConfig(this.activeSnapshot, next, this.schema)
        if (diff.length === 0) return this._emptyResult(normalizeOrigin(options.actor || 'api'))
        const operations = diff.map((entry) => (
            entry.after === undefined
                ? { op: 'remove', path: entry.path }
                : { op: 'set', path: entry.path, value: entry.after }
        ))
        return this.patch(operations, { ...options, expectedGeneration })
    }

    async _synchronizeDiskBeforeMutation(expectedGeneration) {
        const stable = await this._readStableSource()
        if (stable.hash === this.sourceHash) return
        await this._reloadFromDiskLocked({ source: 'pre-mutation-sync' })
        if (expectedGeneration !== undefined && expectedGeneration !== this.documentGeneration) {
            throw new ConfigConflictError(undefined, { conflictPaths: [] })
        }
    }

    async _applyCandidate(options) {
        const transactionToken = options.transactionToken || await this.transactionBoundary.assertCurrent()
        await this.transactionBoundary.assertCurrent(transactionToken)
        const previousSnapshot = this.activeSnapshot
        const previousDocument = this.activeDocument
        const previousSource = this.activeSource
        const previousSourceHash = this.sourceHash
        const previousEffectiveHash = this.effectiveHash
        const previousDocumentGeneration = this.documentGeneration
        const previousEffectiveGeneration = this.effectiveGeneration
        const previousPublicFingerprint = this.publicFingerprint
        const previousDesiredSourceHash = this.desiredSourceHash
        const previousRejectedSourceHash = this.rejectedSourceHash
        const previousRejectedError = this.lastRejectedError
        const diff = diffConfig(previousSnapshot, options.candidate.value, this.schema)
        const nextDocumentGeneration = this.documentGeneration + 1
        const nextEffectiveHash = hashValue(options.candidate.value)
        const effectiveChanged = nextEffectiveHash !== this.effectiveHash
        const nextEffectiveGeneration = this.effectiveGeneration + (effectiveChanged ? 1 : 0)
        const desiredEffectHash = hashValue(diff.map((entry) => ({ path: entry.path, after: entry.after, effects: entry.effects })))
        const context = {
            candidate: options.candidate.value,
            previous: previousSnapshot,
            diff,
            origin: options.origin,
            nextDocumentGeneration,
            nextEffectiveGeneration,
            desiredEffectHash,
            transactionToken,
            assertTransactionCurrent: () => this.transactionBoundary.assertCurrent(transactionToken)
        }
        await this.writer.writeJournal({
            phase: 'preparing',
            origin: options.origin,
            baseSourceHash: previousSourceHash,
            candidateSourceHash: options.sourceHash,
            desiredEffectHash,
            nextDocumentGeneration,
            nextEffectiveGeneration
        })
        await this.transactionBoundary.assertCurrent(transactionToken)
        let transaction
        try {
            transaction = await this.reloadRegistry.prepare(context)
            await this.transactionBoundary.assertCurrent(transactionToken)
        } catch (error) {
            if (Array.isArray(error.rollbackErrors) && error.rollbackErrors.length > 0) {
                this._markRecoveryRequired('runtime-prepare-rollback-failed', error, {
                    rollbackErrors: error.rollbackErrors
                })
            }
            this._recordFailure(error)
            throw error
        }
        let wroteFile = false

        try {
            await this.writer.writeJournal({
                phase: 'prepared',
                origin: options.origin,
                baseSourceHash: previousSourceHash,
                candidateSourceHash: options.sourceHash,
                desiredEffectHash,
                nextDocumentGeneration,
                nextEffectiveGeneration
            })
            if (options.persist) {
                await this.writer.writeConfig(options.source, {
                    expectedHash: options.expectedDiskHash,
                    validate: (source) => this._parseAndValidate(source),
                    beforeRename: async () => {
                        await this.transactionBoundary.assertCurrent(transactionToken)
                        const current = await this._readStableSource()
                        if (current.hash !== options.expectedDiskHash) {
                            throw new ConfigConflictError('Configuration changed before commit', {
                                conflictPaths: diff.map((entry) => entry.path.join('.'))
                            })
                        }
                        await this.transactionBoundary.assertCurrent(transactionToken)
                    }
                })
                await this.transactionBoundary.assertCurrent(transactionToken)
                wroteFile = true
                await this.writer.writeJournal({
                    phase: 'file-committed',
                    origin: options.origin,
                    baseSourceHash: previousSourceHash,
                    candidateSourceHash: options.sourceHash,
                    desiredEffectHash,
                    nextDocumentGeneration,
                    nextEffectiveGeneration
                })
            } else {
                const current = await this._readStableSource()
                if (current.hash !== options.expectedDiskHash) {
                    throw new ConfigConflictError('Configuration changed during reload', {
                        conflictPaths: diff.map((entry) => entry.path.join('.'))
                    })
                }
            }

            await this._assertCommitDiskHash(options.sourceHash, diff, 'before-handle-commit')
            await this.transactionBoundary.assertCurrent(transactionToken)
            await transaction.commit()
            await this.transactionBoundary.assertCurrent(transactionToken)
            await this._assertCommitDiskHash(options.sourceHash, diff, 'after-handle-commit')
            await transaction.validateAdmission()
            await this.transactionBoundary.assertCurrent(transactionToken)
            await this._assertCommitDiskHash(options.sourceHash, diff, 'before-snapshot-publication')
            await this.transactionBoundary.assertCurrent(transactionToken)
            this._publish({
                candidate: options.candidate,
                source: options.source,
                sourceHash: options.sourceHash,
                effectiveHash: nextEffectiveHash,
                effectiveChanged,
                nextDocumentGeneration,
                nextEffectiveGeneration
            })
            try {
                this.emit('snapshotPublished', this.activeSnapshot)
            } catch (error) {
                throw new ConfigReloadError('Snapshot publication listener failed', {
                    phase: 'snapshotPublished',
                    cause: error
                })
            }
            await this.transactionBoundary.assertCurrent(transactionToken)
            await transaction.enableIngress()
            if (wroteFile) this.pendingSelfWriteHash = options.sourceHash
            const persistenceWarnings = []
            await this.writer.writeJournal({
                phase: 'snapshot-published',
                origin: options.origin,
                sourceHash: this.sourceHash,
                effectiveHash: this.effectiveHash,
                documentGeneration: this.documentGeneration,
                effectiveGeneration: this.effectiveGeneration
            }).catch((error) => {
                persistenceWarnings.push({
                    code: 'CONFIG_JOURNAL_PERSIST_FAILED',
                    handlerId: 'config-state',
                    error
                })
            })
            await this.writer.writeLastGood(options.source, {
                documentGeneration: this.documentGeneration,
                effectiveGeneration: this.effectiveGeneration,
                sourceHash: this.sourceHash,
                effectiveHash: this.effectiveHash
            }).catch((error) => {
                persistenceWarnings.push({
                    code: 'CONFIG_LAST_GOOD_PERSIST_FAILED',
                    handlerId: 'config-state',
                    error
                })
            })

            const cleanupErrors = await transaction.postCommit()
            const result = this._buildResult(options.origin, diff, [...persistenceWarnings, ...cleanupErrors])
            this.lastReloadResult = result
            this.lastSuccessfulReloadAt = new Date().toISOString()
            try {
                this.emit('changed', result)
            } catch (error) {
                this.logger.warn('config-change-listener-failed', { code: error?.code || 'LISTENER_ERROR' })
            }
            return result
        } catch (error) {
            const rollbackErrors = await transaction.rollback().catch((rollbackError) => ([{
                handlerId: 'reload-transaction',
                phase: 'rollback',
                code: rollbackError?.code || 'CONFIG_ROLLBACK_ERROR'
            }]))
            let restoreError = null
            let externalSourcePresent = false
            if (wroteFile && previousSource) {
                try {
                    const current = await this._readStableSource()
                    if (current.hash === options.sourceHash) {
                        await this.writer.writeConfig(previousSource, {
                            expectedHash: options.sourceHash,
                            validate: (source) => this._parseAndValidate(source),
                            beforeRename: async () => {
                                await this.transactionBoundary.assertCurrent(transactionToken)
                                const latest = await this._readStableSource()
                                if (latest.hash !== options.sourceHash) {
                                    throw new ConfigConflictError('Configuration changed during rollback', {
                                        conflictPaths: diff.map((entry) => entry.path.join('.'))
                                    })
                                }
                                await this.transactionBoundary.assertCurrent(transactionToken)
                            }
                        })
                        this.pendingSelfWriteHash = previousSourceHash
                    } else {
                        externalSourcePresent = true
                    }
                } catch (candidateRestoreError) {
                    restoreError = candidateRestoreError
                    this.logger.error('config-restore-failed', {
                        code: candidateRestoreError?.code || 'CONFIG_WRITE_ERROR'
                    })
                }
            }
            this.activeSnapshot = previousSnapshot
            this.activeDocument = previousDocument
            this.activeSource = previousSource
            this.sourceHash = previousSourceHash
            this.effectiveHash = previousEffectiveHash
            this.documentGeneration = previousDocumentGeneration
            this.effectiveGeneration = previousEffectiveGeneration
            this.publicFingerprint = previousPublicFingerprint
            this.desiredSourceHash = previousDesiredSourceHash
            this.rejectedSourceHash = previousRejectedSourceHash
            this.lastRejectedError = previousRejectedError
            this.reloadRegistry.observeDocument(previousDocumentGeneration)
            try {
                this.emit('snapshotPublished', previousSnapshot)
            } catch {
                // Runtime rollback continues even if a compatibility observer is already unavailable.
            }
            if ((rollbackErrors || []).length > 0 || restoreError) {
                this._markRecoveryRequired('config-rollback-incomplete', restoreError || error, {
                    rollbackErrors: rollbackErrors || [],
                    diskRestoreFailed: Boolean(restoreError),
                    candidateSourceHash: options.sourceHash,
                    previousSourceHash
                })
                await this.writer.writeJournal({
                    phase: 'recovery-required',
                    reason: this.recoveryState.reason,
                    candidateSourceHash: options.sourceHash,
                    previousSourceHash,
                    rollbackErrors: (rollbackErrors || []).map((entry) => ({
                        handlerId: entry.handlerId,
                        phase: entry.phase,
                        code: entry.code
                    })),
                    diskRestoreFailed: Boolean(restoreError)
                }).catch(() => {})
            } else if (externalSourcePresent) {
                try {
                    await this._reloadFromDiskLocked({ source: 'post-conflict-sync' })
                } catch (reloadError) {
                    this._recordFailure(reloadError)
                }
            }
            this._recordFailure(error)
            throw error
        }
    }

    async _assertCommitDiskHash(expectedHash, diff, phase) {
        const current = await this._readStableSource()
        if (current.hash !== expectedHash) {
            throw new ConfigConflictError(`Configuration changed during ${phase}`, {
                conflictPaths: diff.map((entry) => entry.path.join('.'))
            })
        }
    }

    _markRecoveryRequired(reason, error, details = {}) {
        this.recoveryState = {
            required: true,
            reason,
            code: error?.code || 'CONFIG_RECOVERY_REQUIRED',
            since: new Date().toISOString(),
            rollbackErrors: Array.isArray(details.rollbackErrors)
                ? details.rollbackErrors.map((entry) => ({
                    handlerId: entry.handlerId,
                    phase: entry.phase,
                    code: entry.code
                }))
                : [],
            diskRestoreFailed: Boolean(details.diskRestoreFailed),
            candidateSourceHash: details.candidateSourceHash || null,
            previousSourceHash: details.previousSourceHash || null
        }
    }

    _parseAndValidate(source) {
        const parsed = parseYamlDocument(source)
        const value = validateConfig(parsed.value, { schema: this.schema })
        return { document: parsed.document, value }
    }

    async _publishInitial(candidate, source, sourceHash, transactionToken) {
        await this.transactionBoundary.assertCurrent(transactionToken)
        const effectiveHash = hashValue(candidate.value)
        this.activeDocument = candidate.document
        this.activeSource = source
        this.activeSnapshot = deepFreeze(clone(candidate.value))
        this.sourceHash = sourceHash
        this.effectiveHash = effectiveHash
        this.publicFingerprint = hashValue(toPublicConfig(candidate.value, this.schema))
        this.documentGeneration = 1
        this.effectiveGeneration = 1
        this.reloadRegistry.observeDocument(this.documentGeneration)
        this.lastSuccessfulReloadAt = new Date().toISOString()
        await this.transactionBoundary.assertCurrent(transactionToken)
        await this.writer.ensureDirectories()
        await this.writer.writeLastGood(source, {
            documentGeneration: 1,
            effectiveGeneration: 1,
            sourceHash,
            effectiveHash
        })
    }

    _publish(state) {
        this.activeDocument = state.candidate.document
        this.activeSource = state.source
        this.activeSnapshot = deepFreeze(clone(state.candidate.value))
        this.sourceHash = state.sourceHash
        this.effectiveHash = state.effectiveHash
        this.publicFingerprint = hashValue(toPublicConfig(state.candidate.value, this.schema))
        this.documentGeneration = state.nextDocumentGeneration
        this.effectiveGeneration = state.nextEffectiveGeneration
        this.desiredSourceHash = null
        this.rejectedSourceHash = null
        this.lastRejectedError = null
        this.reloadRegistry.observeDocument(this.documentGeneration)
    }

    async _readStableSource(attempts = 4) {
        let lastError
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const data = await readAnchoredPrivateFile(this.configPath, {
                    fsPromises: this.fsPromises,
                    mode: 0o600
                })
                const source = data.toString('utf8')
                return { source, hash: hashBytes(source) }
            } catch (error) {
                lastError = error
                if (error?.code === 'ENOENT') throw new ConfigParseError('Configuration file is missing')
                if (error instanceof ConfigParseError) throw error
                if (error?.reason && error.reason !== 'CONFIG_READ_CHANGED') {
                    throw new ConfigParseError('Configuration path is not a safe private regular file')
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw lastError || new ConfigParseError('Configuration file did not become stable')
    }

    _assertExpectedGeneration(expectedGeneration) {
        if (expectedGeneration === undefined || expectedGeneration === null) return
        if (Number(expectedGeneration) !== this.documentGeneration) {
            throw new ConfigConflictError(undefined, { conflictPaths: [] })
        }
    }

    _assertLoaded() {
        if (!this.activeSnapshot) throw new Error('ConfigService is not initialized')
    }

    _assertRecoverySafe() {
        if (!this.recoveryState?.required) return
        throw new ConfigReloadError('Configuration recovery is required before further mutations', {
            phase: 'recovery-required'
        })
    }

    _enqueueTransaction(fn) {
        if (this.stopped) {
            const error = new Error('ConfigService is stopping or stopped')
            error.code = 'CONFIG_SERVICE_STOPPED'
            error.statusCode = 503
            return Promise.reject(error)
        }
        const execute = async () => {
            const transactionToken = await this.transactionBoundary.assertCurrent()
            return fn(transactionToken)
        }
        const next = this.transactionChain.then(execute, execute)
        this.transactionChain = next.catch(() => {})
        return next
    }

    _recordFailure(error) {
        this.lastFailedReloadAt = new Date().toISOString()
        this.lastRejectedError = toPublicError(error)
        this.logger.warn('config-operation-failed', {
            code: error?.code || 'CONFIG_ERROR',
            path: error?.path || ''
        })
    }

    _emptyResult(origin) {
        const deployment = this._getDeploymentStatus()
        return {
            origin,
            documentGeneration: this.documentGeneration,
            effectiveGeneration: this.effectiveGeneration,
            generation: this.documentGeneration,
            applied: [],
            reloaded: [],
            deploymentApplyRequired: [...deployment.pendingPaths],
            warnings: []
        }
    }

    _buildResult(origin, diff, cleanupErrors) {
        const effects = [...new Set(diff.flatMap((entry) => entry.effects || []))]
        const deployment = this._getDeploymentStatus()
        return {
            origin,
            documentGeneration: this.documentGeneration,
            effectiveGeneration: this.effectiveGeneration,
            generation: this.documentGeneration,
            applied: diff.map((entry) => entry.path.join('.')),
            reloaded: effects.filter((effect) => effect !== 'deployment'),
            deploymentApplyRequired: [...deployment.pendingPaths],
            warnings: cleanupErrors.map((entry) => ({
                code: entry.code || 'CONFIG_CLEANUP_PENDING',
                component: entry.handlerId
            })),
            diff: toPublicDiff(diff)
        }
    }

    get(pathOrKey) {
        this._assertLoaded()
        return clone(getIn(this.activeSnapshot, pathOrKey))
    }

    getSnapshot() {
        this._assertLoaded()
        return this.activeSnapshot
    }

    getDocument() {
        this._assertLoaded()
        return cloneYamlDocument(this.activeDocument)
    }

    getSource() {
        this._assertLoaded()
        return this.activeSource
    }

    getPublicSnapshot() {
        this._assertLoaded()
        return deepFreeze(toPublicConfig(this.activeSnapshot, this.schema))
    }

    toPublicConfig(value = this.activeSnapshot) {
        return toPublicConfig(value, this.schema)
    }

    toPublicDiff(diff) {
        return toPublicDiff(diff)
    }

    toPublicError(error) {
        return toPublicError(error)
    }

    getStatus() {
        const deployment = this._getDeploymentStatus()
        return {
            valid: Boolean(this.activeSnapshot),
            schemaVersion: CONFIG_SCHEMA_VERSION,
            documentGeneration: this.documentGeneration,
            effectiveGeneration: this.effectiveGeneration,
            generation: this.documentGeneration,
            fingerprint: this.publicFingerprint,
            lastSuccessfulReloadAt: this.lastSuccessfulReloadAt,
            lastFailedReloadAt: this.lastFailedReloadAt,
            rejected: this.rejectedSourceHash
                ? { error: this.lastRejectedError }
                : null,
            degraded: Boolean(this.recoveryState?.required),
            recoveryRequired: this.recoveryState
                ? {
                    required: true,
                    reason: this.recoveryState.reason,
                    code: this.recoveryState.code,
                    since: this.recoveryState.since,
                    rollbackErrors: this.recoveryState.rollbackErrors,
                    diskRestoreFailed: this.recoveryState.diskRestoreFailed
                }
                : null,
            applicationAdmission: this.reloadRegistry.admissionGate.snapshot(),
            pendingRuntimeRecovery: this.reloadRegistry.getPendingRecoveryStatus(),
            deployment,
            pendingDeploymentApply: [...deployment.pendingPaths],
            components: this.reloadRegistry.getStatus()
        }
    }

    _getDeploymentStatus() {
        if (!this.activeSnapshot) {
            return {
                baselineAvailable: false,
                appliedGeneration: null,
                appliedFingerprint: null,
                desiredFingerprint: null,
                pendingApplyRequired: false,
                pendingPaths: [],
                appliedAt: null,
                releaseEpoch: null
            }
        }
        try {
            const baseline = readDeploymentBaseline(this.deploymentBaselinePath, { fsModule: this.fs })
            this.deploymentBaselineError = null
            return deploymentStatus(this.activeSnapshot, baseline, this.schema)
        } catch (error) {
            this.deploymentBaselineError = {
                code: typeof error?.message === 'string' && /^DEPLOYMENT_BASELINE_[A-Z0-9_]+$/.test(error.message)
                    ? error.message
                    : 'DEPLOYMENT_BASELINE_INVALID'
            }
            const status = deploymentStatus(this.activeSnapshot, null, this.schema)
            return { ...status, error: this.deploymentBaselineError }
        }
    }

    registerReloadHandler(handler) {
        const unregister = this.reloadRegistry.register(handler)
        if (this.activeSnapshot) {
            const status = this.reloadRegistry.componentStatus.get(handler.id)
            if (status) {
                const initialEffectHash = hashValue({
                    handlerId: handler.id,
                    documentGeneration: this.documentGeneration
                })
                status.observedDocumentGeneration = this.documentGeneration
                status.appliedEffectHash = initialEffectHash
                status.desiredEffectHash = initialEffectHash
            }
        }
        return unregister
    }
}

function createCompatibilityFacade(service, options = {}) {
    const methods = {
        getConfigSnapshot: () => service.getPublicSnapshot(),
        getDashboardConfigSnapshot: () => service.getPublicSnapshot(),
        patch: (...args) => service.patch(...args),
        update: (...args) => service.update(...args),
        reload: (...args) => service.reload(...args),
        recover: (...args) => service.recover(...args),
        getStatus: () => service.getStatus(),
        ...(options.methods || {})
    }

    return new Proxy(methods, {
        get(target, property, receiver) {
            if (Reflect.has(target, property)) return Reflect.get(target, property, receiver)
            if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, property)) {
                return service.get(property)
            }
            return undefined
        },
        set() {
            throw new TypeError('Direct configuration assignment is not supported; use ConfigService.patch()')
        },
        ownKeys(target) {
            return [...new Set([...Reflect.ownKeys(target), ...Object.keys(FLAT_KEY_TO_PATH)])]
        },
        getOwnPropertyDescriptor(target, property) {
            if (Reflect.has(target, property)) return Reflect.getOwnPropertyDescriptor(target, property)
            if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(FLAT_KEY_TO_PATH, property)) {
                return { enumerable: true, configurable: true }
            }
            return undefined
        }
    })
}

function createConfigService(options) {
    return new ConfigService(options)
}

module.exports = {
    ConfigService,
    createConfigService,
    createCompatibilityFacade,
    normalizePatch
}
