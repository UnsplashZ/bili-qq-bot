'use strict'

const crypto = require('crypto')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { MigrationError } = require('./errors')

function assertNotSymlink(targetPath, { allowMissing = true } = {}) {
    try {
        const stat = fs.lstatSync(targetPath)
        if (stat.isSymbolicLink()) {
            throw new MigrationError('MIGRATION_SYMLINK_FORBIDDEN')
        }
        return stat
    } catch (error) {
        if (error && error.code === 'ENOENT' && allowMissing) return null
        throw error
    }
}

function assertSafePathChain(targetPath, options = {}) {
    const resolved = path.resolve(targetPath)
    const platformBoundary = process.platform === 'darwin' && /^\/(?:var|tmp)(?:\/|$)/.test(resolved)
        ? path.join(path.parse(resolved).root, resolved.split(path.sep).filter(Boolean)[0])
        : path.parse(resolved).root
    const boundary = path.resolve(options.boundary || platformBoundary)
    const relative = path.relative(boundary, resolved)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new MigrationError('MIGRATION_PATH_OUTSIDE_BOUNDARY')
    }
    const segments = relative ? relative.split(path.sep).filter(Boolean) : []
    let current = boundary
    const boundaryStat = fs.lstatSync(boundary)
    if (boundaryStat.isSymbolicLink() && !(options.boundary === undefined && boundary === platformBoundary && process.platform === 'darwin')) {
        throw new MigrationError('MIGRATION_SYMLINK_FORBIDDEN')
    }
    const boundaryRealPath = fs.realpathSync.native(boundary)
    if (!fs.statSync(boundaryRealPath).isDirectory()) throw new MigrationError('MIGRATION_DIRECTORY_REQUIRED')
    for (const segment of segments) {
        current = path.join(current, segment)
        const stat = assertNotSymlink(current)
        if (!stat) break
        const expectedRealPath = path.join(boundaryRealPath, path.relative(boundary, current))
        if (fs.realpathSync.native(current) !== expectedRealPath) throw new MigrationError('MIGRATION_PATH_REALPATH_MISMATCH')
    }
    return resolved
}

function captureDirectoryIdentity(dirPath) {
    const stat = fs.statSync(dirPath)
    if (!stat.isDirectory()) throw new MigrationError('MIGRATION_DIRECTORY_REQUIRED')
    return { dev: stat.dev, ino: stat.ino }
}

function assertDirectoryIdentity(dirPath, identity) {
    assertSafePathChain(dirPath)
    const current = captureDirectoryIdentity(dirPath)
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new MigrationError('MIGRATION_DIRECTORY_CHANGED')
    }
}

function ensurePrivateDir(dirPath) {
    const resolved = path.resolve(dirPath)
    assertSafePathChain(resolved)
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })
    assertSafePathChain(resolved)
    const stat = assertNotSymlink(resolved, { allowMissing: false })
    if (!stat.isDirectory()) throw new MigrationError('MIGRATION_DIRECTORY_REQUIRED')
    fs.chmodSync(resolved, 0o700)
    return resolved
}

function fsyncDirectory(dirPath) {
    let fd
    try {
        fd = fs.openSync(dirPath, fs.constants.O_RDONLY)
        fs.fsyncSync(fd)
    } finally {
        if (fd !== undefined) fs.closeSync(fd)
    }
}

function atomicWriteFile(filePath, content, options = {}) {
    const resolved = path.resolve(filePath)
    const dirPath = ensurePrivateDir(path.dirname(resolved))
    assertSafePathChain(resolved)
    const existing = assertNotSymlink(resolved)
    if (existing && (!existing.isFile() || existing.nlink !== 1)) {
        throw new MigrationError(existing.isFile() ? 'MIGRATION_FILE_LINK_COUNT_UNSAFE' : 'MIGRATION_FILE_REQUIRED')
    }
    if (existing && options.overwrite === false) throw new MigrationError('MIGRATION_TARGET_EXISTS')
    const directoryIdentity = captureDirectoryIdentity(dirPath)
    const mode = options.mode ?? 0o600
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    if (typeof options.beforeDirectoryFdWrite === 'function') options.beforeDirectoryFdWrite({ dirPath, filePath: resolved })
    const directoryFlags = fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY || 0) |
        (fs.constants.O_NOFOLLOW || 0)
    let directoryFd
    try {
        directoryFd = fs.openSync(dirPath, directoryFlags)
        const opened = fs.fstatSync(directoryFd)
        if (opened.dev !== directoryIdentity.dev || opened.ino !== directoryIdentity.ino || !opened.isDirectory()) {
            throw new MigrationError('MIGRATION_DIRECTORY_CHANGED')
        }
        const helperPath = path.join(__dirname, 'atomic_writer.py')
        const args = [helperPath, '--dir-fd', '3', '--name', path.basename(resolved), '--mode', mode.toString(8)]
        if (options.overwrite === false) args.push('--no-overwrite')
        const result = childProcess.spawnSync('python3', args, {
            input: data,
            stdio: ['pipe', 'pipe', 'pipe', directoryFd],
            maxBuffer: Math.max(1024 * 1024, data.length + 1024)
        })
        if (result.error || result.status !== 0) {
            const code = String(result.stderr || '').trim()
            throw new MigrationError(/^MIGRATION_[A-Z0-9_]+$/.test(code) ? code : 'MIGRATION_ATOMIC_WRITER_FAILED')
        }
        assertDirectoryIdentity(dirPath, directoryIdentity)
    } catch (error) {
        if (error instanceof MigrationError) throw error
        throw new MigrationError('MIGRATION_ATOMIC_WRITER_FAILED')
    } finally {
        if (directoryFd !== undefined) fs.closeSync(directoryFd)
    }
    return resolved
}

function atomicWriteJson(filePath, value, options = {}) {
    return atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options)
}

function sha256(value) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
    return crypto.createHash('sha256').update(data).digest('hex')
}

function hashFile(filePath) {
    return sha256(require('./privateFile').readPrivateFile(filePath, { mode: null }).data)
}

function copyPrivateFile(sourcePath, targetPath) {
    const content = require('./privateFile').readPrivateFile(sourcePath, {
        mode: null,
        fileCode: 'MIGRATION_SOURCE_FILE_REQUIRED',
        changedCode: 'MIGRATION_SOURCE_CHANGED'
    }).data
    return atomicWriteFile(targetPath, content, { mode: 0o600 })
}

function copyPrivateFileExclusive(sourcePath, targetPath) {
    const content = require('./privateFile').readPrivateFile(sourcePath, {
        mode: null,
        fileCode: 'MIGRATION_SOURCE_FILE_REQUIRED',
        changedCode: 'MIGRATION_SOURCE_CHANGED'
    }).data
    return atomicWriteFile(targetPath, content, { mode: 0o600, overwrite: false })
}

function assertPrivateFile(filePath) {
    assertSafePathChain(filePath)
    const stat = assertNotSymlink(filePath, { allowMissing: false })
    if (!stat.isFile()) throw new MigrationError('MIGRATION_FILE_REQUIRED')
    if ((stat.mode & 0o077) !== 0) throw new MigrationError('MIGRATION_FILE_PERMISSION_UNSAFE')
    if (stat.nlink !== 1) throw new MigrationError('MIGRATION_FILE_LINK_COUNT_UNSAFE')
    return stat
}

module.exports = {
    assertNotSymlink,
    assertSafePathChain,
    ensurePrivateDir,
    fsyncDirectory,
    atomicWriteFile,
    atomicWriteJson,
    sha256,
    hashFile,
    copyPrivateFile,
    copyPrivateFileExclusive,
    assertPrivateFile
}
