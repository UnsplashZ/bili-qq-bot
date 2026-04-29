#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')

async function run() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'dashboard/src/pages/logs/scrollBehavior.js')).href
    const {
        isNearBottom,
        getBottomThreshold,
        getScrollTargetMode,
        getFloatingButtonMode,
        DEFAULT_BOTTOM_THRESHOLD,
        MIN_BOTTOM_THRESHOLD,
        MAX_BOTTOM_THRESHOLD,
    } = await import(moduleUrl)

    assert.strictEqual(
        getBottomThreshold(36),
        108,
        '底部跟随阈值应按 3 条日志高度计算'
    )

    assert.strictEqual(
        getBottomThreshold(8),
        MIN_BOTTOM_THRESHOLD,
        '过小的日志高度应被最小阈值夹住'
    )

    assert.strictEqual(
        getBottomThreshold(120),
        MAX_BOTTOM_THRESHOLD,
        '过大的日志高度应被最大阈值夹住'
    )

    assert.strictEqual(
        getBottomThreshold(),
        DEFAULT_BOTTOM_THRESHOLD,
        '无法读取日志高度时应回退到默认阈值'
    )

    assert.strictEqual(
        getScrollTargetMode({ containerHasOverflow: true, pageHasOverflow: true }),
        'container',
        '日志容器可滚动时应优先使用容器作为滚动目标'
    )

    assert.strictEqual(
        getScrollTargetMode({ containerHasOverflow: false, pageHasOverflow: true }),
        'page',
        '日志容器不可滚动但整页可滚动时应回退到页面滚动'
    )

    assert.strictEqual(
        getScrollTargetMode({ containerHasOverflow: false, pageHasOverflow: false }),
        null,
        '没有任何滚动空间时不应声明滚动目标'
    )

    assert.strictEqual(
        getFloatingButtonMode({ hasLogs: false, hasOverflow: false, isNearBottomPosition: true }),
        null,
        '没有日志时不应显示浮动按钮'
    )

    assert.strictEqual(
        getFloatingButtonMode({ hasLogs: true, hasOverflow: false, isNearBottomPosition: true }),
        'bottom',
        '有日志但未形成滚动条时也应显示去底部按钮'
    )

    assert.strictEqual(
        getFloatingButtonMode({ hasLogs: true, hasOverflow: true, isNearBottomPosition: false }),
        'bottom',
        '离开底部时应显示去底部按钮'
    )

    assert.strictEqual(
        getFloatingButtonMode({ hasLogs: true, hasOverflow: true, isNearBottomPosition: true }),
        'top',
        '接近底部时应显示回顶部按钮'
    )

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
