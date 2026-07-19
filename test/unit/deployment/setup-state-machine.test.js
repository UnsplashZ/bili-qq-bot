'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const YAML = require('yaml')

const repoRoot = path.join(__dirname, '../../..')
const setupScript = path.join(repoRoot, 'setup.sh')

function writeFakeDocker(fakeBin) {
    fs.mkdirSync(fakeBin, { recursive: true })
    fs.writeFileSync(path.join(fakeBin, 'docker'), `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = "info" ]; then exit 0; fi
if [ "$1" = "inspect" ]; then printf '%s\n' "\${BILI_TEST_HEALTH_STATE:-healthy}"; exit 0; fi
if [ "$1" = "exec" ]; then [ "\${BILI_TEST_READY_STATE:-ready}" = "ready" ]; exit $?; fi
if [ "$1" = "logs" ]; then echo "Login Success"; exit 0; fi
if [ "$1" = "run" ]; then
    previous=''
    for argument in "$@"; do
        if [ "$previous" = "-v" ]; then
            host_path="\${argument%%:/install}"
            mkdir -p "$host_path/config"
            printf 'version: 1\n' > "$host_path/config/config.yaml"
        fi
        previous="$argument"
    done
    exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then exit 0; fi
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "-f" ]; then shift 2; fi
    if [ "$1 $2 $3" = "ps -q bili-qq-bot" ]; then echo "bot-container"; exit 0; fi
fi
exit 0
`, { mode: 0o755 })
}

