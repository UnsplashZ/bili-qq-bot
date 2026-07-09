#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const qqRuntime = require('../../../src/providers/qq/runtime')
const dashboardServer = require('../../../src/dashboard/server')
const systemRouter = require('../../../src/dashboard/routes/api/modules/system')

describe('dashboard provider status', () => {
    afterEach(() => {
        qqRuntime.clearCurrentProvider()
    })

    it('public status includes only low-sensitive provider summary', () => {
        qqRuntime.setCurrentProvider({
            id: 'official',
            getStatus() {
                return {
                    id: 'official',
                    name: 'QQ Official',
                    connectionState: 'ready',
                    token: {
                        configured: true,
                        tokenTtlSeconds: 100,
                        clientSecret: '[REDACTED]'
                    },
                    gateway: {
                        state: 'ready'
                    },
                    idStore: {
                        groups: [{ groupOpenId: 'group-openid' }]
                    },
                    recentErrors: [{ message: 'boom' }]
                }
            }
        })

        const payload = dashboardServer.buildStatusPayload()
        const text = JSON.stringify(payload)
        assert.equal(payload.components.qqProvider, 'ok')
        assert.equal(payload.qqProvider.id, 'official')
        assert.equal(payload.qqProvider.name, 'QQ Official')
        assert.equal(payload.qqProvider.connectionState, 'ready')
        assert.equal(payload.qqProvider.token, undefined)
        assert.equal(payload.qqProvider.recentErrors, undefined)
        assert.equal(payload.qqProvider.idStore, undefined)
        assert.ok(!text.includes('raw-secret'))
        assert.ok(!text.includes('group-openid'))
        assert.ok(!text.includes('QQBot '))
    })

    it('protected provider status returns detailed provider state without raw credentials', async () => {
        qqRuntime.setCurrentProvider({
            id: 'official',
            getStatus() {
                return {
                    id: 'official',
                    connectionState: 'ready',
                    token: {
                        configured: true,
                        tokenTtlSeconds: 100
                    },
                    gateway: {
                        state: 'ready'
                    },
                    idStore: {
                        groups: [{ groupOpenId: 'group-openid', fullMessageEnabled: true }]
                    },
                    recentErrors: [{ source: 'send_group', message: 'rate_limited' }]
                }
            }
        })
        const app = express()
        app.use('/api', systemRouter)

        const res = await request(app).get('/api/qq-provider/status')
        const text = JSON.stringify(res.body)

        assert.equal(res.status, 200)
        assert.equal(res.body.provider.id, 'official')
        assert.equal(res.body.provider.idStore.groups[0].groupOpenId, 'group-openid')
        assert.equal(res.body.provider.recentErrors[0].source, 'send_group')
        assert.ok(!text.includes('clientSecret'))
        assert.ok(!text.includes('access_token'))
        assert.ok(!text.includes('QQBot '))
    })
})
