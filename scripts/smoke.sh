#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"
for command in docker python3 openssl timeout; do command -v "${command}" >/dev/null || { echo "BLOCKED: ${command} unavailable" >&2; exit 2; }; done
docker info >/dev/null 2>&1 || { echo 'BLOCKED: local Docker daemon unavailable' >&2; exit 2; }
python3 -B - <<'PY'
import socket
with socket.socket() as listener:
    try:
        listener.bind(('127.0.0.1', 18423))
    except OSError:
        raise SystemExit('BLOCKED: loopback port 18423 already occupied; do not touch its owner')
PY
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export AUTHENTIK_SECRET_KEY="$(openssl rand -hex 32)"
export AUTHENTIK_BOOTSTRAP_PASSWORD="$(openssl rand -hex 24)"
export AUTHENTIK_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
export AUTHENTIK_BOOTSTRAP_EMAIL=smoke@example.invalid
project="authentik-broker-smoke-$(id -u)-$(date +%s)-$$"
export RECIPE_IMAGE="${project}:$(cat VERSION)"
mkdir -p .artifacts
artifacts="$(mktemp -d "${root}/.artifacts/${project}.XXXXXX")"
compose=(docker compose -p "${project}" -f "${root}/compose.yaml")
cleanup() {
  status=$?
  trap - EXIT
  trap '' INT TERM
  rm -f "${artifacts}/database.dump"
  "${compose[@]}" logs --no-color 2>&1 | python3 -B -c 'import os,sys; text=sys.stdin.read(); names=("POSTGRES_PASSWORD","AUTHENTIK_SECRET_KEY","AUTHENTIK_BOOTSTRAP_PASSWORD","AUTHENTIK_BOOTSTRAP_TOKEN"); [None for name in names if not os.environ.get(name)];
for name in names:
    if os.environ.get(name): text=text.replace(os.environ[name], "[REDACTED]")
print(text)' > "${artifacts}/logs.txt" || true
  if ! timeout 90 "${compose[@]}" down --volumes --remove-orphans --timeout 35 > "${artifacts}/cleanup.txt" 2>&1; then
    echo "BLOCKED: own project cleanup failed: ${project}" >&2
    status=1
  fi
  timeout 30 docker image rm "${RECIPE_IMAGE}" >/dev/null 2>&1 || true
  if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=${project}")" || -n "$(docker volume ls -q --filter "label=com.docker.compose.project=${project}")" || -n "$(docker network ls -q --filter "label=com.docker.compose.project=${project}")" ]]; then
    echo "BLOCKED: owned resources remain for ${project}" >&2
    status=1
  fi
  echo "Local artifacts: ${artifacts} (exit ${status}); own Compose resources cleaned"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
echo "Isolated local project: ${project}; public binding 127.0.0.1:18423 only"
export DOCKER_BUILDKIT=0
timeout 600 "${compose[@]}" build > "${artifacts}/build.txt" 2>&1
timeout 120 "${compose[@]}" up -d postgres server > "${artifacts}/start.txt" 2>&1
sleep 10
"${compose[@]}" exec -T server python -c 'import socket
with socket.socket() as client:
    assert client.connect_ex(("127.0.0.1", 9000)) != 0, "Server bound before worker bootstrap"'
if python3 -B - <<'PY'
from urllib.request import urlopen
try:
    urlopen('http://127.0.0.1:18423/-/health/ready/', timeout=2)
except Exception:
    raise SystemExit(1)
PY
then echo 'FAIL: public HTTP responded before worker bootstrap' >&2; exit 1; fi
echo 'PASS: no server HTTP listener before worker starts'
timeout 120 "${compose[@]}" up -d worker >> "${artifacts}/start.txt" 2>&1
wait_healthy() {
  local deadline=$((SECONDS + 600)) service state container
  while (( SECONDS < deadline )); do
    local healthy=true
    for service in postgres worker server; do
      container="$("${compose[@]}" ps -q "${service}")"
      [[ -n "${container}" ]] || { "${compose[@]}" ps; echo "FAIL: ${service} exited" >&2; return 1; }
      state="$(docker inspect -f '{{.State.Health.Status}}' "${container}")"
      [[ "${state}" == healthy ]] || healthy=false
    done
    if [[ "${healthy}" == true ]]; then return; fi
    sleep 3
  done
  echo 'FAIL: bounded health wait expired' >&2
  return 1
}
wait_healthy
"${compose[@]}" exec -T worker python -c 'import os,pathlib
assert os.getuid() == 1000
assert not pathlib.Path("/var/run/docker.sock").exists()
for target in ("/data", "/templates", "/certs"):
    assert not os.access(target, os.W_OK)
    try: pathlib.Path(target,"recipe-write-must-fail").write_text("forbidden")
    except PermissionError: pass
    else: raise AssertionError("Mutable storage accepted")'
"${compose[@]}" exec -T server python -c 'import os,pathlib
assert os.getuid() == 1000
for target in ("/data", "/templates", "/certs"):
    assert not os.access(target, os.W_OK)
    try: pathlib.Path(target,"recipe-write-must-fail").write_text("forbidden")
    except PermissionError: pass
    else: raise AssertionError("Mutable storage accepted")'
echo 'PASS: both unprivileged runtimes reject filesystem media/templates/certificates'
python3 -B scripts/smoke-api.py fresh | tee "${artifacts}/api.txt"
"${compose[@]}" exec -T postgres psql -U authentik -d authentik -Atc "SELECT contract || ' ' || completed_at FROM public.railway_recipe_bootstrap" > "${artifacts}/gate.txt"
timeout 90 "${compose[@]}" restart worker server > "${artifacts}/restart.txt" 2>&1
wait_healthy
python3 -B scripts/smoke-api.py persisted | tee -a "${artifacts}/api.txt"
timeout 90 "${compose[@]}" stop worker server >/dev/null
"${compose[@]}" exec -T postgres pg_dump -U authentik -d authentik -Fc > "${artifacts}/database.dump"
"${compose[@]}" exec -T postgres psql -U authentik -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE authentik;' -c 'CREATE DATABASE authentik OWNER authentik;' >/dev/null
"${compose[@]}" exec -T postgres pg_restore -U authentik -d authentik --exit-on-error < "${artifacts}/database.dump"
timeout 120 "${compose[@]}" up -d worker server >/dev/null
wait_healthy
python3 -B scripts/smoke-api.py persisted | tee -a "${artifacts}/api.txt"
echo 'PASS: PostgreSQL dump/drop/restore preserves marker, application and certificate'
python3 -B scripts/smoke-api.py revoke | tee -a "${artifacts}/api.txt"
timeout 90 "${compose[@]}" restart worker server >/dev/null
wait_healthy
python3 -B scripts/smoke-api.py after-revoke | tee -a "${artifacts}/api.txt"
"${compose[@]}" exec -T worker python -c 'import sys; sys.path.insert(0,"/opt/recipe"); from gate import connect,approved; import os
os.environ["AUTHENTIK_SECRET_KEY"]="not-the-restored-signing-key-123456789"
try:
    with connect() as connection: approved(connection)
except RuntimeError: pass
else: raise AssertionError("Changed secret accepted")'
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' $("${compose[@]}" ps -q) > "${artifacts}/metrics.txt"
echo 'PASS: local build, start, bootstrap barrier, worker task, OIDC metadata, restart, SQL restore and revoked-token restart'
echo 'NOT RUN: real HTTPS/SMTP, external OIDC authorization-code/SAML/MFA integrations, cloud, marketplace and full artifact license review'
