#!/usr/bin/env node
/**
 * test/unit/userProfile-metadata.test.js
 * 运行: node test/unit/userProfile-metadata.test.js
 */
'use strict'

const assert = require('assert')

function applyRecordMessage(existing, userId, userName) {
    const now = Date.now()
    const entry = existing || {
        userId: String(userId),
        userName,
        totalMessages: 0,
        messagesSinceUpdate: 0,
        lastActiveTime: now,
        profile: null,
        lastUpdated: null
    }
    return {
        ...entry,
        userName,
        totalMessages: entry.totalMessages + 1,
        messagesSinceUpdate: entry.messagesSinceUpdate + 1,
        lastActiveTime: now
    }
}

function shouldGenerateProfile(entry, minMessages, updateInterval) {
    if (entry.totalMessages < minMessages) return false
    if (!entry.profile) return true
    return entry.messagesSinceUpdate >= updateInterval
}

// Case 1: 首次记录创建正确结构
{
    const entry = applyRecordMessage(null, '111', '张三')
    assert.strictEqual(entry.userId, '111')
    assert.strictEqual(entry.userName, '张三')
    assert.strictEqual(entry.totalMessages, 1)
    assert.strictEqual(entry.messagesSinceUpdate, 1)
    console.log('✓ Case 1: 首次记录创建正确')
}

// Case 2: 改名后 userName 更新
{
    const old = applyRecordMessage(null, '111', '张三')
    const updated = applyRecordMessage(old, '111', '张三改名了')
    assert.strictEqual(updated.userName, '张三改名了')
    assert.strictEqual(updated.totalMessages, 2)
    console.log('✓ Case 2: 改名后 userName 更新')
}

// Case 3: 画像触发条件
{
    const e1 = { totalMessages: 30, messagesSinceUpdate: 0, profile: null }
    assert.strictEqual(shouldGenerateProfile(e1, 30, 50), true, '首次达到 30 条应触发')
    const e2 = { totalMessages: 100, messagesSinceUpdate: 49, profile: '旧画像' }
    assert.strictEqual(shouldGenerateProfile(e2, 30, 50), false, '未到 50 条不触发')
    const e3 = { totalMessages: 100, messagesSinceUpdate: 50, profile: '旧画像' }
    assert.strictEqual(shouldGenerateProfile(e3, 30, 50), true, '到 50 条触发更新')
    console.log('✓ Case 3: 画像触发条件正确')
}

// Case 4: 私聊 groupId 跳过
{
    function shouldSkip(groupId) { return String(groupId).startsWith('private_') }
    assert.strictEqual(shouldSkip('private_12345'), true)
    assert.strictEqual(shouldSkip('987654321'), false)
    console.log('✓ Case 4: 私聊 groupId 跳过正确')
}

console.log('\n所有测试通过 ✓')
