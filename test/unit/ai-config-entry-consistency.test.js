#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    if (timer && typeof timer.unref === 'function') timer.unref()
    return timer
}
const apiRouter = require('../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const config = require('../../src/config')
const aiCommand = require('../../src/commands/ai')
const settingsCommand = require('../../src/commands/settings')

const originals = {
    isGroupAdmin: config.isGroupAdmin,
    isRootAdmin: config.isRootAdmin,
    save: config.save,
    performSave: config._performSave,
    aiCommandSend: aiCommand.sendGroupMessage,
    settingsSend: settingsCommand.sendGroupMessage,
    env: {
        AI_API_URL: process.env.AI_API_URL,
        AI_API_KEY: process.env.AI_API_KEY,
        AI_CHAT_API_URL: process.env.AI_CHAT_API_URL,
        AI_CHAT_API_KEY: process.env.AI_CHAT_API_KEY,
        AI_EMBEDDING_API_URL: process.env.AI_EMBEDDING_API_URL,
        AI_EMBEDDING_API_KEY: process.env.AI_EMBEDDING_API_KEY,
    },
}

function buildToken() {
    return jwt.sign(
        { role: 'admin', timestamp: Date.now() },
        config.jwtSecret,
        { expiresIn: '1h' }
    )
}

async function withApiServer(run) {
    const app = express()
    app.use(express.json())
    app.use('/api', apiRouter)

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance))
    })

    try {
        return await run(request(server))
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve()
            })
        })
    }
}

function restore() {
    config.isGroupAdmin = originals.isGroupAdmin
    config.isRootAdmin = originals.isRootAdmin
    config.save = originals.save
    config._performSave = originals.performSave
    aiCommand.sendGroupMessage = originals.aiCommandSend
    settingsCommand.sendGroupMessage = originals.settingsSend
    for (const [key, value] of Object.entries(originals.env)) {
        if (value === undefined) {
            delete process.env[key]
            continue
        }
        process.env[key] = value
    }
}

function restoreAiOverrides() {
    config.deleteKeys([
        'aiApiUrl',
        'aiApiKey',
        'aiChatApiUrl',
        'aiChatApiKey',
        'aiChatModel',
        'aiChatProxy',
        'aiChatSystemPrompt',
        'aiChatBaseTimeoutSeconds',
        'aiChatToolTimeoutSeconds',
        'aiChatMaxTimeoutSeconds',
        'aiEmbeddingApiUrl',
        'aiEmbeddingApiKey',
        'aiEmbeddingModel',
        'aiEmbeddingProxy',
        'aiProbability',
        'aiContextLimit',
        'aiTemperature',
        'aiHistoryMaxSize',
        'aiEnableVectorCache',
        'aiVectorSimilarityThreshold',
        'aiVectorSearchLimit',
        'aiMemorySafetyLimit',
        'aiEnabled',
        'aiRagEnabled',
        'aiProfileEnabled'
    ])
}

async function testCommandsUseSameContextLimitRange() {
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    config.save = () => {}
    config._performSave = async () => {}

    const aiReplies = []
    aiCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        aiReplies.push(chain?.[0]?.data?.text || '')
    }

    await aiCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/AI 上下文 0'
    })
    await aiCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/AI 上下文 101'
    })

    assert.ok(aiReplies.every(text => text.includes('1-100')))

    const settingReplies = []
    settingsCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        settingReplies.push(chain?.[0]?.data?.text || '')
    }
    await settingsCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/设置 AI上下文 0'
    })
    await settingsCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/设置 AI上下文 101'
    })
    assert.ok(settingReplies.every(text => text.includes('1-100')))

    console.log('✓ 命令入口对 aiContextLimit 的范围约束一致')
}

async function testAiCommandRejectsDirtyProbabilityInput() {
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    config.save = () => {}
    config._performSave = async () => {}

    const aiReplies = []
    aiCommand.sendGroupMessage = (_ws, _groupId, chain) => {
        aiReplies.push(chain?.[0]?.data?.text || '')
    }

    await aiCommand.handle({
        ws: {},
        groupId: '1000',
        userId: '42',
        rawMessage: '/AI 概率 0.3abc'
    })

    assert.ok(aiReplies.some(text => text.includes('格式错误')))
    console.log('✓ /AI 概率 拒绝脏输入（严格数值解析）')
}

async function testApiRejectsUnknownAiField() {
    const token = buildToken()
    const res = await withApiServer((client) => client
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiUnknownField: 'x'
        }))

    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.field, 'aiUnknownField')
    console.log('✓ /api/ai 拒绝未知字段（防 mass assignment）')
}

