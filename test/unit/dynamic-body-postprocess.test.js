#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { injectTopicNodeIfNeeded } = require('../../src/services/imageGenerator/renderers/components/dynamicBodyPostprocess')

function testInjectTopicNodeSplitsExistingTextWhenTopicIsPresent() {
    const nodes = [
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: '正文 #原神# 结束',
            orig_text: '正文 #原神# 结束'
        }
    ]

    const nextNodes = injectTopicNodeIfNeeded(nodes, { name: '原神', id: 123 }, '正文 #原神# 结束')

    assert.strictEqual(nextNodes.some(node => node.type === 'RICH_TEXT_NODE_TYPE_TOPIC'), true)
    assert.strictEqual(nextNodes[1].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(nextNodes[1].jump_url, 'https://www.bilibili.com/v/topic/detail/?topic_id=123')
}

function testInjectTopicNodeKeepsExistingTopicNodeUntouched() {
    const nodes = [
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '#原神#',
            orig_text: '#原神#'
        }
    ]

    const nextNodes = injectTopicNodeIfNeeded(nodes, { name: '原神', id: 123 }, '#原神#')

    assert.deepStrictEqual(nextNodes, nodes)
}

function testInjectTopicNodeStillAddsCurrentTopicWhenOtherTopicExists() {
    const nodes = [
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '#崩坏星穹铁道#',
            orig_text: '#崩坏星穹铁道#'
        },
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: ' 正文',
            orig_text: ' 正文'
        }
    ]

    const nextNodes = injectTopicNodeIfNeeded(
        nodes,
        { name: '原神', id: 123 },
        '#崩坏星穹铁道# 正文'
    )

    assert.strictEqual(nextNodes[0].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(nextNodes[0].text, '原神')
    assert.strictEqual(nextNodes[2].type, 'RICH_TEXT_NODE_TYPE_TOPIC')
    assert.strictEqual(nextNodes[2].text, '#崩坏星穹铁道#')
}

function testInjectTopicNodeRecognizesPlainTopicNameAsCurrentTopic() {
    const nodes = [
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: '原神',
            orig_text: '原神'
        }
    ]

    const nextNodes = injectTopicNodeIfNeeded(nodes, { name: '原神', id: 123 }, '原神')

    assert.deepStrictEqual(nextNodes, nodes)
}

function run() {
    testInjectTopicNodeSplitsExistingTextWhenTopicIsPresent()
    testInjectTopicNodeKeepsExistingTopicNodeUntouched()
    testInjectTopicNodeStillAddsCurrentTopicWhenOtherTopicExists()
    testInjectTopicNodeRecognizesPlainTopicNameAsCurrentTopic()
    console.log('PASS dynamic-body-postprocess')
}

run()
