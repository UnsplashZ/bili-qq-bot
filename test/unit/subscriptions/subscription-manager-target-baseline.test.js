#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const biliApi = require('../../../src/services/biliApi')
const subscriptionManager = require('../../../src/services/subscription/subscriptionManager')
const subscriptionStateStore = require('../../../src/services/subscription/subscriptionStateStore')
const targeting = require('../../../src/services/subscription/updateChecker/modules/targeting')

const originals = {
    loaded: subscriptionManager._loaded,
    loadingPromise: subscriptionManager._loadingPromise,
    ensureSubscriptionsLoaded: subscriptionManager._ensureSubscriptionsLoaded,
    ensureNewTargetBaseline: subscriptionManager._ensureNewTargetBaseline,
    saveSubscriptions: subscriptionManager._saveSubscriptions,
    userSubs: subscriptionManager.userSubs,
    bangumiSubs: subscriptionManager.bangumiSubs,
    getUserInfo: biliApi.getUserInfo,
    getUserDynamic: biliApi.getUserDynamic,
    stateDataDir: subscriptionStateStore.dataDir,
    stateFile: subscriptionStateStore.stateFile,
    stateLoaded: subscriptionStateStore._loaded,
    stateLoadingPromise: subscriptionStateStore._loadingPromise,
    stateUsers: subscriptionStateStore.users,
    stateWriteChain: subscriptionStateStore._writeChain,
    stateSave: subscriptionStateStore.save
}

function restore() {
    subscriptionManager._loaded = originals.loaded
    subscriptionManager._loadingPromise = originals.loadingPromise
    subscriptionManager._ensureSubscriptionsLoaded = originals.ensureSubscriptionsLoaded
    subscriptionManager._ensureNewTargetBaseline = originals.ensureNewTargetBaseline
    subscriptionManager._saveSubscriptions = originals.saveSubscriptions
    subscriptionManager.userSubs = originals.userSubs
    subscriptionManager.bangumiSubs = originals.bangumiSubs
    biliApi.getUserInfo = originals.getUserInfo
    biliApi.getUserDynamic = originals.getUserDynamic

    subscriptionStateStore.dataDir = originals.stateDataDir
    subscriptionStateStore.stateFile = originals.stateFile
    subscriptionStateStore._loaded = originals.stateLoaded
    subscriptionStateStore._loadingPromise = originals.stateLoadingPromise
    subscriptionStateStore.users = originals.stateUsers
    subscriptionStateStore._writeChain = originals.stateWriteChain
    subscriptionStateStore.save = originals.stateSave
}

async function resetStateStore(tmpDir) {
    subscriptionStateStore.dataDir = tmpDir
    subscriptionStateStore.stateFile = path.join(tmpDir, 'subscription_state.json')
    subscriptionStateStore._loaded = false
    subscriptionStateStore._loadingPromise = null
    subscriptionStateStore.users = {}
    subscriptionStateStore._writeChain = Promise.resolve()
    await subscriptionStateStore.ensureLoaded()
}