async function testApiConfigReturnsTimeoutDefaultsWithoutOverrides() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    config.deleteKeys([
        'aiChatBaseTimeoutSeconds',
        'aiChatToolTimeoutSeconds',
        'aiChatMaxTimeoutSeconds'
    ])

    const res = await withApiServer((client) => client
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`))

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(res.body.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(res.body.aiChatMaxTimeoutSeconds, 45)
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, '_overrides'))
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, '_saveTimer'))
    console.log('✓ /api/config 在默认态返回 AI 对话超时字段')
}

async function testApiConfigMasksEnvBackedSensitiveFields() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    restoreAiOverrides()
    delete process.env.AI_API_URL
    delete process.env.AI_API_KEY
    delete process.env.AI_EMBEDDING_API_URL
    delete process.env.AI_EMBEDDING_API_KEY
    process.env.AI_CHAT_API_KEY = 'sk-env-chat'

    const res = await withApiServer((client) => client
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`))

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.aiChatApiKey, '')
    assert.strictEqual(res.body.aiEditorMeta.aiChatApiKey.source, 'env')
    assert.strictEqual(res.body.aiEditorMeta.aiChatApiKey.configured, true)
    assert.strictEqual(res.body.aiEditorMeta.aiChatApiKey.masked, true)
    console.log('✓ /api/config 不回显来自环境变量的敏感 AI 字段')
}

async function testApiResetClearsNewAiFields() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}

    config.aiReplyGateEnabled = false
    config.aiContextSelectorEnabled = false
    config.aiResponseModeEnabled = false
    config.aiPromptAssemblerEnabled = false
    config.aiReplyScoreThreshold = 66
    config.aiBusyReplyScoreThreshold = 99
    config.aiBusyWindowSeconds = 30
    config.aiBusyMessageCount = 88
    config.aiReplyCooldownMs = 25000
    config.aiMaxRepliesPerWindow = 7
    config.aiBotName = '临时机器人'
    config.aiBotAliases = ['临时别名']
    config.aiChatBaseTimeoutSeconds = 90
    config.aiChatToolTimeoutSeconds = 5
    config.aiChatMaxTimeoutSeconds = 120

    const res = await withApiServer((client) => client
        .post('/api/ai/reset')
        .set('Authorization', `Bearer ${token}`)
        .send({}))

    assert.strictEqual(res.status, 200)
    assert.strictEqual(config.aiReplyGateEnabled, true)
    assert.strictEqual(config.aiContextSelectorEnabled, true)
    assert.strictEqual(config.aiResponseModeEnabled, true)
    assert.strictEqual(config.aiPromptAssemblerEnabled, true)
    assert.strictEqual(config.aiReplyScoreThreshold, 45)
    assert.strictEqual(config.aiBusyReplyScoreThreshold, 80)
    assert.strictEqual(config.aiBusyWindowSeconds, 10)
    assert.strictEqual(config.aiBusyMessageCount, 12)
    assert.strictEqual(config.aiReplyCooldownMs, 15000)
    assert.strictEqual(config.aiMaxRepliesPerWindow, 3)
    assert.strictEqual(config.aiBotName, '')
    assert.deepStrictEqual(config.aiBotAliases, [])
    assert.strictEqual(config.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(config.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(config.aiChatMaxTimeoutSeconds, 45)

    const configRes = await withApiServer((client) => client
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`))

    assert.strictEqual(configRes.status, 200)
    assert.strictEqual(configRes.body.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(configRes.body.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(configRes.body.aiChatMaxTimeoutSeconds, 45)
    console.log('✓ /api/ai/reset 会清理新增 AI 配置字段')
}

async function testApiAcceptsChatTimeoutFields() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    const res = await withApiServer((client) => client
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiChatBaseTimeoutSeconds: 60,
            aiChatToolTimeoutSeconds: 4,
            aiChatMaxTimeoutSeconds: 90
        }))

    assert.strictEqual(res.status, 200)
    assert.strictEqual(config.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(config.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(config.aiChatMaxTimeoutSeconds, 90)
    assert.strictEqual(res.body.config.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(res.body.config.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(res.body.config.aiChatMaxTimeoutSeconds, 90)

    const configRes = await withApiServer((client) => client
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`))

    assert.strictEqual(configRes.status, 200)
    assert.strictEqual(configRes.body.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(configRes.body.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(configRes.body.aiChatMaxTimeoutSeconds, 90)
    console.log('✓ /api/ai 可保存对话超时字段')
}

async function testApiAiPatchDoesNotPersistEnvBackedSensitiveFields() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    restoreAiOverrides()
    delete process.env.AI_API_URL
    delete process.env.AI_API_KEY
    delete process.env.AI_CHAT_API_URL
    process.env.AI_CHAT_API_KEY = 'sk-env-chat'

    const res = await withApiServer((client) => client
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiChatToolTimeoutSeconds: 4
        }))

    assert.strictEqual(res.status, 200)
    assert.strictEqual(config.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(config.aiChatApiKey, 'sk-env-chat')
    assert.ok(!Object.prototype.hasOwnProperty.call(config._overrides, 'aiChatApiKey'))
    assert.strictEqual(res.body.config.aiChatApiKey, '')
    assert.strictEqual(res.body.config.aiEditorMeta.aiChatApiKey.source, 'env')
    console.log('✓ /api/ai 保存普通字段时不会把环境变量敏感值写入 override')
}

