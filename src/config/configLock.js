'use strict'

const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { ConfigConflictError, ConfigWriteError } = require('./errors')
const { ensurePrivateDirectory, syncDirectory } = require('./configWriter')
const { ensurePrivateDir, fsyncDirectory } = require('../migrations/common/atomicFile')

function processStartIdentity(pid = process.pid) {
    const normalizedPid = Number(pid)
    if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) return null
    try {
        if (process.platform === 'linux') {
            const stat = fs.readFileSync(`/proc/${normalizedPid}/stat`, 'utf8')
            const close = stat.lastIndexOf(')')
            if (close < 0) return null
            const fields = stat.slice(close + 2).split(' ')
            const startTicks = fields[19]
            const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
            return `linux:${bootId}:${normalizedPid}:${startTicks}`
        }
        const result = childProcess.spawnSync('ps', ['-o', 'lstart=', '-p', String(normalizedPid)], { encoding: 'utf8' })
        const started = String(result.stdout || '').trim().replace(/\s+/g, ' ')
        return result.status === 0 && started ? `${process.platform}:${normalizedPid}:${started}` : null
    } catch {
        return null
    }
}

function processIdentityProbe(pid = process.pid) {
    const normalizedPid = Number(pid)
    if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) return { status: 'dead', identity: null }
    const identity = processStartIdentity(normalizedPid)
    if (identity) return { status: 'alive', identity }
    try {
        process.kill(normalizedPid, 0)
        return { status: 'unknown', identity: null }
    } catch (error) {
        if (error?.code === 'ESRCH') return { status: 'dead', identity: null }
        return { status: 'unknown', identity: null }
    }
}

function normalizeIdentityProbe(value) {
    if (typeof value === 'string' && value) return { status: 'alive', identity: value }
    if (value && typeof value === 'object' && ['alive', 'dead', 'unknown'].includes(value.status)) {
        if (value.status === 'alive' && (typeof value.identity !== 'string' || !value.identity)) {
            return { status: 'unknown', identity: null }
        }
        return { status: value.status, identity: value.status === 'alive' ? value.identity : null }
    }
    return { status: 'unknown', identity: null }
}

function validateOwner(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
        typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce) ||
        typeof value.processStartIdentity !== 'string' || !value.processStartIdentity ||
        typeof value.acquiredAt !== 'string' || !Number.isFinite(Date.parse(value.acquiredAt))) {
        throw new ConfigConflictError('Configuration owner lock metadata is invalid')
    }
    return value
}

function readOwnerDocumentSync(ownerPath) {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    const fd = fs.openSync(ownerPath, flags)
    try {
        const before = fs.fstatSync(fd)
        if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600) {
            throw new ConfigConflictError('Configuration owner lock file is unsafe')
        }
        const value = JSON.parse(fs.readFileSync(fd, 'utf8'))
        const after = fs.fstatSync(fd)
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
            throw new ConfigConflictError('Configuration owner lock changed while being read')
        }
        return value
    } finally {
        fs.closeSync(fd)
    }
}

function readOwnerSync(ownerPath) {
    return validateOwner(readOwnerDocumentSync(ownerPath))
}

class RuntimeOwnerLock {
    constructor(options = {}) {
        this.lockPath = options.lockPath
        this.fsPromises = options.fsPromises || fs.promises
        this.heartbeatMs = options.heartbeatMs ?? 5000
        this.orphanGraceMs = options.orphanGraceMs ?? 15000
        this.identityProvider = options.identityProvider || processIdentityProbe
        this.nonce = null
        this.identity = null
        this.heartbeat = null
        this.lostError = null
    }

    _probe(pid) {
        return normalizeIdentityProbe(this.identityProvider(pid))
    }

