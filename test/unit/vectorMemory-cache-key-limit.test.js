#!/usr/bin/env node
'use strict'

const assert = require('assert')
const vectorMemoryService = require('../../src/services/vectorMemoryService')
const config = require('../../src/config')

const originals = {
    getEmbedding: vectorMemoryService.getEmbedding,
    loadGroupMemory: vectorMemoryService.loadGroupMemory,
    saveGroupMemory: vectorMemoryService.saveGroupMemory,
    getGroupConfig: config.getGroupConfig
}

function restore() {
    vectorMemoryService.getEmbedding = originals.getEmbedding
    vectorMemoryService.loadGroupMemory = originals.loadGroupMemory
    vectorMemoryService.saveGroupMemory = originals.saveGroupMemory
    config.getGroupConfig = originals.getGroupConfig
}

async function run() {
    const groupId = '10086'
    const memoryData = [
        { text: '记忆A', role: 'user', vector: [1, 0], timestamp: Date.now(), userId: 'u1', userName: 'A' },
        { text: '记忆B', role: 'user', vector: [0.9, 0.1], timestamp: Date.now(), userId: 'u1', userName: 'B' }
    ]

    config.aiEnableVectorCache = true
    config.getGroupConfig = (_groupId, key) => {
        if (key === 'aiVectorSearchLimit') return 3
        if (key === 'aiVectorSimilarityThreshold') return 0
        return 0
    }
    vectorMemoryService.getEmbedding = async () => [1, 0]
    vectorMemoryService.loadGroupMemory = async (gid) => {
        vectorMemoryService.updateCacheAccess(gid)
        return memoryData
    }
    vectorMemoryService.saveGroupMemory = () => {}
    vectorMemoryService.groupCache.clear()

    const limit1 = await vectorMemoryService.search(groupId, '测试查询', 1, 'u1')
    const limit2 = await vectorMemoryService.search(groupId, '测试查询', 2, 'u1')

    assert.strictEqual(limit1.length, 1)
    assert.strictEqual(limit2.length, 2, 'limit=2 不应命中 limit=1 的缓存结果')
    console.log('✓ 缓存 key 包含 limit，避免跨 limit 命中')
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => restore())
