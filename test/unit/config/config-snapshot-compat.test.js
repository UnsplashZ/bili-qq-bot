'use strict'

const assert = require('assert')
const config = require('../../../src/config')

describe('config snapshot compatibility', () => {
    it('includes redacted jwtSecret in getConfigSnapshot()', () => {
        const compat = config.__getMutableCompatStateForTests()
        const previousAgent = structuredClone(compat.agent)
        try {
            compat.agent.llm.apiKey = 'fixture-agent-secret'
            const snapshot = config.getConfigSnapshot()

            assert.ok(
                Object.prototype.hasOwnProperty.call(snapshot, 'jwtSecret'),
                'snapshot should include jwtSecret'
            )
            assert.strictEqual(snapshot.jwtSecret, config.jwtSecret ? '[REDACTED]' : '')
            assert.strictEqual(snapshot.dashboardPassword, config.dashboardPassword ? '[REDACTED]' : '')
            assert.deepStrictEqual(snapshot.agent?.llm?.apiKey, {
                configured: true
            })
            assert.ok(!JSON.stringify(snapshot).includes('fixture-agent-secret'))
        } finally {
            compat.agent = previousAgent
        }
    })
})
