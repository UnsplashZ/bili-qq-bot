'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
    atomicWriteJson,
    atomicWriteFile,
    copyPrivateFile,
    ensurePrivateDir,
    hashFile,
    sha256,
    fsyncDirectory,
} = require('../common/atomicFile')
const { readPrivateFile, readPrivateText, hashPrivateFile } = require('../common/privateFile')
const { MigrationError } = require('../common/errors')
const { scanDataInventory, compareDataInventories } = require('./inventory')

const JOURNAL_VERSION = 1
const JOURNAL_PHASES = new Set([
    'backup_ready', 'applying', 'applied', 'validated', 'state_committed',
    'rollback_started', 'data_restored', 'state_reverted', 'rollback_complete'
])
const JOURNAL_KEYS = new Set([
    'journalVersion', 'migratorId', 'fromVersion', 'toVersion', 'attemptId', 'phase',
    'sourceFingerprint', 'sourceHashes', 'beforeInventory', 'artifacts', 'artifactHashes',
    'createdAt', 'updatedAt'
])

function validateMigrator(migrator) {
    if (!migrator || typeof migrator !== 'object') throw new MigrationError('DATA_MIGRATOR_INVALID')
    if (typeof migrator.id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(migrator.id)) throw new MigrationError('DATA_MIGRATOR_ID_INVALID')
    if (!Number.isInteger(migrator.fromVersion) || !Number.isInteger(migrator.toVersion) || migrator.toVersion <= migrator.fromVersion) {
        throw new MigrationError('DATA_MIGRATOR_VERSION_INVALID')
    }
    for (const method of ['detect', 'backup', 'migrate', 'validate', 'rollback']) {
        if (typeof migrator[method] !== 'function') throw new MigrationError('DATA_MIGRATOR_METHOD_MISSING')
    }
    if (migrator.touchedPaths !== undefined && (!Array.isArray(migrator.touchedPaths) || migrator.touchedPaths.some((item) => typeof item !== 'string'))) {
        throw new MigrationError('DATA_MIGRATOR_TOUCHED_PATH_INVALID')
    }
    if (migrator.sourcePaths !== undefined && (!Array.isArray(migrator.sourcePaths) ||
        migrator.sourcePaths.some((item) => !isSafeDataRelativePath(item)))) {
        throw new MigrationError('DATA_MIGRATOR_SOURCE_PATH_INVALID')
    }
    if ((migrator.touchedPaths || []).length > 0 && typeof migrator.validateTouched !== 'function') {
        throw new MigrationError('DATA_MIGRATOR_TOUCHED_VALIDATOR_REQUIRED')
    }
    return migrator
}

function isSafeArtifactName(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) return false
    const normalized = path.posix.normalize(value)
    return normalized !== '..' && !normalized.startsWith('../') && normalized.split('/').every((part) => /^[a-zA-Z0-9._-]+$/.test(part))
}

function isSafeDataRelativePath(value) {
    return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !path.posix.isAbsolute(value) &&
        !path.posix.normalize(value).startsWith('../') && path.posix.normalize(value) !== '..'
}

function createValidationMigrator() {
    return {
        id: 'v1-preserve-inventory',
        fromVersion: 0,
        toVersion: 1,
        touchedPaths: [],
        async detect(context) {
            return context.currentVersion < 1
        },
        async backup() {
            return { artifacts: [] }
        },
        async migrate(context) {
            return { changed: false, inventory: context.beforeInventory }
        },
        async validate(context) {
            const after = scanDataInventory(context.dataDir)
            compareDataInventories(context.beforeInventory, after)
            return { valid: true, inventory: after }
        },
        async rollback() {
            return { changed: false }
        }
    }
}

class DataMigrationRegistry {
    constructor(options = {}) {
        this.dataDir = path.resolve(options.dataDir)
        this.statePath = path.resolve(options.statePath || path.join(this.dataDir, 'migrations', 'data-schema-state.json'))
        this.migrationDir = path.resolve(options.migrationDir || path.join(this.dataDir, 'migrations', 'data'))
        this.migrators = (options.migrators || [createValidationMigrator()]).map(validateMigrator).sort((left, right) => left.fromVersion - right.fromVersion)
        this.faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null
    }

