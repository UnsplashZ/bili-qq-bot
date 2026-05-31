#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const updateChecker = require('../../../src/services/subscription/updateChecker')
const biliApi = require('../../../src/services/biliApi')
const notificationService = require('../../../src/services/notificationService')
const config = require('../../../src/config')

const originals = {
    refreshCredential: biliApi.refreshCredential,
    getRootAdminQQ: config.getRootAdminQQ,
    queryGroupAtAllCapability: updateChecker.queryGroupAtAllCapability,
    isSubscriptionAtAllEnabled: updateChecker.isSubscriptionAtAllEnabled,
    shouldAtAll: updateChecker.shouldAtAll,
    processMessageChain: notificationService.processMessageChain,
    callAction: notificationService.callAction,
    groupConfig3000: config.groupConfigs?.['3000'],
    ws: updateChecker.ws
}

function restore() {
    biliApi.refreshCredential = originals.refreshCredential
    config.getRootAdminQQ = originals.getRootAdminQQ
    updateChecker.queryGroupAtAllCapability = originals.queryGroupAtAllCapability
    updateChecker.isSubscriptionAtAllEnabled = originals.isSubscriptionAtAllEnabled
    updateChecker.shouldAtAll = originals.shouldAtAll
    notificationService.processMessageChain = originals.processMessageChain
    notificationService.callAction = originals.callAction
    config.groupConfigs = config.groupConfigs || {}
    if (originals.groupConfig3000 === undefined) {
        delete config.groupConfigs['3000']
    } else {
        config.groupConfigs['3000'] = originals.groupConfig3000
    }
    updateChecker.ws = originals.ws
    updateChecker.groupAtAllCapabilityCache.clear()
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        config.getRootAdminQQ = () => '42'
        updateChecker.ws = null
        biliApi.refreshCredential = async () => ({
            status: 'error',
            message: 'expired',
            errorType: 'auth_failed',
            retryable: false,
            endpoint: 'refresh_credential'
        })

        await updateChecker.checkAndRefreshCredential()

        updateChecker.ws = { readyState: 1 }
        updateChecker.isSubscriptionAtAllEnabled = () => true
        updateChecker.shouldAtAll = () => true
        updateChecker.queryGroupAtAllCapability = async () => ({
            canAtAll: true,
            reason: 'ok',
            retcode: 0,
            expiresAt: Date.now() + 1000
        })
        notificationService.processMessageChain = (message) => message
        notificationService.callAction = async (_ws, action, params) => {
            assert.strictEqual(action, 'send_group_msg')
            const hasAtAll = params.message.some(seg => seg?.type === 'at' && String(seg?.data?.qq) === 'all')
            if (hasAtAll) {
                return { status: 'failed', retcode: 100, wording: 'no permission' }
            }
            return { status: 'ok', retcode: 0 }
        }
        config.groupConfigs = config.groupConfigs || {}
        config.groupConfigs['3000'] = {
            ...(config.groupConfigs['3000'] || {}),
            subscriptionAtAll: true,
            subscriptionAtAllRules: config.normalizeSubscriptionAtAllRules(null)
        }
        updateChecker.groupAtAllCapabilityCache.clear()

        await updateChecker.sendSubscriptionMessage('3000', [{ type: 'text', data: { text: 'hello' } }], {
            sources: ['manual'],
            category: 'dynamic'
        })

        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[svc:maintenance]') && line.includes('credential-refresh-auth-failed') && line.includes('error=expired')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[svc:maintenance]') && line.includes('admin-notify-skipped') && line.includes('reason=ws_unavailable')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[group:3000]') && line.includes('at-all-send-failed-retrying-plain')))
        assert.ok(logs.some(line => line.includes('INF SUB') && line.includes('[group:3000]') && line.includes('plain-send-fallback-succeeded')))
        assert.ok(!logs.some(line => line.includes('[UpdateChecker]')))
        console.log('✓ updateChecker support 模块会输出统一摘要日志')
    } finally {
        off()
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
