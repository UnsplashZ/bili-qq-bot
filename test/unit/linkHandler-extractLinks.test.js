#!/usr/bin/env node
/**
 * test/unit/linkHandler-extractLinks.test.js
 *
 * 测试 LinkHandler.extractLinks() 的动态链接识别
 *
 * 运行: node test/unit/linkHandler-extractLinks.test.js
 */

'use strict'

const assert = require('assert')
const path = require('path')

const linkHandler = require(path.join(__dirname, '../../src/handlers/linkHandler'))

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

function findDynamicId(links) {
    const item = links.find(l => l.type === 'dynamic')
    return item ? item.id : null
}

async function runTests() {
    console.log('\n=== LinkHandler.extractLinks 动态链接识别测试 ===\n')

    await test('识别 t.bilibili.com 动态链接', () => {
        const links = linkHandler.extractLinks('https://t.bilibili.com/123456789', '10001')
        assert.strictEqual(findDynamicId(links), '123456789')
    })

    await test('识别 m.bilibili.com/dynamic 动态链接', () => {
        const links = linkHandler.extractLinks('https://m.bilibili.com/dynamic/1174654659795615752', '10001')
        assert.strictEqual(findDynamicId(links), '1174654659795615752')
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1) })
