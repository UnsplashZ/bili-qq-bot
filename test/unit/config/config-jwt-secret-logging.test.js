#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fsp = require('fs').promises
const os = require('os')
const path = require('path')
const logger = require('../../../src/utils/logger')
const { ConfigService } = require('../../../src/config/configService')

async function run() {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'config-jwt-secret-'))
    const configDir = path.join(root, 'config')
    const legacySecret = 'legacy-secret-must-not-be-loaded'
    const logs = []
    const off = logger.onLog((entry) => logs.push(JSON.stringify(entry)))
    const service = new ConfigService({
        configDir,
        stateDir: path.join(root, 'data', 'config-state')
    })

    try {
        await fsp.mkdir(configDir, { recursive: true })
        await fsp.writeFile(path.join(configDir, '.jwtSecret'), legacySecret, { mode: 0o600 })
        await service.initialize({ createIfMissing: true })

        assert.notStrictEqual(service.get('jwtSecret'), legacySecret)
        assert.deepStrictEqual(service.getPublicSnapshot().dashboard.jwtSecret, { configured: true })
        assert.ok(!logs.join('\n').includes(legacySecret))
        assert.ok(!logs.join('\n').includes('.jwtSecret'))
        console.log('✓ ConfigService 不读取/记录 legacy .jwtSecret，且公开快照仅返回 configured marker')
    } finally {
        off()
        await service.stop().catch(() => {})
        await fsp.rm(root, { recursive: true, force: true })
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
