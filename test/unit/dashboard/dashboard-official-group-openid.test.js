#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const request = require('supertest')

const sysConfig = require('../../../src/config')
const groupsRouter = require('../../../src/dashboard/routes/api/modules/groups')
const groupVideoDownloadRouter = require('../../../src/dashboard/routes/api/modules/group-video-download')
const previewLayoutRouter = require('../../../src/dashboard/routes/api/modules/preview-layout')

function createApp(...routers) {
    const app = express()
    app.use(express.json())
    for (const router of routers) {
        app.use('/api', router)
    }
    return app
}

describe('dashboard official group_openid support', () => {
    const originals = {}

    beforeEach(() => {
        originals.save = sysConfig.save
        originals.qqProvider = sysConfig.qqProvider
        originals.groupConfigs = JSON.parse(JSON.stringify(sysConfig.groupConfigs || {}))
        originals.enabledGroups = Array.isArray(sysConfig.enabledGroups) ? [...sysConfig.enabledGroups] : []
        originals.providerScopedEnabledGroups = JSON.parse(JSON.stringify(sysConfig.providerScopedEnabledGroups || {}))
        originals.bot = global.bot

        sysConfig.save = () => {}
        sysConfig.qqProvider = 'official'
        sysConfig.groupConfigs = {
            'group-openid': { isInGroup: true }
        }
        sysConfig.enabledGroups = []
        sysConfig.providerScopedEnabledGroups = {}
        global.bot = {
            provider: { id: 'official' },
            groupList: new Map([
                ['group-openid', { group_id: 'group-openid', group_name: 'Official Group' }]
            ])
        }
    })

    afterEach(() => {
        sysConfig.qqProvider = originals.qqProvider
        sysConfig.groupConfigs = originals.groupConfigs
        sysConfig.enabledGroups = originals.enabledGroups
        sysConfig.providerScopedEnabledGroups = originals.providerScopedEnabledGroups
        sysConfig.save = originals.save
        global.bot = originals.bot
    })

    it('lists and updates official opaque group ids in dashboard APIs', async () => {
        const app = createApp(groupsRouter, groupVideoDownloadRouter, previewLayoutRouter)

        const listRes = await request(app).get('/api/groups')
        assert.equal(listRes.status, 200)
        assert.deepEqual(listRes.body.map(group => group.id), ['group-openid'])
        assert.equal(listRes.body[0].name, 'Official Group')

        const configRes = await request(app)
            .post('/api/groups/group-openid/config')
            .send({ showId: false })
        assert.equal(configRes.status, 200)
        assert.equal(configRes.body.config.showId, false)

        const videoRes = await request(app)
            .put('/api/groups/group-openid/video-download-config')
            .send({ videoDownloadEnabled: true, videoDownloadResolution: '720p' })
        assert.equal(videoRes.status, 200)
        assert.equal(videoRes.body.config.videoDownloadEnabled, true)

        const previewRes = await request(app)
            .get('/api/preview-layout/config?type=video&groupId=group-openid')
        assert.equal(previewRes.status, 200)
    })

    it('keeps opaque group ids rejected in onebot compatibility mode', async () => {
        sysConfig.qqProvider = 'napcat'
        global.bot = {
            provider: { id: 'napcat' },
            groupList: new Map()
        }
        const app = createApp(groupsRouter)

        const res = await request(app)
            .post('/api/groups/group-openid/config')
            .send({ showId: false })

        assert.equal(res.status, 400)
    })

    it('stores Official group toggles in provider-scoped whitelist without mutating NapCat whitelist', async () => {
        sysConfig.enabledGroups = []
        sysConfig.providerScopedEnabledGroups = {}
        const app = createApp(groupsRouter)

        const res = await request(app)
            .post('/api/groups/group-openid/toggle')
            .send({})

        assert.equal(res.status, 200)
        assert.deepEqual(sysConfig.enabledGroups, [])
        assert.deepEqual(sysConfig.providerScopedEnabledGroups.official, [])

        sysConfig.qqProvider = 'napcat'
        global.bot = {
            provider: { id: 'napcat' },
            groupList: new Map([[1000, { group_id: 1000, group_name: 'NapCat Group' }]])
        }
        const listRes = await request(app).get('/api/groups')
        assert.equal(listRes.status, 200)
        assert.equal(listRes.body[0].id, '1000')
        assert.equal(listRes.body[0].isEnabled, true)
    })
})
