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

// --- Mock: link facade dependencies ---
const linkHandler = require(path.join(__dirname, '../../src/handlers/linkHandler'))
const linkService = require(path.join(__dirname, '../../src/services/link'))
const aiIdempotency = require(path.join(__dirname, '../../src/services/ai/idempotency'))
const { replyGateService } = require(path.join(__dirname, '../../src/services/ai/replyGateService'))

// --- Mock: 其他依赖（防止副作用）---
const aiHandler = require(path.join(__dirname, '../../src/handlers/aiHandler'))
aiHandler.addMessageToContext = () => {}
replyGateService.evaluate = () => ({ shouldReply: false, triggerLevel: 'ambient', busyMode: false, score: 0, reasons: ['test'] })
replyGateService.recordBotReply = () => {}

const vectorMemoryService = require(path.join(__dirname, '../../src/services/vectorMemoryService'))
vectorMemoryService.addMemory = async () => {}

const commandManager = require(path.join(__dirname, '../../src/commands'))
const defaultDispatch = async () => false  // 没有命令匹配
commandManager.dispatch = defaultDispatch

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
let nextMessageId = 99999
function makeMessageData(rawMsg, messageId = null) {
    const resolvedMessageId = messageId == null ? nextMessageId++ : messageId
    return {
        message_type: 'group',
        group_id: '123456',
        user_id: '111111',
        self_id: '000000',
        message_id: resolvedMessageId,
        raw_message: rawMsg,
        message: [],
        sender: { nickname: 'TestUser' }
    }
}

const handler = require(path.join(__dirname, '../../src/handlers/messageHandler'))

// 捕获被 mock 模块的原始方法，用于每次测试后还原
const _originals = {
    prepareIncomingMessageLinks: linkService.prepareIncomingMessageLinks,
    handleIncomingMessageLinks: linkService.handleIncomingMessageLinks,
    isCached: linkService.isCached,
    dispatch: commandManager.dispatch,
    runAgent: aiHandler.runAgent,
    shouldReply: aiHandler.shouldReply,
    gateEvaluate: replyGateService.evaluate,
    gateRecordBotReply: replyGateService.recordBotReply,
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
        linkService.prepareIncomingMessageLinks = _originals.prepareIncomingMessageLinks
        linkService.handleIncomingMessageLinks = _originals.handleIncomingMessageLinks
        linkService.isCached = _originals.isCached
        commandManager.dispatch = _originals.dispatch
        aiHandler.runAgent = _originals.runAgent
        aiHandler.shouldReply = _originals.shouldReply
        replyGateService.evaluate = _originals.gateEvaluate
        replyGateService.recordBotReply = _originals.gateRecordBotReply
        aiIdempotency.reset()
    }
}

