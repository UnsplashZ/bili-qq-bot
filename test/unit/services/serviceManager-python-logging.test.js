#!/usr/bin/env node
'use strict'

const assert = require('assert')

const axios = require('axios')
const logger = require('../../../src/utils/logger')
const serviceManager = require('../../../src/services/ServiceManager')

const originals = {
    post: axios.post,
    start: serviceManager.start,
    process: serviceManager.process
}

function restore() {
    axios.post = originals.post
    serviceManager.start = originals.start
    serviceManager.process = originals.process
}

function collectLogs() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))
    return { logs, off }
}

function extractReqId(line) {
    const match = line.match(/\[req:([^\]]+)\]/)
    return match ? match[1] : ''
}

async function testSendCommandEmitsUnifiedRpcStartAndDoneLogs() {
    const { logs, off } = collectLogs()
    try {
        serviceManager.process = { pid: 1 }
        serviceManager.start = async () => {
            throw new Error('start should not be called when process already exists')
        }

        let capturedHeaders = null
        axios.post = async (_url, _data, options = {}) => {
            capturedHeaders = options.headers || {}
            return {
                data: { status: 'success', data: { ok: true } }
            }
        }

        await serviceManager.sendCommand('dynamic_detail', { dynamic_id: '123456' })

        assert.ok(capturedHeaders, '应向 Python 请求透传头信息')
        assert.ok(capturedHeaders['x-request-id'], '应包含 x-request-id')

        const startLine = logs.find((line) => line.includes('RPC') && line.includes('start') && line.includes('dynamic_detail'))
        const doneLine = logs.find((line) => line.includes('RPC') && line.includes('done') && line.includes('dynamic_detail'))

        assert.ok(startLine, '应输出统一风格的 RPC start 日志')
        assert.ok(doneLine, '应输出统一风格的 RPC done 日志')

        const startReqId = extractReqId(startLine)
        const doneReqId = extractReqId(doneLine)
        assert.ok(startReqId, 'RPC start 日志应包含 reqId')
        assert.strictEqual(doneReqId, startReqId, 'RPC done 日志应复用同一个 reqId')
        assert.ok(doneLine.includes('duration='), 'RPC done 日志应包含耗时摘要')
    } finally {
        off()
        restore()
    }
}

async function testSendCommandEmitsUnifiedRpcFailLogs() {
    const { logs, off } = collectLogs()
    try {
        serviceManager.process = { pid: 1 }
        serviceManager.start = async () => {
            throw new Error('start should not be called when process already exists')
        }

        axios.post = async () => {
            throw new Error('boom')
        }

        let thrown = null
        try {
            await serviceManager.sendCommand('video', { bvid: 'BV1xx411c7mD' })
        } catch (error) {
            thrown = error
        }

        assert.ok(thrown, 'sendCommand 失败时应继续抛出异常')

        const failLine = logs.find((line) => line.includes('RPC') && line.includes('fail') && line.includes('video'))
        assert.ok(failLine, '应输出统一风格的 RPC fail 日志')
        assert.ok(failLine.includes('duration='), 'RPC fail 日志应包含耗时摘要')
        assert.ok(failLine.includes('error=boom'), 'RPC fail 日志应包含错误摘要')
        assert.ok(extractReqId(failLine), 'RPC fail 日志应包含 reqId')
    } finally {
        off()
        restore()
    }
}

async function testSendCommandTreatsOkStatusAsInfo() {
    const { logs, off } = collectLogs()
    try {
        serviceManager.process = { pid: 1 }
        serviceManager.start = async () => {
            throw new Error('start should not be called when process already exists')
        }

        axios.post = async () => ({
            data: { status: 'ok', refreshed: true }
        })

        await serviceManager.sendCommand('refresh_credential', {})

        const doneLine = logs.find((line) => line.includes('RPC') && line.includes('done') && line.includes('refresh_credential'))
        assert.ok(doneLine, 'refresh_credential 应输出 RPC done 日志')
        assert.ok(doneLine.includes('INF') && doneLine.includes('RPC'), 'status=ok 应被视为成功而不是 warn')
        assert.ok(doneLine.includes('status=ok'), 'RPC done 日志应保留原始 status 字段')
    } finally {
        off()
        restore()
    }
}

function testHandlePythonLineFiltersStartupBanner() {
    const { logs, off } = collectLogs()
    try {
        serviceManager.handlePythonLine('stdout', '======== Running on http://127.0.0.1:10001 ========')
        serviceManager.handlePythonLine('stdout', '(Press CTRL+C to quit)')

        assert.strictEqual(logs.length, 0, 'Python 启动 banner 不应再透传到统一日志流')
    } finally {
        off()
    }
}

function testIdleCheckIntervalDoesNotHoldEventLoop() {
    assert.ok(serviceManager.idleCheckInterval, '应创建空闲巡检定时器')
    assert.strictEqual(
        typeof serviceManager.idleCheckInterval.hasRef,
        'function',
        '定时器应支持 hasRef() 检查'
    )
    assert.strictEqual(
        serviceManager.idleCheckInterval.hasRef(),
        false,
        '空闲巡检定时器不应阻塞测试或进程退出'
    )
}

async function run() {
    testIdleCheckIntervalDoesNotHoldEventLoop()
    testHandlePythonLineFiltersStartupBanner()
    await testSendCommandEmitsUnifiedRpcStartAndDoneLogs()
    await testSendCommandTreatsOkStatusAsInfo()
    await testSendCommandEmitsUnifiedRpcFailLogs()
    console.log('PASS serviceManager-python-logging')
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
