#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

function runLogger(config = {}) {
    const script = `
const logger = require(${JSON.stringify(path.join(process.cwd(), 'src/utils/logger.js'))})
logger.reconfigure(${JSON.stringify(config)})
logger.logEvent('info', 'BOT', 'svc:lifecycle', 'stdout-format-check', { ok: true })
`

    return spawnSync(process.execPath, ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env
    })
}

const defaultResult = runLogger()
assert.strictEqual(defaultResult.status, 0, defaultResult.stderr || 'logger stdout child process should exit successfully')
assert.ok(defaultResult.stdout.includes('INF BOT'), 'stdout should include formatted event line')
assert.ok(defaultResult.stdout.includes('stdout-format-check'), 'stdout should include event message')
assert.ok(!defaultResult.stdout.includes('[INFO] default -'), 'stdout should not include log4js default wrapper')

const timestampResult = runLogger({ timestamp: true })
assert.strictEqual(timestampResult.status, 0, timestampResult.stderr || 'timestamp child process should exit successfully')
assert.match(
    timestampResult.stdout,
    /\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} INF BOT\s+\[svc:lifecycle\] stdout-format-check ok=true/,
    'stdout should include full timestamp and aligned pretty output when LOG_TIMESTAMP=true'
)

const colorResult = runLogger({ color: true, timestamp: true })
assert.strictEqual(colorResult.status, 0, colorResult.stderr || 'color child process should exit successfully')
assert.match(colorResult.stdout, /\x1b\[[0-9;]*m/, 'stdout should include ANSI color codes when LOG_COLOR=true')

console.log('PASS logger-stdout-format')
