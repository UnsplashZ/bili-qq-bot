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
}

function buildToken() {
    return jwt.sign(
        { role: 'admin', timestamp: Date.now() },
        config.jwtSecret,
        { expiresIn: '1h' }
    )
}

function restore() {
    config.isGroupAdmin = originals.isGroupAdmin
    config.isRootAdmin = originals.isRootAdmin
    config.save = originals.save
    config._performSave = originals.performSave
    aiCommand.sendGroupMessage = originals.aiCommandSend
    settingsCommand.sendGroupMessage = originals.settingsSend
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
    const app = express()
    app.use(express.json())
    app.use('/api', apiRouter)

    const token = buildToken()
    const res = await request(app)
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiUnknownField: 'x'
        })

    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.field, 'aiUnknownField')
    console.log('✓ /api/ai 拒绝未知字段（防 mass assignment）')
}

async function testApiConfigReturnsTimeoutDefaultsWithoutOverrides() {
    const app = express()
    app.use(express.json())
    app.use('/api', apiRouter)

    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    config.deleteKeys([
        'aiChatBaseTimeoutSeconds',
        'aiChatToolTimeoutSeconds',
        'aiChatMaxTimeoutSeconds'
    ])

    const res = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`)

    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(res.body.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(res.body.aiChatMaxTimeoutSeconds, 45)
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, '_overrides'))
    assert.ok(!Object.prototype.hasOwnProperty.call(res.body, '_saveTimer'))
    console.log('✓ /api/config 在默认态返回 AI 对话超时字段')
}

async function testApiResetClearsNewAiFields() {
    const app = express()
    app.use(express.json())
    app.use('/api', apiRouter)

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

    const res = await request(app)
        .post('/api/ai/reset')
        .set('Authorization', `Bearer ${token}`)
        .send({})

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

    const configRes = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`)

    assert.strictEqual(configRes.status, 200)
    assert.strictEqual(configRes.body.aiChatBaseTimeoutSeconds, 30)
    assert.strictEqual(configRes.body.aiChatToolTimeoutSeconds, 2)
    assert.strictEqual(configRes.body.aiChatMaxTimeoutSeconds, 45)
    console.log('✓ /api/ai/reset 会清理新增 AI 配置字段')
}

async function testApiAcceptsChatTimeoutFields() {
    const app = express()
    app.use(express.json())
    app.use('/api', apiRouter)

    const token = buildToken()
    config.save = () => {}
    config._performSave = async () => {}
    const res = await request(app)
        .post('/api/ai')
        .set('Authorization', `Bearer ${token}`)
        .send({
            aiChatBaseTimeoutSeconds: 60,
            aiChatToolTimeoutSeconds: 4,
            aiChatMaxTimeoutSeconds: 90
        })

    assert.strictEqual(res.status, 200)
    assert.strictEqual(config.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(config.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(config.aiChatMaxTimeoutSeconds, 90)
    assert.strictEqual(res.body.config.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(res.body.config.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(res.body.config.aiChatMaxTimeoutSeconds, 90)

    const configRes = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${token}`)

    assert.strictEqual(configRes.status, 200)
    assert.strictEqual(configRes.body.aiChatBaseTimeoutSeconds, 60)
    assert.strictEqual(configRes.body.aiChatToolTimeoutSeconds, 4)
    assert.strictEqual(configRes.body.aiChatMaxTimeoutSeconds, 90)
    console.log('✓ /api/ai 可保存对话超时字段')
}

async function run() {
    await testCommandsUseSameContextLimitRange()
    await testAiCommandRejectsDirtyProbabilityInput()
    await testApiRejectsUnknownAiField()
    await testApiConfigReturnsTimeoutDefaultsWithoutOverrides()
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
