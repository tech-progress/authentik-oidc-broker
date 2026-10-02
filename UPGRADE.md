# Upgrades, backup and recovery

Upstream: [authentik](https://goauthentik.io/) ([release source](https://github.com/goauthentik/authentik)), [PostgreSQL](https://www.postgresql.org/).

Template `VERSION` describes the deployment contract independently of upstream versions. `1.0.0` is an unpublished initial recipe. Image tags are informational; sha256 index digests are authoritative. Do not change only one application's pin or source channel. No unattended image updates are enabled.

## Backup before every change

1. Verify a secure independent backup of `AUTHENTIK_SECRET_KEY`, DB credentials and operator recovery information. Never store secrets in Git or next to a public dump.
2. Stop Server and Worker for a coordinated maintenance snapshot; identities/tasks can mutate while services run. Back up PostgreSQL using a verified consistent dump or platform-supported snapshot. Include **all SQL schemas/tables**, including authentik certificates, tasks, migration records and `public.railway_recipe_bootstrap`.
3. Encrypt/restrict the dump, record the exact upstream digest/template version, and test a restore in a separate isolated environment with the **original signing secret**. A SQL dump without that secret is not complete identity recovery.
4. This recipe has no file volume to back up. If you extend it with media/S3/templates, you own a new coordinated storage/recovery contract and must test it separately.

## Upgrade sequence

- Read all intervening authentik release notes, supported PostgreSQL versions and migration/downgrade restrictions. Never assume arbitrary version skips are valid.
- Resolve a current verified release and immutable image digest; review changes to entrypoint, bootstrap, models, blueprint paths, API, listen settings and license boundaries. Inspect the image's pinned dependency lock/artifact inventory.
- Update Dockerfile pin, related smoke assertions and `FINDINGS.md`; update DB pin in Compose and IaC together if needed. Preserve the Railway generator/reference expressions and generated values.
- Stage with the same original key and a restored snapshot, start Worker first, run migrations, validate durable gate/server readiness and complete real OIDC/SAML/MFA/SMTP/HTTPS tests. The SQL/blueprint bootstrap assertions are intentionally version-coupled and must be re-reviewed.
- Record contract SemVer/changelog; minor/patch only for compatible contracts, major for storage/environment/shape changes. Authorized publication uses `release-v1` for this major channel and immutable `v1.0.0`-style tags; no Git operation is performed by the local tools.
- During authorized cutover, pause traffic, take a fresh backup, use identical verified source revisions, start Worker then Server, monitor tasks/authentication failures and restore availability before resuming users.

## Recovery and rollback

Never roll an older application image onto a newer migrated SQL schema. Stop both app services, restore the full known-good SQL backup and original signing secret, restore matching image pins and then start Worker/Server. PostgreSQL **major** changes require supported dump/restore or an upstream-reviewed migration; never reuse an incompatible data volume.

The durable gate survives SQL dump/restore and token revocation. It does not demand the original bootstrap token/password after completion. On a genuinely empty database the generated first-boot credentials apply again; that is a new installation, not recovery. Do not delete/re-create the gate to force adoption of an existing database.

`scripts/smoke.sh` rehearses local dump/drop/re-create/restore with a fresh owned Compose DB and restarts after bootstrap-token revocation. This does not prove Railway snapshot recovery, outage duration, external relying-party behavior or secret/key rotation. Those remain operator qualification gates.
