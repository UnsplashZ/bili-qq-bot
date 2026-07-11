'use strict'

const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { atomicWriteJson, assertPrivateFile, hashFile } = require('../common/atomicFile')
const { MigrationError } = require('../common/errors')
const { validateConfigFile } = require('./index')

const PLAN_VERSION = 1
const ARTIFACT_VERSION = 1
const HASH_PATTERN = /^[a-f0-9]{64}$/
const MOUNT_TARGETS = Object.freeze({
    config: '/app/config',
    data: '/app/data',
    logs: '/app/logs',
    fonts: '/app/fonts/custom',
    napcatConfig: '/app/napcat/config',
    napcatQq: '/app/.config/QQ'
})
const SERVICE_MOUNTS = Object.freeze({
    'bili-qq-bot': Object.freeze(['config', 'data', 'logs', 'fonts', 'napcatQq']),
    napcat: Object.freeze(['napcatConfig', 'napcatQq'])
})
const SHARED_MOUNT_IDENTITIES = Object.freeze({ napcatQq: 'napcat-qq-home' })
const PRESERVE_REQUIRED_KEYS = new Set(['config', 'data', 'fonts', 'napcatConfig', 'napcatQq'])
const PLAN_KEYS = new Set([
    'version',
    'configFingerprint',
    'existingComposeFingerprint',
    'provider',
    'requiresRelocation',
    'mounts',
    'requiredOperationCount',
    'planFingerprint'
])
const MOUNT_KEYS = new Set(['service', 'key', 'containerTarget', 'oldSource', 'newSource', 'preserveRequired', 'sharedIdentity'])
const ARTIFACT_KEYS = new Set([
    'version',
    'planFingerprint',
    'configFingerprint',
    'existingComposeFingerprint',
    'operations',
    'validatedAt'
])
const OPERATION_KEYS = new Set([
    'key',
    'sharedIdentity',
    'containerTarget',
    'oldSource',
    'newSource',
    'operation',
    'inventory',
    'bindings'
])
const BINDING_KEYS = new Set(['service', 'containerTarget'])
const INVENTORY_KEYS = new Set(['beforeFingerprint', 'afterFingerprint', 'matched'])

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!isPlainObject(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function parseVolume(value) {
    if (typeof value === 'string') {
        const parts = value.split(':')
        return { source: parts[0] || '', target: parts[1] || '' }
    }
    if (isPlainObject(value)) return { source: String(value.source || ''), target: String(value.target || '') }
    return { source: '', target: '' }
}

function canonicalMountIdentity(source, composeDir = process.cwd()) {
    const raw = String(source || '')
    if (!raw) return ''
    if (!raw.includes('/') && !raw.startsWith('.')) return `volume:${raw}`
    const resolved = path.resolve(composeDir, raw)
    try {
        return `path:${fs.realpathSync.native(resolved)}`
    } catch (error) {
        if (error?.code !== 'ENOENT') throw new MigrationError('DEPLOYMENT_MOUNT_SOURCE_UNSAFE')
        return `path:${resolved}`
    }
}

function mountAddress(service, target) {
    return `${service}\u0000${target}`
}

function findExistingMounts(compose, options = {}) {
    const byTarget = new Map()
    for (const serviceName of ['bili-qq-bot', 'napcat']) {
        for (const raw of compose?.services?.[serviceName]?.volumes || []) {
            const volume = parseVolume(raw)
            const address = mountAddress(serviceName, volume.target)
            if (volume.target && !byTarget.has(address)) byTarget.set(address, volume.source)
        }
    }
    const sharedSources = ['bili-qq-bot', 'napcat']
        .map((service) => byTarget.get(mountAddress(service, MOUNT_TARGETS.napcatQq)))
        .filter((source) => source !== undefined)
    if (sharedSources.length > 1) {
        const identities = new Set(sharedSources.map((source) => canonicalMountIdentity(source, options.composeDir)))
        if (identities.size !== 1) throw new MigrationError('DEPLOYMENT_SHARED_MOUNT_IDENTITY_MISMATCH')
        for (const service of ['bili-qq-bot', 'napcat']) {
            const address = mountAddress(service, MOUNT_TARGETS.napcatQq)
            if (byTarget.has(address)) byTarget.set(address, sharedSources[0])
        }
    }
    return byTarget
}

function uniqueRelocations(mounts) {
    const byIdentity = new Map()
    for (const mount of mounts) {
        const logicalIdentity = mount.sharedIdentity || `${mount.service}:${mount.key}`
        const existing = byIdentity.get(logicalIdentity)
        if (existing && (existing.newSource !== mount.newSource || existing.key !== mount.key)) {
            throw new MigrationError('DEPLOYMENT_SHARED_MOUNT_IDENTITY_MISMATCH')
        }
        if (existing) {
            if (mount.oldSource !== null) existing.oldSources.add(mount.oldSource)
            existing.bindings.push({ service: mount.service, containerTarget: mount.containerTarget })
        }
        else byIdentity.set(logicalIdentity, {
            ...mount,
            oldSources: new Set(mount.oldSource === null ? [] : [mount.oldSource]),
            bindings: [{ service: mount.service, containerTarget: mount.containerTarget }]
        })
    }
    const operations = []
    for (const item of byIdentity.values()) {
        if (item.oldSources.size > 1) throw new MigrationError('DEPLOYMENT_SHARED_MOUNT_IDENTITY_MISMATCH')
        const oldSource = [...item.oldSources][0] || null
        if (oldSource === null || oldSource === item.newSource) continue
        delete item.oldSources
        operations.push({
            ...item,
            oldSource,
            bindings: item.bindings.sort((left, right) => `${left.service}:${left.containerTarget}`.localeCompare(`${right.service}:${right.containerTarget}`))
        })
    }
    return operations
}

function assertRegularFile(filePath, code) {
    const stat = fs.lstatSync(filePath)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new MigrationError(code)
}

function buildDeploymentPlan(options = {}) {
    const configPath = path.resolve(options.configPath)
    assertRegularFile(configPath, 'DEPLOYMENT_CONFIG_FILE_UNSAFE')
    const config = validateConfigFile(configPath, { validator: options.validator })
    const existingComposePath = options.existingComposePath ? path.resolve(options.existingComposePath) : null
    let compose = null
    if (existingComposePath) {
        assertRegularFile(existingComposePath, 'DEPLOYMENT_COMPOSE_FILE_UNSAFE')
        compose = options.readCompose(existingComposePath)
    }
    const existingMounts = findExistingMounts(compose, { composeDir: existingComposePath ? path.dirname(existingComposePath) : process.cwd() })
    const desiredMounts = config.deployment?.mounts || {}
    const services = config.qq?.provider === 'official' ? ['bili-qq-bot'] : ['bili-qq-bot', 'napcat']
    const mounts = services.flatMap((service) => SERVICE_MOUNTS[service]
        .filter((key) => config.qq?.provider !== 'official' || key !== 'napcatQq')
        .map((key) => {
            const containerTarget = MOUNT_TARGETS[key]
            return {
                service,
                key,
                containerTarget,
                oldSource: existingMounts.get(mountAddress(service, containerTarget)) || null,
                newSource: String(desiredMounts[key] || ''),
                preserveRequired: PRESERVE_REQUIRED_KEYS.has(key),
                sharedIdentity: SHARED_MOUNT_IDENTITIES[key] || null
            }
        }))
    const relocated = uniqueRelocations(mounts)
    const planWithoutFingerprint = {
        version: PLAN_VERSION,
        configFingerprint: hashFile(configPath),
        existingComposeFingerprint: existingComposePath ? hashFile(existingComposePath) : null,
        provider: config.qq.provider,
        requiresRelocation: relocated.length > 0,
        mounts,
        requiredOperationCount: relocated.length
    }
    return {
        ...planWithoutFingerprint,
        planFingerprint: fingerprint(planWithoutFingerprint)
    }
}

function validatePlan(plan) {
    if (!isPlainObject(plan) || plan.version !== PLAN_VERSION) throw new MigrationError('DEPLOYMENT_PLAN_INVALID')
    for (const key of Object.keys(plan)) if (!PLAN_KEYS.has(key)) throw new MigrationError('DEPLOYMENT_PLAN_FIELD_UNKNOWN')
    if (!HASH_PATTERN.test(plan.configFingerprint) ||
        (plan.existingComposeFingerprint !== null && !HASH_PATTERN.test(plan.existingComposeFingerprint)) ||
        !HASH_PATTERN.test(plan.planFingerprint)) {
        throw new MigrationError('DEPLOYMENT_PLAN_FINGERPRINT_INVALID')
    }
    if (!['napcat', 'official'].includes(plan.provider) || typeof plan.requiresRelocation !== 'boolean' ||
        !Number.isSafeInteger(plan.requiredOperationCount) || plan.requiredOperationCount < 0 || !Array.isArray(plan.mounts)) {
        throw new MigrationError('DEPLOYMENT_PLAN_INVALID')
    }
    for (const mount of plan.mounts) {
        if (!isPlainObject(mount)) throw new MigrationError('DEPLOYMENT_PLAN_MOUNT_INVALID')
        for (const key of Object.keys(mount)) if (!MOUNT_KEYS.has(key)) throw new MigrationError('DEPLOYMENT_PLAN_MOUNT_FIELD_UNKNOWN')
        if (!Object.prototype.hasOwnProperty.call(SERVICE_MOUNTS, mount.service) || !SERVICE_MOUNTS[mount.service].includes(mount.key) ||
            !Object.prototype.hasOwnProperty.call(MOUNT_TARGETS, mount.key) || MOUNT_TARGETS[mount.key] !== mount.containerTarget ||
            (mount.oldSource !== null && typeof mount.oldSource !== 'string') || typeof mount.newSource !== 'string' ||
            typeof mount.preserveRequired !== 'boolean' ||
            mount.sharedIdentity !== (SHARED_MOUNT_IDENTITIES[mount.key] || null)) {
            throw new MigrationError('DEPLOYMENT_PLAN_MOUNT_INVALID')
        }
    }
    const mountAddresses = plan.mounts.map((mount) => mountAddress(mount.service, mount.containerTarget))
    if (new Set(mountAddresses).size !== mountAddresses.length) throw new MigrationError('DEPLOYMENT_PLAN_MOUNT_DUPLICATE')
    const withoutFingerprint = { ...plan }
    delete withoutFingerprint.planFingerprint
    if (fingerprint(withoutFingerprint) !== plan.planFingerprint) throw new MigrationError('DEPLOYMENT_PLAN_FINGERPRINT_MISMATCH')
    const relocated = uniqueRelocations(plan.mounts)
    if (relocated.length !== plan.requiredOperationCount || (relocated.length > 0) !== plan.requiresRelocation) {
        throw new MigrationError('DEPLOYMENT_PLAN_RELOCATION_COUNT_INVALID')
    }
    return plan
}

function writeDeploymentPlanArtifact(outputPath, plan) {
    validatePlan(plan)
    atomicWriteJson(outputPath, plan, { mode: 0o600 })
    return plan
}

function readValidatedArtifact(artifactPath) {
    assertPrivateFile(artifactPath)
    let artifact
    try {
        artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    } catch {
        throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_INVALID')
    }
    if (!isPlainObject(artifact) || artifact.version !== ARTIFACT_VERSION) throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_INVALID')
    for (const key of Object.keys(artifact)) if (!ARTIFACT_KEYS.has(key)) throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_FIELD_UNKNOWN')
    for (const key of ['planFingerprint', 'configFingerprint']) {
        if (!HASH_PATTERN.test(artifact[key])) throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_FINGERPRINT_INVALID')
    }
    if (artifact.existingComposeFingerprint !== null && !HASH_PATTERN.test(artifact.existingComposeFingerprint)) {
        throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_FINGERPRINT_INVALID')
    }
    if (typeof artifact.validatedAt !== 'string' || !Number.isFinite(Date.parse(artifact.validatedAt)) || !Array.isArray(artifact.operations)) {
        throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_INVALID')
    }
    return artifact
}

function validateRelocationArtifact(artifactPath, plan) {
    validatePlan(plan)
    const artifact = readValidatedArtifact(artifactPath)
    if (artifact.planFingerprint !== plan.planFingerprint || artifact.configFingerprint !== plan.configFingerprint ||
        artifact.existingComposeFingerprint !== plan.existingComposeFingerprint) {
        throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_PLAN_MISMATCH')
    }
    const expected = new Map(uniqueRelocations(plan.mounts)
        .map((mount) => [mount.key, mount]))
    if (artifact.operations.length !== expected.size) throw new MigrationError('DEPLOYMENT_RELOCATION_ARTIFACT_OPERATION_MISMATCH')
    const seen = new Set()
    for (const operation of artifact.operations) {
        if (!isPlainObject(operation)) throw new MigrationError('DEPLOYMENT_RELOCATION_OPERATION_INVALID')
        for (const key of Object.keys(operation)) if (!OPERATION_KEYS.has(key)) throw new MigrationError('DEPLOYMENT_RELOCATION_OPERATION_FIELD_UNKNOWN')
        const mount = expected.get(operation.key)
        if (!mount || seen.has(operation.key) || operation.containerTarget !== mount.containerTarget ||
            operation.oldSource !== mount.oldSource || operation.newSource !== mount.newSource ||
            operation.sharedIdentity !== mount.sharedIdentity ||
            !['copy-and-switch', 'preserve-in-place'].includes(operation.operation) || !Array.isArray(operation.bindings)) {
            throw new MigrationError('DEPLOYMENT_RELOCATION_OPERATION_MISMATCH')
        }
        for (const binding of operation.bindings) {
            if (!isPlainObject(binding) || Object.keys(binding).some((key) => !BINDING_KEYS.has(key)) ||
                typeof binding.service !== 'string' || typeof binding.containerTarget !== 'string') {
                throw new MigrationError('DEPLOYMENT_RELOCATION_OPERATION_MISMATCH')
            }
        }
        if (JSON.stringify(operation.bindings) !== JSON.stringify(mount.bindings)) {
            throw new MigrationError('DEPLOYMENT_RELOCATION_OPERATION_MISMATCH')
        }
        seen.add(operation.key)
        if (!isPlainObject(operation.inventory)) throw new MigrationError('DEPLOYMENT_RELOCATION_INVENTORY_INVALID')
        for (const key of Object.keys(operation.inventory)) if (!INVENTORY_KEYS.has(key)) throw new MigrationError('DEPLOYMENT_RELOCATION_INVENTORY_FIELD_UNKNOWN')
        const inventory = operation.inventory
        if (!HASH_PATTERN.test(inventory.beforeFingerprint) || !HASH_PATTERN.test(inventory.afterFingerprint) || inventory.matched !== true) {
            throw new MigrationError('DEPLOYMENT_RELOCATION_INVENTORY_INVALID')
        }
        if (mount.preserveRequired && inventory.beforeFingerprint !== inventory.afterFingerprint) {
            throw new MigrationError('DEPLOYMENT_RELOCATION_PRESERVE_MISMATCH')
        }
    }
    return { valid: true, artifact }
}

module.exports = {
    PLAN_VERSION,
    ARTIFACT_VERSION,
    MOUNT_TARGETS,
    SERVICE_MOUNTS,
    SHARED_MOUNT_IDENTITIES,
    PRESERVE_REQUIRED_KEYS,
    canonicalize,
    fingerprint,
    findExistingMounts,
    canonicalMountIdentity,
    uniqueRelocations,
    buildDeploymentPlan,
    validatePlan,
    writeDeploymentPlanArtifact,
    readValidatedArtifact,
    validateRelocationArtifact
}
