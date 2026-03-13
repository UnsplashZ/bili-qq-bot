#!/usr/bin/env node
'use strict'

const assert = require('assert')
const axios = require('axios')

const logger = require('../../src/utils/logger')
const vectorMemoryService = require('../../src/services/vectorMemoryService')
const config = require('../../src/config')

const originals = {
    level: logger.level,
    getEmbedding: vectorMemoryService.getEmbedding,
    loadGroupMemory: vectorMemoryService.loadGroupMemory,
    saveGroupMemory: vectorMemoryService.saveGroupMemory,
    getGroupConfig: config.getGroupConfig,
    axiosPost: axios.post
}

const originalConfigDescriptors = {}
function overrideConfigValue(key, value) {
    originalConfigDescriptors[key] = Object.getOwnPropertyDescriptor(config, key)
    Object.defineProperty(config, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true
    })
}

function restoreConfigValues() {
    Object.keys(originalConfigDescriptors).forEach((key) => {
        Object.defineProperty(config, key, originalConfigDescriptors[key])
    })
}

function restore() {
    logger.level = originals.level
    vectorMemoryService.getEmbedding = originals.getEmbedding
    vectorMemoryService.loadGroupMemory = originals.loadGroupMemory
    vectorMemoryService.saveGroupMemory = originals.saveGroupMemory
    config.getGroupConfig = originals.getGroupConfig
    axios.post = originals.axiosPost
    restoreConfigValues()
    vectorMemoryService.groupCache.clear()
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        logger.level = 'debug'
        vectorMemoryService.maxEmbeddingConcurrency = 1
        vectorMemoryService.maxEmbeddingQueueSize = 1
        vectorMemoryService.embeddingQueue = []
        vectorMemoryService.activeEmbeddingJobs = 0

        vectorMemoryService.getEmbedding = async () => {
            await new Promise(resolve => setTimeout(resolve, 30))
            return [1, 0]
        }
        const memoryStore = []
        vectorMemoryService.loadGroupMemory = async () => memoryStore
        vectorMemoryService.saveGroupMemory = () => {}
        config.getGroupConfig = (_groupId, key) => {
            if (key === 'aiShortMessageThreshold') return 5
            if (key === 'aiVectorMemoryLimit') return 1000
            if (key === 'aiVectorSimilarityThreshold') return 0.4
            if (key === 'aiEnableSmartTrim') return false
            if (key === 'aiVectorMaxSize') return 10 * 1024 * 1024
            if (key === 'aiTrimRatio') return 0.1
            return 0
        }

        const writes = []
        for (let i = 0; i < 3; i++) {
            writes.push(vectorMemoryService.addMemory('10001', `abcdef_${i}`, 'user', 'u1', 'user1'))
        }
        await Promise.all(writes)
        await new Promise(resolve => setTimeout(resolve, 120))

        overrideConfigValue('aiEmbeddingApiKey', 'k')
        overrideConfigValue('aiEmbeddingApiUrl', 'https://example.com/emb')
        overrideConfigValue('aiEmbeddingModel', 'test-model')
        overrideConfigValue('aiEmbeddingProxy', null)
        let attempts = 0
        axios.post = async () => {
            attempts += 1
            const err = new Error('rate limit')
            err.response = { status: 429, data: { error: 'too many requests' } }
            throw err
        }
        await originals.getEmbedding.call(vectorMemoryService, 'retry text')

        config.aiEnableVectorCache = true
        vectorMemoryService.getEmbedding = async () => [1, 0]
        vectorMemoryService.loadGroupMemory = async (gid) => {
            vectorMemoryService.updateCacheAccess(gid)
            return [
                { text: '记忆A', role: 'user', vector: [1, 0], timestamp: Date.now(), userId: 'u1', userName: 'A' }
            ]
        }
        await vectorMemoryService.search('10086', '测试查询', 1, 'u1')
        await vectorMemoryService.search('10086', '测试查询', 1, 'u1')

        assert.ok(logs.some(line => line.includes('DBG STORE') && line.includes('embedding-low-priority-dropped')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:10001]') && line.includes('embedding-request-started')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:10001]') && line.includes('memory-added')))
        assert.ok(logs.some(line => line.includes('WRN STORE') && line.includes('[svc:vector-memory]') && line.includes('embedding-request-retrying')))
        assert.ok(logs.some(line => line.includes('ERR STORE') && line.includes('[svc:vector-memory]') && line.includes('embedding-request-failed')))
        assert.ok(logs.some(line => line.includes('DBG STORE') && line.includes('[group:10086]') && line.includes('query-cache-stored')))
        assert.ok(logs.some(line => line.includes('DBG STORE') && line.includes('[group:10086]') && line.includes('query-cache-hit')))
        assert.ok(!logs.some(line => line.includes('[VectorMemory]')))
        console.log('✓ vectorMemoryService 运行时链路会输出统一摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
