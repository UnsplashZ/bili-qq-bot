#!/usr/bin/env bash

set -Eeuo pipefail

# Deployment orchestrator for config.yaml based installations.
# YAML, migration manifests, and Compose ownership are handled by the
# version-pinned CLI inside the target image. This script only coordinates
# Docker, crash-safe checkpoints, snapshots, and health gates.

MODE="auto"
DRY_RUN=0
NON_INTERACTIVE=0
ALLOW_PULL=0
UPGRADE_NAPCAT=0
ADOPT_EXISTING=0
ALLOW_FORCE_STOP=0
PROVIDER=""
CONFIG_INPUT=""
INSTALL_DIR=""
TARGET_IMAGE_REF="${BILI_BOT_IMAGE:-unsplash/bili-qq-bot:latest}"
TARGET_NAPCAT_IMAGE_REF="${BILI_NAPCAT_IMAGE:-mlikiowa/napcat-docker:latest}"
HEALTH_TIMEOUT_SECONDS=180
HEALTH_CONSECUTIVE_SUCCESSES=${BILI_SETUP_HEALTH_CONSECUTIVE_SUCCESSES:-3}
HEALTH_INTERVAL_SECONDS=${BILI_SETUP_HEALTH_INTERVAL_SECONDS:-2}
STOP_TIMEOUT_SECONDS=${BILI_SETUP_STOP_TIMEOUT_SECONDS:-30}
HEALTH_CONTAINER_PORT=3000
SHOW_HELP=0
ERROR_HANDLER_READY=0
INSTALL_LOCK_FD=""
INSTALL_LOCK_DIR=""
INSTALL_LOCK_OWNER=""
LEGACY_FEATURE_INVENTORY_JSON='[]'
OFFICIAL_INIT_INPUT=""
NAPCAT_INIT_INPUT=""
RUNTIME_ENV_CONTENT=""
ATTEMPT_INTENT_COMMITTED=0
ATTEMPT_STAGING_DIR=""
CONCURRENT_COMPOSE_FILE=""
CONCURRENT_OWNERSHIP_FILE=""
DRY_RUN_STAGING_DIR=""

usage() {
    cat <<'EOF'
Usage: ./setup.sh [mode] [options]

Modes:
  --install                    First installation
  --upgrade                    Upgrade an existing installation
  --apply                      Apply deployment-level config changes
  --dry-run                    Read-only feasibility report

Options:
  --provider napcat|official
  --config PATH                Existing config.yaml input
  --install-dir PATH           Installation root (default: current directory)
  --image IMAGE                Target bot image reference
  --napcat-image IMAGE         Target NapCat image reference (with --upgrade-napcat)
  --non-interactive            Never prompt; missing input is an error
  --allow-pull                 Permit image pull during dry-run
  --upgrade-napcat             Pull/update the managed NapCat image
  --adopt-existing             Allow an explicitly validated non-empty mount target
  --force-stop                 Permit legacy forced-stop after frozen recovery point
  --health-timeout SECONDS
  --help
EOF
}

die() {
    printf 'setup error: %s\n' "$*" >&2
    if [ "${ERROR_HANDLER_READY:-0}" -eq 1 ]; then
        on_error 1
    fi
    exit 1
}

log() {
    printf '[setup] %s\n' "$*" >&2
}

test_failpoint() {
    [ "${TEST_FAILPOINT:-}" != "$1" ] || die "injected setup failpoint: $1"
}

test_crashpoint() {
    [ "${TEST_FAILPOINT:-}" != "$1" ] || kill -KILL "$$"
}

parse_positive_integer() {
    local name=$1
    local value=$2
    case "$value" in
        ''|*[!0-9]*) die "$name must be a positive integer" ;;
    esac
    [ "$value" -gt 0 ] || die "$name must be greater than zero"
}

# Argument parsing is intentionally the first executable phase. Do not add
# dependency installation, mkdir, pull, or any other mutation above this loop.
while [ "$#" -gt 0 ]; do
    case "$1" in
        --install)
            [ "$MODE" = "auto" ] || die "only one mode may be selected"
            MODE="install"
            ;;
        --upgrade)
            [ "$MODE" = "auto" ] || die "only one mode may be selected"
            MODE="upgrade"
            ;;
        --apply)
            [ "$MODE" = "auto" ] || die "only one mode may be selected"
            MODE="apply"
            ;;
        --dry-run)
            DRY_RUN=1
            ;;
        --non-interactive)
            NON_INTERACTIVE=1
            ;;
        --allow-pull)
            ALLOW_PULL=1
            ;;
        --upgrade-napcat)
            UPGRADE_NAPCAT=1
            ;;
        --adopt-existing)
            ADOPT_EXISTING=1
            ;;
        --force-stop)
            ALLOW_FORCE_STOP=1
            ;;
        --provider)
            [ "$#" -ge 2 ] || die "--provider requires a value"
            PROVIDER=$2
            shift
            ;;
        --config)
            [ "$#" -ge 2 ] || die "--config requires a path"
            CONFIG_INPUT=$2
            shift
            ;;
        --install-dir)
            [ "$#" -ge 2 ] || die "--install-dir requires a path"
            INSTALL_DIR=$2
            shift
            ;;
        --image)
            [ "$#" -ge 2 ] || die "--image requires a value"
            TARGET_IMAGE_REF=$2
            shift
            ;;
        --napcat-image)
            [ "$#" -ge 2 ] || die "--napcat-image requires a value"
            TARGET_NAPCAT_IMAGE_REF=$2
            shift
            ;;
        --health-timeout)
            [ "$#" -ge 2 ] || die "--health-timeout requires seconds"
            parse_positive_integer "--health-timeout" "$2"
            HEALTH_TIMEOUT_SECONDS=$2
            shift
            ;;
        --help|-h)
            SHOW_HELP=1
            ;;
        --)
            shift
            break
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
    shift
done

[ "$#" -eq 0 ] || die "unexpected positional arguments: $*"

if [ "$SHOW_HELP" -eq 1 ]; then
    usage
    exit 0
fi

case "$PROVIDER" in
    ''|napcat|official) ;;
    *) die "--provider must be napcat or official" ;;
esac

umask 077

DOCKER_BIN=${BILI_SETUP_DOCKER_BIN:-docker}
CLI_DRIVER=${BILI_SETUP_CLI_DRIVER:-}
TEST_MODE=${BILI_SETUP_TEST_MODE:-0}
LSOF_BIN=${BILI_SETUP_LSOF_BIN:-lsof}
TEST_FAILPOINT=${BILI_SETUP_TEST_FAILPOINT:-}
FORCE_PORTABLE_LOCK=${BILI_SETUP_FORCE_PORTABLE_LOCK:-0}

