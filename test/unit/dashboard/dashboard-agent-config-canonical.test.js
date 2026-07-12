'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const { createDefaultConfig } = require('../../../src/config/schemaV1')
const { createAgentConfigRouter } = require('../../../src/dashboard/routes/api/modules/agent-config')

function clone(value) {
    return structuredClone(value)
}

function setIn(target, path, value) {
    let current = target
    for (const segment of path.slice(0, -1)) {
        if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {}
        current = current[segment]
    }
    current[path.at(-1)] = clone(value)
}

function removeIn(target, path) {
    let current = target
    for (const segment of path.slice(0, -1)) {
        current = current?.[segment]
        if (!current) return
    }
    delete current[path.at(-1)]
}

function createConfigStub() {
    let snapshot = createDefaultConfig()
    let generation = 4
    const calls = []
    snapshot.agent.llm.apiKey = 'canonical-secret-value'
    snapshot.agent.llm.baseUrl = 'https://old.example/v1'

    return {
        calls,
        setProvider(provider) {
            snapshot.qq.provider = provider
        },
        service: {
            toPublicError(error) {
                return { code: error?.code || 'CONFIG_ERROR', path: '', line: null, column: null }
            }
        },
        getSnapshot() {
            return clone(snapshot)
        },
        getStatus() {
            return {
                valid: true,
                documentGeneration: generation,
                effectiveGeneration: generation,
                fingerprint: `public-${generation}`,
                pendingDeploymentApply: ['deployment.ports.dashboardHost']
            }
        },
        async patch(operations, options) {
            if (options.expectedGeneration !== generation) {
                const error = new Error('generation conflict')
                error.code = 'CONFIG_GENERATION_CONFLICT'
                error.conflictPaths = []
                throw error
            }
            calls.push({ operations: clone(operations), options: clone(options) })
            for (const operation of operations) {
                if (operation.op === 'remove') removeIn(snapshot, operation.path)
                else if (operation.op === 'clear-secret') setIn(snapshot, operation.path, '')
                else setIn(snapshot, operation.path, operation.value)
            }
            generation += 1
            return {
                origin: options.actor,
                documentGeneration: generation,
                effectiveGeneration: generation,
                generation,
                applied: operations.map((operation) => operation.path.join('.')),
                reloaded: ['agent'],
                deploymentApplyRequired: [],
                warnings: []
            }
        }
    }
}

