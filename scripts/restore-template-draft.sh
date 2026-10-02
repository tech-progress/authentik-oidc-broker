#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# == 2 ]] || { echo 'Usage: SOURCE_REPO=owner/repo scripts/restore-template-draft.sh LOCAL_INPUT.json NEW_LOCAL_OUTPUT.json' >&2; exit 2; }
node "${root}/scripts/offline-template.mjs" restore "$1" "$2"
echo 'PASS: restored local draft only; no cloud request or mutation'
