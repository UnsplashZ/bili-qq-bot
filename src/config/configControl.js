'use strict'

const fs = require('fs')
const net = require('net')
const path = require('path')
const { ensurePrivateDirectory, syncDirectory } = require('./configWriter')
const { getIn } = require('./configUtils')

const MAX_REQUEST_BYTES = 1024 * 1024
const SOCKET_CHMOD_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'])

function defaultConfigControlSocketPath(options = {}) {
    const explicit = options.explicitPath || process.env.BILI_CONFIG_CONTROL_SOCKET
    if (explicit) return path.resolve(explicit)
    const containerized = options.containerized ?? fs.existsSync('/.dockerenv')
    return containerized
        ? path.resolve('/tmp/bili-qq-bot/config-control.sock')
        : path.resolve(options.cwd || process.cwd(), 'data/runtime/config-control.sock')
}

async function assertPrivateSocketDirectory(directory, fsPromises = fs.promises) {
    const directoryStat = await fsPromises.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || (directoryStat.mode & 0o777) !== 0o700) {
        const unsafe = new Error('CONFIG_CONTROL_SOCKET_UNSAFE')
        unsafe.code = 'CONFIG_CONTROL_SOCKET_UNSAFE'
        throw unsafe
    }
}

async function secureControlSocket(socketPath, directory, fsPromises = fs.promises) {
    try {
        await fsPromises.chmod(socketPath, 0o600)
    } catch (error) {
        if (!SOCKET_CHMOD_UNSUPPORTED.has(error?.code)) throw error
        await assertPrivateSocketDirectory(directory, fsPromises)
        try {
            const socketStat = await fsPromises.lstat(socketPath)
            if (socketStat.isSymbolicLink() || !socketStat.isSocket()) {
                const unsafe = new Error('CONFIG_CONTROL_SOCKET_UNSAFE')
                unsafe.code = 'CONFIG_CONTROL_SOCKET_UNSAFE'
                throw unsafe
            }
        } catch (statError) {
            if (!SOCKET_CHMOD_UNSUPPORTED.has(statError?.code) || !await socketIsActive(socketPath)) throw statError
        }
    }
}

