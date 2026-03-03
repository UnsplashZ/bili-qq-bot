#!/usr/bin/env node
/**
 * test/unit/detectChargingContent.test.js
 *
 * 测试 detectChargingContent() 的充电专属判定逻辑
 *
 * 运行: node test/unit/detectChargingContent.test.js
 */

'use strict'

const assert = require('assert')
const path = require('path')

const { detectChargingContent } = require(path.join(__dirname, '../../src/services/imageGenerator/generators/previewCard'))

let passed = 0
let failed = 0

async function test(name, fn) {
    try {
        await fn()
        console.log(`  PASS: ${name}`)
        passed++
    } catch (e) {
        console.error(`  FAIL: ${name}`)
        console.error(`     ${e.message}`)
        failed++
    }
}

async function runTests() {
    console.log('\n=== detectChargingContent 充电判定测试 ===\n')

    await test('空数据返回 false', () => {
        assert.strictEqual(detectChargingContent('video', null), false)
    })

    await test('动态 is_only_fans=true 返回 true', () => {
        const data = { data: { item: { basic: { is_only_fans: true } } } }
        assert.strictEqual(detectChargingContent('dynamic', data), true)
    })

    await test('视频 is_charging_arc=true 返回 true', () => {
        const data = { data: { is_charging_arc: true } }
        assert.strictEqual(detectChargingContent('video', data), true)
    })

    await test('视频 rights.is_charging_arc=1 返回 true', () => {
        const data = { data: { rights: { is_charging_arc: 1 } } }
        assert.strictEqual(detectChargingContent('video', data), true)
    })

    await test('视频 is_upower_exclusive=true 返回 true', () => {
        const data = { data: { is_upower_exclusive: true } }
        assert.strictEqual(detectChargingContent('video', data), true)
    })

    await test('视频 is_upower_exclusive=1 返回 true', () => {
        const data = { data: { is_upower_exclusive: 1 } }
        assert.strictEqual(detectChargingContent('video', data), true)
    })

    await test('普通视频返回 false', () => {
        const data = { data: { rights: { is_charging_arc: 0 }, is_upower_exclusive: false } }
        assert.strictEqual(detectChargingContent('video', data), false)
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(e => { console.error(e); process.exit(1) })
