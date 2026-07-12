#!/usr/bin/env bash

set -euo pipefail

STATE_DIR=${FAKE_DOCKER_STATE_DIR:?FAKE_DOCKER_STATE_DIR is required}
INSTALL_DIR=${FAKE_INSTALL_DIR:?FAKE_INSTALL_DIR is required}
CALLS_FILE="$STATE_DIR/calls.log"
mkdir -p "$STATE_DIR"
touch "$CALLS_FILE"
printf '%q ' "$@" >> "$CALLS_FILE"
printf '\n' >> "$CALLS_FILE"

state_file() {
    printf '%s/%s.%s\n' "$STATE_DIR" "$1" "$2"
}

get_state() {
    local id=$1
    local key=$2
    local fallback=${3:-}
    local file
    file=$(state_file "$id" "$key")
    if [ -f "$file" ]; then
        cat "$file"
    else
        printf '%s\n' "$fallback"
    fi
}

set_state() {
    printf '%s\n' "$3" > "$(state_file "$1" "$2")"
}

service_id() {
    case "$1" in
        bili-qq-bot) printf 'bot-old\n' ;;
        napcat) printf 'napcat-old\n' ;;
        *) return 0 ;;
    esac
}

command=${1:-}
shift || true

case "$command" in
    compose)
        if [ "${1:-}" = "version" ]; then
            printf 'Docker Compose version fake\n'
            exit 0
        fi
        args=("$@")
        subcommand=""
        service=""
        index=0
        while [ "$index" -lt "${#args[@]}" ]; do
            value=${args[$index]}
            case "$value" in
                -f|--file)
                    index=$((index + 2))
                    continue
                    ;;
                ps|config|up|down)
                    subcommand=$value
                    ;;
                bili-qq-bot|napcat)
                    service=$value
                    ;;
            esac
            index=$((index + 1))
        done
        case "$subcommand" in
            ps)
                service_id "$service"
                ;;
            config)
                [ "${FAKE_COMPOSE_CONFIG_FAIL:-0}" != "1" ]
                ;;
            down)
                [ "${FAKE_ROLLBACK_DOWN_FAIL:-0}" != "1" ] || exit 31
                set_state bot-old running false
                set_state napcat-old running false
                [ "${FAKE_NAPCAT_ROLLBACK_DISAPPEARS_ON_DOWN:-0}" != "1" ] || : > "$STATE_DIR/napcat-rollback-missing"
                ;;
            up)
                if printf '%s\n' "${args[*]}" | grep -q 'rollback-compose' && [ "${FAKE_ROLLBACK_UP_FAIL:-0}" = "1" ]; then
                    exit 32
                fi
                if printf '%s\n' "${args[*]}" | grep -q 'runtime-probe' && [ "${FAKE_CRASH_ON_RUNTIME_PROBE_UP:-0}" = "1" ]; then
                    kill -KILL "$PPID"
                    exit 137
                fi
                if printf '%s\n' "${args[*]}" | grep -q 'runtime-release' && [ "${FAKE_CRASH_ON_RUNTIME_RELEASE_UP:-0}" = "1" ]; then
                    kill -KILL "$PPID"
                    exit 137
                fi
                set_state bot-old running true
                set_state napcat-old running true
                if printf '%s\n' "${args[*]}" | grep -q 'runtime-probe'; then
                    printf 'probe\n' > "$STATE_DIR/runtime-mode"
                    if [ ! -f "$INSTALL_DIR/config/config.yaml" ]; then
                        bootstrap_input="$INSTALL_DIR/data/setup-state/${BILI_SETUP_ATTEMPT_ID:-fixture-attempt}/bootstrap-input.json"
                        node - "$INSTALL_DIR" "$bootstrap_input" "$FAKE_REPO_ROOT" <<'NODE'
const fs = require('fs')
const [installDir, inputPath, repoRoot] = process.argv.slice(2)
const { ApplicationMigrationBootstrap } = require(`${repoRoot}/src/bootstrap/applicationMigrationBootstrap`)
const installInput = fs.existsSync(inputPath) ? JSON.parse(fs.readFileSync(inputPath, 'utf8')) : null
new ApplicationMigrationBootstrap({
  configDir: `${installDir}/config`,
  dataDir: `${installDir}/data`
}).run({
  installInput,
  createIfMissing: Boolean(installInput),
  runtimeEnv: { ADMIN_QQ: '10000', WS_TOKEN: 'fake-token' },
  deploymentAttemptId: process.env.BILI_SETUP_ATTEMPT_ID || 'fixture-attempt',
  releaseEpoch: `release-${process.env.BILI_SETUP_ATTEMPT_ID || 'fixture-attempt'}`
})
  .then(() => process.exit(0), error => { process.stderr.write(`${error.code || error.message}\n`); process.exit(1) })
