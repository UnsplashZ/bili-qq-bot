#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.join(__dirname, '../..')
const testRoot = path.join(projectRoot, 'test/unit')
const mochaBin = path.join(projectRoot, 'node_modules/.bin/mocha')

function listTestFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listTestFiles(fullPath))
            continue
        }
        if (entry.isFile() && (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs'))) {
            files.push(fullPath)
        }
    }

    return files
}

function usesMocha(filePath) {
    const source = fs.readFileSync(filePath, 'utf8')
    return /\b(describe|it)\s*\(/.test(source)
}

function runOne(filePath) {
    const relativePath = path.relative(projectRoot, filePath)
    const mochaTest = usesMocha(filePath)
    const command = mochaTest ? mochaBin : process.execPath
    const args = mochaTest
        ? ['--exit', relativePath]
        : [relativePath]

    process.stdout.write(`\n[unit] ${relativePath}\n`)
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env,
        timeout: 60000
    })

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
        failed += 1
    }
}

if (failed > 0) {
    console.error(`\n${failed}/${testFiles.length} unit test files failed`)
    process.exit(1)
}

console.log(`\n${testFiles.length} unit test files passed`)
