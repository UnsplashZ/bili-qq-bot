#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const logger = require('../../src/utils/logger')
const vectorMemoryService = require('../../src/services/vectorMemoryService')

const originals = {
    level: logger.level,
    dataDir: vectorMemoryService.dataDir,
    maxL1MemoryBytes: vectorMemoryService.maxL1MemoryBytes,
    maxSingleGroupSize: vectorMemoryService.maxSingleGroupSize,
    calculateTotalL1Memory: vectorMemoryService.calculateTotalL1Memory
}

function restore(tmpDir) {
    logger.level = originals.level
    vectorMemoryService.dataDir = originals.dataDir
    vectorMemoryService.maxL1MemoryBytes = originals.maxL1MemoryBytes
    vectorMemoryService.maxSingleGroupSize = originals.maxSingleGroupSize
    vectorMemoryService.calculateTotalL1Memory = originals.calculateTotalL1Memory
    vectorMemoryService.groupCache.clear()
    vectorMemoryService.memories.clear()
    vectorMemoryService.saveTimers.clear()
    vectorMemoryService.evictionLock = false
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-memory-logging-'))

    try {
        logger.level = 'debug'
        vectorMemoryService.dataDir = tmpDir
        vectorMemoryService.maxL1MemoryBytes = 1024
        vectorMemoryService.maxSingleGroupSize = 10
        vectorMemoryService.calculateTotalL1Memory = () => 2048

        vectorMemoryService.evictionLock = true
        await vectorMemoryService.evictLRUGroup()
        vectorMemoryService.evictionLock = false

        await vectorMemoryService.evictLRUGroup()

        vectorMemoryService.groupCache.set('1000', { lastAccess: Date.now() - 1000, queryCache: new Map() })
        vectorMemoryService.memories.set('1000', [])
        await vectorMemoryService.evictLRUGroup()

        const groupFile = path.join(tmpDir, '2000.json')
        fs.writeFileSync(groupFile, JSON.stringify([{ text: 'one' }, { text: 'two' }, { text: 'three' }]), 'utf8')
        await vectorMemoryService.loadGroupMemory('2000')

        assert.ok(logs.some(line => line.includes('DBG STORE') && line.includes('[svc:vector-memory]') && line.includes('eviction-in-progress-skipped')))
        assert.ok(logs.some(line => line.includes('DBG STORE') && line.includes('[svc:vector-memory]') && line.includes('eviction-skipped-no-groups')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:1000]') && line.includes('eviction-started')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:1000]') && line.includes('eviction-finished')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:2000]') && line.includes('load-started')))
        assert.ok(logs.some(line => line.includes('WRN STORE') && line.includes('[group:2000]') && line.includes('group-size-limit-exceeded')))
        assert.ok(logs.some(line => line.includes('INF STORE') && line.includes('[group:2000]') && line.includes('group-trimmed')))
        assert.ok(!logs.some(line => line.includes('[VectorMemory]')))
        console.log('✓ vectorMemoryService 上半段会输出统一摘要日志')
    } finally {
        off()
        restore(tmpDir)
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
