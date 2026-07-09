#!/usr/bin/env node
'use strict'

const assert = require('assert')

const qqRuntime = require('../../../src/providers/qq/runtime')
const config = require('../../../src/config')
const OfficialIdStore = require('../../../src/providers/qq/official/idStore')
const { getSubscriptionNotificationReachability } = require('../../../src/services/subscription/updateChecker/helpers/groupReachability')

describe('subscription official reachability', () => {
    const originalEnabledGroups = config.enabledGroups
    const originalGroupConfigs = config.groupConfigs
    const originalSave = config.save

    beforeEach(() => {
        config.save = () => {}
        config.enabledGroups = ['group-openid']
        config.groupConfigs = {
            'group-openid': {
                isInGroup: true
            }
        }
    })

    afterEach(() => {
        qqRuntime.clearCurrentProvider()
        config.enabledGroups = originalEnabledGroups
        config.groupConfigs = originalGroupConfigs
        config.save = originalSave
    })

    it('skips groups marked rejected by official provider events', () => {
        const idStore = new OfficialIdStore()
        idStore.upsertGroup('group-openid')
        idStore.setGroupReachability('group-openid', false, 'GROUP_MSG_REJECT')
        qqRuntime.setCurrentProvider({
            id: 'official',
            idStore
        })

        const rejected = getSubscriptionNotificationReachability('group-openid')
        assert.equal(rejected.ok, false)
        assert.equal(rejected.reason, 'GROUP_MSG_REJECT')

        idStore.setGroupReachability('group-openid', true, 'GROUP_MSG_RECEIVE')
        const restored = getSubscriptionNotificationReachability('group-openid')
        assert.equal(restored.ok, true)
    })
})
