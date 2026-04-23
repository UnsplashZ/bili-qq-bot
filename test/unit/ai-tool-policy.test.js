#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { filterVisibleTools, isToolVisible } = require('../../src/services/ai/tools/toolPolicy')

const tools = [
    { name: 'local.read', source: 'local', riskClass: 'public_read' },
    { name: 'local.write', source: 'local', riskClass: 'admin_write' },
    { name: 'mcp.lookup', source: 'mcp', riskClass: 'public_read' }
]

function run() {
    assert.strictEqual(isToolVisible(tools[0], { allowLocalTools: true }), true)
    assert.strictEqual(isToolVisible(tools[0], { allowLocalTools: false }), false)
    assert.strictEqual(isToolVisible(tools[2], { allowMcpTools: false }), false)
    assert.strictEqual(isToolVisible(tools[1], { visibleRiskClasses: ['public_read'] }), false)
    assert.deepStrictEqual(
        filterVisibleTools(tools, { allowLocalTools: false }).map(tool => tool.name),
        ['mcp.lookup']
    )
    assert.deepStrictEqual(
        filterVisibleTools(tools, { allowedToolNames: ['local.write'] }).map(tool => tool.name),
        ['local.write']
    )
    assert.deepStrictEqual(
        filterVisibleTools(tools, { allowedToolNames: ['local.write'], allowLocalTools: false }).map(tool => tool.name),
        []
    )
    assert.deepStrictEqual(
        filterVisibleTools(tools, { allowedToolNames: ['local.write'], deniedToolNames: ['local.write'] }).map(tool => tool.name),
        []
    )
    console.log('✓ AI tool policy filters tool visibility by source, risk, and explicit allow-lists')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
