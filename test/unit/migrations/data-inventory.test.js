'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
    scanDataInventory,
    compareDataInventories
} = require('../../../src/migrations/data/inventory')
const OfficialIdStore = require('../../../src/providers/qq/official/idStore')

const FIXTURE = path.join(__dirname, '../../fixtures/config-migration/business-data')

function copyDataFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-data-inventory-'))
    fs.cpSync(FIXTURE, root, { recursive: true })
    return root
}

function rewriteJson(filePath, mutator) {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    mutator(value)
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

describe('data migration inventory', function () {
    // Recursive private-file inventory checks are intentionally I/O heavy.
    this.timeout(10000)
    it('captures anchors, delivery parts, backups, Official IDs and preserve paths', () => {
        const dataDir = copyDataFixture()
        try {
            const inventory = scanDataInventory(dataDir)
            assert.strictEqual(inventory.strong.subscriptions.anchors['12345.users.42.lastDynamicId'], 'dyn-100')
            assert.strictEqual(inventory.strong.subscriptions_backup.present, true)
            assert.strictEqual(inventory.strong.subscription_delivery.deliveryRecords.length, 2)
            assert.deepStrictEqual(inventory.strong.qq_official_id_store.idCounts, {
                groups: 1,
                users: 1,
                members: 1
            })
            assert.strictEqual(inventory.preserve['cookies.json'].present, true)
            assert.strictEqual(inventory.preserve.agent.fileCount, 1)
            const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'qq-official-id-store.json'), 'utf8'))
            const realStore = new OfficialIdStore({ storagePath: path.join(dataDir, 'qq-official-id-store.json') })
            assert.deepStrictEqual(realStore.serialize(), persisted)
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('tracks cookies_map and numeric per-account cookie files as preserve data', () => {
        const dataDir = copyDataFixture()
        try {
            fs.writeFileSync(path.join(dataDir, 'cookies_map.json'), '{}\n')
            fs.writeFileSync(path.join(dataDir, 'cookies_12345.json'), '{"SESSDATA":"fixture"}\n')
            fs.writeFileSync(path.join(dataDir, 'cookies_name.json'), '{"ignored":true}\n')
            const inventory = scanDataInventory(dataDir)
            assert.strictEqual(inventory.preserve['cookies_map.json'].present, true)
            assert.strictEqual(inventory.preserve['cookies_12345.json'].present, true)
            assert.strictEqual(inventory.preserve['cookies_name.json'], undefined)
            const changed = scanDataInventory(dataDir)
            fs.writeFileSync(path.join(dataDir, 'cookies_12345.json'), '{"SESSDATA":"changed"}\n')
            assert.throws(() => compareDataInventories(changed, scanDataInventory(dataDir)), {
                code: 'DATA_UNDECLARED_PRESERVE_CHANGE'
            })
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rejects lost or changed anchors and delivery records', () => {
        const dataDir = copyDataFixture()
        try {
            const before = scanDataInventory(dataDir)
            rewriteJson(path.join(dataDir, 'subscriptions.json'), (value) => {
                delete value['12345'].users['42'].lastDynamicId
            })
            const missingAnchor = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(before, missingAnchor),
                (error) => error.code === 'DATA_ANCHOR_MISSING'
            )

            fs.rmSync(dataDir, { recursive: true, force: true })
            fs.mkdirSync(dataDir, { recursive: true })
            fs.cpSync(FIXTURE, dataDir, { recursive: true })
            const deliveryBefore = scanDataInventory(dataDir)
            rewriteJson(path.join(dataDir, 'subscription_delivery.json'), (value) => {
                value.records['dynamic:dyn-100:12345:main'].deliveredAt += 1
            })
            const deliveryAfter = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(deliveryBefore, deliveryAfter),
                (error) => error.code === 'DATA_DELIVERY_RECORD_CHANGED'
            )
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('protects scoped unified subscription-state progress anchors even for declared touched migrations', () => {
        const dataDir = copyDataFixture()
        const statePath = path.join(dataDir, 'subscription_state.json')
        const scopedAnchors = [
            ['video', 'lastCreated', 1710000000],
            ['article', 'lastPublishTime', 1720000000],
            ['live', 'lastStatus', 1]
        ]
        const writeState = () => fs.writeFileSync(statePath, `${JSON.stringify({
            users: {
                '42': {
                    video: { videoId: 'BV1fixture', lastCreated: 1710000000 },
                    article: { articleId: 'cv100', lastPublishTime: 1720000000 },
                    live: { roomId: '7788', lastStatus: 1 },
                    metadata: { lastCreated: 'not-an-anchor', lastPublishTime: 'not-an-anchor', lastStatus: 'not-an-anchor' }
                }
            },
            unrelated: { lastCreated: 'not-an-anchor', lastPublishTime: 'not-an-anchor', lastStatus: 'not-an-anchor' }
        }, null, 2)}\n`)
        try {
            writeState()
            const before = scanDataInventory(dataDir)
            assert.strictEqual(before.strong.subscription_state.anchors['users.42.video.lastCreated'], 1710000000)
            assert.strictEqual(before.strong.subscription_state.anchors['users.42.article.lastPublishTime'], 1720000000)
            assert.strictEqual(before.strong.subscription_state.anchors['users.42.live.lastStatus'], 1)
            assert.strictEqual(before.strong.subscription_state.anchors['users.42.metadata.lastCreated'], undefined)
            assert.strictEqual(before.strong.subscription_state.anchors['unrelated.lastStatus'], undefined)

            for (const [namespace, field, original] of scopedAnchors) {
                writeState()
                const baseline = scanDataInventory(dataDir)
                rewriteJson(statePath, (value) => {
                    value.users['42'][namespace][field] = original + 1
                })
                assert.throws(
                    () => compareDataInventories(baseline, scanDataInventory(dataDir), {
                        touchedPaths: ['strong.subscription_state'],
                        touchedValidators: { 'strong.subscription_state': () => true }
                    }),
                    (error) => error.code === 'DATA_ANCHOR_CHANGED',
                    `${namespace}.${field} changed`
                )

                writeState()
                const present = scanDataInventory(dataDir)
                rewriteJson(statePath, (value) => {
                    delete value.users['42'][namespace][field]
                })
                assert.throws(
                    () => compareDataInventories(present, scanDataInventory(dataDir), {
                        touchedPaths: ['strong.subscription_state'],
                        touchedValidators: { 'strong.subscription_state': () => true }
                    }),
                    (error) => error.code === 'DATA_ANCHOR_MISSING',
                    `${namespace}.${field} missing`
                )
            }
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rejects Official mapping count decreases and preserve path loss', () => {
        const dataDir = copyDataFixture()
        try {
            const before = scanDataInventory(dataDir)
            rewriteJson(path.join(dataDir, 'qq-official-id-store.json'), (value) => {
                value.users.splice(0, 1)
            })
            const afterIdLoss = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(before, afterIdLoss),
                (error) => error.code === 'DATA_OFFICIAL_ID_COUNT_DECREASED'
            )

            fs.cpSync(path.join(FIXTURE, 'qq-official-id-store.json'), path.join(dataDir, 'qq-official-id-store.json'))
            fs.rmSync(path.join(dataDir, 'agent'), { recursive: true, force: true })
            const afterPathLoss = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(before, afterPathLoss),
                (error) => error.code === 'DATA_PRESERVE_PATH_LOST'
            )
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('rejects equal-count replacements in untouched strong and preserve data', () => {
        const dataDir = copyDataFixture()
        try {
            const before = scanDataInventory(dataDir)
            rewriteJson(path.join(dataDir, 'subscriptions.json'), (value) => {
                value['12345'].users['42'].displayName = 'same-count-different-user'
            })
            const changedSubscription = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(before, changedSubscription),
                (error) => error.code === 'DATA_UNDECLARED_STRONG_CHANGE'
            )

            fs.cpSync(FIXTURE, dataDir, { recursive: true, force: true })
            const preserveBefore = scanDataInventory(dataDir)
            fs.writeFileSync(path.join(dataDir, 'agent', 'memory.json'), '{"changed":true}\n')
            const preserveAfter = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(preserveBefore, preserveAfter),
                (error) => error.code === 'DATA_UNDECLARED_PRESERVE_CHANGE'
            )
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('validates real OfficialIdStore array identities and rejects identity replacement', () => {
        const dataDir = copyDataFixture()
        try {
            const before = scanDataInventory(dataDir)
            assert.match(before.strong.qq_official_id_store.identityHash, /^[a-f0-9]{64}$/)
            rewriteJson(path.join(dataDir, 'qq-official-id-store.json'), (value) => {
                value.groups[0].groupOpenId = 'replacement-group-openid'
            })
            const after = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(before, after, {
                    touchedPaths: ['strong.qq_official_id_store'],
                    touchedValidators: { 'strong.qq_official_id_store': () => true }
                }),
                (error) => error.code === 'DATA_OFFICIAL_IDENTITY_CHANGED'
            )
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('requires an explicit validator for every declared touched path', () => {
        const dataDir = copyDataFixture()
        try {
            const inventory = scanDataInventory(dataDir)
            assert.throws(
                () => compareDataInventories(inventory, inventory, { touchedPaths: ['preserve.cookies.json'] }),
                (error) => error.code === 'DATA_TOUCHED_VALIDATOR_REQUIRED'
            )
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })
})
