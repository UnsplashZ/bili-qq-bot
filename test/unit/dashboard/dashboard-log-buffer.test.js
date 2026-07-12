#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { createLogBuffer } = require('../../../src/dashboard/logBuffer')

const buffer = createLogBuffer({ maxSize: 3 })

buffer.push({
    timestampText: '2026/03/13 10:00:00',
    level: 'info',
    severity: 30,
    channel: 'BOT',
    scope: 'svc:lifecycle',
    action: 'one',
    fields: { step: 1 },
    rendered: 'INF BOT      [svc:lifecycle] one step=1',
    message: 'INF BOT      [svc:lifecycle] one step=1'
})
buffer.push({
    timestampText: '2026/03/13 10:00:01',
    level: 'warn',
    severity: 40,
    channel: 'RPC',
    scope: 'req:abc',
    action: 'two',
    fields: { step: 2 },
    rendered: 'WRN RPC      [req:abc] two step=2',
    message: 'WRN RPC      [req:abc] two step=2'
})
buffer.push({
    timestampText: '2026/03/13 10:00:02',
    level: 'error',
    severity: 50,
    channel: 'HTTP',
    scope: 'req:def',
    action: 'three',
    fields: { step: 3 },
    rendered: 'ERR HTTP     [req:def] three step=3',
    message: 'ERR HTTP     [req:def] three step=3'
})
buffer.push({
    timestampText: '2026/03/13 10:00:03',
    level: 'info',
    severity: 30,
    channel: 'PY',
    scope: 'svc:lifecycle',
    action: 'four',
    fields: { step: 4 },
    rendered: 'INF PY       [svc:lifecycle] four step=4',
    message: 'INF PY       [svc:lifecycle] four step=4'
})

const allLogs = buffer.list({})
assert.strictEqual(allLogs.length, 3, 'buffer should retain only the latest maxSize records')
assert.deepStrictEqual(allLogs.map((entry) => entry.action), ['two', 'three', 'four'], 'buffer should preserve insertion order for the retained tail')
assert.strictEqual(allLogs[0].channel, 'RPC')
assert.deepStrictEqual(allLogs[2].fields, { step: 4 }, 'buffer should preserve structured fields')
assert.strictEqual(allLogs[2].rendered, 'INF PY       [svc:lifecycle] four step=4')

const filteredLogs = buffer.list({ level: 'error', channels: ['HTTP', 'PY'], keyword: 'three', limit: 2 })
assert.deepStrictEqual(filteredLogs.map((entry) => entry.action), ['three'], 'buffer should support level, channel and keyword filtering')

buffer.resize(2)
assert.strictEqual(buffer.capacity(), 2, 'resize should update the configured capacity')
assert.deepStrictEqual(
    buffer.list({}).map((entry) => entry.action),
    ['three', 'four'],
    'shrinking should retain only the newest records'
)

buffer.push({
    timestampText: '2026/03/13 10:00:04',
    level: 'info',
    severity: 30,
    channel: 'BOT',
    scope: 'svc:lifecycle',
    action: 'five',
    fields: { step: 5 },
    rendered: 'INF BOT      [svc:lifecycle] five step=5',
    message: 'INF BOT      [svc:lifecycle] five step=5'
})
assert.deepStrictEqual(
    buffer.list({}).map((entry) => entry.action),
    ['four', 'five'],
    'push after resize should continue enforcing the new capacity'
)

for (const invalidSize of [0, -1, 1.5, Number.NaN, '2', null]) {
    assert.throws(() => buffer.resize(invalidSize), /positive integer/, `resize should reject ${String(invalidSize)}`)
}

console.log('PASS dashboard-log-buffer')
