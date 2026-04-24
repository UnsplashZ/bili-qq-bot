#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const { monitorRegex } = require('../../src/utils/regexMonitor')
const { getAxiosProxyConfig } = require('../../src/utils/proxyUtils')
const subscriptionService = require('../../src/services/subscriptionService')
const biliApi = require('../../src/services/biliApi')
const serviceManager = require('../../src/services/ServiceManager')
const axios = require('axios')

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalReplace = subscriptionService.cookieFollowings
    const originalAxiosPost = axios.post
    const originalProcess = serviceManager.process
    const originalStart = serviceManager.start

    try {
        assert.throws(() => monitorRegex('boom-pattern', /x/, 'xxx', () => {
            throw new Error('regex boom')
        }), /regex boom/)

        assert.strictEqual(getAxiosProxyConfig('://broken'), false)

        subscriptionService.cookieFollowings = []

        serviceManager.process = {}
        serviceManager.start = async () => {}
        axios.post = async () => {
            throw new Error('download boom')
        }
        const result = await biliApi.downloadVideo('BV1ZHiyBkExG', 0, '720p', '1000')
        assert.strictEqual(result.status, 'error')

        assert.ok(logs.some(line => line.includes('ERR STORE') && line.includes('[svc:regex]') && line.includes('regex-execution-failed') && line.includes('patternName=boom-pattern')))
        assert.ok(logs.some(line => line.includes('WRN STORE') && line.includes('[svc:proxy]') && line.includes('proxy-url-invalid')))
        assert.ok(logs.some(line => line.includes('WRN SUB') && line.includes('[svc:subscription]') && line.includes('cookie-followings-setter-ignored')))
        assert.ok(logs.some(line => line.includes('ERR RPC') && line.includes('[svc:bili-api]') && line.includes('video-download-failed') && line.includes('bvid=BV1ZHiyBkExG')))
        assert.ok(!logs.some(line => line.includes('[RegexMonitor]')))
        assert.ok(!logs.some(line => line.includes('[ProxyUtils]')))
        assert.ok(!logs.some(line => line.includes('[SubscriptionService]')))
        assert.ok(!logs.some(line => line.includes('[BiliApi]')))
        console.log('✓ utility/service 小模块会输出统一摘要日志')
    } finally {
        off()
        subscriptionService.cookieFollowings = originalReplace
        axios.post = originalAxiosPost
        serviceManager.process = originalProcess
        serviceManager.start = originalStart
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
