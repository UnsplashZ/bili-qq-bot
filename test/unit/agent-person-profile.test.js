#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const personProfileStore = require(path.join(__dirname, '../../src/agent/memory/personProfileStore'))
const { maybeRefreshPersonProfile, compactProfile } = require(path.join(__dirname, '../../src/agent/memory/personProfileBuilder'))

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-profile-'))
const profileFile = path.join(tempDir, 'profiles.json')

async function run() {
    personProfileStore.resetForTest(profileFile)
    const memories = [
        { id: 'mem1', scope: 'user', groupId: '1000', userId: '42', type: 'preference', content: 'Tester 喜欢简短回复' },
        { id: 'mem2', scope: 'user', groupId: '1000', userId: '42', type: 'relation', content: 'uid 2402855757 是楠哥' },
        { id: 'mem3', scope: 'user', groupId: '1000', userId: '43', type: 'preference', content: '其他用户记忆不应进入' }
    ]
    const result = await maybeRefreshPersonProfile({
        agentConfig: { participation: { personProfileEnabled: true } },
        groupId: '1000',
        userId: '42',
        longTermMemories: memories,
        agentMessage: { sender: { nickname: 'Tester', card: '测试员' } }
    })
    assert.strictEqual(result.status, 'ok')
    assert.strictEqual(result.stored, 1)
    assert.ok(result.profile.preferences.includes('Tester 喜欢简短回复'))
    assert.ok(!JSON.stringify(result.profile).includes('其他用户'))

    const stored = await personProfileStore.getProfile({ groupId: '1000', userId: '42' })
    const compact = compactProfile(stored)
    assert.strictEqual(compact.userId, '42')
    assert.ok(compact.displayNames.includes('测试员'))

    console.log('✓ Agent 人物画像聚合正常')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
