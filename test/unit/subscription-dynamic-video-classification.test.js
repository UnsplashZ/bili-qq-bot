#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { classifyArchiveDynamic } = require('../../src/services/subscription/updateChecker/helpers/archiveDynamic')
const feedModule = require('../../src/services/subscription/updateChecker/modules/feed')
const manualChecks = require('../../src/services/subscription/updateChecker/modules/manualChecks')

function createArchiveDynamicItem({ id = '1', pubAction = '', title = '', type = 'DYNAMIC_TYPE_AV' } = {}) {
    return {
        id_str: id,
        type,
        modules: {
            module_author: {
                pub_action: pubAction
            },
            module_dynamic: {
                major: {
                    type: 'MAJOR_TYPE_ARCHIVE',
                    archive: {
                        title
                    }
                }
            }
        }
    }
}

function createDynamicInfo(item) {
    return {
        status: 'success',
        type: 'dynamic',
        data: {
            item
        }
    }
}

function testClassifyArchiveDynamic() {
    assert.strictEqual(
        classifyArchiveDynamic(createArchiveDynamicItem({
            pubAction: '发布了动态视频',
            title: '动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
        })),
        'dynamic_video'
    )

    assert.strictEqual(
        classifyArchiveDynamic(createArchiveDynamicItem({
            pubAction: '投稿了视频',
            title: '24小时不间断？港口都在运些什么'
        })),
        'video_auto_post'
    )

    assert.strictEqual(
        classifyArchiveDynamic(createArchiveDynamicItem({
            pubAction: '',
            title: '动态视频｜是你叫的摩的吗？'
        })),
        'dynamic_video'
    )

    assert.strictEqual(
        classifyArchiveDynamic(createArchiveDynamicItem({
            pubAction: '',
            title: '普通视频标题'
        })),
        'unknown_archive_dynamic'
    )
}

function testShouldSkipDynamicUsesArchiveClassification() {
    assert.strictEqual(
        feedModule.shouldSkipDynamic(createArchiveDynamicItem({
            id: '1180316687231090707',
            pubAction: '发布了动态视频',
            title: '动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
        })),
        false
    )

    assert.strictEqual(
        feedModule.shouldSkipDynamic(createArchiveDynamicItem({
            id: '1179478790695288937',
            pubAction: '发布了动态视频',
            title: '动态视频｜是你叫的摩的吗？'
        })),
        false
    )

    assert.strictEqual(
        feedModule.shouldSkipDynamic(createArchiveDynamicItem({
            id: '1179201473206026260',
            pubAction: '投稿了视频',
            title: '24小时不间断？港口都在运些什么'
        })),
        true
    )
}

function testGenerateNotificationTextForDynamicVideo() {
    const dynamicVideoText = manualChecks.generateNotificationText(
        '影视飓风',
        createDynamicInfo(createArchiveDynamicItem({
            id: '1180316687231090707',
            pubAction: '发布了动态视频',
            title: '动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
        }))
    )
    assert.strictEqual(
        dynamicVideoText,
        '影视飓风 发布了动态视频：\n动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
    )

    const videoAutoPostText = manualChecks.generateNotificationText(
        '影视飓风',
        createDynamicInfo(createArchiveDynamicItem({
            id: '1179201473206026260',
            pubAction: '投稿了视频',
            title: '24小时不间断？港口都在运些什么'
        }))
    )
    assert.strictEqual(
        videoAutoPostText,
        '影视飓风 投稿了新视频：\n24小时不间断？港口都在运些什么'
    )

    const forwardDynamicVideoText = manualChecks.generateNotificationText('影视飓风', {
        status: 'success',
        type: 'forward',
        data: {
            item: {
                type: 'DYNAMIC_TYPE_FORWARD',
                orig: {
                    item: createArchiveDynamicItem({
                        id: '1180316687231090707',
                        pubAction: '发布了动态视频',
                        title: '动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
                    })
                }
            }
        }
    })
    assert.strictEqual(
        forwardDynamicVideoText,
        '影视飓风 转发了动态视频：\n动态视频｜卖电器的、卖算力的，来到了同一个展馆...'
    )
}

function run() {
    testClassifyArchiveDynamic()
    testShouldSkipDynamicUsesArchiveClassification()
    testGenerateNotificationTextForDynamicVideo()
    console.log('PASS subscription-dynamic-video-classification')
}

run()
