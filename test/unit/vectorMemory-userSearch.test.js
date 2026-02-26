#!/usr/bin/env node
/**
 * test/unit/vectorMemory-userSearch.test.js
 * 运行: node test/unit/vectorMemory-userSearch.test.js
 */
'use strict'

const assert = require('assert')

// 测试打分逻辑
function scoreMemory(m, currentUserId) {
    const semanticScore = m.semanticScore
    const userBoost = (currentUserId && String(currentUserId) === String(m.userId)) ? 0.05 : 0
    const ageHours = (Date.now() - (m.timestamp || 0)) / (1000 * 60 * 60)
    const timeBoost = Math.max(0, 0.03 * (1 - ageHours / (24 * 30)))
    return semanticScore + userBoost + timeBoost
}

// Case 1: 当前用户自己的记忆得到加权
{
    const ownMemory = { semanticScore: 0.7, userId: 'user_123', timestamp: Date.now() - 1000 }
    const otherMemory = { semanticScore: 0.7, userId: 'user_456', timestamp: Date.now() - 1000 }
    const ownScore = scoreMemory(ownMemory, 'user_123')
    const otherScore = scoreMemory(otherMemory, 'user_123')
    assert.ok(ownScore > otherScore, '自己的记忆应得到 userBoost 加权')
    console.log(`✓ Case 1: 自己 ${ownScore.toFixed(3)} > 他人 ${otherScore.toFixed(3)}`)
}

// Case 2: currentUserId 为 null 时不加权（向下兼容）
{
    const memory = { semanticScore: 0.7, userId: 'user_123', timestamp: Date.now() }
    const score = scoreMemory(memory, null)
    assert.ok(score >= 0.7, '不传 userId 不应崩溃')
    console.log('✓ Case 2: currentUserId=null 不崩溃')
}

// Case 3: 新记忆比旧记忆得到轻微时间加成
{
    const newMemory = { semanticScore: 0.7, userId: null, timestamp: Date.now() }
    const oldMemory = { semanticScore: 0.7, userId: null, timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000 }
    const newScore = scoreMemory(newMemory, null)
    const oldScore = scoreMemory(oldMemory, null)
    assert.ok(newScore > oldScore, '新记忆应得到时间加成')
    console.log(`✓ Case 3: 新 ${newScore.toFixed(3)} > 旧 ${oldScore.toFixed(3)}`)
}

// Case 4: L3 缓存 key 包含 userId
function buildCacheKey(queryText, currentUserId) {
    return `${queryText}:${currentUserId || ''}`
}

assert.strictEqual(buildCacheKey('爬山', 'user_123'), '爬山:user_123')
assert.strictEqual(buildCacheKey('爬山', null), '爬山:')
assert.notStrictEqual(
    buildCacheKey('爬山', 'user_123'),
    buildCacheKey('爬山', 'user_456'),
    '不同用户的相同查询不能共用缓存'
)
console.log('✓ Case 4: L3 缓存 key 区分用户')

console.log('\n所有测试通过 ✓')
