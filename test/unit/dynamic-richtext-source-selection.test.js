#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderDynamicContent } = require('../../src/services/imageGenerator/renderers/dynamic')

function buildDynamicPayload({
    descText = '',
    descNodes = [],
    summaryText = '',
    summaryNodes = []
} = {}) {
    return {
        data: {
            item: {
                id_str: '1176618467023912983',
                modules: {
                    module_author: {
                        name: 'tester',
                        face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                        pub_time: '2026-03-07 00:00:00'
                    },
                    module_dynamic: {
                        desc: {
                            text: descText,
                            rich_text_nodes: descNodes
                        },
                        major: {
                            type: 'MAJOR_TYPE_OPUS',
                            opus: {
                                title: 'opus title',
                                summary: {
                                    text: summaryText,
                                    rich_text_nodes: summaryNodes
                                },
                                pics: [
                                    { url: 'https://i0.hdslb.com/bfs/new_dyn/fec17e8c86e815bdc1ad8ce2b5bdbf9e1955897084.png' }
                                ]
                            }
                        }
                    },
                    module_stat: {
                        forward: { count: 1 },
                        like: { count: 2 },
                        comment: { count: 3 }
                    }
                }
            },
            pub_ts: 1700000000
        }
    }
}

function testPreferSummaryWhenDescHasEmptyAddressLabels() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: 'DESC_ONLY\n直播间地址：\n下载游戏：',
            descNodes: [],
            summaryText: 'SUMMARY_ONLY\n直播间地址：https://live.bilibili.com/27354807\n下载游戏：https://www.biligame.com/detail/?id=108820',
            summaryNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: 'SUMMARY_ONLY\n直播间地址：' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://live.bilibili.com/27354807' },
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '\n下载游戏：' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://www.biligame.com/detail/?id=108820' }
            ]
        })
    )

    assert.ok(html.includes('SUMMARY_ONLY'), '期望命中 summary 文本标记')
    assert.ok(!html.includes('DESC_ONLY'), '不应继续使用 desc 文本标记')
}

function testKeepDescWhenDescHasRichLinkNodes() {
    const html = renderDynamicContent(
        buildDynamicPayload({
            descText: 'DESC_PRIORITY',
            descNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: 'DESC_PRIORITY ' },
                { type: 'RICH_TEXT_NODE_TYPE_URL', text: 'https://example.com', jump_url: 'https://example.com' }
            ],
            summaryText: 'SUMMARY_SHOULD_NOT_USE',
            summaryNodes: [
                { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: 'SUMMARY_SHOULD_NOT_USE' },
                { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://not-used.example' }
            ]
        })
    )

    assert.ok(html.includes('DESC_PRIORITY'), 'desc 有有效链接节点时应保持 desc 优先')
    assert.ok(!html.includes('SUMMARY_SHOULD_NOT_USE'), 'desc 有效时不应切到 summary')
}

function run() {
    testPreferSummaryWhenDescHasEmptyAddressLabels()
    testKeepDescWhenDescHasRichLinkNodes()
    console.log('PASS dynamic-richtext-source-selection')
}

run()
