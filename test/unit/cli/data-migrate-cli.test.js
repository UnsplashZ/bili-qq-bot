'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { run } = require('../../../src/cli/data-migrate')
const {
    createManifest,
    writeManifest
} = require('../../../src/migrations/config/manifest')

function cutover() {
    return {
        sourceRuntimeClass: 'legacy-v0',
        cutoverKind: 'first-managed-adoption',
        cutoverAttemptId: 'cli-attempt',
        deliveryGuarantee: 'best-effort',
        exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
        affectedState: 'operations-without-durable-part-record',
        retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
        ambiguousDeliveryWindow: true,
        warningCodes: ['LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS']
    }
}

describe('data migration CLI', () => {
    it('checks, applies and rolls back the default preserve migrator', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-data-cli-'))
        try {
            const checked = await run(['check', '--data-dir', dataDir])
            assert.deepStrictEqual(checked.pending, ['v1-preserve-inventory'])
            const applied = await run(['apply', '--data-dir', dataDir])
            assert.strictEqual(applied.schemaVersion, 1)
            const second = await run(['apply', '--data-dir', dataDir])
            assert.strictEqual(second.changed, false)
            const rolledBack = await run(['rollback', '--data-dir', dataDir])
            assert.strictEqual(rolledBack.schemaVersion, 0)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('applies and rolls back without creating bootstrap owner artifacts', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-data-cli-no-owner-'))
        const legacyLockPath = path.join(dataDir, 'application-migration/bootstrap-owner.lock')
        let applyObserved = false
        let rollbackObserved = false
        const migrator = {
            id: 'owner-v0-v1',
            fromVersion: 0,
            toVersion: 1,
            touchedPaths: [],
            async detect() { return true },
            async backup() { return { artifacts: [], sourceHashes: {} } },
            async migrate() {
                await Promise.resolve()
                applyObserved = fs.existsSync(path.join(legacyLockPath, 'owner.json'))
                return { changed: false }
            },
            async validate() { return { valid: true } },
            async rollback() {
                await Promise.resolve()
                rollbackObserved = fs.existsSync(path.join(legacyLockPath, 'owner.json'))
                return { changed: false }
            }
        }
        try {
            await run(['apply', '--data-dir', dataDir], { migrators: [migrator] })
            assert.strictEqual(applyObserved, false)
            assert.strictEqual(fs.existsSync(legacyLockPath), false)
            await run(['rollback', '--data-dir', dataDir], { migrators: [migrator] })
            assert.strictEqual(rollbackObserved, false)
            assert.strictEqual(fs.existsSync(legacyLockPath), false)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('accepts only private typed checkpoint input and keeps public status redacted', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-checkpoint-cli-'))
        fs.chmodSync(root, 0o700)
        const manifestPath = path.join(root, 'manifest.json')
        const inputPath = path.join(root, 'checkpoint.json')
        try {
            writeManifest(manifestPath, createManifest({
                status: 'runtime_release_armed',
                releaseEpoch: 'epoch-cli',
                cutover: cutover()
            }))
            fs.writeFileSync(inputPath, '{}\n', { mode: 0o600 })
            const released = await run([
                'checkpoint',
                '--manifest', manifestPath,
                '--status', 'runtime_released',
                '--input', inputPath
            ])
            assert.strictEqual(released.migration.appliesToCommittedRuntime, true)
            const serialized = JSON.stringify(released)
            assert.ok(!serialized.includes('sourceHashes'))
            assert.ok(!serialized.includes(manifestPath))

            fs.writeFileSync(inputPath, '{"unknown":"secret"}\n', { mode: 0o600 })
            await assert.rejects(
                run([
                    'checkpoint',
                    '--manifest', manifestPath,
                    '--status', 'runtime_ready',
                    '--input', inputPath
                ]),
                (error) => error.code === 'MIGRATION_CHECKPOINT_FIELD_UNKNOWN'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('creates the first manifest from setup flat input and reads checkpoint from the manifest', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-checkpoint-'))
        fs.chmodSync(root, 0o700)
        const manifestPath = path.join(root, 'manifest.json')
        const inputPath = path.join(root, 'input.json')
        try {
            fs.writeFileSync(inputPath, `${JSON.stringify({
                manifestVersion: 1,
                checkpoint: 'cutover_intent',
                cutoverAttemptId: 'setup-attempt',
                releaseEpoch: 'release-setup-attempt',
                sourceRuntimeClass: 'legacy-v0',
                cutoverKind: 'first-managed-adoption',
                deliveryGuarantee: 'best-effort',
                exceptionScope: 'legacy-v0-first-cutover-inflight-outbound',
                affectedState: 'operations-without-durable-part-record',
                retryPolicy: 'retry-determinable-uncommitted-parent-or-target',
                ambiguousDeliveryWindow: true,
                fenceCapability: 'unavailable',
                forcedStop: false,
                writerSetArtifact: 'mount-writers.tsv',
                networkStateArtifact: 'networks.tsv',
                rollbackImageTag: 'bili-qq-bot:rollback-setup'
            })}\n`, { mode: 0o600 })
            const created = await run([
                'checkpoint', '--manifest', manifestPath, '--status', 'cutover_intent', '--input', inputPath
            ])
            assert.strictEqual(created.migration.checkpoint, 'cutover_intent')
            assert.strictEqual(await run(['status', '--manifest', manifestPath, '--field', 'checkpoint']), 'cutover_intent')
            assert.strictEqual(await run(['status', '--manifest', manifestPath, '--field', 'cutoverKind']), 'first-managed-adoption')
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            assert.strictEqual(raw.deployment.writerSetArtifact, 'mount-writers.tsv')
            assert.strictEqual(raw.deployment.rollbackImageTag, 'bili-qq-bot:rollback-setup')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