    readState() {
        let state
        try {
            state = JSON.parse(readPrivateText(this.statePath))
        } catch (error) {
            if (error?.code === 'ENOENT') return { schemaVersion: 0, applied: [], history: [], backups: {} }
            if (error instanceof MigrationError) throw error
            throw new MigrationError('DATA_SCHEMA_STATE_INVALID')
        }
        if (!state || !Number.isInteger(state.schemaVersion) || !Array.isArray(state.applied) || !Array.isArray(state.history) ||
            (state.backups !== undefined && (!state.backups || typeof state.backups !== 'object' || Array.isArray(state.backups)))) {
            throw new MigrationError('DATA_SCHEMA_STATE_INVALID')
        }
        state.backups = state.backups || {}
        for (const [migrationId, artifacts] of Object.entries(state.backups)) {
            if (!/^[a-zA-Z0-9._-]+$/.test(migrationId) || !Array.isArray(artifacts) || artifacts.some((item) => !isSafeArtifactName(item))) {
                throw new MigrationError('DATA_SCHEMA_STATE_INVALID')
            }
        }
        return state
    }

    journalPath(migratorId) {
        return path.join(this.migrationDir, `${migratorId}.journal.json`)
    }

    rollbackTerminalPath(migrator, attemptId) {
        return path.join(this.migrationDir, 'retained', 'rollback-complete', `${migrator.id}.${attemptId}.journal.json`)
    }

    rollbackClaimPath(migrator, attemptId) {
        const claimDir = path.join(this.migrationDir, 'retained', 'rollback-attempts',
            `${migrator.id}.${attemptId}.${crypto.randomBytes(16).toString('hex')}`)
        fs.mkdirSync(claimDir, { mode: 0o700 })
        fsyncDirectory(path.dirname(claimDir))
        return path.join(claimDir, 'journal.json')
    }

