'use strict'

const fs = require('fs')
const path = require('path')

const WRITE_FLAG_MASK = fs.constants.O_WRONLY |
    fs.constants.O_RDWR |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    fs.constants.O_APPEND

function normalizePath(value) {
    if (value instanceof URL) {
        if (value.protocol !== 'file:') return null
        return path.resolve(decodeURIComponent(value.pathname))
    }
    if (Buffer.isBuffer(value)) return path.resolve(value.toString())
    if (typeof value !== 'string') return null
    return path.resolve(value)
}

function isWithin(candidate, root) {
    const relative = path.relative(root, candidate)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function createProtectedPathError(candidate, operation) {
    const error = new Error(`Test write barrier refused ${operation} on real runtime path: ${candidate}`)
    error.code = 'TEST_REAL_RUNTIME_WRITE_BLOCKED'
    error.path = candidate
    error.operation = operation
    return error
}

function flagsMayWrite(flags) {
    if (typeof flags === 'number') return Boolean(flags & WRITE_FLAG_MASK)
    if (typeof flags !== 'string') return false
    return /[wax+]/.test(flags)
}

function installWriteBarrier(options = {}) {
    const protectedRoots = (options.protectedRoots || []).map((entry) => path.resolve(entry))
    const patched = []

    function assertAllowed(value, operation) {
        const candidate = normalizePath(value)
        if (!candidate) return
        const protectedRoot = protectedRoots.find((root) => isWithin(candidate, root))
        if (protectedRoot) throw createProtectedPathError(candidate, operation)
    }

    function patchMethod(target, name, pathIndexes) {
        if (!target || typeof target[name] !== 'function') return
        const original = target[name]
        target[name] = function guardedRuntimeWrite(...args) {
            for (const index of pathIndexes) assertAllowed(args[index], name)
            return original.apply(this, args)
        }
        patched.push(() => { target[name] = original })
    }

    const onePathMethods = [
        'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
        'truncate', 'truncateSync', 'unlink', 'unlinkSync', 'rm', 'rmSync',
        'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync',
        'chmod', 'chmodSync', 'chown', 'chownSync', 'lchmod', 'lchmodSync',
        'lchown', 'lchownSync', 'utimes', 'utimesSync', 'lutimes', 'lutimesSync',
        'createWriteStream'
    ]
    for (const name of onePathMethods) patchMethod(fs, name, [0])
    for (const name of ['rename', 'renameSync']) patchMethod(fs, name, [0, 1])
    for (const name of ['copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync']) {
        patchMethod(fs, name, [1])
    }

    for (const name of onePathMethods.filter((entry) => !entry.endsWith('Sync') && entry !== 'createWriteStream')) {
        patchMethod(fs.promises, name, [0])
    }
    for (const name of ['rename']) patchMethod(fs.promises, name, [0, 1])
    for (const name of ['copyFile', 'cp', 'link', 'symlink']) patchMethod(fs.promises, name, [1])

    function patchOpen(target, name) {
        if (!target || typeof target[name] !== 'function') return
        const original = target[name]
        target[name] = function guardedRuntimeOpen(file, flags, ...rest) {
            if (flagsMayWrite(flags)) assertAllowed(file, name)
            return original.call(this, file, flags, ...rest)
        }
        patched.push(() => { target[name] = original })
    }
    patchOpen(fs, 'open')
    patchOpen(fs, 'openSync')
    patchOpen(fs.promises, 'open')

    return {
        protectedRoots: protectedRoots.slice(),
        restore() {
            while (patched.length > 0) patched.pop()()
        }
    }
}

function inventoryTree(roots) {
    const inventory = {}
    const visit = (root, current) => {
        let entries
        try {
            entries = fs.readdirSync(current, { withFileTypes: true })
        } catch (error) {
            if (error?.code === 'ENOENT') return
            throw error
        }
        entries.sort((left, right) => left.name.localeCompare(right.name))
        for (const entry of entries) {
            const absolute = path.join(current, entry.name)
            const relative = path.relative(root, absolute)
            const stat = fs.lstatSync(absolute)
            const key = `${root}\0${relative}`
            inventory[key] = {
                type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
                mode: stat.mode & 0o7777,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                nlink: stat.nlink,
                linkTarget: stat.isSymbolicLink() ? fs.readlinkSync(absolute) : null
            }
            if (stat.isDirectory()) visit(root, absolute)
        }
    }
    for (const rootInput of roots) {
        const root = path.resolve(rootInput)
        let rootStat = null
        try { rootStat = fs.lstatSync(root) } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
        inventory[`${root}\0.`] = rootStat
            ? { type: rootStat.isDirectory() ? 'directory' : 'other', mode: rootStat.mode & 0o7777, size: rootStat.size, mtimeMs: rootStat.mtimeMs, nlink: rootStat.nlink, linkTarget: null }
            : { type: 'missing', mode: null, size: null, mtimeMs: null, nlink: null, linkTarget: null }
        if (rootStat?.isDirectory()) visit(root, root)
    }
    return inventory
}

function diffInventories(before, after) {
    const differences = []
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        const left = before[key]
        const right = after[key]
        if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ path: key.replace('\0', path.sep), before: left || null, after: right || null })
    }
    return differences
}

module.exports = {
    installWriteBarrier,
    inventoryTree,
    diffInventories,
    flagsMayWrite,
    isWithin
}
