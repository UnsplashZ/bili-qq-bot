'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { RuntimeOwnerLock, assertNoActiveRuntimeOwner } = require('../config/configLock')
const { createDefaultV1Config, resolveLegacyConfig } = require('../migrations/config/legacyLoader')
const { parseConfigYaml, stringifyConfigYaml } = require('../migrations/config/configDocument')
const { ConfigSchemaMigrationRegistry } = require('../migrations/config/schemaRegistry')
const { DataMigrationRegistry } = require('../migrations/data')
const { atomicWriteFile, atomicWriteJson, ensurePrivateDir, sha256 } = require('../migrations/common/atomicFile')
const { readPrivateText } = require('../migrations/common/privateFile')
const { discoverConfigSource } = require('./sourceDiscovery')
const { normalizeBootstrapError, toPublicBootstrapError, ApplicationBootstrapError } = require('./bootstrapErrors')
const { setApplicationBootstrapStatus } = require('./bootstrapStatus')

const MANIFEST_VERSION = 1

function publicProjection(result) {
    return {
        status: result.status,
        migrationId: result.migrationId,
        sourceClass: result.sourceClass,
        configSchemaVersion: result.config.schemaVersion,
        configMigrated: result.config.migrated,
        configCreated: result.config.created,
        dataGeneration: result.data.generation,
        dataMigrations: [...result.data.migrationsApplied],
        archiveEligible: result.archive.eligible,
        deploymentApplyRequired: result.status === 'deployment-apply-required',
        recoveryRequired: result.status === 'recovery-required',
        warnings: result.warnings.map((item) => ({ code: item.code })),
        releaseEpoch: result.releaseEpoch || null
    }
}

class ApplicationMigrationBootstrap {
    constructor(options = {}) {
        this.configDir = path.resolve(options.configDir || path.join(__dirname, '../../config'))
        this.dataDir = path.resolve(options.dataDir || path.join(__dirname, '../../data'))
        this.stateDir = path.resolve(options.stateDir || path.join(this.dataDir, 'application-migration'))
        this.manifestPath = path.join(this.stateDir, 'manifest.json')
        this.archiveProofPath = path.join(this.stateDir, 'archive-proof.tsv')
        this.schemaBackupPath = path.join(this.stateDir, 'config-schema-source.yaml')
        this.bootstrapLock = options.bootstrapLock || new RuntimeOwnerLock({
            lockPath: path.join(this.stateDir, 'bootstrap-owner.lock'),
            identityProvider: options.identityProvider
        })
        this.runtimeOwnerPath = options.runtimeOwnerPath || path.join(this.dataDir, 'config-state', 'config-owner.lock')
        this.schemaRegistry = options.schemaRegistry || new ConfigSchemaMigrationRegistry(options.schemaOptions)
        this.dataRegistry = options.dataRegistry || new DataMigrationRegistry({ dataDir: this.dataDir, migrators: options.migrators, faultInjector: options.dataFaultInjector })
        this.faultInjector = options.faultInjector
        this.held = false
    }

    readManifest() {
        try {
            const value = JSON.parse(readPrivateText(this.manifestPath))
            if (value?.manifestVersion !== MANIFEST_VERSION || typeof value.migrationId !== 'string') {
                throw new ApplicationBootstrapError('CONFIG_BOOTSTRAP_RECOVERY_REQUIRED')
            }
            return value
        } catch (error) {
            if (error?.code === 'ENOENT') return null
            throw error
        }
    }

    writeManifest(value) {
        ensurePrivateDir(this.stateDir)
        atomicWriteJson(this.manifestPath, value, { mode: 0o600 })
    }

