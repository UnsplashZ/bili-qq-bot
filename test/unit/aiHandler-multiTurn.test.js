#!/usr/bin/env node
/**
 * test/unit/aiHandler-multiTurn.test.js
 * 运行: node test/unit/aiHandler-multiTurn.test.js
 */
'use strict'

const assert = require('assert')

// 测试辅助函数（从 aiHandler 提取的纯逻辑）

function sanitizeName(userId) {
    if (!userId) return undefined
    return `user_${userId}`
}

function buildHistoryMessages(historyMessages, cleanMessageFn) {
    return historyMessages.map(msg => {
        const msgObj = {
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.role === 'assistant'
                ? cleanMessageFn(msg.content)
                : `[${msg.userName || '用户'}] ${cleanMessageFn(msg.content)}`
        }
        const name = sanitizeName(msg.userId)
        if (name && msg.role !== 'assistant') msgObj.name = name
        return msgObj
    })
}

const identity = s => s  // 模拟 cleanMessage

// Case 1: name 字段格式符合 API 要求
{
    const name = sanitizeName('123456789')
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(name), 'name 字段应只含合法字符')
    assert.ok(name.length <= 64, 'name 字段不超过 64 字符')
    assert.strictEqual(name, 'user_123456789')
    console.log('✓ Case 1: sanitizeName 格式正确')
}

// Case 2: userId 为 null 时返回 undefined
{
    assert.strictEqual(sanitizeName(null), undefined)
    assert.strictEqual(sanitizeName(undefined), undefined)
    console.log('✓ Case 2: sanitizeName(null) 返回 undefined')
}

// Case 3: user 消息 content 有 [用户名] 前缀，有 name 字段
{
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '111', userName: '张三', content: '今天天气不错', timestamp: Date.now() }
    ], identity)
    assert.ok(msgs[0].content.startsWith('[张三]'), 'user 消息应有 [用户名] 前缀')
    assert.strictEqual(msgs[0].name, 'user_111')
    console.log('✓ Case 3: user 消息有 [用户名] 前缀和 name 字段')
}

// Case 4: assistant 消息无 [用户名] 前缀，无 name 字段
{
    const msgs = buildHistoryMessages([
        { role: 'assistant', content: '你好！', timestamp: Date.now() }
    ], identity)
    assert.ok(!msgs[0].content.startsWith('['), 'assistant 消息不应有 [前缀]')
    assert.strictEqual(msgs[0].name, undefined, 'assistant 消息不应有 name 字段')
    console.log('✓ Case 4: assistant 消息无前缀无 name 字段')
}

// Case 5: userName 缺失时降级为 "用户"
{
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '999', content: '测试', timestamp: Date.now() }
    ], identity)
    assert.ok(msgs[0].content.startsWith('[用户]'), '无 userName 时降级为 [用户]')
    console.log('✓ Case 5: 无 userName 时降级为 [用户]')
}

// Case 6: content 中不含双重转义
{
    const raw = '这里有"引号"和\\反斜杠'
    const msgs = buildHistoryMessages([
        { role: 'user', userId: '111', userName: '张三', content: raw, timestamp: Date.now() }
    ], identity)
    assert.ok(!msgs[0].content.includes('\\\\'), '不应双重转义反斜杠')
    assert.ok(!msgs[0].content.includes('\\"'), '不应双重转义引号')
    console.log('✓ Case 6: content 无双重转义')
}

console.log('\n所有测试通过 ✓')
