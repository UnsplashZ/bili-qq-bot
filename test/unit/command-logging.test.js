#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../src/utils/logger')
const downloadCommand = require('../../src/commands/download')
const helpCommand = require('../../src/commands/help')
const aiCommand = require('../../src/commands/ai')
const settingsCommand = require('../../src/commands/settings')
const subscriptionCommand = require('../../src/commands/subscription')
const adminCommand = require('../../src/commands/admin')
const imageGenerator = require('../../src/services/imageGenerator')
const videoDownloadService = require('../../src/services/videoDownloadService')
const biliApi = require('../../src/services/biliApi')
const config = require('../../src/config')
const subscriptionService = require('../../src/services/subscriptionService')

const originals = {
    helpCard: imageGenerator.generateHelpCard,
    aiHelpCard: imageGenerator.generateAIHelpCard,
    getLastDownloadInfo: videoDownloadService.getLastDownloadInfo,
    getVideoInfo: biliApi.getVideoInfo,
    downloadAndSend: videoDownloadService.downloadAndSend,
    checkLogin: biliApi.checkLogin,
    isGroupAdmin: config.isGroupAdmin,
    isRootAdmin: config.isRootAdmin,
    addUserSubscription: subscriptionService.addUserSubscription,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
}

function restore() {
    imageGenerator.generateHelpCard = originals.helpCard
    imageGenerator.generateAIHelpCard = originals.aiHelpCard
    videoDownloadService.getLastDownloadInfo = originals.getLastDownloadInfo
    biliApi.getVideoInfo = originals.getVideoInfo
    videoDownloadService.downloadAndSend = originals.downloadAndSend
    biliApi.checkLogin = originals.checkLogin
    config.isGroupAdmin = originals.isGroupAdmin
    config.isRootAdmin = originals.isRootAdmin
    subscriptionService.addUserSubscription = originals.addUserSubscription
    global.setInterval = originals.setInterval
    global.clearInterval = originals.clearInterval
    settingsCommand.loginPending.clear()
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        config.isGroupAdmin = () => true
        config.isRootAdmin = () => true

        imageGenerator.generateHelpCard = async () => {
            throw new Error('help boom')
        }
        await helpCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/帮助'
        })

        imageGenerator.generateAIHelpCard = async () => {
            throw new Error('ai help boom')
        }
        await aiCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/AI 帮助'
        })

        videoDownloadService.getLastDownloadInfo = () => ({ bvid: 'BV1ZHiyBkExG', totalPages: 2 })
        biliApi.getVideoInfo = async () => ({ status: 'success', data: { title: 'demo' } })
        videoDownloadService.downloadAndSend = async () => {
            throw new Error('download dispatch boom')
        }
        await downloadCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/下载 P1'
        })
        await new Promise(resolve => setImmediate(resolve))

        global.setInterval = (fn) => {
            Promise.resolve().then(fn)
            return { fake: true }
        }
        global.clearInterval = () => {}
        biliApi.checkLogin = async () => {
            throw new Error('poll boom')
        }
        settingsCommand.loginPending.set('demo-key', true)
        await settingsCommand.pollLoginStatus('demo-key', {}, '1000')
        await new Promise(resolve => setImmediate(resolve))

        subscriptionService.addUserSubscription = async () => {
            throw new Error('sub boom')
        }
        await subscriptionCommand.handle({
            ws: {},
            groupId: '1000',
            userId: '42',
            rawMessage: '/订阅用户 12345'
        })
        await new Promise(resolve => setImmediate(resolve))

        helpCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }], null)
        aiCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }], null)
        settingsCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }], null)
        subscriptionCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }], null)
        adminCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }], null)
        downloadCommand.sendGroupMessage({}, null, [{ type: 'text', data: { text: 'x' } }])

        assert.ok(logs.some(line => line.includes('ERR BOT') && line.includes('[cmd:help]') && line.includes('help-card-generate-failed')))
        assert.ok(logs.some(line => line.includes('ERR BOT') && line.includes('[cmd:ai]') && line.includes('ai-help-card-generate-failed')))
        assert.ok(logs.some(line => line.includes('ERR BOT') && line.includes('[cmd:download]') && line.includes('download-dispatch-failed')))
        assert.ok(logs.some(line => line.includes('ERR BOT') && line.includes('[cmd:settings]') && line.includes('login-poll-failed')))
        assert.ok(logs.some(line => line.includes('ERR BOT') && line.includes('[cmd:subscription]') && line.includes('user-subscribe-failed')))
        assert.ok(logs.some(line => line.includes('WRN BOT') && line.includes('[cmd:admin]') && line.includes('send-skipped')))
        assert.ok(!logs.some(line => line.includes('[DownloadCommand]')))
        assert.ok(!logs.some(line => line.includes('[HelpCommand]')))
        assert.ok(!logs.some(line => line.includes('[AiCommand]')))
        assert.ok(!logs.some(line => line.includes('[SettingsCommand]')))
        assert.ok(!logs.some(line => line.includes('[SubscriptionCommand]')))
        assert.ok(!logs.some(line => line.includes('[AdminCommand]')))
        console.log('✓ command 模块会输出统一摘要日志')
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
