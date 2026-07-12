#!/usr/bin/env node
'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const { redactSensitive } = require('../../../src/utils/redactSensitive')

describe('logger redaction', () => {
    it('redacts sensitive fields and authorization values', () => {
        const event = logger.logEvent('info', 'TEST', 'svc:redaction', 'redaction-check', {
            clientSecret: 'very-secret',
            access_token: 'raw-token',
            nested: {
                authorization: 'QQBot raw-token-value'
            },
            message: 'Bearer another-token-value'
        })

        const rendered = JSON.stringify(event)
        assert.ok(!rendered.includes('very-secret'))
        assert.ok(!rendered.includes('raw-token-value'))
        assert.ok(!rendered.includes('another-token-value'))
        assert.ok(rendered.includes('[REDACTED]'))
    })

    it('keeps safe token status metadata while redacting raw token values', () => {
        const redacted = redactSensitive({
            token: 'raw-token-value',
            tokenTtlSeconds: 3600,
            tokenConfigured: true,
            nested: {
                access_token: 'raw-access-token'
            }
        })

        assert.equal(redacted.token, '[REDACTED]')
        assert.equal(redacted.tokenTtlSeconds, 3600)
        assert.equal(redacted.tokenConfigured, true)
        assert.equal(redacted.nested.access_token, '[REDACTED]')
    })
})
