#!/usr/bin/env node
'use strict'

const assert = require('assert')

const serviceManager = require('../../src/services/ServiceManager')
const { resolvePreviewTarget } = require('../../src/services/previewLab/targetResolver')

const originals = {
    sendCommand: serviceManager.sendCommand
}

function restore() {
    serviceManager.sendCommand = originals.sendCommand
}

async function testCachedModeUsesOnlyPreviewLabMemoryCache() {
    let sendPayload = null
    let sendCalls = 0

    serviceManager.sendCommand = async (endpoint, payload) => {
        sendCalls += 1
        sendPayload = { endpoint, payload }
        return { status: 'success', type: 'video', data: { title: 'cached' } }
    }

    const link = {
        type: 'video',
        id: 'BV1ZHiyBkExG',
        match: 'https://www.bilibili.com/video/BV1ZHiyBkExG'
    }

    const firstResult = await resolvePreviewTarget(link, {
        groupId: '1000',
        cacheMode: 'cached'
    })
    const secondResult = await resolvePreviewTarget(link, {
        groupId: '1000',
        cacheMode: 'cached'
    })

    assert.strictEqual(firstResult.status, 'success')
    assert.strictEqual(secondResult.status, 'success')
    assert.strictEqual(sendCalls, 1)
    assert.deepStrictEqual(sendPayload, {
        endpoint: 'video',
        payload: { bvid: 'BV1ZHiyBkExG', group_id: '1000' }
    })
}

async function testFreshModeBypassesPreviewLabMemoryCache() {
    let sendCalls = 0

    serviceManager.sendCommand = async () => {
        sendCalls += 1
        return { status: 'success', type: 'video', data: { title: 'fresh' } }
    }

    const link = {
        type: 'video',
        id: 'BV1freshzzzz',
        match: 'https://www.bilibili.com/video/BV1freshzzzz'
    }

    await resolvePreviewTarget(link, {
        groupId: '1000',
        cacheMode: 'fresh'
    })
    await resolvePreviewTarget(link, {
        groupId: '1000',
        cacheMode: 'fresh'
    })

    assert.strictEqual(sendCalls, 2)
}

async function run() {
    try {
        await testCachedModeUsesOnlyPreviewLabMemoryCache()
        await testFreshModeBypassesPreviewLabMemoryCache()
        console.log('PASS preview-lab-target-resolver')
    } finally {
        restore()
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
