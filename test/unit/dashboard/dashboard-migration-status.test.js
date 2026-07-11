'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createManifest, writeManifest } = require('../../../src/migrations/config/manifest')
const { getCurrentMigrationStatus } = require('../../../src/dashboard/migrationStatus')

describe('dashboard migration status', () => {
    it('rejects active attempt identifiers that can escape or alias the state root', () => {
        const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-dashboard-pointer-id-'))
        fs.chmodSync(stateRoot, 0o700)
        const pointer = path.join(stateRoot, 'active-attempt')
        try {
            for (const attemptId of ['.', '..', '.hidden', 'trailing.', 'nested/attempt', 'nested\\attempt']) {
                fs.writeFileSync(pointer, `${attemptId}\n`, { mode: 0o600 })
                assert.throws(
                    () => getCurrentMigrationStatus({ stateRoot }),
                    (error) => error.code === 'MIGRATION_ATTEMPT_ID_INVALID'
                )
            }
        } finally {
            fs.rmSync(stateRoot, { recursive: true, force: true })
        }
    })

    it('returns the same public projection and falls back to the latest completed attempt', () => {
        const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-dashboard-migration-'))
        fs.chmodSync(stateRoot, 0o700)
        const attempt = 'attempt-1'
        const attemptDir = path.join(stateRoot, attempt)
        fs.mkdirSync(attemptDir, { mode: 0o700 })
        const manifestPath = path.join(attemptDir, 'upgrade-manifest.json')
        writeManifest(manifestPath, createManifest({
            status: 'runtime_ready',
            releaseEpoch: 'epoch-1',
            businessAdmissionOpened: true,
            cutover: { appliesToCommittedRuntime: true }
        }))
        fs.writeFileSync(path.join(stateRoot, 'managed-v1'), 'epoch-1\n', { mode: 0o600 })
        try {
            const status = getCurrentMigrationStatus({ stateRoot })
            assert.strictEqual(status.checkpoint, 'runtime_ready')
            assert.strictEqual(status.releaseEpoch, 'epoch-1')
            const serialized = JSON.stringify(status)
            assert.ok(!serialized.includes(stateRoot))
            assert.ok(!serialized.includes('sourceHashes'))
        } finally {
            fs.rmSync(stateRoot, { recursive: true, force: true })
        }
    })

    it('prefers an active attempt but otherwise ignores newer failed and wrong-epoch attempts', () => {
        const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-dashboard-migration-select-'))
        fs.chmodSync(stateRoot, 0o700)
        fs.writeFileSync(path.join(stateRoot, 'managed-v1'), 'epoch-good\n', { mode: 0o600 })
        const writeAttempt = (name, manifest) => {
            const dir = path.join(stateRoot, name)
            fs.mkdirSync(dir, { mode: 0o700 })
            writeManifest(path.join(dir, 'upgrade-manifest.json'), manifest)
        }
        writeAttempt('successful', createManifest({
            status: 'upgrade_complete', releaseEpoch: 'epoch-good', businessAdmissionOpened: true,
            cutover: { appliesToCommittedRuntime: true }
        }))
        writeAttempt('newer-failed', createManifest({ status: 'failed' }))
        writeAttempt('wrong-epoch', createManifest({
            status: 'runtime_ready', releaseEpoch: 'epoch-other', businessAdmissionOpened: true,
            cutover: { appliesToCommittedRuntime: true }
        }))
        try {
            const successful = JSON.parse(fs.readFileSync(path.join(stateRoot, 'successful/upgrade-manifest.json')))
            assert.strictEqual(getCurrentMigrationStatus({ stateRoot }).migrationId, successful.migrationId)
            fs.writeFileSync(path.join(stateRoot, 'active-attempt'), 'newer-failed\n', { mode: 0o600 })
            assert.strictEqual(getCurrentMigrationStatus({ stateRoot }).checkpoint, 'failed')
        } finally {
            fs.rmSync(stateRoot, { recursive: true, force: true })
        }
    })

    it('rejects permissive, symlinked and hard-linked active attempt pointers', () => {
        const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-dashboard-pointer-'))
        fs.chmodSync(stateRoot, 0o700)
        const attempt = 'attempt-safe'
        const attemptDir = path.join(stateRoot, attempt)
        fs.mkdirSync(attemptDir, { mode: 0o700 })
        writeManifest(path.join(attemptDir, 'upgrade-manifest.json'), createManifest())
        const pointer = path.join(stateRoot, 'active-attempt')
        try {
            fs.writeFileSync(pointer, `${attempt}\n`, { mode: 0o644 })
            assert.throws(() => getCurrentMigrationStatus({ stateRoot }), (error) => error.code === 'MIGRATION_STATUS_FILE_UNSAFE')
            fs.chmodSync(pointer, 0o600)
            const hardlink = `${pointer}.hardlink`
            fs.linkSync(pointer, hardlink)
            assert.throws(() => getCurrentMigrationStatus({ stateRoot }), (error) => error.code === 'MIGRATION_STATUS_FILE_UNSAFE')
            fs.rmSync(hardlink)
            const real = `${pointer}.real`
            fs.renameSync(pointer, real)
            fs.symlinkSync(real, pointer)
            assert.throws(() => getCurrentMigrationStatus({ stateRoot }), (error) => (
                ['MIGRATION_SYMLINK_FORBIDDEN', 'MIGRATION_STATUS_FILE_UNSAFE'].includes(error.code)
            ))
        } finally {
            fs.rmSync(stateRoot, { recursive: true, force: true })
        }
    })
})
