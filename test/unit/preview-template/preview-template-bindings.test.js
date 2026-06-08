'use strict'

const assert = require('assert')

const {
    createSafeViewModel,
    resolveBinding,
    safeImageUrl
} = require('../../../src/services/previewTemplate/bindings')
const { PreviewTemplateValidationError } = require('../../../src/services/previewTemplate/normalizer')

describe('preview template bindings', function () {
    it('builds a safe video view model and resolves plain values', function () {
        const model = createSafeViewModel('video', {
            data: {
                bvid: 'BV1xx',
                title: '<b>标题</b>',
                pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
                desc: '简介',
                duration: 125,
                pubdate: 1700000000,
                owner: {
                    name: 'UP',
                    face: 'https://i0.hdslb.com/bfs/face/a.jpg',
                    mid: 42
                },
                stat: {
                    view: 12345,
                    like: 678,
                    reply: 9
                },
                render_payload: {
                    secret: true
                }
            }
        }, { typeLabel: '视频' })

        assert.strictEqual(model.video.title, '标题')
        assert.strictEqual(model.video.cover, 'https://i0.hdslb.com/bfs/archive/cover.jpg')
        assert.strictEqual(model.author.name, 'UP')
        assert.strictEqual(model.card.typeLabel, '视频')
        assert.ok(!('render_payload' in model))
        assert.strictEqual(resolveBinding({ source: 'video.title', format: 'plainText' }, model), '标题')
        assert.strictEqual(resolveBinding({ source: 'stats.views', format: 'numberCompact' }, model), '1.2万')
        assert.strictEqual(resolveBinding({ source: 'video.duration', format: 'duration' }, model), '2:05')
    })

    it('does not expose raw paths and rejects unsafe image URLs', function () {
        assert.throws(
            () => resolveBinding({ source: 'render_payload.data.title' }, {}),
            PreviewTemplateValidationError
        )
        assert.strictEqual(safeImageUrl('javascript:alert(1)'), '')
        assert.strictEqual(safeImageUrl('data:image/svg+xml;charset=UTF-8,%3Csvg%3E%3C/svg%3E'), '')
        assert.strictEqual(safeImageUrl('http://i0.hdslb.com/bfs/archive/cover.jpg'), '')
        assert.strictEqual(safeImageUrl('https://example.com/cover.jpg'), '')
        assert.strictEqual(safeImageUrl('https://i0.hdslb.com/bfs/archive/cover.jpg'), 'https://i0.hdslb.com/bfs/archive/cover.jpg')
        assert.strictEqual(resolveBinding({ source: 'static', value: 'fallback', format: 'plainText' }, {}), 'fallback')
        assert.strictEqual(resolveBinding({ source: 'static', value: 'https://example.com/a.jpg', format: 'imageUrl' }, {}), '')
    })

    it('keeps internal svg placeholders from safe view model sources only', function () {
        const placeholder = 'data:image/svg+xml;charset=UTF-8,%3Csvg%3E%3C%2Fsvg%3E'
        const model = createSafeViewModel('video', {
            data: {
                title: '结构示例',
                pic: placeholder,
                owner: {
                    name: 'UP',
                    face: placeholder
                }
            }
        })

        assert.strictEqual(model.video.cover, placeholder)
        assert.strictEqual(model.author.avatar, placeholder)
        assert.strictEqual(resolveBinding({ source: 'video.cover', format: 'imageUrl' }, model), placeholder)
        assert.strictEqual(resolveBinding({ source: 'static', value: placeholder, format: 'imageUrl' }, model), '')
    })

    it('honors hide-sensitive user uid source through safe model options', function () {
        const hidden = createSafeViewModel('user', {
            data: {
                uid: 123,
                name: '用户',
                face: 'https://i0.hdslb.com/bfs/face/u.jpg'
            }
        }, { showId: false })
        assert.strictEqual(resolveBinding({ source: 'user.uid', fallback: '', format: 'plainText' }, hidden), '')

        const visible = createSafeViewModel('user', {
            data: {
                uid: 123,
                name: '用户',
                face: 'https://i0.hdslb.com/bfs/face/u.jpg'
            }
        }, { showId: true })
        assert.strictEqual(resolveBinding({ source: 'user.uid', fallback: '', format: 'plainText' }, visible), 'UID: 123')
    })
})
