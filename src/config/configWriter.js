'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const readline = require('readline')
const { ConfigWriteError } = require('./errors')

const ANCHORED_READ_PROGRAM = String.raw`
import os, stat, sys
dir_fd = int(sys.argv[1])
name = sys.argv[2]
expected_mode = int(sys.argv[3], 8)
maximum = int(sys.argv[4])
if not name or name in ('.', '..') or '/' in name or '\\' in name or '\x00' in name:
    sys.stderr.write('CONFIG_READ_NAME_INVALID\n')
    raise SystemExit(2)
flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
try:
    fd = os.open(name, flags, dir_fd=dir_fd)
except FileNotFoundError:
    sys.stderr.write('CONFIG_READ_NOT_FOUND\n')
    raise SystemExit(3)
try:
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):
        raise RuntimeError('CONFIG_READ_NOT_REGULAR')
    if before.st_nlink != 1:
        raise RuntimeError('CONFIG_READ_LINK_UNSAFE')
    if stat.S_IMODE(before.st_mode) != expected_mode:
        raise RuntimeError('CONFIG_READ_MODE_UNSAFE')
    chunks = []
    total = 0
    while True:
        chunk = os.read(fd, min(1024 * 1024, maximum + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            raise RuntimeError('CONFIG_READ_TOO_LARGE')
    after = os.fstat(fd)
    identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_nlink, stat.S_IMODE(before.st_mode))
    current = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_nlink, stat.S_IMODE(after.st_mode))
    if identity != current:
        raise RuntimeError('CONFIG_READ_CHANGED')
    sys.stdout.buffer.write(b''.join(chunks))
except RuntimeError as error:
    sys.stderr.write(str(error) + '\n')
    raise SystemExit(2)
finally:
    os.close(fd)
`

async function syncDirectory(directory, fsPromises = fs.promises) {
    let handle
    try {
        handle = await fsPromises.open(directory, fs.constants.O_RDONLY)
        await handle.sync()
    } finally {
        await handle?.close()
    }
}

function assertContained(rootDir, targetPath) {
    const root = path.resolve(rootDir)
    const target = path.resolve(targetPath)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new ConfigWriteError('Configuration path escapes its trusted root')
    }
    return { root, target }
}

