'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '../../..')
const setupScript = path.join(repoRoot, 'setup.sh')

describe('setup.sh lightweight deployment contract', () => {
    let source

    before(() => {
        source = fs.readFileSync(setupScript, 'utf8')
    })

    it('keeps one interactive deployment flow without lifecycle modes', () => {
        for (const removedMode of ['--install', '--upgrade', '--apply', '--dry-run']) {
            assert.ok(!source.includes(removedMode), `unexpected deployment mode: ${removedMode}`)
        }
        assert.match(source, /请输入安装目录/)
        assert.match(source, /compose pull/)
        assert.match(source, /compose up -d/)
    })

    it('generates the canonical YAML config through the application Config CLI', () => {
        assert.match(source, /src\/cli\/config/)
        assert.match(source, /config\/config\.yaml/)
        assert.match(source, /"init"/)
        assert.match(source, /"--provider", "napcat"/)
        assert.match(source, /SETUP_WS_TOKEN/)
        assert.match(source, /SETUP_ADMIN_QQ/)
        assert.match(source, /SETUP_DASHBOARD_PASSWORD/)
    })

    it('does not own migration, publication or recovery transactions', () => {
        for (const removedConcern of [
            'mount-writers.tsv',
            'upgrade-manifest.json',
            'publication-journal',
            'checkpointManifest',
            'discover_mount_writers',
            'rollback_publication'
        ]) {
            assert.ok(!source.includes(removedConcern), `unexpected setup responsibility: ${removedConcern}`)
        }
    })

    it('retains the v3.24.6 deployment essentials', () => {
        assert.match(source, /onebot11_\$bot_qq\.json/)
        assert.match(source, /docker-compose\.yml/)
        assert.match(source, /wait_for_napcat_login/)
        assert.match(source, /fonts\/custom/)
        assert.match(source, /docker logs -f bili-qq-bot/)
    })
})