    async acquire() {
        if (this.nonce) {
            await this.assertOwned()
            return this.nonce
        }
        const parent = path.dirname(this.lockPath)
        await ensurePrivateDirectory(parent, this.fsPromises)
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await this.fsPromises.mkdir(this.lockPath, { mode: 0o700 })
                return await this._publishOwner(parent)
            } catch (error) {
                if (error?.code !== 'EEXIST') {
                    throw error instanceof ConfigConflictError
                        ? error
                        : new ConfigWriteError('Unable to acquire configuration owner lock', { cause: error })
                }
                await this._reclaimIfStale(parent)
            }
        }
        throw new ConfigConflictError('Another ConfigService runtime owns the configuration lock')
    }

    async _publishOwner(parent) {
        this.nonce = crypto.randomBytes(16).toString('hex')
        const selfProbe = this._probe(process.pid)
        this.identity = selfProbe.status === 'alive' ? selfProbe.identity : null
        if (!this.identity) {
            this.nonce = null
            await this.fsPromises.rm(this.lockPath, { recursive: true, force: true })
            throw new ConfigWriteError('Unable to determine runtime process start identity')
        }
        const ownerPath = path.join(this.lockPath, 'owner.json')
        try {
            const handle = await this.fsPromises.open(
                ownerPath,
                fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
                0o600
            )
            try {
                await handle.writeFile(`${JSON.stringify({
                    pid: process.pid,
                    nonce: this.nonce,
                    processStartIdentity: this.identity,
                    acquiredAt: new Date().toISOString()
                })}\n`, 'utf8')
                await handle.sync()
            } finally {
                await handle.close()
            }
            await syncDirectory(this.lockPath, this.fsPromises)
            await syncDirectory(parent, this.fsPromises)
            this.heartbeat = setInterval(() => this._heartbeat(ownerPath), this.heartbeatMs)
            this.heartbeat.unref?.()
            return this.nonce
        } catch (error) {
            this.nonce = null
            this.identity = null
            await this.fsPromises.rm(this.lockPath, { recursive: true, force: true }).catch(() => {})
            throw error
        }
    }

    async _reclaimIfStale(parent) {
        const ownerPath = path.join(this.lockPath, 'owner.json')
        let owner = null
        try {
            owner = readOwnerSync(ownerPath)
        } catch (error) {
            try {
                const legacyOwner = readOwnerDocumentSync(ownerPath)
                if (Number.isSafeInteger(legacyOwner?.pid) && legacyOwner.pid > 0) {
                    const probe = this._probe(legacyOwner.pid)
                    if (probe.status !== 'dead') {
                        throw new ConfigConflictError('Configuration owner metadata is invalid and process liveness is not safely dead')
                    }
                }
            } catch (legacyError) {
                if (legacyError instanceof ConfigConflictError) throw legacyError
            }
            throw new ConfigConflictError('Configuration owner lock is incomplete and cannot be safely reclaimed')
        }
        if (owner) {
            const probe = this._probe(owner.pid)
            if (probe.status === 'unknown') {
                throw new ConfigConflictError('Configuration owner process identity is unknown; stale recovery refused')
            }
            if (probe.status === 'alive' && probe.identity === owner.processStartIdentity) {
                throw new ConfigConflictError('Another ConfigService runtime owns the configuration lock')
            }
            // A live process with a different start identity is explicit PID reuse.
            // A dead process is the only other automatically recoverable state.
        }
        const stalePath = `${this.lockPath}.stale.${crypto.randomBytes(8).toString('hex')}`
        try {
            await this.fsPromises.rename(this.lockPath, stalePath)
            await syncDirectory(parent, this.fsPromises)
        } catch (error) {
            if (error?.code === 'ENOENT') return
            throw new ConfigConflictError('Configuration owner lock changed during stale recovery')
        }
        await this.fsPromises.rm(stalePath, { recursive: true, force: true })
        await syncDirectory(parent, this.fsPromises)
    }

    async _heartbeat(ownerPath) {
        try {
            await this.assertOwned()
            const now = new Date()
            await this.fsPromises.utimes(ownerPath, now, now)
        } catch (error) {
            this.lostError = error instanceof ConfigConflictError
                ? error
                : new ConfigConflictError('Configuration owner lease was lost')
            if (this.heartbeat) clearInterval(this.heartbeat)
            this.heartbeat = null
        }
    }

    async assertOwned(expectedToken = null) {
        if (this.lostError) throw this.lostError
        if (!this.nonce || !this.identity) throw new ConfigConflictError('Configuration owner lease is not held')
        let owner
        try {
            owner = readOwnerSync(path.join(this.lockPath, 'owner.json'))
        } catch (error) {
            this.lostError = new ConfigConflictError('Configuration owner lease was lost')
            throw this.lostError
        }
        if (owner.nonce !== this.nonce || owner.processStartIdentity !== this.identity || owner.pid !== process.pid) {
            this.lostError = new ConfigConflictError('Configuration owner lease identity changed')
            throw this.lostError
        }
        if (expectedToken !== null && expectedToken !== this.nonce) {
            this.lostError = new ConfigConflictError('Configuration owner lease token changed')
            throw this.lostError
        }
        const probe = this._probe(process.pid)
        if (probe.status !== 'alive' || probe.identity !== this.identity) {
            this.lostError = new ConfigConflictError('Configuration owner process identity can no longer be proven')
            throw this.lostError
        }
        return this.nonce
    }

    async release() {
        if (this.heartbeat) clearInterval(this.heartbeat)
        this.heartbeat = null
        if (!this.nonce) return
        const nonce = this.nonce
        this.nonce = null
        const ownerPath = path.join(this.lockPath, 'owner.json')
        try {
            const owner = readOwnerSync(ownerPath)
            if (owner.nonce !== nonce || owner.processStartIdentity !== this.identity) {
                throw new ConfigConflictError('Configuration owner lock identity changed; refusing to remove it')
            }
            await this.fsPromises.unlink(ownerPath)
            await this.fsPromises.rmdir(this.lockPath)
            await syncDirectory(path.dirname(this.lockPath), this.fsPromises)
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        } finally {
            this.identity = null
        }
    }
}

