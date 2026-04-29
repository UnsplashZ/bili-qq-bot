#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { parseRichText } = require('../../../src/services/imageGenerator/renderers/components/richtext')

function testWebNodeRendersIconAndUrlFallback() {
    const html = parseRichText([
        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '直播间地址：' },
        { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://live.bilibili.com/27354807' },
        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '\n下载游戏：' },
        { type: 'RICH_TEXT_NODE_TYPE_WEB', text: '网页链接', jump_url: 'https://www.biligame.com/detail/?id=108820' }
    ], '')

    assert.ok(html.includes('rt-link-inline'), 'WEB 节点应输出统一链接容器类')
    assert.ok(html.includes('rt-link-icon'), 'WEB 节点应输出图标类')
    assert.ok(html.includes('<svg'), 'WEB 节点应内联 SVG，才能继承文本颜色')
    assert.ok(html.includes('>网页链接</span>'), 'WEB 节点应显示原网页文案')
    assert.ok(html.includes('title="https://live.bilibili.com/27354807"'), '实际链接应保留在 title 属性')
    assert.ok(html.includes('title="https://www.biligame.com/detail/?id=108820"'), '下载链接应保留在 title 属性')
}

function testTopicAndGoodsUseLinkStyle() {
    const html = parseRichText([
        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#鸣潮#' },
        { type: 'RICH_TEXT_NODE_TYPE_TEXT', text: ' ' },
        { type: 'RICH_TEXT_NODE_TYPE_GOODS', text: '商品链接' }
    ], '')

    assert.ok(html.includes('#鸣潮#'))
    assert.ok(html.includes('商品链接'))
    assert.ok(html.includes('rt-link-text'), 'TOPIC/GOODS 应使用统一链接文本类')
}

function testPlainSearchTopicNodeUsesTextStyleOnly() {
    const html = parseRichText([
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '#原神#',
            jump_url: '//search.bilibili.com/all?keyword=%E5%8E%9F%E7%A5%9E'
        }
    ], '')

    assert.ok(html.includes('#原神#'), '普通搜索话题应继续显示文本')
    assert.ok(html.includes('topic-tag'), '普通搜索话题应保留 topic 样式类')
    assert.ok(!html.includes('rt-link-inline'), '普通搜索话题不应走图标容器')
    assert.ok(!html.includes('rt-link-icon'), '普通搜索话题不应输出 SVG 图标')
}

function testTopicDetailNodeRendersInlineIcon() {
    const html = parseRichText([
        { type: 'RICH_TEXT_NODE_TYPE_TOPIC', text: '#元宵快乐#', jump_url: 'https://www.bilibili.com/v/topic/detail/?topic_id=1' }
    ], '')

    assert.ok(html.includes('rt-link-inline'), 'TOPIC 节点应走图标型富文本容器')
    assert.ok(html.includes('rt-link-icon'), 'TOPIC 节点应输出图标容器')
    assert.ok(html.includes('rt-link-icon-svg'), 'TOPIC 图标应以内联 SVG 输出')
    assert.ok(html.includes('#元宵快乐#'), 'TOPIC 节点应继续显示话题文本')
}

function run() {
    testWebNodeRendersIconAndUrlFallback()
    testTopicAndGoodsUseLinkStyle()
    testPlainSearchTopicNodeUsesTextStyleOnly()
    testTopicDetailNodeRendersInlineIcon()
    console.log('PASS richtext-node-rendering')
}

run()
