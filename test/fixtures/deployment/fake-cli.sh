#!/usr/bin/env bash

set -euo pipefail

INSTALL_ROOT=${BILI_SETUP_CLI_INSTALL_ROOT:?}
STAGING_ROOT=${BILI_SETUP_CLI_STAGING_ROOT:-}
CONFIG_ROOT=${BILI_SETUP_CLI_CONFIG_ROOT:-$INSTALL_ROOT/config}
DATA_ROOT=${BILI_SETUP_CLI_DATA_ROOT:-$INSTALL_ROOT/data}
CALLS_FILE=${FAKE_CLI_CALLS_FILE:?}
printf '%q ' "$@" >> "$CALLS_FILE"
printf '\n' >> "$CALLS_FILE"

translate_path() {
    case "$1" in
        /install/*) printf '%s/%s\n' "$INSTALL_ROOT" "${1#/install/}" ;;
        /install) printf '%s\n' "$INSTALL_ROOT" ;;
        /staging/*) printf '%s/%s\n' "$STAGING_ROOT" "${1#/staging/}" ;;
        /staging) printf '%s\n' "$STAGING_ROOT" ;;
        /current/config/*) printf '%s/%s\n' "$CONFIG_ROOT" "${1#/current/config/}" ;;
        /current/config) printf '%s\n' "$CONFIG_ROOT" ;;
        /current/data/*) printf '%s/%s\n' "$DATA_ROOT" "${1#/current/data/}" ;;
        /current/data) printf '%s\n' "$DATA_ROOT" ;;
        *) printf '%s\n' "$1" ;;
    esac
}

if [ "${1:-}" = "node" ]; then shift; fi
entry=${1:-}
shift || true
if [ "$entry" = "-e" ]; then
    script=${1:-}
    shift || true
    translated=()
    for value in "$@"; do
        translated+=("$(translate_path "$value")")
    done
    exec node -e "$script" "${translated[@]}"
fi
domain=config
case "$entry" in
    *data-migrate.js) domain=data ;;
esac

command=${1:-}
shift || true

arg_value() {
    local wanted=$1
    shift
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "$wanted" ]; then
            translate_path "$2"
            return
        fi
        shift
    done
    return 1
}

write_config() {
    local output=$1
    mkdir -p "$(dirname "$output")"
    cat > "$output" <<'EOF'
version: 1
qq:
  provider: napcat
  napcat:
    wsUrl: ws://napcat:3001
    wsToken: fake-token
dashboard:
  listenPort: 3000
  jwtSecret: fake-jwt-secret
deployment:
  ports:
    dashboardHost: 3000
  mounts:
    config: ./config
    data: ./data
    logs: ./logs
    fonts: ./fonts/custom
    napcatConfig: ./napcat/config
    napcatQq: ./napcat/qq
EOF
    chmod 600 "$output"
}

case "$domain:$command" in
    config:init|config:migrate-legacy)
        if printf '%s\n' "$*" | grep -q -- '--dry-run'; then
            exit 0
        fi
        output=$(arg_value --output "$@")
        write_config "$output"
        ;;
    config:validate)
        config=$(arg_value --config "$@")
        [ -f "$config" ] || exit 4
        ;;
    config:record-deployment-applied)
        config=$(arg_value --config "$@")
        output=$(arg_value --output "$@")
        baseline=$(arg_value --baseline "$@" 2>/dev/null || true)
        release_epoch=$(arg_value --release-epoch "$@" 2>/dev/null || true)
        mkdir -p "$(dirname "$output")"
        node - "$config" "$output" "$baseline" "$release_epoch" "$FAKE_REPO_ROOT" <<'NODE'
const fs = require('fs')
const [configPath, outputPath, baselinePath, releaseEpoch, repoRoot] = process.argv.slice(2)
const YAML = require(`${repoRoot}/node_modules/yaml`)
const { createDeploymentBaseline, readDeploymentBaseline } = require(`${repoRoot}/src/config/deploymentBaseline`)
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'))
const previous = baselinePath && fs.existsSync(baselinePath) ? readDeploymentBaseline(baselinePath) : null
const value = createDeploymentBaseline(config, previous, { releaseEpoch })
fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
NODE
        chmod 600 "$output"
        ;;
    config:deployment-plan)
        config=$(arg_value --config "$@")
        existing=$(arg_value --existing-compose "$@" 2>/dev/null || true)
        if printf '%s\n' "$*" | grep -q -- '--dry-run'; then
            printf '{"ok":true,"action":"deployment-plan","plan":{"version":1,"requiresRelocation":false,"requiredOperationCount":0,"mounts":[]}}\n'
            exit 0
        fi
        output=$(arg_value --output "$@")
        mkdir -p "$(dirname "$output")"
        if [ -n "${FAKE_RELOCATE_DATA_SOURCE:-}" ]; then
            node - "$output" "$FAKE_RELOCATE_DATA_SOURCE" "$config" "$existing" <<'NODE'
const fs = require('fs')
const crypto = require('crypto')
const [output, newSource, configPath, composePath] = process.argv.slice(2)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(output, `${JSON.stringify({
  version: 1,
  configFingerprint: hash(configPath),
  existingComposeFingerprint: composePath ? hash(composePath) : null,
  provider: 'napcat',
  requiresRelocation: true,
  mounts: [{
    key: 'data',
    containerTarget: '/app/data',
    oldSource: './data',
    newSource,
    preserveRequired: true
  }],
  requiredOperationCount: 1,
  planFingerprint: 'c'.repeat(64)
})}\n`, { mode: 0o600 })
NODE
        else
            node - "$output" "$config" "$existing" <<'NODE'
const fs = require('fs')
const crypto = require('crypto')
const [output, configPath, composePath] = process.argv.slice(2)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.writeFileSync(output, `${JSON.stringify({
  version: 1,
  configFingerprint: hash(configPath),
  existingComposeFingerprint: composePath ? hash(composePath) : null,
  provider: 'napcat',
  requiresRelocation: false,
  mounts: [],
  requiredOperationCount: 0,
  planFingerprint: '0'.repeat(64)
})}\n`, { mode: 0o600 })
NODE
        fi
        ;;
    config:render-compose)
        [ "${FAKE_RENDER_COMPOSE_FAIL:-0}" != "1" ] || exit 17
        config=$(arg_value --config "$@")
        output=$(arg_value --output "$@")
        ownership=$(arg_value --ownership-output "$@")
        bot_image=$(arg_value --bot-image "$@" 2>/dev/null || printf 'sha256:target-image')
        napcat_image=$(arg_value --napcat-image "$@" 2>/dev/null || printf 'mlikiowa/napcat-docker:latest')
        if [ -n "${FAKE_RELOCATE_DATA_SOURCE:-}" ]; then
            artifact=$(arg_value --validated-relocation-artifact "$@")
            node -e '
const fs=require("fs")
const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))
if (value.operations.length !== 1 || value.operations[0].key !== "data" || value.operations[0].inventory.matched !== true) process.exit(2)
' "$artifact"
        fi
        mkdir -p "$(dirname "$output")"
        if grep -Eq 'provider:[[:space:]]*official' "$config"; then
            cat > "$output" <<EOF
services:
  bili-qq-bot:
    image: $bot_image
    pull_policy: never
    volumes:
      - ./config:/app/config
      - ${FAKE_RELOCATE_DATA_SOURCE:-./data}:/app/data
    ports:
      - "3000:3000"
EOF
        else
            cat > "$output" <<EOF
services:
  napcat:
    image: $napcat_image
    volumes:
      - ./napcat/config:/app/napcat/config
      - ./napcat/qq:/app/.config/QQ
  bili-qq-bot:
    image: $bot_image
    pull_policy: never
    volumes:
      - ./config:/app/config
      - ${FAKE_RELOCATE_DATA_SOURCE:-./data}:/app/data
      - ./napcat/qq:/app/.config/QQ
    ports:
      - "3000:3000"
EOF
        fi
        printf '{"version":1,"ownedPointers":["/services/bili-qq-bot/image"]}\n' > "$ownership"
        if [ "${FAKE_MUTATE_COMPOSE_AFTER_PLAN:-0}" = "1" ]; then
            printf '\n# concurrent user edit\n' >> "$INSTALL_ROOT/docker-compose.yml"
        fi
        ;;
    data:checkpoint)
        status=$(arg_value --status "$@")
        manifest=$(arg_value --manifest "$@")
        input=$(arg_value --input "$@")
        [ "${FAKE_CLI_FAIL_CHECKPOINT:-}" != "$status" ] || exit 9
        mkdir -p "$(dirname "$manifest")"
        node - "$manifest" "$input" "$status" <<'NODE'
const fs = require('fs')
const [manifestPath, inputPath, status] = process.argv.slice(2)
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {}
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
fs.writeFileSync(manifestPath, `${JSON.stringify({ ...previous, ...input, checkpoint: status })}\n`, { mode: 0o600 })
NODE
        ;;
    data:status)
        manifest=$(arg_value --manifest "$@")
        field=$(arg_value --field "$@")
        case "$field" in checkpoint|cutoverKind) ;; *) exit 2 ;; esac
        node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const field=process.argv[2];process.stdout.write(String(field === "checkpoint" ? (p.checkpoint||p.status||"") : (p.cutover?.cutoverKind||"")))' "$manifest" "$field"
        ;;
    data:check|data:apply|data:rollback)
        exit 0
        ;;
    *)
        printf 'unsupported fake CLI command: %s:%s\n' "$domain" "$command" >&2
        exit 2
        ;;
esac
