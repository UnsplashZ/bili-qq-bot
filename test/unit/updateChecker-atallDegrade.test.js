'use strict'

const assert = require('assert')

const updateChecker = require('../../src/services/subscription/updateChecker')
const notificationService = require('../../src/services/notificationService')
const config = require('../../src/config')

const originals = {
    queryGroupAtAllCapability: updateChecker.queryGroupAtAllCapability,
    queryBotGroupRole: updateChecker.queryBotGroupRole,
    sendGroupMessage: notificationService.sendGroupMessage,
    callAction: notificationService.callAction,
    processMessageChain: notificationService.processMessageChain,
    ws: updateChecker.ws,
}

const originalGroupConfigs = JSON.parse(JSON.stringify(config.groupConfigs || {}))
const originalEnabledGroups = Array.isArray(config.enabledGroups) ? [...config.enabledGroups] : []
const originalGlobalBot = global.bot ? { ...global.bot } : undefined

function overwriteGroupConfigs(next) {
    const groupConfigs = config.groupConfigs || {}
    for (const key of Object.keys(groupConfigs)) {
        delete groupConfigs[key]
    }
    Object.assign(groupConfigs, next)
}

function overwriteEnabledGroups(next) {
    const enabledGroups = config.enabledGroups || []
    enabledGroups.splice(0, enabledGroups.length, ...next.map(String))
}

function restoreAll() {
    updateChecker.queryGroupAtAllCapability = originals.queryGroupAtAllCapability
    updateChecker.queryBotGroupRole = originals.queryBotGroupRole
    notificationService.sendGroupMessage = originals.sendGroupMessage
    notificationService.callAction = originals.callAction
    notificationService.processMessageChain = originals.processMessageChain
    updateChecker.ws = originals.ws

    updateChecker.groupAtAllCapabilityCache.clear()
    updateChecker.groupAtAllCapabilityInFlight.clear()
    updateChecker.groupBotRoleCache.clear()
    updateChecker.groupBotRoleInFlight.clear()

    overwriteGroupConfigs(originalGroupConfigs)
    overwriteEnabledGroups(originalEnabledGroups)

    if (originalGlobalBot) {
        global.bot = { ...originalGlobalBot }
    } else {
        delete global.bot
    }
}

describe('UpdateChecker @all auto degrade', function () {
    beforeEach(function () {
        restoreAll()
        updateChecker.setWs({ readyState: 1 })
    })

    after(function () {
        restoreAll()
    })

    it('warmup 仅检查开启 subscriptionAtAll 且仍在群内的群', async function () {
        overwriteGroupConfigs({
            '1000': { isInGroup: true, subscriptionAtAll: true },
            '1001': { isInGroup: false, subscriptionAtAll: true },
            '1002': { isInGroup: true, subscriptionAtAll: false },
            '1003': { isInGroup: true, subscriptionAtAll: true },
        })
        overwriteEnabledGroups(['1000', '1001', '1002'])

        const calledGroups = []
        updateChecker.queryGroupAtAllCapability = async (groupId) => {
            calledGroups.push(String(groupId))
            return { canAtAll: false, reason: 'test', retcode: 0, expiresAt: Date.now() + 1000 }
        }

        await updateChecker.warmupGroupAtAllCapabilities(true)
        assert.deepStrictEqual(calledGroups, ['1000'])
    })

    it('同一群并发 capability 查询会复用 in-flight promise', async function () {
        let callCount = 0
        updateChecker.queryBotGroupRole = async () => ({
            role: 'admin',
            allowed: true,
            reason: 'ok',
            retcode: 0,
            expiresAt: Date.now() + 1000
        })
        notificationService.callAction = async () => {
            callCount += 1
            await new Promise(resolve => setTimeout(resolve, 10))
            return {
                status: 'ok',
                retcode: 0,
                data: { can_at_all: true }
            }
        }

        const [first, second] = await Promise.all([
            updateChecker.queryGroupAtAllCapability('2000', { forceRefresh: true }),
            updateChecker.queryGroupAtAllCapability('2000', { forceRefresh: true })
        ])

        assert.strictEqual(callCount, 1)
        assert.strictEqual(first.canAtAll, true)
        assert.strictEqual(second.canAtAll, true)
    })

    it('can_at_all=true 但 bot 角色为 member 时应禁用 @all', async function () {
        notificationService.callAction = async (_ws, action) => {
            if (action === 'get_group_at_all_remain') {
                return {
                    status: 'ok',
                    retcode: 0,
                    data: { can_at_all: true }
                }
            }
            if (action === 'get_login_info') {
                return {
                    status: 'ok',
                    retcode: 0,
                    data: { user_id: 10001 }
                }
            }
            if (action === 'get_group_member_info') {
                return {
                    status: 'ok',
                    retcode: 0,
                    data: { role: 'member' }
                }
            }
            throw new Error(`unexpected action: ${action}`)
        }

        const result = await updateChecker.queryGroupAtAllCapability('2001', { forceRefresh: true })
        assert.strictEqual(result.canAtAll, false)
        assert.strictEqual(result.reason, 'insufficient_role:member')
        assert.strictEqual(result.botRole, 'member')
    })

    it('send_group_msg 的 @all 发送失败时会自动去掉 @all 重试', async function () {
        overwriteGroupConfigs({
            '3000': { isInGroup: true, subscriptionAtAll: true }
        })

        updateChecker.queryGroupAtAllCapability = async () => ({
            canAtAll: true,
            reason: 'ok',
            retcode: 0,
            expiresAt: Date.now() + 1000
        })

        notificationService.processMessageChain = (message) => message

        const sentChains = []
        notificationService.callAction = async (_ws, action, params) => {
            assert.strictEqual(action, 'send_group_msg')
            sentChains.push(params.message)
            const hasAtAll = params.message.some(seg => seg?.type === 'at' && String(seg?.data?.qq) === 'all')
            if (hasAtAll) {
                return { status: 'failed', retcode: 100, wording: 'no permission' }
            }
            return { status: 'ok', retcode: 0, data: { message_id: 1 } }
        }

        await updateChecker.sendSubscriptionMessage('3000', [{ type: 'text', data: { text: 'hello' } }])

        assert.strictEqual(sentChains.length, 2)
        assert.strictEqual(sentChains[0][0].type, 'at')
        assert.strictEqual(String(sentChains[0][0].data.qq), 'all')
        assert.strictEqual(sentChains[1][0].type, 'text')

        const cached = updateChecker.groupAtAllCapabilityCache.get('3000')
        assert.strictEqual(cached.canAtAll, false)
        assert.strictEqual(cached.retcode, 100)
    })

})
