#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { runPreviewDebugSession } = require('../../src/services/previewLab/session')

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'preview-lab-'))
}

async function testRunPreviewDebugSessionWritesManifestJsonPngAndHtml() {
    const outputDir = createTempDir()
    const resolvedLink = {
        type: 'dynamic',
        id: '1180316687231090707',
        match: 'https://t.bilibili.com/1180316687231090707'
    }
    const result = await runPreviewDebugSession('https://t.bilibili.com/1180316687231090707', {
        outputDir,
        emitHtml: true,
        outName: 'demo-preview',
        showId: false,
        renderOverrides: { future: true }
    }, {
        resolvePreviewInput: async () => ({
            input: 'https://t.bilibili.com/1180316687231090707',
            normalizedInput: 'https://t.bilibili.com/1180316687231090707',
            resolvedLink,
            skippedLinks: []
        }),
        resolvePreviewTarget: async () => ({
            status: 'success',
            cardType: 'dynamic',
            canonicalUrl: 'https://t.bilibili.com/1180316687231090707',
            info: {
                status: 'success',
                type: 'dynamic',
                data: {
                    item: {
                        id_str: '1180316687231090707'
                    }
                }
            }
        }),
        generatePreviewCardArtifacts: async (_info, cardType, _groupId, showId) => {
            assert.strictEqual(cardType, 'dynamic')
            assert.strictEqual(showId, false)
            return {
                base64: Buffer.from('fake-png').toString('base64'),
                html: '<html><body>preview</body></html>',
                debugMeta: {
                    viewport: { width: 1200, height: 800 },
                    themeClass: 'theme-light',
                    resolvedTypeConfig: { label: '动态', icon: 'D' },
                    colorSummary: { background: '#fff' }
                }
            }
        }
    })
    const { manifest } = result

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(manifest.status, 'success')
    assert.strictEqual(manifest.outputName, 'demo-preview')
    assert.ok(fs.existsSync(manifest.pngPath))
    assert.ok(fs.existsSync(manifest.jsonPath))
    assert.ok(fs.existsSync(manifest.manifestPath))
    assert.ok(fs.existsSync(manifest.htmlPath))
    assert.strictEqual(result.previewTargetSummary.cardType, 'dynamic')
    assert.strictEqual(result.artifactsSummary.debugMeta.themeClass, 'theme-light')

    const jsonPayload = JSON.parse(fs.readFileSync(manifest.jsonPath, 'utf8'))
    assert.strictEqual(jsonPayload.cardType, 'dynamic')
    assert.strictEqual(jsonPayload.canonicalUrl, 'https://t.bilibili.com/1180316687231090707')
    assert.deepStrictEqual(jsonPayload.renderOverrides, { future: true })

    const htmlPayload = fs.readFileSync(manifest.htmlPath, 'utf8')
    assert.match(htmlPayload, /demo-preview\.png/)
    assert.match(htmlPayload, /preview/)
}

async function testRunPreviewDebugSessionThrowsOnFailedTarget() {
    let error = null
    try {
        await runPreviewDebugSession('https://www.bilibili.com/read/cv45123193', { outputDir: createTempDir() }, {
            resolvePreviewInput: async () => ({
                input: 'https://www.bilibili.com/read/cv45123193',
                normalizedInput: 'https://www.bilibili.com/read/cv45123193',
                resolvedLink: { type: 'article', id: '45123193', match: 'https://www.bilibili.com/read/cv45123193' },
                skippedLinks: []
            }),
            resolvePreviewTarget: async () => ({
                status: 'error',
                url: 'https://www.bilibili.com/read/cv45123193',
                info: { status: 'error', message: 'mock failed' }
            })
        })
    } catch (caught) {
        error = caught
    }

    assert.ok(error)
    assert.match(error.message, /预览数据获取失败: mock failed/)
}

async function run() {
    await testRunPreviewDebugSessionWritesManifestJsonPngAndHtml()
    await testRunPreviewDebugSessionThrowsOnFailedTarget()
    console.log('PASS preview-lab-session')
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