    readJournal(migrator) {
        const journalPath = this.journalPath(migrator.id)
        let journal
        try {
            journal = JSON.parse(readPrivateText(journalPath))
        } catch (error) {
            if (error?.code === 'ENOENT') return null
            if (error instanceof MigrationError) throw error
            throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        if (!journal || journal.journalVersion !== JOURNAL_VERSION || journal.migratorId !== migrator.id ||
            journal.fromVersion !== migrator.fromVersion || journal.toVersion !== migrator.toVersion ||
            typeof journal.attemptId !== 'string' || !/^[a-f0-9]{32}$/.test(journal.attemptId) ||
            !JOURNAL_PHASES.has(journal.phase) || typeof journal.sourceFingerprint !== 'string' ||
            !/^[a-f0-9]{64}$/.test(journal.sourceFingerprint) || !Array.isArray(journal.artifacts) ||
            journal.artifacts.some((item) => !isSafeArtifactName(item)) || !journal.artifactHashes || typeof journal.artifactHashes !== 'object' ||
            !journal.sourceHashes || typeof journal.sourceHashes !== 'object' || !journal.beforeInventory ||
            journal.beforeInventory.version !== 1 || !journal.beforeInventory.strong || !journal.beforeInventory.preserve ||
            Object.keys(journal).some((key) => !JOURNAL_KEYS.has(key))) {
            throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        const calculatedFingerprint = crypto.createHash('sha256')
            .update(JSON.stringify({ strong: journal.beforeInventory.strong, preserve: journal.beforeInventory.preserve }))
            .digest('hex')
        if (calculatedFingerprint !== journal.sourceFingerprint || journal.beforeInventory.fingerprint !== journal.sourceFingerprint) {
            throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        for (const [relativePath, expectedHash] of Object.entries(journal.sourceHashes)) {
            if (!isSafeDataRelativePath(relativePath) || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        if (Object.keys(journal.artifactHashes).sort().join('\n') !== [...journal.artifacts].sort().join('\n')) {
            throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        for (const artifact of journal.artifacts) {
            const expectedHash = journal.artifactHashes[artifact]
            const artifactPath = path.join(this.migrationDir, artifact)
            if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) {
                throw new MigrationError('DATA_MIGRATION_BACKUP_INVALID')
            }
            try {
                if (hashPrivateFile(artifactPath) !== expectedHash) throw new MigrationError('DATA_MIGRATION_BACKUP_INVALID')
            } catch (error) {
                if (error?.code === 'ENOENT') throw new MigrationError('DATA_MIGRATION_BACKUP_INVALID')
                throw error
            }
        }
        return journal
    }

    writeJournal(migrator, journal, phase) {
        const next = { ...journal, phase, updatedAt: new Date().toISOString() }
        atomicWriteJson(this.journalPath(migrator.id), next, { mode: 0o600 })
        if (this.faultInjector) this.faultInjector(phase, { migratorId: migrator.id, journal: next })
        return next
    }

    async check() {
        const state = this.readState()
        const inventory = scanDataInventory(this.dataDir)
        const pending = []
        let version = state.schemaVersion
        for (const migrator of this.migrators) {
            if (migrator.fromVersion !== version) continue
            const needed = await migrator.detect({ dataDir: this.dataDir, currentVersion: version, beforeInventory: inventory, state })
            if (needed) {
                pending.push(migrator.id)
                version = migrator.toVersion
            }
        }
        return { currentVersion: state.schemaVersion, targetVersion: version, pending, inventory }
    }

    async createBackup(migrator, context) {
        const attemptId = crypto.randomBytes(16).toString('hex')
        const attemptDirName = `${migrator.id}.${attemptId}`
        const attemptDir = path.join(this.migrationDir, attemptDirName)
        fs.mkdirSync(attemptDir, { mode: 0o700 })
        try {
            if (this.faultInjector) this.faultInjector('backup_capture_start', { migratorId: migrator.id })
            const captureInventory = scanDataInventory(this.dataDir)
            if (captureInventory.fingerprint !== context.beforeInventory.fingerprint) {
                throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
            }
            const sourceCaptures = {}
            for (const relativePath of migrator.sourcePaths || []) {
                const sourcePath = path.join(this.dataDir, relativePath)
                try {
                    const data = readPrivateFile(sourcePath, {
                        mode: null,
                        fileCode: 'MIGRATION_SOURCE_FILE_REQUIRED',
                        changedCode: 'MIGRATION_SOURCE_CHANGED'
                    }).data
                    sourceCaptures[relativePath] = { data, hash: sha256(data) }
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error
                    sourceCaptures[relativePath] = null
                }
            }
            if (this.faultInjector) this.faultInjector('backup_captured', { migratorId: migrator.id, sourceCaptures })
            const capturedArtifactHashes = {}
            const backup = await migrator.backup({
                ...context,
                attemptId,
                migrationDir: attemptDir,
                sourceCaptures,
                copyBackup(sourcePath, artifactName) {
                    if (!isSafeArtifactName(artifactName) || artifactName.includes('/')) throw new MigrationError('DATA_MIGRATION_BACKUP_ARTIFACT_INVALID')
                    const relativePath = path.relative(context.dataDir, sourcePath).split(path.sep).join('/')
                    const capture = sourceCaptures[relativePath]
                    if (!capture || !Buffer.isBuffer(capture.data)) throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
                    atomicWriteFile(path.join(attemptDir, artifactName), capture.data, { mode: 0o600, overwrite: false })
                    capturedArtifactHashes[artifactName] = capture.hash
                    return { artifactName, data: capture.data, hash: capture.hash }
                }
            })
            const localArtifacts = Array.isArray(backup?.artifacts) ? backup.artifacts : []
            if (localArtifacts.some((item) => !isSafeArtifactName(item) || item.includes('/'))) {
                throw new MigrationError('DATA_MIGRATION_BACKUP_ARTIFACT_INVALID')
            }
            const artifacts = localArtifacts.map((item) => `${attemptDirName}/${item}`)
            const artifactHashes = Object.fromEntries(localArtifacts.map((item, index) => {
                const artifactPath = path.join(attemptDir, item)
                const expectedHash = capturedArtifactHashes[item] || hashFile(artifactPath)
                // A journal is a promise that every byte needed for recovery is
                // already durable and readable. Verify that promise before it is published.
                if (hashPrivateFile(artifactPath) !== expectedHash) throw new MigrationError('DATA_MIGRATION_BACKUP_INVALID')
                return [artifacts[index], expectedHash]
            }))
            const sourceHashes = backup?.sourceHashes || {}
            if (!sourceHashes || typeof sourceHashes !== 'object' || Array.isArray(sourceHashes) ||
                Object.entries(sourceHashes).some(([relativePath, hash]) => !isSafeDataRelativePath(relativePath) || !/^[a-f0-9]{64}$/.test(hash))) {
                throw new MigrationError('DATA_MIGRATION_BACKUP_SOURCE_HASH_INVALID')
            }
            for (const [relativePath, capture] of Object.entries(sourceCaptures)) {
                if (!capture || sourceHashes[relativePath] !== capture.hash) throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
                if (hashPrivateFile(path.join(this.dataDir, relativePath), { mode: null }) !== capture.hash) {
                    throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
                }
            }
            const finalInventory = scanDataInventory(this.dataDir)
            if (finalInventory.fingerprint !== context.beforeInventory.fingerprint) {
                throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
            }
            const journal = {
                journalVersion: JOURNAL_VERSION,
                migratorId: migrator.id,
                fromVersion: migrator.fromVersion,
                toVersion: migrator.toVersion,
                attemptId,
                phase: 'backup_ready',
                sourceFingerprint: context.beforeInventory.fingerprint,
                sourceHashes,
                beforeInventory: context.beforeInventory,
                artifacts,
                artifactHashes,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
            atomicWriteJson(this.journalPath(migrator.id), journal, { mode: 0o600, overwrite: false })
            if (this.faultInjector) this.faultInjector('backup_ready', { migratorId: migrator.id, journal })
            return journal
        } catch (error) {
            if (!fs.existsSync(this.journalPath(migrator.id))) {
                fs.rmSync(attemptDir, { recursive: true, force: true })
                fsyncDirectory(this.migrationDir)
            }
            throw error
        }
    }

    validateJournalSources(journal) {
        for (const [relativePath, expectedHash] of Object.entries(journal.sourceHashes)) {
            const sourcePath = path.join(this.dataDir, relativePath)
            try {
                if (hashPrivateFile(sourcePath, { mode: null }) !== expectedHash) {
                    throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
                }
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error
                throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
            }
        }
    }

    contextForJournal(migrator, journal, state) {
        const attemptDirName = `${migrator.id}.${journal.attemptId}`
        const localArtifacts = journal.artifacts.map((item) => {
            if (!item.startsWith(`${attemptDirName}/`)) throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
            return item.slice(attemptDirName.length + 1)
        })
        return {
            dataDir: this.dataDir,
            migrationDir: path.join(this.migrationDir, attemptDirName),
            currentVersion: migrator.fromVersion,
            beforeInventory: journal.beforeInventory,
            state,
            attemptId: journal.attemptId,
            backup: { artifacts: localArtifacts }
        }
    }

    async recoverApplying(migrator, journal, state) {
        const context = this.contextForJournal(migrator, journal, state)
        await migrator.rollback(context)
        const restored = scanDataInventory(this.dataDir)
        compareDataInventories(journal.beforeInventory, restored)
        this.validateJournalSources(journal)
        return this.writeJournal(migrator, journal, 'backup_ready')
    }

    touchedComparisonOptions(completed) {
        const touchedPaths = []
        const touchedValidators = {}
        for (const item of completed) {
            for (const touchedPath of item.migrator.touchedPaths || []) {
                touchedPaths.push(touchedPath)
                touchedValidators[touchedPath] = (before, after) => item.migrator.validateTouched(touchedPath, before, after) === true
            }
        }
        return { touchedPaths: [...new Set(touchedPaths)], touchedValidators }
    }

    async apply() {
        ensurePrivateDir(path.dirname(this.statePath))
        ensurePrivateDir(this.migrationDir)
        let state = this.readState()
        const initialInventory = scanDataInventory(this.dataDir)
        const completed = []
        const invocationMigrators = []
        let currentVersion = state.schemaVersion
        try {
            for (const migrator of this.migrators) {
                let journal = this.readJournal(migrator)
                if (journal?.phase === 'validated' && state.applied.includes(migrator.id) && state.schemaVersion >= migrator.toVersion) {
                    journal = this.writeJournal(migrator, journal, 'state_committed')
                }
                if (journal?.phase === 'state_committed') {
                    if (!state.applied.includes(migrator.id) || state.schemaVersion < migrator.toVersion) {
                        throw new MigrationError('DATA_MIGRATION_STATE_JOURNAL_CONFLICT')
                    }
                    currentVersion = state.schemaVersion
                    continue
                }
                if (journal && ['rollback_started', 'data_restored', 'state_reverted', 'rollback_complete'].includes(journal.phase)) {
                    throw new MigrationError('DATA_ROLLBACK_RECOVERY_REQUIRED')
                }
                if (migrator.fromVersion !== currentVersion) continue
                if (!journal) {
                    const detectContext = { dataDir: this.dataDir, currentVersion, beforeInventory: scanDataInventory(this.dataDir), state }
                    if (!await migrator.detect(detectContext)) continue
                    journal = await this.createBackup(migrator, detectContext)
                }
                invocationMigrators.push(migrator)
                if (journal.sourceFingerprint !== journal.beforeInventory?.fingerprint) throw new MigrationError('DATA_MIGRATION_SOURCE_CONFLICT')
                if (journal.phase === 'applying') journal = await this.recoverApplying(migrator, journal, state)
                const context = this.contextForJournal(migrator, journal, state)
                let result = null
                if (journal.phase === 'backup_ready') {
                    this.validateJournalSources(journal)
                    journal = this.writeJournal(migrator, journal, 'applying')
                    result = await migrator.migrate(context)
                    journal = this.writeJournal(migrator, journal, 'applied')
                }
                if (journal.phase === 'applied') {
                    const validation = await migrator.validate({ ...context, result })
                    if (!validation || validation.valid !== true) throw new MigrationError('DATA_MIGRATION_VALIDATION_FAILED')
                    journal = this.writeJournal(migrator, journal, 'validated')
                }
                if (journal.phase === 'validated') {
                    state.schemaVersion = migrator.toVersion
                    if (!state.applied.includes(migrator.id)) state.applied.push(migrator.id)
                    state.backups[migrator.id] = [...journal.artifacts]
                    if (!state.history.some((entry) => entry.id === migrator.id && entry.attemptId === journal.attemptId && entry.appliedAt)) {
                        state.history.push({ id: migrator.id, attemptId: journal.attemptId, toVersion: migrator.toVersion, appliedAt: new Date().toISOString() })
                    }
                    state.inventoryFingerprint = scanDataInventory(this.dataDir).fingerprint
                    atomicWriteJson(this.statePath, state, { mode: 0o600 })
                    journal = this.writeJournal(migrator, journal, 'state_committed')
                }
                completed.push({ migrator, journal })
                currentVersion = migrator.toVersion
            }
            const afterInventory = scanDataInventory(this.dataDir)
            compareDataInventories(initialInventory, afterInventory, this.touchedComparisonOptions(completed))
            state = this.readState()
            state.inventoryFingerprint = afterInventory.fingerprint
            atomicWriteJson(this.statePath, state, { mode: 0o600 })
            return { changed: completed.length > 0, state, beforeInventory: initialInventory, afterInventory }
        } catch (error) {
            if (error?.code === 'DATA_MIGRATION_CRASH_SIMULATED') throw error
            const failures = []
            for (const migrator of [...invocationMigrators].reverse()) {
                try {
                    const journal = this.readJournal(migrator)
                    if (!journal || journal.phase === 'backup_ready') continue
                    if (!['applying', 'applied', 'validated', 'state_committed', 'rollback_started', 'data_restored', 'state_reverted', 'rollback_complete'].includes(journal.phase)) continue
                    const result = await this.rollbackJournalToCompletion(migrator, journal, state)
                    state = result.state
                } catch (rollbackError) {
                    failures.push({ migratorId: migrator.id, code: rollbackError?.code || 'DATA_ROLLBACK_FAILED' })
                    break
                }
            }
            if (failures.length > 0) {
                throw new MigrationError('DATA_ROLLBACK_RECOVERY_REQUIRED', 'DATA_ROLLBACK_RECOVERY_REQUIRED', {
                    failures,
                    originalCode: error?.code || 'DATA_MIGRATION_FAILED'
                })
            }
            if (['DATA_MIGRATION_BACKUP_INVALID', 'DATA_MIGRATION_JOURNAL_INVALID'].includes(error?.code)) {
                throw new MigrationError('DATA_ROLLBACK_RECOVERY_REQUIRED', 'DATA_ROLLBACK_RECOVERY_REQUIRED', {
                    failures: [],
                    originalCode: error.code
                })
            }
            throw error
        }
    }

    persistRevertedState(state, migrator, journal) {
        const wasApplied = state.applied.includes(migrator.id)
        if (wasApplied) {
            state.applied = state.applied.filter((id) => id !== migrator.id)
            delete state.backups[migrator.id]
            state.schemaVersion = migrator.fromVersion
            if (!state.history.some((entry) => entry.id === migrator.id && entry.attemptId === journal.attemptId && entry.rolledBackAt)) {
                state.history.push({
                    id: migrator.id,
                    attemptId: journal.attemptId,
                    toVersion: migrator.fromVersion,
                    rolledBackAt: new Date().toISOString()
                })
            }
            state.inventoryFingerprint = scanDataInventory(this.dataDir).fingerprint
            atomicWriteJson(this.statePath, state, { mode: 0o600 })
            return true
        }
        if (state.schemaVersion > migrator.fromVersion || state.backups[migrator.id]) {
            throw new MigrationError('DATA_ROLLBACK_STATE_CONFLICT')
        }
        return false
    }

    retainCompletedJournal(migrator, journal) {
        const activePath = this.journalPath(migrator.id)
        const terminalPath = this.rollbackTerminalPath(migrator, journal.attemptId)
        ensurePrivateDir(path.dirname(terminalPath))
        ensurePrivateDir(path.join(this.migrationDir, 'retained', 'rollback-attempts'))
        const claimPath = this.rollbackClaimPath(migrator, journal.attemptId)
        fs.renameSync(activePath, claimPath)
        fsyncDirectory(path.dirname(claimPath))
        fsyncDirectory(this.migrationDir)
        if (this.faultInjector) this.faultInjector('rollback_claim_moved', {
            migratorId: migrator.id,
            attemptId: journal.attemptId,
            journalPath: activePath,
            terminalPath,
            claimPath
        })

        const claimed = readPrivateFile(claimPath, { beforeRead() {}, changedCode: 'DATA_MIGRATION_JOURNAL_CHANGED' })
        let parsed
        try { parsed = JSON.parse(claimed.data.toString('utf8')) } catch { throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID') }
        if (parsed.phase !== 'rollback_complete' || parsed.migratorId !== migrator.id ||
            parsed.attemptId !== journal.attemptId || parsed.fromVersion !== migrator.fromVersion ||
            parsed.toVersion !== migrator.toVersion) {
            throw new MigrationError('DATA_MIGRATION_JOURNAL_INVALID')
        }
        try {
            atomicWriteFile(terminalPath, claimed.data, { mode: 0o600, overwrite: false })
            fsyncDirectory(path.dirname(terminalPath))
        } catch (error) {
            if (error?.code !== 'MIGRATION_TARGET_EXISTS') throw error
            const terminal = readPrivateFile(terminalPath, { beforeRead() {} })
            if (sha256(terminal.data) !== sha256(claimed.data) || !terminal.data.equals(claimed.data)) {
                throw new MigrationError('DATA_ROLLBACK_TERMINAL_CONFLICT')
            }
        }
        if (this.faultInjector) this.faultInjector('rollback_terminal_published', {
            migratorId: migrator.id,
            attemptId: journal.attemptId,
            journalPath: activePath,
            terminalPath,
            claimPath
        })
        if (this.faultInjector) this.faultInjector('rollback_claim_verified', {
            migratorId: migrator.id,
            attemptId: journal.attemptId,
            journalPath: activePath,
            terminalPath,
            claimPath
        })
        return terminalPath
    }

    async rollbackJournalToCompletion(migrator, initialJournal, initialState) {
        let journal = initialJournal
        let state = initialState
        let changed = false
        if (['applying', 'applied', 'validated', 'state_committed'].includes(journal.phase)) {
            journal = this.writeJournal(migrator, journal, 'rollback_started')
        }
        if (journal.phase === 'rollback_started') {
            const result = await migrator.rollback(this.contextForJournal(migrator, journal, state))
            const restored = scanDataInventory(this.dataDir)
            compareDataInventories(journal.beforeInventory, restored)
            this.validateJournalSources(journal)
            changed = Boolean(result?.changed)
            journal = this.writeJournal(migrator, journal, 'data_restored')
        }
        if (journal.phase === 'data_restored') {
            const restored = scanDataInventory(this.dataDir)
            compareDataInventories(journal.beforeInventory, restored)
            this.validateJournalSources(journal)
            changed = this.persistRevertedState(state, migrator, journal) || changed
            journal = this.writeJournal(migrator, journal, 'state_reverted')
        }
        if (journal.phase === 'state_reverted') {
            const restored = scanDataInventory(this.dataDir)
            compareDataInventories(journal.beforeInventory, restored)
            this.validateJournalSources(journal)
            state = this.readState()
            if (state.applied.includes(migrator.id) || state.schemaVersion > migrator.fromVersion || state.backups[migrator.id]) {
                throw new MigrationError('DATA_ROLLBACK_STATE_CONFLICT')
            }
            journal = this.writeJournal(migrator, journal, 'rollback_complete')
        }
        if (journal.phase === 'rollback_complete') this.retainCompletedJournal(migrator, journal)
        state = this.readState()
        return { changed, state }
    }

    async rollback() {
        ensurePrivateDir(path.dirname(this.statePath))
        ensurePrivateDir(this.migrationDir)
        const failures = []
        let changed = false
        let state = this.readState()
        for (const migrator of [...this.migrators].reverse()) {
            try {
                let journal = this.readJournal(migrator)
                const isApplied = state.applied.includes(migrator.id)
                if (!journal) {
                    if (isApplied) throw new MigrationError('DATA_MIGRATION_JOURNAL_REQUIRED')
                    continue
                }
                if (!isApplied && journal.phase === 'state_committed') throw new MigrationError('DATA_ROLLBACK_STATE_CONFLICT')
                if (!isApplied && journal.phase === 'backup_ready') continue
                if (!['applying', 'applied', 'validated', 'state_committed', 'rollback_started', 'data_restored', 'state_reverted', 'rollback_complete'].includes(journal.phase)) {
                    throw new MigrationError('DATA_ROLLBACK_PHASE_INVALID')
                }
                const result = await this.rollbackJournalToCompletion(migrator, journal, state)
                changed = result.changed || changed
                state = result.state
            } catch (error) {
                if (error?.code === 'DATA_MIGRATION_CRASH_SIMULATED') throw error
                failures.push({ migratorId: migrator.id, code: error?.code || 'DATA_ROLLBACK_FAILED' })
                break
            }
        }
        if (failures.length > 0) {
            throw new MigrationError('DATA_ROLLBACK_RECOVERY_REQUIRED', 'DATA_ROLLBACK_RECOVERY_REQUIRED', { failures })
        }
        return { changed, state }
    }
}

function createJsonFileMigrator(options) {
    const relativePath = String(options.relativePath || '')
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
        throw new MigrationError('DATA_MIGRATOR_PATH_INVALID')
    }
    return validateMigrator({
        id: options.id,
        fromVersion: options.fromVersion,
        toVersion: options.toVersion,
        sourcePaths: [relativePath],
        touchedPaths: options.touchedPaths || [],
        validateTouched: options.validateTouched,
        async detect(context) {
            return options.detect ? options.detect(context) : fs.existsSync(path.join(context.dataDir, relativePath))
        },
        async backup(context) {
            const source = path.join(context.dataDir, relativePath)
            const capture = context.sourceCaptures?.[relativePath]
            if (!capture) return { artifacts: [] }
            const copied = context.copyBackup(source, `${options.id}-${path.basename(relativePath)}.backup`)
            try {
                JSON.parse(copied.data.toString('utf8'))
            } catch (error) {
                throw new MigrationError('DATA_JSON_INVALID')
            }
            return { artifacts: [copied.artifactName], sourceHashes: { [relativePath]: copied.hash } }
        },
        async migrate(context) {
            return options.migrate(context)
        },
        async validate(context) {
            return options.validate(context)
        },
        async rollback(context) {
            const artifact = context.backup?.artifacts?.[0]
            if (!artifact) return { changed: false }
            copyPrivateFile(path.join(context.migrationDir, artifact), path.join(context.dataDir, relativePath))
            return { changed: true }
        }
    })
}

module.exports = {
    DataMigrationRegistry,
    createValidationMigrator,
    createJsonFileMigrator,
    validateMigrator,
    JOURNAL_PHASES
}
