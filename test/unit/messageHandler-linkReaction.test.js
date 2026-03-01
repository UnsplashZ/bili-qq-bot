#!/usr/bin/env node
/**
 * test/unit/messageHandler-linkReaction.test.js
 *
 * 测试链接处理段的表情反馈逻辑
 *
 * 运行: node test/unit/messageHandler-linkReaction.test.js
 */

'use strict'

const assert = require('assert')
const path = require('path')

// --- Mock: linkHandler ---
const linkHandler = require(path.join(__dirname, '../../src/handlers/linkHandler'))

// --- Mock: 其他依赖（防止副作用）---
const aiHandler = require(path.join(__dirname, '../../src/handlers/aiHandler'))
aiHandler.shouldReply = () => false  // 禁止 AI 处理
aiHandler.addMessageToContext = () => {}

const vectorMemoryService = require(path.join(__dirname, '../../src/services/vectorMemoryService'))
vectorMemoryService.addMemory = async () => {}

const commandManager = require(path.join(__dirname, '../../src/commands'))
commandManager.dispatch = async () => false  // 没有命令匹配

const config = require(path.join(__dirname, '../../src/config'))
config.isRootAdmin = () => false
config.blacklistedQQs = []
config.isGroupEnabled = () => true
config.ensureGroupConfig = () => {}
config.groupConfigs = {}

// --- Mock WebSocket ---
function makeMockWs() {
    const sent = []
    return {
        readyState: 1, // OPEN
        send(data) { sent.push(JSON.parse(data)) },
        _sent: sent,
        _getEmojiActions() {
            return this._sent.filter(m => m.action === 'set_msg_emoji_like')
        }
    }
}

// --- 构造最简 messageData ---
function makeMessageData(rawMsg, messageId = 99999) {
    return {
        message_type: 'group',
        group_id: '123456',
        user_id: '111111',
        self_id: '000000',
        message_id: messageId,
        raw_message: rawMsg,
        message: [],
        sender: { nickname: 'TestUser' }
    }
}

const handler = require(path.join(__dirname, '../../src/handlers/messageHandler'))

// 捕获被 mock 模块的原始方法，用于每次测试后还原
const _originals = {
    extractLinks:      linkHandler.extractLinks,
    isLinkCached:      linkHandler.isLinkCached,
    processSingleLink: linkHandler.processSingleLink,
    addLinkToCache:    linkHandler.addLinkToCache,
    shouldReply:       aiHandler.shouldReply,
}

// ---- 测试运行器 ----
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
    } finally {
        // 每次测试后还原被 mock 的属性，防止状态泄漏到下一个用例
        linkHandler.extractLinks      = _originals.extractLinks
        linkHandler.isLinkCached      = _originals.isLinkCached
        linkHandler.processSingleLink = _originals.processSingleLink
        linkHandler.addLinkToCache    = _originals.addLinkToCache
        aiHandler.shouldReply         = _originals.shouldReply
    }
}

async function runTests() {
    console.log('\n=== 链接处理表情反馈逻辑测试 ===\n')

    // === 场景 1: 无链接 → 无表情 ===
    await test('无 Bilibili 链接时不发送任何表情', async () => {
        linkHandler.extractLinks = () => []
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('普通消息，没有链接'))
        assert.strictEqual(ws._getEmojiActions().length, 0)
    })

    // === 场景 2: 全部链接在冷却中 → 发 128164（嘘） ===
    await test('全部链接在冷却期内时发送嘘表情(128164)并返回', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV123|123456', match: 'BV123' }]
        linkHandler.isLinkCached = () => true  // 全部缓存
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV123'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 1)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128164')
        assert.strictEqual(emojiActions[0].params.set, true)
    })

    // === 场景 3: 有未缓存链接且成功 → 思考→撤销思考→OK ===
    await test('未缓存链接处理成功时: 发128074→撤销128074→发128076', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV456|123456', match: 'BV456', type: 'video', id: 'BV456' }]
        linkHandler.isLinkCached = () => false
        linkHandler.processSingleLink = async () => {}  // 模拟成功
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV456'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')  // thinking
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '128074')  // remove thinking
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '128076')  // done
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 4: 有未缓存链接但失败 → 思考→撤销思考→流泪 ===
    await test('未缓存链接处理失败时: 发128074→撤销128074→发10060', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV789|123456', match: 'BV789', type: 'video', id: 'BV789' }]
        linkHandler.isLinkCached = () => false
        linkHandler.processSingleLink = async () => { throw new Error('解析失败') }
        linkHandler.sendGroupMessage = async () => {}  // mock 错误文字发送
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV789'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')  // thinking
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '128074')  // remove thinking
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '10060')   // crying
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 5: 混合（1个缓存 + 1个未缓存）→ 发128074（不是128164），处理未缓存，发128076 ===
    await test('混合链接时走未缓存流程（发128074而非128164）', async () => {
        const links = [
            { cacheKey: 'video|BVcached|123456', match: 'BVcached', type: 'video', id: 'BVcached' },
            { cacheKey: 'video|BVfresh|123456',  match: 'BVfresh',  type: 'video', id: 'BVfresh'  },
        ]
        linkHandler.extractLinks = () => links
        linkHandler.isLinkCached = (key) => key.includes('cached')
        linkHandler.processSingleLink = async () => {}
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('BVcached BVfresh'))
        const emojiActions = ws._getEmojiActions()
        // 第一个表情必须是 128074（思考），而不是 128164（嘘）
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')
        // 最终表情是 128076（成功）
        assert.strictEqual(emojiActions[emojiActions.length - 1].params.emoji_id, '128076')
    })

    // === 场景 7: 同一消息中两个相同 cacheKey 的链接只处理一次（回归测试）===
    await test('相同 cacheKey 的重复链接只处理一次', async () => {
        const dupLink = { cacheKey: 'video|BVdup|123456', match: 'BVdup', type: 'video', id: 'BVdup' }
        linkHandler.extractLinks = () => [dupLink, dupLink]  // 同一链接出现两次
        linkHandler.isLinkCached = () => false
        let processCount = 0
        linkHandler.processSingleLink = async () => { processCount++ }
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('BVdup BVdup'))
        assert.strictEqual(processCount, 1, `processSingleLink 应只调用 1 次，实际调用 ${processCount} 次`)
    })

    // === 场景 6: 无链接时 AI 仍可处理（回归测试）===
    await test('无链接时不影响 AI 处理路径（shouldReply 被调用）', async () => {
        linkHandler.extractLinks = () => []
        let aiCalled = false
        aiHandler.shouldReply = () => { aiCalled = true; return false }
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('你好'))
        assert.ok(aiCalled, 'aiHandler.shouldReply 应该被调用')
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(e => { console.error(e); process.exit(1) })
