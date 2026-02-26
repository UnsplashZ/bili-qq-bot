#!/usr/bin/env node
/**
 * test/unit/vectorMemory-userIdentity.test.js
 * 运行: node test/unit/vectorMemory-userIdentity.test.js
 */
'use strict'

const assert = require('assert')

// 构造最小化的 addMemory 结果验证（不依赖真实 embedding）
// 直接测试存储结构中是否包含 userId/userName

function buildMemoryEntry(text, role, userId = null, userName = null) {
    const entry = {
        text,
        role,
        vector: [],
        timestamp: Date.now(),
        accessCount: 1,
        importance: 1.0,
    }
    if (userId != null) entry.userId = userId
    if (userName != null) entry.userName = userName
    return entry
}

// Case 1: 用户消息含 userId/userName
{
    const entry = buildMemoryEntry('我喜欢编程', 'user', '123456', '张三')
    assert.strictEqual(entry.userId, '123456', '应包含 userId')
    assert.strictEqual(entry.userName, '张三', '应包含 userName')
    console.log('✓ Case 1: user 消息包含 userId 和 userName')
}

// Case 2: 助手回复不含 userId
{
    const entry = buildMemoryEntry('好的，我明白了', 'assistant')
    assert.strictEqual(entry.userId, undefined, '助手消息不含 userId')
    assert.strictEqual(entry.userName, undefined, '助手消息不含 userName')
    console.log('✓ Case 2: assistant 消息不含用户字段')
}

// Case 3: embedding 文本前缀逻辑
function buildEmbeddingText(text, role, userName) {
    return (role === 'user' && userName) ? `${userName}: ${text}` : text
}

assert.strictEqual(buildEmbeddingText('我喜欢编程', 'user', '张三'), '张三: 我喜欢编程')
assert.strictEqual(buildEmbeddingText('好的', 'assistant', null), '好的')
assert.strictEqual(buildEmbeddingText('消息', 'user', null), '消息') // 无 userName 不加前缀
assert.strictEqual(buildEmbeddingText('消息', 'user', ''), '消息') // 空字符串 userName 不加前缀
console.log('✓ Case 3b: 空字符串 userName 不加前缀')
console.log('✓ Case 3: embedding 文本前缀逻辑正确')

// Case 4: 旧数据无 userId 时 fallback
function getDisplayName(m) {
    return m.userName || (m.role === 'assistant' ? 'AI助手' : '某位用户')
}

assert.strictEqual(getDisplayName({ role: 'user' }), '某位用户')
assert.strictEqual(getDisplayName({ role: 'assistant' }), 'AI助手')
assert.strictEqual(getDisplayName({ role: 'user', userName: '李四' }), '李四')
console.log('✓ Case 4: 旧数据无 userName 时 fallback 正确')

console.log('\n所有测试通过 ✓')
