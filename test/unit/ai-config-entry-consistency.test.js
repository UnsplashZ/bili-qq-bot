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
    aiCommand.sendGroupMessage = originals.aiCommandSend
    settingsCommand.sendGroupMessage = originals.settingsSend
}

async function testCommandsUseSameContextLimitRange() {
    config.isGroupAdmin = () => true
    config.isRootAdmin = () => true
    config.save = () => {}

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

async function run() {
    await testCommandsUseSameContextLimitRange()
    await testAiCommandRejectsDirtyProbabilityInput()
    await testApiRejectsUnknownAiField()
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
