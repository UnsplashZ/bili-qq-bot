# 链接解析状态表情反馈 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 当用户消息触发 Bilibili 链接解析时，bot 通过贴表情方式反馈处理状态（思考中/完成/失败/冷却中）。

**Architecture:** 仅修改 `src/handlers/messageHandler.js`，新增 `sendEmojiReaction()` 辅助方法，并重构 `handleMessage()` 内的链接处理段。通过 NapCat `set_msg_emoji_like` API 发送/撤销表情。

**Tech Stack:** Node.js, WebSocket (ws), NapCat OneBot v11 API

---

## 表情 ID 对照表

| 状态 | ID | 含义 |
|------|-----|------|
| 处理中（思考） | `66` | 让我想想 💭 |
| 处理成功 | `76` | OK 👌 |
| 处理失败 | `5` | 流泪 😢 |
| 冷却期内（已缓存）| `21` | 嘘 🤫 |

---

## 完整流程

```
消息含 Bilibili 链接？
         ↓ 是
  有未缓存链接？
  ↙               ↘
 是                否（全部冷却中）
 ↓                       ↓
发 66（思考）         发 21（嘘）→ return
 ↓
处理未缓存链接（保留原有错误处理与延迟逻辑）
 ↓
有报错？
 ↙        ↘
 是         否
 ↓           ↓
撤销 66     撤销 66
发 5        发 76
 ↓           ↓
        return
```

---

## 关键约束（不得破坏现有功能）

1. **AI 处理**：无链接时仍继续到 AI 回复逻辑（`aiHandler.shouldReply` 不受影响）
2. **错误提示文字**：处理失败时仍发送错误文字提示（现有逻辑保留）
3. **链接缓存逻辑**：成功后调用 `linkHandler.addLinkToCache()`，失败不加缓存（保持不变）
4. **链接间延迟**：多个未缓存链接之间仍保留 1000ms 延迟（调整为仅在未缓存链接之间）
5. **私聊消息**：私聊走 `groupId = private_xxx` 虚拟群，`message_id` 可能不适用表情 API；`sendEmojiReaction` 需防御性处理（messageId 为空时静默跳过）

---

## Task 1: 新增 `sendEmojiReaction` 辅助方法并测试

**Files:**
- Modify: `src/handlers/messageHandler.js`（在 `sendPrivateMessage` 方法后面，约第 32 行后）
- Create: `test/unit/messageHandler-emojiReaction.test.js`

---

**Step 1: 写失败测试**

创建 `test/unit/messageHandler-emojiReaction.test.js`：

```javascript
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
// MessageHandler 是单例，直接 require 即可
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
        // 不应抛出
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

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(e => { console.error(e); process.exit(1) })
```

**Step 2: 运行测试确认失败**

```bash
node test/unit/messageHandler-emojiReaction.test.js
```

预期输出：`❌ FAIL: WebSocket 开启时发送正确的 JSON`（方法不存在）

---

**Step 3: 在 `messageHandler.js` 中实现 `sendEmojiReaction`**

在 `sendPrivateMessage` 方法（第31行）之后、`handleMessage` 方法之前插入：

```javascript
sendEmojiReaction(ws, messageId, emojiId, set = true) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logger.warn('[MessageHandler] Cannot send emoji reaction: WebSocket not open')
        return
    }
    if (!messageId) {
        logger.warn('[MessageHandler] Cannot send emoji reaction: no messageId')
        return
    }
    ws.send(JSON.stringify({
        action: 'set_msg_emoji_like',
        params: {
            message_id: messageId,
            emoji_id: String(emojiId),
            set: set
        }
    }))
}
```

**Step 4: 运行测试确认通过**

```bash
node test/unit/messageHandler-emojiReaction.test.js
```

预期输出：5 passed, 0 failed

**Step 5: Commit**

```bash
git add src/handlers/messageHandler.js test/unit/messageHandler-emojiReaction.test.js
git commit -m "feat: 新增 sendEmojiReaction 辅助方法"
```

---

## Task 2: 重构链接处理段，加入表情反馈逻辑

**Files:**
- Modify: `src/handlers/messageHandler.js`（`handleMessage` 内，第 187–248 行）
- Create: `test/unit/messageHandler-linkReaction.test.js`

---

**Step 1: 写失败测试**

