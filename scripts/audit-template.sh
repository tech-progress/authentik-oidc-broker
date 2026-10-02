#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# == 1 ]] || { echo 'Usage: SOURCE_REPO=owner/repo scripts/audit-template.sh LOCAL_DRAFT.json' >&2; exit 2; }
node "${root}/scripts/offline-template.mjs" audit "$1"
