'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const OfficialQqProvider = require('../../../../src/providers/qq/officialProvider')
const OfficialIdStore = require('../../../../src/providers/qq/official/idStore')
const OfficialMessageIdStore = require('../../../../src/providers/qq/official/messageIdStore')

class FakeGateway extends EventEmitter {
    stop() {}
    getStatus() { return { state: 'ready' } }
}

function createCandidate(sharedState) {
    const sender = {
        messageIdStore: null,
        async sendGroupMessage() { return {} },
        async sendPrivateMessage() { return {} },
        async recallMessage() { return {} }
    }
    const provider = new OfficialQqProvider({
        publishGlobal: false,
        runtimeActive: false,
        sharedState,
        forkSharedState: true,
        config: {
            qqOfficialAppId: 'app-id',
            qqOfficialClientSecret: 'secret',
            qqOfficialTokenUrl: 'https://example.test/token',
            qqOfficialApiBase: 'https://example.test/api',
            qqOfficialIntents: 1,
            qqOfficialUseShardedGateway: false,
            qqOfficialGatewayAckTimeoutMs: 1000,
            qqOfficialMediaUploadMode: 'url_only',
            qqOfficialTempPublicBaseUrl: '',
            qqOfficialAccountQpm: 10,
            qqOfficialGroupQpm: 10,
            qqOfficialQueueMaxSize: 10,
            napcatTempPath: '/tmp'
        },
        logger: {
            logEvent() {},
            getErrorMessage: (error) => error?.message || String(error)
        },
        tokenManager: { getStatus: () => ({}) },
        openapi: {},
        gateway: new FakeGateway(),
        rateLimiter: { stop() {}, getStatus: () => ({}) },
        mediaUploader: {},
        sender
    })
    return { provider, sender }
}