创建 `test/unit/messageHandler-linkReaction.test.js`：

```javascript
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
const origShouldReply = aiHandler.shouldReply.bind(aiHandler)
aiHandler.shouldReply = () => false  // 禁止 AI 处理

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
    console.log('\n=== 链接处理表情反馈逻辑测试 ===\n')

    // === 场景 1: 无链接 → 无表情 ===
    await test('无 Bilibili 链接时不发送任何表情', async () => {
        linkHandler.extractLinks = () => []
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('普通消息，没有链接'))
        assert.strictEqual(ws._getEmojiActions().length, 0)
    })

    // === 场景 2: 全部链接在冷却中 → 发 21（嘘） ===
    await test('全部链接在冷却期内时发送嘘表情(21)并返回', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV123|123456', match: 'BV123' }]
        linkHandler.isLinkCached = () => true  // 全部缓存
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV123'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 1)
        assert.strictEqual(emojiActions[0].params.emoji_id, '21')
        assert.strictEqual(emojiActions[0].params.set, true)
    })

    // === 场景 3: 有未缓存链接且成功 → 思考→撤销思考→OK ===
    await test('未缓存链接处理成功时: 发66→撤销66→发76', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV456|123456', match: 'BV456', type: 'video', id: 'BV456' }]
        linkHandler.isLinkCached = () => false
        linkHandler.processSingleLink = async () => {}  // 模拟成功
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV456'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '66')  // thinking
        assert.strictEqual(emojiActions[0].params.set, true)
        assert.strictEqual(emojiActions[1].params.emoji_id, '66')  // remove thinking
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '76')  // done
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 4: 有未缓存链接但失败 → 思考→撤销思考→流泪 ===
    await test('未缓存链接处理失败时: 发66→撤销66→发5', async () => {
        linkHandler.extractLinks = () => [{ cacheKey: 'video|BV789|123456', match: 'BV789', type: 'video', id: 'BV789' }]
        linkHandler.isLinkCached = () => false
        linkHandler.processSingleLink = async () => { throw new Error('解析失败') }
        linkHandler.sendGroupMessage = async () => {}  // mock 错误文字发送
        linkHandler.addLinkToCache = () => {}
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('https://bilibili.com/video/BV789'))
        const emojiActions = ws._getEmojiActions()
        assert.strictEqual(emojiActions.length, 3)
        assert.strictEqual(emojiActions[0].params.emoji_id, '66')  // thinking
        assert.strictEqual(emojiActions[1].params.emoji_id, '66')  // remove thinking
        assert.strictEqual(emojiActions[1].params.set, false)
        assert.strictEqual(emojiActions[2].params.emoji_id, '5')   // crying
        assert.strictEqual(emojiActions[2].params.set, true)
    })

    // === 场景 5: 混合（1个缓存 + 1个未缓存）→ 发66（不是21），处理未缓存，发76 ===
    await test('混合链接时走未缓存流程（发66而非21）', async () => {
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
        // 第一个表情必须是 66（思考），而不是 21（嘘）
        assert.strictEqual(emojiActions[0].params.emoji_id, '66')
        // 最终表情是 76（成功）
        assert.strictEqual(emojiActions[emojiActions.length - 1].params.emoji_id, '76')
    })

    // === 场景 6: 无链接时 AI 仍可处理（回归测试）===
    await test('无链接时不影响 AI 处理路径（shouldReply 被调用）', async () => {
        linkHandler.extractLinks = () => []
        let aiCalled = false
        aiHandler.shouldReply = () => { aiCalled = true; return false }
        const ws = makeMockWs()
        await handler.handleMessage(ws, makeMessageData('你好'))
        assert.ok(aiCalled, 'aiHandler.shouldReply 应该被调用')
        aiHandler.shouldReply = () => false  // 还原
    })

    console.log(`\n结果: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(e => { console.error(e); process.exit(1) })
```

**Step 2: 运行测试确认失败**

```bash
node test/unit/messageHandler-linkReaction.test.js
```

预期：场景 2-5 FAIL（尚未实现），场景 1 和 6 PASS

---

**Step 3: 重构 `handleMessage` 内的链接处理段**

将 `messageHandler.js` 第 187–248 行（`// ========== Link Processing ==========` 到 `if (hasProcessedLinks) { return; }` 段）替换为：