async function ensurePrivateDirectory(directory, fsPromises = fs.promises, rootDir = directory) {
    const requestedRoot = path.resolve(rootDir)
    let existingRoot = requestedRoot
    while (true) {
        try {
            await fsPromises.lstat(existingRoot)
            break
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            const parent = path.dirname(existingRoot)
            if (parent === existingRoot) throw error
            existingRoot = parent
        }
    }
    const { root, target } = assertContained(existingRoot, directory)
    const rootStat = await fsPromises.lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new ConfigWriteError('Configuration trusted root is not a safe directory')
    }
    const realRoot = await fsPromises.realpath(root)
    let current = root
    const relative = path.relative(root, target)
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment)
        try {
            await fsPromises.mkdir(current, { mode: 0o700 })
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error
        }
        const stat = await fsPromises.lstat(current)
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new ConfigWriteError('Configuration directory chain is not safe')
        }
        const realCurrent = await fsPromises.realpath(current)
        if (realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${path.sep}`)) {
            throw new ConfigWriteError('Configuration directory chain escapes its trusted root')
        }
        await fsPromises.chmod(current, 0o700)
    }
}

async function assertSafeTarget(filePath, fsPromises = fs.promises) {
    try {
        const stat = await fsPromises.lstat(filePath)
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new ConfigWriteError('Configuration target is not a regular file')
        }
        if (stat.nlink !== 1) {
            throw new ConfigWriteError('Configuration target has unexpected hard links')
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
}

async function captureDirectoryIdentity(directory, fsPromises = fs.promises) {
    const stat = await fsPromises.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new ConfigWriteError('Configuration parent is not a safe directory')
    }
    return {
        dev: stat.dev,
        ino: stat.ino,
        realpath: await fsPromises.realpath(directory)
    }
}

async function assertDirectoryIdentity(directory, expected, fsPromises = fs.promises) {
    const current = await captureDirectoryIdentity(directory, fsPromises)
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.realpath !== expected.realpath) {
        throw new ConfigWriteError('Configuration parent directory changed during atomic write')
    }
}

async function readAnchoredPrivateFile(filePath, options = {}) {
    const fsPromises = options.fsPromises || fs.promises
    const directory = path.dirname(filePath)
    const name = path.basename(filePath)
    const expectedMode = options.mode ?? 0o600
    const maxBytes = options.maxBytes ?? (8 * 1024 * 1024)
    const identity = await captureDirectoryIdentity(directory, fsPromises)
    const directoryFlags = fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY || 0) |
        (fs.constants.O_NOFOLLOW || 0)
    let directoryHandle
    try {
        directoryHandle = await fsPromises.open(directory, directoryFlags)
        const opened = await directoryHandle.stat()
        if (!opened.isDirectory() || opened.dev !== identity.dev || opened.ino !== identity.ino) {
            throw new ConfigWriteError('Configuration parent directory changed during read')
        }
        const child = childProcess.spawn('python3', [
            '-c', ANCHORED_READ_PROGRAM, '3', name, expectedMode.toString(8), String(maxBytes)
        ], {
            stdio: ['ignore', 'pipe', 'pipe', directoryHandle.fd]
        })
        const stdout = []
        let stdoutBytes = 0
        let stderr = ''
        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.length
            if (stdoutBytes <= maxBytes) stdout.push(chunk)
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk) => { stderr += chunk })
        const exitCode = await waitForExit(child)
        await assertDirectoryIdentity(directory, identity, fsPromises)
        if (exitCode !== 0 || stdoutBytes > maxBytes) {
            const code = String(stderr || '').trim().split(/\s+/)[0]
            const error = new ConfigWriteError('Secure configuration read failed')
            if (code === 'CONFIG_READ_NOT_FOUND') error.code = 'ENOENT'
            else if (/^CONFIG_READ_[A-Z0-9_]+$/.test(code)) error.reason = code
            throw error
        }
        return Buffer.concat(stdout, stdoutBytes)
    } catch (error) {
        if (error instanceof ConfigWriteError || error?.code === 'ENOENT') throw error
        throw new ConfigWriteError('Secure configuration read failed', { cause: error })
    } finally {
        await directoryHandle?.close().catch(() => {})
    }
}

async function atomicWriteFile(filePath, content, options = {}) {
    const fsPromises = options.fsPromises || fs.promises
    const directory = path.dirname(filePath)
    const rootDir = options.rootDir || directory
    const mode = options.mode ?? 0o600
    await ensurePrivateDirectory(directory, fsPromises, rootDir)
    const directoryIdentity = await captureDirectoryIdentity(directory, fsPromises)
    await assertSafeTarget(filePath, fsPromises)

    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    const directoryFlags = fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY || 0) |
        (fs.constants.O_NOFOLLOW || 0)
    let directoryHandle
    let child
    let committed = false
    let stderr = ''
    try {
        directoryHandle = await fsPromises.open(directory, directoryFlags)
        const opened = await directoryHandle.stat()
        if (!opened.isDirectory() || opened.dev !== directoryIdentity.dev || opened.ino !== directoryIdentity.ino) {
            throw new ConfigWriteError('Configuration parent directory changed during atomic write')
        }
        const helperPath = path.join(__dirname, 'atomic_writer.py')
        child = childProcess.spawn('python3', [
            helperPath,
            '--dir-fd', '3',
            '--name', path.basename(filePath),
            '--mode', mode.toString(8),
            '--size', String(data.length),
            ...(options.expectedHash ? ['--expected-sha256', String(options.expectedHash)] : [])
        ], {
            stdio: ['pipe', 'pipe', 'pipe', directoryHandle.fd],
            env: options.helperEnv ? { ...process.env, ...options.helperEnv } : process.env
        })
        child.stdin.on('error', () => {})
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk) => { stderr += chunk })
        const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
        child.stdin.write(data)
        const ready = await nextLine(lines, child)
        if (!ready.startsWith('READY ')) throw new Error(stderr.trim() || 'CONFIG_ATOMIC_WRITER_NOT_READY')
        const tempName = ready.slice('READY '.length)
        const tempPath = path.join(directory, tempName)

        if (typeof options.validate === 'function') {
            await options.validate(content, tempPath)
        }
        if (typeof options.beforeRename === 'function') {
            await options.beforeRename(tempPath)
        }

        await assertDirectoryIdentity(directory, directoryIdentity, fsPromises)
        await assertSafeTarget(filePath, fsPromises)
        child.stdin.end('COMMIT\n')
        const installed = await nextLine(lines, child)
        if (installed !== 'COMMITTED') throw new Error(stderr.trim() || 'CONFIG_ATOMIC_WRITER_COMMIT_FAILED')
        const exitCode = await waitForExit(child)
        if (exitCode !== 0) throw new Error(stderr.trim() || 'CONFIG_ATOMIC_WRITER_FAILED')
        committed = true
        await assertDirectoryIdentity(directory, directoryIdentity, fsPromises)
        await assertSafeTarget(filePath, fsPromises)
        return { filePath, tempPath, renamed: true }
    } catch (error) {
        if (child && !committed && !child.killed) {
            child.stdin.end('ABORT\n')
            await waitForExit(child).catch(() => {})
        }
        const helperReason = `${error?.message || ''}\n${stderr}`.match(/CONFIG_ATOMIC_(?:TARGET_CHANGED|RECOVERY_REQUIRED)/)?.[0]
        if (!(error instanceof ConfigWriteError) && helperReason) {
            const conflict = new ConfigWriteError('Configuration target changed during atomic commit', { cause: error })
            conflict.reason = helperReason
            throw conflict
        }
        throw error instanceof ConfigWriteError
            ? error
            : new ConfigWriteError('Atomic configuration write failed', { cause: error })
    } finally {
        await directoryHandle?.close().catch(() => {})
    }
}

function nextLine(lines, child) {
    return new Promise((resolve, reject) => {
        const onExit = (code) => reject(new Error(`Atomic writer exited before protocol completion (${code})`))
        const onError = (error) => reject(error)
        child.once('exit', onExit)
        child.once('error', onError)
        lines[Symbol.asyncIterator]().next().then(({ value, done }) => {
            child.off('exit', onExit)
            child.off('error', onError)
            if (done) reject(new Error('Atomic writer closed its protocol stream'))
            else resolve(value)
        }, (error) => {
            child.off('exit', onExit)
            child.off('error', onError)
            reject(error)
        })
    })
}

function waitForExit(child) {
    if (child.exitCode !== null) return Promise.resolve(child.exitCode)
    return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
    })
}

class ConfigWriter {
    constructor(options = {}) {
        this.configPath = options.configPath
        this.stateDir = options.stateDir
        this.fsPromises = options.fsPromises || fs.promises
        this.rootDir = options.rootDir || commonAncestor([
            path.dirname(this.configPath),
            this.stateDir
        ])
    }

    async ensureDirectories() {
        await ensurePrivateDirectory(path.dirname(this.configPath), this.fsPromises, this.rootDir)
        await ensurePrivateDirectory(this.stateDir, this.fsPromises, this.rootDir)
    }

    async writeConfig(source, options = {}) {
        return atomicWriteFile(this.configPath, source, {
            fsPromises: this.fsPromises,
            rootDir: this.rootDir,
            mode: 0o600,
            validate: options.validate,
            beforeRename: options.beforeRename,
            expectedHash: options.expectedHash,
            helperEnv: options.helperEnv
        })
    }

    async writeState(name, content) {
        if (!/^[a-z0-9._-]+$/i.test(name)) throw new ConfigWriteError('Invalid state filename')
        return atomicWriteFile(path.join(this.stateDir, name), content, {
            fsPromises: this.fsPromises,
            rootDir: this.rootDir,
            mode: 0o600
        })
    }

    async writeLastGood(source, metadata = {}) {
        await this.writeState('last-good.yaml', source)
        await this.writeState('last-good.json', `${JSON.stringify(metadata, null, 2)}\n`)
    }

    async writeJournal(journal) {
        await this.writeState('write-journal.json', `${JSON.stringify(journal, null, 2)}\n`)
    }

    async readLastGood() {
        try {
            return await this.fsPromises.readFile(path.join(this.stateDir, 'last-good.yaml'), 'utf8')
        } catch (error) {
            if (error?.code === 'ENOENT') return null
            throw error
        }
    }
}

function commonAncestor(paths) {
    const resolved = paths.map((entry) => path.resolve(entry))
    let candidate = resolved[0]
    while (!resolved.every((entry) => entry === candidate || entry.startsWith(`${candidate}${path.sep}`))) {
        const parent = path.dirname(candidate)
        if (parent === candidate) return candidate
        candidate = parent
    }
    return candidate
}

module.exports = {
    ConfigWriter,
    atomicWriteFile,
    ensurePrivateDirectory,
    assertContained,
    commonAncestor,
    assertSafeTarget,
    captureDirectoryIdentity,
    assertDirectoryIdentity,
    readAnchoredPrivateFile,
    syncDirectory
}
