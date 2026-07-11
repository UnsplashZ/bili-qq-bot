#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { DataMigrationRegistry } = require('../migrations/data')
const {
    createManifest,
    writeManifest,
    checkpointManifest,
    readManifest,
    toPublicMigrationStatus
} = require('../migrations/config/manifest')
const { MigrationError } = require('../migrations/common/errors')
const { withOfflineRuntimeOwner } = require('../config/configLock')
const {
    parseArgs,
    requireOption,
    readProtectedJson,
    writeOutput,
    exitWithError,
    resolvePath
} = require('./_shared')

const HELP = `Usage: node src/cli/data-migrate.js <command> [options]

Commands:
  check --root DIR [--manifest FILE] [--json]
  apply --root DIR [--manifest FILE] [--json]
  rollback --root DIR [--manifest FILE] [--json]
  checkpoint --manifest FILE --status ENUM --input FILE [--json]
  status --manifest FILE [--field checkpoint|phase] [--json]

Aliases:
  --data-dir is accepted instead of --root. --root points to an install/work root containing data/.`

function summarizeInventory(inventory) {
    const strong = {}
    for (const [name, value] of Object.entries(inventory.strong || {})) {
        strong[name] = { present: Boolean(value.present), count: value.count || 0 }
    }
    const preserve = {}
    for (const [name, value] of Object.entries(inventory.preserve || {})) {
        preserve[name] = { present: Boolean(value.present), fileCount: value.fileCount || 0 }
    }
    return { fingerprint: inventory.fingerprint, strong, preserve }
}

function createRegistry(args, dependencies = {}) {
    const root = args.root ? resolvePath(args.root) : null
    const dataDir = root ? path.join(root, 'data') : resolvePath(requireOption(args, 'data-dir'))
    return new DataMigrationRegistry({
        dataDir,
        statePath: args.state ? resolvePath(args.state) : undefined,
        migrationDir: args['migration-dir'] ? resolvePath(args['migration-dir']) : undefined,
        migrators: dependencies.migrators
    })
}

function runtimeOwnerPath(args) {
    if (args['owner-lock']) return resolvePath(args['owner-lock'])
    const root = args.root ? resolvePath(args.root) : null
    const dataDir = root ? path.join(root, 'data') : resolvePath(requireOption(args, 'data-dir'))
    return path.join(dataDir, 'runtime', 'config-owner.lock')
}

const FLAT_CHECKPOINT_KEYS = new Set([
    'manifestVersion',
    'checkpoint',
    'cutoverAttemptId',
    'releaseEpoch',
    'sourceRuntimeClass',
    'cutoverKind',
    'deliveryGuarantee',
    'exceptionScope',
    'affectedState',
    'retryPolicy',
    'ambiguousDeliveryWindow',
    'ambiguousDeliveryWindowStartedAt',
    'ambiguousDeliveryWindowEndedAt',
    'fenceCapability',
    'stopMode',
    'fenceAttempted',
    'fenceEstablished',
    'forcedStop',
    'drainOutcome',
    'legacyFeatureInventory',
    'warningCodes',
    'writerSetArtifact',
    'networkStateArtifact',
    'rollbackImageTag',
    'businessAdmissionOpened',
    'sourceHashes',
    'targetHashes',
    'snapshotHashes',
    'dataSchemaVersion',
    'configSchemaVersion',
    'archiveArtifacts',
    'cutover',
    'deployment'
])

