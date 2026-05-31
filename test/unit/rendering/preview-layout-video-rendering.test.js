#!/usr/bin/env node
'use strict'

const assert = require('assert')
const { renderVideoContent } = require('../../../src/services/imageGenerator/renderers/video')

describe('preview layout video renderer', function () {
    it('adds stable data-layout-key attributes for video elements', function () {
        const html = renderVideoContent({
            status: 'success',
            type: 'video',
            data: {
                title: '测试标题',
                desc: '测试简介',
                pic: 'https://example.com/cover.jpg',
                pubdate: 1710000000,
                duration: 120,
                owner: {
                    name: 'UP',
                    face: 'https://example.com/avatar.jpg',
                    official_verify: { type: 0 }
                },
                stat: {
                    view: 1,
                    like: 2,
                    reply: 3
                }
            }
        })

        for (const key of [
            'cover',
            'content',
            'header',
            'avatar',
            'authorName',
            'pubTime',
            'title',
            'stats',
            'text'
        ]) {
            assert.match(html, new RegExp(`data-layout-key="${key}"`))
        }
    })
})