async function removeStaleControlSocket(socketPath, directory, fsPromises = fs.promises) {
    try {
        const stat = await fsPromises.lstat(socketPath)
        if (stat.isSymbolicLink() || !stat.isSocket()) throw new Error('CONFIG_CONTROL_SOCKET_UNSAFE')
    } catch (error) {
        if (error?.code === 'ENOENT') return
        if (!SOCKET_CHMOD_UNSUPPORTED.has(error?.code)) throw error
        await assertPrivateSocketDirectory(directory, fsPromises)
    }
    if (await socketIsActive(socketPath)) throw new Error('CONFIG_CONTROL_SOCKET_ACTIVE')
    try {
        await fsPromises.unlink(socketPath)
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
}
function publicFailure(service, error) {
    return {
        ok: false,
        error: service.toPublicError(error),
        statusCode: Number(error?.statusCode) || 500
    }
}

function socketIsActive(socketPath, timeoutMs = 300) {
    return new Promise((resolve) => {
        const socket = net.createConnection(socketPath)
        const timer = setTimeout(() => {
            socket.destroy()
            resolve(false)
        }, timeoutMs)
        socket.once('connect', () => {
            clearTimeout(timer)
            socket.destroy()
            resolve(true)
        })
        socket.once('error', () => {
            clearTimeout(timer)
            resolve(false)
        })
    })
}

class ConfigControlServer {
    constructor(service, options = {}) {
        this.service = service
        this.socketPath = defaultConfigControlSocketPath({ explicitPath: options.socketPath })
        this.server = null
    }

    async start() {
        if (this.server) return this
        const directory = path.dirname(this.socketPath)
        await ensurePrivateDirectory(directory)
        await removeStaleControlSocket(this.socketPath, directory)
        this.server = net.createServer((socket) => this._handle(socket))
        await new Promise((resolve, reject) => {
            this.server.once('error', reject)
            this.server.listen(this.socketPath, resolve)
        })
        await secureControlSocket(this.socketPath, directory)
        await syncDirectory(directory)
        return this
    }

    _handle(socket) {
        socket.setEncoding('utf8')
        let source = ''
        let settled = false
        const respond = (value) => {
            if (settled) return
            settled = true
            socket.end(`${JSON.stringify(value)}\n`)
        }
        socket.on('data', (chunk) => {
            if (settled) return
            source += chunk
            if (Buffer.byteLength(source, 'utf8') > MAX_REQUEST_BYTES) {
                respond({ ok: false, error: { code: 'CONFIG_CONTROL_REQUEST_TOO_LARGE' }, statusCode: 413 })
                return
            }
            const newline = source.indexOf('\n')
            if (newline < 0) return
            const line = source.slice(0, newline)
            this._dispatch(line).then(respond, (error) => respond(publicFailure(this.service, error)))
        })
        socket.on('error', () => {})
    }

    async _dispatch(line) {
        let request
        try {
            request = JSON.parse(line)
        } catch {
            const error = new Error('Invalid config control request')
            error.code = 'CONFIG_CONTROL_REQUEST_INVALID'
            throw error
        }
        if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('CONFIG_CONTROL_REQUEST_INVALID')
        if (request.action === 'status') return { ok: true, status: this.service.getStatus() }
        if (request.action === 'get') {
            const pathValue = Array.isArray(request.path) ? request.path.map(String) : []
            return { ok: true, value: getIn(this.service.getPublicSnapshot(), pathValue), status: this.service.getStatus() }
        }
        if (request.action === 'patch') {
            if (!Array.isArray(request.operations) || !Number.isSafeInteger(request.expectedGeneration)) {
                const error = new Error('Invalid config control patch request')
                error.code = 'CONFIG_CONTROL_REQUEST_INVALID'
                throw error
            }
            const result = await this.service.patch(request.operations, {
                actor: 'config-cli',
                expectedGeneration: request.expectedGeneration
            })
            return { ok: true, result }
        }
        const error = new Error('Unknown config control action')
        error.code = 'CONFIG_CONTROL_ACTION_UNKNOWN'
        throw error
    }

    async stop() {
        const server = this.server
        this.server = null
        if (server) await new Promise((resolve) => server.close(resolve))
        try {
            const stat = await fs.promises.lstat(this.socketPath)
            if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error('CONFIG_CONTROL_SOCKET_UNSAFE')
            await fs.promises.unlink(this.socketPath)
            await syncDirectory(path.dirname(this.socketPath))
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
    }
}

function requestConfigControl(socketPath, request, options = {}) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(path.resolve(socketPath))
        let source = ''
        const timer = setTimeout(() => {
            const error = new Error('Config control request timed out')
            error.code = 'CONFIG_CONTROL_TIMEOUT'
            socket.destroy(error)
        }, options.timeoutMs ?? 5000)
        socket.setEncoding('utf8')
        socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
        socket.on('data', (chunk) => {
            source += chunk
            if (Buffer.byteLength(source, 'utf8') > MAX_REQUEST_BYTES) socket.destroy(new Error('CONFIG_CONTROL_RESPONSE_TOO_LARGE'))
            const newline = source.indexOf('\n')
            if (newline < 0) return
            clearTimeout(timer)
            socket.end()
            try {
                const response = JSON.parse(source.slice(0, newline))
                if (!response?.ok) {
                    const error = new Error('Config control request failed')
                    error.code = response?.error?.code || 'CONFIG_CONTROL_ERROR'
                    error.statusCode = response?.statusCode || 500
                    reject(error)
                } else resolve(response)
            } catch (error) {
                reject(error)
            }
        })
        socket.once('error', (error) => {
            clearTimeout(timer)
            if (!error.code || ['ENOENT', 'ECONNREFUSED'].includes(error.code)) error.code = 'CONFIG_CONTROL_UNAVAILABLE'
            reject(error)
        })
    })
}

module.exports = {
    ConfigControlServer,
    requestConfigControl,
    socketIsActive,
    secureControlSocket,
    removeStaleControlSocket,
    defaultConfigControlSocketPath,
    MAX_REQUEST_BYTES
}
