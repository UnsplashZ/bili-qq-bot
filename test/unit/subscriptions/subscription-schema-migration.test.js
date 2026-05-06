'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const storageUtils = require('../../../src/utils/storageUtils')

describe('subscription schema migration', function () {
    const originals = {
        dataDir: subscriptionManager.dataDir,
        subFile: subscriptionManager.subFile,
        followersFile: subscriptionManager.followersFile,
        userSubs: subscriptionManager.userSubs,
        bangumiSubs: subscriptionManager.bangumiSubs,
        cookieFollowings: subscriptionManager.cookieFollowings,
        groupToAccountMap: subscriptionManager.groupToAccountMap,
        asyncWriteWithBackup: storageUtils.asyncWriteWithBackup
    }

    afterEach(async function () {
        subscriptionManager.dataDir = originals.dataDir
        subscriptionManager.subFile = originals.subFile
        subscriptionManager.followersFile = originals.followersFile
        subscriptionManager.userSubs = originals.userSubs
        subscriptionManager.bangumiSubs = originals.bangumiSubs
        subscriptionManager.cookieFollowings = originals.cookieFollowings
        subscriptionManager.groupToAccountMap = originals.groupToAccountMap
        storageUtils.asyncWriteWithBackup = originals.asyncWriteWithBackup

        if (this.tmpDir) {
            await fs.rm(this.tmpDir, { recursive: true, force: true })
            this.tmpDir = null
        }
    })

    it('加载旧结构时应自动迁移到 schemaVersion=2 并回写', async function () {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-schema-migrate-'))
        this.tmpDir = tmpDir

        const subFile = path.join(tmpDir, 'subscriptions.json')
        const followersFile = path.join(tmpDir, 'subfollowers.json')

        await fs.writeFile(subFile, JSON.stringify({
            users: [{ uid: '123', name: 'tester', groupIds: ['1000'] }],
            bangumis: [{ seasonId: '456', title: 'demo', groupIds: ['1000'] }]
        }), 'utf8')
        await fs.writeFile(followersFile, JSON.stringify({
            followings: {
                acc1: [{ uid: '123', uname: 'tester' }]
            },
            groupMap: { '1000': 'acc1' }
        }), 'utf8')

        subscriptionManager.dataDir = tmpDir
        subscriptionManager.subFile = subFile
        subscriptionManager.followersFile = followersFile
        subscriptionManager.userSubs = []
        subscriptionManager.bangumiSubs = []
        subscriptionManager.cookieFollowings = {}
        subscriptionManager.groupToAccountMap = {}

        const saveCalls = []
        storageUtils.asyncWriteWithBackup = async (filePath, data) => {
            saveCalls.push({ filePath, data })
        }

        await subscriptionManager._loadSubscriptions()
        await subscriptionManager._loadFollowers()

        assert.strictEqual(subscriptionManager.userSubs.length, 1)
        assert.strictEqual(subscriptionManager.bangumiSubs.length, 1)
        assert.strictEqual(subscriptionManager.groupToAccountMap['1000'], 'acc1')
        assert.strictEqual(subscriptionManager.cookieFollowings.acc1[0].lastDynamicId, null)
        assert.strictEqual(subscriptionManager.cookieFollowings.acc1[0].lastLiveStatus, 0)

        const subSave = saveCalls.find(call => call.filePath === subFile)
        const followerSave = saveCalls.find(call => call.filePath === followersFile)
        assert.ok(subSave, '应触发 subscriptions 迁移回写')
        assert.ok(followerSave, '应触发 followers 迁移回写')
        assert.strictEqual(subSave.data.schemaVersion, 2)
        assert.strictEqual(followerSave.data.schemaVersion, 2)
        assert.ok(Array.isArray(subSave.data.users))
        assert.ok(followerSave.data.followings && typeof followerSave.data.followings === 'object')
    })
})
