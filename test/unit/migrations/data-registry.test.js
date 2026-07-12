'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
    DataMigrationRegistry,
    createJsonFileMigrator
} = require('../../../src/migrations/data/registry')

function createDataDir() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-data-registry-'))
    fs.writeFileSync(path.join(root, 'sample.json'), '{"version":0,"value":"before"}\n')
    return root
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function createMigrator({ valid = true } = {}) {
    return createJsonFileMigrator({
        id: 'sample-v0-v1',
        fromVersion: 0,
        toVersion: 1,
        relativePath: 'sample.json',
        async migrate({ dataDir }) {
            fs.writeFileSync(path.join(dataDir, 'sample.json'), '{"version":1,"value":"after"}\n')
            return { changed: true }
        },
        async validate({ dataDir }) {
            const value = JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8'))
            return { valid: valid && value.version === 1 }
        }
    })
}

describe('data migration registry', () => {
    it('applies once, persists private state and rolls back from recorded backup', async () => {
        const dataDir = createDataDir()
        try {
            const registry = new DataMigrationRegistry({ dataDir, migrators: [createMigrator()] })
            const first = await registry.apply()
            assert.strictEqual(first.changed, true)
            assert.strictEqual(first.state.schemaVersion, 1)
            assert.deepStrictEqual(first.state.applied, ['sample-v0-v1'])
            assert.strictEqual(fs.statSync(registry.statePath).mode & 0o777, 0o600)

            const second = await registry.apply()
            assert.strictEqual(second.changed, false)
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')

            const rolledBack = await registry.rollback()
            assert.strictEqual(rolledBack.changed, true)
            assert.strictEqual(rolledBack.state.schemaVersion, 0)
            assert.deepStrictEqual(rolledBack.state.applied, [])
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'before')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rolls back the currently mutated migrator when validation fails', async () => {
        const dataDir = createDataDir()
        try {
            const registry = new DataMigrationRegistry({ dataDir, migrators: [createMigrator({ valid: false })] })
            await assert.rejects(
                registry.apply(),
                (error) => error.code === 'DATA_MIGRATION_VALIDATION_FAILED'
            )
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'before')
            assert.strictEqual(fs.existsSync(registry.statePath), false)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('compensates only side effects created by the current apply invocation', async () => {
        const dataDir = createDataDir()
        fs.writeFileSync(path.join(dataDir, 'second.json'), '{"version":1,"value":"stable"}\n')
        const first = createMigrator()
        const second = createJsonFileMigrator({
            id: 'second-v1-v2',
            fromVersion: 1,
            toVersion: 2,
            relativePath: 'second.json',
            async migrate({ dataDir: root }) {
                fs.writeFileSync(path.join(root, 'second.json'), '{"version":2,"value":"candidate"}\n')
                return { changed: true }
            },
            async validate() { return { valid: false } }
        })
        try {
            await new DataMigrationRegistry({ dataDir, migrators: [first] }).apply()
            const registry = new DataMigrationRegistry({ dataDir, migrators: [first, second] })
            await assert.rejects(registry.apply(), (error) => error.code === 'DATA_MIGRATION_VALIDATION_FAILED')
            const state = registry.readState()
            assert.strictEqual(state.schemaVersion, 1)
            assert.deepStrictEqual(state.applied, ['sample-v0-v1'])
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'second.json'), 'utf8')).value, 'stable')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rejects unsafe migrator IDs and state backup artifacts', () => {
        assert.throws(
            () => createJsonFileMigrator({
                id: '../escape',
                fromVersion: 0,
                toVersion: 1,
                relativePath: 'sample.json',
                migrate: async () => ({}),
                validate: async () => ({ valid: true })
            }),
            (error) => error.code === 'DATA_MIGRATOR_ID_INVALID'
        )
    })

    for (const crashPhase of ['backup_ready', 'applying', 'applied', 'validated', 'state_committed']) {
        it(`resumes crash-safely after ${crashPhase} without overwriting the original backup`, async () => {
            const dataDir = createDataDir()
            try {
                let injected = false
                const crashing = new DataMigrationRegistry({
                    dataDir,
                    migrators: [createMigrator()],
                    faultInjector(phase) {
                        if (!injected && phase === crashPhase) {
                            injected = true
                            const error = new Error('simulated abrupt process exit')
                            error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                            throw error
                        }
                    }
                })
                await assert.rejects(crashing.apply(), (error) => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
                const journalPath = crashing.journalPath('sample-v0-v1')
                const crashedJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
                const backupPath = path.join(crashing.migrationDir, crashedJournal.artifacts[0])
                const backupBeforeResume = fs.readFileSync(backupPath)

                const resumed = new DataMigrationRegistry({ dataDir, migrators: [createMigrator()] })
                const result = await resumed.apply()
                assert.strictEqual(result.state.schemaVersion, 1)
                assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')
                assert.deepStrictEqual(fs.readFileSync(backupPath), backupBeforeResume)
                const finalJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
                assert.strictEqual(finalJournal.attemptId, crashedJournal.attemptId)
                assert.strictEqual(finalJournal.phase, 'state_committed')

                const rolledBack = await resumed.rollback()
                assert.strictEqual(rolledBack.state.schemaVersion, 0)
                assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'before')
            } finally {
                fs.rmSync(dataDir, { recursive: true, force: true })
            }
        })
    }

    it('fails closed when a journal backup is damaged', async () => {
        const dataDir = createDataDir()
        try {
            const registry = new DataMigrationRegistry({
                dataDir,
                migrators: [createMigrator()],
                faultInjector(phase) {
                    if (phase === 'backup_ready') {
                        const error = new Error('crash')
                        error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                        throw error
                    }
                }
            })
            await assert.rejects(registry.apply(), (error) => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
            const journal = JSON.parse(fs.readFileSync(registry.journalPath('sample-v0-v1'), 'utf8'))
            fs.writeFileSync(path.join(registry.migrationDir, journal.artifacts[0]), 'tampered')
            const resumed = new DataMigrationRegistry({ dataDir, migrators: [createMigrator()] })
            await assert.rejects(resumed.apply(), (error) => (
                error.code === 'DATA_ROLLBACK_RECOVERY_REQUIRED' &&
                error.details.originalCode === 'DATA_MIGRATION_BACKUP_INVALID'
            ))
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('binds a resumable attempt to the original source hash', async () => {
        const dataDir = createDataDir()
        try {
            const registry = new DataMigrationRegistry({
                dataDir,
                migrators: [createMigrator()],
                faultInjector(phase) {
                    if (phase === 'backup_ready') {
                        const error = new Error('crash')
                        error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                        throw error
                    }
                }
            })
            await assert.rejects(registry.apply(), (error) => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
            fs.writeFileSync(path.join(dataDir, 'sample.json'), '{"version":0,"value":"external-change"}\n')
            const resumed = new DataMigrationRegistry({ dataDir, migrators: [createMigrator()] })
            await assert.rejects(resumed.apply(), (error) => error.code === 'DATA_MIGRATION_SOURCE_CONFLICT')
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'external-change')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    for (const mutationPhase of ['backup_capture_start', 'backup_captured']) {
        it(`does not publish a restore journal when business data changes at ${mutationPhase}`, async () => {
            const dataDir = createDataDir()
            const source = path.join(dataDir, 'subscriptions.json')
            fs.writeFileSync(source, '{"records":{"one":{"lastDynamicId":"100"}}}\n')
            const migrator = createJsonFileMigrator({
                id: 'subscriptions-v0-v1',
                fromVersion: 0,
                toVersion: 1,
                relativePath: 'subscriptions.json',
                async migrate() { return { changed: false } },
                async validate() { return { valid: true } }
            })
            try {
                let mutated = false
                const registry = new DataMigrationRegistry({
                    dataDir,
                    migrators: [migrator],
                    faultInjector(phase) {
                        if (!mutated && phase === mutationPhase) {
                            mutated = true
                            fs.writeFileSync(source, '{"records":{"one":{"lastDynamicId":"200"}}}\n')
                        }
                    }
                })
                await assert.rejects(registry.apply(), (error) => error.code === 'DATA_MIGRATION_SOURCE_CONFLICT')
                assert.strictEqual(fs.existsSync(registry.journalPath(migrator.id)), false)
                assert.deepStrictEqual(
                    fs.existsSync(registry.migrationDir)
                        ? fs.readdirSync(registry.migrationDir).filter((name) => name.startsWith(`${migrator.id}.`))
                        : [],
                    []
                )
                assert.strictEqual(JSON.parse(fs.readFileSync(source, 'utf8')).records.one.lastDynamicId, '200')
            } finally {
                fs.rmSync(dataDir, { recursive: true, force: true })
            }
        })
    }

    it('uses one captured JSON byte sequence for the source hash and restore artifact', async () => {
        const dataDir = createDataDir()
        try {
            const original = fs.readFileSync(path.join(dataDir, 'sample.json'))
            const registry = new DataMigrationRegistry({
                dataDir,
                migrators: [createMigrator()],
                faultInjector(phase, details) {
                    if (phase === 'backup_ready') {
                        const journal = details.journal
                        const artifact = fs.readFileSync(path.join(registry.migrationDir, journal.artifacts[0]))
                        assert.deepStrictEqual(artifact, original)
                        assert.strictEqual(journal.sourceHashes['sample.json'], sha256(original))
                        assert.strictEqual(journal.artifactHashes[journal.artifacts[0]], sha256(original))
                    }
                }
            })
            await registry.apply()
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rolls back and resumes when the process dies after mutation but before the applied checkpoint', async () => {
        const dataDir = createDataDir()
        let firstAttempt = true
        const migrator = createJsonFileMigrator({
            id: 'mid-mutate-crash-v0-v1',
            fromVersion: 0,
            toVersion: 1,
            relativePath: 'sample.json',
            async migrate({ dataDir: root }) {
                fs.writeFileSync(path.join(root, 'sample.json'), '{"version":1,"value":"after"}\n')
                if (firstAttempt) {
                    firstAttempt = false
                    const error = new Error('simulated kill after mutation')
                    error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                    throw error
                }
                return { changed: true }
            },
            async validate({ dataDir: root }) {
                return { valid: JSON.parse(fs.readFileSync(path.join(root, 'sample.json'), 'utf8')).version === 1 }
            }
        })
        try {
            const first = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
            await assert.rejects(first.apply(), (error) => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')
            assert.strictEqual(JSON.parse(fs.readFileSync(first.journalPath(migrator.id), 'utf8')).phase, 'applying')

            const resumed = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
            const result = await resumed.apply()
            assert.strictEqual(result.state.schemaVersion, 1)
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')
            await resumed.rollback()
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'before')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('requires touched declarations and validators for preserve-content changes', async () => {
        const dataDir = createDataDir()
        fs.writeFileSync(path.join(dataDir, 'cookies.json'), '{"cookie":"before"}\n')
        const makeCookieMigrator = (declareTouched) => createJsonFileMigrator({
            id: 'cookies-v0-v1',
            fromVersion: 0,
            toVersion: 1,
            relativePath: 'cookies.json',
            touchedPaths: declareTouched ? ['preserve.cookies.json'] : [],
            validateTouched: declareTouched ? ((logicalPath, before, after) => logicalPath === 'preserve.cookies.json' && before.fileCount === after.fileCount) : undefined,
            async migrate({ dataDir: root }) {
                fs.writeFileSync(path.join(root, 'cookies.json'), '{"cookie":"after"}\n')
                return { changed: true }
            },
            async validate() { return { valid: true } }
        })
        try {
            const undeclared = new DataMigrationRegistry({ dataDir, migrators: [makeCookieMigrator(false)] })
            await assert.rejects(undeclared.apply(), (error) => error.code === 'DATA_UNDECLARED_PRESERVE_CHANGE')
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'cookies.json'), 'utf8')).cookie, 'before')

            const declared = new DataMigrationRegistry({ dataDir, migrators: [makeCookieMigrator(true)] })
            const result = await declared.apply()
            assert.strictEqual(result.state.schemaVersion, 1)
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'cookies.json'), 'utf8')).cookie, 'after')
            const journal = JSON.parse(fs.readFileSync(declared.journalPath('cookies-v0-v1'), 'utf8'))
            assert.strictEqual(fs.statSync(declared.journalPath('cookies-v0-v1')).mode & 0o777, 0o600)
            assert.strictEqual(fs.statSync(path.dirname(path.join(declared.migrationDir, journal.artifacts[0]))).mode & 0o777, 0o700)
            assert.strictEqual(fs.statSync(path.join(declared.migrationDir, journal.artifacts[0])).mode & 0o777, 0o600)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    for (const rollbackPhase of ['rollback_started', 'data_restored', 'state_reverted', 'rollback_complete']) {
        it(`resumes explicit rollback after a crash at ${rollbackPhase}`, async () => {
            const dataDir = createDataDir()
            try {
                const migrator = createMigrator()
                await new DataMigrationRegistry({ dataDir, migrators: [migrator] }).apply()
                let injected = false
                const crashing = new DataMigrationRegistry({
                    dataDir,
                    migrators: [migrator],
                    faultInjector(phase) {
                        if (!injected && phase === rollbackPhase) {
                            injected = true
                            const error = new Error('simulated rollback crash')
                            error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                            throw error
                        }
                    }
                })
                await assert.rejects(crashing.rollback(), (error) => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
                assert.strictEqual(JSON.parse(fs.readFileSync(crashing.journalPath(migrator.id), 'utf8')).phase, rollbackPhase)

                const resumed = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
                const result = await resumed.rollback()
                assert.strictEqual(result.state.schemaVersion, 0)
                assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'before')
                assert.strictEqual(fs.existsSync(resumed.journalPath(migrator.id)), false)
                const persisted = JSON.parse(fs.readFileSync(resumed.statePath, 'utf8'))
                assert.strictEqual(persisted.schemaVersion, 0)
                assert.deepStrictEqual(persisted.applied, [])
            } finally {
                fs.rmSync(dataDir, { recursive: true, force: true })
            }
        })
    }

    it('retains a private attempt-bound rollback terminal instead of deleting the completed journal', async () => {
        const dataDir = createDataDir()
        try {
            const migrator = createMigrator()
            const registry = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
            await registry.apply()
            const active = registry.journalPath(migrator.id)
            const before = JSON.parse(fs.readFileSync(active, 'utf8'))
            await registry.rollback()

            const terminal = registry.rollbackTerminalPath(migrator, before.attemptId)
            assert.strictEqual(fs.existsSync(active), false)
            assert.strictEqual(fs.statSync(path.dirname(terminal)).mode & 0o777, 0o700)
            assert.strictEqual(fs.statSync(terminal).mode & 0o777, 0o600)
            const retained = JSON.parse(fs.readFileSync(terminal, 'utf8'))
            assert.strictEqual(retained.phase, 'rollback_complete')
            assert.strictEqual(retained.migratorId, migrator.id)
            assert.strictEqual(retained.attemptId, before.attemptId)

            const reapplied = await registry.apply()
            assert.strictEqual(reapplied.state.schemaVersion, 1)
            assert.strictEqual(fs.existsSync(terminal), true, 'retained terminal must not interfere with normal discovery')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('moves the completed journal before verification and preserves a late active-path replacement', async () => {
        const dataDir = createDataDir()
        try {
            const migrator = createMigrator()
            await new DataMigrationRegistry({ dataDir, migrators: [migrator] }).apply()
            let replaced = false
            const registry = new DataMigrationRegistry({
                dataDir,
                migrators: [migrator],
                faultInjector(phase, details) {
                    if (phase !== 'rollback_claim_moved' || replaced) return
                    replaced = true
                    fs.writeFileSync(details.journalPath, '{"unknown":"replacement"}\n', { mode: 0o600 })
                }
            })
            await registry.rollback()
            assert.strictEqual(fs.readFileSync(registry.journalPath(migrator.id), 'utf8'), '{"unknown":"replacement"}\n')
            const retainedRoot = path.join(registry.migrationDir, 'retained', 'rollback-complete')
            assert.strictEqual(fs.readdirSync(retainedRoot).length, 1)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('resumes idempotently after the rollback terminal is durable but before active journal removal', async () => {
        const dataDir = createDataDir()
        try {
            const migrator = createMigrator()
            await new DataMigrationRegistry({ dataDir, migrators: [migrator] }).apply()
            let crashed = false
            let retained
            const crashing = new DataMigrationRegistry({
                dataDir,
                migrators: [migrator],
                faultInjector(phase, details) {
                    if (phase !== 'rollback_terminal_published' || crashed) return
                    crashed = true
                    retained = details
                    const error = new Error('simulated terminal publication crash')
                    error.code = 'DATA_MIGRATION_CRASH_SIMULATED'
                    throw error
                }
            })
            await assert.rejects(crashing.rollback(), error => error.code === 'DATA_MIGRATION_CRASH_SIMULATED')
            const active = crashing.journalPath(migrator.id)
            const terminalBytes = fs.readFileSync(retained.terminalPath)
            const claimBytes = fs.readFileSync(retained.claimPath)

            const resumed = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
            const result = await resumed.rollback()
            assert.strictEqual(result.state.schemaVersion, 0)
            assert.strictEqual(fs.existsSync(active), false)
            assert.deepStrictEqual(fs.readFileSync(retained.terminalPath), terminalBytes)
            assert.deepStrictEqual(fs.readFileSync(retained.claimPath), claimBytes)
            assert.strictEqual((await resumed.rollback()).changed, false)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('never deletes a claim mutated after its final verified read', async () => {
        const dataDir = createDataDir()
        try {
            const migrator = createMigrator()
            await new DataMigrationRegistry({ dataDir, migrators: [migrator] }).apply()
            let mutatedClaim
            const registry = new DataMigrationRegistry({
                dataDir,
                migrators: [migrator],
                faultInjector(phase, details) {
                    if (phase !== 'rollback_claim_verified' || mutatedClaim) return
                    mutatedClaim = details.claimPath
                    fs.writeFileSync(mutatedClaim, '{"unknown":"late-claim-mutation"}\n', { mode: 0o600 })
                }
            })
            await registry.rollback()
            assert.strictEqual(fs.readFileSync(mutatedClaim, 'utf8'), '{"unknown":"late-claim-mutation"}\n')
            assert.strictEqual(fs.existsSync(registry.journalPath(migrator.id)), false)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('returns a typed recovery-required aggregate and retains rollback state on failure', async () => {
        const dataDir = createDataDir()
        try {
            const healthy = createMigrator()
            await new DataMigrationRegistry({ dataDir, migrators: [healthy] }).apply()
            const failing = { ...healthy, async rollback() { throw new Error('private failure details') } }
            const registry = new DataMigrationRegistry({ dataDir, migrators: [failing] })
            await assert.rejects(
                registry.rollback(),
                (error) => error.code === 'DATA_ROLLBACK_RECOVERY_REQUIRED' &&
                    error.details.failures[0].migratorId === 'sample-v0-v1' &&
                    error.details.failures[0].code === 'DATA_ROLLBACK_FAILED'
            )
            assert.strictEqual(JSON.parse(fs.readFileSync(registry.journalPath(failing.id), 'utf8')).phase, 'rollback_started')
            assert.strictEqual(JSON.parse(fs.readFileSync(registry.statePath, 'utf8')).schemaVersion, 1)

            const recovered = new DataMigrationRegistry({ dataDir, migrators: [healthy] })
            assert.strictEqual((await recovered.rollback()).state.schemaVersion, 0)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('does not restore old state or swallow rollback failures from apply', async () => {
        const dataDir = createDataDir()
        try {
            const healthy = createMigrator({ valid: false })
            const failing = { ...healthy, async rollback() { throw new Error('private rollback failure') } }
            const registry = new DataMigrationRegistry({ dataDir, migrators: [failing] })
            await assert.rejects(
                registry.apply(),
                (error) => error.code === 'DATA_ROLLBACK_RECOVERY_REQUIRED' &&
                    error.details.originalCode === 'DATA_MIGRATION_VALIDATION_FAILED'
            )
            assert.strictEqual(JSON.parse(fs.readFileSync(registry.journalPath(failing.id), 'utf8')).phase, 'rollback_started')
            assert.strictEqual(fs.existsSync(registry.statePath), false)
            assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sample.json'), 'utf8')).value, 'after')
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rejects permissive, symlinked and hard-linked private state and journal files', async () => {
        const dataDir = createDataDir()
        try {
            const migrator = createMigrator()
            const registry = new DataMigrationRegistry({ dataDir, migrators: [migrator] })
            await registry.apply()
            fs.chmodSync(registry.statePath, 0o644)
            assert.throws(() => registry.readState(), (error) => error.code === 'MIGRATION_FILE_PERMISSION_UNSAFE')
            fs.chmodSync(registry.statePath, 0o600)
            const stateReal = `${registry.statePath}.real`
            fs.renameSync(registry.statePath, stateReal)
            fs.symlinkSync(stateReal, registry.statePath)
            assert.throws(() => registry.readState(), (error) => error.code === 'MIGRATION_SYMLINK_FORBIDDEN')
            fs.rmSync(registry.statePath)
            fs.renameSync(stateReal, registry.statePath)
            const stateHardlink = `${registry.statePath}.hardlink`
            fs.linkSync(registry.statePath, stateHardlink)
            assert.throws(() => registry.readState(), (error) => error.code === 'MIGRATION_FILE_LINK_COUNT_UNSAFE')
            fs.rmSync(stateHardlink)

            const journalPath = registry.journalPath(migrator.id)
            fs.chmodSync(journalPath, 0o644)
            assert.throws(() => registry.readJournal(migrator), (error) => error.code === 'MIGRATION_FILE_PERMISSION_UNSAFE')
            fs.chmodSync(journalPath, 0o600)
            const journalLink = path.join(registry.migrationDir, 'journal-link.journal.json')
            fs.symlinkSync(journalPath, journalLink)
            assert.throws(
                () => registry.readJournal({ ...migrator, id: 'journal-link' }),
                (error) => error.code === 'MIGRATION_SYMLINK_FORBIDDEN'
            )
            fs.rmSync(journalLink)
            const journalHardlink = path.join(registry.migrationDir, 'journal-hardlink.json')
            fs.linkSync(journalPath, journalHardlink)
            assert.throws(() => registry.readJournal(migrator), (error) => error.code === 'MIGRATION_FILE_LINK_COUNT_UNSAFE')
            fs.rmSync(journalHardlink)

            const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
            const backupPath = path.join(registry.migrationDir, journal.artifacts[0])
            fs.chmodSync(backupPath, 0o644)
            assert.throws(() => registry.readJournal(migrator), (error) => error.code === 'MIGRATION_FILE_PERMISSION_UNSAFE')
            fs.chmodSync(backupPath, 0o600)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })
})
