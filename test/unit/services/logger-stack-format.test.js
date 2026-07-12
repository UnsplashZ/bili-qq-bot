#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

function runLogger(config = {}) {
    const script = `
const logger = require(${JSON.stringify(path.join(process.cwd(), 'src/utils/logger.js'))})
logger.reconfigure(${JSON.stringify(config)})
logger.logEvent('error', 'BOT', 'svc:test', 'stack-check', {
    error: 'boom',
    stack: 'Error: boom\\n    at test:1:1\\n    at next:2:2'
})
`

    return spawnSync(process.execPath, ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env
    })
}

const withStackResult = runLogger({ stacks: 'error' })
assert.strictEqual(withStackResult.status, 0, withStackResult.stderr || 'stack child process should exit successfully')
const withStackLines = withStackResult.stdout.trimEnd().split('\n')
assert.match(withStackLines[0], /ERR BOT\s+\[svc:test\] stack-check error=boom$/, 'summary line should remain single-line and keep error field')
assert.ok(!withStackLines[0].includes('stack='), 'summary line should not inline the stack field')
assert.ok(withStackLines.slice(1).some((line) => line.startsWith('    at test:1:1')), 'stack output should be emitted on separate indented lines when LOG_STACKS=error')

const withoutStackResult = runLogger({ stacks: 'never' })
assert.strictEqual(withoutStackResult.status, 0, withoutStackResult.stderr || 'stack-off child process should exit successfully')
const withoutStackLines = withoutStackResult.stdout.trimEnd().split('\n')
assert.strictEqual(withoutStackLines.length, 1, 'stack output should be suppressed when LOG_STACKS=off')
assert.ok(!withoutStackLines[0].includes('stack='), 'summary line should omit stack field when LOG_STACKS=off')

console.log('PASS logger-stack-format')