function normalizeCheckpointInput(input, status) {
    for (const key of Object.keys(input)) {
        if (!FLAT_CHECKPOINT_KEYS.has(key)) throw new MigrationError('MIGRATION_CHECKPOINT_FIELD_UNKNOWN')
    }
    if (input.manifestVersion !== undefined && input.manifestVersion !== 1) {
        throw new MigrationError('MIGRATION_MANIFEST_VERSION_UNSUPPORTED')
    }
    if (input.checkpoint !== undefined && input.checkpoint !== status) {
        throw new MigrationError('MIGRATION_CHECKPOINT_STATUS_CONFLICT')
    }
    const output = {}
    for (const key of [
        'releaseEpoch',
        'businessAdmissionOpened',
        'sourceHashes',
        'targetHashes',
        'snapshotHashes',
        'dataSchemaVersion',
        'configSchemaVersion',
        'archiveArtifacts'
    ]) {
        if (input[key] !== undefined) output[key] = input[key]
    }
    if (['runtime_ready', 'upgrade_complete'].includes(status) && output.businessAdmissionOpened === undefined) {
        output.businessAdmissionOpened = true
    }

    if (input.cutover !== undefined) {
        output.cutover = input.cutover
    } else if (input.sourceRuntimeClass !== undefined || input.deliveryGuarantee !== undefined) {
        const sourceRuntimeClass = input.sourceRuntimeClass || 'fresh-install'
        const bestEffort = (input.deliveryGuarantee || 'exactly-once') === 'best-effort'
        const forcedStop = Boolean(input.forcedStop)
        const fenceCapability = input.fenceCapability || (sourceRuntimeClass === 'legacy-v0' ? 'unavailable' : 'not-required')
        const warningCodes = Array.isArray(input.warningCodes) ? [...input.warningCodes] : []
        if (bestEffort && !warningCodes.includes('LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS')) {
            warningCodes.push('LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS')
        }
        if (forcedStop && !warningCodes.includes('LEGACY_FORCED_STOP_BEST_EFFORT')) {
            warningCodes.push('LEGACY_FORCED_STOP_BEST_EFFORT')
        }
        if (sourceRuntimeClass === 'legacy-v0' && fenceCapability === 'unavailable' &&
            !warningCodes.includes('LEGACY_NETWORK_FENCE_UNAVAILABLE')) {
            warningCodes.push('LEGACY_NETWORK_FENCE_UNAVAILABLE')
        }
        output.cutover = {
            sourceRuntimeClass,
            cutoverKind: input.cutoverKind || (sourceRuntimeClass === 'fresh-install' ? 'fresh-install' : 'first-managed-adoption'),
            cutoverAttemptId: String(input.cutoverAttemptId || ''),
            deliveryGuarantee: bestEffort ? 'best-effort' : 'exactly-once',
            exceptionScope: input.exceptionScope || (bestEffort ? 'legacy-v0-first-cutover-inflight-outbound' : 'none'),
            affectedState: input.affectedState || (bestEffort ? 'operations-without-durable-part-record' : 'none'),
            retryPolicy: input.retryPolicy || (bestEffort ? 'retry-determinable-uncommitted-parent-or-target' : 'none'),
            ambiguousDeliveryWindow: input.ambiguousDeliveryWindow !== undefined ? input.ambiguousDeliveryWindow : bestEffort,
            ambiguousDeliveryWindowStartedAt: input.ambiguousDeliveryWindowStartedAt || null,
            ambiguousDeliveryWindowEndedAt: input.ambiguousDeliveryWindowEndedAt || null,
            fenceCapability,
            stopMode: input.stopMode || (sourceRuntimeClass === 'fresh-install' ? 'not-required' : (forcedStop ? 'forced' : 'graceful')),
            fenceAttempted: input.fenceAttempted !== undefined ? Boolean(input.fenceAttempted) : ['best-effort', 'established'].includes(fenceCapability),
            fenceEstablished: input.fenceEstablished !== undefined ? Boolean(input.fenceEstablished) : fenceCapability === 'established',
            forcedStop,
            drainOutcome: input.drainOutcome || (sourceRuntimeClass === 'fresh-install' ? 'not-required' : 'interrupted'),
            legacyFeatureInventory: Array.isArray(input.legacyFeatureInventory) ? [...input.legacyFeatureInventory] : [],
            warningCodes,
            appliesToCommittedRuntime: false
        }
    }

    if (input.deployment !== undefined) output.deployment = input.deployment
    else if (input.writerSetArtifact !== undefined || input.networkStateArtifact !== undefined || input.rollbackImageTag !== undefined) {
        output.deployment = {
            writerSetArtifact: input.writerSetArtifact || null,
            networkStateArtifact: input.networkStateArtifact || null,
            rollbackImageTag: input.rollbackImageTag || null
        }
    }
    return output
}

