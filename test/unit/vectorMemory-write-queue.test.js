#!/usr/bin/env node
'use strict'

const assert = require('assert')
const axios = require('axios')
const vectorMemoryService = require('../../src/services/vectorMemoryService')
const config = require('../../src/config')

const originals = {
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
    vectorMemoryService.getEmbedding = originals.getEmbedding
    vectorMemoryService.loadGroupMemory = originals.loadGroupMemory
    vectorMemoryService.saveGroupMemory = originals.saveGroupMemory
    config.getGroupConfig = originals.getGroupConfig
    axios.post = originals.axiosPost
    restoreConfigValues()
}

async function testQueueLimitAndDropLowPriority() {
    vectorMemoryService.maxEmbeddingConcurrency = 1
    vectorMemoryService.maxEmbeddingQueueSize = 2
    vectorMemoryService.embeddingQueue = []
    vectorMemoryService.activeEmbeddingJobs = 0

    let activeCalls = 0
    let maxActiveCalls = 0
    let embeddingCalls = 0

    vectorMemoryService.getEmbedding = async () => {
        embeddingCalls += 1
        activeCalls += 1
        if (activeCalls > maxActiveCalls) maxActiveCalls = activeCalls
        await new Promise(resolve => setTimeout(resolve, 30))
        activeCalls -= 1
        return [0.1, 0.2]
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

    const calls = []
    for (let i = 0; i < 5; i++) {
        calls.push(vectorMemoryService.addMemory('10001', `abcdef_${i}`, 'user', 'u1', 'user1'))
    }
    await Promise.all(calls)
    await new Promise(resolve => setTimeout(resolve, 120))

    assert.ok(maxActiveCalls <= 1, '并发应受限为 1')
    assert.ok(embeddingCalls <= 3, '队列容量 2 + 活跃 1 时，低优先级任务应被丢弃')
    console.log('✓ embedding 写入队列限制并发并丢弃低优先级任务')
}

async function testEmbeddingRetry429() {
    overrideConfigValue('aiEmbeddingApiKey', 'k')
    overrideConfigValue('aiEmbeddingApiUrl', 'https://example.com/emb')
    overrideConfigValue('aiEmbeddingModel', 'test-model')
    overrideConfigValue('aiEmbeddingProxy', null)

    let attempts = 0
    axios.post = async () => {
        attempts += 1
        if (attempts < 3) {
            const err = new Error('rate limit')
            err.response = { status: 429, data: { error: 'too many requests' } }
            throw err
        }
        return { data: { data: [{ embedding: [0.5, 0.6] }] } }
    }

    const embedding = await originals.getEmbedding.call(vectorMemoryService, 'retry text')
    assert.deepStrictEqual(embedding, [0.5, 0.6])
    assert.strictEqual(attempts, 3, '429 应触发重试后成功')
    console.log('✓ embedding 429 会进行退避重试')
}

async function run() {
    await testQueueLimitAndDropLowPriority()
    await testEmbeddingRetry429()
}

run()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(() => {
        restore()
    })
