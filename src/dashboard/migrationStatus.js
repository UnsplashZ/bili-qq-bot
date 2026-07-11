'use strict'

const fs = require('fs')
const path = require('path')
const { readManifest, toPublicMigrationStatus } = require('../migrations/config/manifest')
const { readPrivateText } = require('../migrations/common/privateFile')
const { getApplicationBootstrapStatus } = require('../bootstrap/bootstrapStatus')

const ATTEMPT_ID_PATTERN = /^(?!\.)(?!.*\.$)[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/
const RELEASE_EPOCH_PATTERN = /^[a-zA-Z0-9._-]{1,200}$/
const COMMITTED_CHECKPOINTS = new Set(['runtime_ready', 'upgrade_complete'])

function privateStatusText(filePath) {
    return readPrivateText(filePath, {
        fileCode: 'MIGRATION_STATUS_FILE_UNSAFE',
        linkCode: 'MIGRATION_STATUS_FILE_UNSAFE',
        permissionCode: 'MIGRATION_STATUS_FILE_UNSAFE',
        changedCode: 'MIGRATION_STATUS_FILE_CHANGED'
    }).trim()
}

function resolveAttemptDirectory(stateRoot, attemptId) {
    if (!ATTEMPT_ID_PATTERN.test(attemptId) || attemptId.includes('/') || attemptId.includes('\\')) {
        const error = new Error('Invalid active migration attempt')
        error.code = 'MIGRATION_ATTEMPT_ID_INVALID'
        throw error
    }
    const resolvedRoot = path.resolve(stateRoot)
    const attemptDirectory = path.resolve(resolvedRoot, attemptId)
    if (path.dirname(attemptDirectory) !== resolvedRoot) {
        const error = new Error('Migration attempt escapes state root')
        error.code = 'MIGRATION_ATTEMPT_ID_INVALID'
        throw error
    }
    return attemptDirectory
}

function readAttemptStatus(stateRoot, attemptId) {
    const manifestPath = path.join(resolveAttemptDirectory(stateRoot, attemptId), 'upgrade-manifest.json')
    return toPublicMigrationStatus(readManifest(manifestPath))
}

function getCurrentMigrationStatus(options = {}) {
    const bootstrapStatus = getApplicationBootstrapStatus()
    if (bootstrapStatus) return bootstrapStatus
    const stateRoot = path.resolve(options.stateRoot || path.join(__dirname, '../../data/setup-state'))
    const activeAttemptPath = path.join(stateRoot, 'active-attempt')
    let attemptId = null
    try {
        attemptId = privateStatusText(activeAttemptPath)
        if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
            const error = new Error('Invalid active migration attempt')
            error.code = 'MIGRATION_ATTEMPT_ID_INVALID'
            throw error
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
    if (attemptId) return readAttemptStatus(stateRoot, attemptId)

    let releaseEpoch
    try {
        releaseEpoch = privateStatusText(path.join(stateRoot, 'managed-v1'))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
    }
    if (!RELEASE_EPOCH_PATTERN.test(releaseEpoch)) {
        const error = new Error('Invalid managed release epoch')
        error.code = 'MIGRATION_RELEASE_EPOCH_INVALID'
        throw error
    }

    let entries
    try {
        entries = fs.readdirSync(stateRoot, { withFileTypes: true })
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
    }
    const candidates = entries
            .filter((entry) => entry.isDirectory() && ATTEMPT_ID_PATTERN.test(entry.name))
            .map((entry) => {
                try {
                    const status = readAttemptStatus(stateRoot, entry.name)
                    if (!COMMITTED_CHECKPOINTS.has(status.checkpoint) ||
                        status.releaseEpoch !== releaseEpoch ||
                        status.businessAdmissionOpened !== true ||
                        status.appliesToCommittedRuntime !== true) {
                        return null
                    }
                    return { status, updatedAtMs: Date.parse(status.updatedAt) }
                } catch (error) {
                    if (error?.code === 'ENOENT') return null
                    throw error
                }
            })
            .filter(Boolean)
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    return candidates[0]?.status || null
}

module.exports = {
    ATTEMPT_ID_PATTERN,
    RELEASE_EPOCH_PATTERN,
    resolveAttemptDirectory,
    getCurrentMigrationStatus
}
