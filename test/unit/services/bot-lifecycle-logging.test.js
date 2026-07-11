#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const { EventEmitter } = require('events')

const logger = require('../../../src/utils/logger')

const botPath = path.join(__dirname, '../../../src/bot.js')
const deps = [
    '../../../src/config',
    '../../../src/handlers/messageHandler',
    '../../../src/services/subscriptionService',
    '../../../src/services/imageGenerator',
    '../../../src/services/ServiceManager',
    '../../../src/services/subscription/updateChecker',
    '../../../src/dashboard/server',
    '../../../src/services/requestApprovalService',
    '../../../src/services/imageGenerator/renderers/components/emojiIndexProvider'
]

function mockModule(modulePath, exports) {
    const resolved = require.resolve(modulePath)
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    }
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    const originalExit = process.exit
    process.exit = () => {}

    try {
        mockModule(require.resolve('../../../src/config'), {
            wsUrl: 'ws://127.0.0.1:3001',
            wsToken: 'token',
            dashboardPort: 3000,
            groupConfigs: {},
            save() {},
            ensureGroupConfig() {}
        })
        mockModule(require.resolve('../../../src/handlers/messageHandler'), {
            handleMessage() {},
            handleGroupIncrease() {}
        })
        mockModule(require.resolve('../../../src/services/subscriptionService'), {
            start() {},
            stop() {}
        })
        mockModule(require.resolve('../../../src/services/imageGenerator'), {
            cleanup: async () => {}
        })
        mockModule(require.resolve('../../../src/services/ServiceManager'), {
            start: async () => {},
            cleanup: async () => ({ residualPids: [] })
        })
        mockModule(require.resolve('../../../src/services/subscription/updateChecker'), {
            notifyAdmin() {}
        })
        mockModule(require.resolve('../../../src/dashboard/server'), {
            start: async () => {},
            stop() {}
        })
        let approvalSchedulerStarted = false
        mockModule(require.resolve('../../../src/services/requestApprovalService'), {
            handleRequestEvent() {},
            start() { approvalSchedulerStarted = true },
            stop: async () => {}
        })
        mockModule(require.resolve('../../../src/services/imageGenerator/renderers/components/emojiIndexProvider'), {
            warmupEmojiIndexProvider() {}
        })

        class FakeWebSocket extends EventEmitter {
            constructor() {
                super()
                this.readyState = 1
            }

            send(raw) {
                const request = JSON.parse(String(raw))
                if (request.action === 'get_login_info') {
                    queueMicrotask(() => this.emit('message', JSON.stringify({
                        status: 'ok',
                        retcode: 0,
                        data: { user_id: 12345, nickname: 'test-bot' },
                        echo: request.echo
                    })))
                }
            }
            close() {
                this.readyState = 3
                this.emit('close', 1000, 'test-close')
            }
        }

        const wsResolved = require.resolve('ws')
        require.cache[wsResolved] = {
            id: wsResolved,
            filename: wsResolved,
            loaded: true,
            exports: FakeWebSocket
        }

        delete require.cache[require.resolve(botPath)]
        const bot = require(botPath)

        assert.strictEqual(typeof bot.initializeBot, 'function', 'bot.initializeBot should be exported for lifecycle testing')
        assert.strictEqual(typeof bot.scheduleReconnect, 'function', 'bot.scheduleReconnect should be exported for lifecycle testing')
        assert.strictEqual(typeof bot.gracefulShutdown, 'function', 'bot.gracefulShutdown should be exported for lifecycle testing')

        await bot.initializeBot()
        assert.strictEqual(approvalSchedulerStarted, true)
        bot.scheduleReconnect()
        if (bot.__testHooks && typeof bot.__testHooks.clearReconnectTimer === 'function') {
            bot.__testHooks.clearReconnectTimer()
        }
        await bot.gracefulShutdown(0)

        assert.ok(logs.some(line => line.includes('INF BOT') && line.includes('[svc:lifecycle]') && line.includes('startup')))
        assert.ok(logs.some(line => line.includes('INF BOT') && line.includes('[svc:lifecycle]') && line.includes('reconnect-scheduled')))
        assert.ok(logs.some(line => line.includes('INF BOT') && line.includes('[svc:lifecycle]') && line.includes('shutdown-complete')))
        console.log('✓ bot 生命周期会输出 BOT channel 摘要日志')
    } finally {
        process.exit = originalExit
        off()
        delete require.cache[require.resolve(botPath)]
        for (const modulePath of deps) {
            delete require.cache[require.resolve(modulePath)]
        }
        delete require.cache[require.resolve('ws')]
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
