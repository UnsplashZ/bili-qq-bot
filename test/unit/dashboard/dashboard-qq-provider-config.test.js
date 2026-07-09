#!/usr/bin/env node
'use strict'

const assert = require('assert')
const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')

const configRouter = require('../../../src/dashboard/routes/api/modules/config')
const sysConfig = require('../../../src/config')
const secretStore = require('../../../src/config/secretStore')

describe('dashboard qq provider config', () => {
    const originals = {
        qqProvider: sysConfig.qqProvider,
        qqOfficialClientSecret: sysConfig.qqOfficialClientSecret,
        qqOfficialRootOpenids: sysConfig.qqOfficialRootOpenids,
        save: sysConfig.save
    }
    let tempDir = ''

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-secret-'))
        secretStore.setQqOfficialClientSecretPathForTest(path.join(tempDir, '.qqOfficialClientSecret'))
        sysConfig.save = () => {}
    })

    afterEach(() => {
        sysConfig.qqProvider = originals.qqProvider
        if (typeof sysConfig.deleteKeys === 'function') {
            sysConfig.deleteKeys(['qqOfficialClientSecret'])
        }
        sysConfig.qqOfficialRootOpenids = originals.qqOfficialRootOpenids
        sysConfig.save = originals.save
        secretStore.setQqOfficialClientSecretPathForTest('')
        if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('saves provider mode and redacts returned secret', async () => {
        const app = express()
        app.use(express.json())
        app.use('/api', configRouter)

        const res = await request(app)
            .post('/api/config')
            .send({
                qqProvider: 'official',
                qqOfficialClientSecret: 'secret-value',
                qqOfficialRootOpenids: 'root-a,root-b'
            })

        assert.equal(res.status, 200)
        assert.equal(res.body.config.qqProvider, 'official')
        assert.equal(res.body.config.qqOfficialClientSecret, '[REDACTED]')
        assert.equal(res.body.restartRequired, true)
        assert.deepEqual(sysConfig.qqOfficialRootOpenids, ['root-a', 'root-b'])
        assert.equal(secretStore.readQqOfficialClientSecret(), 'secret-value')
        assert.equal(sysConfig._overrides.qqOfficialClientSecret, undefined)
    })

    it('accepts onebot as the dashboard label and stores napcat compatibility mode', async () => {
        const app = express()
        app.use(express.json())
        app.use('/api', configRouter)

        const res = await request(app)
            .post('/api/config')
            .send({ qqProvider: 'onebot' })

        assert.equal(res.status, 200)
        assert.equal(res.body.config.qqProvider, 'napcat')
        assert.equal(sysConfig.qqProvider, 'napcat')
    })
})
