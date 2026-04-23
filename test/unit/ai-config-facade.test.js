#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    GROUP_AI_RUNTIME_FIELDS,
    GROUP_AI_SWITCH_FIELDS
} = require('../../src/services/ai/groupConfigFacade')
const {
    readAiConfigSnapshot,
    resetAiConfigSnapshot,
    updateAiConfigSnapshot
} = require('../../src/services/ai/facades/aiConfigFacade')

function createConfigStub() {
    return {
        aiEnabled: true,
        aiRagEnabled: false,
        aiProfileEnabled: true,
        aiProbability: 0.25,
        aiContextLimit: 16,
        aiTemperature: 0.8,
        groupConfigs: {},
        saveCalls: 0,
        getGroupConfig(groupId, key) {
            const groupConfig = this.groupConfigs[String(groupId)] || {}
            return Object.prototype.hasOwnProperty.call(groupConfig, key)
                ? groupConfig[key]
                : this[key]
        },
        ensureGroupConfig(groupId) {
            const safeGroupId = String(groupId)
            if (!this.groupConfigs[safeGroupId]) {
                this.groupConfigs[safeGroupId] = {}
            }
            return this.groupConfigs[safeGroupId]
        },
        save() {
            this.saveCalls += 1
        }
    }
}

function testReadAndUpdateShareOverrideAndEffectiveSnapshots() {
    const config = createConfigStub()

    const updated = updateAiConfigSnapshot(config, '1000', {
        aiEnabled: false,
        aiProbability: '0.5',
        aiContextLimit: '20'
    }, {
        fields: GROUP_AI_RUNTIME_FIELDS,
        includeGlobal: true,
        includeEffective: true,
        contextLimitRange: { min: 1, max: 100 }
    })

    assert.strictEqual(config.saveCalls, 1)
    assert.deepStrictEqual(updated.normalizedPatch, {
        aiEnabled: false,
        aiProbability: 0.5,
        aiContextLimit: 20
    })
    assert.deepStrictEqual(updated.overrides, {
        aiEnabled: false,
        aiRagEnabled: null,
        aiProfileEnabled: null,
        aiProbability: 0.5,
        aiContextLimit: 20,
        aiTemperature: null,
        global: {
            aiEnabled: true,
            aiRagEnabled: false,
            aiProfileEnabled: true,
            aiProbability: 0.25,
            aiContextLimit: 16,
            aiTemperature: 0.8
        }
    })
    assert.deepStrictEqual(updated.effective, {
        aiEnabled: false,
        aiRagEnabled: false,
        aiProfileEnabled: true,
        aiProbability: 0.5,
        aiContextLimit: 20,
        aiTemperature: 0.8
    })

    const readBack = readAiConfigSnapshot(config, '1000', {
        fields: GROUP_AI_RUNTIME_FIELDS,
        includeGlobal: true,
        includeEffective: true
    })

    assert.deepStrictEqual(readBack, {
        fields: GROUP_AI_RUNTIME_FIELDS,
        overrides: updated.overrides,
        effective: updated.effective
    })
}

function testResetPreservesOtherOverridesWhileReturningSharedSnapshotShape() {
    const config = createConfigStub()
    config.groupConfigs['1000'] = {
        aiEnabled: false,
        aiRagEnabled: true,
        aiProfileEnabled: false,
        aiProbability: 0.45
    }

    const reset = resetAiConfigSnapshot(config, '1000', {
        fields: GROUP_AI_SWITCH_FIELDS,
        includeGlobal: true,
        includeEffective: true
    })

    assert.strictEqual(config.saveCalls, 1)
    assert.strictEqual(config.groupConfigs['1000'].aiProbability, 0.45)
    assert.deepStrictEqual(reset, {
        fields: GROUP_AI_SWITCH_FIELDS,
        overrides: {
            aiEnabled: null,
            aiRagEnabled: null,
            aiProfileEnabled: null,
            global: {
                aiEnabled: true,
                aiRagEnabled: false,
                aiProfileEnabled: true
            }
        },
        effective: {
            aiEnabled: true,
            aiRagEnabled: false,
            aiProfileEnabled: true
        }
    })
}

function run() {
    testReadAndUpdateShareOverrideAndEffectiveSnapshots()
    testResetPreservesOtherOverridesWhileReturningSharedSnapshotShape()
    console.log('✓ ai config facade unifies group AI snapshot read/write/reset paths')
}

run()