async function commandCheck(args, dependencies = {}) {
    const result = await createRegistry(args, dependencies).check()
    return {
        ok: true,
        action: 'check',
        currentVersion: result.currentVersion,
        targetVersion: result.targetVersion,
        pending: result.pending,
        inventory: summarizeInventory(result.inventory)
    }
}

async function commandApply(args, dependencies = {}) {
    const registry = createRegistry(args, dependencies)
    const result = await withOfflineRuntimeOwner(runtimeOwnerPath(args), () => registry.apply())
    return {
        ok: true,
        action: 'apply',
        changed: result.changed,
        schemaVersion: result.state.schemaVersion,
        applied: [...result.state.applied],
        inventory: summarizeInventory(result.afterInventory)
    }
}

async function commandRollback(args, dependencies = {}) {
    const registry = createRegistry(args, dependencies)
    const result = await withOfflineRuntimeOwner(runtimeOwnerPath(args), () => registry.rollback())
    return {
        ok: true,
        action: 'rollback',
        changed: result.changed,
        schemaVersion: result.state.schemaVersion,
        applied: [...result.state.applied]
    }
}

function commandCheckpoint(args) {
    const manifestPath = resolvePath(requireOption(args, 'manifest'))
    const status = requireOption(args, 'status')
    const input = normalizeCheckpointInput(readProtectedJson(requireOption(args, 'input')), status)
    if (!fs.existsSync(manifestPath)) {
        if (!['discovered', 'cutover_intent'].includes(status)) throw new MigrationError('MIGRATION_MANIFEST_NOT_FOUND')
        const initial = createManifest({
            status: 'discovered',
            releaseEpoch: input.releaseEpoch ?? null,
            businessAdmissionOpened: false,
            sourceHashes: input.sourceHashes || {},
            targetHashes: input.targetHashes || {},
            snapshotHashes: input.snapshotHashes || {},
            dataSchemaVersion: input.dataSchemaVersion,
            configSchemaVersion: input.configSchemaVersion,
            archiveArtifacts: input.archiveArtifacts || [],
            deployment: input.deployment,
            cutover: input.cutover
        })
        writeManifest(manifestPath, initial)
        if (status === 'discovered') {
            return { ok: true, action: 'checkpoint', migration: toPublicMigrationStatus(initial) }
        }
    }
    const manifest = checkpointManifest(manifestPath, status, input)
    return { ok: true, action: 'checkpoint', migration: toPublicMigrationStatus(manifest) }
}

function commandStatus(args) {
    const manifest = readManifest(resolvePath(requireOption(args, 'manifest')))
    const migration = toPublicMigrationStatus(manifest)
    if (args.field !== undefined) {
        if (!['checkpoint', 'phase', 'cutoverKind'].includes(args.field)) throw new MigrationError('MIGRATION_STATUS_FIELD_INVALID')
        return migration[args.field]
    }
    return { ok: true, action: 'status', migration }
}

async function run(argv = process.argv.slice(2), dependencies = {}) {
    const args = parseArgs(argv)
    const command = args._[0]
    if (args.help || command === 'help') return HELP
    if (command === 'check') return commandCheck(args, dependencies)
    if (command === 'apply') return commandApply(args, dependencies)
    if (command === 'rollback') return commandRollback(args, dependencies)
    if (command === 'checkpoint') return commandCheckpoint(args)
    if (command === 'status') return commandStatus(args)
    throw new MigrationError('CLI_COMMAND_UNKNOWN')
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2))
    Promise.resolve(run(process.argv.slice(2)))
        .then((result) => writeOutput(result, Boolean(args.json)))
        .catch((error) => exitWithError(error, Boolean(args.json)))
}

module.exports = {
    run,
    commandCheck,
    commandApply,
    commandRollback,
    commandCheckpoint,
    commandStatus,
    summarizeInventory,
    normalizeCheckpointInput,
    runtimeOwnerPath,
    HELP
}
