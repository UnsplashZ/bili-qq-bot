#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const OfficialIdStore = require('../../../../src/providers/qq/official/idStore')

describe('OfficialIdStore', () => {
    it('tracks groups, users, and reachability', () => {
        const store = new OfficialIdStore()
        store.upsertGroup('group-openid', { groupName: 'Group' })
        store.upsertUser('user-openid', { nickname: 'Alice' })
        store.upsertMember('group-openid', 'member-openid', {
            userOpenId: 'user-openid',
            nickname: 'Alice',
            role: 'admin',
            status: 'observed'
        })
        store.setGroupReachability('group-openid', false, 'GROUP_MSG_REJECT')
        store.markGroupMessageEvent('group-openid', 'GROUP_MESSAGE_CREATE')

        assert.equal(store.getGroup('group-openid').reachable, true)
        assert.equal(store.getGroup('group-openid').reachabilityReason, 'observed')
        assert.equal(store.getGroup('group-openid').fullMessageEnabled, true)
        assert.equal(store.getMember('group-openid', 'member-openid').role, 'admin')
        assert.equal(store.toGroupListMap().get('group-openid').group_name, 'Group')
        assert.equal(store.getStatus().groupCount, 1)
        assert.equal(store.getStatus().userCount, 1)
        assert.equal(store.getStatus().memberCount, 1)
        assert.equal(store.getStatus().groups[0].fullMessageEnabled, true)
    })

    it('persists observed ids to disk and loads them on restart', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-official-id-store-'))
        const storagePath = path.join(tempDir, 'id-store.json')
        const store = new OfficialIdStore({ storagePath })
        store.upsertGroup('group-openid', { groupName: 'Group', reachable: true })
        store.upsertUser('user-openid', { nickname: 'Alice' })
        store.upsertMember('group-openid', 'member-openid', {
            userOpenId: 'user-openid',
            nickname: 'Alice',
            role: 'admin'
        })
        store.flush()

        const restored = new OfficialIdStore({ storagePath })

        assert.equal(restored.getGroup('group-openid').groupName, 'Group')
        assert.equal(restored.getMember('group-openid', 'member-openid').userOpenId, 'user-openid')
        assert.equal(restored.getStatus().userCount, 1)
        fs.rmSync(tempDir, { recursive: true, force: true })
    })
})