describe('Official provider shared state COW', () => {
    it('preserves msgSeq and reply/recall records across a successful Official candidate commit', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-shared-state-'))
        const storagePath = path.join(tempDir, 'ids.json')
        try {
            const sharedState = {
                idStore: new OfficialIdStore({ storagePath }),
                messageIdStore: new OfficialMessageIdStore()
            }
            sharedState.idStore.upsertGroup('group-base', { groupName: 'Base' })
            sharedState.idStore.flush()
            assert.equal(sharedState.messageIdStore.nextSeq('group', 'group-base'), 1)
            assert.equal(sharedState.messageIdStore.nextSeq('group', 'group-base'), 2)
            sharedState.messageIdStore.record({
                internalMessageId: 'internal-old',
                officialMessageId: 'official-old',
                targetType: 'group',
                targetId: 'group-base',
                msgSeq: 2
            })

            const { provider, sender } = createCandidate(sharedState)
            assert.equal(provider.messageIdStore.nextSeq('group', 'group-base'), 3)
            provider.messageIdStore.record({
                internalMessageId: 'internal-candidate',
                officialMessageId: 'official-candidate',
                targetType: 'group',
                targetId: 'group-base',
                msgSeq: 3
            })
            provider.idStore.upsertGroup('group-candidate', { groupName: 'Candidate' })
            assert.equal(sharedState.messageIdStore.nextSeq('group', 'group-base'), 3)
            sharedState.messageIdStore.record({
                internalMessageId: 'internal-concurrent',
                officialMessageId: 'official-concurrent',
                targetType: 'group',
                targetId: 'group-base',
                msgSeq: 3
            })
            sharedState.idStore.upsertGroup('group-concurrent', { groupName: 'Concurrent Active' })

            assert.equal(sharedState.messageIdStore.resolve('official-candidate').createdAt, 0)
            assert.equal(sharedState.idStore.getGroup('group-candidate'), null)
            provider.commitSharedState()

            assert.strictEqual(provider.idStore, sharedState.idStore)
            assert.strictEqual(provider.messageIdStore, sharedState.messageIdStore)
            assert.strictEqual(sender.messageIdStore, sharedState.messageIdStore)
            assert.equal(sharedState.messageIdStore.resolve('official-old').internalMessageId, 'internal-old')
            assert.equal(sharedState.messageIdStore.resolve('official-candidate').internalMessageId, 'internal-candidate')
            assert.equal(sharedState.messageIdStore.resolve('official-concurrent').internalMessageId, 'internal-concurrent')
            assert.equal(sharedState.messageIdStore.nextSeq('group', 'group-base'), 4)
            assert.equal(sharedState.idStore.getGroup('group-candidate').groupName, 'Candidate')
            assert.equal(sharedState.idStore.getGroup('group-concurrent').groupName, 'Concurrent Active')
            assert.equal(new OfficialIdStore({ storagePath }).getGroup('group-candidate').groupName, 'Candidate')
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('discards an uncommitted candidate without changing canonical memory or disk', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-shared-rollback-'))
        const storagePath = path.join(tempDir, 'ids.json')
        try {
            const sharedState = {
                idStore: new OfficialIdStore({ storagePath }),
                messageIdStore: new OfficialMessageIdStore()
            }
            sharedState.idStore.upsertGroup('group-base', { groupName: 'Base' })
            sharedState.idStore.flush()
            sharedState.messageIdStore.record({
                internalMessageId: 'internal-old',
                officialMessageId: 'official-old'
            })
            const diskBefore = fs.readFileSync(storagePath, 'utf8')

            const { provider } = createCandidate(sharedState)
            provider.idStore.upsertGroup('group-failed', { groupName: 'Failed Candidate' })
            provider.messageIdStore.record({
                internalMessageId: 'internal-failed',
                officialMessageId: 'official-failed'
            })
            provider.messageIdStore.nextSeq('group', 'group-base')
            await provider.stop()

            assert.equal(fs.readFileSync(storagePath, 'utf8'), diskBefore)
            assert.equal(sharedState.idStore.getGroup('group-failed'), null)
            assert.equal(sharedState.messageIdStore.resolve('official-failed').createdAt, 0)
            assert.equal(sharedState.messageIdStore.resolve('official-old').internalMessageId, 'internal-old')
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })

    it('restores canonical message state when persistent ID commit fails', () => {
        const sharedState = {
            idStore: new OfficialIdStore(),
            messageIdStore: new OfficialMessageIdStore()
        }
        sharedState.messageIdStore.record({
            internalMessageId: 'internal-old',
            officialMessageId: 'official-old'
        })
        const { provider } = createCandidate(sharedState)
        provider.messageIdStore.record({
            internalMessageId: 'internal-candidate',
            officialMessageId: 'official-candidate'
        })
        sharedState.idStore.commitFrom = () => {
            throw new Error('fixture persistent failure')
        }

        assert.throws(() => provider.commitSharedState(), /fixture persistent failure/)
        assert.equal(sharedState.messageIdStore.resolve('official-old').internalMessageId, 'internal-old')
        assert.equal(sharedState.messageIdStore.resolve('official-candidate').createdAt, 0)
        assert.notStrictEqual(provider.messageIdStore, sharedState.messageIdStore)
    })

    it('rolls a committed candidate back in canonical memory and on disk before admission', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-shared-admission-rollback-'))
        const storagePath = path.join(tempDir, 'ids.json')
        try {
            const sharedState = {
                idStore: new OfficialIdStore({ storagePath }),
                messageIdStore: new OfficialMessageIdStore()
            }
            sharedState.idStore.upsertGroup('group-old', { groupName: 'Old' })
            sharedState.idStore.flush()
            sharedState.messageIdStore.record({
                internalMessageId: 'internal-old',
                officialMessageId: 'official-old'
            })
            const diskBefore = fs.readFileSync(storagePath)
            const { provider, sender } = createCandidate(sharedState)
            const candidateIdStore = provider.idStore
            const candidateMessageStore = provider.messageIdStore
            provider.idStore.upsertGroup('group-new', { groupName: 'New' })
            provider.messageIdStore.record({
                internalMessageId: 'internal-new',
                officialMessageId: 'official-new'
            })

            provider.commitSharedState()
            assert.equal(sharedState.idStore.getGroup('group-new').groupName, 'New')
            provider.rollbackSharedStateCommit()

            assert.equal(sharedState.idStore.getGroup('group-new'), null)
            assert.equal(sharedState.messageIdStore.resolve('official-new').createdAt, 0)
            assert.deepEqual(fs.readFileSync(storagePath), diskBefore)
            assert.strictEqual(provider.idStore, candidateIdStore)
            assert.strictEqual(provider.messageIdStore, candidateMessageStore)
            assert.strictEqual(sender.messageIdStore, candidateMessageStore)
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    })
})