async function runTests() {
    console.log('\n=== 链接处理表情反馈逻辑测试 ===\n')

    // === 场景 1: 无链接 → 无表情 ===
    await test('无 Bilibili 链接时不发送任何表情', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: []
        })
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('普通消息，没有链接'))
        assert.strictEqual(ws._getEmojiActions().length, 0)
    })

    // === 场景 2: 全部链接在冷却中 → 发 128164（嘘） ===
    await test('全部链接在冷却期内时发送嘘表情(128164)并返回', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: [{ cacheKey: 'video|BV123|123456', match: 'BV123' }]
        })
        linkService.isCached = () => true
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV123'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 1)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128164')
        assert.strictEqual(emojiActions[0].params.set, true)
    })

    // === 场景 3: 有未缓存链接且成功 → 思考→撤销思考→OK ===
    await test('未缓存链接处理成功时: 发128074→撤销128074→发128076', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: [{ cacheKey: 'video|BV456|123456', match: 'BV456', type: 'video', id: 'BV456' }]
        })
        linkService.isCached = () => false
        let runAgentCalled = false
        aiHandler.runAgent = async () => {
            runAgentCalled = true
            return { finalReply: 'should not happen' }
        }
        linkService.handleIncomingMessageLinks = async () => ({
            allCached: false,
            foundCount: 1,
            skippedCachedCount: 0,
            successCount: 1,
            failureCount: 0,
            results: [{ status: 'sent_card' }]
        })
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV456'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '128076')
        assert.strictEqual(emojiActions[2].params.set, true)
        assert.strictEqual(runAgentCalled, false, 'link-only message 不应调用 aiHandler.runAgent')
    })

    // === 场景 4: 有未缓存链接但失败 → 思考→撤销思考→流泪 ===
    await test('未缓存链接处理失败时: 发128074→撤销128074→发10060', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: [{ cacheKey: 'video|BV789|123456', match: 'BV789', type: 'video', id: 'BV789' }]
        })
        linkService.isCached = () => false
        linkService.handleIncomingMessageLinks = async () => ({
            allCached: false,
            foundCount: 1,
            skippedCachedCount: 0,
            successCount: 0,
            failureCount: 1,
            results: [{ status: 'failed' }]
        })
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV789'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '10060')
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 5: 混合（1个缓存 + 1个未缓存）→ 发128074（不是128164），处理未缓存，发128076 ===
    await test('混合链接时走未缓存流程（发128074而非128164）', async () => {
        const descriptors = [
            { cacheKey: 'video|BVcached|123456', match: 'BVcached', type: 'video', id: 'BVcached' },
            { cacheKey: 'video|BVfresh|123456', match: 'BVfresh', type: 'video', id: 'BVfresh' }
        ]
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors
        })
        linkService.isCached = (key) => key.includes('cached')
        linkService.handleIncomingMessageLinks = async ({ descriptors: passedDescriptors }) => {
            assert.strictEqual(passedDescriptors, descriptors)
            return {
                allCached: false,
                foundCount: 2,
                skippedCachedCount: 1,
                successCount: 1,
                failureCount: 0,
                results: [{ status: 'cached' }, { status: 'sent_card' }]
            }
        }
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('BVcached BVfresh'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[emojiActions.length - 1].params.emoji_id, '128076')
    })

    // === 场景 6: 未缓存链接降级为文本也应视为成功 → 思考→撤销思考→OK ===
    await test('未缓存链接降级为文本时: 发128074→撤销128074→发128076', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: [{ cacheKey: 'video|BVfallback|123456', match: 'BVfallback', type: 'video', id: 'BVfallback' }]
        })
        linkService.isCached = () => false
        linkService.handleIncomingMessageLinks = async () => ({
            allCached: false,
            foundCount: 1,
            skippedCachedCount: 0,
            successCount: 1,
            failureCount: 0,
            results: [{ status: 'sent_fallback_text', renderStatus: 'fallback_text_ready' }]
        })
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BVfallback'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '128074')
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '128076')
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 7: 同一消息中两个相同 cacheKey 的链接只处理一次（回归测试）===
    await test('相同 cacheKey 的重复链接只处理一次', async () => {
        const dupLink = { cacheKey: 'video|BVdup|123456', match: 'BVdup', type: 'video', id: 'BVdup' }
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: [dupLink, dupLink]
        })
        linkService.isCached = () => false
        let receivedDescriptors = null
        linkService.handleIncomingMessageLinks = async ({ descriptors }) => {
            receivedDescriptors = descriptors
            return {
                allCached: false,
                foundCount: 2,
                skippedCachedCount: 1,
                successCount: 1,
                failureCount: 0,
                results: [{ status: 'sent_card' }]
            }
        }
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('BVdup BVdup'))
        assert.strictEqual(receivedDescriptors.length, 2, '高层入口应收到原始 descriptors，由 pipeline 负责去重')
    })

    // === 场景 8: prepare 在命令分发前执行，命令命中后不再进入真正链接处理 ===
    await test('命令消息会先执行 prepare，再由命令分发短路，不进入链接处理', async () => {
        const callOrder = []
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => {
            callOrder.push(['prepare', rawMessage])
            return {
                rawMessage: `${rawMessage} https://www.bilibili.com/video/BVcmd123`,
                safeRawMessage: `${rawMessage} https://www.bilibili.com/video/BVcmd123`,
                descriptors: [{ cacheKey: 'video|BVcmd123|123456', match: 'BVcmd123', type: 'video', id: 'BVcmd123' }]
            }
        }
        linkService.handleIncomingMessageLinks = async () => {
            throw new Error('命令命中后不应进入真正链接处理')
        }
        commandManager.dispatch = async ({ rawMessage }) => {
            callOrder.push(['dispatch', rawMessage])
            assert.ok(rawMessage.includes('https://www.bilibili.com/video/BVcmd123'))
            return true
        }

        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('/命令 原始文本'))
        assert.deepStrictEqual(callOrder, [
            ['prepare', '/命令 原始文本'],
            ['dispatch', '/命令 原始文本 https://www.bilibili.com/video/BVcmd123']
        ])
        assert.strictEqual(ws._getEmojiActions().length, 0)
    })

    // === 场景 9: 无链接时 AI 仍可处理（回归测试）===
    await test('无链接时不影响 AI 处理路径（shouldReply 被调用）', async () => {
        linkService.prepareIncomingMessageLinks = async ({ rawMessage }) => ({
            rawMessage,
            safeRawMessage: rawMessage,
            descriptors: []
        })
        let aiCalled = false
        replyGateService.evaluate = () => {
            aiCalled = true
            return { shouldReply: false, triggerLevel: 'ambient', busyMode: false, score: 0, reasons: ['test'] }
        }
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('你好'))
        assert.ok(aiCalled, 'replyGateService.evaluate 应该被调用')
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1) })
