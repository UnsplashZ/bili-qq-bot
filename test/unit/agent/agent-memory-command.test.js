#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const commandManager = require(path.join(__dirname, '../../../src/commands'))
const longTermStore = require(path.join(__dirname, '../../../src/agent/memory/longTermStore'))

const tempMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-agent-memory-command-'))
const tempMemoryFile = path.join(tempMemoryDir, 'memories.json')
const originalAdminQQ = process.env.ADMIN_QQ

function createWs() {
    const sent = []
    return {
        sent,
        send(payload) {
            sent.push(JSON.parse(payload))
        }
    }
}

function lastText(ws) {
    const payload = ws.sent[ws.sent.length - 1]
    const message = payload?.params?.message || []
    return message.map((item) => item?.data?.text || '').join('')
}

async function seedMemory() {
    const result = await longTermStore.storeMemoryHints({
        hints: [{
            scope: 'user',
            type: 'preference',
            content: '用户喜欢少前2',
            confidence: 0.82
        }],
        sessionContext: {
            groupId: '1000',
            userId: '42',
            topicId: 'topic-test',
            traceScope: 'test:memory-command'
        },
        agentMessage: { id: 'msg-memory-1' },
        decision: { action: 'observe_only' }
    })
    assert.strictEqual(result.stored, 1)
    const memories = await longTermStore.listMemories({ groupId: '1000' })
    assert.strictEqual(memories.length, 1)
    return memories[0].id
}

async function run() {
    process.env.ADMIN_QQ = '42'
    longTermStore.resetForTest(tempMemoryFile)

    try {
        const memoryId = await seedMemory()
        const ws = createWs()

        let handled = await commandManager.dispatch({
            ws,
            groupId: '1000',
            userId: '42',
            rawMessage: '/记忆 列表',
            traceContext: { scope: 'test:memory-command-list' }
        })
        assert.strictEqual(handled, true)
        assert.ok(lastText(ws).includes(memoryId))
        assert.ok(lastText(ws).includes('用户喜欢少前2'))
        assert.ok(lastText(ws).includes('msg-memory-1'))

        handled = await commandManager.dispatch({
            ws,
            groupId: '1000',
            userId: '43',
            rawMessage: `/记忆 删除 ${memoryId}`,
            traceContext: { scope: 'test:memory-command-denied' }
        })
        assert.strictEqual(handled, true)
        assert.ok(lastText(ws).includes('权限不足'))
        assert.strictEqual((await longTermStore.listMemories({ groupId: '1000' })).length, 1)

        handled = await commandManager.dispatch({
            ws,
            groupId: '1000',
            userId: '42',
            rawMessage: `/记忆 删除 ${memoryId}`,
            traceContext: { scope: 'test:memory-command-delete' }
        })
        assert.strictEqual(handled, true)
        assert.ok(lastText(ws).includes('已删除记忆'))
        assert.strictEqual((await longTermStore.listMemories({ groupId: '1000' })).length, 0)

        await seedMemory()
        handled = await commandManager.dispatch({
            ws,
            groupId: '1000',
            userId: '42',
            rawMessage: '/记忆 清理',
            traceContext: { scope: 'test:memory-command-clear' }
        })
        assert.strictEqual(handled, true)
        assert.ok(lastText(ws).includes('1 条'))
        assert.strictEqual((await longTermStore.listMemories({ groupId: '1000' })).length, 0)

        console.log('✓ Agent 长期记忆管理命令正常')
    } finally {
        if (originalAdminQQ === undefined) {
            delete process.env.ADMIN_QQ
        } else {
            process.env.ADMIN_QQ = originalAdminQQ
        }
        longTermStore.resetForTest()
        fs.rmSync(tempMemoryDir, { recursive: true, force: true })
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
