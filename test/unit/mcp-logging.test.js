#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const mcpManager = require('../../src/services/mcpManager')

const originals = {
    setTimeout: global.setTimeout
}

function restore() {
    global.setTimeout = originals.setTimeout
    if (typeof mcpManager._clearRetryTimer === 'function') {
        mcpManager._clearRetryTimer('demo')
    }
    const state = typeof mcpManager._getServerState === 'function' ? mcpManager._getServerState('demo') : null
    if (state) {
        state.retryCount = 0
        state.retryTimer = null
        state.connecting = false
    }
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        global.setTimeout = () => ({ fake: true })
        const state = mcpManager._getServerState('demo')
        state.retryCount = 0
        state.retryTimer = null
        state.connecting = false

        mcpManager._scheduleReconnect('demo', { type: 'stdio', command: 'echo' })

        assert.ok(logs.some(line => line.includes('INF MCP') && line.includes('[svc:mcp]') && line.includes('reconnect-scheduled')))
        console.log('✓ mcpManager 会输出 MCP 摘要日志')

        mcpManager.toolsMap.set('demo__broken_tool', {
            serverName: 'demo',
            originalName: 'broken_tool'
        })
        mcpManager.clients.set('demo', {
            callTool: async () => {
                throw new Error('tool boom')
            }
        })

        await assert.rejects(
            () => mcpManager.executeTool('demo__broken_tool', { value: 1 }),
            /tool boom/
        )
        assert.ok(logs.some(line => line.includes('ERR MCP') && line.includes('[svc:mcp]') && line.includes('tool-failed') && line.includes('serverName=demo') && line.includes('toolName=demo__broken_tool')))
        console.log('✓ mcpManager 工具失败会输出 MCP 摘要日志')
    } finally {
        off()
        restore()
        mcpManager.toolsMap.delete('demo__broken_tool')
        mcpManager.clients.delete('demo')
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