async function testApiAiAllowsClearingSensitiveOverrides() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    restoreAiOverrides()
    delete process.env.AI_CHAT_API_KEY
    process.env.AI_API_KEY = 'sk-env-general'
    config.aiChatApiKey = 'sk-override-chat'

    const res = await withApiServer((client) => client
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiChatApiKey: null
        }))

    assert.strictEqual(res.status, 200)
    assert.ok(!Object.prototype.hasOwnProperty.call(config._overrides, 'aiChatApiKey'))
    assert.strictEqual(config.aiChatApiKey, 'sk-env-general')
    assert.strictEqual(res.body.config.aiChatApiKey, '')
    assert.strictEqual(res.body.config.aiEditorMeta.aiChatApiKey.source, 'env')
    assert.strictEqual(res.body.config.aiEditorMeta.aiChatApiKey.inheritedFrom, 'aiApiKey')
    console.log('✓ /api/ai 支持清除敏感字段 override 并回退到默认来源')
}

async function testApplyOverridePatchTriggersSingleSave() {
    const originalApplyOverridePatch = config.applyOverridePatch
    let saveCallCount = 0
    config.save = () => {
        saveCallCount += 1
    }
    config._performSave = async () => {}
    restoreAiOverrides()
    saveCallCount = 0

    originalApplyOverridePatch.call(config, {
        clear: ['aiChatApiKey'],
        set: {
            aiChatToolTimeoutSeconds: 9
        }
    })

    assert.strictEqual(saveCallCount, 1)
    assert.ok(!Object.prototype.hasOwnProperty.call(config._overrides, 'aiChatApiKey'))
    assert.strictEqual(config._overrides.aiChatToolTimeoutSeconds, 9)
    console.log('✓ applyOverridePatch 只触发一次保存调度')
}

async function testApiAiCanClearAndUpdateInSinglePatch() {
    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    restoreAiOverrides()
    process.env.AI_API_KEY = 'sk-env-general'
    delete process.env.AI_CHAT_API_KEY
    config.aiChatApiKey = 'sk-override-chat'
    config.aiChatToolTimeoutSeconds = 2

    const res = await withApiServer((client) => client
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiChatApiKey: null,
            aiChatToolTimeoutSeconds: 8
        }))

    assert.strictEqual(res.status, 200)
    assert.ok(!Object.prototype.hasOwnProperty.call(config._overrides, 'aiChatApiKey'))
    assert.strictEqual(config._overrides.aiChatToolTimeoutSeconds, 8)
    assert.strictEqual(config.aiChatApiKey, 'sk-env-general')
    assert.strictEqual(config.aiChatToolTimeoutSeconds, 8)
    console.log('✓ /api/ai 可在一次 patch 中同时清除 override 并更新其他字段')
}

async function run() {
    await testCommandsUseSameContextLimitRange()
    await testAiCommandRejectsDirtyProbabilityInput()
    await testApiRejectsUnknownAiField()
    await testApiConfigReturnsTimeoutDefaultsWithoutOverrides()
    await testApiConfigMasksEnvBackedSensitiveFields()
    await testApiAiPatchDoesNotPersistEnvBackedSensitiveFields()
    await testApiAiAllowsClearingSensitiveOverrides()
    await testApplyOverridePatchTriggersSingleSave()
    await testApiAiCanClearAndUpdateInSinglePatch()
    await testApiAcceptsChatTimeoutFields()
    await testApiResetClearsNewAiFields()
}

run()
    .then(() => {
        process.exit(0)
    })
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
