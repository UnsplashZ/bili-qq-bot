'use strict'

const assert = require('assert')

const { renderUserCards } = require('../../../src/services/imageGenerator/generators/subscriptionList')

describe('subscription list image rendering', () => {
    it('renders verify badge markup and avatar fallback handler', () => {
        const html = renderUserCards([
            {
                uid: '123',
                name: '认证用户',
                face: '',
                officialVerify: {
                    type: 1,
                    desc: '机构认证'
                }
            }
        ], true)

        assert.match(html, /author-verify-badge/)
        assert.match(html, /onerror=/)
        assert.match(html, /UID:123/)
    })
})