function assertNoActiveRuntimeOwner(lockPath, options = {}) {
    const identityProvider = options.identityProvider || processIdentityProbe
    let owner
    try {
        owner = readOwnerSync(path.join(lockPath, 'owner.json'))
    } catch (error) {
        if (error?.code === 'ENOENT') return true
        throw new ConfigConflictError('Runtime owner state is unsafe; offline write refused')
    }
    const observed = normalizeIdentityProbe(identityProvider(owner.pid))
    if (observed.status === 'alive' && observed.identity === owner.processStartIdentity) {
        throw new ConfigConflictError('Runtime is active; offline configuration write refused')
    }
    if (observed.status === 'unknown') throw new ConfigConflictError('Runtime process identity is unknown; offline write refused')
    if (options.reclaimStale === true) {
        const parent = path.dirname(lockPath)
        const stalePath = `${lockPath}.stale.${crypto.randomBytes(8).toString('hex')}`
        try {
            fs.renameSync(lockPath, stalePath)
            fsyncDirectory(parent)
        } catch (error) {
            if (error?.code === 'ENOENT') return true
            throw new ConfigConflictError('Runtime owner changed during stale recovery')
        }
        fs.rmSync(stalePath, { recursive: true, force: true })
        fsyncDirectory(parent)
        return true
    }
    throw new ConfigConflictError('Stale runtime owner must be recovered by ConfigService before offline write')
}

function withOfflineRuntimeOwner(lockPath, fn, options = {}) {
    const parent = ensurePrivateDir(path.dirname(lockPath))
    const identityProvider = options.identityProvider || processIdentityProbe
    const probe = (pid) => normalizeIdentityProbe(identityProvider(pid))
    let acquired = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            fs.mkdirSync(lockPath, { mode: 0o700 })
            acquired = true
            break
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error
            let owner = null
            try {
                owner = readOwnerSync(path.join(lockPath, 'owner.json'))
            } catch (ownerError) {
                try {
                    const legacyOwner = readOwnerDocumentSync(path.join(lockPath, 'owner.json'))
                    if (Number.isSafeInteger(legacyOwner?.pid) && legacyOwner.pid > 0 && probe(legacyOwner.pid).status !== 'dead') {
                        throw new ConfigConflictError('Runtime owner metadata is invalid and process liveness is not safely dead')
                    }
                } catch (legacyError) {
                    if (legacyError instanceof ConfigConflictError) throw legacyError
                }
                throw new ConfigConflictError('Runtime owner state is incomplete; offline write refused')
            }
            if (owner) {
                const observed = probe(owner.pid)
                if (observed.status === 'unknown') {
                    throw new ConfigConflictError('Runtime process identity is unknown; offline write refused')
                }
                if (observed.status === 'alive' && observed.identity === owner.processStartIdentity) {
                    throw new ConfigConflictError('Runtime is active; offline configuration write refused')
                }
            }
            const stalePath = `${lockPath}.stale.${crypto.randomBytes(8).toString('hex')}`
            try {
                fs.renameSync(lockPath, stalePath)
            } catch (renameError) {
                if (renameError?.code === 'ENOENT') continue
                throw new ConfigConflictError('Runtime owner changed during offline stale recovery')
            }
            fsyncDirectory(parent)
            fs.rmSync(stalePath, { recursive: true, force: true })
            fsyncDirectory(parent)
        }
    }
    if (!acquired) throw new ConfigConflictError('Unable to acquire offline configuration owner lock')
    const selfProbe = probe(process.pid)
    const identity = selfProbe.status === 'alive' ? selfProbe.identity : null
    if (!identity) {
        fs.rmdirSync(lockPath)
        throw new ConfigWriteError('Unable to determine offline writer process start identity')
    }
    const ownerPath = path.join(lockPath, 'owner.json')
    const nonce = crypto.randomBytes(16).toString('hex')
    let fd
    const cleanup = () => {
        if (fd !== undefined) fs.closeSync(fd)
        fd = undefined
        try {
            const owner = readOwnerSync(ownerPath)
            if (owner.nonce !== nonce || owner.processStartIdentity !== identity) {
                throw new ConfigConflictError('Offline writer lease identity changed; refusing cleanup')
            }
            fs.unlinkSync(ownerPath)
            fs.rmdirSync(lockPath)
            fsyncDirectory(parent)
        } catch (error) {
            if (error?.code === 'ENOENT') {
                try {
                    fs.rmdirSync(lockPath)
                    fsyncDirectory(parent)
                } catch (cleanupError) {
                    if (cleanupError?.code !== 'ENOENT') throw cleanupError
                }
            } else {
                throw error
            }
        }
    }
    try {
        fd = fs.openSync(ownerPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600)
        fs.writeFileSync(fd, `${JSON.stringify({
            pid: process.pid,
            nonce,
            processStartIdentity: identity,
            acquiredAt: new Date().toISOString()
        })}\n`)
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fd = undefined
        fsyncDirectory(lockPath)
        fsyncDirectory(parent)
        const result = fn(nonce)
        if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(
                (value) => { cleanup(); return value },
                (error) => { cleanup(); throw error }
            )
        }
        cleanup()
        return result
    } catch (error) {
        cleanup()
        throw error
    }
}

module.exports = {
    RuntimeOwnerLock,
    processStartIdentity,
    processIdentityProbe,
    readOwnerDocumentSync,
    readOwnerSync,
    assertNoActiveRuntimeOwner,
    withOfflineRuntimeOwner
}
