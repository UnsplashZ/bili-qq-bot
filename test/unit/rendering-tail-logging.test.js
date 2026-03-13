#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')

const logger = require('../../src/utils/logger')
const dynamicRenderer = require('../../src/services/imageGenerator/renderers/dynamic')
const metaCache = require('../../src/services/subscriptionUserMetaCacheService')

const originals = {
    level: logger.level,
    saveNow: metaCache._saveNow,
    existsSync: fs.existsSync,
    readdirSync: fs.readdirSync
}

function restore() {
    logger.level = originals.level
    metaCache._saveNow = originals.saveNow
    metaCache._saveScheduled = false
    metaCache._savePromise = null
    fs.existsSync = originals.existsSync
    fs.readdirSync = originals.readdirSync
}

async function run() {
    const logs = []
    const off = logger.onLog((entry) => logs.push(entry.message))

    try {
        logger.level = 'debug'

        metaCache._saveNow = async () => {
            throw new Error('save boom')
        }
        metaCache._scheduleSave()
        await metaCache._savePromise

        fs.existsSync = () => true
        fs.readdirSync = () => {
            throw new Error('font boom')
        }
        delete require.cache[require.resolve('../../src/services/imageGenerator/core/formatters')]
        require('../../src/services/imageGenerator/core/formatters').getCustomFonts()

        dynamicRenderer.renderDynamicContent({
            data: {
                item: {
                    id_str: '123',
                    type: 'DYNAMIC_TYPE_LIVE_RCMD',
                    modules: {
                        module_dynamic: {
                            major: {
                                live_rcmd: {
                                    content: '{bad json'
                                }
                            },
                            desc: {
                                text: 'fallback text'
                            }
                        },
                        module_author: {},
                        module_stat: {}
                    }
                }
            }
        }, {})

        assert.ok(logs.some(line => line.includes('ERR STORE') && line.includes('[svc:subscription-meta-cache]') && line.includes('cache-save-failed')))
        assert.ok(logs.some(line => line.includes('ERR SERVICE') && line.includes('[svc:image-formatters]') && line.includes('custom-font-load-failed')))
        assert.ok(logs.some(line => line.includes('ERR SERVICE') && line.includes('[svc:dynamic-renderer]') && line.includes('live-rcmd-parse-failed')))
        assert.ok(!logs.some(line => line.includes('[SubscriptionUserMetaCache]')))
        assert.ok(!logs.some(line => line.includes('[DynamicRenderer]')))
        console.log('✓ 零散渲染/缓存尾部模块会输出统一摘要日志')
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
