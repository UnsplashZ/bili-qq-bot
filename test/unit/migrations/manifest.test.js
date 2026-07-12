'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
    createManifest,
    validateManifest,
    writeManifest,
    checkpointManifest,
    sanitizeCheckpointInput,
    toPublicMigrationStatus
} = require('../../../src/migrations/config/manifest')

function legacyCutover(overrides = {}) {
    return {
        sourceRuntimeClass: 'legacy-v0',
        cutoverKind: 'first-managed-adoption',
        cutoverAttemptId: 'attempt-1',
        deliveryGuarantee: 'best-effort',
        exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
        affectedState: 'operations-without-durable-part-record',
        retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
        ambiguousDeliveryWindow: true,
        warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS'],
        ...overrides
    }
}

function withManifest(manifest, callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-manifest-'))
    fs.chmodSync(root, 0o700)
    const manifestPath = path.join(root, 'manifest.json')
    writeManifest(manifestPath, manifest)
    try {
        return callback(manifestPath)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
}

describe('migration manifest', () => {
    it('rejects best-effort outside the narrow legacy first-adoption scope', () => {
        assert.throws(
            () => createManifest({
                cutover: legacyCutover({ sourceRuntimeClass: 'managed-v1+' })
            }),
            (error) => error.code === 'MIGRATION_BEST_EFFORT_SCOPE_INVALID'
        )
        assert.throws(
            () => createManifest({
                cutover: legacyCutover({
                    deliveryGuarantee: 'exactly-once',
                    exceptionScope: 'none',
                    affectedState: 'none',
                    retryPolicy: 'none',
                    warningCodes: []
                })
            }),
            (error) => error.code === 'MIGRATION_LEGACY_PROVENANCE_INVALID'
        )
        assert.throws(
            () => createManifest({
                cutover: legacyCutover({ warningCodes: [] })
            }),
            (error) => error.code === 'MIGRATION_BEST_EFFORT_AUDIT_INVALID'
        )
    })

    it('fails closed on unknown manifest, cutover and checkpoint fields', () => {
        const manifest = createManifest({ cutover: legacyCutover() })
        assert.throws(
            () => validateManifest({ ...manifest, freeText: 'secret-like payload' }),
            (error) => error.code === 'MIGRATION_MANIFEST_FIELD_UNKNOWN'
        )
        assert.throws(
            () => createManifest({ cutover: legacyCutover({ freeText: 'unknown' }) }),
            (error) => error.code === 'MIGRATION_CUTOVER_FIELD_UNKNOWN'
        )
        assert.throws(
            () => sanitizeCheckpointInput({ unknown: true }),
            (error) => error.code === 'MIGRATION_CHECKPOINT_FIELD_UNKNOWN'
        )
        assert.throws(
            () => sanitizeCheckpointInput({ archiveArtifacts: ['../secret'] }),
            (error) => error.code === 'MIGRATION_ARCHIVE_ARTIFACT_INVALID'
        )
        assert.throws(
            () => sanitizeCheckpointInput({ archiveArtifacts: ['/tmp/secret'] }),
            (error) => error.code === 'MIGRATION_ARCHIVE_ARTIFACT_INVALID'
        )
    })

    it('enforces release epoch identity and committed marker state', () => {
        withManifest(createManifest({
            status: 'runtime_release_armed',
            releaseEpoch: 'epoch-1',
            cutover: legacyCutover()
        }), (manifestPath) => {
            const released = checkpointManifest(manifestPath, 'runtime_released')
            assert.strictEqual(released.cutover.appliesToCommittedRuntime, true)
            assert.strictEqual(released.releaseEpoch, 'epoch-1')
            assert.throws(
                () => checkpointManifest(manifestPath, 'runtime_ready', {
                    releaseEpoch: 'epoch-2',
                    businessAdmissionOpened: true
                }),
                (error) => error.code === 'MIGRATION_RELEASE_EPOCH_CONFLICT'
            )
            const ready = checkpointManifest(manifestPath, 'runtime_ready', {
                releaseEpoch: 'epoch-1',
                businessAdmissionOpened: true
            })
            assert.strictEqual(ready.status, 'runtime_ready')
        })
    })

    it('permanently forbids rollback or rediscovery after the commit marker', () => {
        withManifest(createManifest({
            status: 'runtime_release_armed',
            releaseEpoch: 'epoch-committed'
        }), (manifestPath) => {
            checkpointManifest(manifestPath, 'runtime_released')
            const failed = checkpointManifest(manifestPath, 'failed')
            assert.strictEqual(failed.cutover.appliesToCommittedRuntime, true)
            for (const status of ['rollback_started', 'rolled_back', 'discovered']) {
                assert.throws(
                    () => checkpointManifest(manifestPath, status),
                    (error) => error.code === 'MIGRATION_COMMITTED_ROLLBACK_FORBIDDEN'
                )
            }
            const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            assert.throws(
                () => writeManifest(manifestPath, {
                    ...current,
                    cutover: { ...current.cutover, appliesToCommittedRuntime: false }
                }),
                (error) => error.code === 'MIGRATION_COMMITTED_ROLLBACK_FORBIDDEN'
            )
        })
    })

    it('exposes only the typed public projection without hashes, paths or free text', () => {
        const manifest = createManifest({
            sourceHashes: { dotenv: 'a'.repeat(64) },
            targetHashes: { config_yaml: 'b'.repeat(64) },
            archiveArtifacts: ['dotenv.backup'],
            cutover: legacyCutover({
                legacyFeatureInventory: ['subscription-auto-download'],
                drainOutcome: 'interrupted'
            })
        })
        const output = toPublicMigrationStatus(manifest)
        const serialized = JSON.stringify(output)
        assert.strictEqual(output.checkpoint, 'discovered')
        assert.strictEqual(output.phase, 'discovery')
        assert.ok(!serialized.includes('sourceHashes'))
        assert.ok(!serialized.includes('targetHashes'))
        assert.ok(!serialized.includes('dotenv.backup'))
        assert.ok(!serialized.includes('a'.repeat(64)))
    })

    it('allows fresh install to move from cutover intent to snapshot but rejects legacy shortcut', () => {
        withManifest(createManifest({ status: 'cutover_intent' }), (manifestPath) => {
            assert.strictEqual(checkpointManifest(manifestPath, 'snapshot_ready').status, 'snapshot_ready')
        })
        withManifest(createManifest({ status: 'cutover_intent', cutover: legacyCutover() }), (manifestPath) => {
            assert.throws(
                () => checkpointManifest(manifestPath, 'snapshot_ready'),
                (error) => error.code === 'MIGRATION_TRANSITION_INVALID'
            )
        })
    })

    it('freezes cutover provenance after cutover_intent', () => {
        withManifest(createManifest({ status: 'cutover_intent', cutover: legacyCutover() }), (manifestPath) => {
            assert.throws(
                () => checkpointManifest(manifestPath, 'legacy_fenced', {
                    cutover: legacyCutover({ cutoverAttemptId: 'attempt-2' })
                }),
                (error) => ['MIGRATION_ATTEMPT_ID_CONFLICT', 'MIGRATION_PROVENANCE_IMMUTABLE'].includes(error.code)
            )
            assert.throws(
                () => checkpointManifest(manifestPath, 'legacy_fenced', {
                    cutover: legacyCutover({ retryPolicy: 'none' })
                }),
                (error) => ['MIGRATION_BEST_EFFORT_METADATA_INVALID', 'MIGRATION_PROVENANCE_IMMUTABLE'].includes(error.code)
            )
            const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            assert.throws(
                () => writeManifest(manifestPath, {
                    ...current,
                    cutover: { ...current.cutover, cutoverAttemptId: 'attempt-direct-overwrite' }
                }),
                (error) => error.code === 'MIGRATION_PROVENANCE_IMMUTABLE'
            )
        })
    })

    it('unions warning codes monotonically across every later checkpoint', () => {
        withManifest(createManifest({ status: 'snapshot_ready', cutover: legacyCutover() }), (manifestPath) => {
            let current = checkpointManifest(manifestPath, 'candidate_written', {
                cutover: legacyCutover({ warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS', 'LEGACY_COERCION_APPLIED'] })
            })
            assert.ok(current.cutover.warningCodes.includes('LEGACY_COERCION_APPLIED'))
            current = checkpointManifest(manifestPath, 'probe_started', { cutover: legacyCutover() })
            assert.ok(current.cutover.warningCodes.includes('LEGACY_COERCION_APPLIED'))
            assert.ok(toPublicMigrationStatus(current).warningCodes.includes('LEGACY_COERCION_APPLIED'))
            assert.throws(
                () => writeManifest(manifestPath, {
                    ...current,
                    cutover: {
                        ...current.cutover,
                        warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS']
                    }
                }),
                (error) => error.code === 'MIGRATION_WARNING_REMOVAL_FORBIDDEN'
            )
        })
    })

    it('rejects permissive, symlinked and hard-linked private manifests', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-manifest-private-'))
        fs.chmodSync(root, 0o700)
        const manifestPath = path.join(root, 'manifest.json')
        try {
            writeManifest(manifestPath, createManifest())
            fs.chmodSync(manifestPath, 0o644)
            assert.throws(() => require('../../../src/migrations/config/manifest').readManifest(manifestPath), (error) => error.code === 'MIGRATION_FILE_PERMISSION_UNSAFE')
            fs.chmodSync(manifestPath, 0o600)
            const symlinkPath = path.join(root, 'manifest-link.json')
            fs.symlinkSync(manifestPath, symlinkPath)
            assert.throws(() => require('../../../src/migrations/config/manifest').readManifest(symlinkPath), (error) => error.code === 'MIGRATION_SYMLINK_FORBIDDEN')
            fs.rmSync(symlinkPath)
            const hardlinkPath = path.join(root, 'manifest-hardlink.json')
            fs.linkSync(manifestPath, hardlinkPath)
            assert.throws(() => require('../../../src/migrations/config/manifest').readManifest(manifestPath), (error) => error.code === 'MIGRATION_FILE_LINK_COUNT_UNSAFE')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
