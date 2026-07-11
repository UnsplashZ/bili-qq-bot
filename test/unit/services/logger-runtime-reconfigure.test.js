'use strict'

const assert = require('assert')

const logger = require('../../../src/utils/logger')
const { createLogBuffer } = require('../../../src/dashboard/logBuffer')

describe('logger runtime reconfigure', function () {
    const originalWrite = process.stdout.write
    const originalEnv = {
        LOG_LEVEL: process.env.LOG_LEVEL,
        LOG_CHANNELS: process.env.LOG_CHANNELS
    }

    afterEach(function () {
        process.stdout.write = originalWrite
        if (originalEnv.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL
        else process.env.LOG_LEVEL = originalEnv.LOG_LEVEL
        if (originalEnv.LOG_CHANNELS === undefined) delete process.env.LOG_CHANNELS
        else process.env.LOG_CHANNELS = originalEnv.LOG_CHANNELS
        logger.reconfigure({ level: 'info', bufferSize: 2000 })
    })

    it('applies level and channel changes to the next event without consulting process.env', function () {
        process.env.LOG_LEVEL = 'fatal'
        process.env.LOG_CHANNELS = 'NOPE'
        const writes = []
        process.stdout.write = (chunk) => {
            writes.push(String(chunk))
            return true
        }

        logger.reconfigure({ level: 'debug', channels: ['SUB'], pretty: true })
        logger.logEvent('debug', 'SUB', 'test:logger', 'first-visible')
        logger.logEvent('error', 'BOT', 'test:logger', 'wrong-channel')
        logger.reconfigure({ level: 'error', channels: ['BOT'], pretty: true })
        logger.logEvent('warn', 'BOT', 'test:logger', 'below-new-level')
        logger.logEvent('error', 'BOT', 'test:logger', 'second-visible')

        const output = writes.join('')
        assert.match(output, /first-visible/)
        assert.match(output, /second-visible/)
        assert.doesNotMatch(output, /wrong-channel/)
        assert.doesNotMatch(output, /below-new-level/)
    })

    it('shrinks the buffer in place and retains only the latest N events', function () {
        const buffer = createLogBuffer({ maxSize: 4 })
        for (let index = 1; index <= 4; index += 1) {
            buffer.push({ action: `event-${index}`, severity: 30, channel: 'BOT' })
        }

        assert.equal(buffer.resize(2), 2)
        assert.equal(buffer.capacity(), 2)
        assert.deepEqual(buffer.list().map(event => event.action), ['event-3', 'event-4'])
    })
})