NODE
                    fi
                    if [ "${FAKE_PROBE_MUTATE_RELOCATED_DATA:-0}" = "1" ] && [ -n "${FAKE_RELOCATE_DATA_SOURCE:-}" ]; then
                        relocated_data=$FAKE_RELOCATE_DATA_SOURCE
                        case "$relocated_data" in
                            /*) ;;
                            *) relocated_data="$INSTALL_DIR/$relocated_data" ;;
                        esac
                        printf '{"unexpected":true}\n' > "$relocated_data/probe-mutation.json"
                    fi
                elif printf '%s\n' "${args[*]}" | grep -q 'runtime-release'; then
                    printf 'normal\n' > "$STATE_DIR/runtime-mode"
                fi
                ;;
        esac
        ;;
    image)
        sub=${1:-}
        shift || true
        case "$sub" in
            inspect)
                if [ "${1:-}" = "--format" ]; then shift 2; fi
                ref=${1:-}
                case "$ref" in
                    *napcat-rollback*)
                        [ ! -f "$STATE_DIR/napcat-rollback-missing" ] || exit 1
                        printf 'sha256:napcat-image\n'
                        ;;
                    *rollback*) printf 'sha256:old-image\n' ;;
                    sha256:old-image) printf 'sha256:old-image\n' ;;
                    sha256:napcat-image) printf 'sha256:napcat-image\n' ;;
                    sha256:target-napcat-image) printf 'sha256:target-napcat-image\n' ;;
                    *napcat*)
                        if [ "${FAKE_NAPCAT_TARGET_MISSING:-0}" = "1" ] && [ ! -f "$STATE_DIR/napcat-target-pulled" ]; then
                            exit 1
                        fi
                        printf 'sha256:target-napcat-image\n'
                        ;;
                    *)
                        if [ "${FAKE_TARGET_IMAGE_MISSING:-0}" = "1" ] && [ ! -f "$STATE_DIR/target-pulled" ]; then exit 1; fi
                        printf 'sha256:target-image\n'
                        ;;
                esac
                ;;
            tag) exit 0 ;;
        esac
        ;;
    pull)
        case "${1:-}" in
            *napcat*) : > "$STATE_DIR/napcat-target-pulled" ;;
            *)
                if [ "${FAKE_REQUIRE_INTENT_BEFORE_BOT_PULL:-0}" = "1" ]; then
                    [ -f "$INSTALL_DIR/data/setup-state/${BILI_SETUP_ATTEMPT_ID:-fixture-attempt}/upgrade-manifest.json" ] || exit 41
                fi
                : > "$STATE_DIR/target-pulled"
                ;;
        esac
        exit 0
        ;;
    ps)
        printf 'bot-old\nnapcat-old\n'
        [ "${FAKE_EXTERNAL_WRITER:-0}" != "1" ] || printf 'external-writer\n'
        ;;
    inspect)
        format=""
        if [ "${1:-}" = "--format" ]; then
            format=$2
            shift 2
        fi
        id=${1:-}
        case "$format" in
            '{{.Image}}')
                [ "$id" = "napcat-old" ] && printf 'sha256:napcat-image\n' || printf 'sha256:old-image\n'
                ;;
            '{{.State.Running}}')
                get_state "$id" running true
                ;;
            '{{.State.Running}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}')
                printf '%s|%s|%s|%s\n' \
                    "$(get_state "$id" running true)" \
                    "$(get_state "$id" exit-code 0)" \
                    "$(get_state "$id" oom-killed false)" \
                    "$(get_state "$id" shutdown-error '')"
                ;;
            '{{.State.Running}}|{{.State.Paused}}|{{.Name}}')
                printf '%s|%s|/%s\n' "$(get_state "$id" running true)" "$(get_state "$id" paused false)" "$id"
                ;;
            '{{range .Mounts}}{{println .Source}}{{end}}')
                current_data="$INSTALL_DIR/data"
                if [ -f "$INSTALL_DIR/.bili-deployment-state" ]; then
                    while IFS='|' read -r state_key state_value; do
                        [ "$state_key" != "data" ] || current_data=$state_value
                    done < "$INSTALL_DIR/.bili-deployment-state"
                fi
                case "$id" in
                    bot-old)
                        printf '%s\n' "$INSTALL_DIR/config" "$current_data" "$INSTALL_DIR/napcat/qq" "$INSTALL_DIR/fonts/custom"
                        ;;
                    napcat-old)
                        printf '%s\n' "$INSTALL_DIR/napcat/config" "$INSTALL_DIR/napcat/qq"
                        ;;
                    external-writer)
                        printf '%s\n' "${FAKE_EXTERNAL_WRITER_MOUNT:-$INSTALL_DIR/data}"
                        ;;
                esac
                ;;
            '{{range .Config.Env}}{{println .}}{{end}}')
                printf 'ADMIN_QQ=10000\nWS_TOKEN=fake-token\n'
                ;;
            '{{.HostConfig.NetworkMode}}')
                printf '%s\n' "${FAKE_NETWORK_MODE:-bridge}"
                ;;
            *NetworkSettings.Networks*)
                printf 'bot_network|172.20.0.2||bili-qq-bot,||\n'
                ;;
            *)
                printf '{}\n'
                ;;
        esac
        ;;
    network)
        sub=${1:-}
        shift || true
        case "$sub" in
            inspect)
                if [ "${1:-}" = "--format" ]; then shift 2; fi
                network=${1:-bot_network}
                printf 'sha256:%s-network|com.example.fixture=true,\n' "$network"
                ;;
            connect|disconnect) exit 0 ;;
            *) exit 2 ;;
        esac
        ;;
    kill)
        signal=""
        if [ "${1:-}" = "--signal" ]; then
            signal=$2
            shift 2
        fi
        id=${1:-}
        if [ "$signal" = "TERM" ] && [ "${FAKE_IGNORE_TERM:-0}" = "1" ]; then
            exit 0
        fi
        set_state "$id" running false
        set_state "$id" paused false
        if [ "$signal" = "TERM" ]; then
            set_state "$id" exit-code "${FAKE_MANAGED_EXIT_CODE:-0}"
            set_state "$id" oom-killed "${FAKE_MANAGED_OOM_KILLED:-false}"
            set_state "$id" shutdown-error "${FAKE_MANAGED_DRAIN_RESIDUAL:-}"
        else
            set_state "$id" exit-code 137
        fi
        ;;
    pause)
        set_state "$1" paused true
        ;;
    unpause)
        set_state "$1" paused false
        ;;
    start)
        [ "${FAKE_WRITER_RESTORE_FAIL:-0}" != "1" ] || exit 33
        set_state "$1" running true
        ;;
    stop)
        set_state "$1" running false
        set_state "$1" paused false
        ;;
    exec)
        mode=$(cat "$STATE_DIR/runtime-mode" 2>/dev/null || printf probe)
        if [ "$mode" = "probe" ] && [ "${FAKE_PROBE_HEALTH_FAIL:-0}" = "1" ]; then
            exit 1
        fi
        if [ "$mode" = "normal" ] && [ "${FAKE_NORMAL_HEALTH_FAIL:-0}" = "1" ]; then
            exit 1
        fi
        exit 0
        ;;
    run)
        [ -n "${FAKE_REPO_ROOT:-}" ] || {
            printf 'FAKE_REPO_ROOT is required for fake docker run\n' >&2
            exit 1
        }
        mount_hosts=()
        mount_targets=()
        args=("$@")
        index=0
        command_index=-1
        while [ "$index" -lt "${#args[@]}" ]; do
            value=${args[$index]}
            case "$value" in
                -v)
                    spec=${args[$((index + 1))]}
                    host=${spec%%:*}
                    rest=${spec#*:}
                    target=${rest%%:*}
                    mount_hosts+=("$host")
                    mount_targets+=("$target")
                    index=$((index + 2))
                    continue
                    ;;
                --network|--tmpfs)
                    index=$((index + 2))
                    continue
                    ;;
                --rm|--read-only)
                    index=$((index + 1))
                    continue
                    ;;
                sha256:*|fixture/*|unsplash/*)
                    command_index=$((index + 1))
                    break
                    ;;
            esac
            index=$((index + 1))
        done
        [ "$command_index" -ge 0 ] || exit 2
        command_args=("${args[@]:$command_index}")
        translated=()
        for value in "${command_args[@]}"; do
            translated_value=$value
            for mount_index in "${!mount_targets[@]}"; do
                target=${mount_targets[$mount_index]}
                host=${mount_hosts[$mount_index]}
                case "$translated_value" in
                    "$target") translated_value=$host ;;
                    "$target"/*) translated_value="$host/${translated_value#"$target"/}" ;;
                esac
            done
            translated+=("$translated_value")
        done
        (
            cd -- "$FAKE_REPO_ROOT"
            "${translated[@]}"
        )
        ;;
    *)
        printf 'unsupported fake docker command: %s\n' "$command" >&2
        exit 2
        ;;
esac
