'use strict'

const path = require('path')
const { atomicWriteJson } = require('../migrations/common/atomicFile')
const { readPrivateText } = require('../migrations/common/privateFile')
const { CONFIG_SCHEMA } = require('./schemaV1')
const { clone, hashValue, valuesEqual } = require('./configUtils')
const { diffConfig } = require('./configDiff')

const DEPLOYMENT_BASELINE_VERSION = 1
const DEPLOYMENT_BASELINE_FILE = 'deployment-applied.json'

function selectDeploymentNode(value, schema, inherited = false) {
    const deploymentRequired = Boolean(inherited || schema?.deploymentApplyRequired)
    if (!schema) return undefined
    if (schema.type === 'object') {
        const output = {}
        for (const [key, childSchema] of Object.entries(schema.properties || {})) {
            const child = selectDeploymentNode(value?.[key], childSchema, deploymentRequired)
            if (child !== undefined) output[key] = child
        }
        return Object.keys(output).length > 0 ? output : undefined
    }
    if (schema.type === 'map') {
        const output = {}
        for (const [key, childValue] of Object.entries(value || {})) {
            const child = selectDeploymentNode(childValue, schema.value, deploymentRequired)
            if (child !== undefined) output[key] = child
        }
        return Object.keys(output).length > 0 ? output : undefined
    }
    return deploymentRequired ? clone(value) : undefined
}

function deploymentProjection(config, schema = CONFIG_SCHEMA) {
    return selectDeploymentNode(config, schema, false) || {}
}

function deploymentFingerprint(config, schema = CONFIG_SCHEMA) {
    return hashValue(deploymentProjection(config, schema))
}

function validateDeploymentBaseline(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEPLOYMENT_BASELINE_INVALID')
    if (value.version !== DEPLOYMENT_BASELINE_VERSION) throw new Error('DEPLOYMENT_BASELINE_VERSION_UNSUPPORTED')
    if (!Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error('DEPLOYMENT_BASELINE_GENERATION_INVALID')
    if (!/^[a-f0-9]{64}$/.test(value.fingerprint || '')) throw new Error('DEPLOYMENT_BASELINE_FINGERPRINT_INVALID')
    if (!value.config || typeof value.config !== 'object' || Array.isArray(value.config)) throw new Error('DEPLOYMENT_BASELINE_CONFIG_INVALID')
    const stack = [{ value: value.config, depth: 0 }]
    while (stack.length > 0) {
        const current = stack.pop()
        if (current.depth > 16) throw new Error('DEPLOYMENT_BASELINE_CONFIG_INVALID')
        if (!current.value || typeof current.value !== 'object') continue
        if (Array.isArray(current.value)) throw new Error('DEPLOYMENT_BASELINE_CONFIG_INVALID')
        for (const [key, child] of Object.entries(current.value)) {
            if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                throw new Error('DEPLOYMENT_BASELINE_CONFIG_INVALID')
            }
            stack.push({ value: child, depth: current.depth + 1 })
        }
    }
    if (!valuesEqual(deploymentProjection(value.config), value.config)) throw new Error('DEPLOYMENT_BASELINE_CONFIG_INVALID')
    if (hashValue(value.config) !== value.fingerprint) throw new Error('DEPLOYMENT_BASELINE_FINGERPRINT_MISMATCH')
    return {
        version: value.version,
        generation: value.generation,
        fingerprint: value.fingerprint,
        config: clone(value.config),
        appliedAt: typeof value.appliedAt === 'string' ? value.appliedAt : null,
        releaseEpoch: typeof value.releaseEpoch === 'string' ? value.releaseEpoch : null
    }
}

function readDeploymentBaseline(filePath, options = {}) {
    try {
        return validateDeploymentBaseline(JSON.parse(readPrivateText(filePath, {
            fileCode: 'DEPLOYMENT_BASELINE_FILE_UNSAFE',
            linkCode: 'DEPLOYMENT_BASELINE_FILE_UNSAFE',
            permissionCode: 'DEPLOYMENT_BASELINE_FILE_UNSAFE',
            changedCode: 'DEPLOYMENT_BASELINE_FILE_CHANGED',
            beforeRead: options.beforeRead
        })))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        if (error?.code?.startsWith('DEPLOYMENT_BASELINE_')) {
            const mapped = new Error(error.code)
            mapped.code = error.code
            throw mapped
        }
        throw error
    }
}

function createDeploymentBaseline(config, previous = null, options = {}) {
    const projection = deploymentProjection(config, options.schema || CONFIG_SCHEMA)
    const fingerprint = hashValue(projection)
    const releaseEpoch = options.releaseEpoch || null
    if (previous && previous.fingerprint === fingerprint && previous.releaseEpoch === releaseEpoch) {
        return clone(previous)
    }
    return {
        version: DEPLOYMENT_BASELINE_VERSION,
        generation: (previous?.generation || 0) + 1,
        fingerprint,
        config: projection,
        appliedAt: options.appliedAt || new Date().toISOString(),
        releaseEpoch
    }
}

function writeDeploymentBaseline(outputPath, config, options = {}) {
    const previousPath = options.previousPath || outputPath
    const previous = readDeploymentBaseline(previousPath, options)
    const baseline = createDeploymentBaseline(config, previous, options)
    atomicWriteJson(path.resolve(outputPath), baseline, { mode: 0o600 })
    return baseline
}

function deploymentStatus(config, baseline, schema = CONFIG_SCHEMA) {
    const desiredConfig = deploymentProjection(config, schema)
    const desiredFingerprint = hashValue(desiredConfig)
    const pending = baseline
        ? diffConfig(baseline.config, desiredConfig, schema).filter((entry) => entry.deploymentApplyRequired)
        : diffConfig({}, desiredConfig, schema).filter((entry) => entry.deploymentApplyRequired)
    return {
        baselineAvailable: Boolean(baseline),
        appliedGeneration: baseline?.generation || null,
        appliedFingerprint: baseline?.fingerprint || null,
        desiredFingerprint,
        pendingApplyRequired: pending.length > 0,
        pendingPaths: pending.map((entry) => entry.path.join('.')),
        appliedAt: baseline?.appliedAt || null,
        releaseEpoch: baseline?.releaseEpoch || null
    }
}

module.exports = {
    DEPLOYMENT_BASELINE_VERSION,
    DEPLOYMENT_BASELINE_FILE,
    deploymentProjection,
    deploymentFingerprint,
    validateDeploymentBaseline,
    readDeploymentBaseline,
    createDeploymentBaseline,
    writeDeploymentBaseline,
    deploymentStatus
}
