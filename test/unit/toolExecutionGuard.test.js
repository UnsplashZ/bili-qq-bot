#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { ToolExecutionGuard } = require('../../src/services/ai/toolExecutionGuard')

async function testTimeout() {
    const guard = new ToolExecutionGuard({
        timeoutMs: 30,
        failureThreshold: 3,
        cooldownMs: 100
    })

    const result = await guard.execute('slow_tool', async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
    })

    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.reason, 'timeout')
    assert.strictEqual(result.timedOut, true)
    console.log('✓ timeout 会被正确拦截')
}

async function testCircuitOpenAfterFailures() {
    const guard = new ToolExecutionGuard({
        timeoutMs: 50,
        failureThreshold: 2,
        cooldownMs: 200
    })

    let invokeCount = 0
    const failingCall = async () => {
        invokeCount++
        throw new Error('tool failed')
    }

    await guard.execute('unstable_tool', failingCall)
    await guard.execute('unstable_tool', failingCall)
    const blocked = await guard.execute('unstable_tool', failingCall)

    assert.strictEqual(blocked.ok, false)
    assert.strictEqual(blocked.reason, 'circuit_open')
    assert.strictEqual(invokeCount, 2, '熔断开启后不应继续调用原函数')
    console.log('✓ 连续失败触发熔断且会短路调用')
}

async function testSuccessResetsFailures() {
    const guard = new ToolExecutionGuard({
        timeoutMs: 50,
        failureThreshold: 3,
        cooldownMs: 100
    })

    await guard.execute('recoverable_tool', async () => {
        throw new Error('fail once')
    })

    const ok = await guard.execute('recoverable_tool', async () => 'ok')
    assert.strictEqual(ok.ok, true)
    assert.strictEqual(ok.value, 'ok')

    const state = guard.getToolState('recoverable_tool')
    assert.strictEqual(state.consecutiveFailures, 0)
    console.log('✓ 成功执行会重置连续失败计数')
}

async function testTimeoutAbortsUnderlyingCall() {
    const guard = new ToolExecutionGuard({
        timeoutMs: 30,
        failureThreshold: 3,
        cooldownMs: 100
    })

    let aborted = false
    const result = await guard.execute('abortable_tool', async ({ signal }) => {
        assert.ok(signal, 'guard 应向底层调用透传 AbortSignal')
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve('done'), 120)
            signal.addEventListener('abort', () => {
                aborted = true
                clearTimeout(timer)
                reject(signal.reason || new Error('aborted'))
            }, { once: true })
        })
    })

    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.reason, 'timeout')
    assert.strictEqual(aborted, true, '超时后应触发底层调用 abort')
    console.log('✓ 超时会触发底层可取消调用的 abort')
}

async function run() {
    await testTimeout()
    await testCircuitOpenAfterFailures()
    await testSuccessResetsFailures()
    await testTimeoutAbortsUnderlyingCall()
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
