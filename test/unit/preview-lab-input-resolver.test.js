#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { resolvePreviewInput } = require('../../src/services/previewLab/inputResolver')

async function testResolvePreviewInputRecognizesSupportedLinkTypes() {
    const cases = [
        ['https://www.bilibili.com/read/cv45123193', 'article', '45123193'],
        ['https://www.bilibili.com/opus/1163549263798468617', 'opus', '1163549263798468617'],
        ['https://t.bilibili.com/1180316687231090707', 'dynamic', '1180316687231090707'],
        ['https://www.bilibili.com/video/BV1ZHiyBkExG', 'video', 'BV1ZHiyBkExG'],
        ['https://space.bilibili.com/946974', 'user', '946974']
    ]

    for (const [input, expectedType, expectedId] of cases) {
        const resolved = await resolvePreviewInput(input, {})
        assert.strictEqual(resolved.resolvedLink.type, expectedType, `应识别 ${input} 为 ${expectedType}`)
        assert.strictEqual(resolved.resolvedLink.id, expectedId, `应识别 ${input} 的 ID`)
    }
}

async function testResolvePreviewInputKeepsOnlyFirstRecognizedLink() {
    const resolved = await resolvePreviewInput(
        '[CQ:at,qq=123] https://www.bilibili.com/read/cv45123193 和 https://t.bilibili.com/1180316687231090707',
        {}
    )

    assert.strictEqual(resolved.resolvedLink.type, 'article')
    assert.strictEqual(resolved.resolvedLink.id, '45123193')
    assert.ok(Array.isArray(resolved.skippedLinks))
    assert.strictEqual(resolved.skippedLinks.length, 1)
    assert.strictEqual(resolved.skippedLinks[0].type, 'dynamic')
    assert.ok(!resolved.normalizedInput.includes('[CQ:'), '应去掉 CQ 码')
}

async function testResolvePreviewInputThrowsWhenNoLinkFound() {
    let error = null
    try {
        await resolvePreviewInput('这不是一个 B 站链接', {})
    } catch (caught) {
        error = caught
    }
    assert.ok(error)
    assert.match(error.message, /未识别到可处理的 B 站链接/)
}

async function run() {
    await testResolvePreviewInputRecognizesSupportedLinkTypes()
    await testResolvePreviewInputKeepsOnlyFirstRecognizedLink()
    await testResolvePreviewInputThrowsWhenNoLinkFound()
    console.log('PASS preview-lab-input-resolver')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