    async run(options = {}) {
        if (!options.dryRun) {
            await this.bootstrapLock.acquire()
            this.held = true
        }
        let schemaRestore = null
        try {
            assertNoActiveRuntimeOwner(this.runtimeOwnerPath, { identityProvider: options.identityProvider })
            const discovery = discoverConfigSource({ configDir: this.configDir, installInput: options.installInput, createIfMissing: options.createIfMissing })
            const previous = this.readManifest()
            const migrationId = previous?.migrationId || crypto.randomUUID()
            let config
            let schemaApplied = []
            let created = false
            let warnings = []
            let legacyHashes = {}

            if (options.dryRun) {
                if (discovery.sourceClass === 'managed-v1+') {
                    const migrated = this.schemaRegistry.migrate(discovery.value)
                    config = migrated.config
                    schemaApplied = migrated.applied
                } else if (discovery.sourceClass === 'legacy-v0') {
                    if (options.allowLegacyMigration === false) throw new ApplicationBootstrapError('MIGRATION_LEGACY_WRITER_UNSAFE')
                    const resolved = resolveLegacyConfig({
                        configDir: this.configDir,
                        runtimeEnv: options.runtimeEnv || process.env,
                        requireRuntimeEnvSnapshot: false,
                        allowGenerateJwtSecret: false,
                        validator: options.validator
                    })
                    config = resolved.config
                    warnings = resolved.warnings
                } else {
                    config = createDefaultV1Config(options.installInput || {})
                }
                const dataPlan = fs.existsSync(this.dataDir)
                    ? await this.dataRegistry.check()
                    : { currentVersion: 0, pending: this.dataRegistry.migrators.map((item) => item.id) }
                return {
                    status: 'planned', sourceClass: discovery.sourceClass,
                    configValue: config,
                    config: { schemaVersion: config.version, migrated: schemaApplied.length > 0 || discovery.sourceClass === 'legacy-v0', created: discovery.sourceClass === 'fresh-install' },
                    data: { generation: dataPlan.currentVersion, migrationsApplied: [], pending: dataPlan.pending },
                    archive: { eligible: discovery.sourceClass === 'legacy-v0', proofId: null, legacyFiles: discovery.legacyFiles },
                    warnings: warnings.map((item) => ({ code: item.code, path: item.path }))
                }
            }

            if (discovery.sourceClass === 'managed-v1+') {
                const migrated = this.schemaRegistry.migrate(discovery.value)
                config = migrated.config
                schemaApplied = migrated.applied
                if (schemaApplied.length > 0) {
                    ensurePrivateDir(this.stateDir)
                    if (!fs.existsSync(this.schemaBackupPath)) {
                        atomicWriteFile(this.schemaBackupPath, discovery.source, { mode: 0o600, overwrite: false })
                    }
                    this.writeManifest({
                        manifestVersion: MANIFEST_VERSION,
                        migrationId,
                        status: 'schema-prepared',
                        sourceClass: discovery.sourceClass,
                        schema: { sourceHash: sha256(discovery.source), targetVersion: config.version, applied: schemaApplied },
                        updatedAt: new Date().toISOString()
                    })
                    this.faultInjector?.('schema-prepared', { migrationId })
                    const candidateSource = stringifyConfigYaml(config)
                    atomicWriteFile(discovery.configPath, candidateSource, { mode: 0o600 })
                    schemaRestore = { configPath: discovery.configPath, candidateHash: sha256(candidateSource), source: discovery.source }
                }
            } else if (discovery.sourceClass === 'legacy-v0') {
                if (options.allowLegacyMigration === false) throw new ApplicationBootstrapError('MIGRATION_LEGACY_WRITER_UNSAFE')
                const resolved = resolveLegacyConfig({
                    configDir: this.configDir,
                    runtimeEnv: options.runtimeEnv || process.env,
                    requireRuntimeEnvSnapshot: false,
                    allowGenerateJwtSecret: true,
                    validator: options.validator
                })
                config = resolved.config
                warnings = resolved.warnings
                legacyHashes = resolved.sourceHashes
                atomicWriteFile(discovery.configPath, stringifyConfigYaml(config), { mode: 0o600, overwrite: false })
                created = true
            } else {
                const input = options.installInput || {}
                config = createDefaultV1Config(input)
                atomicWriteFile(discovery.configPath, stringifyConfigYaml(config), { mode: 0o600, overwrite: false })
                created = true
            }

            const configSource = readPrivateText(discovery.configPath)
            const configHash = sha256(configSource)
            this.faultInjector?.('config-ready', { migrationId })
            const dataResult = await this.dataRegistry.apply()
            this.faultInjector?.('data-ready', { migrationId })
            const previousArchive = previous?.status === 'ready' && previous?.config?.documentHash === configHash
                ? previous.archive
                : null
            const legacyFiles = discovery.sourceClass === 'legacy-v0'
                ? discovery.legacyFiles
                : (previousArchive?.eligible ? previousArchive.legacyFiles : [])
            if (Object.keys(legacyHashes).length === 0 && previousArchive?.eligible) {
                legacyHashes = previousArchive.sourceHashes || {}
            }
            const proofId = legacyFiles.length > 0
                ? sha256(JSON.stringify({ migrationId, legacyHashes, configHash }))
                : null
            if (legacyFiles.length > 0) {
                const proofLines = legacyFiles.map((name) => {
                    const stat = fs.lstatSync(path.join(this.configDir, name))
                    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(this.configDir, name))).digest('hex')
                    return `${name}|${stat.dev}|${stat.ino}|${hash}`
                })
                atomicWriteFile(this.archiveProofPath, `${proofLines.join('\n')}\n`, { mode: 0o600 })
            }
            const manifest = {
                manifestVersion: MANIFEST_VERSION,
                migrationId,
                status: 'ready',
                sourceClass: previousArchive?.eligible ? previous.sourceClass : discovery.sourceClass,
                config: {
                    schemaVersion: config.version,
                    documentHash: configHash,
                    migrated: previousArchive?.eligible || schemaApplied.length > 0 || discovery.sourceClass === 'legacy-v0',
                    created: previousArchive?.eligible ? Boolean(previous.config?.created) : created
                },
                data: { generation: dataResult.state.schemaVersion, migrationsApplied: [...dataResult.state.applied] },
                archive: { eligible: legacyFiles.length > 0, proofId, legacyFiles, sourceHashes: legacyHashes, proofArtifact: legacyFiles.length > 0 ? 'archive-proof.tsv' : null },
                warnings: warnings.map((item) => ({ code: item.code })),
                deploymentAttemptId: options.deploymentAttemptId || null,
                releaseEpoch: options.releaseEpoch || null,
                updatedAt: new Date().toISOString()
            }
            this.writeManifest(manifest)
            const result = {
                status: 'ready', migrationId, sourceClass: manifest.sourceClass, releaseEpoch: manifest.releaseEpoch,
                config: { path: discovery.configPath, ...manifest.config }, data: manifest.data,
                archive: { eligible: manifest.archive.eligible, proofId, legacyFiles }, warnings: manifest.warnings
            }
            result.publicStatus = publicProjection(result)
            setApplicationBootstrapStatus(result.publicStatus)
            if (!options.retainLockForHandoff) await this.release()
            return result
        } catch (error) {
            if (schemaRestore) {
                try {
                    const current = readPrivateText(schemaRestore.configPath)
                    if (sha256(current) !== schemaRestore.candidateHash) {
                        throw new ApplicationBootstrapError('CONFIG_BOOTSTRAP_RECOVERY_REQUIRED')
                    }
                    atomicWriteFile(schemaRestore.configPath, schemaRestore.source, { mode: 0o600 })
                } catch (restoreError) {
                    const normalizedRestore = normalizeBootstrapError(restoreError)
                    setApplicationBootstrapStatus({ status: 'recovery-required', recoveryRequired: true, publicError: toPublicBootstrapError(normalizedRestore) })
                    await this.release().catch(() => {})
                    throw normalizedRestore
                }
            }
            const normalized = normalizeBootstrapError(error)
            setApplicationBootstrapStatus({ status: 'recovery-required', recoveryRequired: true, publicError: toPublicBootstrapError(normalized) })
            await this.release().catch(() => {})
            throw normalized
        } finally {
            if (options.dryRun) await this.release().catch(() => {})
        }
    }

    async handoff(configService, options = {}) {
        if (!this.held) throw new ApplicationBootstrapError('CONFIG_BOOTSTRAP_OWNER_CONFLICT')
        try {
            await configService.initialize({ ...options, createIfMissing: false, afterOwnerAcquired: () => this.release() })
        } catch (error) {
            await this.release().catch(() => {})
            throw error
        }
    }

    async runDataOnly(options = {}) {
        await this.bootstrapLock.acquire()
        this.held = true
        try {
            assertNoActiveRuntimeOwner(this.runtimeOwnerPath, { identityProvider: options.identityProvider })
            const result = await this.dataRegistry.apply()
            return {
                status: 'ready',
                changed: result.changed,
                data: { generation: result.state.schemaVersion, migrationsApplied: [...result.state.applied] },
                afterInventory: result.afterInventory
            }
        } catch (error) {
            throw normalizeBootstrapError(error)
        } finally {
            await this.release().catch(() => {})
        }
    }

    async release() {
        if (!this.held) return
        this.held = false
        await this.bootstrapLock.release()
    }
}

module.exports = { ApplicationMigrationBootstrap, publicProjection }