```javascript
// ========== Link Processing ==========
const safeRawMessage = rawMessage.replace(/\[CQ:[^\]]+\]/g, '');
const links = linkHandler.extractLinks(safeRawMessage, groupId);

if (links.length > 0) {
    const messageId = messageData.message_id;
    const uncachedLinks = links.filter(l => !linkHandler.isLinkCached(l.cacheKey));

    if (uncachedLinks.length === 0) {
        // 全部链接在冷却期内
        this.sendEmojiReaction(ws, messageId, '21');
        return;
    }

    // 有未缓存链接，开始处理
    this.sendEmojiReaction(ws, messageId, '66');  // 思考中

    let hasErrors = false;

    for (const link of uncachedLinks) {
        let processSuccess = false;

        try {
            await linkHandler.processSingleLink(link, ws, groupId, userId);
            processSuccess = true;
            logger.debug(`[MessageHandler] Successfully processed link: ${link.match}`);
        } catch (error) {
            logger.error(`[MessageHandler] Failed to process link ${link.match}:`, {
                error: error.message,
                stack: error.stack,
                groupId,
                userId,
                linkType: link.type,
                linkId: link.id
            });
            hasErrors = true;

            // 不添加到缓存，允许用户重试
            // 向用户发送错误提示
            try {
                await linkHandler.sendGroupMessage(ws, groupId, [
                    {
                        type: 'text',
                        data: {
                            text: `处理链接失败: ${error.message || '未知错误'}\n您可以稍后重新发送链接重试`
                        }
                    }
                ], userId);
            } catch (sendError) {
                logger.error('[MessageHandler] Failed to send error message:', sendError);
            }
        }

        // 只在成功处理后添加到缓存
        if (processSuccess) {
            linkHandler.addLinkToCache(link.cacheKey);
            logger.debug(`[MessageHandler] Added link to cache: ${link.cacheKey}`);
        }

        // 处理完成后延迟，避免并发冲突
        const linkIndex = uncachedLinks.indexOf(link);
        if (linkIndex < uncachedLinks.length - 1) {
            logger.info(`[MessageHandler] Waiting 1000ms before processing next link to avoid conflicts...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // 撤销思考表情，发送结果表情
    this.sendEmojiReaction(ws, messageId, '66', false);  // 撤销思考
    if (hasErrors) {
        this.sendEmojiReaction(ws, messageId, '5');   // 流泪（失败）
    } else {
        this.sendEmojiReaction(ws, messageId, '76');  // OK（完成）
    }

    return;
}
```

> **注意**：原代码中 `if (hasProcessedLinks) { return; }` 已被新的 `if (links.length > 0) { ... return; }` 结构替代，`hasProcessedLinks` 变量可一并删除。

**Step 4: 运行全部测试**

```bash
node test/unit/messageHandler-linkReaction.test.js
node test/unit/messageHandler-emojiReaction.test.js
```

预期：全部 PASS

**Step 5: Commit**

```bash
git add src/handlers/messageHandler.js test/unit/messageHandler-linkReaction.test.js
git commit -m "feat: 链接解析时发送状态表情反馈（思考/完成/失败/冷却）"
```

---

## 回归验证清单

完成后手动检查以下场景确认无回归：

- [ ] 发送无 Bilibili 链接的消息 → bot 不回表情，AI 正常回复（若开启）
- [ ] 发送 BV 链接（未缓存）→ 先出现"让我想想"表情，完成后变"OK"
- [ ] 同一链接短时间内再次发送（冷却中）→ 直接出现"嘘"表情
- [ ] 发送无效 Bilibili 链接（解析会失败）→ 先出现"让我想想"，失败后出现"流泪"
- [ ] 命令消息（/菜单 等）→ 无表情，命令正常执行
- [ ] 私聊消息 → `sendEmojiReaction` 内 messageId 防御处理不抛异常

---

## 行为变更说明

与现有版本相比，有一处微小的行为变更：

- **原行为**：消息含 Bilibili 链接但全部在冷却期内时，会继续走 AI 回复逻辑
- **新行为**：消息含 Bilibili 链接（无论缓存与否）时，都会 `return`，不再走 AI 回复

这是符合预期的改进：链接消息不应同时触发 AI 回复。