describe('Dashboard Agent canonical config API', () => {
    let app
    let config

    beforeEach(() => {
        process.env.AGENT_LLM_PROVIDER = 'must-not-win'
        process.env.AGENT_LLM_BASE_URL = 'https://env.invalid/v1'
        process.env.AGENT_LLM_API_KEY_ENV = 'AGENT_ENV_SECRET'
        process.env.AGENT_ENV_SECRET = 'environment-secret-value'
        config = createConfigStub()
        app = express()
        app.use(express.json())
        app.use(createAgentConfigRouter({ config }))
    })

    afterEach(() => {
        delete process.env.AGENT_LLM_PROVIDER
        delete process.env.AGENT_LLM_BASE_URL
        delete process.env.AGENT_LLM_API_KEY_ENV
        delete process.env.AGENT_ENV_SECRET
    })

    it('GET only exposes canonical YAML fields and configured secret marker', async () => {
        const response = await request(app).get('/agent/config')

        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.documentGeneration, 4)
        assert.strictEqual(response.body.qqProvider, 'napcat')
        assert.strictEqual(response.body.agent.llm.baseUrl, 'https://old.example/v1')
        assert.deepStrictEqual(response.body.agent.llm.apiKey, { configured: true })
        assert.deepStrictEqual(response.body.defaults.llm.apiKey, { configured: false })
        const serialized = JSON.stringify(response.body)
        assert.ok(!serialized.includes('canonical-secret-value'))
        assert.ok(!serialized.includes('environment-secret-value'))
        assert.ok(!serialized.includes('apiKeyEnv'))
        assert.ok(!serialized.includes('baseURL'))
        assert.ok(!serialized.includes('llmEnv'))
        assert.ok(!serialized.includes('must-not-win'))
    })

    it('PUT preserves an omitted API key and never returns secret material', async () => {
        const response = await request(app)
            .put('/agent/config')
            .send({
                expectedGeneration: 4,
                llm: {
                    provider: 'openai-compatible',
                    baseUrl: 'https://new.example/v1',
                    model: 'model-v2'
                }
            })

        assert.strictEqual(response.status, 200)
        assert.strictEqual(response.body.documentGeneration, 5)
        assert.deepStrictEqual(response.body.agent.llm.apiKey, { configured: true })
        assert.ok(config.calls[0].operations.every((operation) => operation.path.join('.') !== 'agent.llm.apiKey'))
        const serialized = JSON.stringify(response.body)
        assert.ok(!serialized.includes('canonical-secret-value'))
        assert.ok(!serialized.includes('apiKeyEnv'))
        assert.ok(!serialized.includes('baseURL'))
    })

    it('preserves persistent deployment pending paths for an Agent no-op', async () => {
        const current = config.getSnapshot().agent
        const response = await request(app)
            .put('/agent/config')
            .send({ expectedGeneration: 4, ...current, llm: { ...current.llm, apiKey: undefined } })

        assert.strictEqual(response.status, 200)
        assert.deepStrictEqual(response.body.deploymentApplyRequired, ['deployment.ports.dashboardHost'])
        assert.strictEqual(config.calls.length, 0)
    })

    it('supports setting and explicitly clearing the canonical API key', async () => {
        const setResponse = await request(app)
            .put('/agent/config')
            .send({ expectedGeneration: 4, llm: { apiKey: 'replacement-secret-value' } })

        assert.strictEqual(setResponse.status, 200)
        const setOperation = config.calls[0].operations.find((operation) => operation.path.join('.') === 'agent.llm.apiKey')
        assert.deepStrictEqual(setOperation, {
            op: 'set',
            path: ['agent', 'llm', 'apiKey'],
            value: 'replacement-secret-value'
        })
        assert.deepStrictEqual(setResponse.body.agent.llm.apiKey, { configured: true })
        assert.ok(!JSON.stringify(setResponse.body).includes('replacement-secret-value'))

        const clearResponse = await request(app)
            .put('/agent/config')
            .send({ expectedGeneration: 5, secretActions: { apiKey: 'clear' } })

        assert.strictEqual(clearResponse.status, 200)
        const clearOperation = config.calls[1].operations.find((operation) => operation.path.join('.') === 'agent.llm.apiKey')
        assert.deepStrictEqual(clearOperation, { op: 'clear-secret', path: ['agent', 'llm', 'apiKey'] })
        assert.deepStrictEqual(clearResponse.body.agent.llm.apiKey, { configured: false })
    })

    it('requires expectedGeneration and reports a public conflict', async () => {
        const missing = await request(app).put('/agent/config').send({ enabled: true })
        assert.strictEqual(missing.status, 400)
        assert.strictEqual(missing.body.code, 'CONFIG_EXPECTED_GENERATION_REQUIRED')

        const conflict = await request(app).put('/agent/config').send({ expectedGeneration: 3, enabled: true })
        assert.strictEqual(conflict.status, 409)
        assert.strictEqual(conflict.body.code, 'CONFIG_GENERATION_CONFLICT')
        assert.strictEqual(conflict.body.generation, 4)
        assert.deepStrictEqual(conflict.body.conflictPaths, [])
    })

    it('rejects removed environment-indirection field names', async () => {
        const apiKeyEnv = await request(app)
            .put('/agent/config')
            .send({ expectedGeneration: 4, llm: { apiKeyEnv: 'AGENT_API_KEY' } })
        assert.strictEqual(apiKeyEnv.status, 400)
        assert.strictEqual(apiKeyEnv.body.code, 'CONFIG_FIELD_UNKNOWN')

        const baseURL = await request(app)
            .put('/agent/config')
            .send({ expectedGeneration: 4, llm: { baseURL: 'https://legacy.invalid/v1' } })
        assert.strictEqual(baseURL.status, 400)
        assert.strictEqual(baseURL.body.code, 'CONFIG_FIELD_UNKNOWN')
    })

    it('validates Agent group identifiers against the active QQ provider', async () => {
        const napcatOpaque = await request(app)
            .put('/agent/groups/group_openid_abc')
            .send({ expectedGeneration: 4, enabled: true })
        assert.strictEqual(napcatOpaque.status, 400)
        assert.strictEqual(napcatOpaque.body.code, 'CONFIG_GROUP_ID_INVALID')

        config.setProvider('official')
        const official = await request(app).get('/agent/config')
        assert.strictEqual(official.body.qqProvider, 'official')

        const opaque = await request(app)
            .put('/agent/groups/group_openid_abc')
            .send({ expectedGeneration: 4, enabled: true })
        assert.strictEqual(opaque.status, 200)
        assert.strictEqual(opaque.body.groupId, 'group_openid_abc')

        const unsafe = await request(app)
            .delete('/agent/groups/bad%2Fopenid')
            .send({ expectedGeneration: 5 })
        assert.strictEqual(unsafe.status, 400)
        assert.strictEqual(unsafe.body.code, 'CONFIG_GROUP_ID_INVALID')
    })
})
