#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    GROUP_AI_RUNTIME_FIELDS,
    GROUP_AI_SWITCH_FIELDS,
    normalizeGroupAiConfigPatch,
    readGroupAiConfigSnapshot,
    updateGroupAiConfig,
    resetGroupAiConfig
} = require('../../src/services/ai/groupConfigFacade')
const { AiConfigValidationError } = require('../../src/services/ai/validation')

function createConfigStub() {
    return {
        aiEnabled: true,
        aiRagEnabled: false,
        aiProfileEnabled: true,
        groupConfigs: {},
        saveCalls: 0,
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

function testNormalizeGroupAiConfigPatchSupportsNullOverrides() {
    const patch = normalizeGroupAiConfigPatch({
        aiProbability: '0.35',
        aiContextLimit: '20',
        aiProfileEnabled: null
    }, {
        fields: GROUP_AI_RUNTIME_FIELDS,
        contextLimitRange: { min: 1, max: 100 }
    })

    assert.deepStrictEqual(patch, {
        aiProbability: 0.35,
        aiContextLimit: 20,
        aiProfileEnabled: null
    })
}

function testUpdateAndReadSnapshotsUseSharedFields() {
    const config = createConfigStub()

    const result = updateGroupAiConfig(config, '1000', {
        aiEnabled: false,
        aiProbability: '0.5',
        aiContextLimit: '12'
    }, {
        fields: GROUP_AI_RUNTIME_FIELDS,
        includeGlobal: true,
        contextLimitRange: { min: 1, max: 100 }
    })

    assert.strictEqual(config.saveCalls, 1)
    assert.deepStrictEqual(result.normalizedPatch, {
        aiEnabled: false,
        aiProbability: 0.5,
        aiContextLimit: 12
    })
    assert.deepStrictEqual(readGroupAiConfigSnapshot(config, '1000', {
        fields: GROUP_AI_SWITCH_FIELDS,
        includeGlobal: true
    }), {
        aiEnabled: false,
        aiRagEnabled: null,
        aiProfileEnabled: null,
        global: {
            aiEnabled: true,
            aiRagEnabled: false,
            aiProfileEnabled: true
        }
    })
}

function testResetRemovesGroupOverridesWithoutChangingGlobalValues() {
    const config = createConfigStub()
    config.groupConfigs['1000'] = {
        aiEnabled: false,
        aiRagEnabled: true,
        aiProfileEnabled: false,
        aiProbability: 0.2
    }

    const snapshot = resetGroupAiConfig(config, '1000', {
        fields: GROUP_AI_SWITCH_FIELDS,
        includeGlobal: true
    })

    assert.strictEqual(config.saveCalls, 1)
    assert.deepStrictEqual(snapshot, {
        aiEnabled: null,
        aiRagEnabled: null,
        aiProfileEnabled: null,
        global: {
            aiEnabled: true,
            aiRagEnabled: false,
            aiProfileEnabled: true
        }
    })
    assert.strictEqual(config.groupConfigs['1000'].aiProbability, 0.2)
}

function testRequireAtLeastOneKeepsRouteCompatibleMessage() {
    assert.throws(
        () => normalizeGroupAiConfigPatch({}, {
            fields: GROUP_AI_SWITCH_FIELDS,
            requireAtLeastOne: true,
            requireAtLeastOneMessage: 'At least one of aiEnabled, aiRagEnabled, or aiProfileEnabled must be provided'
        }),
        (error) => error instanceof AiConfigValidationError &&
            error.field === 'payload' &&
            error.message === 'At least one of aiEnabled, aiRagEnabled, or aiProfileEnabled must be provided'
    )
}

function run() {
    testNormalizeGroupAiConfigPatchSupportsNullOverrides()
    testUpdateAndReadSnapshotsUseSharedFields()
    testResetRemovesGroupOverridesWithoutChangingGlobalValues()
    testRequireAtLeastOneKeepsRouteCompatibleMessage()
    console.log('✓ group AI config facade centralizes normalization, snapshots, and reset behavior')
}

run()
