#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderArticleContent } = require('../../../src/services/imageGenerator/renderers/article')

function testArticleRendererDelegatesToDynamicRendererWhenRenderTypeIsDynamic() {
    const html = renderArticleContent({
        data: {
            render_type: 'dynamic',
            author_name: '影视飓风',
            author_face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
            author_pendant_url: 'https://i0.hdslb.com/bfs/garb/item/pendant.png',
            author_nameplate_url: 'https://i0.hdslb.com/bfs/face/nameplate.png',
            author_card_number: '1024',
            author_fan_color: '#ff6699',
            author_level: 6,
            author_official_verify_type: 1,
            banner_url: '',
            image_urls: [],
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

    assert.ok(html.includes('article-cover-container'), '应渲染文章封面容器')
    assert.ok(html.includes('cover article'), '应渲染文章封面图')
    assert.ok(html.includes('article-excerpt'), '应渲染文章摘要区')
    assert.ok(html.includes('article-stats'), '应渲染文章底部统计')
    assert.ok(html.includes('avatar-frame'), '应渲染文章作者头像框')
    assert.ok(html.includes('user-level lv6'), '应渲染文章作者等级')
    assert.ok(html.includes('decoration-card'), '应渲染文章作者右侧装饰牌')
    assert.ok(html.includes('serial-badge'), '应渲染文章作者编号徽标')
    assert.ok(html.includes('01月30日 12:45'), '应回退渲染动态作者发布时间')
    assert.ok(html.includes('一个月38元值吗？Apple Creator Studio软件上手体验'))
    assert.ok(!html.includes('action-bar'), '动态承载专栏不应再复用动态操作栏')
    assert.ok(!html.includes('user-vip-label'), '文章卡不应渲染大会员标签')
}

function run() {
    testArticleRendererDelegatesToDynamicRendererWhenRenderTypeIsDynamic()
    console.log('PASS article-render-type-routing')
}

run()
