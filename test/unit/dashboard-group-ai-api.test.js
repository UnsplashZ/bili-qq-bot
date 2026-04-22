'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')
const jwt = require('jsonwebtoken')

const originalSetInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalSetInterval(...args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}
const apiRouter = require('../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const config = require('../../src/config')

const originals = {
    ensureGroupConfig: config.ensureGroupConfig,
    save: config.save,
    groupConfigs: JSON.parse(JSON.stringify(config.groupConfigs || {})),
    aiEnabled: config.aiEnabled,
    aiRagEnabled: config.aiRagEnabled,
    aiProfileEnabled: config.aiProfileEnabled,
    bot: global.bot
}

function overwriteGroupConfigs(next) {
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function restoreAll() {
    config.ensureGroupConfig = originals.ensureGroupConfig
    config.save = originals.save
    config.aiEnabled = originals.aiEnabled
    config.aiRagEnabled = originals.aiRagEnabled
    config.aiProfileEnabled = originals.aiProfileEnabled
    overwriteGroupConfigs(JSON.parse(JSON.stringify(originals.groupConfigs)))

    if (originals.bot) {
        global.bot = originals.bot
    } else {
        delete global.bot
    }
}

function buildToken() {
    return jwt.sign(
        { role: 'admin', timestamp: Date.now() },
        config.jwtSecret,
        { expiresIn: '1h' }
    )
}

describe('Dashboard group AI config API', function () {
    let app
    let token

    before(function () {
        app = express()
        app.use(express.json())
        app.use('/api', apiRouter)
    })

    beforeEach(function () {
        restoreAll()
        token = buildToken()
        config.ensureGroupConfig = (groupId) => {
            const safeGroupId = String(groupId)
            config.groupConfigs[safeGroupId] = config.groupConfigs[safeGroupId] || {}
            return config.groupConfigs[safeGroupId]
        }
        config.save = () => {}
        config.aiEnabled = true
        config.aiRagEnabled = false
        config.aiProfileEnabled = true
        overwriteGroupConfigs({
            '1000': {
                aiEnabled: false,
                aiRagEnabled: true,
                aiProfileEnabled: false,
                aiProbability: 0.25
            }
        })
        global.bot = {
            groupList: new Map([
                ['1000', { group_name: 'Test Group' }]
            ])
        }
    })

    after(function () {
        restoreAll()
    })

    it('DELETE /api/groups/:groupId/ai-config returns the full snapshot contract for frontend refresh', async function () {
        const resetRes = await request(app)
            .delete('/api/groups/1000/ai-config')
            .set('Authorization', `Bearer ${token}`)

        assert.strictEqual(resetRes.status, 200)
        assert.deepStrictEqual(resetRes.body, {
            message: 'AI configuration reset to global defaults',
            aiEnabled: null,
            aiRagEnabled: null,
            aiProfileEnabled: null,
            global: {
                aiEnabled: true,
                aiRagEnabled: false,
                aiProfileEnabled: true
            }
        })
        assert.strictEqual(config.groupConfigs['1000'].aiProbability, 0.25)

        const getRes = await request(app)
            .get('/api/groups/1000/ai-config')
            .set('Authorization', `Bearer ${token}`)

        assert.strictEqual(getRes.status, 200)
        assert.deepStrictEqual(getRes.body, {
            aiEnabled: null,
            aiRagEnabled: null,
            aiProfileEnabled: null,
            global: {
                aiEnabled: true,
                aiRagEnabled: false,
                aiProfileEnabled: true
            }
        })
    })
})