'use strict'

const assert = require('assert')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const { SubscriptionStateStore } = require('../../../src/services/subscription/subscriptionStateStore')

describe('subscription state migration', function () {
    afterEach(async function () {
        if (this.tmpDir) {
            await fs.rm(this.tmpDir, { recursive: true, force: true })
            this.tmpDir = null
        }
    })

    async function createStoreWithPayload(testContext, payload) {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-state-migration-'))
        testContext.tmpDir = tmpDir
        await fs.writeFile(
            path.join(tmpDir, 'subscription_state.json'),
            JSON.stringify(payload, null, 2),
            'utf8'
        )
        return new SubscriptionStateStore({ dataDir: tmpDir })
    }

    it('从 userSubs 和 cookieFollowings 幂等迁移且不被旧字段反向覆盖', async function () {
        const store = await createStoreWithPayload(this, {
            schemaVersion: 1,
            users: {
                100: {
                    uid: '100',
                    dynamic: { lastDynamicId: '200', meta: { source: 'unified' } },
                    video: { videoId: 'BV-new', lastCreated: 2000, meta: { source: 'unified' } },
                    article: { articleId: 'cv-new', lastPublishTime: 3000, meta: { source: 'unified' } },
                    live: { lastStatus: 1, roomId: 'room-new', meta: { source: 'unified' } }
                }
            }
        })

        const legacy = {
            userSubs: [
                {
                    uid: '100',
                    lastDynamicId: '199',
                    lastVideoId: 'BV-old',
                    lastVideoCreated: 1000,
                    lastArticleId: 'cv-old',
                    lastArticlePublishTime: 2000,
                    lastLiveStatus: 0,
                    roomId: 'room-old'
                },
                {
                    uid: '200',
                    lastDynamicId: '50',
                    lastVideoId: 'BV-legacy-no-time',
                    lastArticleId: 'cv-legacy-no-time',
                    lastLiveStatus: 1,
                    roomId: 'room-legacy'
                }
            ],
            cookieFollowings: {
                acc1: [
                    {
                        mid: '200',
                        lastDynamicId: '60',
                        lastVideoId: 'BV-legacy-newer',
                        lastVideoCreated: 4000,
                        lastArticleId: 'cv-legacy-newer',
                        lastArticlePublishTime: 5000,
                        lastLiveStatus: 1,
                        roomId: 'room-cookie'
                    }
                ]
            }
        }

        const first = await store.initializeFromLegacy(legacy)
        const afterFirst = store.getSnapshot()
        const second = await store.initializeFromLegacy(legacy)
        const afterSecond = store.getSnapshot()

        assert.strictEqual(first.changed, true)
        assert.strictEqual(second.changed, false)
        assert.deepStrictEqual(afterSecond, afterFirst)

        const existing = afterSecond.users['100']
        assert.strictEqual(existing.dynamic.lastDynamicId, '200')
        assert.strictEqual(existing.video.videoId, 'BV-new')
        assert.strictEqual(existing.article.articleId, 'cv-new')
        assert.strictEqual(existing.live.lastStatus, 1)
        assert.strictEqual(existing.live.roomId, 'room-new')

        const migrated = afterSecond.users['200']
        assert.strictEqual(migrated.dynamic.lastDynamicId, '60')
        assert.strictEqual(migrated.video.videoId, 'BV-legacy-newer')
        assert.strictEqual(migrated.video.lastCreated, 4000)
        assert.strictEqual(migrated.article.articleId, 'cv-legacy-newer')
        assert.strictEqual(migrated.article.lastPublishTime, 5000)
        assert.strictEqual(migrated.live.lastStatus, 1)
        assert.strictEqual(migrated.live.roomId, 'room-legacy')
        assert.strictEqual(migrated.live.meta.needsConfirm, true)
    })

    it('旧 video/article 缺时间戳时标记 legacy 防回放元数据', async function () {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sub-state-migration-'))
        this.tmpDir = tmpDir
        const store = new SubscriptionStateStore({ dataDir: tmpDir })

        await store.initializeFromLegacy({
            userSubs: [
                {
                    uid: '300',
                    lastVideoId: 'BV-no-time',
                    lastArticleId: 'cv-no-time'
                }
            ]
        })

        const state = store.getUserState('300')
        assert.strictEqual(state.video.videoId, 'BV-no-time')
        assert.strictEqual(state.video.lastCreated, null)
        assert.strictEqual(state.video.meta.legacyMissingTimestamp, true)
        assert.strictEqual(state.video.meta.replayGuard, true)
        assert.strictEqual(state.article.articleId, 'cv-no-time')
        assert.strictEqual(state.article.lastPublishTime, null)
        assert.strictEqual(state.article.meta.legacyMissingTimestamp, true)
        assert.strictEqual(state.article.meta.replayGuard, true)
    })
})
