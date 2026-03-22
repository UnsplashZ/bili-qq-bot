'use strict'

const assert = require('assert')

const browserManager = require('../../src/services/imageGenerator/core/browser')
const config = require('../../src/config')
const { generateHelpCard } = require('../../src/services/imageGenerator/generators/helpCard')
const { generateAIHelpCard } = require('../../src/services/imageGenerator/generators/aiHelpCard')
const { generateSubscriptionList } = require('../../src/services/imageGenerator/generators/subscriptionList')
const { generatePreviewLabAIHelpCard } = require('../../src/services/previewLab/structureAiHelpCard')

function createFakePage(capture) {
    return {
        async setUserAgent() {},
        async setViewport() {},
        async setContent(html) {
            capture.html = html
        },
        async waitForSelector() {},
        async evaluate() {},
        async $(selector) {
            assert.ok(selector)
            return {
                async screenshot() {
                    return Buffer.from('fake-image')
                }
            }
        }
    }
}

const LEGACY_LIGHT_GRADIENT = 'linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%)'
const LEGACY_DARK_GRADIENT = 'linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%)'

async function captureHelpLikeHtml(getGroupConfigImpl) {
    const htmlCaptures = []
    config.getGroupConfig = getGroupConfigImpl

    browserManager.withRetry = async (operation) => operation()
    browserManager.init = async () => {}
    browserManager.createPage = async () => createFakePage(htmlCaptures[htmlCaptures.length - 1])
    browserManager.closePage = async () => {}

    htmlCaptures.push({})
    await generateHelpCard('user', '10001')

    htmlCaptures.push({})
    await generateAIHelpCard('10001')

    htmlCaptures.push({})
    await generateSubscriptionList({ users: [], groups: [], bangumis: [], accountFollows: null }, '10001', true, '订阅列表')

    htmlCaptures.push({})
    await generatePreviewLabAIHelpCard('10001')

    return htmlCaptures
}

describe('help-like preview gradients', function () {
    const originals = {
        withRetry: browserManager.withRetry,
        init: browserManager.init,
        createPage: browserManager.createPage,
        closePage: browserManager.closePage,
        getGroupConfig: config.getGroupConfig
    }

    afterEach(function () {
        browserManager.withRetry = originals.withRetry
        browserManager.init = originals.init
        browserManager.createPage = originals.createPage
        browserManager.closePage = originals.closePage
        config.getGroupConfig = originals.getGroupConfig
    })

    it('uses the legacy dark gradient in night mode', async function () {
        const htmlCaptures = await captureHelpLikeHtml((_groupId, key) => {
            if (key === 'nightMode') {
                return {
                    mode: 'on',
                    startTime: '20:00',
                    endTime: '06:00'
                }
            }
            return null
        })

        for (const capture of htmlCaptures) {
            assert.ok(capture.html.includes(LEGACY_DARK_GRADIENT))
            assert.ok(!capture.html.includes('gradient-shell'))
        }
    })

    it('uses the legacy light gradient in day mode', async function () {
        const htmlCaptures = await captureHelpLikeHtml(() => null)

        for (const capture of htmlCaptures) {
            assert.ok(capture.html.includes(LEGACY_LIGHT_GRADIENT))
            assert.ok(!capture.html.includes('gradient-shell'))
        }
    })
})
