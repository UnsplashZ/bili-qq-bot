'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
    assertSafePathChain,
    atomicWriteFile,
    ensurePrivateDir
} = require('../../../src/migrations/common/atomicFile')

describe('migration atomic file path safety', () => {
    it('rejects parent and intermediate symlinks', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-atomic-symlink-'))
        try {
            const real = path.join(root, 'real')
            fs.mkdirSync(real)
            const parentLink = path.join(root, 'parent-link')
            fs.symlinkSync(real, parentLink)
            assert.throws(
                () => atomicWriteFile(path.join(parentLink, 'value.json'), '{}\n'),
                (error) => ['MIGRATION_SYMLINK_FORBIDDEN', 'MIGRATION_PATH_REALPATH_MISMATCH'].includes(error.code)
            )

            const safeParent = path.join(root, 'safe')
            fs.mkdirSync(safeParent)
            fs.symlinkSync(real, path.join(safeParent, 'middle'))
            assert.throws(
                () => ensurePrivateDir(path.join(safeParent, 'middle', 'child')),
                (error) => ['MIGRATION_SYMLINK_FORBIDDEN', 'MIGRATION_PATH_REALPATH_MISMATCH'].includes(error.code)
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('enforces explicit realpath containment boundaries', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-atomic-boundary-'))
        try {
            const inside = path.join(root, 'inside')
            fs.mkdirSync(inside)
            assert.strictEqual(assertSafePathChain(inside, { boundary: root }), inside)
            assert.throws(
                () => assertSafePathChain(path.join(root, '..', 'outside'), { boundary: root }),
                (error) => error.code === 'MIGRATION_PATH_OUTSIDE_BOUNDARY'
            )
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('rejects hard-linked existing targets and preserves exclusive targets', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-atomic-hardlink-'))
        try {
            const source = path.join(root, 'source')
            const linked = path.join(root, 'linked')
            fs.writeFileSync(source, 'original')
            fs.linkSync(source, linked)
            assert.throws(
                () => atomicWriteFile(linked, 'replacement'),
                (error) => error.code === 'MIGRATION_FILE_LINK_COUNT_UNSAFE'
            )
            const exclusive = path.join(root, 'exclusive')
            atomicWriteFile(exclusive, 'first', { overwrite: false })
            assert.throws(
                () => atomicWriteFile(exclusive, 'second', { overwrite: false }),
                (error) => error.code === 'MIGRATION_TARGET_EXISTS'
            )
            assert.strictEqual(fs.readFileSync(exclusive, 'utf8'), 'first')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('keeps writes on the checked directory fd when the parent path is swapped', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-atomic-parent-swap-'))
        const parent = path.join(root, 'parent')
        const original = path.join(root, 'original-parent')
        const attacker = path.join(root, 'attacker')
        fs.mkdirSync(parent)
        fs.mkdirSync(attacker)
        try {
            assert.throws(
                () => atomicWriteFile(path.join(parent, 'secret.txt'), 'stdin-only-secret', {
                    beforeDirectoryFdWrite() {
                        fs.renameSync(parent, original)
                        fs.symlinkSync(attacker, parent)
                    }
                }),
                (error) => ['MIGRATION_ATOMIC_WRITER_FAILED', 'MIGRATION_DIRECTORY_CHANGED', 'MIGRATION_SYMLINK_FORBIDDEN'].includes(error.code)
            )
            assert.strictEqual(fs.existsSync(path.join(attacker, 'secret.txt')), false)
            assert.strictEqual(fs.existsSync(path.join(original, 'secret.txt')), false)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
