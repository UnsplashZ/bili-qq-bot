#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

const script = `
const logger = require(${JSON.stringify(path.join(process.cwd(), 'src/utils/logger.js'))})
logger.logEvent('info', 'BOT', 'svc:lifecycle', 'stdout-format-check', { ok: true })
`

const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8'
})

assert.strictEqual(result.status, 0, result.stderr || 'logger stdout child process should exit successfully')
assert.ok(result.stdout.includes('INF BOT'), 'stdout should include formatted event line')
assert.ok(result.stdout.includes('stdout-format-check'), 'stdout should include event message')
assert.ok(!result.stdout.includes('[INFO] default -'), 'stdout should not include log4js default wrapper')

console.log('PASS logger-stdout-format')
