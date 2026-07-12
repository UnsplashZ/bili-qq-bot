#!/usr/bin/env node
'use strict'

const assert = require('assert')

const { redactString } = require('../../../tools/qq-official-smoke')

describe('qq official smoke redaction', () => {
    const originalSecret = process.env.QQ_OFFICIAL_CLIENT_SECRET

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.QQ_OFFICIAL_CLIENT_SECRET
        } else {
            process.env.QQ_OFFICIAL_CLIENT_SECRET = originalSecret
        }
    })

    it('redacts known secrets and authorization-style tokens', () => {
        process.env.QQ_OFFICIAL_CLIENT_SECRET = 'unit-secret-value'
        const redacted = redactString(
            'failed Bearer token-value access_token=abc client_secret=unit-secret-value authorization: raw-token'
        )

        assert.equal(redacted.includes('unit-secret-value'), false)
        assert.equal(redacted.includes('token-value'), false)
        assert.equal(redacted.includes('raw-token'), false)
        assert.match(redacted, /\[REDACTED\]/)
    })
})
