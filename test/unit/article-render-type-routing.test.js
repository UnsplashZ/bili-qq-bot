#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderArticleContent } = require('../../src/services/imageGenerator/renderers/article')

function testArticleRendererDelegatesToDynamicRendererWhenRenderTypeIsDynamic() {
    const html = renderArticleContent({
        data: {
            render_type: 'dynamic',
            render_payload: {
                data: {
                    item: {
                        id_str: '1163549263798468617',
                        type: 'DYNAMIC_TYPE_ARTICLE',
                        modules: {
                            module_author: {
                                name: '影视飓风',
                                face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                                pub_time: '01月30日 12:45'
                            },
                            module_dynamic: {
                                desc: {
                                    text: '大家好我是大橙，这是完整正文',
                                    rich_text_nodes: []
                                },
                                major: {
                                    type: 'MAJOR_TYPE_OPUS',
                                    opus: {
                                        title: '一个月38元值吗？Apple Creator Studio软件上手体验',
                                        summary: {
                                            text: '大家好我是大橙，这是完整正文',
                                            rich_text_nodes: []
                                        },
                                        pics: [
                                            { url: 'https://i0.hdslb.com/bfs/new_dyn/test.jpg' }
                                        ]
                                    }
                                }
                            },
                            module_stat: {
                                forward: { count: 34 },
                                comment: { count: 391 },
                                like: { count: 9668 }
                            }
                        }
                    }
                }
            }
        }
    })

    assert.ok(html.includes('action-bar'), '应复用动态 renderer 的操作栏')
    assert.ok(html.includes('text-content'), '应渲染动态正文')
    assert.ok(html.includes('一个月38元值吗？Apple Creator Studio软件上手体验'))
    assert.ok(!html.includes('article-body'), '动态承载专栏不应走旧 article-body 正文')
}

function run() {
    testArticleRendererDelegatesToDynamicRendererWhenRenderTypeIsDynamic()
    console.log('PASS article-render-type-routing')
}

run()
