#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const logger = require('../../src/utils/logger')

function mockModule(modulePath, exports) {
    const resolved = require.resolve(modulePath)
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    }
}

const apiRouterPath = require.resolve('../../src/dashboard/routes/api')
const mockedDeps = [
    '../../src/config',
    '../../src/services/subscriptionService',
    '../../src/services/subscriptionUserMetaCacheService',
    '../../src/services/biliApi',
    '../../src/services/mcpManager',
    '../../src/services/userProfileService',
    '../../src/dashboard/routes/api/shared/config-store',
    'systeminformation'
]

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalBot = global.bot

    try {
        let updatedInterval = null
        mockModule(require.resolve('../../src/config'), {
            dashboardPassword: 'test-pass',
            jwtSecret: 'test-secret',
            enabledGroups: ['1000'],
            groupConfigs: {
                '1000': {}
            },
            aiEnabled: true,
            aiRagEnabled: true,
            aiProfileEnabled: false,
            ensureGroupConfig(groupId) {
                this.groupConfigs[groupId] = this.groupConfigs[groupId] || {}
            },
            save() {},
            deleteKeys() {},
            getRootAdminQQ() {
                return '123456'
            },
            normalizeSubscriptionAtAllRules(value) {
                return value || {
                    enabled: false,
                    respectSourceUsers: false,
                    sourceUids: [],
                    sourceGroups: []
                }
            }
        })
        mockModule(require.resolve('../../src/services/subscriptionService'), {
            updateCheckInterval(interval) {
                updatedInterval = interval
            },
            async getSubscriptionsByGroup() {
                return {
                    users: [{ uid: '42', name: 'Tester' }],
                    bangumis: []
                }
            },
            async addUserSubscription() {
                return 'Tester'
            }
        })
        mockModule(require.resolve('../../src/services/subscriptionUserMetaCacheService'), {
            async enrichSubscriptions(users) {
                return users
            },
            async preheat() {
                throw new Error('preheat boom')
            }
        })
        mockModule(require.resolve('../../src/services/biliApi'), {
            async getLoginUrl() {
                return { url: 'https://example.com/login' }
            }
        })
        mockModule(require.resolve('../../src/services/mcpManager'), {
            async reload() {}
        })
        mockModule(require.resolve('../../src/services/userProfileService'), {
            async getAllProfiles() {
                return [{ userId: '2000', summary: 'demo' }]
            },
            async deleteProfile() {}
        })
        mockModule(require.resolve('../../src/dashboard/routes/api/shared/config-store'), {
            async readConfig() {
                return { dashboardPassword: 'hidden' }
            },
            async writeConfig() {},
            async readMcpConfig() {
                return {
                    _version: 1,
                    demo: {
                        type: 'stdio',
                        command: 'node',
                        args: [],
                        env: {},
                        enabled: true
                    }
                }
            },
            async writeMcpConfig() {}
        })
        mockModule(require.resolve('systeminformation'), {
            async networkInterfaceDefault() {
                return 'eth0'
            },
            async currentLoad() {
                return { currentLoad: 12.5 }
            },
            async mem() {
                return { active: 1024, total: 4096 }
            },
            async networkStats() {
                return [{ rx_sec: 10, tx_sec: 20 }]
            },
            async time() {
                return { uptime: 1234 }
            }
        })

        delete require.cache[apiRouterPath]
        const apiRouter = require(apiRouterPath)

        const app = express()
        app.use(express.json())
        app.use('/api', apiRouter)

        global.bot = {
            groupList: new Map([['1000', { group_name: 'Test Group' }]])
        }

        const loginRes = await request(app)
            .post('/api/login')
            .send({ password: 'test-pass' })

        assert.strictEqual(loginRes.status, 200)
        const token = loginRes.body.token
        assert.ok(token)

        const groupsRes = await request(app)
            .get('/api/groups')
            .set('Authorization', `Bearer ${token}`)
        assert.strictEqual(groupsRes.status, 200)

        const subscriptionsRes = await request(app)
            .get('/api/groups/1000/subscriptions')
            .set('Authorization', `Bearer ${token}`)
        assert.strictEqual(subscriptionsRes.status, 200)

        const addSubscriptionRes = await request(app)
            .post('/api/groups/1000/subscriptions')
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'user', value: '42' })
        assert.strictEqual(addSubscriptionRes.status, 200)

        await new Promise(resolve => setImmediate(resolve))

        const configRes = await request(app)
            .post('/api/config')
            .set('Authorization', `Bearer ${token}`)
            .send({ subscriptionCheckInterval: 120 })
        assert.strictEqual(configRes.status, 200)
        assert.strictEqual(updatedInterval, 120)

        const aiRes = await request(app)
            .post('/api/ai')
            .set('Authorization', `Bearer ${token}`)
            .send({ aiEnabled: false })
        assert.strictEqual(aiRes.status, 200)

        const mcpRes = await request(app)
            .post('/api/mcp')
            .set('Authorization', `Bearer ${token}`)
            .send({ mcpServers: {}, version: 1 })
        assert.strictEqual(mcpRes.status, 400)

        const monitorRes = await request(app)
            .get('/api/monitor')
            .set('Authorization', `Bearer ${token}`)
        assert.strictEqual(monitorRes.status, 200)

        const biliRes = await request(app)
            .get('/api/bili/login-url')
            .set('Authorization', `Bearer ${token}`)
        assert.strictEqual(biliRes.status, 200)

        const profilesRes = await request(app)
            .get('/api/profiles/1000')
            .set('Authorization', `Bearer ${token}`)
        assert.strictEqual(profilesRes.status, 200)

        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('groups-fetched')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('subscriptions-fetched') && line.includes('groupId=1000')))
        assert.ok(logs.some(line => line.includes('WRN DASH') && line.includes('subscription-preheat-failed') && line.includes('uid=42')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('config-updated')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('subscription-interval-updated') && line.includes('intervalSeconds=120')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('ai-settings-updated')))
        assert.ok(logs.some(line => line.includes('WRN DASH') && line.includes('mcp-config-invalid')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('system-monitor-fetched')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('bili-login-url-ready')))
        assert.ok(logs.some(line => line.includes('INF DASH') && line.includes('profiles-fetched') && line.includes('groupId=1000')))
        assert.ok(!logs.some(line => line.includes('[API]')))
        assert.ok(!logs.some(line => line.includes('[Config]')))
        assert.ok(!logs.some(line => line.includes('[Subscriptions API]')))

        console.log('✓ dashboard 次级路由会输出统一摘要日志')
    } finally {
        off()
        delete require.cache[apiRouterPath]
        for (const modulePath of mockedDeps) {
            delete require.cache[require.resolve(modulePath)]
        }
        if (originalBot) {
            global.bot = originalBot
        } else {
            delete global.bot
        }
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