async function run() {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-bot-sub-manager-baseline-'))
    try {
        await resetStateStore(tmpDir)

        subscriptionManager._loaded = true
        subscriptionManager._loadingPromise = null
        subscriptionManager._ensureSubscriptionsLoaded = async () => {}
        subscriptionManager._saveSubscriptions = async () => {}
        subscriptionManager.bangumiSubs = []
        subscriptionManager.userSubs = [{
            uid: '42',
            name: 'tester',
            groupIds: ['1000'],
            lastDynamicId: '123456',
            lastLiveStatus: 0
        }]

        const existingName = await subscriptionManager.addUserSubscription('42', '2000')
        const existingState = subscriptionStateStore.getUserState('42')

        assert.strictEqual(existingName, 'tester')
        assert.deepStrictEqual(subscriptionManager.userSubs[0].groupIds, ['1000', '2000'])
        assert.strictEqual(existingState.targets['2000'].dynamic.baselineSource, 'new_target')
        assert.strictEqual(existingState.targets['2000'].dynamic.baselineId, '123456')

        const removed = await subscriptionManager.removeUserSubscription('42', '2000')
        const removedState = subscriptionStateStore.getUserState('42')

        assert.strictEqual(removed, true)
        assert.strictEqual(removedState.targets['2000'].dynamic.active, false)
        assert.ok(removedState.targets['2000'].dynamic.removedAt)

        await subscriptionStateStore.advanceDynamic('42', '223456')
        const readdedName = await subscriptionManager.addUserSubscription('42', '2000')
        const readdedState = subscriptionStateStore.getUserState('42')

        assert.strictEqual(readdedName, 'tester')
        assert.strictEqual(readdedState.targets['2000'].dynamic.active, true)
        assert.strictEqual(readdedState.targets['2000'].dynamic.baselineId, '223456')

        let saveAttempts = 0
        subscriptionManager._saveSubscriptions = async () => {
            saveAttempts += 1
            const stateDuringSave = subscriptionStateStore.getUserState('42')
            assert.strictEqual(stateDuringSave.targets['4000'].dynamic.baselineSource, 'new_target')
            assert.strictEqual(stateDuringSave.targets['4000'].dynamic.baselineId, '223456')
            throw new Error('save failed')
        }

        await assert.rejects(() => subscriptionManager.addUserSubscription('42', '4000'), /save failed/)
        assert.strictEqual(saveAttempts, 1)
        assert.ok(!subscriptionManager.userSubs[0].groupIds.includes('4000'))
        assert.strictEqual(subscriptionStateStore.getUserState('42').targets['4000'], undefined)

        await subscriptionStateStore.advanceDynamic('42', '323456')
        subscriptionManager._saveSubscriptions = async () => {}
        await subscriptionManager.addUserSubscription('42', '4000')
        const retriedState = subscriptionStateStore.getUserState('42')

        assert.strictEqual(retriedState.targets['4000'].dynamic.baselineSource, 'new_target')
        assert.strictEqual(retriedState.targets['4000'].dynamic.baselineId, '323456')

        subscriptionManager._ensureNewTargetBaseline = async () => {
            throw new Error('baseline failed')
        }
        await assert.rejects(() => subscriptionManager.addUserSubscription('42', '4500'), /baseline failed/)
        assert.ok(!subscriptionManager.userSubs[0].groupIds.includes('4500'))
        subscriptionManager._ensureNewTargetBaseline = originals.ensureNewTargetBaseline

        subscriptionStateStore.save = async () => {
            throw new Error('state save failed')
        }
        await assert.rejects(() => subscriptionManager.addUserSubscription('42', '4600'), /state save failed/)
        assert.ok(!subscriptionManager.userSubs[0].groupIds.includes('4600'))
        assert.strictEqual(subscriptionStateStore.getUserState('42').targets['4600'], undefined)
        subscriptionStateStore.save = originals.stateSave

        subscriptionManager._saveSubscriptions = async () => {
            throw new Error('remove save failed')
        }
        await assert.rejects(() => subscriptionManager.removeUserSubscription('42', '4000'), /remove save failed/)
        assert.ok(subscriptionManager.userSubs[0].groupIds.includes('4000'))
        assert.strictEqual(subscriptionStateStore.getUserState('42').targets['4000'].dynamic.active, true)

        subscriptionManager.userSubs = [{
            uid: '50',
            name: 'rollback-user',
            groupIds: ['5000']
        }]
        subscriptionManager.bangumiSubs = [{
            seasonId: '21542',
            title: 'rollback-bangumi',
            groupIds: ['5000']
        }]
        await assert.rejects(() => subscriptionManager.removeGroupFromAllSubscriptions('5000'), /remove save failed/)
        assert.deepStrictEqual(subscriptionManager.userSubs[0].groupIds, ['5000'])
        assert.deepStrictEqual(subscriptionManager.bangumiSubs[0].groupIds, ['5000'])

        subscriptionManager._saveSubscriptions = async () => {}
        await resetStateStore(tmpDir)
        subscriptionManager.userSubs = []
        biliApi.getUserInfo = async () => ({
            status: 'success',
            data: { name: 'new-user' }
        })
        biliApi.getUserDynamic = async () => ({
            status: 'success',
            data: {
                cards: [
                    { id_str: '987654' }
                ]
            }
        })

        await subscriptionStateStore.advanceDynamic('66', '123456')
        await subscriptionStateStore.ensureTargetBaselines('66', ['6600'], subscriptionStateStore.getUserState('66'), {
            baselineSource: 'new_target'
        })
        await subscriptionStateStore.markTargetInactive('66', '6600')
        const restoredName = await subscriptionManager.addUserSubscription('66', '6600')
        const restoredState = subscriptionStateStore.getUserState('66')
        const restoredBaseline = restoredState.targets['6600'].dynamic

        assert.strictEqual(restoredName, 'new-user')
        assert.strictEqual(restoredBaseline.active, true)
        assert.strictEqual(restoredBaseline.baselineSource, 'new_target')
        assert.strictEqual(restoredBaseline.baselineId, '987654')
        assert.strictEqual(targeting.isContentAfterTargetBaseline({
            contentType: 'dynamic',
            contentId: '223456',
            baseline: restoredBaseline
        }), false)
        assert.strictEqual(targeting.isContentAfterTargetBaseline({
            contentType: 'dynamic',
            contentId: '987655',
            baseline: restoredBaseline
        }), true)

        await subscriptionStateStore.advanceDynamic('67', '700000')
        await subscriptionStateStore.advanceVideo('67', {
            videoId: 'BVstored',
            lastCreated: 300
        })
        await subscriptionStateStore.advanceArticle('67', {
            articleId: 'cv300',
            lastPublishTime: 300
        })
        await subscriptionStateStore.advanceLive('67', {
            lastStatus: 1,
            roomId: '999'
        })
        await subscriptionManager._ensureNewTargetBaseline('67', '6700', {
            lastDynamicId: '600000',
            lastVideoId: 'BVold',
            lastVideoCreated: 100,
            lastArticleId: 'cv100',
            lastArticlePublishTime: 100,
            lastLiveStatus: 0
        })
        const noRollbackState = subscriptionStateStore.getUserState('67')

        assert.strictEqual(noRollbackState.targets['6700'].dynamic.baselineId, '700000')
        assert.strictEqual(noRollbackState.targets['6700'].video.baselineId, 'BVstored')
        assert.strictEqual(noRollbackState.targets['6700'].video.baselineTime, 300)
        assert.strictEqual(noRollbackState.targets['6700'].article.baselineId, 'cv300')
        assert.strictEqual(noRollbackState.targets['6700'].article.baselineTime, 300)
        assert.strictEqual(noRollbackState.targets['6700'].live.baselineStatus, 1)
        assert.strictEqual(noRollbackState.targets['6700'].live.baselineRoomId, '999')

        let newSubSaveAttempts = 0
        subscriptionManager._saveSubscriptions = async () => {
            newSubSaveAttempts += 1
            const stateDuringSave = subscriptionStateStore.getUserState('77')
            assert.strictEqual(stateDuringSave.targets['7700'].dynamic.baselineSource, 'new_target')
            assert.strictEqual(stateDuringSave.targets['7700'].dynamic.baselineId, '987654')
            throw new Error('new save failed')
        }
        await assert.rejects(() => subscriptionManager.addUserSubscription('77', '7700'), /new save failed/)
        assert.strictEqual(newSubSaveAttempts, 1)
        assert.ok(!subscriptionManager.userSubs.some(sub => sub.uid === '77'))
        assert.strictEqual(subscriptionStateStore.getUserState('77').targets['7700'], undefined)

        subscriptionManager._saveSubscriptions = async () => {}
        const newName = await subscriptionManager.addUserSubscription('99', '3000')
        const newState = subscriptionStateStore.getUserState('99')

        assert.strictEqual(newName, 'new-user')
        assert.strictEqual(newState.targets['3000'].dynamic.baselineSource, 'new_target')
        assert.strictEqual(newState.targets['3000'].dynamic.baselineId, '987654')

        subscriptionManager._ensureNewTargetBaseline = async () => {
            throw new Error('new baseline failed')
        }
        await assert.rejects(() => subscriptionManager.addUserSubscription('88', '8800'), /new baseline failed/)
        assert.ok(!subscriptionManager.userSubs.some(sub => sub.uid === '88'))
        subscriptionManager._ensureNewTargetBaseline = originals.ensureNewTargetBaseline

        console.log('✓ SubscriptionManager 新增/移除群会同步维护目标群基线')
    } finally {
        restore()
        await fs.rm(tmpDir, { recursive: true, force: true })
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
