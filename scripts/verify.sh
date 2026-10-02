#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"
for command in node python3 docker; do command -v "${command}" >/dev/null || { echo "BLOCKED: ${command} unavailable" >&2; exit 2; }; done
required=(.dockerignore .env.example .gitignore .railway/railway.ts .railway/README.md Dockerfile compose.yaml package.json package-lock.json template-defaults.json template-descriptions.json template-networking.json template-volumes.json marketplace-metadata.json VERSION CHANGELOG.md README.md MARKETPLACE.md PUBLISHING.md SUPPORT.md UPGRADE.md LICENSE_REVIEW.md FINDINGS.md scripts/restore-template-draft.sh scripts/audit-template.sh scripts/smoke.sh)
for file in "${required[@]}"; do [[ -f "${file}" ]] || { echo "Missing ${file}" >&2; exit 1; }; done
[[ "$(<VERSION)" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
rg -q "^## $(<VERSION) — [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md
for file in scripts/*.sh; do bash -n "${file}"; done
python3 -B tests/gate_test.py
if env -u SOURCE_REPO node scripts/evaluate.mjs >/dev/null 2>&1; then echo 'Missing source accepted' >&2; exit 1; fi
export SOURCE_REPO="${SOURCE_REPO:-offline-fixture/not-a-deployment-source}"
node --test tests/offline.test.mjs
node --input-type=module - <<'JS'
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const result = JSON.parse(execFileSync('node_modules/.bin/railway-iac-ts', ['.railway/railway.ts'], { encoding: 'utf8' }));
assert.equal(result.ok, true);
assert.deepEqual(result.diagnostics, []);
const services = result.graph.resources.filter(resource => resource.type === 'service');
assert.deepEqual(services.map(service => service.name).sort(), ['Postgres', 'Server', 'Worker']);
const worker = services.find(service => service.name === 'Worker');
assert.match(worker.variables.AUTHENTIK_SECRET_KEY.value.generator, /^secret\(64,/);
console.log('PASS: pinned SDK official offline evaluator, typed source roots and secret generator');
JS
node --input-type=module -e 'import fs from "node:fs"; for(const file of fs.readdirSync(".").filter(name=>name.endsWith(".json")))JSON.parse(fs.readFileSync(file)); const p=JSON.parse(fs.readFileSync("package.json")); if(p.devDependencies.railway!=="3.6.0")throw Error("SDK pin drift");'
export POSTGRES_PASSWORD=verify-only-database-password
export AUTHENTIK_SECRET_KEY=verify-only-signing-secret-01234567890123456789
export AUTHENTIK_BOOTSTRAP_PASSWORD=verify-only-admin-password-01234567890123456789
export AUTHENTIK_BOOTSTRAP_TOKEN=verify-only-token-012345678901234567890123456789
docker compose -f compose.yaml config --quiet
python3 -B - <<'PY'
import json
import pathlib
import re
root = pathlib.Path('.')
assert not re.search(r'ctx\.randomString', (root/'.railway/railway.ts').read_text())
assert 'USER 1000' in (root/'Dockerfile').read_text()
assert 'chmod 0555 /data /templates /certs' in (root/'Dockerfile').read_text()
assert '/var/run/docker.sock' not in (root/'compose.yaml').read_text()
authentik_pin = 'ghcr.io/goauthentik/server:2026.8.3@sha256:ab9b4e8cc4ab3f8d1198d2db6aeea66bafea1963b3f2843589e0d163f97d9849'
postgres_pin = 'postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
assert authentik_pin in (root/'Dockerfile').read_text()
assert postgres_pin in (root/'compose.yaml').read_text() and postgres_pin in (root/'.railway/railway.ts').read_text()
metadata = json.loads((root/'marketplace-metadata.json').read_text())
assert 45 <= len(metadata['description']) <= 75
for readme in root.rglob('README.md'):
    if 'node_modules' not in readme.parts:
        text = readme.read_text()
        assert 'https://goauthentik.io/' in text and 'https://www.postgresql.org/' in text
assert not (root/'.env').exists()
print('PASS: structure, version, metadata, upstream links, and security boundaries')
PY
echo 'PASS: offline verification (NOT runtime or production qualification; run scripts/smoke.sh separately)'
