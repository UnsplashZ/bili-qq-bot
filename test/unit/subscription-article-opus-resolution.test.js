#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { resolveArticleTitle } = require('../../src/services/subscription/updateChecker/helpers/article')
const feedModule = require('../../src/services/subscription/updateChecker/modules/feed')

function testResolveArticleTitleKeepsArticleTypeAndCanonicalUrl() {
    const meta = resolveArticleTitle({
        type: 'article',
        data: {
            id: 45123193,
            source_cvid: 'cv45123193',
            render_type: 'dynamic',
            canonical_url: 'https://www.bilibili.com/opus/1163549263798468617',
            render_payload: {
                data: {
                    item: {
                        modules: {
                            module_dynamic: {
                                major: {
                                    opus: {
                                        title: '一个月38元值吗？Apple Creator Studio软件上手体验'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    assert.strictEqual(meta.actualType, 'article')
    assert.strictEqual(meta.renderType, 'dynamic')
    assert.strictEqual(meta.url, 'https://www.bilibili.com/opus/1163549263798468617')
    assert.strictEqual(meta.title, '一个月38元值吗？Apple Creator Studio软件上手体验')
}

function testFeedSkipsArticleOriginOpusDynamics() {
    const shouldSkip = feedModule.shouldSkipDynamic({
        id_str: '1163549263798468617',
        type: 'DYNAMIC_TYPE_ARTICLE',
        modules: {
            module_dynamic: {
                major: {
                    type: 'MAJOR_TYPE_OPUS',
                    opus: {
                        jump_url: '//www.bilibili.com/opus/1163549263798468617'
                    }
                }
            }
        }
    })

    assert.strictEqual(shouldSkip, true)
}

function testFeedKeepsRegularOpusDynamics() {
    const shouldSkip = feedModule.shouldSkipDynamic({
        id_str: '1179264368735420423',
        type: 'DYNAMIC_TYPE_DRAW',
        modules: {
            module_dynamic: {
                major: {
                    type: 'MAJOR_TYPE_OPUS',
                    opus: {
                        jump_url: '//www.bilibili.com/opus/1179264368735420423'
                    }
                }
            }
        }
    })

    assert.strictEqual(shouldSkip, false)
}

function run() {
    testResolveArticleTitleKeepsArticleTypeAndCanonicalUrl()
    testFeedSkipsArticleOriginOpusDynamics()
    testFeedKeepsRegularOpusDynamics()
    console.log('PASS subscription-article-opus-resolution')
}

run()
