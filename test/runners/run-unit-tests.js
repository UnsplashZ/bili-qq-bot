#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { inventoryTree, diffInventories } = require('../tools/runtime-data-safety')

const projectRoot = path.join(__dirname, '../..')
const testRoot = path.join(projectRoot, 'test/unit')
const mochaBin = path.join(projectRoot, 'node_modules/.bin/mocha')
const runtimeDataIsolation = path.join(projectRoot, 'test/tools/isolate-runtime-data.js')
const venvDir = path.join(projectRoot, 'venv')
const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
const protectedRuntimeRoots = [path.join(projectRoot, 'config'), path.join(projectRoot, 'data')]

function listTestFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listTestFiles(fullPath))
            continue
        }
        if (entry.isFile() && (
            entry.name.endsWith('.test.js') ||
            entry.name.endsWith('.test.mjs') ||
            entry.name.endsWith('_test.py')
        )) {
            files.push(fullPath)
        }
    }

    return files
}

function ensurePython() {
    if (fs.existsSync(venvPython)) return { command: venvPython }

    const pythonCommand = process.env.PYTHON || 'python3'
    process.stdout.write(`\n[unit] creating Python venv at ${path.relative(projectRoot, venvDir)}\n`)
    const createResult = spawnSync(pythonCommand, ['-m', 'venv', venvDir], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
        timeout: 120000
    })
    if (createResult.status !== 0 || createResult.error || createResult.signal) {
        return {
            error: createResult.error || new Error(`failed to create venv with ${pythonCommand}`),
            status: createResult.status || 1,
            signal: createResult.signal
        }
    }

    const requirementsPath = path.join(projectRoot, 'requirements.txt')
    if (fs.existsSync(requirementsPath)) {
        process.stdout.write('\n[unit] installing Python requirements into venv\n')
        const installResult = spawnSync(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
            cwd: projectRoot,
            stdio: 'inherit',
            env: process.env,
            timeout: 120000
        })
        if (installResult.status !== 0 || installResult.error || installResult.signal) {
            return {
                error: installResult.error || new Error('failed to install Python requirements'),
                status: installResult.status || 1,
                signal: installResult.signal
            }
        }
    }

    return { command: venvPython }
}

function usesMocha(filePath) {
    const source = fs.readFileSync(filePath, 'utf8')
    return /\b(describe|it)\s*\(/.test(source)
}

function runOne(filePath) {
    const relativePath = path.relative(projectRoot, filePath)
    const pythonTest = filePath.endsWith('_test.py')
    const mochaTest = usesMocha(filePath)
    const python = pythonTest ? ensurePython() : null
    if (python && python.error) {
        console.error(python.error.message)
        if (python.signal) {
            console.error(`test terminated by signal ${python.signal}`)
        }
        return python.status || 1
    }

    const command = pythonTest ? python.command : (mochaTest ? mochaBin : process.execPath)
    const args = pythonTest
        ? [relativePath]
        : mochaTest
        ? ['--require', runtimeDataIsolation, '--exit', relativePath]
        : ['--require', runtimeDataIsolation, relativePath]
    const env = pythonTest
        ? {
            ...process.env,
            PYTHONPATH: [projectRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
        }
        : process.env

    process.stdout.write(`\n[unit] ${relativePath}\n`)
    const timeout = pythonTest ? 120000 : 300000
    const beforeInventory = inventoryTree(protectedRuntimeRoots)
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        env,
        timeout
    })
    const afterInventory = inventoryTree(protectedRuntimeRoots)
    const runtimeChanges = diffInventories(beforeInventory, afterInventory)

    if (runtimeChanges.length > 0) {
        console.error(`[unit] REAL RUNTIME DATA CHANGED while running ${relativePath}`)
        for (const change of runtimeChanges) {
            console.error(`[unit] changed ${change.path}`)
        }
        return 1
    }

    if (result.error) {
        console.error(result.error.message)
    }
    if (result.signal) {
        console.error(`test terminated by signal ${result.signal}`)
        return 1
    }

    return result.status || 0
}

const testFiles = listTestFiles(testRoot).sort()
let failed = 0

for (const filePath of testFiles) {
    const status = runOne(filePath)
    if (status !== 0) {
        console.error(`[unit] FAILED ${path.relative(projectRoot, filePath)} status=${status}`)
        failed += 1
    }
}

if (failed > 0) {
    console.error(`\n${failed}/${testFiles.length} unit test files failed`)
    process.exit(1)
}

console.log(`\n${testFiles.length} unit test files passed`)
