'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteFile, ensurePrivateDir, sha256 } = require('../common/atomicFile')
const { hashPrivateFile, readPrivateFile, readPrivateText } = require('../common/privateFile')
const { MigrationError } = require('../common/errors')
const { stringifyConfigYaml, parseConfigYaml, validateConfigObject } = require('./configDocument')
const { resolveLegacyConfig, LEGACY_FILES } = require('./legacyLoader')
const {
    createManifest,
    writeManifest,
    readManifest,
    checkpointManifest,
    toPublicMigrationStatus,
    IMMUTABLE_PROVENANCE_FIELDS
} = require('./manifest')

function createMigrationDirectory(dataDir, migrationId = 'config-v0-to-v1') {
    const root = ensurePrivateDir(path.join(path.resolve(dataDir), 'migrations'))
    const suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${migrationId}`
    return ensurePrivateDir(path.join(root, suffix))
}

function backupLegacyFiles(configDir, migrationDir, options = {}) {
    const backups = []
    for (const [logicalName, fileName] of Object.entries(LEGACY_FILES)) {
        if (logicalName === 'yaml') continue
        const sourcePath = path.join(configDir, fileName)
        let source = options.capturedSources?.[logicalName]
        if (!source) {
            try {
                source = readPrivateFile(sourcePath, { mode: null }).data
            } catch (error) {
                if (error?.code === 'ENOENT') continue
                throw error
            }
        }
        source = Buffer.from(source)
        const expectedHash = options.sourceHashes?.[logicalName]
        if (expectedHash && sha256(source) !== expectedHash) throw new MigrationError('MIGRATION_SOURCE_HASH_CONFLICT')
        const artifact = `${logicalName}.backup`
        const backupPath = path.join(migrationDir, artifact)
        try {
            if (hashPrivateFile(backupPath) !== sha256(source)) throw new MigrationError('MIGRATION_BACKUP_CONFLICT')
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            atomicWriteFile(backupPath, source, { mode: 0o600, overwrite: false })
        }
        backups.push(artifact)
    }
    return backups
}

function migrateLegacy(options = {}) {
    const configDir = path.resolve(options.configDir)
    const configPath = options.configPath || path.join(configDir, 'config.yaml')
    const resolved = resolveLegacyConfig(options)
    const existingYamlSamePath = resolved.source === 'existing-yaml' && path.resolve(resolved.sourcePath) === path.resolve(configPath)
    if (existingYamlSamePath) {
        return {
            status: 'skipped-existing-yaml',
            config: resolved.config,
            warnings: [],
            publicStatus: null
        }
    }

    const yaml = resolved.source === 'existing-yaml'
        ? resolved.sourceText
        : stringifyConfigYaml(resolved.config, { validator: options.validator })
    if (resolved.source === 'existing-yaml') {
        try {
            const existingTarget = readPrivateFile(configPath).data
            if (sha256(existingTarget) !== sha256(yaml)) throw new MigrationError('MIGRATION_EXISTING_YAML_TARGET_CONFLICT')
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
    }
    const resolverWarningCodes = [...new Set(resolved.warnings.map((warning) => warning.code))]
    const cutover = {
        ...(options.cutover || {}),
        warningCodes: [...new Set([...(options.cutover?.warningCodes || []), ...resolverWarningCodes])]
    }
    if (options.dryRun) {
        const plannedManifest = createManifest({
            migrationId: options.migrationId || 'config-v0-to-v1',
            fromVersion: 0,
            toVersion: 1,
            status: 'candidate_written',
            sourceHashes: resolved.sourceHashes,
            targetHashes: { config_yaml: sha256(yaml) },
            archiveArtifacts: Object.keys(resolved.sourceHashes)
                .filter((name) => name !== 'runtime_env')
                .map((name) => `${name}.backup`),
            cutover
        })
        return {
            status: 'planned',
            config: resolved.config,
            yaml,
            warnings: resolved.warnings,
            manifestPath: null,
            manifest: plannedManifest,
            publicStatus: toPublicMigrationStatus(plannedManifest)
        }
    }
    const migrationDir = options.migrationDir ? ensurePrivateDir(options.migrationDir) : (options.manifestPath
        ? ensurePrivateDir(path.dirname(options.manifestPath))
        : createMigrationDirectory(options.dataDir, options.migrationId))
    const manifestPath = options.manifestPath || path.join(migrationDir, 'manifest.json')
    let existingManifest = null
    try {
        existingManifest = readManifest(manifestPath)
    } catch (error) {
        if (error?.code !== 'MIGRATION_MANIFEST_NOT_FOUND') throw error
    }
    if (existingManifest && !['snapshot_ready', 'candidate_written'].includes(existingManifest.status)) {
        throw new MigrationError('MIGRATION_MANIFEST_CHECKPOINT_CONFLICT')
    }
    if (existingManifest) {
        const firstSourceAdoption = existingManifest.status === 'snapshot_ready' &&
            Object.keys(existingManifest.sourceHashes).length === 0 &&
            Object.keys(existingManifest.targetHashes).length === 0 &&
            existingManifest.archiveArtifacts.length === 0
        if (!firstSourceAdoption) {
            if (Object.keys(existingManifest.sourceHashes).sort().join('\n') !== Object.keys(resolved.sourceHashes).sort().join('\n')) {
                throw new MigrationError('MIGRATION_SOURCE_HASH_CONFLICT')
            }
            for (const [name, hash] of Object.entries(existingManifest.sourceHashes)) {
                if (resolved.sourceHashes[name] !== hash) throw new MigrationError('MIGRATION_SOURCE_HASH_CONFLICT')
            }
        }
    }
    const archiveArtifacts = resolved.source === 'existing-yaml' ? [] : backupLegacyFiles(configDir, migrationDir, {
        capturedSources: resolved.capturedSources,
        sourceHashes: resolved.sourceHashes
    })
    if (existingManifest) {
        for (const field of IMMUTABLE_PROVENANCE_FIELDS) {
            if (cutover[field] !== existingManifest.cutover[field]) throw new MigrationError('MIGRATION_PROVENANCE_IMMUTABLE')
        }
    }
    const manifest = existingManifest
        ? {
            ...existingManifest,
            sourceHashes: { ...existingManifest.sourceHashes, ...resolved.sourceHashes },
            targetHashes: { ...existingManifest.targetHashes, config_yaml: sha256(yaml) },
            archiveArtifacts: [...new Set([...existingManifest.archiveArtifacts, ...archiveArtifacts])],
            cutover: {
                ...existingManifest.cutover,
                warningCodes: [...new Set([...existingManifest.cutover.warningCodes, ...resolverWarningCodes])]
            }
        }
        : createManifest({
            migrationId: options.migrationId || 'config-v0-to-v1',
            fromVersion: 0,
            toVersion: 1,
            status: 'snapshot_ready',
            sourceHashes: resolved.sourceHashes,
            targetHashes: { config_yaml: sha256(yaml) },
            archiveArtifacts,
            cutover
        })
    writeManifest(manifestPath, manifest)
    if (typeof options.faultInjector === 'function') {
        options.faultInjector('target_prepared', {
            manifestPath,
            targetHash: sha256(yaml),
            existingYaml: resolved.source === 'existing-yaml'
        })
    }
    let targetAlreadyPrepared = false
    try {
        const target = readPrivateFile(configPath).data
        if (sha256(target) !== sha256(yaml)) throw new MigrationError('MIGRATION_EXISTING_YAML_TARGET_CONFLICT')
        targetAlreadyPrepared = true
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
    if (!targetAlreadyPrepared) atomicWriteFile(configPath, yaml, { mode: 0o600, overwrite: false })
    let completedManifest = readManifest(manifestPath)
    if (completedManifest.status === 'snapshot_ready') {
        completedManifest = checkpointManifest(manifestPath, 'candidate_written')
    }
    return {
        status: 'candidate-written',
        config: resolved.config,
        yaml,
        warnings: resolved.warnings,
        manifestPath,
        manifest: completedManifest,
        publicStatus: toPublicMigrationStatus(completedManifest)
    }
}

function validateConfigFile(configPath, options = {}) {
    let text
    try {
        text = readPrivateText(configPath)
    } catch (error) {
        throw new MigrationError(error && error.code === 'ENOENT' ? 'CONFIG_FILE_NOT_FOUND' : 'CONFIG_FILE_READ_FAILED')
    }
    const parsed = parseConfigYaml(text)
    return validateConfigObject(parsed.value, { validator: options.validator })
}

module.exports = {
    createMigrationDirectory,
    backupLegacyFiles,
    migrateLegacy,
    validateConfigFile
}
