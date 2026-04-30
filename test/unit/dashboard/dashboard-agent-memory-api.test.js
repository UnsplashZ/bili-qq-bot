#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')

const agentMemoryRoutes = require('../../../src/dashboard/routes/api/modules/agent-memory')
const expressionStore = require('../../../src/agent/expression/expressionStore')
const personProfileStore = require('../../../src/agent/memory/personProfileStore')
const replyEffectStore = require('../../../src/agent/feedback/replyEffectStore')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-agent-memory-api-'))
const expressionFile = path.join(tempDir, 'expressions.json')
const profileFile = path.join(tempDir, 'profiles.json')

async function seed() {
    expressionStore.resetForTest(expressionFile)
    personProfileStore.resetForTest(profileFile)
    replyEffectStore.resetForTest()

    await expressionStore.upsertExpressions({
        groupId: '1000',
        candidates: [
            {
                situation: '群友轻松闲聊',
                style: '短句回应，不展开说教',
                confidence: 0.8,
                sourceMessageIds: ['m1']
            }
        ]
    })

    await personProfileStore.buildAndStoreProfile({
        groupId: '1000',
        userId: '42',
        sender: { nickname: 'Tester', card: '测试员' },
        memories: [
            {
                id: 'mem1',
                scope: 'user',
                groupId: '1000',
                userId: '42',
                type: 'preference',
                content: 'Tester 喜欢简短回复'
            }
        ]
    })
    for (let index = 0; index < 3; index += 1) {
        await personProfileStore.buildAndStoreProfile({
            groupId: '1000',
            userId: `10${index}`,
            sender: { nickname: `User${index}` },
            memories: [
                {
                    id: `mem_other_${index}`,
                    scope: 'user',
                    groupId: '1000',
                    userId: `10${index}`,
                    type: 'preference',
                    content: `其他用户 ${index} 的偏好`
                }
            ]
        })
    }

    replyEffectStore.recordEffect({
        id: 'effect_1',
        groupId: '1000',
        targetUserId: '42',
        action: 'react',
        label: 'positive',
        score: 0.75,
        text: '收到',
        signals: { targetUserResponded: true },
        sentAt: 1000,
        observedAt: 2000
    })
}

async function run() {
    await seed()

    const app = express()
    app.use(express.json())
    app.use('/api', agentMemoryRoutes)

    const expressions = await request(app).get('/api/agent/expressions?groupId=1000')
    assert.strictEqual(expressions.status, 200)
    assert.strictEqual(expressions.body.expressions.length, 1)
    assert.strictEqual(expressions.body.expressions[0].groupId, '1000')

    const profiles = await request(app).get('/api/agent/profiles?groupId=1000&userId=42&limit=1')
    assert.strictEqual(profiles.status, 200)
    assert.strictEqual(profiles.body.profiles.length, 1)
    assert.strictEqual(profiles.body.profiles[0].userId, '42')
    assert.ok(profiles.body.profiles[0].preferences.includes('Tester 喜欢简短回复'))

    const effects = await request(app).get('/api/agent/reply-effects?groupId=1000')
    assert.strictEqual(effects.status, 200)
    assert.strictEqual(effects.body.effects.length, 1)
    assert.strictEqual(effects.body.effects[0].label, 'positive')

    console.log('✓ Agent 记忆页扩展 API 正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        expressionStore.resetForTest()
        personProfileStore.resetForTest()
        replyEffectStore.resetForTest()
        fs.rmSync(tempDir, { recursive: true, force: true })
    })
