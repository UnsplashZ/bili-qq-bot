#!/usr/bin/env node
/**
 * test/unit/messageHandler-emojiReaction.test.js
 *
 * 测试 MessageHandler.sendEmojiReaction() 辅助方法
 *
 * 运行: node test/unit/messageHandler-emojiReaction.test.js
 */

'use strict'

const assert = require('assert')

// --- Mock WebSocket ---
function makeMockWs(readyState = 1 /* OPEN */) {
    const sent = []
    return {
        readyState,
        send(data) { sent.push(JSON.parse(data)) },
        _sent: sent
    }
}

// --- 加载被测模块 ---
const handler = require('../../src/handlers/messageHandler')

// ---- 测试运行器 ----
let passed = 0
let failed = 0

async function test(name, fn) {
    try {
        await fn()
        console.log(`  ✅ PASS: ${name}`)
        passed++
    } catch (e) {
        console.error(`  ❌ FAIL: ${name}`)
        console.error(`     ${e.message}`)
        failed++
    }
}

async function runTests() {
    console.log('\n=== MessageHandler.sendEmojiReaction 测试 ===\n')

    await test('WebSocket 开启时发送正确的 JSON', () => {
        const ws = makeMockWs(1)
        handler.sendEmojiReaction(ws, 12345, '66')
        assert.strictEqual(ws._sent.length, 1)
        const msg = ws._sent[0]
        assert.strictEqual(msg.action, 'set_msg_emoji_like')
        assert.strictEqual(msg.params.message_id, 12345)
        assert.strictEqual(msg.params.emoji_id, '66')
        assert.strictEqual(msg.params.set, true)
    })

    await test('set=false 时发送撤销指令', () => {
        const ws = makeMockWs(1)
        handler.sendEmojiReaction(ws, 12345, '66', false)
        assert.strictEqual(ws._sent.length, 1)
        assert.strictEqual(ws._sent[0].params.set, false)
    })

    await test('emoji_id 始终转为字符串', () => {
        const ws = makeMockWs(1)
        handler.sendEmojiReaction(ws, 12345, 76)  // 传入数字
        assert.strictEqual(typeof ws._sent[0].params.emoji_id, 'string')
        assert.strictEqual(ws._sent[0].params.emoji_id, '76')
    })

    await test('WebSocket 未开启时不发送（不抛出异常）', () => {
        const ws = makeMockWs(3 /* CLOSED */)
        handler.sendEmojiReaction(ws, 12345, '66')
        assert.strictEqual(ws._sent.length, 0)
    })

    await test('messageId 为空时不发送（不抛出异常）', () => {
        const ws = makeMockWs(1)
        handler.sendEmojiReaction(ws, null, '66')
        assert.strictEqual(ws._sent.length, 0)
        handler.sendEmojiReaction(ws, undefined, '66')
        assert.strictEqual(ws._sent.length, 0)
    })

    await test('ws.send() 抛异常时不向外传播（不影响调用方）', () => {
        const ws = {
            readyState: 1,
            send() { throw new Error('WebSocket send failed') }
        }
        // 不应抛出异常
        assert.doesNotThrow(() => handler.sendEmojiReaction(ws, 12345, '66'))
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(e => { console.error(e); process.exit(1) })
