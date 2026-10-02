# Publishing boundary and offline draft tooling

Status: **unpublished**. There is no published ID/code, verified reusable GitHub source, Railway project, paid deployment or standalone distribution. This implementation performs no remote mutation, including GraphQL, Railway API, `config apply`, CLI deploy or GitHub operations.

## Local-only tools

Install `npm ci --ignore-scripts`; set `SOURCE_REPO` to your existing source and optionally `SOURCE_BRANCH`/`SOURCE_ROOT_DIR`. The tools read only a local snapshot, the recipe graph and metadata. They do not read Railway tokens or account configuration. Use private snapshots: existing exports can contain credentials.

```bash
mkdir -p .artifacts
node scripts/offline-template.mjs fixture > .artifacts/local-fixture.json
bash scripts/audit-template.sh .artifacts/local-fixture.json
bash scripts/restore-template-draft.sh .artifacts/local-fixture.json .artifacts/restored-local.json
bash scripts/audit-template.sh .artifacts/restored-local.json
```

The fixture is synthetic and NOT a real Composer export or cloud readiness claim. Restore accepts a serialized-config object, a `serializedConfig` wrapper, or `data.template.serializedConfig`. It requires exactly Postgres/Worker/Server and one existing PostgreSQL mount key. It preserves input service identities/mount identities, replaces contradictory service contract fields and removes unwanted private-service public networking. It overwrites neither input nor an existing output; output permissions are 0600. Unsupported/malformed drafts fail nonzero. It generates no IDs or remote mutation request.

Audit requires exact sources, source roots, commands, health checks, replica counts, defaults, generated-secret **expressions**, stable references, one DB-only volume and Server-only domain. It rejects resolved/literal secret defaults. Assertion failures are redacted in the CLI, including service-name and secret-bearing diffs; a canary regression verifies stdout/stderr. Programmatic tests can inspect errors but must not receive real snapshots.

`railway@3.6.0` is pinned and locked because its `railway-iac-ts` can evaluate locally without an installed Railway CLI. 3.12.0 was investigated and its runner requires Railway CLI ≥5.42.1; it was not retained. Never substitute SDK `ctx.randomString` for production secret generators, even after an SDK update.

## Not completed / publisher-owned gates

- Establish authorized reusable source and a sanitized distribution with all main upstream README links; `release-v1`/`v1.0.0` are planned channels, not existing releases.
- Inspect full artifact/license inventory; review enterprise redistribution/use boundaries. No MIT-only whole-image claim.
- Validate local smoke; separately qualify real HTTPS, headers/cookies, SMTP/recovery, external OIDC authorization-code + PKCE + logout, SAML signing/logout, TOTP/WebAuthn enrollment/challenge/recovery and policy denial behavior.
- Prove stable generated values on an actual new deployment and redeploy, measure resource headroom and worker task behavior, review DB security/backups, and perform authorized managed-volume disaster recovery.
- Require source/build parity, code review, metadata description 45–75 chars, main product icon and every main product origin.
- Authorized parent/publisher must add this directory's metadata to root `railway-template-metadata.json`, run `scripts/sync-template-marketplace.sh` and require `scripts/audit-template-marketplace.sh` success. Those repository-wide files/scripts were deliberately not modified/run here because they can mutate cloud or exceed the delegated write scope.
- Only after all gates: follow the root playbook/versioning sequence, approve any cloud spend/publication, and record real identifiers and cleanup evidence. Local tooling here cannot mark publication complete.
