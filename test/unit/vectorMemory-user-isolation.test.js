'use strict'

const assert = require('assert')

const config = require('../../src/config')
const vectorMemoryService = require('../../src/services/vectorMemoryService')
const VectorMemoryService = vectorMemoryService.constructor

describe('vectorMemoryService user-scoped deduplication', function () {
    const originals = {
        getGroupConfig: config.getGroupConfig
    }

    let service = null
    let memory = null

    beforeEach(function () {
        service = new VectorMemoryService()
        memory = []

        config.getGroupConfig = (_groupId, key) => {
            if (key === 'aiShortMessageThreshold') return 1
            if (key === 'aiVectorMemoryLimit') return 100
            if (key === 'aiEnableSmartTrim') return false
            if (key === 'aiVectorMaxSize') return 1024 * 1024
            if (key === 'aiTrimRatio') return 0.3
            return 100
        }

        service.getEmbedding = async (text) => {
            if (text.includes('相同文本')) return [1, 0, 0]
            if (text.includes('助手回复')) return [0, 1, 0]
            return [0, 0, 1]
        }
        service.loadGroupMemory = async () => memory
        service.saveGroupMemory = () => {}
    })

    afterEach(function () {
        config.getGroupConfig = originals.getGroupConfig
    })

    it('不会把不同用户的高相似 user 消息错误合并', async function () {
        await service._addMemoryCore('10001', '相同文本', 'user', 'user-a', '小A')
        await service._addMemoryCore('10001', '相同文本', 'user', 'user-b', '小B')

        assert.strictEqual(memory.length, 2)
        assert.strictEqual(memory[0].userId, 'user-a')
        assert.strictEqual(memory[1].userId, 'user-b')
        assert.strictEqual(memory[0].accessCount, 1)
        assert.strictEqual(memory[1].accessCount, 1)
    })

    it('仍会合并同一用户的高相似 user 消息', async function () {
        await service._addMemoryCore('10001', '相同文本', 'user', 'user-a', '小A')
        const originalTimestamp = memory[0].timestamp

        await service._addMemoryCore('10001', '相同文本', 'user', 'user-a', '小A')

        assert.strictEqual(memory.length, 1)
        assert.strictEqual(memory[0].userId, 'user-a')
        assert.strictEqual(memory[0].accessCount, 2)
        assert.ok(memory[0].timestamp >= originalTimestamp)
    })

    it('assistant 消息仍按原有角色语义去重', async function () {
        await service._addMemoryCore('10001', '助手回复', 'assistant')
        await service._addMemoryCore('10001', '助手回复', 'assistant')

        assert.strictEqual(memory.length, 1)
        assert.strictEqual(memory[0].role, 'assistant')
        assert.strictEqual(memory[0].accessCount, 2)
    })
})
