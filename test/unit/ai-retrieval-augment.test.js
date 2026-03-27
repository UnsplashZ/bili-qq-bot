#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { collectAugments, getRagSearchOptions } = require('../../src/services/ai/retrievalAugmentService')

async function testGetRagSearchOptions() {
    assert.deepStrictEqual(getRagSearchOptions('self_identity', '2402855757', 'strict'), {
        strictUserId: '2402855757',
        crossUserPenalty: 0.2
    })
    assert.deepStrictEqual(getRagSearchOptions('self_identity', '2402855757', 'normal'), {
        crossUserPenalty: 0.08
    })
    assert.deepStrictEqual(getRagSearchOptions('bot_identity', '2402855757', 'strict'), {
        includeRoles: ['assistant']
    })
    assert.deepStrictEqual(getRagSearchOptions('admin_action', '2402855757', 'strict'), {
        crossUserPenalty: 0.12
    })
    console.log('✓ getRagSearchOptions 与现有语义一致')
}

async function testCollectAugments() {
    const calls = []
    const result = await collectAugments({
        contextKey: '1065812436',
        groupId: '1065812436',
        userId: '2402855757',
        currentSpeakerId: '2402855757',
        currentText: '我是谁',
        context: [{ role: 'user', userId: '2402855757', speakerId: '2402855757' }],
        intentType: 'self_identity',
        ragMode: 'strict',
        profileEnabled: true,
        structuredSelectedContext: null,
        vectorSearch: async (contextKey, currentText, limit, userId, options) => {
            calls.push(['vectorSearch', contextKey, currentText, limit, userId, options])
            return [{ role: 'user', userName: '张三', text: '你记得我', timestamp: Date.now() }]
        },
        getActiveProfiles: async (contextKey, userIds) => {
            calls.push(['getActiveProfiles', contextKey, userIds])
            return [{ userName: '张三', profile: '喜欢直接一点' }]
        },
        isRagEnabledForGroup: () => true,
        log: () => {}
    })

    assert.strictEqual(result.memories.length, 1)
    assert.ok(result.profileText.includes('张三: 喜欢直接一点'))
    assert.strictEqual(result.ragEnabled, true)
    assert.deepStrictEqual(result.hybridSearchOptions, { strictUserId: '2402855757', crossUserPenalty: 0.2 })
    assert.deepStrictEqual(calls[0][5], { strictUserId: '2402855757', crossUserPenalty: 0.2 })
    console.log('✓ collectAugments 会收集 memories、profiles，并输出主链路一致的 hybrid 参数')
}

async function testRagFailureIsBestEffort() {
    const logs = []
    const result = await collectAugments({
        contextKey: '1065812436',
        groupId: '1065812436',
        userId: '2402855757',
        currentSpeakerId: '2402855757',
        currentText: '我是谁',
        context: [{ role: 'user', userId: '2402855757', speakerId: '2402855757' }],
        intentType: 'self_identity',
        ragMode: 'strict',
        profileEnabled: true,
        structuredSelectedContext: null,
        vectorSearch: async () => {
            throw new Error('vector down')
        },
        getActiveProfiles: async () => [{ userName: '张三', profile: '喜欢直接一点' }],
        isRagEnabledForGroup: () => true,
        log: (level, message, fields = {}) => logs.push({ level, message, fields })
    })

    assert.deepStrictEqual(result.memories, [])
    assert.ok(result.profileText.includes('张三: 喜欢直接一点'))
    assert.ok(logs.some(entry => entry.message === 'rag-failed' && entry.fields.error === 'vector down'))
    console.log('✓ collectAugments 在 RAG 失败时会降级并保留其它增强信息')
}

async function testProfileFailureIsBestEffort() {
    const logs = []
    const result = await collectAugments({
        contextKey: '1065812436',
        groupId: '1065812436',
        userId: '2402855757',
        currentSpeakerId: '2402855757',
        currentText: '你好',
        context: [{ role: 'user', userId: '2402855757', speakerId: '2402855757' }],
        intentType: 'general',
        ragMode: 'strict',
        profileEnabled: true,
        structuredSelectedContext: null,
        vectorSearch: async () => [{ role: 'user', userName: '张三', text: '你记得我', timestamp: Date.now() }],
        getActiveProfiles: async () => {
            throw new Error('profile store broken')
        },
        isRagEnabledForGroup: () => true,
        log: (level, message, fields = {}) => logs.push({ level, message, fields })
    })

    assert.strictEqual(result.memories.length, 1)
    assert.strictEqual(result.profileText, '')
    assert.ok(logs.some(entry => entry.message === 'profile-injection-failed' && entry.fields.error === 'profile store broken'))
    console.log('✓ collectAugments 在画像注入失败时会降级并保留 memories')
}

async function testBotIdentityStrictDisablesRag() {
    const result = await collectAugments({
        contextKey: '1065812436',
        groupId: '1065812436',
        userId: '2402855757',
        currentSpeakerId: '2402855757',
        currentText: '你是谁',
        context: [],
        intentType: 'bot_identity',
        ragMode: 'strict',
        profileEnabled: true,
        structuredSelectedContext: null,
        vectorSearch: async () => {
            throw new Error('should not call vectorSearch')
        },
        getActiveProfiles: async () => [{ userName: '张三', profile: '喜欢直接一点' }],
        isRagEnabledForGroup: () => true,
        log: () => {}
    })
    assert.strictEqual(result.ragEnabled, false)
    assert.deepStrictEqual(result.memories, [])
    assert.strictEqual(result.profileText, '')
    console.log('✓ bot_identity + strict 会禁用 RAG 和 profile 注入')
}

async function run() {
    await testGetRagSearchOptions()
    await testCollectAugments()
    await testRagFailureIsBestEffort()
    await testProfileFailureIsBestEffort()
    await testBotIdentityStrictDisablesRag()
}

run().then(() => process.exit(0)).catch((error) => {
    console.error(error)
    process.exit(1)
})
