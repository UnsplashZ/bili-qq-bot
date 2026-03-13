#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

async function run() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'dashboard/src/pages/logs/scrollBehavior.js')).href
    const { isNearBottom } = await import(moduleUrl)

    assert.strictEqual(
        isNearBottom({ scrollTop: 720, clientHeight: 280, scrollHeight: 1000 }),
        true,
        '滚动条已接近底部时应继续自动跟随'
    )

    assert.strictEqual(
        isNearBottom({ scrollTop: 540, clientHeight: 280, scrollHeight: 1000 }),
        false,
        '用户已经向上翻阅时不应强制自动下滚'
    )

    assert.strictEqual(
        isNearBottom({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 }),
        true,
        '空列表应视为允许自动跟随'
    )

    console.log('PASS logs-scroll-behavior')
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