if [ -n "$CLI_DRIVER" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_CLI_DRIVER is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_LSOF_BIN:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_LSOF_BIN is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "$TEST_FAILPOINT" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_FAILPOINT is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_PYTHON:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_PYTHON is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ "$FORCE_PORTABLE_LOCK" != "0" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_FORCE_PORTABLE_LOCK is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_CONCURRENT_COMPOSE_SOURCE:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_CONCURRENT_COMPOSE_SOURCE is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_CONCURRENT_COMPOSE_DURING_PUBLISH_SOURCE:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_CONCURRENT_COMPOSE_DURING_PUBLISH_SOURCE is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_DURING_PUBLISH_SOURCE:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_DURING_PUBLISH_SOURCE is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_SOURCE:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_SOURCE is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if { [ -n "${BILI_SETUP_TEST_LEGACY_ARCHIVE_MUTATION:-}" ] || [ -n "${BILI_SETUP_TEST_RELOCATED_ARCHIVE_MUTATION:-}" ]; } && [ "$TEST_MODE" != "1" ]; then
    die "archive mutation hooks are only allowed with BILI_SETUP_TEST_MODE=1"
fi
if { [ -n "${BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT:-}" ] || [ -n "${BILI_SETUP_TEST_ARCHIVE_INVENTORY_REPLACEMENT:-}" ] || [ -n "${BILI_SETUP_TEST_ARCHIVE_COMPLETED_INTENT_REPLACEMENT:-}" ]; } && [ "$TEST_MODE" != "1" ]; then
    die "archive control-plane hooks are only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_PUBLICATION_CLEANUP_REPLACEMENT:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_PUBLICATION_CLEANUP_REPLACEMENT is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_PUBLICATION_CLEANUP_RACE:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_PUBLICATION_CLEANUP_RACE is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_VAULT_HARDLINK_KIND:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_VAULT_HARDLINK_KIND is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if { [ -n "${BILI_SETUP_TEST_AVAILABLE_BYTES:-}" ] || [ -n "${BILI_SETUP_TEST_AVAILABLE_INODES:-}" ]; } && [ "$TEST_MODE" != "1" ]; then
    die "capacity fault hooks are only allowed with BILI_SETUP_TEST_MODE=1"
fi
if [ -n "${BILI_SETUP_TEST_PUBLICATION_RESTORE_STASH_CONFLICT:-}" ] && [ "$TEST_MODE" != "1" ]; then
    die "BILI_SETUP_TEST_PUBLICATION_RESTORE_STASH_CONFLICT is only allowed with BILI_SETUP_TEST_MODE=1"
fi
if { [ -n "${BILI_SETUP_TEST_PUBLICATION_WRITER_CONFLICT:-}" ] ||
     [ -n "${BILI_SETUP_TEST_PREPUBLICATION_DELETE_RACE:-}" ] ||
     [ -n "${BILI_SETUP_TEST_PUBLICATION_DELETE_RACE:-}" ] ||
     [ -n "${BILI_SETUP_TEST_OWNERSHIP_DELETE_RACE:-}" ] ||
     [ -n "${BILI_SETUP_TEST_PUBLICATION_TERMINAL_DELETE_RACE:-}" ] ||
     [ -n "${BILI_SETUP_TEST_DATA_CANDIDATE_TEMP_CONFLICT:-}" ]; } && [ "$TEST_MODE" != "1" ]; then
    die "publication mutation hooks are only allowed with BILI_SETUP_TEST_MODE=1"
fi

if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR=$PWD
fi

canonical_path() {
    local input=$1
    if [ -e "$input" ] && command -v realpath >/dev/null 2>&1; then
        realpath -- "$input"
        return
    fi
    case "$input" in
        /*) ;;
        *) input="$PWD/$input" ;;
    esac
    local parent
    parent=$(dirname -- "$input")
    local base
    base=$(basename -- "$input")
    if [ -d "$parent" ]; then
        (CDPATH='' cd -P -- "$parent" 2>/dev/null && printf '%s/%s\n' "$PWD" "$base")
        return
    fi
    printf '%s/%s\n' "$(canonical_path "$parent")" "$base"
}

INSTALL_DIR=$(canonical_path "$INSTALL_DIR")

CONFIG_DIR="$INSTALL_DIR/config"
DATA_DIR="$INSTALL_DIR/data"
LOGS_DIR="$INSTALL_DIR/logs"
FONTS_DIR="$INSTALL_DIR/fonts/custom"
NAPCAT_CONFIG_DIR="$INSTALL_DIR/napcat/config"
NAPCAT_QQ_DIR="$INSTALL_DIR/napcat/qq"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
DEPLOYMENT_STATE_FILE="$INSTALL_DIR/.bili-deployment-state"

load_deployment_paths() {
    [ -e "$DEPLOYMENT_STATE_FILE" ] || return 0
    [ -f "$DEPLOYMENT_STATE_FILE" ] && [ ! -L "$DEPLOYMENT_STATE_FILE" ] || die "deployment state must be a regular non-symlink file"
    local line key value
    local seen_config=0 seen_data=0 seen_logs=0 seen_fonts=0 seen_napcat_config=0 seen_napcat_qq=0
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        key=${line%%|*}
        value=${line#*|}
        [ "$key" != "$line" ] || die "deployment state line is invalid"
        case "$value" in
            /*) ;;
            *) die "deployment state paths must be absolute" ;;
        esac
        case "$value" in *'|'*) die "deployment state path contains a forbidden delimiter" ;; esac
        assert_safe_mount_path "$value"
        value=$(canonical_path "$value")
        case "$key" in
            config) [ "$seen_config" -eq 0 ] || die "duplicate deployment state key: config"; CONFIG_DIR=$value; seen_config=1 ;;
            data) [ "$seen_data" -eq 0 ] || die "duplicate deployment state key: data"; DATA_DIR=$value; seen_data=1 ;;
            logs) [ "$seen_logs" -eq 0 ] || die "duplicate deployment state key: logs"; LOGS_DIR=$value; seen_logs=1 ;;
            fonts) [ "$seen_fonts" -eq 0 ] || die "duplicate deployment state key: fonts"; FONTS_DIR=$value; seen_fonts=1 ;;
            napcatConfig) [ "$seen_napcat_config" -eq 0 ] || die "duplicate deployment state key: napcatConfig"; NAPCAT_CONFIG_DIR=$value; seen_napcat_config=1 ;;
            napcatQq) [ "$seen_napcat_qq" -eq 0 ] || die "duplicate deployment state key: napcatQq"; NAPCAT_QQ_DIR=$value; seen_napcat_qq=1 ;;
            *) die "unknown deployment state key: $key" ;;
        esac
    done < "$DEPLOYMENT_STATE_FILE"
    [ "$seen_config" -eq 1 ] && [ "$seen_data" -eq 1 ] && [ "$seen_logs" -eq 1 ] && [ "$seen_fonts" -eq 1 ] && \
        [ "$seen_napcat_config" -eq 1 ] && [ "$seen_napcat_qq" -eq 1 ] || die "deployment state is incomplete"
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

docker_cmd() {
    "$DOCKER_BIN" "$@"
}

compose_cmd() {
    docker_cmd compose "$@"
}

path_is_within() {
    local child
    child=$(canonical_path "$1")
    local parent
    parent=$(canonical_path "$2")
    [ "$child" = "$parent" ] || [ "${child#"$parent"/}" != "$child" ]
}

assert_no_symlink_components() {
    local input=$1
    case "$input" in /*) ;; *) die "path must be absolute" ;; esac
    local current="" segment
    local old_ifs=$IFS
    IFS='/'
    read -r -a segments <<< "${input#/}"
    IFS=$old_ifs
    for segment in "${segments[@]}"; do
        [ -n "$segment" ] || continue
        current="$current/$segment"
        [ ! -L "$current" ] || die "managed path contains symlink: $current"
    done
}

assert_safe_mount_path() {
    local input=$1
    case "$input" in
        *$'\n'*|*$'\r'*|*$'\t'*|*'|'*) die "mount path contains forbidden control or delimiter characters" ;;
    esac
    assert_no_symlink_components "$input"
    case "$input" in
        /|/bin|/sbin|/usr|/etc|/var|/System|/Library|/Applications|/Users|/home|/root|/Volumes)
            die "refusing dangerous mount target: $input"
            ;;
    esac
}

load_deployment_paths
for managed_path in "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" "$FONTS_DIR" "$NAPCAT_CONFIG_DIR" "$NAPCAT_QQ_DIR"; do
    assert_safe_mount_path "$managed_path"
done
STATE_ROOT="$DATA_DIR/setup-state"
ACTIVE_ATTEMPT_FILE="$STATE_ROOT/active-attempt"
MANAGED_RUNTIME_MARKER="$STATE_ROOT/managed-v1"

resolve_mount_source() {
    local source=$1
    case "$source" in
        /*) ;;
        *) source="$INSTALL_DIR/$source" ;;
    esac
    assert_safe_mount_path "$source"
    canonical_path "$source"
}

current_mount_path() {
    case "$1" in
        config) printf '%s\n' "$CONFIG_DIR" ;;
        data) printf '%s\n' "$DATA_DIR" ;;
        logs) printf '%s\n' "$LOGS_DIR" ;;
        fonts) printf '%s\n' "$FONTS_DIR" ;;
        napcatConfig) printf '%s\n' "$NAPCAT_CONFIG_DIR" ;;
        napcatQq) printf '%s\n' "$NAPCAT_QQ_DIR" ;;
        *) die "unsupported deployment mount key: $1" ;;
    esac
}

set_relocated_mount_path() {
    local key=$1
    local value=$2
    case "$key" in
        config) RELOCATED_CONFIG_DIR=$value ;;
        data) RELOCATED_DATA_DIR=$value ;;
        logs) RELOCATED_LOGS_DIR=$value ;;
        fonts) RELOCATED_FONTS_DIR=$value ;;
        napcatConfig) RELOCATED_NAPCAT_CONFIG_DIR=$value ;;
        napcatQq) RELOCATED_NAPCAT_QQ_DIR=$value ;;
        *) die "unsupported relocation key: $key" ;;
    esac
}

hash_file() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 -- "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum -- "$1" | awk '{print $1}'
    else
        die "mount relocation requires shasum or sha256sum"
    fi
}

stat_metadata() {
    local path=$1
    if stat -f '%Lp|%u|%g|%z' "$path" >/dev/null 2>&1; then
        stat -f '%Lp|%u|%g|%z' "$path"
    else
        stat -c '%a|%u|%g|%s' "$path"
    fi
}

apply_root_metadata() {
    local source=$1
    local target=$2
    local metadata mode uid gid _size
    metadata=$(stat_metadata "$source")
    IFS='|' read -r mode uid gid _size <<EOF
$metadata
EOF
    chmod "$mode" "$target"
    chown "$uid:$gid" "$target" 2>/dev/null || {
        local target_meta target_uid target_gid
        target_meta=$(stat_metadata "$target")
        IFS='|' read -r _mode target_uid target_gid _size <<EOF
$target_meta
EOF
        [ "$target_uid" = "$uid" ] && [ "$target_gid" = "$gid" ] || die "unable to preserve mount root ownership"
    }
}

generate_tree_inventory() {
    local root=$1
    local key=$2
    local output=$3
    local unsorted="$output.unsorted"
    : > "$unsorted"
    local entry relative metadata mode uid gid size type digest
    metadata=$(stat_metadata "$root")
    IFS='|' read -r mode uid gid size <<EOF
$metadata
EOF
    printf '.|D|%s|%s|%s|0|-\n' "$mode" "$uid" "$gid" >> "$unsorted"
    if [ "$key" = "data" ]; then
        while IFS= read -r -d '' entry; do
            relative=${entry#"$root/"}
            case "$relative" in *$'\n'*|*$'\r'*|*$'\t'*|*'|'*) die "relocation inventory path contains forbidden characters" ;; esac
            [ ! -L "$entry" ] || die "relocation source contains symlink: $relative"
            metadata=$(stat_metadata "$entry")
            IFS='|' read -r mode uid gid size <<EOF
$metadata
EOF
            if [ -d "$entry" ]; then type=D; size=0; digest=-
            elif [ -f "$entry" ]; then type=F; digest=$(hash_file "$entry")
            else die "relocation source contains unsupported file type: $relative"
            fi
            printf '%s|%s|%s|%s|%s|%s|%s\n' "$relative" "$type" "$mode" "$uid" "$gid" "$size" "$digest" >> "$unsorted"
        done < <(find "$root" -path "$root/setup-state" -prune -o -mindepth 1 -print0)
    else
        while IFS= read -r -d '' entry; do
            relative=${entry#"$root/"}
            case "$relative" in *$'\n'*|*$'\r'*|*$'\t'*|*'|'*) die "relocation inventory path contains forbidden characters" ;; esac
            [ ! -L "$entry" ] || die "relocation source contains symlink: $relative"
            metadata=$(stat_metadata "$entry")
            IFS='|' read -r mode uid gid size <<EOF
$metadata
EOF
            if [ -d "$entry" ]; then type=D; size=0; digest=-
            elif [ -f "$entry" ]; then type=F; digest=$(hash_file "$entry")
            else die "relocation source contains unsupported file type: $relative"
            fi
            printf '%s|%s|%s|%s|%s|%s|%s\n' "$relative" "$type" "$mode" "$uid" "$gid" "$size" "$digest" >> "$unsorted"
        done < <(find "$root" -mindepth 1 -print0)
    fi
    LC_ALL=C sort "$unsorted" > "$output"
    chmod 600 "$output"
    rm -f -- "$unsorted"
    file_sync "$output"
}

sync_tree() {
    local root=$1
    local entry
    while IFS= read -r -d '' entry; do
        file_sync "$entry"
    done < <(find "$root" -type f -print0)
    while IFS= read -r -d '' entry; do
        file_sync "$entry"
    done < <(find "$root" -depth -type d -print0)
}

assert_safe_install_root() {
    [ "$INSTALL_DIR" != "/" ] || die "installation root cannot be /"
    local current="$INSTALL_DIR"
    while [ "$current" != "/" ]; do
        if [ -L "$current" ]; then
            die "installation path contains symlink: $current"
        fi
        current=$(dirname -- "$current")
    done
}

file_sync() {
    local target=$1
    if sync -f "$target" >/dev/null 2>&1; then
        return
    fi
    sync
}

atomic_copy_file() {
    local source=$1
    local target=$2
    local mode=${3:-600}
    local target_dir
    target_dir=$(dirname -- "$target")
    mkdir -p -- "$target_dir"
    chmod 700 "$target_dir" 2>/dev/null || true
    local temp="$target.tmp.$$.${RANDOM}"
    cp -- "$source" "$temp"
    chmod "$mode" "$temp"
    file_sync "$temp"
    mv -f -- "$temp" "$target"
    file_sync "$target_dir"
}

safe_remove_file() {
    local file=$1
    [ -e "$file" ] || return 0
    [ ! -L "$file" ] || die "refusing to remove symlink: $file"
    rm -f -- "$file"
}

random_id() {
    if [ -n "${BILI_SETUP_ATTEMPT_ID:-}" ]; then
        printf '%s\n' "$BILI_SETUP_ATTEMPT_ID"
        return
    fi
    local random_part
    random_part=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
    printf '%s-%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "${random_part:-$RANDOM}"
}

image_id() {
    docker_cmd image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

image_exists() {
    image_id "$1" >/dev/null 2>&1
}

resolve_target_image() {
    if ! image_exists "$TARGET_IMAGE_REF"; then
        if [ "$DRY_RUN" -eq 1 ] && [ "$ALLOW_PULL" -ne 1 ]; then
            print_dry_run_report "INCOMPLETE_TARGET_IMAGE_UNAVAILABLE" 0
            exit 3
        fi
        log "pulling target image $TARGET_IMAGE_REF"
        docker_cmd pull "$TARGET_IMAGE_REF"
    fi
    TARGET_IMAGE_ID=$(image_id "$TARGET_IMAGE_REF")
    [ -n "$TARGET_IMAGE_ID" ] || die "unable to resolve target image content ID"
}

resolve_target_napcat_image() {
    if ! image_exists "$TARGET_NAPCAT_IMAGE_REF"; then
        if [ "$DRY_RUN" -eq 1 ] && [ "$ALLOW_PULL" -ne 1 ]; then
            print_dry_run_report "INCOMPLETE_NAPCAT_IMAGE_UNAVAILABLE" 0
            exit 3
        fi
        log "pulling target NapCat image $TARGET_NAPCAT_IMAGE_REF"
        docker_cmd pull "$TARGET_NAPCAT_IMAGE_REF"
    fi
    TARGET_NAPCAT_IMAGE_ID=$(image_id "$TARGET_NAPCAT_IMAGE_REF")
    [ -n "$TARGET_NAPCAT_IMAGE_ID" ] || die "unable to resolve target NapCat image content ID"
}

detect_mode() {
    [ "$MODE" = "auto" ] || return 0
    # docker-compose.yml is tracked by source checkouts and is not installation
    # provenance on its own. Only persisted runtime/config state selects upgrade.
    if [ -f "$CONFIG_DIR/config.yaml" ] || [ -f "$CONFIG_DIR/.env" ] || [ -f "$CONFIG_DIR/config.json" ] || \
        [ -f "$CONFIG_DIR/.jwtSecret" ] || [ -f "$CONFIG_DIR/.qqOfficialClientSecret" ] || \
        [ -f "$MANAGED_RUNTIME_MARKER" ] || [ -f "$DEPLOYMENT_STATE_FILE" ]; then
        MODE="upgrade"
    else
        MODE="install"
    fi
}

detect_provider() {
    [ -z "$PROVIDER" ] || return 0
    if [ "$MODE" = "install" ] && [ "$NON_INTERACTIVE" -eq 1 ]; then
        die "--provider is required for non-interactive installation"
    fi
    if [ "$MODE" = "install" ]; then
        printf 'Provider [napcat/official] (default napcat): ' >&2
        IFS= read -r PROVIDER
        PROVIDER=${PROVIDER:-napcat}
        case "$PROVIDER" in
            napcat|official) ;;
            *) die "provider must be napcat or official" ;;
        esac
        return
    fi
    # Upgrade/apply provider is resolved by the config migration/render CLI.
    PROVIDER="auto"
}

find_service_container() {
    local service=$1
    local id=""
    if [ -f "$COMPOSE_FILE" ]; then
        id=$(compose_cmd -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)
    fi
    if [ -z "$id" ]; then
        id=$(docker_cmd ps -aq --filter "name=^/${service}$" 2>/dev/null | head -n 1 || true)
    fi
    printf '%s\n' "$id"
}

OLD_BOT_CONTAINER=""
OLD_NAPCAT_CONTAINER=""
OLD_IMAGE_ID=""
ROLLBACK_TAG=""
TARGET_IMAGE_ID=""
OLD_NAPCAT_IMAGE_ID=""
NAPCAT_ROLLBACK_TAG=""
TARGET_NAPCAT_IMAGE_ID=""
ATTEMPT_ID=""
ATTEMPT_DIR=""
WORK_DIR=""
SNAPSHOT_DIR=""
MANIFEST_FILE=""
CHECKPOINT_INPUT=""
WRITER_SET_FILE=""
NETWORK_STATE_FILE=""
RUNTIME_ENV_FILE=""
OWNERSHIP_FILE=""
HEALTH_PORT_FILE=""
CURRENT_CHECKPOINT="discovered"
RELEASE_EPOCH=""
ROLLBACK_RUNNING=0
RECOVERY_REQUIRED_ONLY=0
MARKER_COMMITTED=0
CUTOVER_INTENT_WRITTEN=0
RUNTIME_MUTATION_STARTED=0
FENCE_CAPABILITY="not-required"
FORCED_STOP_USED=0
RESUMING_ATTEMPT=0
ATTEMPT_METADATA_FILE=""
CHECKPOINT_FILE=""
SOURCE_RUNTIME_CLASS="fresh-install"
CUTOVER_KIND="fresh-install"
RELOCATION_OPERATIONS_FILE=""
RELOCATION_ARTIFACT_FILE=""
LEGACY_ARCHIVE_PROOF_FILE=""
RELOCATED_CONFIG_ARCHIVE_PROOF_FILE=""
RELOCATION_ACTIVE=0
RELOCATED_CONFIG_DIR=""
RELOCATED_DATA_DIR=""
RELOCATED_LOGS_DIR=""
RELOCATED_FONTS_DIR=""
RELOCATED_NAPCAT_CONFIG_DIR=""
RELOCATED_NAPCAT_QQ_DIR=""

acquire_install_lock() {
    if [ "$FORCE_PORTABLE_LOCK" != "1" ] && command -v flock >/dev/null 2>&1; then
        # Lock the already-existing install directory itself so dry-run does not
        # create a lock file in the installation.
        exec {INSTALL_LOCK_FD}<"$INSTALL_DIR"
        flock -n "$INSTALL_LOCK_FD" || die "another setup process holds the installation lock"
        return
    fi
    local checksum _rest
    IFS=' ' read -r checksum _rest <<EOF
$(printf '%s' "$INSTALL_DIR" | cksum)
EOF
    INSTALL_LOCK_DIR="${TMPDIR:-/tmp}/bili-qq-bot-setup-lock.$checksum"
    if ! mkdir "$INSTALL_LOCK_DIR" 2>/dev/null; then
        [ -d "$INSTALL_LOCK_DIR" ] && [ ! -L "$INSTALL_LOCK_DIR" ] || die "portable setup lock path is unsafe"
        local owner="" owner_pid owner_identity current_identity age
        owner=$(cat "$INSTALL_LOCK_DIR/owner" 2>/dev/null || true)
        IFS='|' read -r owner_pid owner_identity <<EOF
$owner
EOF
        case "$owner_pid" in
            ''|*[!0-9]*)
                age=$(portable_lock_age_seconds "$INSTALL_LOCK_DIR")
                [ "$age" -ge 2 ] || die "another setup process is initializing the installation lock"
                ;;
            *)
                if kill -0 "$owner_pid" 2>/dev/null; then
                    current_identity=$(portable_process_identity "$owner_pid" || true)
                    if [ -z "$owner_identity" ] || [ -z "$current_identity" ] || \
                        [ "${owner_identity#unknown-}" != "$owner_identity" ] || [ "$owner_identity" = "$current_identity" ]; then
                        die "another setup process holds the installation lock"
                    fi
                fi
                ;;
        esac
        rm -rf -- "$INSTALL_LOCK_DIR"
        mkdir "$INSTALL_LOCK_DIR" 2>/dev/null || die "another setup process holds the installation lock"
    fi
    local identity owner_temp
    identity=$(portable_process_identity "$$" || true)
    [ -n "$identity" ] || identity="unknown-$$"
    INSTALL_LOCK_OWNER="$$|$identity"
    owner_temp="$INSTALL_LOCK_DIR/owner.tmp.$$.$RANDOM"
    printf '%s\n' "$INSTALL_LOCK_OWNER" > "$owner_temp"
    chmod 600 "$owner_temp"
    mv -f -- "$owner_temp" "$INSTALL_LOCK_DIR/owner"
}

portable_process_identity() {
    local pid=$1 output checksum _rest
    command -v ps >/dev/null 2>&1 || return 1
    output=$(ps -p "$pid" -o lstart= -o command= 2>/dev/null) || return 1
    [ -n "$output" ] || return 1
    IFS=' ' read -r checksum _rest <<EOF
$(printf '%s' "$output" | cksum)
EOF
    printf '%s\n' "$checksum"
}

portable_lock_age_seconds() {
    local target=$1 modified now
    if modified=$(stat -f '%m' "$target" 2>/dev/null); then
        :
    else
        modified=$(stat -c '%Y' "$target" 2>/dev/null) || return 1
    fi
    now=$(date +%s)
    if [ "$now" -lt "$modified" ]; then
        printf '0\n'
    else
        printf '%s\n' "$(( now - modified ))"
    fi
}

release_install_lock() {
    if [ -n "$INSTALL_LOCK_DIR" ]; then
        local current_owner=""
        current_owner=$(cat "$INSTALL_LOCK_DIR/owner" 2>/dev/null || true)
        if [ "$current_owner" = "$INSTALL_LOCK_OWNER" ]; then
            rm -f -- "$INSTALL_LOCK_DIR/owner" >/dev/null 2>&1 || true
            rmdir "$INSTALL_LOCK_DIR" >/dev/null 2>&1 || true
        fi
        INSTALL_LOCK_DIR=""
        INSTALL_LOCK_OWNER=""
    fi
    if [ -n "$INSTALL_LOCK_FD" ]; then
        eval "exec ${INSTALL_LOCK_FD}<&-" || true
        INSTALL_LOCK_FD=""
    fi
}

cleanup_runtime_env_snapshots() {
    [ "$DRY_RUN" -eq 0 ] || return 0
    [ -d "$STATE_ROOT" ] || return 0
    local active="" candidate attempt
    if [ -f "$ACTIVE_ATTEMPT_FILE" ] && [ ! -L "$ACTIVE_ATTEMPT_FILE" ]; then
        active=$(cat "$ACTIVE_ATTEMPT_FILE" 2>/dev/null || true)
    fi
    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        attempt=$(basename -- "$(dirname -- "$candidate")")
        [ "$attempt" = "$active" ] || safe_remove_file "$candidate"
    done < <(find "$STATE_ROOT" -mindepth 2 -maxdepth 2 -type f -name runtime-env.snapshot -print 2>/dev/null || true)
    while IFS= read -r candidate; do
        [ -n "$candidate" ] || continue
        safe_remove_file "$candidate"
    done < <(find "$STATE_ROOT" -mindepth 2 -maxdepth 2 -type f \( -name 'official-*.input' -o -name 'official-init-input.json' -o -name 'napcat-*.input' -o -name 'napcat-init-input.json' \) -print 2>/dev/null || true)
}

cleanup_orphan_setup_intents() {
    [ "$DRY_RUN" -eq 0 ] || return 0
    [ -d "$DATA_DIR" ] || return 0
    local orphan name attempt marker metadata mode uid _gid size marker_value current_uid entry relative links
    local -a verified_orphans=()
    current_uid=$(id -u)
    # Validate the complete candidate set before deleting any entry. A path
    # sharing our prefix is not ownership proof: unknown or malformed entries
    # are retained and stop setup for manual inspection.
    while IFS= read -r -d '' orphan; do
        [ -n "$orphan" ] || continue
        [ -d "$orphan" ] && [ ! -L "$orphan" ] || die "orphan setup intent staging path is unsafe and was retained: $orphan"
        name=$(basename -- "$orphan")
        attempt=${name#.setup-intent-}
        case "$attempt" in ''|*[!A-Za-z0-9._:-]*) die "orphan setup intent ID is unsafe and was retained: $orphan" ;; esac
        [ "${#attempt}" -le 200 ] || die "orphan setup intent ID is too long and was retained: $orphan"
        metadata=$(stat_metadata "$orphan")
        IFS='|' read -r mode uid _gid _size <<EOF
$metadata
EOF
        [ "$mode" = "700" ] && [ "$uid" = "$current_uid" ] || die "orphan setup intent directory is not private and was retained: $orphan"
        marker="$orphan/.bili-qq-bot-setup-intent-v1"
        [ -e "$marker" ] || die "unknown orphan setup intent was retained: $orphan"
        assert_private_control_file "$marker"
        metadata=$(stat_metadata "$marker")
        IFS='|' read -r _mode _uid _gid size <<EOF
$metadata
EOF
        IFS= read -r marker_value < "$marker" || true
        [ "$marker_value" = "bili-qq-bot/setup-intent/v1|$attempt" ] || \
            die "orphan setup intent marker is invalid and was retained: $orphan"
        # An unpublished intent has a deliberately small closed shape. Validate
        # every candidate and every descendant before deleting any candidate.
        while IFS= read -r -d '' entry; do
            relative=${entry#"$orphan/"}
            [ ! -L "$entry" ] || die "orphan setup intent contains a symlink and was retained: $orphan"
            metadata=$(stat_metadata "$entry")
            IFS='|' read -r mode uid _gid _size <<EOF
$metadata
EOF
            [ "$uid" = "$current_uid" ] || die "orphan setup intent has a foreign owner and was retained: $orphan"
            if [ -d "$entry" ]; then
                [ "$mode" = "700" ] || die "orphan setup intent directory is not private and was retained: $orphan"
                case "$relative" in work|snapshot) ;; *) die "orphan setup intent contains an unknown directory and was retained: $orphan" ;; esac
                [ -z "$(find "$entry" -mindepth 1 -print -quit 2>/dev/null)" ] || \
                    die "orphan setup intent contains unexpected nested state and was retained: $orphan"
            elif [ -f "$entry" ]; then
                [ "$mode" = "600" ] || die "orphan setup intent file is not private and was retained: $orphan"
                if links=$(stat -f '%l' "$entry" 2>/dev/null); then :; else links=$(stat -c '%h' "$entry"); fi
                [ "$links" = "1" ] || die "orphan setup intent contains a hard link and was retained: $orphan"
                case "$relative" in
                    .bili-qq-bot-setup-intent-v1|mount-writers.tsv|networks.tsv|checkpoint-input.json|upgrade-manifest.json) ;;
                    *) die "orphan setup intent contains an unknown file and was retained: $orphan" ;;
                esac
            else
                die "orphan setup intent contains an unsafe entry and was retained: $orphan"
            fi
        done < <(find "$orphan" -mindepth 1 -print0 2>/dev/null || true)
        verified_orphans+=("$orphan")
    done < <(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -name '.setup-intent-*' -print0 2>/dev/null || true)
    # Bash 3.2 treats an initialized-but-empty local array as unset under -u.
    for orphan in ${verified_orphans[@]+"${verified_orphans[@]}"}; do
        rm -rf -- "$orphan"
    done
    file_sync "$DATA_DIR"
}

cleanup_sensitive_setup_inputs() {
    [ -n "${ATTEMPT_DIR:-}" ] || return 0
    local name
    for name in official-app-id.input official-client-secret.input official-root-openids.input official-init-input.json napcat-admin-qq.input napcat-ws-token.input napcat-init-input.json; do
        safe_remove_file "$ATTEMPT_DIR/$name" >/dev/null 2>&1 || true
    done
    OFFICIAL_INIT_INPUT=""
    NAPCAT_INIT_INPUT=""
}

on_exit() {
    local status=$1
    trap - EXIT
    if [ "$DRY_RUN" -eq 0 ] && [ -n "${RUNTIME_ENV_FILE:-}" ]; then
        safe_remove_file "$RUNTIME_ENV_FILE" >/dev/null 2>&1 || true
    fi
    cleanup_sensitive_setup_inputs
    if [ -n "${DRY_RUN_STAGING_DIR:-}" ] && [ -d "$DRY_RUN_STAGING_DIR" ] && [ ! -L "$DRY_RUN_STAGING_DIR" ]; then
        rm -rf -- "$DRY_RUN_STAGING_DIR" >/dev/null 2>&1 || true
    fi
    DRY_RUN_STAGING_DIR=""
    RUNTIME_ENV_CONTENT=""
    release_install_lock
    return "$status"
}

trap 'on_exit $?' EXIT

prepare_rollback_image() {
    if [ -z "$OLD_BOT_CONTAINER" ]; then
        OLD_BOT_CONTAINER=$(find_service_container "bili-qq-bot")
    fi
    if [ -z "$OLD_BOT_CONTAINER" ]; then
        [ "$MODE" = "install" ] || die "existing bili-qq-bot container not found"
        return
    fi
    if [ -z "$OLD_IMAGE_ID" ]; then
        OLD_IMAGE_ID=$(docker_cmd inspect --format '{{.Image}}' "$OLD_BOT_CONTAINER")
    fi
    [ -n "$OLD_IMAGE_ID" ] || die "unable to inspect old bot image ID"
    if [ "$DRY_RUN" -eq 0 ]; then
        [ -n "$ROLLBACK_TAG" ] || ROLLBACK_TAG="bili-qq-bot-rollback:${ATTEMPT_ID}"
        local tagged_id
        docker_cmd image tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG"
        tagged_id=$(image_id "$ROLLBACK_TAG")
        [ "$tagged_id" = "$OLD_IMAGE_ID" ] || die "rollback tag image ID mismatch"
    fi
    if [ "$UPGRADE_NAPCAT" -eq 1 ] || [ -n "$NAPCAT_ROLLBACK_TAG" ]; then
        if [ -z "$OLD_NAPCAT_CONTAINER" ]; then
            OLD_NAPCAT_CONTAINER=$(find_service_container "napcat")
        fi
        [ -n "$OLD_NAPCAT_CONTAINER" ] || die "--upgrade-napcat requires an existing managed NapCat container"
        if [ -z "$OLD_NAPCAT_IMAGE_ID" ]; then
            OLD_NAPCAT_IMAGE_ID=$(docker_cmd inspect --format '{{.Image}}' "$OLD_NAPCAT_CONTAINER")
        fi
        [ -n "$OLD_NAPCAT_IMAGE_ID" ] || die "unable to inspect old NapCat image ID"
        [ -n "$NAPCAT_ROLLBACK_TAG" ] || NAPCAT_ROLLBACK_TAG="bili-qq-bot-napcat-rollback:${ATTEMPT_ID}"
        local napcat_tagged_id
        docker_cmd image tag "$OLD_NAPCAT_IMAGE_ID" "$NAPCAT_ROLLBACK_TAG"
        napcat_tagged_id=$(image_id "$NAPCAT_ROLLBACK_TAG")
        [ "$napcat_tagged_id" = "$OLD_NAPCAT_IMAGE_ID" ] || die "NapCat rollback tag image ID mismatch"
    fi
}

sandbox_cli() {
    if [ -n "$CLI_DRIVER" ]; then
        BILI_SETUP_CLI_INSTALL_ROOT="$INSTALL_DIR" \
        BILI_SETUP_CLI_STAGING_ROOT="${ATTEMPT_DIR:-}" \
        BILI_SETUP_CLI_CONFIG_ROOT="$CONFIG_DIR" \
        BILI_SETUP_CLI_DATA_ROOT="$DATA_DIR" \
        "$CLI_DRIVER" "$@"
        return
    fi

    local install_mount_mode=ro
    [ "${SANDBOX_PUBLICATION_WRITE:-0}" != "1" ] || install_mount_mode=rw
    local mount_args=(
        --rm
        -i
        --network none
        --read-only
        --tmpfs /tmp
        -v "$INSTALL_DIR:/install:$install_mount_mode"
    )
    local config_mount_mode=ro
    [ "${SANDBOX_CONFIG_WRITE:-0}" != "1" ] || config_mount_mode=rw
    [ ! -d "$CONFIG_DIR" ] || mount_args+=(-v "$CONFIG_DIR:/current/config:$config_mount_mode")
    local data_mount_mode=ro
    [ "${SANDBOX_PUBLICATION_WRITE:-0}" != "1" ] || data_mount_mode=rw
    [ ! -d "$DATA_DIR" ] || mount_args+=(-v "$DATA_DIR:/current/data:$data_mount_mode")
    if [ "${SANDBOX_PUBLICATION_WRITE:-0}" = "1" ]; then
        mount_args+=(-v "$(dirname -- "$DATA_DIR"):/current-data-parent:rw")
    fi
    [ ! -d "$DATA_DIR/runtime" ] || mount_args+=(-v "$DATA_DIR/runtime:/current/data/runtime:rw")
    [ ! -d "$LOGS_DIR" ] || mount_args+=(-v "$LOGS_DIR:/current/logs:ro")
    [ ! -d "$FONTS_DIR" ] || mount_args+=(-v "$FONTS_DIR:/current/fonts:ro")
    [ ! -d "$NAPCAT_CONFIG_DIR" ] || mount_args+=(-v "$NAPCAT_CONFIG_DIR:/current/napcat-config:ro")
    [ ! -d "$NAPCAT_QQ_DIR" ] || mount_args+=(-v "$NAPCAT_QQ_DIR:/current/napcat-qq:ro")
    if [ -n "$CONFIG_INPUT" ]; then
        mount_args+=(-v "$CONFIG_INPUT:/input-config.yaml:ro")
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        [ -n "$DRY_RUN_STAGING_DIR" ] && [ -d "$DRY_RUN_STAGING_DIR" ] || die "dry-run staging directory is unavailable"
        mount_args+=(-v "$DRY_RUN_STAGING_DIR:/staging:rw")
    else
        mount_args+=(-v "$ATTEMPT_DIR:/staging:rw")
    fi
    local cli_image_id=${TARGET_IMAGE_ID:-$OLD_IMAGE_ID}
    [ -n "$cli_image_id" ] || die "no image is available for the setup CLI sandbox"
    docker_cmd run "${mount_args[@]}" "$cli_image_id" "$@"
}

config_cli() {
    sandbox_cli node src/cli/config.js "$@"
}

data_cli() {
    sandbox_cli node src/cli/data-migrate.js "$@"
}

write_checkpoint_input() {
    local status=$1
    local ambiguous=false
    local guarantee="exactly-once"
    local exception_scope="none"
    local affected_state="none"
    local retry_policy="none"
    local source_class="$SOURCE_RUNTIME_CLASS"
    local cutover_kind="$CUTOVER_KIND"
    local stop_mode="not-required"
    local drain_outcome="not-required"
    local fence_attempted=false
    local fence_established=false
    local admission_opened=false
    local warning_codes='[]'
    local detached_warning=0
    local rollback_tag_json=null
    [ -z "$ROLLBACK_TAG" ] || rollback_tag_json="\"$ROLLBACK_TAG\""
    if [ "$source_class" = "legacy-v0" ]; then
        guarantee="best-effort"
        exception_scope="legacy-v0-first-cutover-inflight-outbound"
        affected_state="operations-without-durable-part-record"
        retry_policy="retry-determinable-uncommitted-parent-or-target"
        ambiguous=true
        stop_mode="graceful"
        warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS"]'
        case "$LEGACY_FEATURE_INVENTORY_JSON" in
            *'subscription-auto-download'*|*'fallback-send'*|*'python-download'*|*'ffmpeg'*)
                warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_DETACHED_OUTBOUND_AMBIGUOUS"]'
                detached_warning=1
                ;;
        esac
        if [ "$FENCE_CAPABILITY" = "best-effort" ] || [ "$FENCE_CAPABILITY" = "established" ]; then
            fence_attempted=true
        fi
        if [ "$FENCE_CAPABILITY" = "established" ]; then
            fence_established=true
        elif [ "$FENCE_CAPABILITY" = "unavailable" ]; then
            if [ "$detached_warning" -eq 1 ]; then
                warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_DETACHED_OUTBOUND_AMBIGUOUS","LEGACY_NETWORK_FENCE_UNAVAILABLE"]'
            else
                warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_NETWORK_FENCE_UNAVAILABLE"]'
            fi
        fi
        case "$status" in
            runtime_stopped|snapshot_ready|candidate_written|data_applied|probe_started|probe_ready|release_prepared|runtime_release_armed|runtime_released|runtime_ready|upgrade_complete)
                drain_outcome="clean"
                ;;
            *) drain_outcome="interrupted" ;;
        esac
        if [ "$FORCED_STOP_USED" -eq 1 ]; then
            stop_mode="forced"
            drain_outcome="timed-out"
            if [ "$FENCE_CAPABILITY" = "unavailable" ]; then
                if [ "$detached_warning" -eq 1 ]; then
                    warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_DETACHED_OUTBOUND_AMBIGUOUS","LEGACY_NETWORK_FENCE_UNAVAILABLE","LEGACY_FORCED_STOP_BEST_EFFORT"]'
                else
                    warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_NETWORK_FENCE_UNAVAILABLE","LEGACY_FORCED_STOP_BEST_EFFORT"]'
                fi
            else
                if [ "$detached_warning" -eq 1 ]; then
                    warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_DETACHED_OUTBOUND_AMBIGUOUS","LEGACY_FORCED_STOP_BEST_EFFORT"]'
                else
                    warning_codes='["LEGACY_INFLIGHT_DELIVERY_AMBIGUOUS","LEGACY_FORCED_STOP_BEST_EFFORT"]'
                fi
            fi
        fi
    elif [ "$source_class" = "managed-v1+" ]; then
        cutover_kind="managed-upgrade"
        stop_mode="graceful"
        case "$status" in
            runtime_stopped|snapshot_ready|candidate_written|data_applied|probe_started|probe_ready|release_prepared|runtime_release_armed|runtime_released|runtime_ready|upgrade_complete)
                drain_outcome="clean"
                ;;
            *) drain_outcome="interrupted" ;;
        esac
    fi
    if [ "$status" = "runtime_ready" ] || [ "$status" = "upgrade_complete" ]; then
        admission_opened=true
    fi
    cat > "$CHECKPOINT_INPUT" <<EOF
{
  "manifestVersion": 1,
  "checkpoint": "$status",
  "releaseEpoch": "$RELEASE_EPOCH",
  "businessAdmissionOpened": $admission_opened,
  "deployment": {
    "writerSetArtifact": "mount-writers.tsv",
    "networkStateArtifact": "networks.tsv",
    "rollbackImageTag": $rollback_tag_json
  },
  "cutover": {
    "sourceRuntimeClass": "$source_class",
    "cutoverKind": "$cutover_kind",
    "cutoverAttemptId": "$ATTEMPT_ID",
    "deliveryGuarantee": "$guarantee",
    "exceptionScope": "$exception_scope",
    "affectedState": "$affected_state",
    "retryPolicy": "$retry_policy",
    "ambiguousDeliveryWindow": $ambiguous,
    "ambiguousDeliveryWindowStartedAt": null,
    "ambiguousDeliveryWindowEndedAt": null,
    "fenceCapability": "$FENCE_CAPABILITY",
    "stopMode": "$stop_mode",
    "fenceAttempted": $fence_attempted,
    "fenceEstablished": $fence_established,
    "forcedStop": $([ "$FORCED_STOP_USED" -eq 1 ] && printf true || printf false),
    "drainOutcome": "$drain_outcome",
    "legacyFeatureInventory": $LEGACY_FEATURE_INVENTORY_JSON,
    "warningCodes": $warning_codes,
    "appliesToCommittedRuntime": false
  }
}
EOF
    chmod 600 "$CHECKPOINT_INPUT"
    file_sync "$CHECKPOINT_INPUT"
}

checkpoint() {
    local status=$1
    write_checkpoint_input "$status"
    if [ "${TEST_FAILPOINT:-}" = "checkpoint-return-$status" ]; then
        return 1
    fi
    if ! data_cli checkpoint \
        --manifest /staging/upgrade-manifest.json \
        --status "$status" \
        --input /staging/checkpoint-input.json \
        --json >/dev/null; then
        return 1
    fi
    if [ "$status" = "cutover_intent" ] && [ "$ATTEMPT_INTENT_COMMITTED" -eq 0 ]; then
        commit_attempt_intent
    fi
    CURRENT_CHECKPOINT=$status
    # The manifest is authoritative. Set the in-memory rollback boundary as
    # soon as its atomic checkpoint call returns; cache failures after this
    # point must never turn a committed release into a rollback.
    if [ "$status" = "cutover_intent" ]; then
        CUTOVER_INTENT_WRITTEN=1
    fi
    if [ "$status" = "runtime_released" ]; then
        MARKER_COMMITTED=1
    fi
    {
        printf '%s\n' "$status" > "$CHECKPOINT_FILE"
        chmod 600 "$CHECKPOINT_FILE"
        file_sync "$CHECKPOINT_FILE"
    } || log "checkpoint cache update failed; validated manifest remains authoritative"
    {
        printf '%s\n' "$ATTEMPT_ID" > "$ACTIVE_ATTEMPT_FILE"
        chmod 600 "$ACTIVE_ATTEMPT_FILE"
        file_sync "$ACTIVE_ATTEMPT_FILE"
    } || log "active-attempt cache update failed; validated manifest remains authoritative"
}

checkpoint_initial_cutover_intent() {
    if [ -n "$TARGET_IMAGE_ID" ]; then
        checkpoint "cutover_intent"
        return
    fi
    write_checkpoint_input "cutover_intent"
    local now
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    sandbox_cli node -e '
const fs = require("fs")
const [inputPath, manifestPath, now] = process.argv.slice(1)
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"))
delete input.manifestVersion
delete input.checkpoint
const manifest = {
  manifestVersion: 1,
  migrationId: "config-v0-to-v1",
  fromVersion: 0,
  toVersion: 1,
  status: "cutover_intent",
  sourceHashes: {},
  targetHashes: {},
  snapshotHashes: {},
  dataSchemaVersion: 0,
  configSchemaVersion: 1,
  archiveArtifacts: [],
  ...input,
  createdAt: now,
  updatedAt: now
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
' /staging/checkpoint-input.json /staging/upgrade-manifest.json "$now"
    chmod 600 "$MANIFEST_FILE"
    file_sync "$MANIFEST_FILE"
    file_sync "$ATTEMPT_DIR"
    commit_attempt_intent
    CURRENT_CHECKPOINT="cutover_intent"
    CUTOVER_INTENT_WRITTEN=1
}

validate_current_manifest() {
    local checkpoint_value
    checkpoint_value=$(data_cli status --manifest /staging/upgrade-manifest.json --field checkpoint)
    [ "$checkpoint_value" = "$CURRENT_CHECKPOINT" ] || die "validated migration manifest checkpoint mismatch"
}

configure_attempt_paths() {
    if [ "$ATTEMPT_INTENT_COMMITTED" -eq 0 ] && [ "$RESUMING_ATTEMPT" -eq 0 ]; then
        ATTEMPT_STAGING_DIR="$DATA_DIR/.setup-intent-$ATTEMPT_ID"
        ATTEMPT_DIR="$ATTEMPT_STAGING_DIR"
    else
        ATTEMPT_DIR="$STATE_ROOT/$ATTEMPT_ID"
    fi
    WORK_DIR="$ATTEMPT_DIR/work"
    SNAPSHOT_DIR="$ATTEMPT_DIR/snapshot"
    MANIFEST_FILE="$ATTEMPT_DIR/upgrade-manifest.json"
    CHECKPOINT_INPUT="$ATTEMPT_DIR/checkpoint-input.json"
    WRITER_SET_FILE="$ATTEMPT_DIR/mount-writers.tsv"
    NETWORK_STATE_FILE="$ATTEMPT_DIR/networks.tsv"
    RUNTIME_ENV_FILE="$ATTEMPT_DIR/runtime-env.snapshot"
    OWNERSHIP_FILE="$ATTEMPT_DIR/compose-owned.json"
    HEALTH_PORT_FILE="$ATTEMPT_DIR/health-container-port"
    ATTEMPT_METADATA_FILE="$ATTEMPT_DIR/attempt.env"
    CHECKPOINT_FILE="$ATTEMPT_DIR/checkpoint"
    LEGACY_ARCHIVE_PROOF_FILE="$ATTEMPT_DIR/legacy-archive-proof.tsv"
    RELOCATED_CONFIG_ARCHIVE_PROOF_FILE="$ATTEMPT_DIR/relocated-config-archive-proof.tsv"
    RELOCATION_OPERATIONS_FILE="$ATTEMPT_DIR/relocation-operations.tsv"
    RELOCATION_ARTIFACT_FILE="$ATTEMPT_DIR/validated-relocation.json"
    RELEASE_EPOCH="release-$ATTEMPT_ID"
}

select_attempt() {
    if [ ! -e "$ACTIVE_ATTEMPT_FILE" ] && [ -d "$STATE_ROOT" ]; then
        local orphan_candidate="" candidate
        while IFS= read -r candidate; do
            [ -n "$candidate" ] || continue
            [ -z "$orphan_candidate" ] || die "multiple unpublished setup intents require manual recovery"
            orphan_candidate=$candidate
        done < <(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type d -exec sh -c 'for d do [ -f "$d/upgrade-manifest.json" ] && [ ! -e "$d/checkpoint" ] && printf "%s\n" "$d"; done' sh {} + 2>/dev/null || true)
        if [ -n "$orphan_candidate" ]; then
            ATTEMPT_ID=$(basename -- "$orphan_candidate")
            case "$ATTEMPT_ID" in ''|*[!A-Za-z0-9._:-]*) die "unpublished setup intent ID is invalid" ;; esac
            assert_private_control_file "$orphan_candidate/upgrade-manifest.json"
            local active_temp="$ACTIVE_ATTEMPT_FILE.tmp.$$.${RANDOM}"
            printf '%s\n' "$ATTEMPT_ID" > "$active_temp"
            chmod 600 "$active_temp"
            file_sync "$active_temp"
            mv -f -- "$active_temp" "$ACTIVE_ATTEMPT_FILE"
            file_sync "$STATE_ROOT"
        fi
    fi
    if [ -e "$ACTIVE_ATTEMPT_FILE" ] || [ -L "$ACTIVE_ATTEMPT_FILE" ]; then
        assert_private_control_file "$ACTIVE_ATTEMPT_FILE"
        IFS= read -r ATTEMPT_ID < "$ACTIVE_ATTEMPT_FILE" || true
        case "$ATTEMPT_ID" in
            ''|*[!A-Za-z0-9._:-]*) die "active attempt marker is invalid" ;;
        esac
        [ "${#ATTEMPT_ID}" -le 200 ] || die "active attempt marker is too long"
        RESUMING_ATTEMPT=1
        ATTEMPT_INTENT_COMMITTED=1
    else
        ATTEMPT_ID=$(random_id)
    fi
    configure_attempt_paths
}

initialize_attempt() {
    [ -n "$ATTEMPT_ID" ] || select_attempt
    configure_attempt_paths

    [ ! -e "$ATTEMPT_DIR" ] || [ "$RESUMING_ATTEMPT" -eq 1 ] || die "orphan setup intent staging directory exists: $ATTEMPT_DIR"
    mkdir -p -- "$ATTEMPT_DIR" "$WORK_DIR" "$SNAPSHOT_DIR"
    chmod 700 "$ATTEMPT_DIR" "$WORK_DIR" "$SNAPSHOT_DIR"
    if [ "$ATTEMPT_INTENT_COMMITTED" -eq 0 ] && [ "$RESUMING_ATTEMPT" -eq 0 ]; then
        local intent_marker="$ATTEMPT_DIR/.bili-qq-bot-setup-intent-v1"
        local marker_temp="$intent_marker.tmp.$$.${RANDOM}"
        [ ! -e "$intent_marker" ] && [ ! -L "$intent_marker" ] || die "setup intent ownership marker already exists"
        printf 'bili-qq-bot/setup-intent/v1|%s\n' "$ATTEMPT_ID" > "$marker_temp"
        chmod 600 "$marker_temp"
        file_sync "$marker_temp"
        mv -- "$marker_temp" "$intent_marker"
        file_sync "$ATTEMPT_DIR"
    fi
    : > "$WRITER_SET_FILE"
    : > "$NETWORK_STATE_FILE"
    chmod 600 "$WRITER_SET_FILE" "$NETWORK_STATE_FILE"
}

commit_attempt_intent() {
    [ "$ATTEMPT_INTENT_COMMITTED" -eq 0 ] || return 0
    [ -f "$MANIFEST_FILE" ] || die "cutover intent manifest is missing before atomic publication"
    file_sync "$MANIFEST_FILE"
    file_sync "$ATTEMPT_DIR"
    mkdir -p -- "$STATE_ROOT"
    chmod 700 "$STATE_ROOT"
    local final_attempt="$STATE_ROOT/$ATTEMPT_ID"
    [ ! -e "$final_attempt" ] || die "setup attempt already exists: $ATTEMPT_ID"
    test_crashpoint "intent-before-rename"
    mv -- "$ATTEMPT_DIR" "$final_attempt"
    file_sync "$STATE_ROOT"
    ATTEMPT_INTENT_COMMITTED=1
    configure_attempt_paths
    test_crashpoint "intent-after-rename-before-active"
    local active_temp="$ACTIVE_ATTEMPT_FILE.tmp.$$.${RANDOM}"
    printf '%s\n' "$ATTEMPT_ID" > "$active_temp"
    chmod 600 "$active_temp"
    file_sync "$active_temp"
    mv -f -- "$active_temp" "$ACTIVE_ATTEMPT_FILE"
    file_sync "$STATE_ROOT"
}

write_attempt_metadata() {
    cat > "$ATTEMPT_METADATA_FILE" <<EOF
ATTEMPT_ID=$ATTEMPT_ID
OLD_IMAGE_ID=$OLD_IMAGE_ID
ROLLBACK_TAG=$ROLLBACK_TAG
TARGET_IMAGE_ID=$TARGET_IMAGE_ID
OLD_NAPCAT_IMAGE_ID=$OLD_NAPCAT_IMAGE_ID
NAPCAT_ROLLBACK_TAG=$NAPCAT_ROLLBACK_TAG
TARGET_NAPCAT_IMAGE_ID=$TARGET_NAPCAT_IMAGE_ID
RELEASE_EPOCH=$RELEASE_EPOCH
SOURCE_RUNTIME_CLASS=$SOURCE_RUNTIME_CLASS
CUTOVER_KIND=$CUTOVER_KIND
EOF
    chmod 600 "$ATTEMPT_METADATA_FILE"
    file_sync "$ATTEMPT_METADATA_FILE"
}

load_attempt_metadata() {
    [ -f "$ATTEMPT_METADATA_FILE" ] || return 0
    local line key value
    while IFS= read -r line; do
        key=${line%%=*}
        value=${line#*=}
        case "$key" in
            OLD_IMAGE_ID) OLD_IMAGE_ID=$value ;;
            ROLLBACK_TAG) ROLLBACK_TAG=$value ;;
            TARGET_IMAGE_ID) TARGET_IMAGE_ID=$value ;;
            OLD_NAPCAT_IMAGE_ID) OLD_NAPCAT_IMAGE_ID=$value ;;
            NAPCAT_ROLLBACK_TAG) NAPCAT_ROLLBACK_TAG=$value ;;
            TARGET_NAPCAT_IMAGE_ID)
                TARGET_NAPCAT_IMAGE_ID=$value
                [ -z "$value" ] || UPGRADE_NAPCAT=1
                ;;
            RELEASE_EPOCH) RELEASE_EPOCH=$value ;;
            SOURCE_RUNTIME_CLASS) SOURCE_RUNTIME_CLASS=$value ;;
            CUTOVER_KIND) CUTOVER_KIND=$value ;;
        esac
    done < "$ATTEMPT_METADATA_FILE"
}

protected_mount_roots() {
    for path in "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" "$FONTS_DIR" "$NAPCAT_CONFIG_DIR" "$NAPCAT_QQ_DIR"; do
        [ -e "$path" ] && canonical_path "$path"
    done
}

container_state_line() {
    docker_cmd inspect --format '{{.State.Running}}|{{.State.Paused}}|{{.Name}}' "$1"
}

container_mount_sources() {
    docker_cmd inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "$1"
}

container_shares_protected_mount() {
    local container_id=$1
    local source protected
    while IFS= read -r source; do
        [ -n "$source" ] || continue
        source=$(canonical_path "$source")
        while IFS= read -r protected; do
            [ -n "$protected" ] || continue
            if path_is_within "$source" "$protected" || path_is_within "$protected" "$source"; then
                return 0
            fi
        done < <(protected_mount_roots)
    done < <(container_mount_sources "$container_id")
    return 1
}

discover_mount_writers() {
    OLD_NAPCAT_CONTAINER=$(find_service_container "napcat")
    local id state running paused name role

    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if ! container_shares_protected_mount "$id"; then
            continue
        fi
        state=$(container_state_line "$id")
        IFS='|' read -r running paused name <<EOF
$state
EOF
        role="external"
        [ "$id" = "$OLD_BOT_CONTAINER" ] && role="bot"
        [ -n "$OLD_NAPCAT_CONTAINER" ] && [ "$id" = "$OLD_NAPCAT_CONTAINER" ] && role="napcat"
        if [ "$role" = "external" ]; then
            die "unknown container writer shares a protected mount: $name ($id)"
        fi
        printf '%s|%s|%s|%s|%s\n' "$id" "$role" "$running" "$paused" "$name" >> "$WRITER_SET_FILE"
    done < <(docker_cmd ps -aq)

    if [ -n "$OLD_BOT_CONTAINER" ] && ! grep -Fq "$OLD_BOT_CONTAINER|" "$WRITER_SET_FILE"; then
        state=$(container_state_line "$OLD_BOT_CONTAINER")
        IFS='|' read -r running paused name <<EOF
$state
EOF
        printf '%s|bot|%s|%s|%s\n' "$OLD_BOT_CONTAINER" "$running" "$paused" "$name" >> "$WRITER_SET_FILE"
    fi

    file_sync "$WRITER_SET_FILE"
}

known_writer_pid_set() {
    local set="|$$|"
    local id _role _running _paused _name pid
    while IFS='|' read -r id _role _running _paused _name; do
        [ -n "$id" ] || continue
        while IFS= read -r pid; do
            pid=${pid//[[:space:]]/}
            case "$pid" in
                ''|PID|*[!0-9]*) continue ;;
            esac
            set="$set$pid|"
        done < <(docker_cmd top "$id" -eo pid 2>/dev/null || true)
    done < "$WRITER_SET_FILE"
    printf '%s\n' "$set"
}

detect_host_write_handles() {
    if [ "$TEST_MODE" = "1" ] && [ -z "${BILI_SETUP_LSOF_BIN:-}" ]; then
        return 0
    fi
    command -v "$LSOF_BIN" >/dev/null 2>&1 || die "host writer detection requires lsof"
    local known_pids
    known_pids=$(known_writer_pid_set)
    local root output status line current_pid="" current_command=""
    while IFS= read -r root; do
        [ -d "$root" ] || continue
        status=0
        output=$("$LSOF_BIN" -nP -Fpcfa +D "$root" 2>/dev/null) || status=$?
        [ "$status" -eq 0 ] || [ "$status" -eq 1 ] || die "host writer detection failed for a protected mount"
        while IFS= read -r line; do
            case "$line" in
                p*) current_pid=${line#p} ;;
                c*) current_command=${line#c} ;;
                aw|au)
                    case "$known_pids" in
                        *"|$current_pid|"*) ;;
                        *) die "unknown host writer has an open writable handle: ${current_command:-unknown} (${current_pid:-unknown})" ;;
                    esac
                    ;;
            esac
        done <<EOF
$output
EOF
    done < <(protected_mount_roots)
}

capture_runtime_environment() {
    [ -n "$OLD_BOT_CONTAINER" ] || return 0
    RUNTIME_ENV_CONTENT=$(docker_cmd inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$OLD_BOT_CONTAINER")
}

persist_runtime_environment() {
    [ -n "$RUNTIME_ENV_CONTENT" ] || return 0
    printf '%s\n' "$RUNTIME_ENV_CONTENT" > "$RUNTIME_ENV_FILE"
    chmod 600 "$RUNTIME_ENV_FILE"
    file_sync "$RUNTIME_ENV_FILE"
}

collect_legacy_feature_inventory() {
    [ "$SOURCE_RUNTIME_CLASS" = "legacy-v0" ] || { LEGACY_FEATURE_INVENTORY_JSON='[]'; return 0; }
    LEGACY_FEATURE_INVENTORY_JSON=$(printf '%s\n' "$RUNTIME_ENV_CONTENT" | sandbox_cli node -e '
const fs = require("fs")
const configPath = process.argv[1]
const dataRoot = process.argv[2]
let config = {}
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")) } catch {}
const runtimeEnv = fs.readFileSync(0, "utf8")
const hasTrue = (value, key) => {
  if (!value || typeof value !== "object") return false
  if (value[key] === true || value[key] === "true" || value[key] === 1) return true
  return Object.values(value).some(child => child && typeof child === "object" && hasTrue(child, key))
}
const subscriptionFiles = ["subscriptions.json", "subscription_state.json", "subscription_delivery.json"]
const hasSubscriptions = subscriptionFiles.some(name => fs.existsSync(`${dataRoot}/${name}`)) || Object.keys(config.groupConfigs || {}).length > 0
const provider = config.qqProvider === "official" || /^(QQ_PROVIDER|PROVIDER)=official$/m.test(runtimeEnv) ? "official" : "napcat"
const videoDownload = hasTrue(config, "videoDownloadEnabled")
const features = []
if (hasSubscriptions) features.push("subscription-push", "fallback-send")
if (videoDownload) features.push("subscription-auto-download", "python-download", "ffmpeg")
features.push(provider === "official" ? "official-http-send" : "napcat-queued-send")
process.stdout.write(JSON.stringify([...new Set(features)].sort()))
' /current/config/config.json /current/data)
    case "$LEGACY_FEATURE_INVENTORY_JSON" in
        \[*\]) ;;
        *) die "legacy feature inventory collection returned invalid output" ;;
    esac
}

collect_dry_run_feature_inventory() {
    LEGACY_FEATURE_INVENTORY_JSON='[]'
    [ "$SOURCE_RUNTIME_CLASS" = "legacy-v0" ] || return 0
    [ -n "$OLD_BOT_CONTAINER" ] || die "legacy dry-run requires the current bot container for feature inventory"
    LEGACY_FEATURE_INVENTORY_JSON=$(docker_cmd inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$OLD_BOT_CONTAINER" | \
        sandbox_cli node -e '
const fs = require("fs")
const configPath = process.argv[1]
const configRoot = process.argv[2]
const dataRoot = process.argv[3]
let config = {}
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")) } catch {}
const runtimeEnv = fs.readFileSync(0, "utf8")
const hasTrue = (value, key) => {
  if (!value || typeof value !== "object") return false
  if (value[key] === true || value[key] === "true" || value[key] === 1) return true
  return Object.values(value).some(child => child && typeof child === "object" && hasTrue(child, key))
}
const subscriptionFiles = ["subscriptions.json", "subscription_state.json", "subscription_delivery.json"]
const hasSubscriptions = subscriptionFiles.some(name => fs.existsSync(`${dataRoot}/${name}`)) || Object.keys(config.groupConfigs || {}).length > 0
const officialSecret = fs.existsSync(`${configRoot}/.qqOfficialClientSecret`)
const provider = config.qqProvider === "official" || officialSecret || /^(QQ_PROVIDER|PROVIDER)=official$/m.test(runtimeEnv) ? "official" : "napcat"
const videoDownload = hasTrue(config, "videoDownloadEnabled")
const features = []
if (hasSubscriptions) features.push("subscription-push", "fallback-send")
if (videoDownload) features.push("subscription-auto-download", "python-download", "ffmpeg")
features.push(provider === "official" ? "official-http-send" : "napcat-queued-send")
process.stdout.write(JSON.stringify([...new Set(features)].sort()))
' /current/config/config.json /current/config /current/data)
    case "$LEGACY_FEATURE_INVENTORY_JSON" in
        \[*\]) ;;
        *) die "legacy dry-run feature inventory collection returned invalid output" ;;
    esac
}

capture_network_state() {
    : > "$NETWORK_STATE_FILE"
    local id role _running _paused _name mode network ipv4 ipv6 aliases linklocals network_meta network_id driver_opts
    local found_attachable=0
    local found_unfenceable=0
    while IFS='|' read -r id role _running _paused _name; do
        [ -n "$id" ] || continue
        mode=$(docker_cmd inspect --format '{{.HostConfig.NetworkMode}}' "$id")
        if [ "$mode" = "host" ]; then
            printf '%s|%s|host||||||\n' "$id" "$role" >> "$NETWORK_STATE_FILE"
            found_unfenceable=1
            continue
        fi
        if [ "$mode" = "none" ]; then
            printf '%s|%s|none||||||\n' "$id" "$role" >> "$NETWORK_STATE_FILE"
            continue
        fi
        while IFS='|' read -r network ipv4 ipv6 aliases linklocals; do
            [ -n "$network" ] || continue
            network_meta=$(docker_cmd network inspect --format '{{.Id}}|{{range $key, $value := .Options}}{{$key}}={{$value}},{{end}}' "$network")
            network_id=${network_meta%%|*}
            driver_opts=${network_meta#*|}
            [ -n "$network_id" ] || die "unable to inspect network ID: $network"
            printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
                "$id" "$role" "$network" "$network_id" "$ipv4" "$ipv6" "$aliases" "$linklocals" "$driver_opts" >> "$NETWORK_STATE_FILE"
            found_attachable=1
        done < <(docker_cmd inspect --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}}|{{$net.IPAddress}}|{{$net.GlobalIPv6Address}}|{{range $net.Aliases}}{{.}},{{end}}|{{range $net.LinkLocalIPs}}{{.}},{{end}}{{println}}{{end}}' "$id")
    done < "$WRITER_SET_FILE"
    chmod 600 "$NETWORK_STATE_FILE"
    file_sync "$NETWORK_STATE_FILE"
    if [ "$found_unfenceable" -eq 1 ]; then
        FENCE_CAPABILITY="unavailable"
    elif [ "$found_attachable" -eq 1 ]; then
        FENCE_CAPABILITY="best-effort"
    else
        FENCE_CAPABILITY="not-required"
    fi
}

disconnect_legacy_networks() {
    [ "$FENCE_CAPABILITY" = "best-effort" ] || return 0
    local id _role network _rest
    while IFS='|' read -r id _role network _rest; do
        [ -n "$network" ] || continue
        [ "$network" != "host" ] && [ "$network" != "none" ] || continue
        docker_cmd network disconnect -f "$network" "$id"
    done < "$NETWORK_STATE_FILE"
    FENCE_CAPABILITY="established"
    checkpoint "legacy_fenced"
}

split_csv() {
    local csv=$1
    [ -n "$csv" ] || return 0
    local old_ifs=$IFS
    IFS=','
    # shellcheck disable=SC2206
    local values=( $csv )
    IFS=$old_ifs
    printf '%s\n' "${values[@]}"
}

current_writer_container() {
    local recorded_id=$1
    local role=$2
    case "$role" in
        bot) find_service_container "bili-qq-bot" ;;
        napcat) find_service_container "napcat" ;;
        *) printf '%s\n' "$recorded_id" ;;
    esac
}

restore_recorded_networks() {
    [ -f "$NETWORK_STATE_FILE" ] || return 0
    local recorded_id role network network_id ipv4 ipv6 aliases linklocals driver_opts container_id current_meta
    while IFS='|' read -r recorded_id role network network_id ipv4 ipv6 aliases linklocals driver_opts; do
        [ -n "$network" ] || continue
        [ "$network" != "host" ] && [ "$network" != "none" ] || continue
        container_id=$(current_writer_container "$recorded_id" "$role")
        [ -n "$container_id" ] || return 1
        current_meta=$(docker_cmd network inspect --format '{{.Id}}|{{range $key, $value := .Options}}{{$key}}={{$value}},{{end}}' "$network")
        [ "$current_meta" = "$network_id|$driver_opts" ] || return 1
        docker_cmd network disconnect -f "$network" "$container_id" >/dev/null 2>&1 || true
        local args=(network connect)
        [ -z "$ipv4" ] || args+=(--ip "$ipv4")
        [ -z "$ipv6" ] || args+=(--ip6 "$ipv6")
        local alias
        while IFS= read -r alias; do
            [ -z "$alias" ] || args+=(--alias "$alias")
        done < <(split_csv "$aliases")
        local linklocal
        while IFS= read -r linklocal; do
            [ -z "$linklocal" ] || args+=(--link-local-ip "$linklocal")
        done < <(split_csv "$linklocals")
        args+=("$network" "$container_id")
        docker_cmd "${args[@]}" >/dev/null
    done < "$NETWORK_STATE_FILE"
}

is_container_running() {
    [ "$(docker_cmd inspect --format '{{.State.Running}}' "$1" 2>/dev/null || printf false)" = "true" ]
}

container_shutdown_state() {
    docker_cmd inspect --format '{{.State.Running}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}' "$1"
}

verify_clean_managed_shutdown() {
    [ "$SOURCE_RUNTIME_CLASS" = "managed-v1+" ] || return 0
    local id state running exit_code oom_killed residual
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        state=$(container_shutdown_state "$id") || return 1
        IFS='|' read -r running exit_code oom_killed residual <<EOF
$state
EOF
        [ "$running" = "false" ] || return 1
        [ "$exit_code" = "0" ] || return 1
        [ "$oom_killed" = "false" ] || return 1
        [ -z "$residual" ] || return 1
    done < <(writer_ids_in_stop_order)
}

writer_ids_in_stop_order() {
    # Bot first, then NapCat, then any future managed role in lexical ID order.
    awk -F'|' '$2 == "bot" { print "0|" $1 } $2 == "napcat" { print "1|" $1 } $2 != "bot" && $2 != "napcat" { print "2|" $1 }' "$WRITER_SET_FILE" | sort | cut -d'|' -f2-
}

send_graceful_stop() {
    local id
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if is_container_running "$id"; then
            docker_cmd kill --signal TERM "$id" >/dev/null
        fi
    done < <(writer_ids_in_stop_order)

    local deadline=$(( $(date +%s) + STOP_TIMEOUT_SECONDS ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        local any_running=0
        while IFS= read -r id; do
            [ -n "$id" ] || continue
            if is_container_running "$id"; then
                any_running=1
                break
            fi
        done < <(writer_ids_in_stop_order)
        [ "$any_running" -eq 1 ] || return 0
        sleep 1
    done
    return 1
}

snapshot_path() {
    local source=$1
    local relative=$2
    [ -e "$source" ] || return 0
    mkdir -p -- "$(dirname -- "$SNAPSHOT_DIR/$relative")"
    cp -a -- "$source" "$SNAPSHOT_DIR/$relative"
}

assert_private_control_file() {
    local file=$1
    [ ! -L "$file" ] || die "setup control state must not be a symlink: $file"
    [ -e "$file" ] || return 0
    [ -f "$file" ] || die "setup control state must be an ordinary file: $file"
    local metadata mode owner_uid _gid _size
    metadata=$(stat_metadata "$file")
    IFS='|' read -r mode owner_uid _gid _size <<EOF
$metadata
EOF
    [ "$mode" = "600" ] || die "setup control state must have mode 0600: $file"
    [ "$owner_uid" = "$(id -u)" ] || die "setup control state must be owned by the current user: $file"
    local links
    if links=$(stat -f '%l' "$file" 2>/dev/null); then
        :
    else
        links=$(stat -c '%h' "$file")
    fi
    [ "$links" = "1" ] || die "setup control state must have exactly one hard link: $file"
}

record_applied_deployment_baseline() {
    local artifact="$ATTEMPT_DIR/deployment-applied.json"
    local previous="$DATA_DIR/config-state/deployment-applied.json"
    local args=(
        record-deployment-applied
        --config /staging/work/config/config.yaml
        --output /staging/deployment-applied.json
        --release-epoch "$RELEASE_EPOCH"
        --json
    )
    [ ! -f "$previous" ] || args+=(--baseline /current/data/config-state/deployment-applied.json)
    config_cli "${args[@]}" >/dev/null
    assert_private_control_file "$artifact"

    local target_data="$DATA_DIR"
    [ -z "${RELOCATED_DATA_DIR:-}" ] || target_data=$RELOCATED_DATA_DIR
    local target_dir="$target_data/config-state"
    local target="$target_dir/deployment-applied.json"
    mkdir -p -- "$target_dir"
    chmod 700 "$target_dir"
    assert_private_control_file "$target"
    if [ -f "$target" ] && cmp -s "$artifact" "$target"; then
        return 0
    fi
    local temp="$target_dir/.deployment-applied.$ATTEMPT_ID.tmp"
    [ ! -e "$temp" ] && [ ! -L "$temp" ] || die "deployment baseline staging path already exists"
    cp -- "$artifact" "$temp"
    chmod 600 "$temp"
    file_sync "$temp"
    mv -- "$temp" "$target"
    file_sync "$target_dir"
    file_sync "$target_data"
}

snapshot_setup_control_state() {
    local control_snapshot="$SNAPSHOT_DIR/setup-control"
    mkdir -p -- "$control_snapshot"
    chmod 700 "$control_snapshot"
    if [ -d "$STATE_ROOT" ]; then
        assert_private_control_file "$MANAGED_RUNTIME_MARKER"
        assert_private_control_file "$STATE_ROOT/compose-ownership.json"
        (
            cd -- "$STATE_ROOT"
            tar --exclude="./$ATTEMPT_ID" --exclude='./active-attempt' -cpf - .
        ) | (
            cd -- "$control_snapshot"
            tar -xpf -
        )
    fi
    generate_tree_inventory "$control_snapshot" setupControl "$ATTEMPT_DIR/setup-control-inventory.tsv"
    sync_tree "$control_snapshot"
    file_sync "$ATTEMPT_DIR/setup-control-inventory.tsv"
}

restore_setup_control_state() {
    local control_snapshot="$ATTEMPT_DIR/snapshot/setup-control"
    local expected_inventory="$ATTEMPT_DIR/setup-control-inventory.tsv"
    [ -d "$control_snapshot" ] && [ -f "$expected_inventory" ] || die "setup control recovery point is incomplete"
    mkdir -p -- "$STATE_ROOT"
    chmod 700 "$STATE_ROOT"
    if [ ! -f "$control_snapshot/compose-ownership.json" ] && { [ -e "$STATE_ROOT/compose-ownership.json" ] || [ -L "$STATE_ROOT/compose-ownership.json" ]; }; then
        assert_private_control_file "$STATE_ROOT/compose-ownership.json"
        safe_remove_file "$STATE_ROOT/compose-ownership.json"
    fi
    (
        cd -- "$control_snapshot"
        tar -cpf - .
    ) | (
        cd -- "$STATE_ROOT"
        tar -xpf -
    )
    verify_setup_control_state
    sync_tree "$STATE_ROOT"
    file_sync "$DATA_DIR"
}

verify_setup_control_state() {
    local control_snapshot="$ATTEMPT_DIR/snapshot/setup-control"
    local expected_inventory="$ATTEMPT_DIR/setup-control-inventory.tsv"
    [ -d "$control_snapshot" ] && [ -f "$expected_inventory" ] || die "setup control recovery point is incomplete"
    assert_private_control_file "$MANAGED_RUNTIME_MARKER"
    assert_private_control_file "$STATE_ROOT/compose-ownership.json"

    local verify_root
    verify_root=$(mktemp -d "${TMPDIR:-/tmp}/bili-setup-control.XXXXXX")
    chmod 700 "$verify_root"
    (
        cd -- "$STATE_ROOT"
        tar --exclude="./$ATTEMPT_ID" --exclude='./active-attempt' \
            --exclude="./.setup-publication-restore.$ATTEMPT_ID" \
            --exclude="./.bili-publication-quarantine.$ATTEMPT_ID" \
            --exclude="./.compose-ownership.candidate.$ATTEMPT_ID" \
            --exclude="./.compose-ownership.claimed.$ATTEMPT_ID" -cpf - .
    ) | (
        cd -- "$verify_root"
        tar -xpf -
    )
    apply_root_metadata "$control_snapshot" "$verify_root"
    local actual_inventory
    actual_inventory=$(mktemp "${TMPDIR:-/tmp}/bili-setup-control-inventory.XXXXXX")
    generate_tree_inventory "$verify_root" setupControl "$actual_inventory"
    cmp -s "$expected_inventory" "$actual_inventory" || {
        rm -rf -- "$verify_root"
        rm -f -- "$actual_inventory"
        die "restored setup control state failed provenance verification"
    }
    rm -rf -- "$verify_root"
    rm -f -- "$actual_inventory"
}

create_snapshot() {
    local full=${1:-0}
    rm -rf -- "$SNAPSHOT_DIR"
    mkdir -p -- "$SNAPSHOT_DIR"
    chmod 700 "$SNAPSHOT_DIR"
    snapshot_path "$CONFIG_DIR" "config"
    snapshot_path "$COMPOSE_FILE" "docker-compose.yml"
    snapshot_setup_control_state
    if [ -d "$DATA_DIR" ]; then
        mkdir -p -- "$SNAPSHOT_DIR/data"
        # setup-state contains this snapshot itself and must not be recursively
        # copied. It is journal state, not application business data.
        (
            cd -- "$DATA_DIR"
            tar --exclude='./setup-state' -cpf - .
        ) | (
            cd -- "$SNAPSHOT_DIR/data"
            tar -xpf -
        )
    fi
    if [ "$full" -eq 1 ]; then
        snapshot_path "$LOGS_DIR" "logs"
        snapshot_path "$NAPCAT_CONFIG_DIR" "napcat/config"
        snapshot_path "$NAPCAT_QQ_DIR" "napcat/qq"
        snapshot_path "$FONTS_DIR" "fonts/custom"
    fi
    # A forced recovery point is only valid after every regular file and every
    # directory entry in the copied tree has reached durable storage.
    sync_tree "$SNAPSHOT_DIR"
    if [ -d "$SNAPSHOT_DIR/config" ]; then
        generate_tree_inventory "$SNAPSHOT_DIR/config" config "$ATTEMPT_DIR/rollback-config-inventory.tsv"
    fi
    if [ -d "$SNAPSHOT_DIR/data" ]; then
        generate_tree_inventory "$SNAPSHOT_DIR/data" data "$ATTEMPT_DIR/rollback-data-inventory.tsv"
    fi
    if [ -f "$SNAPSHOT_DIR/docker-compose.yml" ]; then
        printf '%s|%s\n' "$(hash_file "$SNAPSHOT_DIR/docker-compose.yml")" "$(stat_metadata "$SNAPSHOT_DIR/docker-compose.yml")" > "$ATTEMPT_DIR/rollback-compose-inventory"
        chmod 600 "$ATTEMPT_DIR/rollback-compose-inventory"
        file_sync "$ATTEMPT_DIR/rollback-compose-inventory"
    fi
    file_sync "$(dirname -- "$SNAPSHOT_DIR")"
}

pause_running_writers() {
    local id
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if is_container_running "$id"; then
            docker_cmd pause "$id" >/dev/null
        fi
    done < <(writer_ids_in_stop_order)
}

force_stop_writers() {
    [ "$ALLOW_FORCE_STOP" -eq 1 ] || die "graceful stop timed out; rerun with --force-stop only after reviewing the best-effort warning"
    if [ "$TEST_MODE" != "1" ] && ! command -v lsof >/dev/null 2>&1 && ! command -v fuser >/dev/null 2>&1; then
        die "forced stop requires lsof or fuser to detect host writers"
    fi
    pause_running_writers
    create_snapshot 1
    data_cli check --root /staging/snapshot --manifest /staging/upgrade-manifest.json --json >/dev/null
    FORCED_STOP_USED=1
    checkpoint "forced_recovery_ready"
    local id
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if is_container_running "$id"; then
            docker_cmd kill --signal KILL "$id" >/dev/null
        fi
    done < <(writer_ids_in_stop_order)
}

stop_writers_for_cutover() {
    if ! send_graceful_stop; then
        force_stop_writers
    fi
    local id
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        is_container_running "$id" && die "writer still running after stop: $id"
    done < <(writer_ids_in_stop_order)
    verify_clean_managed_shutdown || die "managed runtime did not drain and stop cleanly; rollback is required"
    checkpoint "runtime_stopped"
}

preflight_cutover_capacity() {
    node -e '
const fs = require("fs")
const path = require("path")
const roots = process.argv.slice(1)
const forcedBytes = process.env.BILI_SETUP_TEST_AVAILABLE_BYTES
const forcedInodes = process.env.BILI_SETUP_TEST_AVAILABLE_INODES
if ((forcedBytes || forcedInodes) && process.env.BILI_SETUP_TEST_MODE !== "1") process.exit(90)
const seen = new Set()
const measure = target => {
  let stat
  try { stat = fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return { bytes: 0, inodes: 0 }; throw error }
  if (stat.isSymbolicLink()) process.exit(91)
  const key = `${stat.dev}:${stat.ino}`
  if (seen.has(key)) return { bytes: 0, inodes: 0 }
  seen.add(key)
  let result = { bytes: stat.blocks ? stat.blocks * 512 : stat.size, inodes: 1 }
  if (stat.isDirectory()) for (const name of fs.readdirSync(target)) { const child = measure(path.join(target, name)); result.bytes += child.bytes; result.inodes += child.inodes }
  else if (!stat.isFile()) process.exit(91)
  return result
}
const groups = new Map()
for (const root of roots) {
  let stat
  try { stat = fs.statSync(root) } catch (error) { if (error.code === "ENOENT") continue; throw error }
  const device = String(stat.dev)
  const usage = measure(root)
  const current = groups.get(device) || { root, bytes: 0, inodes: 0 }
  current.bytes += usage.bytes; current.inodes += usage.inodes; groups.set(device, current)
}
for (const group of groups.values()) {
  const space = fs.statfsSync(group.root)
  const availableBytes = forcedBytes === undefined ? Number(space.bavail) * Number(space.bsize) : Number(forcedBytes)
  const availableInodes = forcedInodes === undefined ? Number(space.ffree) : Number(forcedInodes)
  const reserveBytes = Math.max(64 * 1024 * 1024, Math.ceil(group.bytes * 0.1))
  const requiredBytes = group.bytes * 3 + reserveBytes
  const requiredInodes = group.inodes * 3 + 128
  if (!Number.isFinite(availableBytes) || !Number.isFinite(availableInodes) || availableBytes < requiredBytes || availableInodes < requiredInodes) {
    process.stderr.write(`SETUP_CAPACITY_INSUFFICIENT device=${group.root} availableBytes=${availableBytes} requiredBytes=${requiredBytes} availableInodes=${availableInodes} requiredInodes=${requiredInodes}\n`)
    process.exit(92)
  }
}
' "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" "$NAPCAT_CONFIG_DIR" "$NAPCAT_QQ_DIR" "$FONTS_DIR" "$ATTEMPT_DIR" || \
        die "SETUP_CAPACITY_INSUFFICIENT: insufficient filesystem capacity or inodes before runtime mutation"
}

restore_snapshot() {
    [ "$TEST_FAILPOINT" != "rollback-snapshot-restore" ] || return 1
    [ -d "$SNAPSHOT_DIR" ] || return 0
    # Resume may happen long after the initial preflight.  Re-evaluate the
    # remaining restore/copy work before creating any new inode or byte range.
    preflight_cutover_capacity
    if [ -d "$SNAPSHOT_DIR/config" ]; then
        rm -rf -- "$CONFIG_DIR"
        cp -a -- "$SNAPSHOT_DIR/config" "$CONFIG_DIR"
    fi
    if [ -d "$SNAPSHOT_DIR/data" ]; then
        local publication_intent="$ATTEMPT_DIR/publication-intent.json"
        local publication_journal="$ATTEMPT_DIR/publication-journal.json"
        local publication_journal_sandbox="/staging/publication-journal.json"
        if [ ! -e "$publication_journal" ] && [ -f "$ATTEMPT_DIR/retained-vault/publication/publication-journal.json" ]; then
            publication_journal="$ATTEMPT_DIR/retained-vault/publication/publication-journal.json"
            publication_journal_sandbox="/staging/retained-vault/publication/publication-journal.json"
        fi
        local publication_trace=0 publication_path
        for publication_path in \
            "$publication_intent" "$publication_journal" \
            "$ATTEMPT_DIR/retained-vault/publication/publication-intent.json" \
            "$INSTALL_DIR/.docker-compose.yml.candidate.$ATTEMPT_ID" \
            "$INSTALL_DIR/.docker-compose.yml.claimed.$ATTEMPT_ID" \
            "$INSTALL_DIR/.bili-publication-quarantine.$ATTEMPT_ID" \
            "$INSTALL_DIR/.setup-publication-restore.$ATTEMPT_ID" \
            "$STATE_ROOT/.compose-ownership.candidate.$ATTEMPT_ID" \
            "$STATE_ROOT/.compose-ownership.claimed.$ATTEMPT_ID" \
            "$STATE_ROOT/.bili-publication-quarantine.$ATTEMPT_ID" \
            "$STATE_ROOT/.setup-publication-restore.$ATTEMPT_ID"; do
            if [ -e "$publication_path" ] || [ -L "$publication_path" ]; then publication_trace=1; fi
        done
        if [ "$publication_trace" -eq 1 ]; then
            assert_private_control_file "$publication_journal"
            [ -f "$publication_journal" ] || return 1
            local publication_terminal=0
            local publication_restore_complete=0
            if sandbox_cli node -e '
const fs = require("fs")
const journal = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (journal.restore?.complete !== true || !["ready", "intent_removed", "intent_retained", "retained"].includes(journal.cleanupTerminal)) process.exit(1)
' "$publication_journal_sandbox"; then publication_terminal=1; fi
            if sandbox_cli node -e '
const fs = require("fs")
const journal = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (journal.restore?.complete !== true || (!journal.workspaceCleanup && !journal.cleanupTerminal)) process.exit(1)
' "$publication_journal_sandbox"; then publication_restore_complete=1; fi
            if [ -e "$publication_intent" ] || [ -L "$publication_intent" ]; then
                assert_private_control_file "$publication_intent"
                validate_publication_intent "$publication_intent" || return 1
            elif [ "$publication_terminal" -ne 1 ]; then
                return 1
            fi
            if [ "$publication_restore_complete" -ne 1 ]; then
                publication_restore_data prepare || return 1
                restore_setup_control_state
                publication_restore_data restore || return 1
            fi
        else
            restore_data_without_publication || return 1
            restore_setup_control_state
        fi
    fi
    if [ -d "$SNAPSHOT_DIR/logs" ]; then
        rm -rf -- "$LOGS_DIR"
        cp -a -- "$SNAPSHOT_DIR/logs" "$LOGS_DIR"
    fi
    if [ -d "$SNAPSHOT_DIR/napcat/config" ]; then
        rm -rf -- "$NAPCAT_CONFIG_DIR"
        mkdir -p -- "$(dirname -- "$NAPCAT_CONFIG_DIR")"
        cp -a -- "$SNAPSHOT_DIR/napcat/config" "$NAPCAT_CONFIG_DIR"
    fi
    if [ -d "$SNAPSHOT_DIR/napcat/qq" ]; then
        rm -rf -- "$NAPCAT_QQ_DIR"
        mkdir -p -- "$(dirname -- "$NAPCAT_QQ_DIR")"
        cp -a -- "$SNAPSHOT_DIR/napcat/qq" "$NAPCAT_QQ_DIR"
    fi
    if [ -d "$SNAPSHOT_DIR/fonts/custom" ]; then
        rm -rf -- "$FONTS_DIR"
        mkdir -p -- "$(dirname -- "$FONTS_DIR")"
        cp -a -- "$SNAPSHOT_DIR/fonts/custom" "$FONTS_DIR"
    fi
    if [ -f "$SNAPSHOT_DIR/docker-compose.yml" ]; then
        atomic_copy_file "$SNAPSHOT_DIR/docker-compose.yml" "$COMPOSE_FILE" 600
    fi
    [ ! -d "$CONFIG_DIR" ] || sync_tree "$CONFIG_DIR"
    [ ! -d "$DATA_DIR" ] || sync_tree "$DATA_DIR"
    [ ! -d "$LOGS_DIR" ] || sync_tree "$LOGS_DIR"
    [ ! -d "$NAPCAT_CONFIG_DIR" ] || sync_tree "$NAPCAT_CONFIG_DIR"
    [ ! -d "$NAPCAT_QQ_DIR" ] || sync_tree "$NAPCAT_QQ_DIR"
    [ ! -d "$FONTS_DIR" ] || sync_tree "$FONTS_DIR"
}

write_publication_intent() {
    local target="$ATTEMPT_DIR/publication-intent.json"
    if [ -e "$target" ] || [ -L "$target" ]; then
        assert_private_control_file "$target"
        validate_publication_intent "$target" || die "publication intent provenance is invalid"
        return 0
    fi
    local temp="$target.tmp"
    [ ! -e "$temp" ] && [ ! -L "$temp" ] || die "publication intent temporary path already exists"
    printf '{"version":1,"attemptId":"%s","kind":"compose-ownership-publication"}\n' "$ATTEMPT_ID" > "$temp"
    chmod 600 "$temp"
    file_sync "$temp"
    mv -- "$temp" "$target"
    file_sync "$ATTEMPT_DIR"
}

validate_publication_intent() {
    local target=$1
    sandbox_cli node -e '
const fs = require("fs")
const [target, attemptId] = process.argv.slice(1)
const value = JSON.parse(fs.readFileSync(target, "utf8"))
if (JSON.stringify(value) !== JSON.stringify({ version: 1, attemptId, kind: "compose-ownership-publication" })) process.exit(1)
' /staging/publication-intent.json "$ATTEMPT_ID"
}

restore_data_without_publication() {
    local failpoint=${BILI_SETUP_TEST_PREPUBLICATION_RESTORE_FAILPOINT:-$TEST_FAILPOINT}
    local sandbox_data
    sandbox_data="/current-data-parent/$(basename -- "$DATA_DIR")"
    [ -z "$CLI_DRIVER" ] || sandbox_data=$DATA_DIR
    SANDBOX_PUBLICATION_WRITE=1 sandbox_cli node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [dataRoot, attemptId, releaseEpoch, failpoint] = process.argv.slice(1)
const stateRoot = path.join(dataRoot, "setup-state")
const attempt = path.join(stateRoot, attemptId)
const snapshot = path.join(attempt, "snapshot", "data")
const workspace = path.join(attempt, "prepublication-data-restore")
const candidate = path.join(workspace, "candidate")
const discard = path.join(workspace, "discard")
const deleteQuarantine = path.join(workspace, "discard-delete-quarantine")
const journalPath = path.join(attempt, "prepublication-data-restore.json")
const vaultRoot = path.join(attempt, "retained-vault")
const vault = path.join(vaultRoot, "prepublication")
const vaultManifestPath = path.join(vaultRoot, "inventory.json")
const hash = value => crypto.createHash("sha256").update(value).digest("hex")
const crash = name => { if (String(failpoint || "").split(",").includes(name)) process.kill(process.pid, "SIGKILL") }
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const fsyncDir = target => { const fd = fs.openSync(target, fs.constants.O_RDONLY); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
const fsyncParent = target => fsyncDir(path.dirname(target))
const nodeFingerprint = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) process.exit(71)
  if (stat.isFile()) return { type: "file", mode: stat.mode & 0o777, size: stat.size, hash: hash(fs.readFileSync(target)) }
  if (!stat.isDirectory()) process.exit(71)
  return { type: "dir", mode: stat.mode & 0o777, entries: fs.readdirSync(target).sort().map(name => [name, nodeFingerprint(path.join(target, name))]) }
}
const proof = (name, target) => { const stat = fs.lstatSync(target); return { name, type: stat.isDirectory() ? "dir" : "file", dev: String(stat.dev), ino: String(stat.ino), fingerprint: hash(Buffer.from(JSON.stringify(nodeFingerprint(target)))), state: "original" } }
const validate = (target, item) => { const stat = statSafe(target); if (!stat || (item.type === "dir" ? !stat.isDirectory() : !stat.isFile()) || String(stat.dev) !== item.dev || String(stat.ino) !== item.ino || hash(Buffer.from(JSON.stringify(nodeFingerprint(target)))) !== item.fingerprint) process.exit(72); return stat }
const syncTree = target => { for (const entry of fs.readdirSync(target, { withFileTypes: true })) { const child = path.join(target, entry.name); if (entry.isDirectory()) syncTree(child); else if (entry.isFile()) { const fd = fs.openSync(child, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } } else process.exit(71) } fsyncDir(target) }
const validatePrivate = (target, type) => {
  const before = fs.lstatSync(target)
  if (before.isSymbolicLink() || before.uid !== process.geteuid() ||
      (type === "file" && (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600)) ||
      (type === "dir" && (!before.isDirectory() || (before.mode & 0o777) !== 0o700))) process.exit(73)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(73) } finally { fs.closeSync(fd) }
  return before
}
const ensurePrivateDir = target => {
  const existing = statSafe(target)
  if (!existing) { fs.mkdirSync(target, { mode: 0o700 }); fsyncParent(target) }
  return validatePrivate(target, "dir")
}
const hardenTree = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) process.exit(73)
  if (stat.isFile()) { fs.chmodSync(target, 0o600); const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; return }
  if (!stat.isDirectory()) process.exit(73)
  for (const name of fs.readdirSync(target)) hardenTree(path.join(target, name))
  fs.chmodSync(target, 0o700); fsyncDir(target)
}
const writeVaultManifest = () => {
  ensurePrivateDir(vaultRoot)
  const previous = statSafe(vaultManifestPath) ? readPrivateJson(vaultManifestPath) : { version: 1, attemptId, releaseEpoch, retained: [] }
  if (previous.version !== 1 || previous.attemptId !== attemptId || previous.releaseEpoch !== releaseEpoch || !Array.isArray(previous.retained)) process.exit(73)
  const byKey = new Map(previous.retained.map(item => [`${item.scope}|${item.retainedPath}`, item]))
  for (const item of journal.retainedInventory || []) byKey.set(`${item.scope}|${item.retainedPath}`, item)
  previous.retained = [...byKey.values()].sort((a, b) => `${a.scope}|${a.retainedPath}`.localeCompare(`${b.scope}|${b.retainedPath}`))
  const temp = privateTemp(vaultManifestPath)
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(previous)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, vaultManifestPath); fsyncParent(vaultManifestPath)
}
const retainRecord = (record, target, disposition = "expected") => {
  const stat = fs.lstatSync(target)
  const type = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null
  if (!type || stat.isSymbolicLink()) process.exit(73)
  hardenTree(target)
  const hardened = fs.lstatSync(target)
  const retainedFingerprint = hash(Buffer.from(JSON.stringify(nodeFingerprint(target))))
  const entry = {
    scope: "prepublication", attemptId, releaseEpoch, originalPath: record.originalPath,
    retainedPath: target, type, dev: String(hardened.dev), ino: String(hardened.ino),
    sourceFingerprint: record.sourceFingerprint || null, retainedFingerprint, disposition
  }
  journal.retainedInventory ||= []
  const existing = journal.retainedInventory.findIndex(item => item.retainedPath === target)
  if (existing >= 0) journal.retainedInventory[existing] = entry
  else journal.retainedInventory.push(entry)
  return entry
}
let journal = null
const privateTemp = target => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`)
const writeJournal = () => { const temp = privateTemp(journalPath); const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) } fs.renameSync(temp, journalPath); fsyncParent(journalPath) }
const readPrivateJson = target => { const before = validatePrivate(target, "file"); const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(73); return JSON.parse(fs.readFileSync(fd, "utf8")) } finally { fs.closeSync(fd) } }
if (statSafe(`${journalPath}.next`)) process.exit(73)
if (statSafe(journalPath)) journal = readPrivateJson(journalPath)
else { if (statSafe(workspace)) process.exit(73); journal = { version: 1, attemptId, workspace: { path: workspace, state: "pending" }, phase: "init" }; writeJournal() }
if (journal.version !== 1 || journal.attemptId !== attemptId || journal.workspace?.path !== workspace) process.exit(73)
if (journal.releaseEpoch && journal.releaseEpoch !== releaseEpoch) process.exit(73)
if (!journal.releaseEpoch) { journal.releaseEpoch = releaseEpoch; writeJournal() }
ensurePrivateDir(vaultRoot); ensurePrivateDir(vault)
let workspaceStat = statSafe(workspace)
if (journal.workspace.state === "pending") { if (!workspaceStat) { fs.mkdirSync(workspace, { mode: 0o700 }); fsyncParent(workspace); crash("prepublication-restore-after-workspace-mkdir"); workspaceStat = statSafe(workspace) } else if (fs.readdirSync(workspace).length !== 0) process.exit(73); Object.assign(journal.workspace, { state: "active", dev: String(workspaceStat.dev), ino: String(workspaceStat.ino) }); writeJournal() }
if (["removing", "removed"].includes(journal.workspace.state)) {
  if (!workspaceStat) process.exit(73)
  validatePrivate(workspace, "dir")
  journal.workspace.state = "active"; journal.phase = "retention_resume"; writeJournal()
}
workspaceStat = validatePrivate(workspace, "dir"); if (String(workspaceStat.dev) !== journal.workspace.dev || String(workspaceStat.ino) !== journal.workspace.ino) process.exit(73)
for (const [key, target] of [["discard", discard], ["candidate", candidate]]) {
  if (!journal[key]) { if (statSafe(target)) process.exit(73); journal[key] = { path: target, state: "pending" }; writeJournal() }
  if (journal[key].state === "pending") { let stat = statSafe(target); if (!stat) { fs.mkdirSync(target, { mode: 0o700 }); fsyncParent(target); crash(`prepublication-restore-after-${key}-mkdir`); stat = statSafe(target) } validatePrivate(target, "dir"); if (fs.readdirSync(target).length !== 0) process.exit(73); Object.assign(journal[key], { state: "active", dev: String(stat.dev), ino: String(stat.ino) }); writeJournal() }
  if (!journal[key].state) journal[key].state = "active"
  const stat = statSafe(target)
  if (journal[key].state === "active" && !stat) process.exit(73)
  if (journal[key].state === "removing" && stat && fs.readdirSync(target).length !== 0) process.exit(73)
  if (journal[key].state === "removed" && stat) process.exit(73)
  if (journal[key].state === "retained") {
    if (stat || !journal[key].retainedPath) process.exit(73)
    const retained = validatePrivate(journal[key].retainedPath, "dir")
    if (String(retained.dev) !== journal[key].retainedDev || String(retained.ino) !== journal[key].retainedIno ||
        hash(Buffer.from(JSON.stringify(nodeFingerprint(journal[key].retainedPath)))) !== journal[key].retainedFingerprint) process.exit(73)
  }
  if (stat) { validatePrivate(target, "dir"); if (String(stat.dev) !== journal[key].dev || String(stat.ino) !== journal[key].ino) process.exit(73) }
}
const snapshotStat = statSafe(snapshot)
if (!snapshotStat?.isDirectory() || snapshotStat.isSymbolicLink()) process.exit(72)
const snapshotNames = fs.readdirSync(snapshot).filter(name => name !== "setup-state").sort()
const snapshotFingerprint = hash(Buffer.from(JSON.stringify(snapshotNames.map(name => [name, nodeFingerprint(path.join(snapshot, name))]))))
if (!journal.snapshot) { journal.snapshot = { dev: String(snapshotStat.dev), ino: String(snapshotStat.ino), fingerprint: snapshotFingerprint }; writeJournal() }
if (journal.snapshot.dev !== String(snapshotStat.dev) || journal.snapshot.ino !== String(snapshotStat.ino) || journal.snapshot.fingerprint !== snapshotFingerprint) process.exit(72)
if (!journal.restoreEntries) {
  const candidateNames = fs.readdirSync(candidate).sort()
  if (candidateNames.length === 0) {
    fsyncDir(candidate); crash("prepublication-restore-after-candidate-clear")
    for (const name of snapshotNames) fs.cpSync(path.join(snapshot, name), path.join(candidate, name), { recursive: true, preserveTimestamps: true })
    syncTree(candidate); crash("prepublication-restore-after-candidate-copy")
  } else {
    const candidateFingerprint = hash(Buffer.from(JSON.stringify(candidateNames.map(name => [name, nodeFingerprint(path.join(candidate, name))]))))
    if (JSON.stringify(candidateNames) !== JSON.stringify(snapshotNames) || candidateFingerprint !== snapshotFingerprint) process.exit(73)
    syncTree(candidate)
  }
  journal.restoreEntries = fs.readdirSync(candidate).sort().map(name => proof(name, path.join(candidate, name)))
  journal.liveEntries = fs.readdirSync(dataRoot).filter(name => name !== "setup-state").sort().map(name => proof(name, path.join(dataRoot, name)))
  journal.phase = "stashing"; writeJournal()
}
for (let index = 0; index < journal.liveEntries.length; index += 1) {
  const item = journal.liveEntries[index], source = path.join(dataRoot, item.name), destination = path.join(discard, item.name)
  const sourceStat = statSafe(source), destinationStat = statSafe(destination)
  if (item.state === "original" && sourceStat) { if (destinationStat) process.exit(74); validate(source, item); crash(`prepublication-restore-before-live-entry-${index + 1}`); fs.renameSync(source, destination); fsyncParent(source); fsyncParent(destination); crash(`prepublication-restore-after-live-entry-rename-${index + 1}`); validate(destination, item); item.state = "stashed"; writeJournal() }
  else if (item.state === "original" && destinationStat) { validate(destination, item); item.state = "stashed"; writeJournal() }
  else if (item.state === "original") process.exit(74)
  if (item.state === "stashed") {
    const restored = journal.restoreEntries.find(entry => entry.name === item.name)
    const liveNow = statSafe(source)
    if (liveNow) {
      const candidateNow = statSafe(path.join(candidate, item.name))
      if (!restored || candidateNow || !["original", "published"].includes(restored.state)) process.exit(74)
      validate(source, restored)
    }
    const cleaned = journal.cleanupEntries?.find(entry => entry.name === item.name)
    if (statSafe(destination)) validate(destination, item)
    else if (!["moving", "quarantined", "deleting", "removed", "retained", "unknown_retained"].includes(cleaned?.state)) process.exit(74)
  }
}
journal.phase = "publishing"; writeJournal()
for (let index = 0; index < journal.restoreEntries.length; index += 1) {
  const item = journal.restoreEntries[index], source = path.join(candidate, item.name), destination = path.join(dataRoot, item.name)
  const sourceStat = statSafe(source), destinationStat = statSafe(destination)
  if (item.state === "original" && sourceStat) { if (destinationStat) process.exit(75); validate(source, item); crash(`prepublication-restore-before-data-entry-${index + 1}`); fs.renameSync(source, destination); fsyncParent(source); fsyncParent(destination); crash(`prepublication-restore-after-data-entry-rename-${index + 1}`); validate(destination, item); item.state = "published"; writeJournal() }
  else if (item.state === "original" && destinationStat) { validate(destination, item); item.state = "published"; writeJournal() }
  else if (item.state === "original") process.exit(75)
  if (item.state === "published") { if (statSafe(source)) process.exit(75); validate(destination, item) }
}
const snapshotRoot = fs.lstatSync(snapshot); fs.chmodSync(dataRoot, snapshotRoot.mode & 0o777); fsyncDir(dataRoot)
journal.phase = "complete"; writeJournal()
const snapshotLate = statSafe(snapshot)
if (!snapshotLate || String(snapshotLate.dev) !== journal.snapshot.dev || String(snapshotLate.ino) !== journal.snapshot.ino || hash(Buffer.from(JSON.stringify(snapshotNames.map(name => [name, nodeFingerprint(path.join(snapshot, name))])))) !== journal.snapshot.fingerprint) process.exit(72)
if (!journal.cleanupEntries) journal.cleanupEntries = journal.liveEntries.map(item => ({ name: item.name, type: item.type, dev: item.dev, ino: item.ino, fingerprint: item.fingerprint, state: "pending" }))
for (let index = 0; index < journal.cleanupEntries.length; index += 1) {
  const item = journal.cleanupEntries[index], target = path.join(discard, item.name), terminal = path.join(vault, `live-${index + 1}-${item.name}`)
  let stat = statSafe(target), terminalStat = statSafe(terminal)
  if (item.state === "pending") {
    if (!stat || terminalStat) process.exit(73)
    validate(target, item); item.state = "moving"; item.terminal = terminal; writeJournal(); crash(`prepublication-restore-before-cleanup-entry-${index + 1}`)
  }
  if (item.state === "moving") {
    if (item.terminal !== terminal) process.exit(73)
    stat = statSafe(target); terminalStat = statSafe(terminal)
    if (stat && terminalStat) process.exit(73)
    if (stat) { validate(target, item); fs.renameSync(target, terminal); fsyncParent(target); fsyncParent(terminal); crash(`prepublication-restore-after-cleanup-entry-rename-${index + 1}`) }
    if (statSafe(target)) process.exit(73)
    const raceSpec = process.env.BILI_SETUP_TEST_PREPUBLICATION_DELETE_RACE || ""
    const [raceIndex, raceKind] = raceSpec.split(":")
    if (raceIndex === String(index + 1) && raceKind) {
      if (raceKind === "same-inode-write") {
        const mutate = fs.openSync(terminal, item.type === "file" ? fs.constants.O_RDWR : fs.constants.O_RDONLY)
        try {
          if (item.type === "file") { fs.writeSync(mutate, Buffer.from("unknown-same-inode\n"), 0, 19, null); fs.fsyncSync(mutate) }
          else {
            const mutateExisting = directory => {
              for (const name of fs.readdirSync(directory).sort()) {
                const child = path.join(directory, name), childStat = fs.lstatSync(child)
                if (childStat.isDirectory()) { if (mutateExisting(child)) return true }
                else if (childStat.isFile()) { fs.appendFileSync(child, "unknown-same-inode\n"); return true }
              }
              return false
            }
            if (!mutateExisting(terminal)) process.exit(72)
          }
        } finally { fs.closeSync(mutate) }
      } else {
        const saved = path.join(vault, `.race-original-${index + 1}-${item.name}`)
        fs.renameSync(terminal, saved); fsyncParent(saved)
        if (item.type === "dir") { fs.mkdirSync(terminal, { mode: 0o700 }); fs.writeFileSync(path.join(terminal, "unknown"), "unknown-race\n", { mode: 0o600 }) }
        else fs.writeFileSync(terminal, "unknown-race\n", { mode: 0o600, flag: "wx" })
        fsyncParent(terminal)
      }
    }
    const actualFingerprint = hash(Buffer.from(JSON.stringify(nodeFingerprint(terminal))))
    const disposition = actualFingerprint === item.fingerprint ? "expected" : "unknown"
    const retained = retainRecord({ originalPath: path.join(dataRoot, item.name), sourceFingerprint: item.fingerprint }, terminal, disposition)
    Object.assign(item, { state: disposition === "expected" ? "retained" : "unknown_retained", retainedPath: terminal,
      retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint, disposition })
    writeJournal(); writeVaultManifest(); crash(`prepublication-restore-after-cleanup-entry-delete-${index + 1}`)
    if (disposition !== "expected") { journal.recoveryRequired = true; writeJournal(); writeVaultManifest(); process.exit(76) }
    terminalStat = statSafe(terminal)
  }
  if (["retained", "unknown_retained"].includes(item.state)) {
    if (statSafe(target) || item.retainedPath !== terminal || !terminalStat) process.exit(73)
    const retained = journal.retainedInventory?.find(entry => entry.retainedPath === terminal)
    if (!retained || retained.attemptId !== attemptId || retained.releaseEpoch !== releaseEpoch ||
        hash(Buffer.from(JSON.stringify(nodeFingerprint(terminal)))) !== retained.retainedFingerprint) process.exit(73)
    if (item.state === "unknown_retained") process.exit(76)
  }
}
for (const [key, target] of [["candidate", candidate], ["discard", discard]]) {
  const item = journal[key], stat = statSafe(target)
  if (item.state === "active") {
    if (!stat) process.exit(73)
    validatePrivate(target, "dir"); if (String(stat.dev) !== item.dev || String(stat.ino) !== item.ino || fs.readdirSync(target).length !== 0) process.exit(73)
    const retainedPath = path.join(vault, `${key}-root`)
    if (statSafe(retainedPath)) process.exit(73)
    item.state = "retaining"; item.retainedPath = retainedPath; writeJournal(); crash(`prepublication-restore-before-${key}-delete`)
    fs.renameSync(target, retainedPath); fsyncParent(target); fsyncParent(retainedPath); crash(`prepublication-restore-after-${key}-delete`)
    const retained = retainRecord({ originalPath: target, sourceFingerprint: hash(Buffer.from(JSON.stringify(nodeFingerprint(retainedPath)))) }, retainedPath)
    Object.assign(item, { state: "retained", retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint }); writeJournal(); writeVaultManifest()
  } else if (item.state === "retaining") {
    const retainedPath = item.retainedPath
    if (stat && statSafe(retainedPath)) process.exit(73)
    if (stat) { fs.renameSync(target, retainedPath); fsyncParent(target); fsyncParent(retainedPath) }
    const retained = retainRecord({ originalPath: target }, retainedPath)
    Object.assign(item, { state: "retained", retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint }); writeJournal(); writeVaultManifest()
  } else if (item.state === "retained") {
    if (stat || !statSafe(item.retainedPath) || hash(Buffer.from(JSON.stringify(nodeFingerprint(item.retainedPath)))) !== item.retainedFingerprint) process.exit(73)
  }
}
journal.workspace.state = "retained"; journal.phase = "retained"; writeJournal(); crash("prepublication-restore-before-workspace-delete")
workspaceStat = validatePrivate(workspace, "dir")
if (String(workspaceStat.dev) !== journal.workspace.dev || String(workspaceStat.ino) !== journal.workspace.ino || fs.readdirSync(workspace).length !== 0) process.exit(73)
const workspaceRetained = retainRecord({ originalPath: workspace }, workspace)
Object.assign(journal.workspace, { retainedDev: workspaceRetained.dev, retainedIno: workspaceRetained.ino, retainedFingerprint: workspaceRetained.retainedFingerprint })
journal.phase = "retained_complete"; writeJournal(); writeVaultManifest(); crash("prepublication-restore-after-workspace-delete")
' "$sandbox_data" "$ATTEMPT_ID" "$RELEASE_EPOCH" "$failpoint" || {
        local status=$?
        [ "$TEST_MODE" != "1" ] || log "pre-publication data restore transaction failed (status=$status)"
        return 1
    }
}

publication_restore_data() {
    local phase=${1:-restore}
    local restore_failpoint=${BILI_SETUP_TEST_PUBLICATION_RESTORE_FAILPOINT:-$TEST_FAILPOINT}
    local sandbox_install=/install
    local sandbox_data
    sandbox_data="/current-data-parent/$(basename -- "$DATA_DIR")"
    if [ -n "$CLI_DRIVER" ]; then
        sandbox_install=$INSTALL_DIR
        sandbox_data=$DATA_DIR
    fi
SANDBOX_PUBLICATION_WRITE=1 sandbox_cli node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [installRoot, dataRoot, attemptId, releaseEpoch, failpoint, phase, stashConflict, workspaceReplacement, dataCandidateReplacement] = process.argv.slice(1)
if (!Number.isInteger(fs.constants.O_NOFOLLOW)) process.exit(60)
const sourceAttempt = path.join(dataRoot, "setup-state", attemptId)
const restoredAttempt = sourceAttempt
const sourceSnapshot = path.join(sourceAttempt, "snapshot", "data")
const stateRoot = path.join(dataRoot, "setup-state")
const installWorkspace = path.join(installRoot, `.setup-publication-restore.${attemptId}`)
const dataWorkspace = path.join(stateRoot, `.setup-publication-restore.${attemptId}`)
const externalJournal = path.join(dataWorkspace, "publication-journal.json")
const dataCandidate = path.join(dataWorkspace, "data-candidate")
const vaultRoot = path.join(sourceAttempt, "retained-vault")
const publicationVault = path.join(vaultRoot, "publication-restore")
const vaultManifestPath = path.join(vaultRoot, "inventory.json")
const hash = value => crypto.createHash("sha256").update(value).digest("hex")
const nodeFingerprint = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) process.exit(66)
  if (stat.isFile()) return { type: "file", mode: stat.mode & 0o777, size: stat.size, hash: hash(fs.readFileSync(target)) }
  if (!stat.isDirectory()) process.exit(66)
  return { type: "dir", mode: stat.mode & 0o777, entries: fs.readdirSync(target).sort().map(name => [name, nodeFingerprint(path.join(target, name))]) }
}
const entriesFingerprint = (root, names) => hash(Buffer.from(JSON.stringify(names.map(name => [name, nodeFingerprint(path.join(root, name))]))))
const objectFingerprint = (target, type) => {
  if (type === "dir") return hash(Buffer.from(JSON.stringify(nodeFingerprint(target))))
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink()) process.exit(61)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(61)
    return hash(fs.readFileSync(fd))
  } finally { fs.closeSync(fd) }
}
const fsyncDir = target => { const fd = fs.openSync(target, fs.constants.O_RDONLY); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
const fsyncParent = target => fsyncDir(path.dirname(target))
const crash = name => { if (String(failpoint || "").split(",").includes(name)) process.kill(process.pid, "SIGKILL") }
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const validatePrivate = (target, type, allowProvenHardlink = false) => {
  const before = fs.lstatSync(target)
  if ((type === "file" && !before.isFile()) || (type === "dir" && !before.isDirectory()) || before.isSymbolicLink() || (type === "file" && before.nlink !== 1 && !allowProvenHardlink) || before.uid !== process.geteuid()) { console.error(`unsafe private ${type}: ${target}`); process.exit(61) }
  if ((type === "file" && (before.mode & 0o777) !== 0o600) || (type === "dir" && (before.mode & 0o777) !== 0o700)) { console.error(`invalid private mode for ${target}`); process.exit(61) }
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(61) } finally { fs.closeSync(fd) }
  return before
}
let journal
const loadJournal = target => {
  const before = validatePrivate(target, "file")
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(61); return JSON.parse(fs.readFileSync(fd, "utf8")) } finally { fs.closeSync(fd) }
}
const privateTemp = target => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`)
const atomicJournalCopy = (source, destination) => {
  const sourceBefore = validatePrivate(source, "file")
  const sourceFd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let value
  try { const opened = fs.fstatSync(sourceFd); if (opened.dev !== sourceBefore.dev || opened.ino !== sourceBefore.ino) process.exit(61); value = fs.readFileSync(sourceFd) } finally { fs.closeSync(sourceFd) }
  const temp = privateTemp(destination)
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, value); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, destination); fsyncParent(destination)
}
const writeJournalFile = (destination, value) => {
  const temp = privateTemp(destination)
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, destination); fsyncParent(destination)
}
const writeJournal = () => {
  const temp = privateTemp(externalJournal)
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, externalJournal); fsyncDir(dataWorkspace)
}
const ensurePrivateDir = target => {
  if (!statSafe(target)) { fs.mkdirSync(target, { mode: 0o700 }); fsyncParent(target) }
  return validatePrivate(target, "dir")
}
const hardenTree = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || stat.uid !== process.geteuid()) process.exit(61)
  if (stat.isFile()) { if (stat.nlink !== 1) { const bytes = fs.readFileSync(target); const temp = `${target}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.private`; const out = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); try { fs.writeFileSync(out, bytes); fs.fsyncSync(out) } finally { fs.closeSync(out) }; fs.renameSync(temp, target); fsyncParent(target) }; fs.chmodSync(target, 0o600); const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; return }
  if (!stat.isDirectory()) process.exit(61)
  for (const name of fs.readdirSync(target)) hardenTree(path.join(target, name))
  fs.chmodSync(target, 0o700); fsyncDir(target)
}
const retainRecord = (record, target, disposition = "expected") => {
  hardenTree(target)
  const stat = fs.lstatSync(target)
  const type = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null
  if (!type) process.exit(61)
  const retainedFingerprint = objectFingerprint(target, type)
  const entry = {
    scope: "publication-restore", attemptId, releaseEpoch, originalPath: record.originalPath,
    retainedPath: target, type, dev: String(stat.dev), ino: String(stat.ino),
    sourceFingerprint: record.sourceFingerprint || null, retainedFingerprint, disposition
  }
  journal.retainedInventory ||= []
  const existing = journal.retainedInventory.findIndex(item => item.retainedPath === target)
  if (existing >= 0) journal.retainedInventory[existing] = entry
  else journal.retainedInventory.push(entry)
  return entry
}
const writeVaultManifest = () => {
  ensurePrivateDir(vaultRoot)
  const previous = statSafe(vaultManifestPath) ? loadJournal(vaultManifestPath) : { version: 1, attemptId, releaseEpoch, retained: [] }
  if (previous.version !== 1 || previous.attemptId !== attemptId || previous.releaseEpoch !== releaseEpoch || !Array.isArray(previous.retained)) process.exit(61)
  const byKey = new Map(previous.retained.map(item => [`${item.scope}|${item.retainedPath}`, item]))
  for (const item of journal.retainedInventory || []) byKey.set(`${item.scope}|${item.retainedPath}`, item)
  previous.retained = [...byKey.values()].sort((a, b) => `${a.scope}|${a.retainedPath}`.localeCompare(`${b.scope}|${b.retainedPath}`))
  writeJournalFile(vaultManifestPath, previous)
}
const originalJournal = path.join(dataRoot, "setup-state", attemptId, "publication-journal.json")
for (const legacyTemp of [`${externalJournal}.next`, `${originalJournal}.restore-next`, `${originalJournal}.workspace-next`]) if (statSafe(legacyTemp)) process.exit(62)
const original = loadJournal(originalJournal)
if (!original.restore?.workspaceIdentities) {
  if (statSafe(installWorkspace) || statSafe(dataWorkspace)) process.exit(62)
  original.restore = { workspaceIdentities: {
    install: { path: installWorkspace, state: "pending" },
    data: { path: dataWorkspace, state: "pending" }
  }, state: "workspace", stashes: [], data: "original", restores: [] }
  writeJournalFile(originalJournal, original)
}
for (const [name, workspace] of [["install", installWorkspace], ["data", dataWorkspace]]) {
  const identity = original.restore.workspaceIdentities[name]
  if (!identity || identity.path !== workspace || !["pending", "active"].includes(identity.state)) process.exit(62)
  let stat = statSafe(workspace)
  if (identity.state === "pending") {
    if (!stat) { fs.mkdirSync(workspace, { mode: 0o700 }); fsyncParent(workspace); crash(`publication-workspace-after-mkdir-${name}`); stat = statSafe(workspace) }
    validatePrivate(workspace, "dir")
    if (fs.readdirSync(workspace).length !== 0) process.exit(62)
    Object.assign(identity, { state: "active", dev: String(stat.dev), ino: String(stat.ino) })
    writeJournalFile(originalJournal, original)
  } else {
    stat = validatePrivate(workspace, "dir")
    if (String(stat.dev) !== identity.dev || String(stat.ino) !== identity.ino) process.exit(62)
  }
}
if (!statSafe(externalJournal)) {
  journal = loadJournal(originalJournal)
  atomicJournalCopy(originalJournal, externalJournal); fsyncDir(dataWorkspace)
  writeJournal()
} else journal = loadJournal(externalJournal)
if (journal.attemptId !== attemptId || !journal.restore?.workspaceIdentities) process.exit(62)
if (journal.releaseEpoch && journal.releaseEpoch !== releaseEpoch) process.exit(62)
if (!journal.releaseEpoch) { journal.releaseEpoch = releaseEpoch; writeJournal() }
ensurePrivateDir(vaultRoot); ensurePrivateDir(publicationVault)
for (const [name, workspace] of [["install", installWorkspace], ["data", dataWorkspace]]) {
  const identity = journal.restore.workspaceIdentities[name]
  const stat = validatePrivate(workspace, "dir")
  if (identity?.path !== workspace || identity.state !== "active" || String(stat.dev) !== identity.dev || String(stat.ino) !== identity.ino) process.exit(62)
}
const effectiveEntry = target => {
  const recorded = journal.entries?.find(entry => entry.path === target)
  const claim = Object.values(journal.publicationClaims || {}).find(value =>
    value && value.claim === target && ["pending", "claimed"].includes(value.state))
  if (!claim) return recorded
  if (typeof claim.dev !== "string" || typeof claim.ino !== "string" || typeof claim.hash !== "string") process.exit(62)
  return { path: target, type: "file", dev: claim.dev, ino: claim.ino, hash: claim.hash }
}
const stashSpecs = [
  [path.join(stateRoot, `.compose-ownership.candidate.${attemptId}`), path.join(dataWorkspace, "ownership-candidate")],
  [path.join(stateRoot, `.compose-ownership.claimed.${attemptId}`), path.join(dataWorkspace, "ownership-claimed")],
  [path.join(installRoot, `.bili-publication-quarantine.${attemptId}`), path.join(installWorkspace, "install-quarantine")],
  [path.join(stateRoot, `.bili-publication-quarantine.${attemptId}`), path.join(dataWorkspace, "ownership-quarantine")]
]
const ownershipCandidate = stashSpecs[0][0]
const ownershipLive = path.join(stateRoot, "compose-ownership.json")
const ownershipDetachTerminal = path.join(publicationVault, "ownership-live-detach")
const ownershipCandidateStat = statSafe(ownershipCandidate)
if (ownershipCandidateStat?.isFile() && ownershipCandidateStat.nlink > 1 && !journal.restore.ownershipLiveDetach) {
  const proof = effectiveEntry(ownershipCandidate)
  const liveStat = statSafe(ownershipLive)
  if (!proof || proof.type !== "file" || ownershipCandidateStat.nlink !== 2 || !liveStat?.isFile() ||
      ownershipCandidateStat.dev !== liveStat.dev || ownershipCandidateStat.ino !== liveStat.ino ||
      String(ownershipCandidateStat.dev) !== proof.dev || String(ownershipCandidateStat.ino) !== proof.ino ||
      hash(fs.readFileSync(ownershipCandidate)) !== proof.hash) process.exit(61)
  if (statSafe(ownershipDetachTerminal)) process.exit(61)
  journal.restore.ownershipLiveDetach = {
    state: "moving", terminal: ownershipDetachTerminal, type: "file", dev: proof.dev, ino: proof.ino,
    hash: proof.hash, fingerprint: hash(Buffer.from(JSON.stringify(nodeFingerprint(ownershipCandidate))))
  }; writeJournal()
}
if (journal.restore.ownershipLiveDetach && !["retained", "legacy_removed"].includes(journal.restore.ownershipLiveDetach.state)) {
  const detach = journal.restore.ownershipLiveDetach
  if (detach.state === "unknown_retained") process.exit(61)
  if (detach.terminal !== ownershipDetachTerminal) process.exit(61)
  let liveStat = statSafe(ownershipLive), terminalStat = statSafe(ownershipDetachTerminal)
  if (detach.state === "moving" && liveStat && !terminalStat) {
    if (!liveStat.isFile() || String(liveStat.dev) !== detach.dev || String(liveStat.ino) !== detach.ino ||
        hash(fs.readFileSync(ownershipLive)) !== detach.hash ||
        hash(Buffer.from(JSON.stringify(nodeFingerprint(ownershipLive)))) !== detach.fingerprint) process.exit(61)
    fs.renameSync(ownershipLive, ownershipDetachTerminal); fsyncParent(ownershipLive); fsyncParent(ownershipDetachTerminal)
    crash("publication-restore-after-ownership-detach-rename")
    liveStat = statSafe(ownershipLive); terminalStat = statSafe(ownershipDetachTerminal)
  }
  if (liveStat) process.exit(61)
  if (terminalStat) {
    if (!terminalStat.isFile() || String(terminalStat.dev) !== detach.dev || String(terminalStat.ino) !== detach.ino ||
        hash(fs.readFileSync(ownershipDetachTerminal)) !== detach.hash ||
        hash(Buffer.from(JSON.stringify(nodeFingerprint(ownershipDetachTerminal)))) !== detach.fingerprint) process.exit(61)
    if (detach.state === "moving") { detach.state = "terminal"; writeJournal() }
  }
  terminalStat = statSafe(ownershipDetachTerminal)
  if (!terminalStat) {
    if (detach.state !== "deleting") process.exit(61)
    detach.state = "legacy_removed"; journal.restore.ownershipLiveDetached = true; writeJournal()
  } else {
    if (String(terminalStat.dev) !== detach.dev || String(terminalStat.ino) !== detach.ino ||
        hash(fs.readFileSync(ownershipDetachTerminal)) !== detach.hash ||
        hash(Buffer.from(JSON.stringify(nodeFingerprint(ownershipDetachTerminal)))) !== detach.fingerprint) process.exit(61)
    if (["terminal", "deleting", "retaining"].includes(detach.state)) {
      detach.state = "retaining"; writeJournal(); crash("publication-restore-before-ownership-detach-delete")
      const race = process.env.BILI_SETUP_TEST_OWNERSHIP_DELETE_RACE || ""
      if (race) {
        const saved = `${ownershipDetachTerminal}.race-original`
        fs.renameSync(ownershipDetachTerminal, saved); fsyncParent(saved)
        fs.writeFileSync(ownershipDetachTerminal, race === "same-inode-write" ? "unknown-same-inode\n" : "unknown-race\n", { mode: 0o600, flag: "wx" }); fsyncParent(ownershipDetachTerminal)
      }
      const actual = hash(Buffer.from(JSON.stringify(nodeFingerprint(ownershipDetachTerminal))))
      const disposition = actual === detach.fingerprint ? "expected" : "unknown"
      const retained = retainRecord({ originalPath: ownershipLive, sourceFingerprint: detach.fingerprint }, ownershipDetachTerminal, disposition)
      Object.assign(detach, { state: disposition === "expected" ? "retained" : "unknown_retained",
        retainedPath: ownershipDetachTerminal, retainedDev: retained.dev, retainedIno: retained.ino,
        retainedFingerprint: retained.retainedFingerprint, disposition })
      journal.restore.ownershipLiveDetached = true; writeJournal(); writeVaultManifest(); crash("publication-restore-after-ownership-detach-delete")
      if (disposition !== "expected") { journal.recoveryRequired = true; writeJournal(); writeVaultManifest(); process.exit(61) }
    }
  }
} else if (journal.restore.ownershipLiveDetached === true && statSafe(ownershipLive) && ownershipCandidateStat &&
           statSafe(ownershipLive).dev === ownershipCandidateStat.dev && statSafe(ownershipLive).ino === ownershipCandidateStat.ino) process.exit(61)
if (journal.restore.ownershipLiveDetach?.state === "retained") {
  const detach = journal.restore.ownershipLiveDetach
  const retained = journal.retainedInventory?.find(item => item.retainedPath === ownershipDetachTerminal)
  if (!retained || retained.attemptId !== attemptId || retained.releaseEpoch !== releaseEpoch || !statSafe(ownershipDetachTerminal) ||
      objectFingerprint(ownershipDetachTerminal, "file") !== retained.retainedFingerprint) process.exit(61)
}
if (phase === "prepare" && /^[1234]$/.test(stashConflict || "")) {
  const conflictPath = stashSpecs[Number(stashConflict) - 1][1]
  if (!statSafe(conflictPath)) {
    fs.writeFileSync(conflictPath, `unknown-stash-${stashConflict}\n`, { mode: 0o600, flag: "wx" })
    fsyncParent(conflictPath)
  }
}
while (journal.restore.stashes.length < stashSpecs.length) journal.restore.stashes.push({ state: "original" })
for (let index = 0; index < stashSpecs.length; index += 1) {
  const [source, stash] = stashSpecs[index]
  const item = journal.restore.stashes[index]
  const sourceStat = statSafe(source), stashStat = statSafe(stash)
  const proof = index < 2
    ? effectiveEntry(source)
    : (journal.retention?.quarantines?.[index - 2] || journal.cleanup?.quarantines?.[index - 2])
  if (index >= 2 && sourceStat && proof?.state === "absent") {
    validatePrivate(source, "dir")
    if (fs.readdirSync(source).length !== 0) process.exit(63)
    Object.assign(proof, { state: "present", dev: String(sourceStat.dev), ino: String(sourceStat.ino) }); writeJournal()
  }
  const proofPresent = index < 2 ? proof?.type === "file" : ["present", "retained"].includes(proof?.state)
  const expectedType = index < 2 ? "file" : "dir"
  if (["original", "moving"].includes(item.state) && !sourceStat && stashStat) {
    if (item.state !== "moving" || !proofPresent || typeof item.fingerprint !== "string" ||
        String(stashStat.dev) !== proof.dev || String(stashStat.ino) !== proof.ino) process.exit(63)
    validatePrivate(stash, expectedType, index < 2)
    if (objectFingerprint(stash, expectedType) !== item.fingerprint) process.exit(63)
    Object.assign(item, { state: "stashed", type: expectedType, dev: String(stashStat.dev), ino: String(stashStat.ino) }); writeJournal()
  }
  if (["original", "moving"].includes(item.state) && sourceStat) {
    if (stashStat) process.exit(63)
    if (!proofPresent || String(sourceStat.dev) !== proof.dev || String(sourceStat.ino) !== proof.ino) process.exit(63)
    const type = expectedType
    validatePrivate(source, type, index < 2)
    const fingerprint = objectFingerprint(source, type)
    if (index < 2 && fingerprint !== proof.hash) process.exit(63)
    if (index >= 2 && proof.state === "retained" && fingerprint !== proof.retainedFingerprint) process.exit(63)
    if (item.state === "original") { Object.assign(item, { state: "moving", type, dev: String(sourceStat.dev), ino: String(sourceStat.ino), fingerprint }); writeJournal() }
    else if (item.fingerprint !== fingerprint) process.exit(63)
    crash(`publication-restore-before-stash-${index + 1}`)
    fs.renameSync(source, stash); fsyncParent(source); fsyncParent(stash)
    const moved = validatePrivate(stash, type, index < 2)
    if (objectFingerprint(stash, type) !== item.fingerprint) process.exit(63)
    Object.assign(item, { state: "stashed", type, dev: String(moved.dev), ino: String(moved.ino) }); writeJournal(); crash(`publication-restore-after-stash-${index + 1}`)
  } else if (item.state === "original") { Object.assign(item, { state: "absent" }); writeJournal() }
  else if (item.state === "moving") process.exit(63)
  if (item.state === "stashed") {
    const restoreItem = journal.restore.restores?.[index]
    if (phase === "prepare" && restoreItem && ["restored", "restashing"].includes(restoreItem.state)) {
      const sourceNow = statSafe(source), stashNow = statSafe(stash)
      if (sourceNow && stashNow) process.exit(63)
      if (restoreItem.state === "restored") { restoreItem.state = "restashing"; writeJournal() }
      if (sourceNow) {
      const current = validatePrivate(source, item.type, index < 2)
        if (String(current.dev) !== restoreItem.dev || String(current.ino) !== restoreItem.ino ||
            typeof restoreItem.fingerprint !== "string" || objectFingerprint(source, item.type) !== restoreItem.fingerprint) process.exit(63)
        fs.renameSync(source, stash); fsyncParent(source); fsyncParent(stash)
        crash(`publication-restore-after-restash-rename-${index + 1}`)
      }
      const moved = validatePrivate(stash, item.type, index < 2)
      if (String(moved.dev) !== restoreItem.dev || String(moved.ino) !== restoreItem.ino ||
          typeof restoreItem.fingerprint !== "string" || objectFingerprint(stash, item.type) !== restoreItem.fingerprint) process.exit(63)
      restoreItem.state = "pending"; delete restoreItem.dev; delete restoreItem.ino; delete restoreItem.fingerprint; writeJournal()
    }
    if (statSafe(stash)) {
      const current = validatePrivate(stash, item.type, index < 2)
      if (String(current.dev) !== item.dev || String(current.ino) !== item.ino ||
          typeof item.fingerprint !== "string" || objectFingerprint(stash, item.type) !== item.fingerprint) process.exit(63)
    } else if (!statSafe(source)) {
      const restoredState = journal.restore.restores?.[index]?.state
      if (restoredState !== "restored") process.exit(63)
    }
  }
}
const snapshotNames = fs.readdirSync(sourceSnapshot).filter(name => name !== "setup-state").sort()
const sourceSnapshotStat = statSafe(sourceSnapshot)
if (!sourceSnapshotStat?.isDirectory() || sourceSnapshotStat.isSymbolicLink()) process.exit(67)
const currentSnapshotFingerprint = entriesFingerprint(sourceSnapshot, snapshotNames)
if (!journal.restore.snapshotProof) { journal.restore.snapshotProof = { dev: String(sourceSnapshotStat.dev), ino: String(sourceSnapshotStat.ino), fingerprint: currentSnapshotFingerprint, names: snapshotNames }; writeJournal() }
if (journal.restore.snapshotProof.dev !== String(sourceSnapshotStat.dev) || journal.restore.snapshotProof.ino !== String(sourceSnapshotStat.ino) || journal.restore.snapshotProof.fingerprint !== currentSnapshotFingerprint || JSON.stringify(journal.restore.snapshotProof.names) !== JSON.stringify(snapshotNames)) process.exit(67)
if (journal.restore.data === "original") {
  crash("publication-restore-before-data-delete")
  const deleteQuarantine = path.join(publicationVault, "live-data")
  if (!journal.restore.liveDataDeleteQuarantine) { journal.restore.liveDataDeleteQuarantine = { path: deleteQuarantine, state: "pending" }; writeJournal() }
  const quarantineProof = journal.restore.liveDataDeleteQuarantine
  let quarantineStat = statSafe(deleteQuarantine)
  if (quarantineProof.path !== deleteQuarantine) process.exit(67)
  if (quarantineProof.state === "pending") {
    if (!quarantineStat) { fs.mkdirSync(deleteQuarantine, { mode: 0o700 }); fsyncParent(deleteQuarantine); quarantineStat = statSafe(deleteQuarantine) }
    validatePrivate(deleteQuarantine, "dir")
    if (fs.readdirSync(deleteQuarantine).length !== 0) process.exit(67)
    Object.assign(quarantineProof, { state: "active", dev: String(quarantineStat.dev), ino: String(quarantineStat.ino) }); writeJournal()
  }
  quarantineStat = validatePrivate(deleteQuarantine, "dir")
  if (!["active", "retained"].includes(quarantineProof.state) || String(quarantineStat.dev) !== quarantineProof.dev || String(quarantineStat.ino) !== quarantineProof.ino) process.exit(67)
  if (quarantineProof.state === "retained" && objectFingerprint(deleteQuarantine, "dir") !== quarantineProof.retainedFingerprint) process.exit(67)
  if (!journal.restore.liveDataEntries) {
    journal.restore.liveDataEntries = fs.readdirSync(dataRoot).filter(name => name !== "setup-state").sort().map(name => {
      const target = path.join(dataRoot, name), stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) process.exit(67)
      return { name, type: stat.isDirectory() ? "dir" : "file", dev: String(stat.dev), ino: String(stat.ino), fingerprint: hash(Buffer.from(JSON.stringify(nodeFingerprint(target)))), state: "pending" }
    }); writeJournal()
  }
  for (let index = 0; index < journal.restore.liveDataEntries.length; index += 1) {
    const item = journal.restore.liveDataEntries[index], target = path.join(dataRoot, item.name), terminal = path.join(deleteQuarantine, `${index + 1}-${item.name}`)
    const matches = (candidate, stat = statSafe(candidate)) => stat && (item.type === "dir" ? stat.isDirectory() : stat.isFile()) && String(stat.dev) === item.dev && String(stat.ino) === item.ino && hash(Buffer.from(JSON.stringify(nodeFingerprint(candidate)))) === item.fingerprint
    let targetStat = statSafe(target), terminalStat = statSafe(terminal)
    if (item.state === "pending") {
      if (!matches(target, targetStat) || terminalStat) process.exit(67)
      item.state = "moving"; item.terminal = terminal; writeJournal(); crash(`publication-restore-before-live-delete-${index + 1}`)
    }
    if (item.state === "moving") {
      if (item.terminal !== terminal) process.exit(67)
      targetStat = statSafe(target); terminalStat = statSafe(terminal)
      if (targetStat && terminalStat) process.exit(67)
      if (targetStat) {
        if (!matches(target, targetStat)) process.exit(67)
        fs.renameSync(target, terminal); fsyncParent(target); fsyncParent(terminal)
        crash(`publication-restore-after-live-delete-rename-${index + 1}`)
      }
      if (statSafe(target) || !matches(terminal)) process.exit(67)
      item.state = "quarantined"; writeJournal()
    }
    if (["quarantined", "deleting", "retaining"].includes(item.state)) {
      if (item.terminal !== terminal || statSafe(target)) process.exit(67)
      terminalStat = statSafe(terminal)
      if (!terminalStat) process.exit(67)
      if (item.state !== "retaining") { if (!matches(terminal, terminalStat)) process.exit(67); item.state = "retaining"; writeJournal() }
      const raceSpec = process.env.BILI_SETUP_TEST_PUBLICATION_DELETE_RACE || ""
      const [raceIndex, raceKind] = raceSpec.split(":")
      if (raceIndex === String(index + 1) && raceKind) {
        if (raceKind === "same-inode-write") {
          if (item.type === "file") fs.appendFileSync(terminal, "unknown-same-inode\n")
          else {
            const mutateExisting = directory => {
              for (const name of fs.readdirSync(directory).sort()) {
                const child = path.join(directory, name), childStat = fs.lstatSync(child)
                if (childStat.isDirectory()) { if (mutateExisting(child)) return true }
                else if (childStat.isFile()) { fs.appendFileSync(child, "unknown-same-inode\n"); return true }
              }
              return false
            }
            if (!mutateExisting(terminal)) process.exit(67)
          }
        } else {
          const saved = path.join(deleteQuarantine, `.race-original-${index + 1}-${item.name}`)
          fs.renameSync(terminal, saved); fsyncParent(saved)
          if (item.type === "dir") { fs.mkdirSync(terminal, { mode: 0o700 }); fs.writeFileSync(path.join(terminal, "unknown"), "unknown-race\n", { mode: 0o600 }) }
          else fs.writeFileSync(terminal, "unknown-race\n", { mode: 0o600, flag: "wx" })
          fsyncParent(terminal)
        }
      }
      const actualFingerprint = hash(Buffer.from(JSON.stringify(nodeFingerprint(terminal))))
      const disposition = actualFingerprint === item.fingerprint ? "expected" : "unknown"
      const retained = retainRecord({ originalPath: target, sourceFingerprint: item.fingerprint }, terminal, disposition)
      Object.assign(item, { state: disposition === "expected" ? "retained" : "unknown_retained", retainedPath: terminal,
        retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint, disposition })
      writeJournal(); writeVaultManifest(); crash(`publication-restore-after-live-delete-${index + 1}`)
      if (disposition !== "expected") { journal.recoveryRequired = true; writeJournal(); writeVaultManifest(); process.exit(69) }
    } else if (["retained", "unknown_retained"].includes(item.state)) {
      const retained = journal.retainedInventory?.find(entry => entry.retainedPath === terminal)
      if (targetStat || !terminalStat || !retained || retained.attemptId !== attemptId || retained.releaseEpoch !== releaseEpoch ||
          objectFingerprint(terminal, item.type) !== retained.retainedFingerprint) process.exit(67)
      if (item.state === "unknown_retained") process.exit(69)
    } else if (item.state === "removed" && (targetStat || terminalStat)) process.exit(67)
  }
  const quarantineRecord = retainRecord({ originalPath: deleteQuarantine }, deleteQuarantine)
  Object.assign(quarantineProof, { state: "retained", retainedPath: deleteQuarantine, retainedDev: quarantineRecord.dev,
    retainedIno: quarantineRecord.ino, retainedFingerprint: quarantineRecord.retainedFingerprint })
  writeJournal(); writeVaultManifest()
  fsyncDir(dataRoot)
  journal.restore.data = "retained"; writeJournal(); crash("publication-restore-after-data-delete")
}
if (["deleted", "retained"].includes(journal.restore.data)) {
  crash("publication-restore-before-data-copy")
  if (process.env.BILI_SETUP_TEST_DATA_CANDIDATE_TEMP_CONFLICT === "1" && !statSafe(`${dataCandidate}.tmp`)) {
    fs.mkdirSync(`${dataCandidate}.tmp`, { mode: 0o700 })
    fs.writeFileSync(path.join(`${dataCandidate}.tmp`, "unknown"), "unknown-data-candidate-temp\n", { mode: 0o600 })
    fsyncDir(`${dataCandidate}.tmp`); fsyncDir(dataWorkspace)
  }
  if (statSafe(`${dataCandidate}.tmp`)) process.exit(67)
  if (!statSafe(dataCandidate)) {
    if (!journal.restore.dataCandidateBuild) {
      journal.restore.dataCandidateBuild = {
        state: "pending",
        path: path.join(dataWorkspace, `.data-candidate.${crypto.randomBytes(16).toString("hex")}.build`)
      }
      writeJournal()
    }
    const build = journal.restore.dataCandidateBuild
    const temporaryCandidate = build.path
    if (path.dirname(temporaryCandidate) !== dataWorkspace || !/^\.data-candidate\.[0-9a-f]{32}\.build$/.test(path.basename(temporaryCandidate)) ||
        !["pending", "active", "ready"].includes(build.state)) process.exit(67)
    let temporaryStat = statSafe(temporaryCandidate)
    if (build.state === "pending") {
      if (!temporaryStat) { fs.mkdirSync(temporaryCandidate, { mode: 0o700 }); fsyncDir(dataWorkspace); crash("publication-restore-after-data-candidate-mkdir"); temporaryStat = statSafe(temporaryCandidate) }
      validatePrivate(temporaryCandidate, "dir")
      if (fs.readdirSync(temporaryCandidate).length !== 0) process.exit(67)
      Object.assign(build, { state: "active", dev: String(temporaryStat.dev), ino: String(temporaryStat.ino) }); writeJournal()
    }
    temporaryStat = validatePrivate(temporaryCandidate, "dir")
    if (String(temporaryStat.dev) !== build.dev || String(temporaryStat.ino) !== build.ino) process.exit(67)
    if (build.state === "active") {
      for (const entry of fs.readdirSync(sourceSnapshot)) {
        if (entry === "setup-state") continue
        fs.cpSync(path.join(sourceSnapshot, entry), path.join(temporaryCandidate, entry), { recursive: true, preserveTimestamps: true })
      }
    }
    const syncTree = target => {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const child = path.join(target, entry.name)
        if (entry.isSymbolicLink()) process.exit(66)
        if (entry.isDirectory()) syncTree(child)
        else if (entry.isFile()) { const fd = fs.openSync(child, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
        else process.exit(66)
      }
      fsyncDir(target)
    }
    syncTree(temporaryCandidate)
    const buildNames = fs.readdirSync(temporaryCandidate).sort()
    const buildFingerprint = entriesFingerprint(temporaryCandidate, buildNames)
    const expectedFingerprint = entriesFingerprint(sourceSnapshot, snapshotNames)
    if (JSON.stringify(buildNames) !== JSON.stringify(snapshotNames) || buildFingerprint !== expectedFingerprint) process.exit(67)
    Object.assign(build, { state: "ready", snapshotFingerprint: buildFingerprint }); writeJournal()
    crash("publication-restore-after-data-candidate-ready")
    fs.renameSync(temporaryCandidate, dataCandidate); fsyncDir(dataWorkspace)
    crash("publication-restore-after-data-candidate-rename")
  } else if (journal.restore.dataCandidateBuild) {
    const build = journal.restore.dataCandidateBuild
    if (build.state !== "ready" || statSafe(build.path)) process.exit(67)
  }
  let candidateStat = validatePrivate(dataCandidate, "dir")
  if (!journal.restore.dataCandidate) {
    const names = fs.readdirSync(dataCandidate).sort()
    const snapshotFingerprint = entriesFingerprint(sourceSnapshot, snapshotNames)
    if (JSON.stringify(names) !== JSON.stringify(snapshotNames) || entriesFingerprint(dataCandidate, names) !== snapshotFingerprint) process.exit(67)
    const build = journal.restore.dataCandidateBuild
    if (!build || build.state !== "ready" || build.dev !== String(candidateStat.dev) || build.ino !== String(candidateStat.ino) || build.snapshotFingerprint !== snapshotFingerprint) process.exit(67)
    journal.restore.dataCandidate = { dev: String(candidateStat.dev), ino: String(candidateStat.ino), snapshotFingerprint }
    build.state = "promoted"
    journal.restore.dataEntries = names.map(name => {
      const target = path.join(dataCandidate, name)
      const stat = fs.lstatSync(target)
      return { name, type: stat.isDirectory() ? "dir" : "file", dev: String(stat.dev), ino: String(stat.ino), fingerprint: hash(Buffer.from(JSON.stringify(nodeFingerprint(target)))), state: "pending" }
    })
    writeJournal()
  } else if (String(candidateStat.dev) !== journal.restore.dataCandidate.dev || String(candidateStat.ino) !== journal.restore.dataCandidate.ino) process.exit(67)
  if (dataCandidateReplacement === "inode") {
    fs.renameSync(dataCandidate, `${dataCandidate}.replaced-original`); fsyncParent(dataCandidate)
    fs.mkdirSync(dataCandidate, { mode: 0o700 }); fs.writeFileSync(path.join(dataCandidate, "unknown"), "unknown-data-candidate\n", { mode: 0o600 }); fsyncDir(dataCandidate); fsyncParent(dataCandidate)
    candidateStat = validatePrivate(dataCandidate, "dir")
    if (String(candidateStat.dev) !== journal.restore.dataCandidate.dev || String(candidateStat.ino) !== journal.restore.dataCandidate.ino) process.exit(67)
  }
  for (let index = 0; index < journal.restore.dataEntries.length; index += 1) {
    const item = journal.restore.dataEntries[index]
    const source = path.join(dataCandidate, item.name), destination = path.join(dataRoot, item.name)
    const sourceStat = statSafe(source), destinationStat = statSafe(destination)
    const validateEntry = (target, stat) => {
      if (!stat || (item.type === "dir" ? !stat.isDirectory() : !stat.isFile()) || String(stat.dev) !== item.dev || String(stat.ino) !== item.ino || hash(Buffer.from(JSON.stringify(nodeFingerprint(target)))) !== item.fingerprint) process.exit(67)
    }
    if (item.state === "pending" && sourceStat) {
      if (destinationStat) process.exit(67)
      validateEntry(source, sourceStat); crash(`publication-restore-before-data-entry-${index + 1}`)
      fs.renameSync(source, destination); fsyncParent(source); fsyncParent(destination)
      crash(`publication-restore-after-data-entry-rename-${index + 1}`)
      validateEntry(destination, statSafe(destination)); item.state = "published"; writeJournal(); crash(`publication-restore-after-data-entry-journal-${index + 1}`)
    } else if (item.state === "pending" && destinationStat) {
      validateEntry(destination, destinationStat); item.state = "published"; writeJournal()
    } else if (item.state === "pending") process.exit(67)
    if (item.state === "published") {
      if (statSafe(source)) process.exit(67)
      validateEntry(destination, statSafe(destination))
    }
  }
  const sourceRoot = fs.lstatSync(sourceSnapshot)
  fs.chmodSync(dataRoot, sourceRoot.mode & 0o777)
  try { fs.chownSync(dataRoot, sourceRoot.uid, sourceRoot.gid) } catch (error) {
    const currentRoot = fs.lstatSync(dataRoot)
    if (currentRoot.uid !== sourceRoot.uid || currentRoot.gid !== sourceRoot.gid) throw error
  }
  fsyncDir(dataRoot)
  crash("publication-restore-after-data-publish-before-journal")
  journal.restore.data = "copied"; writeJournal()
  atomicJournalCopy(externalJournal, path.join(restoredAttempt, "publication-journal.json")); fsyncDir(restoredAttempt)
  crash("publication-restore-after-data-copy")
}
if (journal.restore.data === "copied" && statSafe(dataCandidate)) {
  validatePrivate(dataCandidate, "dir")
  if (fs.readdirSync(dataCandidate).length !== 0) process.exit(67)
  const retainedCandidate = path.join(publicationVault, "data-candidate-root")
  if (statSafe(retainedCandidate)) process.exit(67)
  fs.renameSync(dataCandidate, retainedCandidate); fsyncParent(dataCandidate); fsyncParent(retainedCandidate)
  const retained = retainRecord({ originalPath: dataCandidate }, retainedCandidate)
  journal.restore.dataCandidateRetained = { path: retainedCandidate, dev: retained.dev, ino: retained.ino, fingerprint: retained.retainedFingerprint }
  writeJournal(); writeVaultManifest()
}
if (phase === "prepare") {
  atomicJournalCopy(externalJournal, path.join(restoredAttempt, "publication-journal.json")); fsyncDir(restoredAttempt)
  process.exit(0)
}
while (journal.restore.restores.length < stashSpecs.length) journal.restore.restores.push({ state: "pending" })
for (let index = 0; index < stashSpecs.length; index += 1) {
  const [destination, stash] = stashSpecs[index]
  const stashItem = journal.restore.stashes[index]
  const item = journal.restore.restores[index]
  if (stashItem.state !== "stashed") { item.state = "absent"; continue }
  const destinationStat = statSafe(destination), stashStat = statSafe(stash)
  if (["pending", "moving"].includes(item.state) && destinationStat && !stashStat) {
    if (String(destinationStat.dev) !== stashItem.dev || String(destinationStat.ino) !== stashItem.ino ||
        typeof stashItem.fingerprint !== "string" || objectFingerprint(destination, stashItem.type) !== stashItem.fingerprint) process.exit(65)
    item.state = "restored"; item.dev = stashItem.dev; item.ino = stashItem.ino; item.fingerprint = stashItem.fingerprint; writeJournal()
  }
  if (["pending", "moving"].includes(item.state)) {
    if (destinationStat || !stashStat) process.exit(65)
    const current = validatePrivate(stash, stashItem.type, index < 2)
    if (String(current.dev) !== stashItem.dev || String(current.ino) !== stashItem.ino ||
        typeof stashItem.fingerprint !== "string" || objectFingerprint(stash, stashItem.type) !== stashItem.fingerprint) process.exit(65)
    if (item.state === "pending") { Object.assign(item, { state: "moving", dev: stashItem.dev, ino: stashItem.ino, fingerprint: stashItem.fingerprint }); writeJournal() }
    crash(`publication-restore-before-restore-${index + 1}`)
    fs.renameSync(stash, destination); fsyncParent(stash); fsyncParent(destination)
    const restored = validatePrivate(destination, stashItem.type, index < 2)
    if (objectFingerprint(destination, stashItem.type) !== item.fingerprint) process.exit(65)
    Object.assign(item, { state: "restored", dev: String(restored.dev), ino: String(restored.ino) }); writeJournal(); crash(`publication-restore-after-restore-${index + 1}`)
  }
  if (item.state === "restored") {
    if (!statSafe(destination) && !statSafe(stash)) item.state = "removed"
    else {
      const current = validatePrivate(destination, stashItem.type, index < 2)
      if (String(current.dev) !== item.dev || String(current.ino) !== item.ino ||
          typeof item.fingerprint !== "string" || objectFingerprint(destination, stashItem.type) !== item.fingerprint) process.exit(65)
    }
  }
}
journal.restore.complete = true
writeJournal()
const externalStat = validatePrivate(externalJournal, "file")
journal.restore.externalJournalIdentity = {
  path: externalJournal, dev: String(externalStat.dev), ino: String(externalStat.ino), hash: hash(fs.readFileSync(externalJournal))
}
writeJournalFile(path.join(restoredAttempt, "publication-journal.json"), journal); fsyncDir(restoredAttempt)
if (["install", "data"].includes(workspaceReplacement || "")) {
  const target = workspaceReplacement === "install" ? installWorkspace : dataWorkspace
  fs.renameSync(target, `${target}.replaced-original`); fsyncParent(target)
  fs.mkdirSync(target, { mode: 0o700 }); fs.writeFileSync(path.join(target, "unknown"), "unknown-workspace-bytes\n", { mode: 0o600 }); fsyncDir(target); fsyncParent(target)
}
const installIdentity = journal.restore.workspaceIdentities.install
const dataIdentity = journal.restore.workspaceIdentities.data
const installStat = validatePrivate(installWorkspace, "dir")
const dataStat = validatePrivate(dataWorkspace, "dir")
if (String(installStat.dev) !== installIdentity.dev || String(installStat.ino) !== installIdentity.ino ||
    String(dataStat.dev) !== dataIdentity.dev || String(dataStat.ino) !== dataIdentity.ino) process.exit(68)
if (fs.readdirSync(installWorkspace).length !== 0) process.exit(68)
const dataEntries = fs.readdirSync(dataWorkspace)
if (dataEntries.length !== 1 || dataEntries[0] !== "publication-journal.json") process.exit(68)
' "$sandbox_install" "$sandbox_data" "$ATTEMPT_ID" "$RELEASE_EPOCH" "$restore_failpoint" "$phase" "${BILI_SETUP_TEST_PUBLICATION_RESTORE_STASH_CONFLICT:-}" "${BILI_SETUP_TEST_PUBLICATION_WORKSPACE_REPLACEMENT:-}" "${BILI_SETUP_TEST_DATA_CANDIDATE_REPLACEMENT:-}" || {
        local status=$?
        [ "$TEST_MODE" != "1" ] || log "publication restore data transaction failed (status=$status)"
        return 1
    }
}

cleanup_publication_claims() {
    SANDBOX_PUBLICATION_WRITE=1 sandbox_cli node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [journalPath, attemptId, releaseEpoch, failpoint, raceHook, externalReplacement, ...expectedPaths] = process.argv.slice(1)
if (!Number.isInteger(fs.constants.O_NOFOLLOW)) process.exit(29)
const hash = value => crypto.createHash("sha256").update(value).digest("hex")
const attemptRoot = path.dirname(journalPath)
const vaultRoot = path.join(attemptRoot, "retained-vault")
const publicationVault = path.join(vaultRoot, "publication")
const vaultJournal = path.join(publicationVault, "publication-journal.json")
const vaultIntent = path.join(publicationVault, "publication-intent.json")
const vaultManifestNames = () => fs.readdirSync(vaultRoot).filter(name => /^inventory-[0-9]{12}\.json$/.test(name)).sort()
const fsyncParent = target => {
  const fd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY)
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
const fsyncDir = target => { const fd = fs.openSync(target, fs.constants.O_RDONLY); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
const crash = name => { if (failpoint === name) process.kill(process.pid, "SIGKILL") }
const replacementBytes = Buffer.from(`unknown-publication-race-${raceHook}\n`)
const replacePath = target => {
  const expectedIndex = expectedPaths.indexOf(target)
  const terminalIndex = terminalPaths.indexOf(target)
  const parent = expectedIndex >= 0 ? quarantineDirs[expectedIndex < 2 ? 0 : 1]
    : terminalIndex >= 0 ? quarantineDirs[terminalIndex < 2 ? 0 : 1]
      : path.dirname(target)
  const saved = path.join(parent, `.race-original.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}`)
  fs.renameSync(target, saved); fsyncParent(saved)
  fs.writeFileSync(target, replacementBytes, { mode: 0o600, flag: "wx" })
  const fd = fs.openSync(target, fs.constants.O_RDONLY); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fsyncParent(target)
}
const hook = (name, target) => { if (raceHook === name) replacePath(target) }
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const privateTemp = target => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`)
const validatePrivate = (target, type) => {
  const before = fs.lstatSync(target)
  if (before.isSymbolicLink() || before.uid !== process.geteuid() ||
      (type === "file" && (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600)) ||
      (type === "dir" && (!before.isDirectory() || (before.mode & 0o777) !== 0o700))) process.exit(31)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(31) } finally { fs.closeSync(fd) }
  return before
}
const ensurePrivateDir = target => {
  if (!statSafe(target)) { fs.mkdirSync(target, { mode: 0o700 }); fsyncParent(target) }
  return validatePrivate(target, "dir")
}
const nodeFingerprint = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) process.exit(35)
  if (stat.isFile()) return { type: "file", mode: stat.mode & 0o777, size: stat.size, hash: hash(fs.readFileSync(target)) }
  if (!stat.isDirectory()) process.exit(35)
  return { type: "dir", mode: stat.mode & 0o777, entries: fs.readdirSync(target).sort().map(name => [name, nodeFingerprint(path.join(target, name))]) }
}
const fingerprint = target => hash(Buffer.from(JSON.stringify(nodeFingerprint(target))))
const hardenTree = target => {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || stat.uid !== process.geteuid()) process.exit(35)
  if (stat.isFile()) { if (stat.nlink !== 1) { const bytes = fs.readFileSync(target); const temp = `${target}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.private`; const out = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); try { fs.writeFileSync(out, bytes); fs.fsyncSync(out) } finally { fs.closeSync(out) }; fs.renameSync(temp, target); fsyncParent(target) }; fs.chmodSync(target, 0o600); const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; return }
  if (!stat.isDirectory()) process.exit(35)
  for (const name of fs.readdirSync(target)) hardenTree(path.join(target, name))
  fs.chmodSync(target, 0o700); fsyncDir(target)
}
const readPrivateJson = target => {
  const before = validatePrivate(target, "file")
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try { const opened = fs.fstatSync(fd); if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(31); return JSON.parse(fs.readFileSync(fd, "utf8")) } finally { fs.closeSync(fd) }
}
ensurePrivateDir(vaultRoot); ensurePrivateDir(publicationVault)
let activeJournalPath = statSafe(journalPath) ? journalPath : statSafe(vaultJournal) ? vaultJournal : null
if (!activeJournalPath) {
  if (expectedPaths.every(target => !statSafe(target))) process.exit(0)
  process.exit(30)
}
let journal = readPrivateJson(activeJournalPath)
if (journal.version !== 1 || journal.attemptId !== attemptId || !Array.isArray(journal.entries) || journal.entries.length !== expectedPaths.length) process.exit(32)
if (journal.releaseEpoch && journal.releaseEpoch !== releaseEpoch) process.exit(32)
journal.releaseEpoch ||= releaseEpoch
const byPath = new Map(journal.entries.map(entry => [entry.path, entry]))
if (byPath.size !== expectedPaths.length || expectedPaths.some(target => !byPath.has(target))) process.exit(33)
const unreconciledClaims = journal.retention ? {} : (journal.publicationClaims || {})
for (const [claimKey, claim] of Object.entries(unreconciledClaims)) {
  if (!claim || !["pending", "claimed"].includes(claim.state)) continue
  if (!expectedPaths.includes(claim.claim) || typeof claim.dev !== "string" || typeof claim.ino !== "string" || typeof claim.hash !== "string") process.exit(34)
  const sourceStat = statSafe(claim.source), claimStat = statSafe(claim.claim)
  const matches = target => {
    const stat = statSafe(target)
    return Boolean(stat && stat.isFile() && !stat.isSymbolicLink() && String(stat.dev) === claim.dev &&
      String(stat.ino) === claim.ino && hash(fs.readFileSync(target)) === claim.hash)
  }
  const sourceMatchesRestoredBytes = Boolean(sourceStat && sourceStat.isFile() && !sourceStat.isSymbolicLink() &&
    hash(fs.readFileSync(claim.source)) === claim.hash)
  if (claim.state === "pending" && sourceMatchesRestoredBytes && !claimStat) {
    delete journal.publicationClaims[claimKey]
    continue
  }
  if (claimStat && matches(claim.claim)) {
    claim.state = "claimed"
    byPath.set(claim.claim, { path: claim.claim, type: "file", dev: claim.dev, ino: claim.ino, hash: claim.hash })
    continue
  }
  process.exit(34)
}
const quarantineDirs = [
  path.join(path.dirname(expectedPaths[0]), `.bili-publication-quarantine.${attemptId}`),
  path.join(path.dirname(expectedPaths[2]), `.bili-publication-quarantine.${attemptId}`)
]
const claimPaths = expectedPaths.map((target, index) => path.join(quarantineDirs[index < 2 ? 0 : 1], `${index + 1}-${path.basename(target)}`))
const terminalPaths = expectedPaths.map((target, index) => path.join(quarantineDirs[index < 2 ? 0 : 1], `.retained-${index + 1}-${path.basename(target)}`))
const pathExists = target => { try { fs.lstatSync(target); return true } catch (error) { if (error.code === "ENOENT") return false; throw error } }
const sameInode = (left, right) => {
  const leftStat = statSafe(left), rightStat = statSafe(right)
  return Boolean(leftStat && rightStat && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino)
}
const moveFileNoReplace = (source, destination, exitCode, raceName) => {
  if (sameInode(source, destination)) { fs.unlinkSync(source); fsyncParent(source); fsyncParent(destination); return }
  if (process.env.BILI_SETUP_TEST_PUBLICATION_FINAL_DESTINATION_RACE === raceName) {
    fs.writeFileSync(destination, `unknown final destination race: ${raceName}\n`, { mode: 0o600, flag: "wx" }); fsyncParent(destination)
  }
  try { fs.linkSync(source, destination) } catch (error) { if (error.code === "EEXIST") process.exit(exitCode); throw error }
  if (!sameInode(source, destination)) process.exit(exitCode)
  fs.unlinkSync(source); fsyncParent(source); fsyncParent(destination)
}
const canonicalParentPath = target => {
  let parent = path.dirname(target)
  const suffix = []
  while (!pathExists(parent)) { suffix.unshift(path.basename(parent)); parent = path.dirname(parent) }
  return path.join(fs.realpathSync(parent), ...suffix, path.basename(target))
}
const validateFd = (target, expected, hookName = null) => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || String(before.dev) !== expected.dev || String(before.ino) !== expected.ino) throw new Error("publication proof identity mismatch")
  if (hookName) hook(hookName, target)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || hash(fs.readFileSync(fd)) !== expected.hash) throw new Error("publication proof hash mismatch")
    return { fd, opened }
  } catch (error) { fs.closeSync(fd); throw error }
}
if (pathExists(`${journalPath}.cleanup-next`)) process.exit(37)
const writeJournal = () => {
  const tempJournal = privateTemp(activeJournalPath)
  const fd = fs.openSync(tempJournal, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tempJournal, activeJournalPath)
  fsyncParent(activeJournalPath)
}
let hardlinkHookUsed = false
const injectVaultHardlink = retainedPath => {
  const kind = process.env.BILI_SETUP_TEST_VAULT_HARDLINK_KIND || ""
  if (hardlinkHookUsed || !["direct", "nested"].includes(kind)) return
  if (kind === "nested") {
    const nested = path.join(vaultRoot, "hardlink-nested-fixture", "child")
    ensurePrivateDir(path.dirname(nested)); ensurePrivateDir(nested)
    const source = path.join(nested, "artifact")
    fs.writeFileSync(source, "nested-vault-hardlink-fixture\n", { mode: 0o600, flag: "wx" }); fs.chmodSync(source, 0o644)
    const alias = path.join(attemptRoot, "vault-external-hardlink-nested")
    fs.linkSync(source, alias); fsyncParent(alias)
    hardenTree(path.join(vaultRoot, "hardlink-nested-fixture"))
    hardlinkHookUsed = true
    return
  }
  const source = path.join(vaultRoot, "hardlink-direct-fixture")
  fs.writeFileSync(source, "direct-vault-hardlink-fixture\n", { mode: 0o600, flag: "wx" }); fs.chmodSync(source, 0o644)
  const alias = path.join(attemptRoot, `vault-external-hardlink-${kind}`)
  if (statSafe(alias)) process.exit(38)
  fs.chmodSync(source, 0o644)
  fs.linkSync(source, alias)
  fsyncParent(alias)
  hardenTree(source)
  hardlinkHookUsed = true
}
const recordRetained = (scope, originalPath, retainedPath, expected = null, disposition = "expected") => {
  injectVaultHardlink(retainedPath)
  hardenTree(retainedPath)
  const stat = fs.lstatSync(retainedPath)
  const type = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null
  if (!type) process.exit(38)
  const entry = { scope, attemptId, releaseEpoch, originalPath, retainedPath, type,
    dev: String(stat.dev), ino: String(stat.ino), sourceFingerprint: expected?.fingerprint || expected?.hash || null,
    retainedFingerprint: fingerprint(retainedPath), disposition }
  journal.retainedInventory ||= []
  const index = journal.retainedInventory.findIndex(item => item.scope === scope && item.retainedPath === retainedPath)
  if (index >= 0) journal.retainedInventory[index] = entry
  else journal.retainedInventory.push(entry)
  return entry
}
const writeVaultManifest = () => {
  const names = vaultManifestNames()
  for (let index = 0; index < names.length; index += 1) if (names[index] !== `inventory-${String(index + 1).padStart(12, "0")}.json`) process.exit(38)
  const previous = names.length ? readPrivateJson(path.join(vaultRoot, names[names.length - 1])) : { version: 1, attemptId, releaseEpoch, generation: 0, retained: [] }
  if (previous.version !== 1 || previous.attemptId !== attemptId || previous.releaseEpoch !== releaseEpoch || !Array.isArray(previous.retained)) process.exit(38)
  const byKey = new Map(previous.retained.map(item => [`${item.scope}|${item.retainedPath}`, item]))
  for (const item of journal.retainedInventory || []) byKey.set(`${item.scope}|${item.retainedPath}`, item)
  previous.retained = [...byKey.values()].sort((a, b) => `${a.scope}|${a.retainedPath}`.localeCompare(`${b.scope}|${b.retainedPath}`))
  previous.generation = names.length + 1
  const target = path.join(vaultRoot, `inventory-${String(previous.generation).padStart(12, "0")}.json`)
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(previous)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fsyncParent(target)
  const finalNames = vaultManifestNames()
  if (finalNames.length !== previous.generation || finalNames[finalNames.length - 1] !== path.basename(target)) process.exit(38)
}
if (activeJournalPath === vaultJournal && journal.cleanupTerminal === "retained") {
  const names = vaultManifestNames()
  const inventory = names.length ? readPrivateJson(path.join(vaultRoot, names[names.length - 1])) : { retained: [] }
  let self = inventory.retained?.find(item => item.scope === "publication-authoritative-journal" && item.retainedPath === vaultJournal)
  if (!self) { self = recordRetained("publication-authoritative-journal", journalPath, vaultJournal); writeVaultManifest() }
  if (self.attemptId !== attemptId || self.releaseEpoch !== releaseEpoch || fingerprint(vaultJournal) !== self.retainedFingerprint) process.exit(38)
  process.exit(journal.recoveryRequired ? 43 : 0)
}
journal.retention ||= {
  quarantines: quarantineDirs.map(target => ({ path: target, state: "pending" })),
  claims: expectedPaths.map((original, index) => ({ original, claim: claimPaths[index], retained: terminalPaths[index], state: byPath.get(original).type === "absent" ? "absent" : "pending" }))
}
if (!Array.isArray(journal.retention.claims) || journal.retention.claims.length !== expectedPaths.length ||
    !Array.isArray(journal.retention.quarantines) || journal.retention.quarantines.length !== quarantineDirs.length) process.exit(38)
for (let index = 0; index < quarantineDirs.length; index += 1) {
  const item = journal.retention.quarantines[index]
  if (canonicalParentPath(item.path) !== canonicalParentPath(quarantineDirs[index]) || !["pending", "present", "retained"].includes(item.state)) process.exit(38)
  let stat = statSafe(item.path)
  if (!stat) {
    crash(`publication-restore-before-quarantine-create-${index + 1}`)
    fs.mkdirSync(item.path, { mode: 0o700 }); fsyncParent(item.path)
    crash(`publication-restore-after-quarantine-create-${index + 1}`)
    stat = fs.lstatSync(item.path)
  }
  if (item.state === "pending") {
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.geteuid()) process.exit(44)
    Object.assign(item, { state: "present", dev: String(stat.dev), ino: String(stat.ino) }); writeJournal()
  }
  if (!["present", "retained"].includes(item.state) || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.geteuid() || String(stat.dev) !== item.dev || String(stat.ino) !== item.ino) process.exit(44)
}
for (let index = 0; index < expectedPaths.length; index += 1) {
  const item = journal.retention.claims[index]
  if (canonicalParentPath(item.original) !== canonicalParentPath(expectedPaths[index]) || canonicalParentPath(item.claim) !== canonicalParentPath(claimPaths[index]) || canonicalParentPath(item.retained) !== canonicalParentPath(terminalPaths[index]) || !["absent", "pending", "claiming", "claimed", "retaining", "retained", "unknown_retained"].includes(item.state)) process.exit(38)
}
for (let index = 0; index < expectedPaths.length; index += 1) {
  const item = journal.retention.claims[index]
  const expected = byPath.get(item.original)
  if (sameInode(item.claim, item.retained)) moveFileNoReplace(item.claim, item.retained, 38, "disabled")
  const restoredOriginal = pathExists(item.original) && (pathExists(item.claim) || pathExists(item.retained)) &&
    hash(fs.readFileSync(item.original)) === expected.hash && !sameInode(item.original, item.claim) && !sameInode(item.original, item.retained)
  const locations = [item.original, item.claim, item.retained].filter(target => pathExists(target) && !(restoredOriginal && target === item.original))
  if (item.state === "absent") {
    if (locations.length === 0) continue
    if (locations.length !== 1 || pathExists(item.retained)) process.exit(38)
    const source = locations[0]
    if (source !== item.retained) { fs.renameSync(source, item.retained); fsyncParent(source); fsyncParent(item.retained) }
    const retained = recordRetained("publication-artifact", item.original, item.retained, null, "unknown")
    Object.assign(item, { state: "unknown_retained", retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint })
    journal.recoveryRequired = true; writeJournal(); writeVaultManifest(); process.exit(43)
  }
  if (item.state === "unknown_retained") { if (!pathExists(item.retained)) process.exit(38); process.exit(43) }
  if (item.state === "retained") {
    const record = journal.retainedInventory?.find(entry => entry.scope === "publication-artifact" && entry.retainedPath === item.retained)
    if (locations.length !== 1 || locations[0] !== item.retained || !record || fingerprint(item.retained) !== record.retainedFingerprint) process.exit(38)
    continue
  }
  if (["pending", "claiming"].includes(item.state)) {
    if (pathExists(item.claim) && !pathExists(item.original)) item.state = "claimed"
    else {
      if (!pathExists(item.original) || pathExists(item.claim) || pathExists(item.retained)) process.exit(38)
      const held = validateFd(item.original, expected, `lstat-open-${index + 1}`); fs.closeSync(held.fd)
      item.state = "claiming"; writeJournal()
      hook(`open-claim-${index + 1}`, item.original)
      fs.renameSync(item.original, item.claim); fsyncParent(item.original); fsyncParent(item.claim)
      item.state = "claimed"; writeJournal(); crash(`publication-after-claim-${index + 1}`)
    }
  }
  if (["claimed", "retaining"].includes(item.state)) {
    if (item.state === "claimed") {
      if (!pathExists(item.claim) || (!restoredOriginal && pathExists(item.original)) || pathExists(item.retained)) process.exit(38)
      hook(`claim-unlink-${index + 1}`, item.claim)
      item.state = "retaining"; writeJournal(); crash(`publication-before-terminal-${index + 1}`)
      hook(`claim-terminal-${index + 1}`, item.claim)
      moveFileNoReplace(item.claim, item.retained, 43, `claim-retained-${index + 1}`)
      crash(`publication-after-terminal-rename-${index + 1}`)
    } else if (!pathExists(item.retained) && pathExists(item.claim)) {
      moveFileNoReplace(item.claim, item.retained, 43, `claim-retained-${index + 1}`)
    }
    if (!pathExists(item.retained) || (!restoredOriginal && pathExists(item.original)) || pathExists(item.claim)) process.exit(38)
    const terminalRaceSpec = process.env.BILI_SETUP_TEST_PUBLICATION_TERMINAL_DELETE_RACE || ""
    const [terminalRaceIndex, terminalRaceKind] = terminalRaceSpec.split(":")
    if (terminalRaceIndex === String(index + 1) && terminalRaceKind) {
      if (terminalRaceKind === "same-inode-write") fs.appendFileSync(item.retained, "unknown-same-inode\n")
      else {
        const saved = path.join(path.dirname(item.retained), `.race-original.${path.basename(item.retained)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}`)
        fs.renameSync(item.retained, saved); fsyncParent(saved)
        fs.writeFileSync(item.retained, "unknown-race\n", { mode: 0o600, flag: "wx" }); fsyncParent(item.retained)
      }
    }
    let disposition = "expected"
    try { const held = validateFd(item.retained, expected); fs.closeSync(held.fd) } catch { disposition = "unknown" }
    const retained = recordRetained("publication-artifact", item.original, item.retained, expected, disposition)
    Object.assign(item, { state: disposition === "expected" ? "retained" : "unknown_retained",
      retainedDev: retained.dev, retainedIno: retained.ino, retainedFingerprint: retained.retainedFingerprint, disposition })
    writeJournal(); writeVaultManifest(); crash(`publication-after-terminal-journal-${index + 1}`)
    crash(`publication-before-unlink-${index + 1}`); crash(`publication-after-unlink-${index + 1}`)
    if (disposition !== "expected") {
      journal.recoveryRequired = true
      const root = journal.retention.quarantines[index < 2 ? 0 : 1]
      const rootRecord = recordRetained("publication-vault-root", root.path, root.path, null, "unknown")
      Object.assign(root, { state: "retained", retainedFingerprint: rootRecord.retainedFingerprint })
      writeJournal(); writeVaultManifest(); process.exit(43)
    }
  }
}
for (const quarantine of journal.retention.quarantines) {
  const stat = validatePrivate(quarantine.path, "dir")
  if (String(stat.dev) !== quarantine.dev || String(stat.ino) !== quarantine.ino) process.exit(44)
  const retained = recordRetained("publication-vault-root", quarantine.path, quarantine.path)
  Object.assign(quarantine, { state: "retained", retainedFingerprint: retained.retainedFingerprint })
}
writeJournal(); writeVaultManifest()
if (journal.restore?.complete === true) {
  const intentPath = path.join(path.dirname(journalPath), "publication-intent.json")
  const identities = journal.restore.workspaceIdentities
  const external = path.join(identities.data.path, "publication-journal.json")
  const externalProof = journal.restore.externalJournalIdentity
  if (!identities?.install || !identities?.data || !externalProof || externalProof.path !== external) process.exit(46)
  for (const [name, identity] of [["install", identities.install], ["data", identities.data]]) {
    const stat = validatePrivate(identity.path, "dir")
    if (String(stat.dev) !== identity.dev || String(stat.ino) !== identity.ino) process.exit(46)
    recordRetained(`publication-${name}-workspace`, identity.path, identity.path)
  }
  if (externalReplacement) {
    if (["inode", "open-unlink"].includes(externalReplacement)) replacePath(external)
    else if (externalReplacement === "0644") fs.chmodSync(external, 0o644)
    else if (externalReplacement === "hardlink") fs.linkSync(external, `${external}.second-link`)
    else if (externalReplacement === "symlink") {
      const saved = `${external}.race-original.${process.pid}`; fs.renameSync(external, saved); fs.symlinkSync(journalPath, external); fsyncParent(external)
    }
  }
  let externalDisposition = "expected"
  try {
    const stat = validatePrivate(external, "file")
    if (String(stat.dev) !== externalProof.dev || String(stat.ino) !== externalProof.ino || hash(fs.readFileSync(external)) !== externalProof.hash) externalDisposition = "unknown"
  } catch { externalDisposition = "unknown" }
  if (externalDisposition === "expected") recordRetained("publication-external-journal", external, external, { hash: externalProof.hash })
  else {
    const externalStat = statSafe(external)
    if (externalStat && externalStat.isFile() && !externalStat.isSymbolicLink()) {
      const retainedExternal = path.join(publicationVault, "external-journal-unknown")
      if (statSafe(retainedExternal)) process.exit(46)
      fs.renameSync(external, retainedExternal); fsyncParent(external); fsyncParent(retainedExternal)
      recordRetained("publication-external-journal", external, retainedExternal, { hash: externalProof.hash }, "unknown")
    } else {
      journal.retainedInventory ||= []
      journal.retainedInventory.push({ scope: "publication-external-journal", attemptId, releaseEpoch, originalPath: external,
        retainedPath: external, type: "unknown", dev: null, ino: null, sourceFingerprint: externalProof.hash,
        retainedFingerprint: null, disposition: "unknown" })
    }
    recordRetained("publication-data-workspace", identities.data.path, identities.data.path, null, "unknown")
    journal.recoveryRequired = true; writeJournal(); writeVaultManifest(); process.exit(46)
  }
  journal.workspaceCleanup = { external: "retained", install: "retained", data: "retained" }
  writeJournal(); writeVaultManifest(); crash("publication-workspace-cleanup-after-journal-unlink-before-state")
  crash("publication-workspace-cleanup-after-journal-unlink"); crash("publication-workspace-cleanup-after-install-rmdir")
  journal.cleanupTerminal ||= "retaining_intent"
  writeJournal()
  crash("publication-terminal-before-intent-unlink")
  if (journal.cleanupTerminal === "retaining_intent") {
    if (statSafe(intentPath)) {
      validatePrivate(intentPath, "file")
      const value = JSON.parse(fs.readFileSync(intentPath, "utf8"))
      if (JSON.stringify(value) !== JSON.stringify({ version: 1, attemptId, kind: "compose-ownership-publication" })) process.exit(45)
      moveFileNoReplace(intentPath, vaultIntent, 45, "intent-vault")
      crash("publication-terminal-after-intent-unlink")
    }
    if (!statSafe(vaultIntent)) process.exit(45)
    recordRetained("publication-intent", intentPath, vaultIntent)
    journal.cleanupTerminal = "intent_retained"; writeJournal(); writeVaultManifest()
    crash("publication-terminal-after-intent-removed-journal")
  }
  if (journal.cleanupTerminal !== "intent_retained" || statSafe(intentPath) || !statSafe(vaultIntent)) process.exit(45)
  crash("publication-terminal-before-journal-unlink")
  journal.cleanupTerminal = "retained"; writeJournal(); writeVaultManifest()
  if (activeJournalPath !== vaultJournal) {
    if (statSafe(vaultJournal)) process.exit(45)
    moveFileNoReplace(activeJournalPath, vaultJournal, 45, "journal-vault")
    activeJournalPath = vaultJournal
  }
  const journalRecord = recordRetained("publication-authoritative-journal", journalPath, vaultJournal)
  writeVaultManifest()
  if (fingerprint(vaultJournal) !== journalRecord.retainedFingerprint) process.exit(45)
} else {
  journal.cleanupComplete = true; writeJournal(); writeVaultManifest()
}
' /staging/publication-journal.json "$ATTEMPT_ID" "$RELEASE_EPOCH" "$TEST_FAILPOINT" "${BILI_SETUP_TEST_PUBLICATION_CLEANUP_RACE:-}" "${BILI_SETUP_TEST_EXTERNAL_JOURNAL_REPLACEMENT:-}" \
        "/install/.docker-compose.yml.candidate.$ATTEMPT_ID" \
        "/install/.docker-compose.yml.claimed.$ATTEMPT_ID" \
        "/current/data/setup-state/.compose-ownership.candidate.$ATTEMPT_ID" \
        "/current/data/setup-state/.compose-ownership.claimed.$ATTEMPT_ID" || {
        local status=$?
        [ "$TEST_MODE" != "1" ] || log "publication claim cleanup failed (status=$status)"
        return "$status"
    }
}

write_publication_journal() {
    sandbox_cli node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [journalPath, attemptId, ...targets] = process.argv.slice(1)
if (!Number.isInteger(fs.constants.O_NOFOLLOW)) process.exit(39)
const hash = value => crypto.createHash("sha256").update(value).digest("hex")
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const privateTemp = target => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`)
const readPrivateJournal = target => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.geteuid() ||
      before.nlink !== 1 || (before.mode & 0o777) !== 0o600) process.exit(41)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid ||
        opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600) process.exit(41)
    return JSON.parse(fs.readFileSync(fd, "utf8"))
  } finally { fs.closeSync(fd) }
}
const readTargetProof = target => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink()) process.exit(40)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(40)
    return { path: target, type: "file", dev: String(opened.dev), ino: String(opened.ino), hash: hash(fs.readFileSync(fd)) }
  } finally { fs.closeSync(fd) }
}
for (const deterministicTemp of [`${journalPath}.tmp`, `${journalPath}.claim-next`]) {
  if (statSafe(deterministicTemp)) process.exit(41)
}
const entries = targets.map(target => {
  try {
    return readTargetProof(target)
  } catch (error) {
    if (error.code === "ENOENT") return { path: target, type: "absent", dev: null, ino: null, hash: null }
    throw error
  }
})
let previous = null
if (statSafe(journalPath)) previous = readPrivateJournal(journalPath)
if (previous?.publicationClaims) {
  for (const claim of Object.values(previous.publicationClaims)) {
    if (claim.state !== "pending") continue
    let sourceStat = null, claimStat = null
    try { sourceStat = fs.lstatSync(claim.source) } catch (error) { if (error.code !== "ENOENT") throw error }
    try { claimStat = fs.lstatSync(claim.claim) } catch (error) { if (error.code !== "ENOENT") throw error }
    const claimedProof = claimStat ? readTargetProof(claim.claim) : null
    if (!sourceStat && claimedProof && claimedProof.dev === claim.dev && claimedProof.ino === claim.ino && claimedProof.hash === claim.hash) {
      claim.state = "claimed"
    } else if (!sourceStat || claimStat) process.exit(42)
  }
  for (const claim of Object.values(previous.publicationClaims)) {
    if (!["pending", "claimed"].includes(claim.state)) continue
    const entry = entries.find(value => value.path === claim.claim)
    if (!entry) process.exit(42)
    Object.assign(entry, { type: "file", dev: claim.dev, ino: claim.ino, hash: claim.hash })
  }
}
const temp = privateTemp(journalPath)
const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
try { fs.writeFileSync(fd, `${JSON.stringify({ ...(previous || {}), version: 1, attemptId, entries })}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
fs.renameSync(temp, journalPath)
const parent = fs.openSync(path.dirname(journalPath), fs.constants.O_RDONLY)
try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }
' /staging/publication-journal.json "$ATTEMPT_ID" \
        "/install/.docker-compose.yml.candidate.$ATTEMPT_ID" \
        "/install/.docker-compose.yml.claimed.$ATTEMPT_ID" \
        "/current/data/setup-state/.compose-ownership.candidate.$ATTEMPT_ID" \
        "/current/data/setup-state/.compose-ownership.claimed.$ATTEMPT_ID"
}

write_publication_claim_state() {
    local source=$1 claim=$2 state=$3
    sandbox_cli node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [journalPath, source, claim, state] = process.argv.slice(1)
if (!Number.isInteger(fs.constants.O_NOFOLLOW)) process.exit(3)
const hash = value => crypto.createHash("sha256").update(value).digest("hex")
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const privateTemp = target => path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`)
const readPrivateJournal = target => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.geteuid() ||
      before.nlink !== 1 || (before.mode & 0o777) !== 0o600) process.exit(3)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid ||
        opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600) process.exit(3)
    return JSON.parse(fs.readFileSync(fd, "utf8"))
  } finally { fs.closeSync(fd) }
}
const readProof = target => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink()) process.exit(1)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) process.exit(1)
    return { dev: String(opened.dev), ino: String(opened.ino), hash: hash(fs.readFileSync(fd)) }
  } finally { fs.closeSync(fd) }
}
for (const deterministicTemp of [`${journalPath}.tmp`, `${journalPath}.claim-next`]) {
  if (statSafe(deterministicTemp)) process.exit(3)
}
const journal = readPrivateJournal(journalPath)
const sourceProof = readProof(state === "pending" ? source : claim)
const proof = { source, claim, state, ...sourceProof }
journal.publicationClaims ||= {}
const key = path.basename(claim)
if (state === "claimed") {
  const previous = journal.publicationClaims[key]
  if (!previous || previous.state !== "pending" || previous.dev !== proof.dev || previous.ino !== proof.ino || previous.hash !== proof.hash) process.exit(2)
}
journal.publicationClaims[key] = proof
const temp = privateTemp(journalPath)
const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
try { fs.writeFileSync(fd, `${JSON.stringify(journal)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
fs.renameSync(temp, journalPath)
const parent = fs.openSync(path.dirname(journalPath), fs.constants.O_RDONLY)
try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }
' /staging/publication-journal.json "$source" "$claim" "$state"
}

verify_rollback_snapshot_restored() {
    local actual
    if [ -f "$ATTEMPT_DIR/rollback-config-inventory.tsv" ]; then
        [ -d "$CONFIG_DIR" ] || return 1
        actual=$(mktemp "${TMPDIR:-/tmp}/bili-rollback-config.XXXXXX")
        generate_tree_inventory "$CONFIG_DIR" config "$actual"
        cmp -s "$ATTEMPT_DIR/rollback-config-inventory.tsv" "$actual" || { rm -f -- "$actual"; return 1; }
        rm -f -- "$actual"
    fi
    if [ -f "$ATTEMPT_DIR/rollback-data-inventory.tsv" ]; then
        [ -d "$DATA_DIR" ] || return 1
        actual=$(mktemp "${TMPDIR:-/tmp}/bili-rollback-data.XXXXXX")
        generate_tree_inventory "$DATA_DIR" data "$actual"
        cmp -s "$ATTEMPT_DIR/rollback-data-inventory.tsv" "$actual" || { rm -f -- "$actual"; return 1; }
        rm -f -- "$actual"
    fi
    if [ -f "$ATTEMPT_DIR/rollback-compose-inventory" ]; then
        [ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || return 1
        local expected actual_line
        expected=$(cat "$ATTEMPT_DIR/rollback-compose-inventory")
        actual_line="$(hash_file "$COMPOSE_FILE")|$(stat_metadata "$COMPOSE_FILE")"
        [ "$actual_line" = "$expected" ] || return 1
    fi
    if [ -d "$ATTEMPT_DIR/snapshot/setup-control" ] || [ -f "$ATTEMPT_DIR/setup-control-inventory.tsv" ]; then
        verify_setup_control_state
    fi
}

verify_writer_states() {
    local recorded_id role was_running was_paused _name id state running paused name image
    while IFS='|' read -r recorded_id role was_running was_paused _name; do
        [ -n "$recorded_id" ] || continue
        id=$(current_writer_container "$recorded_id" "$role")
        [ -n "$id" ] || return 1
        state=$(container_state_line "$id") || return 1
        IFS='|' read -r running paused name <<EOF
$state
EOF
        [ "$running" = "$was_running" ] && [ "$paused" = "$was_paused" ] || return 1
        case "$role" in
            bot) image=$(docker_cmd inspect --format '{{.Image}}' "$id") || return 1; [ "$image" = "$OLD_IMAGE_ID" ] || return 1 ;;
            napcat) if [ -n "$OLD_NAPCAT_IMAGE_ID" ]; then image=$(docker_cmd inspect --format '{{.Image}}' "$id") || return 1; [ "$image" = "$OLD_NAPCAT_IMAGE_ID" ] || return 1; fi ;;
        esac
    done < "$WRITER_SET_FILE"
}

restore_writer_states() {
    [ "$TEST_FAILPOINT" != "rollback-writer-restore" ] || return 1
    local recorded_id role was_running was_paused _name id
    while IFS='|' read -r recorded_id role was_running was_paused _name; do
        [ -n "$recorded_id" ] || continue
        id=$(current_writer_container "$recorded_id" "$role")
        [ -n "$id" ] || return 1
        if [ "$was_running" = "true" ]; then
            docker_cmd start "$id" >/dev/null 2>&1 || return 1
            if [ "$was_paused" = "true" ]; then
                docker_cmd pause "$id" >/dev/null 2>&1 || return 1
            else
                docker_cmd unpause "$id" >/dev/null 2>&1 || return 1
            fi
        else
            docker_cmd stop "$id" >/dev/null 2>&1 || return 1
        fi
    done < "$WRITER_SET_FILE"
}

write_rollback_override() {
    local file="$ATTEMPT_DIR/rollback-compose.yml"
    cat > "$file" <<EOF
services:
  bili-qq-bot:
    image: "$ROLLBACK_TAG"
    pull_policy: never
EOF
    if [ -n "$NAPCAT_ROLLBACK_TAG" ]; then
        cat >> "$file" <<EOF
  napcat:
    image: "$NAPCAT_ROLLBACK_TAG"
    pull_policy: never
EOF
    fi
    chmod 600 "$file"
    file_sync "$file"
    printf '%s\n' "$file"
}

rollback_pre_marker() {
    [ "$ROLLBACK_RUNNING" -eq 0 ] || return 0
    ROLLBACK_RUNNING=1
    local rollback_from=$CURRENT_CHECKPOINT
    log "rolling back checkpoint $rollback_from"
    if [ -n "$ATTEMPT_DIR" ] && [ -d "$ATTEMPT_DIR" ]; then
        if ! checkpoint "rollback_started"; then
            log "rollback checkpoint could not be persisted; active attempt retained for recovery"
            return 1
        fi
    fi
    local intent_only=0
    [ "$rollback_from" != "cutover_intent" ] || intent_only=1
    local rollback_failed=0
    local rollback_errors=""
    local snapshot_restore_complete=0
    if [ "$intent_only" -eq 0 ]; then
        local rollback_down_compose="$COMPOSE_FILE"
        [ -z "$CONCURRENT_COMPOSE_FILE" ] || rollback_down_compose="$SNAPSHOT_DIR/docker-compose.yml"
        if ! compose_cmd -f "$rollback_down_compose" down --remove-orphans >/dev/null 2>&1; then
            rollback_failed=1
            rollback_errors="${rollback_errors} compose-down"
        fi
        if ! (restore_snapshot); then
            rollback_failed=1
            rollback_errors="${rollback_errors} snapshot-restore"
        else
            snapshot_restore_complete=1
        fi
    fi
    if [ "$intent_only" -eq 1 ]; then
        rollback_failed=0
    elif [ -n "$ROLLBACK_TAG" ]; then
        local current_tag_id
        current_tag_id=$(image_id "$ROLLBACK_TAG" 2>/dev/null || true)
        if [ "$current_tag_id" != "$OLD_IMAGE_ID" ]; then rollback_failed=1; rollback_errors="${rollback_errors} bot-image-pin"; fi
        if [ -n "$NAPCAT_ROLLBACK_TAG" ]; then
            local current_napcat_tag_id
            current_napcat_tag_id=$(image_id "$NAPCAT_ROLLBACK_TAG" 2>/dev/null || true)
            if [ "$current_napcat_tag_id" != "$OLD_NAPCAT_IMAGE_ID" ]; then rollback_failed=1; rollback_errors="${rollback_errors} napcat-image-pin"; fi
        fi
        if [ "$rollback_failed" -eq 0 ] && [ -f "$COMPOSE_FILE" ]; then
            local override
            override=$(write_rollback_override)
            if ! compose_cmd -f "$COMPOSE_FILE" -f "$override" up -d --pull never >/dev/null 2>&1; then rollback_failed=1; rollback_errors="${rollback_errors} compose-up"; fi
        fi
    elif [ "$MODE" != "install" ]; then
        rollback_failed=1
        rollback_errors="${rollback_errors} rollback-image-missing"
    fi
    if [ "$RUNTIME_MUTATION_STARTED" -eq 1 ] || [ "$intent_only" -eq 0 ]; then
        if ! restore_recorded_networks; then
            rollback_failed=1
            rollback_errors="${rollback_errors} network-restore"
        fi
        if ! restore_writer_states; then
            rollback_failed=1
            rollback_errors="${rollback_errors} writer-restore"
        fi
        if ! verify_writer_states; then
            rollback_failed=1
            rollback_errors="${rollback_errors} writer-verify"
        fi
    fi
    if [ -n "$CONCURRENT_COMPOSE_FILE" ] && [ -f "$CONCURRENT_COMPOSE_FILE" ]; then
        if ! atomic_copy_file "$CONCURRENT_COMPOSE_FILE" "$COMPOSE_FILE" 600; then
            rollback_failed=1
            rollback_errors="${rollback_errors} concurrent-compose-restore"
        elif [ "$(dirname -- "$CONCURRENT_COMPOSE_FILE")" = "$INSTALL_DIR" ]; then
            # A publication-time pathname claim lives beside Compose so rename
            # is atomic. Remove it only after its concurrent bytes are restored.
            safe_remove_file "$CONCURRENT_COMPOSE_FILE" || {
                rollback_failed=1
                rollback_errors="${rollback_errors} concurrent-compose-cleanup"
            }
        fi
    fi
    if [ -n "$CONCURRENT_OWNERSHIP_FILE" ] && [ -f "$CONCURRENT_OWNERSHIP_FILE" ]; then
        if ! atomic_copy_file "$CONCURRENT_OWNERSHIP_FILE" "$STATE_ROOT/compose-ownership.json" 600; then
            rollback_failed=1
            rollback_errors="${rollback_errors} concurrent-ownership-restore"
        fi
    fi
    if [ "$intent_only" -eq 1 ] || [ "$snapshot_restore_complete" -eq 1 ]; then
        if ! cleanup_publication_claims; then
            RECOVERY_REQUIRED_ONLY=1
            rollback_failed=1
            rollback_errors="${rollback_errors} publication-claim-cleanup"
        fi
    fi
    if [ "$intent_only" -eq 0 ] && [ "$snapshot_restore_complete" -eq 1 ] && ! (verify_rollback_snapshot_restored); then
        rollback_failed=1
        rollback_errors="${rollback_errors} snapshot-verify"
    fi
    if [ "$rollback_failed" -eq 1 ]; then
        checkpoint "failed" || true
        log "rollback recovery-required (${rollback_errors# }); active attempt retained for recovery"
        return 1
    fi
    if [ -n "$ATTEMPT_DIR" ] && [ -d "$ATTEMPT_DIR" ]; then
        if ! checkpoint "rolled_back"; then
            log "rollback completion checkpoint could not be persisted; active attempt retained for recovery"
            return 1
        fi
    fi
    safe_remove_file "$ACTIVE_ATTEMPT_FILE" || true
    return 0
}

write_recovery_status() {
    local file="$ATTEMPT_DIR/RECOVER_SAME_RELEASE_EPOCH"
    printf '%s\n' "$RELEASE_EPOCH" > "$file"
    chmod 600 "$file"
    file_sync "$file"
}

read_private_manifest_checkpoint() {
    [ -n "${MANIFEST_FILE:-}" ] || return 1
    [ -e "$MANIFEST_FILE" ] || [ -L "$MANIFEST_FILE" ] || return 1
    data_cli status --manifest /staging/upgrade-manifest.json --field checkpoint
}

on_error() {
    local status=$1
    trap - ERR INT TERM
    ERROR_HANDLER_READY=0
    if [ "$DRY_RUN" -eq 0 ]; then
        local manifest_checkpoint="" manifest_invalid=0
        if [ -n "${MANIFEST_FILE:-}" ] && { [ -e "$MANIFEST_FILE" ] || [ -L "$MANIFEST_FILE" ]; }; then
            manifest_checkpoint=$(read_private_manifest_checkpoint 2>/dev/null) || manifest_invalid=1
            if [ "$manifest_invalid" -eq 1 ]; then
                log "migration manifest is invalid or unsafe; recovery-required active attempt retained"
                RUNTIME_ENV_CONTENT=""
                exit "$status"
            fi
            case "$manifest_checkpoint" in
                runtime_released|runtime_ready|upgrade_complete) MARKER_COMMITTED=1 ;;
                cutover_intent|legacy_fenced|forced_recovery_ready|runtime_stopped|snapshot_ready|candidate_written|data_applied|probe_started|probe_ready|release_prepared|runtime_release_armed|rollback_started|failed)
                    CUTOVER_INTENT_WRITTEN=1
                    CURRENT_CHECKPOINT=$manifest_checkpoint
                    ;;
            esac
        fi
        if [ "$RECOVERY_REQUIRED_ONLY" -eq 1 ] && [ "$CUTOVER_INTENT_WRITTEN" -eq 1 ]; then
            checkpoint "failed" || true
            log "publication recovery-required active attempt retained"
        elif [ "$MARKER_COMMITTED" -eq 1 ]; then
            log "committed release requires recovery in the same epoch: $RELEASE_EPOCH"
            write_recovery_status || true
        elif [ "$CUTOVER_INTENT_WRITTEN" -eq 1 ] && [ "$RECOVERY_REQUIRED_ONLY" -eq 0 ]; then
            rollback_pre_marker || true
        elif [ "$RECOVERY_REQUIRED_ONLY" -eq 0 ] && [ "$RESUMING_ATTEMPT" -eq 0 ]; then
            safe_remove_file "$ACTIVE_ATTEMPT_FILE" || true
            if [ -n "${ATTEMPT_STAGING_DIR:-}" ] && [ -d "$ATTEMPT_STAGING_DIR" ] && [ ! -L "$ATTEMPT_STAGING_DIR" ]; then
                rm -rf -- "$ATTEMPT_STAGING_DIR" || true
            fi
        fi
        safe_remove_file "$RUNTIME_ENV_FILE" || true
        RUNTIME_ENV_CONTENT=""
    fi
    exit "$status"
}

trap 'on_error "$?"' ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM
ERROR_HANDLER_READY=1

prepare_worktree() {
    rm -rf -- "$WORK_DIR"
    mkdir -p -- "$WORK_DIR/config" "$WORK_DIR/data"
    if [ -d "$SNAPSHOT_DIR/config" ]; then
        cp -a -- "$SNAPSHOT_DIR/config/." "$WORK_DIR/config/"
    fi
    if [ -d "$SNAPSHOT_DIR/data" ]; then
        cp -a -- "$SNAPSHOT_DIR/data/." "$WORK_DIR/data/"
    fi
}

generate_deployment_plan() {
    local args=(
        deployment-plan
        --config /staging/work/config/config.yaml
        --output /staging/deployment-plan.json
        --json
    )
    [ ! -f "$COMPOSE_FILE" ] || args+=(--existing-compose /install/docker-compose.yml)
    config_cli "${args[@]}" >/dev/null
}

extract_relocation_operations() {
    local raw="$ATTEMPT_DIR/relocation-operations.raw"
    sandbox_cli node -e '
const fs = require("fs")
const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const items = plan.mounts || plan.mountRelocations || plan.relocations || []
if (!Array.isArray(items)) process.exit(2)
const relocated = items.filter(item => item.oldSource !== null && item.oldSource !== item.newSource)
if (plan.requiresRelocation === true && relocated.length === 0) process.exit(3)
const groups = new Map()
for (const item of relocated) {
  const service = item.service || "bili-qq-bot"
  const key = item.key || item.logicalKey
  const sharedIdentity = item.sharedIdentity || key
  const containerTarget = item.containerTarget || item.target
  const oldSource = item.oldSource
  const newSource = item.newSource
  const preserveRequired = item.preserveRequired !== false
  const allowed = {
    config: ["bili-qq-bot"], data: ["bili-qq-bot"], logs: ["bili-qq-bot"], fonts: ["bili-qq-bot"],
    napcatConfig: ["napcat"], napcatQq: ["bili-qq-bot", "napcat"]
  }
  const values = [service, key, sharedIdentity, containerTarget, oldSource, newSource]
  if (values.some(value => typeof value !== "string" || !value || /[|\t\r\n]/.test(value))) process.exit(4)
  if (!allowed[key] || !allowed[key].includes(service)) process.exit(6)
  const current = groups.get(sharedIdentity)
  if (current && (current.key !== key || current.containerTarget !== containerTarget || current.oldSource !== oldSource || current.newSource !== newSource || current.preserveRequired !== preserveRequired)) process.exit(7)
  if (current) current.services.add(service)
  else groups.set(sharedIdentity, { services: new Set([service]), key, sharedIdentity, containerTarget, oldSource, newSource, preserveRequired })
}
if (Number.isSafeInteger(plan.requiredOperationCount) && groups.size !== plan.requiredOperationCount) process.exit(5)
for (const item of groups.values()) {
  process.stdout.write(`${[...item.services].sort().join(",")}|${item.key}|${item.sharedIdentity}|${item.containerTarget}|${item.oldSource}|${item.newSource}|${item.preserveRequired ? "true" : "false"}\n`)
}
' /staging/deployment-plan.json > "$raw"
    chmod 600 "$raw"

    : > "$RELOCATION_OPERATIONS_FILE"
    RELOCATED_CONFIG_DIR=$CONFIG_DIR
    RELOCATED_DATA_DIR=$DATA_DIR
    RELOCATED_LOGS_DIR=$LOGS_DIR
    RELOCATED_FONTS_DIR=$FONTS_DIR
    RELOCATED_NAPCAT_CONFIG_DIR=$NAPCAT_CONFIG_DIR
    RELOCATED_NAPCAT_QQ_DIR=$NAPCAT_QQ_DIR
    local services key shared_identity container_target old_source new_source preserve old_path expected_old new_path expected_target
    while IFS='|' read -r services key shared_identity container_target old_source new_source preserve; do
        [ -n "$key" ] || continue
        case "$key" in
            config) expected_target=/app/config ;;
            data) expected_target=/app/data ;;
            logs) expected_target=/app/logs ;;
            fonts) expected_target=/app/fonts/custom ;;
            napcatConfig) expected_target=/app/napcat/config ;;
            napcatQq) expected_target=/app/.config/QQ ;;
            *) die "deployment plan contains unsupported mount key: $key" ;;
        esac
        [ "$container_target" = "$expected_target" ] || die "deployment plan container target mismatch for $key"
        old_path=$(resolve_mount_source "$old_source")
        new_path=$(resolve_mount_source "$new_source")
        expected_old=$(canonical_path "$(current_mount_path "$key")")
        [ "$old_path" = "$expected_old" ] || die "deployment plan old source does not match active deployment for $key"
        [ "$new_path" != "$old_path" ] || die "deployment plan contains a no-op relocation for $key"
        if path_is_within "$new_path" "$old_path" || path_is_within "$old_path" "$new_path"; then
            die "relocation paths overlap for $key"
        fi
        [ "$preserve" = "true" ] || die "deployment plan attempted a non-preserving relocation for $key"
        set_relocated_mount_path "$key" "$new_path"
        printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
            "$services" "$key" "$shared_identity" "$container_target" "$old_source" "$new_source" "$old_path" "$new_path" "$preserve" >> "$RELOCATION_OPERATIONS_FILE"
    done < "$raw"
    rm -f -- "$raw"

    local _left_services left_key _left_identity _left_target _left_old_raw _left_new_raw _left_old left_new _left_preserve
    local _right_services right_key _right_identity _right_target _right_old_raw _right_new_raw _right_old right_new _right_preserve
    while IFS='|' read -r _left_services left_key _left_identity _left_target _left_old_raw _left_new_raw _left_old left_new _left_preserve; do
        [ -n "$left_key" ] || continue
        while IFS='|' read -r _right_services right_key _right_identity _right_target _right_old_raw _right_new_raw _right_old right_new _right_preserve; do
            [ -n "$right_key" ] || continue
            [ "$left_key" != "$right_key" ] || continue
            if path_is_within "$left_new" "$right_new" || path_is_within "$right_new" "$left_new"; then
                die "relocation targets overlap: $left_key and $right_key"
            fi
            if path_is_within "$left_new" "$_right_old" || path_is_within "$_right_old" "$left_new"; then
                die "relocation target $left_key overlaps active source $right_key"
            fi
        done < "$RELOCATION_OPERATIONS_FILE"
    done < "$RELOCATION_OPERATIONS_FILE"
    chmod 600 "$RELOCATION_OPERATIONS_FILE"
    file_sync "$RELOCATION_OPERATIONS_FILE"
    [ -s "$RELOCATION_OPERATIONS_FILE" ] && RELOCATION_ACTIVE=1 || RELOCATION_ACTIVE=0
}

assert_no_container_writer_for_target() {
    local target=$1
    local id source source_path
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        while IFS= read -r source; do
            [ -n "$source" ] || continue
            source_path=$(canonical_path "$source")
            if path_is_within "$source_path" "$target" || path_is_within "$target" "$source_path"; then
                die "relocation target is mounted by a container: $id"
            fi
        done < <(container_mount_sources "$id")
    done < <(docker_cmd ps -aq)
}

assert_no_host_writer_for_target() {
    local target=$1
    [ -d "$target" ] || return 0
    if [ "$TEST_MODE" = "1" ] && [ -z "${BILI_SETUP_LSOF_BIN:-}" ]; then
        return 0
    fi
    command -v "$LSOF_BIN" >/dev/null 2>&1 || die "host writer detection requires lsof"
    local known_pids output status=0 line current_pid="" current_command=""
    known_pids=$(known_writer_pid_set)
    output=$("$LSOF_BIN" -nP -Fpcfa +D "$target" 2>/dev/null) || status=$?
    [ "$status" -eq 0 ] || [ "$status" -eq 1 ] || die "host writer detection failed for relocation target"
    while IFS= read -r line; do
        case "$line" in
            p*) current_pid=${line#p} ;;
            c*) current_command=${line#c} ;;
            aw|au)
                case "$known_pids" in
                    *"|$current_pid|"*) ;;
                    *) die "unknown host writer has an open writable handle on relocation target: ${current_command:-unknown} (${current_pid:-unknown})" ;;
                esac
                ;;
        esac
    done <<EOF
$output
EOF
}

preflight_relocation_targets() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    local _services _key _identity _target _old_source _new_source _old_path new_path _preserve
    while IFS='|' read -r _services _key _identity _target _old_source _new_source _old_path new_path _preserve; do
        [ -n "$new_path" ] || continue
        assert_no_container_writer_for_target "$new_path"
        assert_no_host_writer_for_target "$new_path"
        if [ -e "$new_path" ]; then
            [ -d "$new_path" ] && [ ! -L "$new_path" ] || die "relocation target must be a non-symlink directory"
            if [ -n "$(find "$new_path" -mindepth 1 -maxdepth 1 -print -quit)" ] && [ "$ADOPT_EXISTING" -ne 1 ]; then
                die "relocation target is non-empty; explicit --adopt-existing is required"
            fi
        fi
    done < "$RELOCATION_OPERATIONS_FILE"
}

copy_attempt_state_into_data_target() {
    local target=$1
    mkdir -p -- "$target/setup-state"
    chmod 700 "$target/setup-state"
    rm -rf -- "$target/setup-state/$ATTEMPT_ID"
    cp -a -- "$ATTEMPT_DIR" "$target/setup-state/$ATTEMPT_ID"
    printf '%s\n' "$ATTEMPT_ID" > "$target/setup-state/active-attempt"
    chmod 600 "$target/setup-state/active-attempt"
    sync_tree "$target/setup-state"
}

prepare_single_relocation() {
    local services=$1
    local key=$2
    local shared_identity=$3
    local container_target=$4
    local old_source=$5
    local new_source=$6
    local old_path=$7
    local new_path=$8
    [ -d "$old_path" ] || die "relocation source is not a directory for $key"
    assert_no_container_writer_for_target "$new_path"
    local old_inventory="$ATTEMPT_DIR/inventory-$key-old.tsv"
    local new_inventory="$ATTEMPT_DIR/inventory-$key-new.tsv"
    generate_tree_inventory "$old_path" "$key" "$old_inventory"
    if [ "$key" = "config" ]; then
        [ -f "$old_path/config.yaml" ] && [ ! -L "$old_path/config.yaml" ] || die "relocated config source must contain an ordinary config.yaml"
        local config_identity
        config_identity=$(file_identity "$old_path/config.yaml")
        printf 'config.yaml|%s|%s\n' "$config_identity" "$(hash_file "$old_path/config.yaml")" > "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
        chmod 600 "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
        file_sync "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
    fi

    local mode temp parent
    if [ -e "$new_path" ] && [ -n "$(find "$new_path" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        [ "$ADOPT_EXISTING" -eq 1 ] || die "relocation target is non-empty; use --adopt-existing only after verifying identity"
        [ -d "$new_path" ] && [ ! -L "$new_path" ] || die "adopt target must be a non-symlink directory"
        generate_tree_inventory "$new_path" "$key" "$new_inventory"
        cmp -s "$old_inventory" "$new_inventory" || die "adopt target inventory does not match the active source for $key"
        mode=adopted
        if [ "$key" = "data" ]; then
            copy_attempt_state_into_data_target "$new_path"
        fi
        sync_tree "$new_path"
    else
        parent=$(dirname -- "$new_path")
        assert_safe_mount_path "$parent"
        mkdir -p -- "$parent"
        assert_no_symlink_components "$parent"
        temp="$parent/.bili-relocate-$ATTEMPT_ID-$key"
        [ ! -e "$temp" ] || die "relocation staging path already exists: $temp"
        mkdir -- "$temp"
        chmod 700 "$temp"
        if [ "$key" = "data" ]; then
            (
                cd -- "$old_path"
                tar --exclude='./setup-state' -cpf - .
            ) | (
                cd -- "$temp"
                tar -xpf -
            )
            copy_attempt_state_into_data_target "$temp"
        else
            cp -a -- "$old_path/." "$temp/"
        fi
        apply_root_metadata "$old_path" "$temp"
        generate_tree_inventory "$temp" "$key" "$new_inventory"
        cmp -s "$old_inventory" "$new_inventory" || die "relocation copy inventory mismatch for $key"
        sync_tree "$temp"
        test_failpoint "relocation-after-copy-fsync"
        if [ -d "$new_path" ]; then
            rmdir -- "$new_path" || die "relocation target became non-empty during copy"
        elif [ -e "$new_path" ]; then
            die "relocation target is not a directory"
        fi
        mv -- "$temp" "$new_path"
        file_sync "$parent"
        mode=copied
    fi
    local old_hash new_hash
    old_hash=$(hash_file "$old_inventory")
    new_hash=$(hash_file "$new_inventory")
    local operation=copy-and-switch
    [ "$mode" != "adopted" ] || operation="preserve-in-place"
    printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
        "$services" "$key" "$shared_identity" "$container_target" "$old_source" "$new_source" "$operation" "$old_hash" "$new_hash" "$mode" >> "$ATTEMPT_DIR/relocation-results.tsv"
}

write_relocation_artifact() {
    sandbox_cli node -e '
const fs = require("fs")
const [planPath, resultsPath, outputPath] = process.argv.slice(1)
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"))
const operations = fs.readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map(line => {
  const [services, key, sharedIdentity, containerTarget, oldSource, newSource, operation, beforeFingerprint, afterFingerprint] = line.split("|")
  return {
    key,
    sharedIdentity: sharedIdentity === key ? null : sharedIdentity,
    containerTarget,
    bindings: services.split(",").filter(Boolean).map(service => ({ service, containerTarget })),
    oldSource,
    newSource,
    operation,
    inventory: { beforeFingerprint, afterFingerprint, matched: beforeFingerprint === afterFingerprint }
  }
})
const artifact = {
  version: 1,
  planFingerprint: plan.planFingerprint,
  configFingerprint: plan.configFingerprint,
  existingComposeFingerprint: plan.existingComposeFingerprint,
  operations,
  validatedAt: new Date().toISOString()
}
fs.writeFileSync(outputPath, `${JSON.stringify(artifact)}\n`, { mode: 0o600 })
' /staging/deployment-plan.json /staging/relocation-results.tsv /staging/validated-relocation.json
    file_sync "$RELOCATION_ARTIFACT_FILE"
}

prepare_mount_relocations() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    : > "$ATTEMPT_DIR/relocation-results.tsv"
    chmod 600 "$ATTEMPT_DIR/relocation-results.tsv"
    local services key shared_identity container_target old_source new_source old_path new_path _preserve
    while IFS='|' read -r services key shared_identity container_target old_source new_source old_path new_path _preserve; do
        [ -n "$key" ] || continue
        prepare_single_relocation "$services" "$key" "$shared_identity" "$container_target" "$old_source" "$new_source" "$old_path" "$new_path"
    done < "$RELOCATION_OPERATIONS_FILE"
    file_sync "$ATTEMPT_DIR/relocation-results.tsv"
    write_relocation_artifact
}

verify_apply_plan_cas() {
    local fingerprints
    fingerprints=$(sandbox_cli node -e '
const fs = require("fs")
const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (!/^[a-f0-9]{64}$/.test(plan.configFingerprint)) process.exit(2)
if (plan.existingComposeFingerprint !== null && !/^[a-f0-9]{64}$/.test(plan.existingComposeFingerprint)) process.exit(3)
process.stdout.write(`${plan.configFingerprint}|${plan.existingComposeFingerprint || ""}`)
' /staging/deployment-plan.json)
    local expected_config expected_compose
    IFS='|' read -r expected_config expected_compose <<EOF
$fingerprints
EOF
    [ "$(hash_file "$CONFIG_DIR/config.yaml")" = "$expected_config" ] || die "config changed after deployment plan; refusing stale apply"
    if [ -n "$expected_compose" ]; then
        [ "$(hash_file "$COMPOSE_FILE")" = "$expected_compose" ] || die "Compose changed after deployment plan; refusing stale apply"
    fi
}

load_relocation_state() {
    [ -s "$RELOCATION_OPERATIONS_FILE" ] || return 0
    RELOCATION_ACTIVE=1
    RELOCATED_CONFIG_DIR=$CONFIG_DIR
    RELOCATED_DATA_DIR=$DATA_DIR
    RELOCATED_LOGS_DIR=$LOGS_DIR
    RELOCATED_FONTS_DIR=$FONTS_DIR
    RELOCATED_NAPCAT_CONFIG_DIR=$NAPCAT_CONFIG_DIR
    RELOCATED_NAPCAT_QQ_DIR=$NAPCAT_QQ_DIR
    local _services key _identity _target _old_source _new_source _old_path new_path _preserve
    while IFS='|' read -r _services key _identity _target _old_source _new_source _old_path new_path _preserve; do
        [ -n "$key" ] || continue
        set_relocated_mount_path "$key" "$new_path"
    done < "$RELOCATION_OPERATIONS_FILE"
}

archive_relocated_old_config() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    local _services key _identity _target _old_source _new_source old_path new_path _preserve
    while IFS='|' read -r _services key _identity _target _old_source _new_source old_path new_path _preserve; do
        [ "$key" = "config" ] || continue
        [ "$old_path" != "$new_path" ] || continue
        [ -f "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE" ] || die "relocated config archive proof is missing"
        test_mutate_archive_source "$old_path/config.yaml" "${BILI_SETUP_TEST_RELOCATED_ARCHIVE_MUTATION:-}"
        secure_archive_file "$old_path/config.yaml" "$ATTEMPT_DIR/retained-vault/archive/relocated/config.yaml" "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE" "config.yaml" "relocated-config"
        file_sync "$old_path"
        file_sync "$ATTEMPT_DIR/retained-vault/archive/relocated/config.yaml"
    done < "$RELOCATION_OPERATIONS_FILE"
}

write_deployment_state() {
    local temp="$DEPLOYMENT_STATE_FILE.tmp.$$.${RANDOM}"
    [ ! -L "$DEPLOYMENT_STATE_FILE" ] || die "deployment state target must not be a symlink"
    cat > "$temp" <<EOF
config|$RELOCATED_CONFIG_DIR
data|$RELOCATED_DATA_DIR
logs|$RELOCATED_LOGS_DIR
fonts|$RELOCATED_FONTS_DIR
napcatConfig|$RELOCATED_NAPCAT_CONFIG_DIR
napcatQq|$RELOCATED_NAPCAT_QQ_DIR
EOF
    chmod 600 "$temp"
    file_sync "$temp"
    mv -f -- "$temp" "$DEPLOYMENT_STATE_FILE"
    file_sync "$INSTALL_DIR"
}

sync_relocated_setup_state() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    [ -n "$RELOCATED_DATA_DIR" ] || return 0
    local target_state="$RELOCATED_DATA_DIR/setup-state"
    local target_attempt="$target_state/$ATTEMPT_ID"
    mkdir -p -- "$target_state"
    chmod 700 "$target_state"
    if [ "$(canonical_path "$ATTEMPT_DIR")" != "$(canonical_path "$target_attempt")" ]; then
        rm -rf -- "$target_attempt"
        cp -a -- "$ATTEMPT_DIR" "$target_attempt"
    fi
    if [ -f "$STATE_ROOT/compose-ownership.json" ]; then
        atomic_copy_file "$STATE_ROOT/compose-ownership.json" "$target_state/compose-ownership.json" 600
    fi
    printf '%s\n' "$RELEASE_EPOCH" > "$target_state/managed-v1"
    chmod 600 "$target_state/managed-v1"
    printf '%s\n' "$ATTEMPT_ID" > "$target_state/active-attempt"
    chmod 600 "$target_state/active-attempt"
    sync_tree "$target_state"
}

finalize_mount_relocations() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    archive_relocated_old_config
    sync_relocated_setup_state
    write_deployment_state
    test_failpoint "relocation-after-pointer-switch"
    safe_remove_file "$RELOCATED_DATA_DIR/setup-state/active-attempt"
    local _services key _identity _target _old_source _new_source old_path _new_path _preserve old_active old_value
    while IFS='|' read -r _services key _identity _target _old_source _new_source old_path _new_path _preserve; do
        [ "$key" = "data" ] || continue
        old_active="$old_path/setup-state/active-attempt"
        if [ -f "$old_active" ] && [ ! -L "$old_active" ]; then
            old_value=$(cat "$old_active" 2>/dev/null || true)
            [ "$old_value" != "$ATTEMPT_ID" ] || safe_remove_file "$old_active"
        fi
    done < "$RELOCATION_OPERATIONS_FILE"
}

verify_relocation_probe_inventory() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    local _services key _identity _target _old_source _new_source _old_path new_path preserve
    local _result_services result_key _result_identity _container _result_old _result_new _operation _before expected_after _mode
    local expected current_inventory current_hash
    while IFS='|' read -r _services key _identity _target _old_source _new_source _old_path new_path preserve; do
        [ "$preserve" = "true" ] || continue
        expected=""
        while IFS='|' read -r _result_services result_key _result_identity _container _result_old _result_new _operation _before expected_after _mode; do
            if [ "$result_key" = "$key" ]; then
                expected=$expected_after
                break
            fi
        done < "$ATTEMPT_DIR/relocation-results.tsv"
        [ -n "$expected" ] || die "missing relocation inventory result for $key"
        current_inventory="$ATTEMPT_DIR/inventory-$key-probe.tsv"
        generate_tree_inventory "$new_path" "$key" "$current_inventory"
        current_hash=$(hash_file "$current_inventory")
        [ "$current_hash" = "$expected" ] || die "probe changed preserved relocation inventory for $key"
    done < "$RELOCATION_OPERATIONS_FILE"
}

prepare_config_candidate() {
    local temporary_owner_runtime_dir=0
    if [ -z "$CONFIG_INPUT" ] && [ ! -d "$DATA_DIR/runtime" ]; then
        mkdir -p -- "$DATA_DIR/runtime"
        chmod 700 "$DATA_DIR/runtime"
        file_sync "$DATA_DIR"
        temporary_owner_runtime_dir=1
    fi
    if [ -n "$CONFIG_INPUT" ]; then
        [ -f "$CONFIG_INPUT" ] || die "config input not found: $CONFIG_INPUT"
        cp -- "$CONFIG_INPUT" "$WORK_DIR/config/config.yaml"
    elif [ "$MODE" = "install" ]; then
        if [ "$NON_INTERACTIVE" -eq 1 ]; then
            die "--config is required for non-interactive installation"
        fi
        local init_args=(
            init
            --provider "$PROVIDER"
            --output /staging/work/config/config.yaml
            --owner-lock /current/data/runtime/config-owner.lock
        )
        if [ "$PROVIDER" = "official" ]; then
            local app_id client_secret root_openids app_file secret_file roots_file
            printf 'QQ Official AppID: ' >&2
            IFS= read -r app_id
            printf 'QQ Official ClientSecret: ' >&2
            IFS= read -r -s client_secret
            printf '\nQQ Official Root OpenIDs (comma-separated, optional): ' >&2
            IFS= read -r root_openids
            [ -n "$app_id" ] || die "Official AppID is required"
            [ -n "$client_secret" ] || die "Official ClientSecret is required"
            app_file="$ATTEMPT_DIR/official-app-id.input"
            secret_file="$ATTEMPT_DIR/official-client-secret.input"
            roots_file="$ATTEMPT_DIR/official-root-openids.input"
            printf '%s' "$app_id" > "$app_file"
            printf '%s' "$client_secret" > "$secret_file"
            printf '%s' "$root_openids" > "$roots_file"
            chmod 600 "$app_file" "$secret_file" "$roots_file"
            OFFICIAL_INIT_INPUT="$ATTEMPT_DIR/official-init-input.json"
            sandbox_cli node -e '
const fs = require("fs")
const [appFile, secretFile, rootsFile, output] = process.argv.slice(1)
const appId = fs.readFileSync(appFile, "utf8").trim()
const clientSecret = fs.readFileSync(secretFile, "utf8")
const rootOpenids = fs.readFileSync(rootsFile, "utf8").split(/[,，\n]/).map(v => v.trim()).filter(Boolean)
if (!appId || !clientSecret) process.exit(2)
fs.writeFileSync(output, `${JSON.stringify({ provider: "official", officialAppId: appId, officialClientSecret: clientSecret, officialRootOpenids: rootOpenids })}\n`, { mode: 0o600 })
' /staging/official-app-id.input /staging/official-client-secret.input /staging/official-root-openids.input /staging/official-init-input.json
            safe_remove_file "$app_file"
            safe_remove_file "$secret_file"
            safe_remove_file "$roots_file"
            init_args+=(--input /staging/official-init-input.json)
        else
            local admin_qq ws_token admin_file token_file
            printf 'Root administrator QQ number: ' >&2
            IFS= read -r admin_qq
            printf 'NapCat WebSocket token: ' >&2
            IFS= read -r -s ws_token
            printf '\n' >&2
            case "$admin_qq" in
                ''|*[!0-9]*) die "Root administrator QQ must be a numeric QQ number" ;;
            esac
            [ -n "$ws_token" ] || die "NapCat WebSocket token is required"
            admin_file="$ATTEMPT_DIR/napcat-admin-qq.input"
            token_file="$ATTEMPT_DIR/napcat-ws-token.input"
            printf '%s' "$admin_qq" > "$admin_file"
            printf '%s' "$ws_token" > "$token_file"
            chmod 600 "$admin_file" "$token_file"
            NAPCAT_INIT_INPUT="$ATTEMPT_DIR/napcat-init-input.json"
            sandbox_cli node -e '
const fs = require("fs")
const [adminFile, tokenFile, output] = process.argv.slice(1)
const rootAdminQQ = fs.readFileSync(adminFile, "utf8").trim()
const wsToken = fs.readFileSync(tokenFile, "utf8")
if (!/^\d+$/.test(rootAdminQQ) || !wsToken) process.exit(2)
fs.writeFileSync(output, `${JSON.stringify({ provider: "napcat", wsUrl: "ws://napcat:3001", wsToken, rootAdminQQ })}\n`, { mode: 0o600 })
' /staging/napcat-admin-qq.input /staging/napcat-ws-token.input /staging/napcat-init-input.json
            safe_remove_file "$admin_file"
            safe_remove_file "$token_file"
            init_args+=(--input /staging/napcat-init-input.json)
        fi
        config_cli "${init_args[@]}"
        if [ -n "$OFFICIAL_INIT_INPUT" ]; then
            atomic_copy_file "$OFFICIAL_INIT_INPUT" "$ATTEMPT_DIR/bootstrap-input.json" 600
        fi
        if [ -n "$NAPCAT_INIT_INPUT" ]; then
            atomic_copy_file "$NAPCAT_INIT_INPUT" "$ATTEMPT_DIR/bootstrap-input.json" 600
        fi
        if [ -n "$OFFICIAL_INIT_INPUT" ]; then
            safe_remove_file "$OFFICIAL_INIT_INPUT"
            OFFICIAL_INIT_INPUT=""
        fi
        if [ -n "$NAPCAT_INIT_INPUT" ]; then
            safe_remove_file "$NAPCAT_INIT_INPUT"
            NAPCAT_INIT_INPUT=""
        fi
    else
        # Deployment rendering needs a schema-shaped preview before the target
        # process runs. This preview is never published as application config;
        # the target bootstrap owns legacy discovery and final YAML creation.
        config_cli init --provider "$PROVIDER" --output /staging/work/config/config.yaml --json >/dev/null
    fi
    if [ "$temporary_owner_runtime_dir" -eq 1 ]; then
        rmdir -- "$DATA_DIR/runtime"
        file_sync "$DATA_DIR"
    fi
    local validation_output
    validation_output=$(config_cli validate --config /staging/work/config/config.yaml --json)
    if [ -n "$validation_output" ]; then
        if [ "$MODE" = "install" ] && [ "$PROVIDER" != "auto" ]; then
            case "$validation_output" in
                *"\"provider\":\"$PROVIDER\""*) ;;
                *) die "config provider does not match the selected installation provider" ;;
            esac
        fi
        case "$validation_output" in
            *'"provider":"official"'*'"officialConfigured":true'*) ;;
            *'"provider":"official"'*) die "Official AppID and ClientSecret must both be configured" ;;
            *'"provider":"napcat"'*) ;;
            *) die "config validator returned an invalid provider summary" ;;
        esac
    elif [ "$TEST_MODE" != "1" ]; then
        die "config validator returned no provider summary"
    fi
}

render_compose_candidate() {
    local args=(
        render-compose
        --config /staging/work/config/config.yaml
        --output /staging/work/docker-compose.yml
        --ownership-output /staging/compose-owned.json
        --json
    )
    if [ -f "$SNAPSHOT_DIR/docker-compose.yml" ]; then
        args+=(--existing-compose /staging/snapshot/docker-compose.yml)
    elif [ ! -d "$SNAPSHOT_DIR" ] && [ -f "$COMPOSE_FILE" ]; then
        args+=(--existing-compose /install/docker-compose.yml)
    fi
    # Compose and its ownership proof are a single frozen render input. Reading
    # ownership from the live setup-state here would mix two generations.
    [ ! -f "$SNAPSHOT_DIR/setup-control/compose-ownership.json" ] || \
        args+=(--ownership /staging/snapshot/setup-control/compose-ownership.json)
    [ "$MODE" != "install" ] || args+=(--adopt-known-template)
    [ "$ADOPT_EXISTING" -ne 1 ] || args+=(--adopt-existing)
    [ "$RELOCATION_ACTIVE" -ne 1 ] || args+=(--validated-relocation-artifact /staging/validated-relocation.json)
    args+=(--bot-image "$TARGET_IMAGE_ID")
    [ -z "$TARGET_NAPCAT_IMAGE_ID" ] || args+=(--napcat-image "$TARGET_NAPCAT_IMAGE_ID")
    config_cli "${args[@]}" >/dev/null
    compose_cmd -f "$WORK_DIR/docker-compose.yml" config -q
    load_health_container_port "$WORK_DIR/docker-compose.yml"
    test_failpoint "upgrade-after-compose-render"
}

verify_compose_snapshot_cas() {
    local snapshot="$SNAPSHOT_DIR/docker-compose.yml"
    if [ -f "$snapshot" ]; then
        if [ -L "$COMPOSE_FILE" ] || [ ! -f "$COMPOSE_FILE" ] || [ "$(hash_file "$COMPOSE_FILE")" != "$(hash_file "$snapshot")" ]; then
            [ ! -L "$COMPOSE_FILE" ] && [ -f "$COMPOSE_FILE" ] || die "Compose changed after snapshot with an unsafe file type; refusing concurrent overwrite"
            CONCURRENT_COMPOSE_FILE="$ATTEMPT_DIR/concurrent-compose.yml"
            atomic_copy_file "$COMPOSE_FILE" "$CONCURRENT_COMPOSE_FILE" 600
            die "Compose changed after snapshot; refusing concurrent overwrite"
        fi
    else
        [ ! -e "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || die "Compose appeared after snapshot; refusing concurrent overwrite"
    fi
    local ownership_snapshot="$SNAPSHOT_DIR/setup-control/compose-ownership.json"
    local ownership_live="$STATE_ROOT/compose-ownership.json"
    if [ -f "$ownership_snapshot" ]; then
        if [ ! -f "$ownership_live" ] || [ -L "$ownership_live" ] || \
            [ "$(hash_file "$ownership_live")" != "$(hash_file "$ownership_snapshot")" ]; then
            if [ -f "$ownership_live" ] && [ ! -L "$ownership_live" ]; then
                CONCURRENT_OWNERSHIP_FILE="$ATTEMPT_DIR/concurrent-compose-ownership.json"
                atomic_copy_file "$ownership_live" "$CONCURRENT_OWNERSHIP_FILE" 600
            fi
            die "Compose ownership changed after snapshot; refusing concurrent overwrite"
        fi
    else
        if [ -e "$ownership_live" ] || [ -L "$ownership_live" ]; then
            if [ -f "$ownership_live" ] && [ ! -L "$ownership_live" ]; then
                CONCURRENT_OWNERSHIP_FILE="$ATTEMPT_DIR/concurrent-compose-ownership.json"
                atomic_copy_file "$ownership_live" "$CONCURRENT_OWNERSHIP_FILE" 600
            fi
            die "Compose ownership appeared after snapshot; refusing concurrent overwrite"
        fi
    fi
}

publish_compose_candidate() {
    local candidate="$INSTALL_DIR/.docker-compose.yml.candidate.$ATTEMPT_ID"
    local claimed="$INSTALL_DIR/.docker-compose.yml.claimed.$ATTEMPT_ID"
    local ownership_live="$STATE_ROOT/compose-ownership.json"
    local ownership_candidate="$STATE_ROOT/.compose-ownership.candidate.$ATTEMPT_ID"
    local ownership_claimed="$STATE_ROOT/.compose-ownership.claimed.$ATTEMPT_ID"
    local ownership_snapshot="$SNAPSHOT_DIR/setup-control/compose-ownership.json"
    [ -f "$OWNERSHIP_FILE" ] || die "rendered Compose ownership artifact is missing"
    write_publication_intent
    for path in "$candidate" "$claimed" "$ownership_candidate" "$ownership_claimed"; do
        [ ! -e "$path" ] && [ ! -L "$path" ] || die "Compose publication staging path already exists: $path"
    done

    cp -- "$WORK_DIR/docker-compose.yml" "$candidate"
    chmod 600 "$candidate"
    file_sync "$candidate"
    cp -- "$OWNERSHIP_FILE" "$ownership_candidate"
    chmod 600 "$ownership_candidate"
    file_sync "$ownership_candidate"
    if [ "$TEST_MODE" = "1" ] && [ "${BILI_SETUP_TEST_PUBLICATION_WRITER_CONFLICT:-}" = "journal-tmp" ]; then
        printf '%s\n' 'unknown publication journal temp' > "$ATTEMPT_DIR/publication-journal.json.tmp"
        chmod 600 "$ATTEMPT_DIR/publication-journal.json.tmp"
        file_sync "$ATTEMPT_DIR/publication-journal.json.tmp"
    fi
    write_publication_journal

    if [ -f "$SNAPSHOT_DIR/docker-compose.yml" ]; then
        # Claim the pathname first. This closes the verify->replace window: a
        # concurrent creator wins the now-empty pathname and is never clobbered.
        if [ "$TEST_MODE" = "1" ] && [ "${BILI_SETUP_TEST_PUBLICATION_WRITER_CONFLICT:-}" = "claim-next" ]; then
            printf '%s\n' 'unknown publication claim temp' > "$ATTEMPT_DIR/publication-journal.json.claim-next"
            chmod 600 "$ATTEMPT_DIR/publication-journal.json.claim-next"
            file_sync "$ATTEMPT_DIR/publication-journal.json.claim-next"
        fi
        write_publication_claim_state "$COMPOSE_FILE" "$claimed" pending
        test_crashpoint "publication-before-compose-claim"
        mv -- "$COMPOSE_FILE" "$claimed"
        file_sync "$INSTALL_DIR"
        test_crashpoint "publication-after-compose-claim-before-journal"
        write_publication_claim_state "$COMPOSE_FILE" "$claimed" claimed
        write_publication_journal
        if ! cmp -s "$SNAPSHOT_DIR/docker-compose.yml" "$claimed"; then
            CONCURRENT_COMPOSE_FILE="$claimed"
            die "Compose changed after snapshot; refusing concurrent overwrite"
        fi
    else
        [ ! -e "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || {
            die "Compose appeared after snapshot; refusing concurrent overwrite"
        }
    fi

    if [ -f "$ownership_snapshot" ]; then
        write_publication_claim_state "$ownership_live" "$ownership_claimed" pending
        test_crashpoint "publication-before-ownership-claim"
        mv -- "$ownership_live" "$ownership_claimed"
        file_sync "$STATE_ROOT"
        test_crashpoint "publication-after-ownership-claim-before-journal"
        write_publication_claim_state "$ownership_live" "$ownership_claimed" claimed
        write_publication_journal
        if ! cmp -s "$ownership_snapshot" "$ownership_claimed"; then
            CONCURRENT_OWNERSHIP_FILE="$ownership_claimed"
            die "Compose ownership changed after snapshot; refusing concurrent overwrite"
        fi
    else
        [ ! -e "$ownership_live" ] && [ ! -L "$ownership_live" ] || {
            die "Compose ownership appeared after snapshot; refusing concurrent overwrite"
        }
    fi

    test_mutate_compose_during_publish
    # candidate is in the destination directory, so hard-link creation is an
    # atomic no-replace publication primitive on every supported filesystem.
    if ! ln -- "$candidate" "$COMPOSE_FILE" 2>/dev/null; then
        if [ -e "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] && [ -f "$COMPOSE_FILE" ]; then
            CONCURRENT_COMPOSE_FILE="$ATTEMPT_DIR/concurrent-compose.yml"
            atomic_copy_file "$COMPOSE_FILE" "$CONCURRENT_COMPOSE_FILE" 600
        fi
        die "Compose appeared during publication; refusing concurrent overwrite"
    fi
    test_crashpoint "publish-after-compose-before-ownership"
    test_mutate_ownership_during_publish
    if ! ln -- "$ownership_candidate" "$ownership_live" 2>/dev/null; then
        if [ -e "$ownership_live" ] && [ ! -L "$ownership_live" ] && [ -f "$ownership_live" ]; then
            CONCURRENT_OWNERSHIP_FILE="$ATTEMPT_DIR/concurrent-compose-ownership.json"
            atomic_copy_file "$ownership_live" "$CONCURRENT_OWNERSHIP_FILE" 600
        fi
        die "Compose ownership appeared during publication; refusing concurrent overwrite"
    fi
    test_replace_publication_path_before_cleanup
    if ! cleanup_publication_claims; then
        RECOVERY_REQUIRED_ONLY=1
        die "publication journal cleanup validation failed; recovery must continue in the same epoch"
    fi
    file_sync "$INSTALL_DIR"
    file_sync "$STATE_ROOT"
}

test_replace_publication_path_before_cleanup() {
    [ "$TEST_MODE" = "1" ] || return 0
    local kind=${BILI_SETUP_TEST_PUBLICATION_CLEANUP_REPLACEMENT:-}
    local target
    case "$kind" in
        '') return 0 ;;
        compose-candidate) target="$INSTALL_DIR/.docker-compose.yml.candidate.$ATTEMPT_ID" ;;
        compose-claim) target="$INSTALL_DIR/.docker-compose.yml.claimed.$ATTEMPT_ID" ;;
        ownership-candidate) target="$STATE_ROOT/.compose-ownership.candidate.$ATTEMPT_ID" ;;
        ownership-claim) target="$STATE_ROOT/.compose-ownership.claimed.$ATTEMPT_ID" ;;
        *) die "unknown publication cleanup replacement kind: $kind" ;;
    esac
    rm -f -- "$target"
    printf '%s\n' 'concurrent publication replacement' > "$target"
    chmod 600 "$target"
    file_sync "$target"
}

test_mutate_compose_during_publish() {
    [ "$TEST_MODE" = "1" ] || return 0
    local source=${BILI_SETUP_TEST_CONCURRENT_COMPOSE_DURING_PUBLISH_SOURCE:-}
    [ -n "$source" ] || return 0
    [ -f "$source" ] && [ ! -L "$source" ] || die "test concurrent Compose publication source is unsafe"
    atomic_copy_file "$source" "$COMPOSE_FILE" 600
}

test_mutate_ownership_during_publish() {
    [ "$TEST_MODE" = "1" ] || return 0
    local source=${BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_DURING_PUBLISH_SOURCE:-}
    [ -n "$source" ] || return 0
    [ -f "$source" ] && [ ! -L "$source" ] || die "test concurrent ownership publication source is unsafe"
    atomic_copy_file "$source" "$STATE_ROOT/compose-ownership.json" 600
}

test_mutate_compose_before_publish() {
    [ "$TEST_MODE" = "1" ] || return 0
    local source=${BILI_SETUP_TEST_CONCURRENT_COMPOSE_SOURCE:-}
    if [ -n "$source" ]; then
        [ -f "$source" ] && [ ! -L "$source" ] || die "test concurrent Compose source is unsafe"
        atomic_copy_file "$source" "$COMPOSE_FILE" 600
    fi
    source=${BILI_SETUP_TEST_CONCURRENT_OWNERSHIP_SOURCE:-}
    [ -n "$source" ] || return 0
    [ -f "$source" ] && [ ! -L "$source" ] || die "test concurrent ownership source is unsafe"
    atomic_copy_file "$source" "$STATE_ROOT/compose-ownership.json" 600
}

load_health_container_port() {
    local compose_file=${1:-$COMPOSE_FILE}
    local sandbox_compose=/install/docker-compose.yml
    [ "$compose_file" != "$WORK_DIR/docker-compose.yml" ] || sandbox_compose=/staging/work/docker-compose.yml
    local model_file="$ATTEMPT_DIR/compose-health-model.json"
    compose_cmd -f "$compose_file" config --format json > "$model_file"
    chmod 600 "$model_file"
    if [ ! -s "$model_file" ]; then
        if [ "$TEST_MODE" = "1" ] && [ -n "$CLI_DRIVER" ]; then
            HEALTH_CONTAINER_PORT=3000
            safe_remove_file "$model_file"
            return 0
        fi
        HEALTH_CONTAINER_PORT=$(sandbox_cli node -e '
const fs = require("fs")
const YAML = require("yaml")
const compose = YAML.parse(fs.readFileSync(process.argv[1], "utf8"))
const ports = compose?.services?.["bili-qq-bot"]?.ports || []
const targets = [...new Set(ports.map(port => Number(typeof port === "object" ? port.target : String(port).split(":").pop().split("/")[0])).filter(Number.isInteger))]
if (targets.length !== 1) process.exit(2)
process.stdout.write(String(targets[0]))
' "$sandbox_compose")
        safe_remove_file "$model_file"
    else
        HEALTH_CONTAINER_PORT=$(sandbox_cli node -e '
const fs = require("fs")
const model = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const service = model.services?.["bili-qq-bot"]
const ports = Array.isArray(service?.ports) ? service.ports : []
const targets = [...new Set(ports.map(port => Number(typeof port === "object" ? port.target : String(port).split(":").pop().split("/")[0])).filter(port => Number.isInteger(port) && port > 0 && port <= 65535))]
if (targets.length !== 1) process.exit(2)
process.stdout.write(String(targets[0]))
' /staging/compose-health-model.json)
        safe_remove_file "$model_file"
    fi
    case "$HEALTH_CONTAINER_PORT" in
        ''|*[!0-9]*) die "rendered Compose health target port is invalid" ;;
    esac
    [ "$HEALTH_CONTAINER_PORT" -gt 0 ] && [ "$HEALTH_CONTAINER_PORT" -le 65535 ] || die "rendered Compose health target port is out of range"
    {
        printf '%s\n' "$HEALTH_CONTAINER_PORT" > "$HEALTH_PORT_FILE"
        chmod 600 "$HEALTH_PORT_FILE"
        file_sync "$HEALTH_PORT_FILE"
    } || log "health port cache update failed; rendered Compose remains authoritative"
}

apply_candidate_files() {
    if [ -n "$CONFIG_INPUT" ]; then
        atomic_copy_file "$WORK_DIR/config/config.yaml" "$CONFIG_DIR/config.yaml" 600
    fi
    if [ -d "$WORK_DIR/data" ]; then
        local file relative
        while IFS= read -r -d '' file; do
            relative=${file#"$WORK_DIR/data/"}
            atomic_copy_file "$file" "$DATA_DIR/$relative" 600
        done < <(find "$WORK_DIR/data" -type f -print0)
    fi
    publish_compose_candidate
    capture_relocated_config_archive_proof
}

capture_relocated_config_archive_proof() {
    [ "$RELOCATION_ACTIVE" -eq 1 ] || return 0
    [ -f "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE" ] || return 0
    [ -f "$CONFIG_DIR/config.yaml" ] && [ ! -L "$CONFIG_DIR/config.yaml" ] || die "relocated config source must remain an ordinary config.yaml"
    local config_identity
    config_identity=$(file_identity "$CONFIG_DIR/config.yaml")
    printf 'config.yaml|%s|%s\n' "$config_identity" "$(hash_file "$CONFIG_DIR/config.yaml")" > "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
    chmod 600 "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
    file_sync "$RELOCATED_CONFIG_ARCHIVE_PROOF_FILE"
}

write_runtime_override() {
    local mode=$1
    local file="$ATTEMPT_DIR/runtime-$mode.yml"
    cat > "$file" <<EOF
services:
  bili-qq-bot:
    environment:
      BILI_UPGRADE_MODE: "$mode"
      BILI_RELEASE_EPOCH: "$RELEASE_EPOCH"
      BILI_MIGRATION_MANIFEST: "/app/data/setup-state/$ATTEMPT_ID/upgrade-manifest.json"
      BILI_DEPLOYMENT_ATTEMPT_ID: "$ATTEMPT_ID"
      BILI_LEGACY_WRITER_FENCED: "1"
EOF
    if [ -f "$ATTEMPT_DIR/bootstrap-input.json" ]; then
        cat >> "$file" <<EOF
      BILI_BOOTSTRAP_INPUT: "/app/data/setup-state/$ATTEMPT_ID/bootstrap-input.json"
EOF
    fi
    if [ "$RELOCATION_ACTIVE" -eq 1 ] && [ -n "$RELOCATED_DATA_DIR" ] && [ "$RELOCATED_DATA_DIR" != "$DATA_DIR" ]; then
        cat >> "$file" <<EOF
    volumes:
      - type: bind
        source: "$ATTEMPT_DIR"
        target: "/app/data/setup-state/$ATTEMPT_ID"
        read_only: true
EOF
    fi
    chmod 600 "$file"
    file_sync "$file"
    printf '%s\n' "$file"
}

health_once() {
    local expected_mode=$1
    local container_id
    container_id=$(find_service_container "bili-qq-bot")
    [ -n "$container_id" ] || return 1
    docker_cmd exec "$container_id" node -e '
const expected = process.argv[1]
const epoch = process.argv[2]
const port = process.argv[3]
const timeout = setTimeout(() => process.exit(2), 4000)
if (!/^\d+$/.test(port || "")) process.exit(7)
fetch(`http://127.0.0.1:${port}/api/ready`)
  .then(async response => ({ response, body: await response.json() }))
  .then(({ response, body }) => {
    clearTimeout(timeout)
    if (!response.ok || !body || body.config?.valid !== true) process.exit(3)
    const migration = body.migration || {}
    const bootstrap = body.applicationBootstrap || {}
    const provider = body.qqProvider || {}
    const subscription = body.subscription || {}
    if (expected === "probe") {
      const providerOk = provider.id === "official"
        ? provider.state === "preflight-ready"
        : ["preflight-ready", "deferred"].includes(provider.state)
      const checkpointOk = bootstrap.status === "ready"
      process.exit(body.mode === "upgrade-probe" && checkpointOk && providerOk && subscription.paused === true ? 0 : 4)
    }
    const epochOk = !epoch || provider.releaseEpoch === epoch || migration.releaseEpoch === epoch
    const checkpointOk = bootstrap.status === "ready"
    process.exit(body.mode === "normal" && checkpointOk && provider.state === "ready" && subscription.state === "ready" && subscription.paused !== true && epochOk ? 0 : 5)
  })
  .catch(() => process.exit(6))
' "$expected_mode" "$RELEASE_EPOCH" "$HEALTH_CONTAINER_PORT"
}

wait_for_health() {
    local expected_mode=$1
    local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
    local successes=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if health_once "$expected_mode"; then
            successes=$(( successes + 1 ))
            if [ "$successes" -ge "$HEALTH_CONSECUTIVE_SUCCESSES" ]; then
                return 0
            fi
        else
            successes=0
        fi
        sleep "$HEALTH_INTERVAL_SECONDS"
    done
    return 1
}

archive_legacy_config() {
    if [ ! -f "$LEGACY_ARCHIVE_PROOF_FILE" ]; then
        [ "$SOURCE_RUNTIME_CLASS" != "legacy-v0" ] || die "legacy archive proof is missing"
        return 0
    fi
    local archive_dir="$ATTEMPT_DIR/legacy-config-archive"
    mkdir -p -- "$archive_dir"
    chmod 700 "$archive_dir"
    local legacy _dev _ino _hash
    test_mutate_archive_source "$CONFIG_DIR/config.json" "${BILI_SETUP_TEST_LEGACY_ARCHIVE_MUTATION:-}"
    while IFS='|' read -r legacy _dev _ino _hash; do
        [ -n "$legacy" ] || continue
        secure_archive_file "$CONFIG_DIR/$legacy" "$ATTEMPT_DIR/retained-vault/archive/legacy/$legacy" "$LEGACY_ARCHIVE_PROOF_FILE" "$legacy" "legacy-config"
    done < "$LEGACY_ARCHIVE_PROOF_FILE"
    local entry relative
    while IFS= read -r -d '' entry; do
        relative=${entry#"$CONFIG_DIR/"}
        [ "$relative" = "config.yaml" ] || die "config directory contains an unrecognized entry after migration: $relative"
    done < <(find "$CONFIG_DIR" -mindepth 1 -maxdepth 1 -print0)
    assert_private_control_file "$CONFIG_DIR/config.yaml"
    sync_tree "$archive_dir"
    file_sync "$CONFIG_DIR"
    file_sync "$ATTEMPT_DIR"
    file_sync "$STATE_ROOT"
    file_sync "$DATA_DIR"
    test_failpoint "archive-after-parent-fsync"
}

test_mutate_archive_source() {
    [ "$TEST_MODE" = "1" ] || return 0
    local target=$1 mutation=$2 source
    [ -n "$mutation" ] || return 0
    [ -e "$target" ] || die "test archive mutation target is missing"
    case "$mutation" in
        byte-swap) printf '%s\n' 'concurrent archive bytes' > "$target"; chmod 600 "$target" ;;
        symlink)
            source="$target.concurrent"
            printf '%s\n' 'concurrent archive symlink bytes' > "$source"
            chmod 600 "$source"
            rm -f -- "$target"
            ln -s -- "$source" "$target"
            ;;
        hardlink)
            source="$target.concurrent"
            printf '%s\n' 'concurrent archive hardlink bytes' > "$source"
            chmod 600 "$source"
            rm -f -- "$target"
            ln -- "$source" "$target"
            ;;
        missing) rm -f -- "$target" ;;
        dangling)
            rm -f -- "$target"
            ln -s -- "$target.missing" "$target"
            ;;
        *) die "unknown test archive mutation: $mutation" ;;
    esac
}

file_identity() {
    local file=$1
    if stat -f '%d|%i' "$file" 2>/dev/null; then
        :
    else
        stat -c '%d|%i' "$file"
    fi
}

capture_legacy_archive_proof() {
    # The target application publishes the proof after it has consumed the
    # legacy sources. setup copies and verifies that proof only after readiness.
    return 0
}

load_application_archive_proof() {
    [ "$SOURCE_RUNTIME_CLASS" = "legacy-v0" ] || return 0
    local source="$DATA_DIR/application-migration/archive-proof.tsv"
    local manifest="$DATA_DIR/application-migration/manifest.json"
    [ -f "$manifest" ] && [ ! -L "$manifest" ] || die "application migration manifest is missing"
    [ -f "$source" ] && [ ! -L "$source" ] || die "application archive proof is missing"
    node - "$manifest" "$source" "$ATTEMPT_ID" "$RELEASE_EPOCH" <<'NODE'
const crypto = require('crypto')
const fs = require('fs')
const [manifestPath, proofPath, attemptId, releaseEpoch] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const proof = fs.readFileSync(proofPath, 'utf8')
if (manifest.status !== 'ready' || manifest.deploymentAttemptId !== attemptId || manifest.releaseEpoch !== releaseEpoch) process.exit(2)
if (manifest.archive?.eligible !== true || manifest.archive.proofArtifact !== 'archive-proof.tsv') process.exit(3)
if (!/^[a-f0-9]{64}$/.test(manifest.archive.proofId || '') || !proof.trim()) process.exit(4)
for (const line of proof.trim().split('\n')) {
  const [name, dev, ino, hash] = line.split('|')
  if (!name || name.includes('/') || !/^\d+$/.test(dev) || !/^\d+$/.test(ino) || !/^[a-f0-9]{64}$/.test(hash)) process.exit(5)
}
NODE
    atomic_copy_file "$source" "$LEGACY_ARCHIVE_PROOF_FILE" 600
}

secure_archive_file() {
    local source=$1 destination=$2 proof_file=$3 proof_name=$4 scope=$5
    [ -f "$proof_file" ] || die "archive source proof is missing: $proof_name"
    # Archive can resume after a crash boundary and may still need destination,
    # control-plane and hardlink-break copies.  Never reuse stale statfs data.
    preflight_cutover_capacity
    node -e '
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const [source, destination, proofPath, name, failpoint, attemptId, releaseEpoch, scope] = process.argv.slice(1)
if (!Number.isInteger(fs.constants.O_NOFOLLOW)) process.exit(19)
const proof = fs.readFileSync(proofPath, "utf8").trim().split("\n").filter(Boolean)
  .map(line => line.split("|"))
  .find(parts => parts.length === 4 && parts[0] === name)
if (!proof) process.exit(20)
const [, expectedDev, expectedIno, expectedHash] = proof
const hash = buffer => crypto.createHash("sha256").update(buffer).digest("hex")
const verifyIdentity = stat => stat.isFile() && String(stat.dev) === expectedDev && String(stat.ino) === expectedIno
const verify = stat => verifyIdentity(stat) && stat.nlink === 1
const statSafe = target => { try { return fs.lstatSync(target) } catch (error) { if (error.code === "ENOENT") return null; throw error } }
const fsyncParent = target => {
  const fd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY)
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
const crash = name => { if (failpoint === name) process.kill(process.pid, "SIGKILL") }
const vaultRoot = path.join(path.dirname(proofPath), "retained-vault")
const controlRoot = path.join(vaultRoot, "archive-control")
const activeRoot = path.join(controlRoot, "active")
const completedRoot = path.join(controlRoot, "completed")
const transactionKey = hash(Buffer.from(`${scope}\0${source}\0${destination}`))
const sourceClaimPath = path.join(activeRoot, `${transactionKey}.source-claim`)
const inventoryLockPath = path.join(vaultRoot, `inventory.owner-lock.${transactionKey}`)
const intentPath = path.join(activeRoot, `${transactionKey}.json`)
const completedIntentPath = path.join(completedRoot, `${transactionKey}.json`)
const ensurePrivateDir = target => {
  if (target !== path.dirname(target) && !statSafe(path.dirname(target))) ensurePrivateDir(path.dirname(target))
  if (!statSafe(target)) { fs.mkdirSync(target, { mode: 0o700 }); fsyncParent(target) }
  const stat = fs.lstatSync(target)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.geteuid()) process.exit(27)
  if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(target, 0o700)
}
const writeExclusiveJson = (target, value) => {
  const temp = `${target}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try {
    fs.linkSync(temp, target)
    fsyncParent(target)
  } finally {
    fs.unlinkSync(temp)
    fsyncParent(temp)
  }
}
const contained = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
const readPrivateJson = target => {
  const before = fs.lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.geteuid() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600) process.exit(29)
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.uid !== process.geteuid()) process.exit(29)
    const bytes = fs.readFileSync(fd)
    return { value: JSON.parse(bytes.toString("utf8")), stat: opened, digest: hash(bytes) }
  } finally { fs.closeSync(fd) }
}
const inventoryGenerations = () => fs.readdirSync(vaultRoot)
  .filter(name => /^inventory-[0-9]{12}\.json$/.test(name)).sort()
const readInventoryHead = () => {
  const names = inventoryGenerations()
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] !== `inventory-${String(index + 1).padStart(12, "0")}.json`) process.exit(30)
  }
  if (names.length === 0) return null
  const target = path.join(vaultRoot, names[names.length - 1])
  const read = readPrivateJson(target)
  if (read.value.generation !== names.length) process.exit(30)
  return { ...read, path: target }
}
if (path.basename(source) !== name || !contained(vaultRoot, destination) || !contained(activeRoot, sourceClaimPath) ||
    !contained(activeRoot, intentPath) || !contained(completedRoot, completedIntentPath)) process.exit(29)
ensurePrivateDir(controlRoot); ensurePrivateDir(activeRoot); ensurePrivateDir(completedRoot)
const expectedIntent = { version: 1, kind: "archive-file", attemptId, releaseEpoch, scope, source, destination, expectedDev, expectedIno, expectedHash, transactionKey }
const validateIntent = target => {
  const record = readPrivateJson(target).value
  for (const [key, value] of Object.entries(expectedIntent)) if (record[key] !== value) process.exit(29)
  if (path.basename(record.source) !== name || !contained(vaultRoot, record.destination)) process.exit(29)
  return record
}
const validateDestination = () => {
  let before
  try { before = fs.lstatSync(destination) } catch (error) { if (error.code === "ENOENT") return false; throw error }
  if (!before.isFile() || before.nlink !== 1 || ![0o600, 0o644].includes(before.mode & 0o777) || before.uid !== process.geteuid()) process.exit(24)
  const fd = fs.openSync(destination, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.uid !== process.geteuid() || hash(fs.readFileSync(fd)) !== expectedHash) process.exit(24)
    if (process.env.BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT === "verify-before-fchmod") {
      const replacement = `${destination}.${process.pid}.replacement`
      fs.writeFileSync(replacement, "unknown archive destination replacement\n", { mode: 0o600, flag: "wx" })
      fs.renameSync(replacement, destination); fsyncParent(destination)
    }
    fs.fchmodSync(fd, 0o600)
    const late = fs.fstatSync(fd)
    const pathname = fs.lstatSync(destination)
    if (late.dev !== opened.dev || late.ino !== opened.ino || pathname.dev !== opened.dev || pathname.ino !== opened.ino) process.exit(24)
  } finally { fs.closeSync(fd) }
  return true
}
const sameInode = (left, right) => {
  const leftStat = statSafe(left), rightStat = statSafe(right)
  return Boolean(leftStat && rightStat && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino)
}
const moveFileNoReplace = (sourcePath, destinationPath) => {
  if (sourcePath === destinationPath) return
  if (sameInode(sourcePath, destinationPath)) { fs.unlinkSync(sourcePath); fsyncParent(sourcePath); fsyncParent(destinationPath); return }
  try { fs.linkSync(sourcePath, destinationPath) } catch (error) { if (error.code === "EEXIST") process.exit(24); throw error }
  if (!sameInode(sourcePath, destinationPath)) process.exit(24)
  fs.unlinkSync(sourcePath); fsyncParent(sourcePath); fsyncParent(destinationPath)
}
ensurePrivateDir(path.dirname(destination))
let before
try { before = fs.lstatSync(source) } catch (error) { if (error.code !== "ENOENT") throw error }
if (!before) before = statSafe(sourceClaimPath)
if (!before) {
  if (!validateDestination()) process.exit(26)
  fsyncParent(destination)
  fsyncParent(source)
} else {
  if (!verifyIdentity(before) || before.nlink < 1 || before.nlink > 2) process.exit(21)
  let activeSource = statSafe(sourceClaimPath) ? sourceClaimPath : source
  if (activeSource === source) {
    const sourceRead = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const opened = fs.fstatSync(sourceRead), bytes = fs.readFileSync(sourceRead)
      if (!verifyIdentity(opened) || opened.nlink < 1 || hash(bytes) !== expectedHash) process.exit(23)
      const late = fs.lstatSync(source)
      if (!verify(late) || late.dev !== opened.dev || late.ino !== opened.ino) process.exit(25)
      fs.renameSync(source, sourceClaimPath); fsyncParent(source); fsyncParent(sourceClaimPath)
    } finally { fs.closeSync(sourceRead) }
    activeSource = sourceClaimPath
  }
  const fd = fs.openSync(activeSource, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    const bytes = fs.readFileSync(fd)
    if (!verifyIdentity(opened) || opened.nlink < 1 || hash(bytes) !== expectedHash) process.exit(23)
    if (validateDestination()) process.exit(25)
    if (statSafe(completedIntentPath)) validateIntent(completedIntentPath)
    if (statSafe(intentPath)) validateIntent(intentPath)
    else if (!statSafe(completedIntentPath)) writeExclusiveJson(intentPath, expectedIntent)
    crash("archive-after-intent-fsync")
    const late = fs.lstatSync(activeSource)
    if (!verifyIdentity(late) || !verifyIdentity(fs.fstatSync(fd)) || hash(bytes) !== expectedHash) process.exit(25)
    if (process.env.BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT === "before-no-replace-publish") {
      fs.writeFileSync(destination, "unknown archive destination before publish\n", { mode: 0o600, flag: "wx" })
      fsyncParent(destination)
    }
    if (process.env.BILI_SETUP_TEST_ARCHIVE_DESTINATION_REPLACEMENT === "final-check-race") {
      fs.writeFileSync(destination, "unknown archive destination at final check\n", { mode: 0o600, flag: "wx" })
      fsyncParent(destination)
    }
    moveFileNoReplace(activeSource, destination)
    crash("archive-after-source-rename")
    fsyncParent(activeSource)
    fsyncParent(destination)
  } finally { fs.closeSync(fd) }
}
const retained = fs.lstatSync(destination)
if (!verify(retained) || hash(fs.readFileSync(destination)) !== expectedHash) process.exit(24)
validateDestination()
const acquireInventoryLock = () => {
  const create = () => {
    const fd = fs.openSync(inventoryLockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    try { fs.writeFileSync(fd, `${JSON.stringify({ version: 1, attemptId, releaseEpoch, pid: process.pid })}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fsyncParent(inventoryLockPath)
  }
  try { create(); return } catch (error) { if (error.code !== "EEXIST") throw error }
  const existing = readPrivateJson(inventoryLockPath)
  const owner = existing.value
  if (owner.version !== 1 || owner.attemptId !== attemptId || owner.releaseEpoch !== releaseEpoch || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) process.exit(30)
  process.exit(30)
}
const retainInventoryLock = () => {
  const lock = readPrivateJson(inventoryLockPath)
  if (lock.value.attemptId !== attemptId || lock.value.releaseEpoch !== releaseEpoch || lock.value.pid !== process.pid) process.exit(30)
  const retained = `${inventoryLockPath}.retained.${process.pid}`
  if (statSafe(retained)) process.exit(30)
  const late = fs.lstatSync(inventoryLockPath)
  if (late.dev !== lock.stat.dev || late.ino !== lock.stat.ino) process.exit(30)
  fs.renameSync(inventoryLockPath, retained); fsyncParent(inventoryLockPath); fsyncParent(retained)
  const terminal = fs.lstatSync(retained)
  if (terminal.dev !== lock.stat.dev || terminal.ino !== lock.stat.ino) process.exit(30)
}
const publishInventory = (expectedRead, value) => {
  const assertNamespace = () => { const current = readInventoryHead(); if (!expectedRead) { if (current) process.exit(30); return }
    if (!current || current.path !== expectedRead.path || current.stat.dev !== expectedRead.stat.dev || current.stat.ino !== expectedRead.stat.ino || current.digest !== expectedRead.digest) process.exit(30) }
  assertNamespace()
  if (process.env.BILI_SETUP_TEST_ARCHIVE_INVENTORY_REPLACEMENT === "after-cas-before-publish") {
    const replacement = path.join(vaultRoot, `inventory-${String(value.generation).padStart(12, "0")}.json`)
    fs.writeFileSync(replacement, `${JSON.stringify({ version: 1, attemptId, releaseEpoch, generation: value.generation + 100, retained: [{ disposition: "unknown", marker: "concurrent-inventory-after-cas" }] })}\n`, { mode: 0o600, flag: "wx" }); fsyncParent(replacement)
  }
  assertNamespace()
  const target = path.join(vaultRoot, `inventory-${String(value.generation).padStart(12, "0")}.json`)
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fsyncParent(target)
  const final = readInventoryHead(); if (!final || final.path !== target || final.digest !== hash(fs.readFileSync(target))) process.exit(30)
}
acquireInventoryLock()
const inventoryRead = readInventoryHead()
const previous = inventoryRead ? JSON.parse(JSON.stringify(inventoryRead.value)) : { version: 1, attemptId, releaseEpoch, generation: 0, retained: [] }
if (previous.version !== 1 || previous.attemptId !== attemptId || previous.releaseEpoch !== releaseEpoch || !Array.isArray(previous.retained)) process.exit(27)
if (!Number.isSafeInteger(previous.generation ?? 0) || (previous.generation ?? 0) < 0) process.exit(27)
const entry = { scope, attemptId, releaseEpoch, originalPath: source, retainedPath: destination, type: "file", dev: String(retained.dev), ino: String(retained.ino), sourceFingerprint: expectedHash, retainedFingerprint: expectedHash, disposition: "expected", retainedBytes: retained.blocks ? retained.blocks * 512 : retained.size }
previous.retained = previous.retained.filter(item => !(item.scope === scope && item.retainedPath === destination)).concat(entry).sort((a,b) => `${a.scope}|${a.retainedPath}`.localeCompare(`${b.scope}|${b.retainedPath}`))
previous.retainedBytes = previous.retained.reduce((sum, item) => sum + Number(item.retainedBytes || 0), 0)
previous.generation = (previous.generation ?? 0) + 1
if (inventoryRead && process.env.BILI_SETUP_TEST_ARCHIVE_INVENTORY_REPLACEMENT === "inode") {
  const replacement = path.join(vaultRoot, `inventory-${String(previous.generation).padStart(12, "0")}.json`)
  fs.writeFileSync(replacement, `${JSON.stringify({ version: 1, attemptId, releaseEpoch, generation: previous.generation + 100, retained: [{ disposition: "unknown", marker: "concurrent-inventory" }] })}\n`, { mode: 0o600, flag: "wx" }); fsyncParent(replacement)
}
publishInventory(inventoryRead, previous)
if (statSafe(intentPath)) {
  if (statSafe(completedIntentPath)) process.exit(29)
  const intentRead = readPrivateJson(intentPath)
  if (process.env.BILI_SETUP_TEST_ARCHIVE_COMPLETED_INTENT_REPLACEMENT === "before-no-replace-publish") {
    fs.writeFileSync(completedIntentPath, "unknown completed intent before publish\n", { mode: 0o600, flag: "wx" })
    fsyncParent(completedIntentPath)
  }
  try { fs.linkSync(intentPath, completedIntentPath) } catch (error) { if (error.code === "EEXIST") process.exit(29); throw error }
  fsyncParent(completedIntentPath)
  const activeLate = fs.lstatSync(intentPath)
  const completedLate = fs.lstatSync(completedIntentPath)
  if (activeLate.dev !== intentRead.stat.dev || activeLate.ino !== intentRead.stat.ino || completedLate.dev !== intentRead.stat.dev || completedLate.ino !== intentRead.stat.ino || completedLate.nlink !== 2) process.exit(29)
  fs.unlinkSync(intentPath); fsyncParent(intentPath)
  var completedIntentRecord = { stat: intentRead.stat, digest: intentRead.digest }
}
validateIntent(completedIntentPath)
if (!completedIntentRecord) {
  const completedRead = readPrivateJson(completedIntentPath)
  completedIntentRecord = { stat: completedRead.stat, digest: completedRead.digest }
}
const terminal = completedIntentRecord.stat
const terminalEntry = { scope: "archive-control-intent", attemptId, releaseEpoch, originalPath: intentPath, retainedPath: completedIntentPath, type: "file", dev: String(terminal.dev), ino: String(terminal.ino), sourceFingerprint: transactionKey, retainedFingerprint: completedIntentRecord.digest, disposition: "expected", retainedBytes: terminal.blocks ? terminal.blocks * 512 : terminal.size }
const finalRead = readInventoryHead()
const finalInventory = JSON.parse(JSON.stringify(finalRead.value))
if (!finalInventory.retained.some(item => item.scope === terminalEntry.scope && item.retainedPath === terminalEntry.retainedPath)) {
  finalInventory.retained.push(terminalEntry)
  finalInventory.retained.sort((a,b) => `${a.scope}|${a.retainedPath}`.localeCompare(`${b.scope}|${b.retainedPath}`))
  finalInventory.retainedBytes = finalInventory.retained.reduce((sum, item) => sum + Number(item.retainedBytes || 0), 0)
  finalInventory.generation += 1
  publishInventory(finalRead, finalInventory)
}
retainInventoryLock()
' "$source" "$destination" "$proof_file" "$proof_name" "$TEST_FAILPOINT" "$ATTEMPT_ID" "$RELEASE_EPOCH" "$scope" || {
        local status=$?
        [ "$TEST_MODE" != "1" ] || log "secure archive transaction failed (status=$status source=$proof_name)"
        die "archive source changed or destination is unsafe; recovery must continue in the same epoch"
    }
}

assert_upgrade_config_directory_policy() {
    [ -d "$CONFIG_DIR" ] || return 0
    local entry relative
    while IFS= read -r -d '' entry; do
        relative=${entry#"$CONFIG_DIR/"}
        case "$relative" in
            config.yaml) assert_private_control_file "$entry" ;;
            .env|.env.example|config.json|config.json.example|.jwtSecret|.jwtSecret.example|.qqOfficialClientSecret|.qqOfficialClientSecret.example)
                [ "$SOURCE_RUNTIME_CLASS" = "legacy-v0" ] || die "managed config directory contains a legacy artifact: $relative"
                [ ! -L "$entry" ] || die "legacy config source must not be a symlink: $entry"
                [ -f "$entry" ] || die "legacy config source must be an ordinary file: $entry"
                local metadata mode _uid _gid _size
                metadata=$(stat_metadata "$entry")
                IFS='|' read -r mode _uid _gid _size <<EOF
$metadata
EOF
                case "$mode" in 600|644) ;; *) die "legacy config source has unsafe permissions: $entry" ;; esac
                local links
                if links=$(stat -f '%l' "$entry" 2>/dev/null); then :; else links=$(stat -c '%h' "$entry"); fi
                [ "$links" = "1" ] || die "legacy config source must have exactly one hard link: $entry"
                ;;
            *) die "config directory contains an unrecognized entry; move it explicitly before setup: $relative" ;;
        esac
    done < <(find "$CONFIG_DIR" -mindepth 1 -maxdepth 1 -print0)
}

mark_managed_runtime() {
    printf '%s\n' "$RELEASE_EPOCH" > "$MANAGED_RUNTIME_MARKER"
    chmod 600 "$MANAGED_RUNTIME_MARKER"
    file_sync "$MANAGED_RUNTIME_MARKER"
    file_sync "$STATE_ROOT"
}

start_probe_and_release() {
    local probe_override
    probe_override=$(write_runtime_override "probe")
    checkpoint "probe_started"
    compose_cmd -f "$COMPOSE_FILE" -f "$probe_override" up -d --remove-orphans
    wait_for_health "probe"
    verify_relocation_probe_inventory
    checkpoint "probe_ready"
    checkpoint "release_prepared"
    checkpoint "runtime_release_armed"

    # Persistent commit marker is written before any business Provider session.
    checkpoint "runtime_released"
    local release_override
    release_override=$(write_runtime_override "release")
    compose_cmd -f "$COMPOSE_FILE" -f "$release_override" up -d --force-recreate --remove-orphans bili-qq-bot
    wait_for_health "normal"
    checkpoint "runtime_ready"
    # Recheck after the runtime_ready checkpoint to close the manifest/health loop.
    wait_for_health "normal"
    load_application_archive_proof
    record_applied_deployment_baseline
    archive_legacy_config
    finalize_mount_relocations
    checkpoint "upgrade_complete"
    sync_relocated_setup_state
    [ "$RELOCATION_ACTIVE" -ne 1 ] || safe_remove_file "$RELOCATED_DATA_DIR/setup-state/active-attempt"
    mark_managed_runtime
    safe_remove_file "$ACTIVE_ATTEMPT_FILE"
}

resume_active_attempt() {
    [ "$RESUMING_ATTEMPT" -eq 1 ] || return 1
    [ -d "$ATTEMPT_DIR" ] || die "active attempt directory is missing"
    load_attempt_metadata
    load_relocation_state
    load_health_container_port "$COMPOSE_FILE"
    CURRENT_CHECKPOINT=$(data_cli status --manifest /staging/upgrade-manifest.json --field checkpoint)
    CUTOVER_KIND=$(data_cli status --manifest /staging/upgrade-manifest.json --field cutoverKind)
    case "$CUTOVER_KIND" in
        fresh-install|first-managed-adoption|resume-same-attempt|managed-upgrade) ;;
        *) die "active attempt cutover provenance is invalid" ;;
    esac
    case "$CURRENT_CHECKPOINT" in
        discovered|cutover_intent|legacy_fenced|forced_recovery_ready|runtime_stopped|snapshot_ready|candidate_written|data_applied|probe_started|probe_ready|release_prepared|runtime_release_armed|runtime_released|runtime_ready|upgrade_complete|rollback_started|rolled_back|failed) ;;
        *) die "active attempt manifest checkpoint is invalid" ;;
    esac
    local cached_checkpoint
    cached_checkpoint=$(cat "$CHECKPOINT_FILE" 2>/dev/null || true)
    if [ "$cached_checkpoint" != "$CURRENT_CHECKPOINT" ]; then
        log "checkpoint cache mismatch; using validated manifest state $CURRENT_CHECKPOINT"
        printf '%s\n' "$CURRENT_CHECKPOINT" > "$CHECKPOINT_FILE"
        chmod 600 "$CHECKPOINT_FILE"
        file_sync "$CHECKPOINT_FILE"
    fi
    case "$CURRENT_CHECKPOINT" in
        upgrade_complete)
            MARKER_COMMITTED=1
            local completed_release_override
            completed_release_override=$(write_runtime_override "release")
            if ! health_once "normal"; then
                compose_cmd -f "$COMPOSE_FILE" -f "$completed_release_override" up -d --force-recreate --remove-orphans bili-qq-bot
            fi
            if ! wait_for_health "normal"; then
                die "completed release failed the normal health gate"
            fi
            [ -f "$WORK_DIR/config/config.yaml" ] || prepare_worktree
            record_applied_deployment_baseline
            mark_managed_runtime
            finalize_mount_relocations
            safe_remove_file "$ACTIVE_ATTEMPT_FILE"
            log "attempt $ATTEMPT_ID is already complete"
            return 0
            ;;
        runtime_released|runtime_ready)
            MARKER_COMMITTED=1
            preflight_cutover_capacity
            local release_override
            release_override=$(write_runtime_override "release")
            if ! health_once "normal"; then
                compose_cmd -f "$COMPOSE_FILE" -f "$release_override" up -d --force-recreate --remove-orphans bili-qq-bot
                if ! wait_for_health "normal"; then
                    die "committed release failed the normal health gate after restart"
                fi
            fi
            if [ "$CURRENT_CHECKPOINT" = "runtime_released" ]; then
                checkpoint "runtime_ready"
            fi
            if ! wait_for_health "normal"; then
                die "committed release failed the normal health gate"
            fi
            [ -f "$WORK_DIR/config/config.yaml" ] || prepare_worktree
            record_applied_deployment_baseline
            archive_legacy_config
            finalize_mount_relocations
            checkpoint "upgrade_complete"
            sync_relocated_setup_state
            [ "$RELOCATION_ACTIVE" -ne 1 ] || safe_remove_file "$RELOCATED_DATA_DIR/setup-state/active-attempt"
            mark_managed_runtime
            safe_remove_file "$ACTIVE_ATTEMPT_FILE"
            return 0
            ;;
        rolled_back)
            safe_remove_file "$ACTIVE_ATTEMPT_FILE"
            log "previous attempt is already rolled back safely; rerun setup to create a new attempt"
            exit 75
            ;;
        *)
            CUTOVER_INTENT_WRITTEN=1
            [ ! -f "$ATTEMPT_METADATA_FILE" ] || RUNTIME_MUTATION_STARTED=1
            preflight_cutover_capacity
            if rollback_pre_marker; then
                log "incomplete pre-marker attempt was rolled back safely; rerun setup to create a new attempt"
                exit 75
            fi
            log "incomplete pre-marker attempt remains recovery-required; repair the preserved control artifacts and rerun setup"
            exit 1
            ;;
    esac
}

print_dry_run_report() {
    local status=${1:-OK}
    local rollback_available=${2:-1}
    local guarantee="exactly-once"
    local exception_scope="none"
    local affected="none"
    local retry="none"
    if [ "$SOURCE_RUNTIME_CLASS" = "legacy-v0" ]; then
        guarantee="best-effort"
        exception_scope="legacy-v0-first-cutover-inflight-outbound"
        affected="operations-without-durable-part-record"
        retry="retry-determinable-uncommitted-parent-or-target"
    fi
    printf '{"status":"%s","mode":"%s","plannedDeliveryGuarantee":"%s","plannedExceptionScope":"%s","plannedAffectedState":"%s","plannedRetryPolicy":"%s","plannedFeatureInventory":%s,"fenceCapability":"%s","wouldForceStop":%s,"wouldModifyLogicalPaths":["/config","/deployment","/migration"],"checks":{"evaluated":["docker","target-image","config-cli","compose-model","legacy-feature-inventory"],"skipped":[]},"rollbackAvailable":%s}\n' \
        "$status" "$MODE" "$guarantee" "$exception_scope" "$affected" "$retry" "$LEGACY_FEATURE_INVENTORY_JSON" \
        "${FENCE_CAPABILITY:-not-required}" \
        "$([ "$ALLOW_FORCE_STOP" -eq 1 ] && printf true || printf false)" \
        "$([ "$rollback_available" -eq 1 ] && printf true || printf false)"
}

prepare_dry_run_snapshot() {
    DRY_RUN_STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/bili-setup-dry-run.XXXXXX")
    chmod 700 "$DRY_RUN_STAGING_DIR"
    ATTEMPT_DIR="$DRY_RUN_STAGING_DIR"
    WORK_DIR="$DRY_RUN_STAGING_DIR/work"
    SNAPSHOT_DIR="$DRY_RUN_STAGING_DIR/snapshot"
    OWNERSHIP_FILE="$DRY_RUN_STAGING_DIR/compose-owned.json"
    mkdir -p -- "$WORK_DIR/config" "$WORK_DIR/data" "$SNAPSHOT_DIR/config" "$SNAPSHOT_DIR/setup-control"
    chmod 700 "$WORK_DIR" "$WORK_DIR/config" "$WORK_DIR/data" "$SNAPSHOT_DIR" "$SNAPSHOT_DIR/config" "$SNAPSHOT_DIR/setup-control"

    [ ! -f "$COMPOSE_FILE" ] || cp -- "$COMPOSE_FILE" "$SNAPSHOT_DIR/docker-compose.yml"
    [ ! -f "$STATE_ROOT/compose-ownership.json" ] || \
        cp -- "$STATE_ROOT/compose-ownership.json" "$SNAPSHOT_DIR/setup-control/compose-ownership.json"
    [ ! -f "$CONFIG_DIR/config.yaml" ] || cp -- "$CONFIG_DIR/config.yaml" "$SNAPSHOT_DIR/config/config.yaml"
}

verify_dry_run_snapshot_cas() {
    if [ -f "$SNAPSHOT_DIR/docker-compose.yml" ]; then
        [ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] && cmp -s "$SNAPSHOT_DIR/docker-compose.yml" "$COMPOSE_FILE" || \
            die "Compose changed during dry-run evaluation"
    else
        [ ! -e "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || die "Compose appeared during dry-run evaluation"
    fi
    local frozen_ownership="$SNAPSHOT_DIR/setup-control/compose-ownership.json"
    local live_ownership="$STATE_ROOT/compose-ownership.json"
    if [ -f "$frozen_ownership" ]; then
        [ -f "$live_ownership" ] && [ ! -L "$live_ownership" ] && cmp -s "$frozen_ownership" "$live_ownership" || \
            die "Compose ownership changed during dry-run evaluation"
    else
        [ ! -e "$live_ownership" ] && [ ! -L "$live_ownership" ] || die "Compose ownership appeared during dry-run evaluation"
    fi
}

prepare_dry_run_config() {
    if [ -n "$CONFIG_INPUT" ]; then
        cp -- "$CONFIG_INPUT" "$WORK_DIR/config/config.yaml"
    elif [ -f "$SNAPSHOT_DIR/config/config.yaml" ]; then
        cp -- "$SNAPSHOT_DIR/config/config.yaml" "$WORK_DIR/config/config.yaml"
    elif [ "$MODE" = "upgrade" ]; then
        config_cli migrate-legacy \
            --legacy-root /current/config \
            --output /staging/work/config/config.yaml \
            --data-dir /staging/work/data \
            --migration-dir /staging/migration \
            --manifest /staging/upgrade-manifest.json \
            --owner-lock /staging/config-owner.lock \
            --allow-missing-runtime-env \
            --json >/dev/null
    else
        # A fresh no-config dry-run evaluates the generated schema/default
        # deployment model in private temporary storage. It does not claim that
        # provider credentials are configured and writes nothing below install.
        config_cli init \
            --provider "$PROVIDER" \
            --output /staging/work/config/config.yaml \
            --owner-lock /staging/config-owner.lock \
            --json >/dev/null
    fi
    config_cli validate --config /staging/work/config/config.yaml --json >/dev/null
}

render_dry_run_candidate() {
    local args=(
        render-compose
        --config /staging/work/config/config.yaml
        --output /staging/work/docker-compose.yml
        --ownership-output /staging/compose-owned.json
        --json
    )
    [ ! -f "$SNAPSHOT_DIR/docker-compose.yml" ] || args+=(--existing-compose /staging/snapshot/docker-compose.yml)
    [ ! -f "$SNAPSHOT_DIR/setup-control/compose-ownership.json" ] || \
        args+=(--ownership /staging/snapshot/setup-control/compose-ownership.json)
    [ "$MODE" != "install" ] || args+=(--adopt-known-template)
    [ "$ADOPT_EXISTING" -ne 1 ] || args+=(--adopt-existing)
    args+=(--bot-image "$TARGET_IMAGE_ID")
    [ -z "$TARGET_NAPCAT_IMAGE_ID" ] || args+=(--napcat-image "$TARGET_NAPCAT_IMAGE_ID")
    config_cli "${args[@]}" >/dev/null
    compose_cmd -f "$WORK_DIR/docker-compose.yml" config -q
}

run_dry_run() {
    if [ -n "$CONFIG_INPUT" ]; then
        [ -f "$CONFIG_INPUT" ] || die "config input not found"
    fi

    collect_dry_run_feature_inventory
    prepare_dry_run_snapshot
    prepare_dry_run_config
    local plan_args=(deployment-plan --config /staging/work/config/config.yaml --dry-run --json)
    [ ! -f "$SNAPSHOT_DIR/docker-compose.yml" ] || plan_args+=(--existing-compose /staging/snapshot/docker-compose.yml)
    config_cli "${plan_args[@]}" >/dev/null
    render_dry_run_candidate
    verify_dry_run_snapshot_cas
    print_dry_run_report "OK" "$([ "$MODE" = "install" ] && printf 0 || printf 1)"
}

run_install() {
    mkdir -p -- "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" "$NAPCAT_CONFIG_DIR" "$NAPCAT_QQ_DIR" "$FONTS_DIR" "$STATE_ROOT"
    chmod 700 "$CONFIG_DIR" "$DATA_DIR" "$STATE_ROOT"
    initialize_attempt
    checkpoint "cutover_intent"
    write_attempt_metadata
    create_snapshot 0
    checkpoint "snapshot_ready"
    prepare_worktree
    prepare_config_candidate
    checkpoint "candidate_written"
    render_compose_candidate
    verify_compose_snapshot_cas
    apply_candidate_files
    checkpoint "data_applied"
    start_probe_and_release
}

run_upgrade() {
    initialize_attempt
    discover_mount_writers
    detect_host_write_handles
    capture_runtime_environment
    collect_legacy_feature_inventory
    capture_network_state
    assert_upgrade_config_directory_policy
    checkpoint_initial_cutover_intent
    capture_legacy_archive_proof
    test_failpoint "after-cutover-intent-before-rollback-pin"
    prepare_rollback_image
    resolve_target_image
    [ "$UPGRADE_NAPCAT" -ne 1 ] || resolve_target_napcat_image
    validate_current_manifest
    write_attempt_metadata
    persist_runtime_environment
    preflight_cutover_capacity
    RUNTIME_MUTATION_STARTED=1
    disconnect_legacy_networks
    stop_writers_for_cutover

    if [ "$FORCED_STOP_USED" -eq 0 ]; then
        create_snapshot 0
    fi
    checkpoint "snapshot_ready"

    prepare_worktree
    prepare_config_candidate
    checkpoint "candidate_written"
    render_compose_candidate
    test_mutate_compose_before_publish
    verify_compose_snapshot_cas
    apply_candidate_files
    checkpoint "data_applied"
    start_probe_and_release
}

assert_fresh_config_directory() {
    [ -d "$CONFIG_DIR" ] || return 0
    local entry relative
    while IFS= read -r -d '' entry; do
        relative=${entry#"$CONFIG_DIR/"}
        if [ "$relative" = "config.yaml" ] && [ -n "$CONFIG_INPUT" ] && \
            [ "$(canonical_path "$entry")" = "$CONFIG_INPUT" ]; then
            continue
        fi
        die "fresh installation requires config/ to be empty so only config.yaml remains: $relative"
    done < <(find "$CONFIG_DIR" -mindepth 1 -maxdepth 1 -print0)
}

run_apply() {
    [ -f "$CONFIG_DIR/config.yaml" ] || die "--apply requires config/config.yaml"
    initialize_attempt
    prepare_worktree
    cp -- "$CONFIG_DIR/config.yaml" "$WORK_DIR/config/config.yaml"
    config_cli validate --config /staging/work/config/config.yaml --json >/dev/null
    generate_deployment_plan
    extract_relocation_operations
    discover_mount_writers
    detect_host_write_handles
    preflight_relocation_targets
    capture_network_state
    assert_upgrade_config_directory_policy
    checkpoint_initial_cutover_intent
    test_failpoint "after-cutover-intent-before-rollback-pin"
    prepare_rollback_image
    resolve_target_image
    [ "$UPGRADE_NAPCAT" -ne 1 ] || resolve_target_napcat_image
    validate_current_manifest
    write_attempt_metadata
    preflight_cutover_capacity
    RUNTIME_MUTATION_STARTED=1
    stop_writers_for_cutover
    create_snapshot 1
    checkpoint "snapshot_ready"
    prepare_mount_relocations
    render_compose_candidate
    verify_apply_plan_cas
    verify_compose_snapshot_cas
    apply_candidate_files
    checkpoint "data_applied"
    start_probe_and_release
}

main() {
    require_command "$DOCKER_BIN"
    require_command find
    require_command sync
    require_command tar
    if [ -n "$CONFIG_INPUT" ]; then
        [ -e "$CONFIG_INPUT" ] || [ -L "$CONFIG_INPUT" ] || die "config input not found"
        assert_private_control_file "$CONFIG_INPUT"
        CONFIG_INPUT=$(canonical_path "$CONFIG_INPUT")
    fi
    assert_safe_install_root
    acquire_install_lock
    detect_mode
    detect_provider
    cleanup_orphan_setup_intents
    if [ "$MODE" = "install" ]; then
        SOURCE_RUNTIME_CLASS="fresh-install"
        CUTOVER_KIND="fresh-install"
    elif [ -f "$MANAGED_RUNTIME_MARKER" ]; then
        SOURCE_RUNTIME_CLASS="managed-v1+"
        CUTOVER_KIND="managed-upgrade"
        [ "$ALLOW_FORCE_STOP" -ne 1 ] || die "--force-stop is forbidden for managed-v1+ upgrades"
    else
        SOURCE_RUNTIME_CLASS="legacy-v0"
        CUTOVER_KIND="first-managed-adoption"
    fi

    cleanup_runtime_env_snapshots
    if [ "$MODE" = "install" ]; then
        assert_fresh_config_directory
    else
        # Validate every active/legacy config artifact before attempt markers,
        # image pins, dry-run parsing, or any runtime mutation.
        assert_upgrade_config_directory_policy
    fi

    compose_cmd version >/dev/null

    if [ "$MODE" != "install" ]; then
        OLD_BOT_CONTAINER=$(find_service_container "bili-qq-bot")
        [ -n "$OLD_BOT_CONTAINER" ] || die "existing bili-qq-bot container not found"
        OLD_IMAGE_ID=$(docker_cmd inspect --format '{{.Image}}' "$OLD_BOT_CONTAINER")
        if [ "$UPGRADE_NAPCAT" -eq 1 ]; then
            OLD_NAPCAT_CONTAINER=$(find_service_container "napcat")
            [ -n "$OLD_NAPCAT_CONTAINER" ] || die "--upgrade-napcat requires an existing managed NapCat container"
            OLD_NAPCAT_IMAGE_ID=$(docker_cmd inspect --format '{{.Image}}' "$OLD_NAPCAT_CONTAINER")
        fi
    fi

    # The rollback image is pinned before target pull on mutating upgrades.
    if [ "$DRY_RUN" -eq 0 ]; then
        select_attempt
    fi
    if [ "$DRY_RUN" -eq 0 ] && [ "$RESUMING_ATTEMPT" -eq 1 ]; then
        load_attempt_metadata
        if [ -n "$TARGET_IMAGE_ID" ]; then
            local resumed_target_id
            resumed_target_id=$(image_id "$TARGET_IMAGE_ID" 2>/dev/null || true)
            [ "$resumed_target_id" = "$TARGET_IMAGE_ID" ] || die "active attempt target image content ID is unavailable or changed"
            TARGET_IMAGE_REF=$TARGET_IMAGE_ID
        fi
        if [ -n "$TARGET_NAPCAT_IMAGE_ID" ]; then
            local resumed_napcat_target_id
            resumed_napcat_target_id=$(image_id "$TARGET_NAPCAT_IMAGE_ID" 2>/dev/null || true)
            [ "$resumed_napcat_target_id" = "$TARGET_NAPCAT_IMAGE_ID" ] || die "active attempt NapCat target image content ID is unavailable or changed"
            TARGET_NAPCAT_IMAGE_REF=$TARGET_NAPCAT_IMAGE_ID
        fi
    fi
    if [ "$DRY_RUN" -eq 0 ] && [ "$MODE" != "install" ] && [ "$RESUMING_ATTEMPT" -eq 0 ]; then
        ROLLBACK_TAG="bili-qq-bot-rollback:${ATTEMPT_ID}"
        if [ "$UPGRADE_NAPCAT" -eq 1 ]; then
            NAPCAT_ROLLBACK_TAG="bili-qq-bot-napcat-rollback:${ATTEMPT_ID}"
        fi
    fi

    if [ "$DRY_RUN" -eq 1 ] || [ "$MODE" = "install" ]; then
        resolve_target_image
    elif [ "$RESUMING_ATTEMPT" -eq 0 ]; then
        TARGET_IMAGE_ID=$(image_id "$TARGET_IMAGE_REF" 2>/dev/null || true)
    fi
    if { [ "$DRY_RUN" -eq 1 ] && [ "$UPGRADE_NAPCAT" -eq 1 ]; } || \
        { [ "$MODE" = "install" ] && [ "$PROVIDER" = "napcat" ]; }; then
        resolve_target_napcat_image
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        run_dry_run
        return
    fi

    if [ "$RESUMING_ATTEMPT" -eq 1 ]; then
        resume_active_attempt && return
    fi

    case "$MODE" in
        install) run_install ;;
        upgrade) run_upgrade ;;
        apply) run_apply ;;
        *) die "unsupported mode: $MODE" ;;
    esac

    safe_remove_file "$RUNTIME_ENV_FILE"
    log "$MODE completed successfully (releaseEpoch=$RELEASE_EPOCH)"
}

main "$@"
