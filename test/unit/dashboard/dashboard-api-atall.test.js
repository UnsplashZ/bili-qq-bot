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
const apiRouter = require('../../../src/dashboard/routes/api')
global.setInterval = originalSetInterval

const config = require('../../../src/config')
const subscriptionService = require('../../../src/services/subscriptionService')

const originals = {
    getSubscriptionsByGroup: subscriptionService.getSubscriptionsByGroup,
    getFollowingsForGroup: subscriptionService.getFollowingsForGroup,
    save: config.save,
    bot: global.bot,
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))

function overwriteGroupConfigs(next) {
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function restoreAll() {
    subscriptionService.getSubscriptionsByGroup = originals.getSubscriptionsByGroup
    subscriptionService.getFollowingsForGroup = originals.getFollowingsForGroup
    config.save = originals.save

    overwriteGroupConfigs(originalGroupConfigs)

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

describe('Dashboard API @all routes', function () {
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
        config.save = () => {}
        global.bot = {
            groupList: new Map([
                ['1000', { group_name: 'Test Group' }]
            ])
        }
    })

    after(function () {
        restoreAll()
    })

    it('GET /api/groups/:id/atall-targets 返回去重后的 UID 列表并标记同步分组命中', async function () {
        overwriteGroupConfigs({
            '1000': {
                cookieSyncGroupNames: ['游戏', '科技']
            }
        })

        subscriptionService.getSubscriptionsByGroup = async () => ({
            users: [
                { uid: '10', name: 'Manual10' },
                { uid: 10, name: 'DuplicatedShouldBeIgnored' },
                { uid: 'bad_uid', name: 'InvalidUid' }
            ],
            bangumis: []
        })

        subscriptionService.getFollowingsForGroup = async () => ([
            { mid: '20', uname: 'Cookie20', biliGroups: ['科技'] },
            { uid: 21, name: 'Cookie21', biliGroups: ['其他'] },
            { id: '20', name: 'Cookie20Dup', biliGroups: ['娱乐'] },
            { uid: 'abc', name: 'InvalidCookieUid', biliGroups: ['科技'] }
        ])

        const res = await request(app)
            .get('/api/groups/1000/atall-targets')
            .set('Authorization', `Bearer ${token}`)

        assert.strictEqual(res.status, 200)
        assert.deepStrictEqual(res.body.syncGroupNames, ['游戏', '科技'])
        assert.deepStrictEqual(res.body.manualUsers, [{ uid: '10', name: 'Manual10' }])

        assert.strictEqual(Array.isArray(res.body.cookieUsers), true)
        assert.strictEqual(res.body.cookieUsers.length, 2)

        const byUid = new Map(res.body.cookieUsers.map(user => [user.uid, user]))
        assert.strictEqual(byUid.get('20').matchedSyncGroup, true)
        assert.strictEqual(byUid.get('21').matchedSyncGroup, false)
    })

    it('POST /api/groups/:id/config 应规范化 subscriptionAtAllRules', async function () {
        overwriteGroupConfigs({
            '1000': {}
        })

        const res = await request(app)
            .post('/api/groups/1000/config')
            .set('Authorization', `Bearer ${token}`)
            .send({
                subscriptionAtAllRules: {
                    sources: { manual: false },
                    categories: { video: false, unknown: false },
                    manualDisabledIds: ['123', 123, 'bad', ' 456 '],
                    cookieSyncDisabledIds: [null, '789', 'oops']
                }
            })

        assert.strictEqual(res.status, 200)

        const rules = res.body.config.subscriptionAtAllRules
        assert.strictEqual(rules.sources.manual, false)
        assert.strictEqual(rules.sources.cookieSync, true)
        assert.strictEqual(rules.categories.video, false)
        assert.strictEqual(rules.categories.live, true)
        assert.deepStrictEqual(rules.manualDisabledIds, ['123', '456'])
        assert.deepStrictEqual(rules.cookieSyncDisabledIds, ['789'])
    })
})
