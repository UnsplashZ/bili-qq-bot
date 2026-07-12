'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { assertSafePathChain } = require('./atomicFile')
const { MigrationError } = require('./errors')

function openPrivateFile(filePath, options = {}) {
    assertSafePathChain(filePath)
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    let fd
    try {
        fd = fs.openSync(filePath, flags)
        const stat = fs.fstatSync(fd)
        if (!stat.isFile()) throw new MigrationError(options.fileCode || 'MIGRATION_FILE_REQUIRED')
        if (stat.nlink !== 1) throw new MigrationError(options.linkCode || 'MIGRATION_FILE_LINK_COUNT_UNSAFE')
        if (options.mode !== null && (stat.mode & 0o777) !== (options.mode ?? 0o600)) {
            throw new MigrationError(options.permissionCode || 'MIGRATION_FILE_PERMISSION_UNSAFE')
        }
        return { fd, stat }
    } catch (error) {
        if (fd !== undefined) fs.closeSync(fd)
        throw error
    }
}

function readPrivateFile(filePath, options = {}) {
    if (typeof options.beforeRead !== 'function') return readPrivateFileAnchored(filePath, options)
    const opened = openPrivateFile(filePath, options)
    try {
        if (typeof options.beforeRead === 'function') options.beforeRead({ fd: opened.fd, stat: opened.stat })
        const data = fs.readFileSync(opened.fd)
        const after = fs.fstatSync(opened.fd)
        if (opened.stat.dev !== after.dev || opened.stat.ino !== after.ino || opened.stat.size !== after.size ||
            opened.stat.mtimeMs !== after.mtimeMs || opened.stat.nlink !== after.nlink || after.nlink !== 1) {
            throw new MigrationError(options.changedCode || 'MIGRATION_FILE_CHANGED')
        }
        return {
            data: options.encoding ? data.toString(options.encoding) : data,
            stat: after
        }
    } finally {
        fs.closeSync(opened.fd)
    }
}

function readPrivateFileAnchored(filePath, options = {}) {
    assertSafePathChain(filePath)
    const directory = path.dirname(path.resolve(filePath))
    const directoryStat = fs.lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new MigrationError('MIGRATION_DIRECTORY_REQUIRED')
    const directoryRealpath = fs.realpathSync.native(directory)
    const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0)
    let directoryFd
    try {
        directoryFd = fs.openSync(directory, flags)
        const openedDirectory = fs.fstatSync(directoryFd)
        if (!openedDirectory.isDirectory() || openedDirectory.dev !== directoryStat.dev || openedDirectory.ino !== directoryStat.ino) {
            throw new MigrationError('MIGRATION_DIRECTORY_CHANGED')
        }
        const helper = path.join(__dirname, 'private_reader.py')
        const mode = options.mode === null ? 'any' : (options.mode ?? 0o600).toString(8)
        const maximum = options.maxBytes ?? (64 * 1024 * 1024)
        const result = childProcess.spawnSync('python3', [
            helper,
            '--dir-fd', '3',
            '--name', path.basename(filePath),
            '--mode', mode,
            '--max-bytes', String(maximum)
        ], {
            stdio: ['ignore', 'pipe', 'pipe', directoryFd],
            maxBuffer: maximum + 1024
        })
        const afterDirectory = fs.lstatSync(directory)
        if (!afterDirectory.isDirectory() || afterDirectory.isSymbolicLink() ||
            afterDirectory.dev !== directoryStat.dev || afterDirectory.ino !== directoryStat.ino ||
            fs.realpathSync.native(directory) !== directoryRealpath) {
            throw new MigrationError('MIGRATION_DIRECTORY_CHANGED')
        }
        if (result.error || result.status !== 0) {
            const code = String(result.stderr || '').trim().split(/\s+/)[0]
            if (code === 'MIGRATION_FILE_NOT_FOUND') {
                const error = new Error('Migration file not found')
                error.code = 'ENOENT'
                throw error
            }
            const mapped = /^MIGRATION_[A-Z0-9_]+$/.test(code) ? code : 'MIGRATION_FILE_READ_FAILED'
            if (mapped === 'MIGRATION_FILE_REQUIRED' && options.fileCode) throw new MigrationError(options.fileCode)
            if (mapped === 'MIGRATION_FILE_LINK_COUNT_UNSAFE' && options.linkCode) throw new MigrationError(options.linkCode)
            if (mapped === 'MIGRATION_FILE_PERMISSION_UNSAFE' && options.permissionCode) throw new MigrationError(options.permissionCode)
            if (mapped === 'MIGRATION_FILE_CHANGED' && options.changedCode) throw new MigrationError(options.changedCode)
            throw new MigrationError(mapped)
        }
        const data = Buffer.from(result.stdout)
        return {
            data: options.encoding ? data.toString(options.encoding) : data,
            stat: { size: data.length, mode: options.mode ?? 0o600, nlink: 1 }
        }
    } finally {
        if (directoryFd !== undefined) fs.closeSync(directoryFd)
    }
}

function readPrivateText(filePath, options = {}) {
    return readPrivateFile(filePath, { ...options, encoding: 'utf8' }).data
}

function hashPrivateFile(filePath, options = {}) {
    const data = readPrivateFile(filePath, options).data
    return crypto.createHash('sha256').update(data).digest('hex')
}

module.exports = {
    openPrivateFile,
    readPrivateFile,
    readPrivateFileAnchored,
    readPrivateText,
    hashPrivateFile
}
