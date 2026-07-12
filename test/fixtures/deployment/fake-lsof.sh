#!/usr/bin/env bash

set -euo pipefail

if [ "${FAKE_HOST_WRITER:-0}" = "1" ]; then
    printf 'p424242\ncexternal-writer\nf9\naw\n'
    exit 0
fi

exit 1
