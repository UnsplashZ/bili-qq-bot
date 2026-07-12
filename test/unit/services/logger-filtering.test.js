#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

function runLogger(config = {}) {
    const script = `
const logger = require(${JSON.stringify(path.join(process.cwd(), 'src/utils/logger.js'))})
logger.reconfigure(JSON.parse(process.argv[1]))
const events = []
const off = logger.onLog((entry) => {
    events.push({
        level: entry.level,
        channel: entry.channel,
        action: entry.action,
        message: entry.message
    })
})
logger.logEvent('info', 'BOT', 'svc:test', 'info-line', { ok: true })
logger.logEvent('warn', 'RPC', 'svc:test', 'warn-line', { ok: true })
logger.logEvent('error', 'HTTP', 'svc:test', 'error-line', { ok: true })
off()
process.stderr.write(JSON.stringify(events))
`

    return spawnSync(process.execPath, ['-e', script, JSON.stringify(config)], {
        cwd: process.cwd(),
        encoding: 'utf8'
    })
}

const levelResult = runLogger({ level: 'warn' })
assert.strictEqual(levelResult.status, 0, levelResult.stderr || 'warn-level child process should exit successfully')
assert.ok(!levelResult.stdout.includes('info-line'), 'stdout should suppress info lines below LOG_LEVEL')
assert.ok(levelResult.stdout.includes('warn-line'), 'stdout should include warn lines at or above LOG_LEVEL')
assert.ok(levelResult.stdout.includes('error-line'), 'stdout should include error lines above LOG_LEVEL')
assert.strictEqual(JSON.parse(levelResult.stderr).length, 3, 'onLog should still receive all structured events')

const includeResult = runLogger({ level: 'info', channels: ['RPC', 'PY'] })
assert.strictEqual(includeResult.status, 0, includeResult.stderr || 'channel include child process should exit successfully')
assert.ok(!includeResult.stdout.includes('info-line'), 'stdout should suppress channels not in LOG_CHANNELS')
assert.ok(includeResult.stdout.includes('warn-line'), 'stdout should include channels listed in LOG_CHANNELS')
assert.ok(!includeResult.stdout.includes('error-line'), 'stdout should suppress channels missing from LOG_CHANNELS')
assert.strictEqual(JSON.parse(includeResult.stderr).length, 3, 'onLog should still receive all events when channel include is used')

const excludeResult = runLogger({ level: 'info', excludeChannels: ['HTTP'] })
assert.strictEqual(excludeResult.status, 0, excludeResult.stderr || 'channel exclude child process should exit successfully')
assert.ok(excludeResult.stdout.includes('info-line'), 'stdout should still include non-excluded channels')
assert.ok(excludeResult.stdout.includes('warn-line'), 'stdout should still include non-excluded channels')
assert.ok(!excludeResult.stdout.includes('error-line'), 'stdout should suppress excluded channels')
assert.strictEqual(JSON.parse(excludeResult.stderr).length, 3, 'onLog should still receive all events when channel exclude is used')

console.log('PASS logger-filtering')
