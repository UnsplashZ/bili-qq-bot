'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const {
    SubscriptionStateStore,
    compareDynamicIds
} = require('../../../src/services/subscription/subscriptionStateStore')

describe('subscription state store', function () {
    afterEach(async function () {
        if (this.tmpDir) {
            await fs.rm(this.tmpDir, { recursive: true, force: true })
            this.tmpDir = null
        }
    })

    async function createStore(testContext) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-state-store-'))
        testContext.tmpDir = tmpDir
        return new SubscriptionStateStore({ dataDir: tmpDir })
    }

    it('保存 schemaVersion=2 的 uid 维度 dynamic/video/article/live 状态并可 reload', async function () {
        const store = await createStore(this)

        await store.ensureLoaded()
        await store.advanceDynamic('42', '100', { source: 'test' })
        await store.advanceVideo('42', { videoId: 'BV1', lastCreated: 1000 }, { source: 'video' })
        await store.advanceArticle('42', { articleId: 'cv1', lastPublishTime: 2000 })
        await store.advanceLive('42', { lastStatus: 1, roomId: '12345' }, { needsConfirm: true })

        const raw = JSON.parse(await fs.readFile(path.join(this.tmpDir, 'subscription_state.json'), 'utf8'))
        assert.strictEqual(raw.schemaVersion, 2)
        assert.strictEqual(raw.users['42'].dynamic.lastDynamicId, '100')
        assert.strictEqual(raw.users['42'].video.videoId, 'BV1')
        assert.strictEqual(raw.users['42'].article.articleId, 'cv1')
        assert.strictEqual(raw.users['42'].live.roomId, '12345')

        const reloaded = new SubscriptionStateStore({ dataDir: this.tmpDir })
        await reloaded.reload()
        const state = reloaded.getUserState('42')

        assert.strictEqual(state.dynamic.lastDynamicId, '100')
        assert.strictEqual(state.video.lastCreated, 1000)
        assert.strictEqual(state.article.lastPublishTime, 2000)
        assert.strictEqual(state.live.lastStatus, 1)
        assert.strictEqual(state.live.meta.needsConfirm, true)
    })

    it('dynamic/video/article 状态只允许前进', async function () {
        const store = await createStore(this)

        assert.strictEqual(compareDynamicIds('abc010', 'abc009'), 1)
        assert.strictEqual(compareDynamicIds('abc008', 'abc009'), -1)

        await store.advanceDynamic('42', '900719925474099312345')
        const olderDynamic = await store.advanceDynamic('42', '900719925474099312344')
        assert.strictEqual(olderDynamic.advanced, false)
        assert.strictEqual(store.getUserState('42').dynamic.lastDynamicId, '900719925474099312345')

        await store.advanceDynamic('43', 'abc009')
        const fallbackNewer = await store.advanceDynamic('43', 'abc010')
        const fallbackOlder = await store.advanceDynamic('43', 'abc008')
        assert.strictEqual(fallbackNewer.advanced, true)
        assert.strictEqual(fallbackOlder.advanced, false)
        assert.strictEqual(store.getUserState('43').dynamic.lastDynamicId, 'abc010')

        await store.advanceVideo('42', { videoId: 'BV2', lastCreated: 2000 })
        const olderVideo = await store.advanceVideo('42', { videoId: 'BV1', lastCreated: 1000 })
        assert.strictEqual(olderVideo.advanced, false)
        assert.strictEqual(store.getUserState('42').video.videoId, 'BV2')

        await store.advanceArticle('42', { articleId: 'cv2', lastPublishTime: 3000 })
        const olderArticle = await store.advanceArticle('42', { articleId: 'cv1', lastPublishTime: 2000 })
        assert.strictEqual(olderArticle.advanced, false)
        assert.strictEqual(store.getUserState('42').article.articleId, 'cv2')
    })

    it('为旧状态首次目标群迁移写 existing_target baseline，后续新增群写 new_target', async function () {
        const store = await createStore(this)

        await store.ensureLoaded()
        await store.advanceDynamic('42', '300')
        await store.advanceVideo('42', { videoId: 'BV300', lastCreated: 3000 })
        await store.advanceArticle('42', { articleId: 'cv300', lastPublishTime: 3000 })
        await store.advanceLive('42', { lastStatus: 1, roomId: '9000' })

        let state = store.getUserState('42')
        await store.ensureTargetBaselines('42', ['A', 'B'], state, { now: 10_000 })
        state = store.getUserState('42')

        assert.strictEqual(state.targets.A.dynamic.baselineSource, 'existing_target')
        assert.strictEqual(state.targets.B.video.baselineSource, 'existing_target')
        assert.strictEqual(state.targets.A.dynamic.baselineId, '300')
        assert.strictEqual(state.targets.A.video.baselineTime, 3000)
        assert.strictEqual(state.targets.A.article.baselineId, 'cv300')
        assert.strictEqual(state.targets.A.live.baselineStatus, 1)
        assert.strictEqual(state.targets.A.live.baselineRoomId, '9000')

        await store.ensureTargetBaselines('42', ['A', 'B', 'C'], state, { now: 20_000 })
        state = store.getUserState('42')

        assert.strictEqual(state.targets.C.dynamic.baselineSource, 'new_target')
        assert.strictEqual(state.targets.C.dynamic.baselineId, '300')
        assert.strictEqual(state.targets.C.video.baselineId, 'BV300')
    })

    it('inactive target baseline 可复活且 30 天后可清理', async function () {
        const store = await createStore(this)

        await store.ensureLoaded()
        await store.ensureTargetBaselines('42', ['A'], {
            dynamic: { lastDynamicId: '100' }
        }, { baselineSource: 'new_target', now: 1_000 })

        let result = await store.markTargetInactive('42', 'A', 2_000)
        assert.strictEqual(result.changed, true)
        assert.strictEqual(store.getUserState('42').targets.A.dynamic.active, false)
        assert.strictEqual(store.getUserState('42').targets.A.dynamic.removedAt, 2_000)

        result = await store.reactivateTargetBaseline('42', 'A')
        assert.strictEqual(result.changed, true)
        assert.strictEqual(store.getUserState('42').targets.A.dynamic.active, true)
        assert.strictEqual(store.getUserState('42').targets.A.dynamic.removedAt, null)

        await store.markTargetInactive('42', 'A', 2_000)
        const cleanup = await store.cleanupInactiveTargetBaselines(2_000 + (31 * 24 * 60 * 60 * 1000))
        assert.strictEqual(cleanup.removed, 4)
        assert.deepStrictEqual(store.getUserState('42').targets, {})
    })

    it('refreshBaseline=true 会在重新添加目标群时刷新 new_target 水位', async function () {
        const store = await createStore(this)

        await store.ensureLoaded()
        await store.ensureTargetBaselines('42', ['A'], {
            dynamic: { lastDynamicId: '100' },
            video: { videoId: 'BV100', lastCreated: 1000 },
            article: { articleId: 'cv100', lastPublishTime: 1000 },
            live: { lastStatus: 0 }
        }, { baselineSource: 'new_target', now: 1_000 })
        await store.markTargetInactive('42', 'A', 2_000)

        const result = await store.ensureTargetBaselines('42', ['A'], {
            dynamic: { lastDynamicId: '200' },
            video: { videoId: 'BV200', lastCreated: 2000 },
            article: { articleId: 'cv200', lastPublishTime: 2000 },
            live: { lastStatus: 1, roomId: '9000' }
        }, {
            baselineSource: 'new_target',
            refreshBaseline: true,
            now: 3_000
        })
        const state = result.state

        assert.strictEqual(state.targets.A.dynamic.active, true)
        assert.strictEqual(state.targets.A.dynamic.baselineId, '200')
        assert.strictEqual(state.targets.A.video.baselineId, 'BV200')
        assert.strictEqual(state.targets.A.video.baselineTime, 2000)
        assert.strictEqual(state.targets.A.article.baselineId, 'cv200')
        assert.strictEqual(state.targets.A.article.baselineTime, 2000)
        assert.strictEqual(state.targets.A.live.baselineStatus, 1)
        assert.strictEqual(state.targets.A.live.baselineRoomId, '9000')
        assert.strictEqual(state.targets.A.dynamic.removedAt, null)
    })
})
