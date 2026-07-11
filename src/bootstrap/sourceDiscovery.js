'use strict'

const fs = require('fs')
const path = require('path')
const { readPrivateText } = require('../migrations/common/privateFile')
const { parseConfigYaml } = require('../migrations/config/configDocument')
const { LEGACY_FILES } = require('../migrations/config/legacyLoader')
const { ApplicationBootstrapError } = require('./bootstrapErrors')

const ARCHIVABLE_LEGACY_FILES = [
    '.env', '.env.example', 'config.json', 'config.json.example',
    '.jwtSecret', '.jwtSecret.example', '.qqOfficialClientSecret', '.qqOfficialClientSecret.example'
]

function discoverConfigSource(options = {}) {
    const configDir = path.resolve(options.configDir)
    const configPath = path.join(configDir, 'config.yaml')
    try {
        const source = readPrivateText(configPath, {
            mode: 0o600,
            fileCode: 'CONFIG_FILE_UNSAFE',
            linkCode: 'CONFIG_FILE_UNSAFE',
            permissionCode: 'CONFIG_FILE_PERMISSION_UNSAFE'
        })
        const parsed = parseConfigYaml(source)
        return { sourceClass: 'managed-v1+', configPath, source, value: parsed.value, legacyFiles: [] }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
    const legacyFiles = ARCHIVABLE_LEGACY_FILES
        .filter((name) => {
            try {
                return fs.lstatSync(path.join(configDir, name)).isFile()
            } catch (error) {
                if (error?.code === 'ENOENT') return false
                throw error
            }
        })
    if (legacyFiles.length > 0) return { sourceClass: 'legacy-v0', configPath, legacyFiles }
    if (options.installInput || options.createIfMissing) return { sourceClass: 'fresh-install', configPath, legacyFiles: [] }
    throw new ApplicationBootstrapError('CONFIG_BOOTSTRAP_INVALID_INPUT')
}

module.exports = { discoverConfigSource, ARCHIVABLE_LEGACY_FILES }
