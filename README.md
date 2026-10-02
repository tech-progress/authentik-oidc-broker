# authentik OIDC broker on Railway

[authentik](https://goauthentik.io/) ([upstream source](https://github.com/goauthentik/authentik)) provides identity/federation services. [PostgreSQL](https://www.postgresql.org/) ([source](https://github.com/postgres/postgres)) stores identity configuration, credentials, signing certificates, tasks and the recipe bootstrap gate.

**Unpublished, production-boundary recipe; NOT production-qualified.** This is a three-service, single-region, single-replica deployment contract, not a highly available identity service. It uses authentik **2026.8.3**, PostgreSQL **16.14**, immutable image-index digests, and template contract **1.0.0**. Local tests and unrun qualification gates are recorded in `FINDINGS.md`; do not infer SSO correctness from readiness or discovery metadata.

## Architecture and security boundary

```text
Railway HTTPS domain → Server :9000 → private Postgres :5432 + database volume
                           ↑                     ↑
                 durable bootstrap gate ← private Worker
                                      Worker readiness :9301 (no public domain)
```

- No Redis, Docker socket, remote Docker integration, Kubernetes discovery, managed/embedded outpost, LDAP listener or reverse-proxy outpost is provisioned. Both services enforce `DISCOVER=false` and `DISABLE_EMBEDDED_OUTPOST=true` at startup. OIDC and SAML providers do not require these outposts.
- First boot credentials are generated **on Worker**, never Server. Worker runs the upstream entrypoint, migrations and bootstrap; the wrapper waits for the expected `akadmin` usable password, superuser membership, matching bootstrap token, administrator email, required flows, and three successfully applied database blueprint records. Only then does it commit `public.railway_recipe_bootstrap` with the signing-secret fingerprint.
- Server opens **no HTTP listener** until that durable marker exists and its signing-secret fingerprint matches. This works even if Railway schedules Server first; no deployment-order assumptions are made. Failures/timeouts leave the service closed.
- On later starts the gate uses the persisted completion marker, **not the original password or token**. Password changes and token revocation through authentik are supported; changing bootstrap environment variables is NOT password/token rotation. The smoke suite proves restart after revocation. A changed signing secret fails closed; this recipe does not implement key rotation.
- Both containers use UID 1000. `/data`, `/templates`, `/certs` are root-owned mode 0555 and intentionally have **no volumes**. Filesystem uploads/custom templates/certificate-file discovery fail rather than silently diverging between services. The smoke suite attempts writes in both services. Packaged upstream templates continue to work; database-stored signing certificates remain supported. There is no shared mutable volume.
- Do not enable application icons/user-uploaded media, filesystem reports, custom email templates, certificate-directory discovery or features that need them. Upload UI may still be visible, but writes are denied. Adding S3 storage or building matching immutable templates into both containers is a separate contract requiring a coordinated backup and qualification; not a toggle advertised as tested here.
- Database connections use Railway private networking with `sslmode=disable`; this is NOT end-to-end encrypted database transport or a compliance claim. Database/worker have no public domain or TCP proxy. Railway terminates public HTTPS; container TLS listens on loopback only. Validate proxy headers and cookies under your actual HTTPS domain before use.

## Run locally

Prerequisites: Linux Docker with Compose v2, Node.js 24, npm, Python 3, OpenSSL, coreutils `timeout`; sufficient RAM/disk for upstream images. This repository adds no Python dependencies: the wrapper uses upstream image-pinned psycopg/Django and Python standard library. The authoring SDK is exactly `railway@3.6.0` with an npm integrity lock.

```bash
npm ci --ignore-scripts
bash scripts/verify.sh
bash scripts/smoke.sh
```

Smoke uses a unique project/image and fresh database, binds **only `127.0.0.1:18423`**, refuses to start if occupied, has bounded waits, and removes only its own resources. It generates credentials in process environment, never writes `.env`, and redacts captured logs. Build logs, test signals and metrics are ignored under `.artifacts/`; the SQL dump is removed on exit. Do not publish artifacts. A failed/blocked smoke exits nonzero; `verify.sh` is explicitly an offline structural test, not a substitute for runtime validation.

For an intentional persistent local evaluation, generate four independent values using `openssl rand -hex 32`, populate a private copy of `.env.example`, change the email, and run `docker compose -p your-unique-local-project up --build -d`. Keep that project separate from smoke and manage its backup/lifecycle yourself. The fixed loopback port is the only host binding. Never commit `.env`, logs, database dumps or credentials.

## Railway source and deployment

1. Publish/sanitize this **directory** into your own existing source repository with a verified `release-v1` branch. No repository or published template identifier is invented in this recipe. A standalone distribution must keep every upstream link in its README.
2. Set the authoring inputs below and run the offline evaluator and local draft tools. Both Server and Worker must use the same exact repository, branch and root directory. If using a standalone repository, set root to `/`.
3. Separately, with explicit authorization, import the reviewed graph into Railway. This implementation does **not** run cloud CLI commands, provisioning, paid resources, remote draft mutation or publication. The graph provisions one Postgres volume and only a Server domain.
4. Before first startup replace the generated-email placeholder with your intended administrator email. Retrieve the generated Worker password/token securely, sign in as `akadmin`, configure a stable external HTTPS identity URL and recovery plan, require MFA as appropriate, and rotate the password through authentik.
5. After confirming normal administrator access and persisted bootstrap completion, revoke `authentik-bootstrap-token` in authentik. Do not treat deleting the environment variable as revocation. Keep required worker bootstrap variables stable for empty-database disaster recovery; keep the old privileged token out of operational clients. After revocation an empty new database would create that bootstrap token again: rotate bootstrap input before a deliberately fresh install.
6. Configure OIDC/SAML clients explicitly (redirect allowlists, claims, signing, consent, logout and access policies), then complete real HTTPS/SMTP/OIDC/SAML/MFA and restore checks. No provider/client or open enrollment policy is automatically created for production.

```bash
export SOURCE_REPO=your-owner/your-existing-repository
export SOURCE_BRANCH=release-v1
export SOURCE_ROOT_DIR=/authentik-oidc-broker
node scripts/evaluate.mjs
node_modules/.bin/railway-iac-ts .railway/railway.ts
```

These commands evaluate source locally; the source string is not verified against GitHub until your separately authorized publication stage. `railway@3.6.0` is deliberately pinned for its offline evaluator; 3.12.0 changes the official runner to require a newer CLI. See `PUBLISHING.md` for publication blockers and local-only restoration. The `offline-fixture/*` value used only by tests is explicitly NOT a usable deployment source.

## Environment variables

### Operator inputs

| Variable | Required / default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Required locally; generated 48-character expression in Railway `Postgres.POSTGRES_PASSWORD` | Dedicated database credential. Never use a checked-in example value. |
| `AUTHENTIK_SECRET_KEY` | Required locally, minimum 32 chars; generated 64 chars once on Worker | Signing/encryption secret; Server references Worker. Preserve with SQL backups. |
| `AUTHENTIK_BOOTSTRAP_PASSWORD` | Required on Worker, minimum 32 chars; generated 48 chars | Initial `akadmin` password only. Not rotation. |
| `AUTHENTIK_BOOTSTRAP_TOKEN` | Required on Worker, minimum 32 chars; generated 64 chars | Initial privileged API credential; revoke after setup. Not needed for a completed gate. |
| `AUTHENTIK_BOOTSTRAP_EMAIL` | Worker, default `admin@example.invalid` | Change before first bootstrap to an administrator-owned email. No SMTP delivery is promised. |
| `SOURCE_REPO` | Required for IaC/draft tooling; no default | Existing `owner/repository` containing this recipe. |
| `SOURCE_BRANCH` | Authoring default `release-v1` | Exact slash-free source channel/tag, shared by Server and Worker. |
| `SOURCE_ROOT_DIR` | Authoring default `/authentik-oidc-broker` | Absolute repository-relative root; `/` for standalone distribution. |

Railway uses `VariableConfig.generator: secret(length, "alphabet")` for production generation, serialized in the template draft as `${{secret(...)}}`. Audits require these expressions and stable cross-service references, not evaluated literal credentials. **Never use `ctx.randomString` for credentials**: inspected SDKs hash a public environment/label string deterministically. Generator execution/stability on Railway remains a remote qualification gate; offline tests prove the expressions survive authoring/restoration without substitution.

### Graph/runtime contract (do not override casually)

| Variables | Default / role |
| --- | --- |
| `PORT` | Postgres 5432, Worker readiness 9301, Server 9000; authoring/networking metadata, not an upstream authentik port switch. |
| `POSTGRES_DB`, `POSTGRES_USER` | `authentik`, Postgres only; app services reference them. |
| `PGDATA` | `/var/lib/postgresql/data/pgdata`, Postgres durable mount. |
| `AUTHENTIK_POSTGRESQL__HOST` | Compose `postgres`; Railway `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}`. |
| `AUTHENTIK_POSTGRESQL__PORT` | `5432`. |
| `AUTHENTIK_POSTGRESQL__NAME`, `AUTHENTIK_POSTGRESQL__USER` | Compose `authentik`; Railway references Postgres DB/user. |
| `AUTHENTIK_POSTGRESQL__PASSWORD` | Compose `POSTGRES_PASSWORD`; Railway `${{Postgres.POSTGRES_PASSWORD}}`. |
| `AUTHENTIK_POSTGRESQL__SSLMODE` | `disable` on private network; add and verify TLS separately if required. |
| `AUTHENTIK_LISTEN__HTTP` | Compose `0.0.0.0:9000`; Railway `[::]:9000` for private IPv6. |
| `AUTHENTIK_LISTEN__HTTPS` | `127.0.0.1:9443`, loopback only; empty value is invalid for this pin. Never publish 9443. |
| `AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS` | Compose `127.0.0.0/8`; Railway loopback IPv4/IPv6 and `100.64.0.0/10`; verify the actual edge forwarding chain before production. |
| `AUTHENTIK_OUTPOSTS__DISCOVER` | Must be `false`; wrapper rejects other values. |
| `AUTHENTIK_OUTPOSTS__DISABLE_EMBEDDED_OUTPOST` | Must be `true`; wrapper rejects other values. |
| `AUTHENTIK_DISABLE_STARTUP_ANALYTICS`, `AUTHENTIK_DISABLE_UPDATE_CHECK` | `true`; updates are reviewed pins, not automated tags. |
| `AUTHENTIK_ERROR_REPORTING__ENABLED` | `false`. |
| `RECIPE_BOOTSTRAP_TIMEOUT` | `600` seconds; permitted 30–1800; bounded gate wait. |
| `RECIPE_IMAGE` | Local Compose image tag only; smoke supplies an isolated unique tag. |
| `DOCKER_BUILDKIT` | Smoke sets `0` for this environment's supported legacy builder; does not change Railway's Dockerfile contract. |

No unrelated host variables are implicitly sent to containers. SMTP is deliberately not configured. If required, set and review the upstream `AUTHENTIK_EMAIL__HOST`, `__PORT`, `__USERNAME`, `__PASSWORD`, `__FROM`, `__USE_TLS` and `__USE_SSL` consistently on both services and validate a real delivery/recovery flow. Avoid STARTTLS/SSL contradictions and never paste mail credentials into source. Railway outbound SMTP plan restrictions and sender/provider configuration must be reviewed at that time; HTTPS mail integrations are not invented here.

## Operating boundary

Keep one replica per service and budget initial capacity around **2 GiB per app service plus 1 GiB for PostgreSQL**; measure your workload rather than treating this as an SLA. Runtime migration/startup can temporarily use more memory. There is no HA, autoscaling, failover, TLS database configuration, external SMTP, shared object storage or tested enterprise feature. Monitor Server `/-/health/ready/`, private Worker `/health/ready`, worker task failures, volume growth, database backups and token/certificate expiry.

Read `SUPPORT.md`, `UPGRADE.md`, `LICENSE_REVIEW.md` and `FINDINGS.md` before production use. The core has MIT terms, but **the entire server image is not described as MIT-only**: enterprise and third-party components have separate terms. Full artifact inventory/license review and every real federation/security gate remain publication blockers.