function runSetup({ installDir, fakeBin, dockerLog, inputs = [], env = {} }) {
    return childProcess.spawnSync('bash', [setupScript], {
        cwd: repoRoot,
        input: [installDir, ...inputs].join('\n') + '\n',
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            BILI_SETUP_TEST_MODE: '1',
            DOCKER_LOG: dockerLog,
            ...env
        }
    })
}

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

    it('validates setup inputs and atomically publishes downloaded Compose files', () => {
        assert.match(source, /validate_qq_number/)
        assert.match(source, /validate_port/)
        assert.match(source, /validate_image_reference/)
        assert.match(source, /validate_ws_token/)
        assert.match(source, /validate_ws_url/)
        assert.match(source, /mktemp/)
        assert.match(source, /mv -f "\$temp_file" "\$compose_file"/)
    })

    it('embeds the release-matched Compose template instead of downloading future main', () => {
        assert.doesNotMatch(source, /refs\/heads\/main\/docker-compose\.yml/)
        const match = source.match(/write_compose_template\(\) \{[\s\S]*?<<'EOF'\n([\s\S]*?)\nEOF\n}/)
        assert.ok(match, 'embedded Compose template not found')
        const embedded = YAML.parse(match[1])
        const repository = YAML.parse(fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8'))
        assert.strictEqual(embedded.services['bili-qq-bot'].stop_grace_period, repository.services['bili-qq-bot'].stop_grace_period)
        assert.strictEqual(embedded.services['bili-qq-bot'].stop_grace_period, '420s')
        assert.deepStrictEqual(embedded.services['bili-qq-bot'].volumes, repository.services['bili-qq-bot'].volumes)
        assert.deepStrictEqual(embedded.services.napcat.volumes, repository.services.napcat.volumes)
    })

    it('updates only containers when an existing installation is detected', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-existing-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        const composeSource = 'services:\n  bili-qq-bot:\n    image: existing/image:tag\n'
        const configSource = 'version: 1\nqq:\n  provider: napcat\n'
        const envSource = 'BILI_BOT_IMAGE=existing/image:tag\n'

        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), composeSource)
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), configSource)
        fs.writeFileSync(path.join(installDir, '.env'), envSource)
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({ installDir, fakeBin, dockerLog })

            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /检测到已有安装，仅更新现有容器/)
            assert.match(result.stdout, /现有配置和数据均已保留/)
            assert.equal(fs.readFileSync(path.join(installDir, 'docker-compose.yml'), 'utf8'), composeSource)
            assert.equal(fs.readFileSync(path.join(installDir, 'config/config.yaml'), 'utf8'), configSource)
            assert.equal(fs.readFileSync(path.join(installDir, '.env'), 'utf8'), envSource)
            assert.equal(fs.existsSync(path.join(installDir, 'data')), false)

            const dockerCalls = fs.readFileSync(dockerLog, 'utf8')
            assert.match(dockerCalls, /^info$/m)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml config -q/)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml pull/)
            assert.match(dockerCalls, /compose -f .*docker-compose\.yml up -d/)
            assert.match(dockerCalls, /inspect --format/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('recognizes all standard Compose filenames for existing installations', () => {
        for (const composeName of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-compose-name-'))
            const installDir = path.join(tempRoot, 'install')
            const fakeBin = path.join(tempRoot, 'bin')
            const dockerLog = path.join(tempRoot, 'docker.log')
            fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
            fs.writeFileSync(path.join(installDir, composeName), 'services: {}\n')
            fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
            writeFakeDocker(fakeBin)

            try {
                const result = runSetup({ installDir, fakeBin, dockerLog })
                assert.equal(result.status, 0, `${composeName}: ${result.stderr || result.stdout}`)
                assert.match(result.stdout, /仅更新现有容器/)
                assert.match(fs.readFileSync(dockerLog, 'utf8'), new RegExp(`compose -f .*${composeName.replace('.', '\\.')}`))
            } finally {
                fs.rmSync(tempRoot, { recursive: true, force: true })
            }
        }
    })

    it('fails an update when the Bot container is unhealthy', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-unhealthy-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services: {}\n')
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                env: { BILI_TEST_HEALTH_STATE: 'unhealthy' }
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /未在规定时间内进入 ready 状态/)
            assert.doesNotMatch(result.stdout, /容器更新完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('fails an update when the application never becomes ready', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-not-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        fs.mkdirSync(path.join(installDir, 'config'), { recursive: true })
        fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services: {}\n')
        fs.writeFileSync(path.join(installDir, 'config/config.yaml'), 'version: 1\n')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                env: {
                    BILI_TEST_HEALTH_STATE: 'healthy',
                    BILI_TEST_READY_STATE: 'not-ready',
                    BILI_SETUP_READY_TIMEOUT: '1',
                    BILI_SETUP_POLL_INTERVAL: '0.05'
                }
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /未在规定时间内进入 ready 状态/)
            assert.doesNotMatch(result.stdout, /容器更新完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    }).timeout(5000)

    it('does not report a fresh install complete until the application is ready', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fresh-not-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['', '', '123456', '', '', '654321', '', '', 'n'],
                env: {
                    BILI_TEST_HEALTH_STATE: 'healthy',
                    BILI_TEST_READY_STATE: 'not-ready',
                    BILI_SETUP_READY_TIMEOUT: '1',
                    BILI_SETUP_POLL_INTERVAL: '0.05'
                }
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /NapCat 或 Bot 未在规定时间内进入 ready 状态/)
            assert.doesNotMatch(result.stdout, /部署完成/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    }).timeout(5000)

    it('reports a fresh install complete after health and readiness both pass', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-fresh-ready-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['', '', '123456', '', '', '654321', '', '', 'n']
            })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.match(result.stdout, /部署完成/)
            assert.match(fs.readFileSync(dockerLog, 'utf8'), /exec bot-container node -e .*api\/ready/)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })

    it('rejects unsafe first-install inputs before writing NapCat JSON', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-setup-invalid-token-'))
        const installDir = path.join(tempRoot, 'install')
        const fakeBin = path.join(tempRoot, 'bin')
        const dockerLog = path.join(tempRoot, 'docker.log')
        writeFakeDocker(fakeBin)

        try {
            const result = runSetup({
                installDir,
                fakeBin,
                dockerLog,
                inputs: ['', '', '123456', 'bad"token']
            })
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /Token 仅支持/)
            assert.equal(fs.existsSync(path.join(installDir, 'napcat/config/onebot11_123456.json')), false)
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    })
})
