# Support and security boundaries

Main products: [authentik](https://goauthentik.io/) ([source/issues](https://github.com/goauthentik/authentik)), [PostgreSQL](https://www.postgresql.org/).

The recipe owns only image pins, startup barrier, service graph, storage/network defaults and local tooling. Upstream owns authentik implementation, protocols, database schema and licensing. Railway owns edge networking, build/deploy runtime, volume and plan guarantees. This is not a managed identity service, security certification or uptime commitment.

## Supported recipe shape

One Server, one private Worker and one private PostgreSQL 16 cluster; immutable matched application image; only SQL persistence; no outposts or files shared between services. Database-stored signing keys/certificates are part of the backup. No production SAML/MFA/SMTP integration is claimed just because upstream supports it.

Filesystem-dependent features fail closed: `/data`, `/templates`, `/certs` are non-writable as UID 1000. Uploaded media/custom templates/certificate-directory discovery are outside support. Remote Docker and Kubernetes service connections/outposts must never be configured. Do not add mounts that bypass this contract.

The bounded local stop grace can force-kill the upstream worker. This recipe does not claim tested graceful task draining or in-flight task retry semantics. Pause new work, confirm task completion, and coordinate maintenance before backups/upgrades. Interruption/recovery behavior remains a production qualification gate.

## Diagnose without leaking secrets

- Server never listens: check private DB resolution, worker logs/migrations, bootstrap variables and deadline. Do not bypass the gate or expose an initial-setup flow.
- Worker cannot mark completion on a restored/foreign database: do not overwrite an existing admin. The initial password/email/token must match only on a database that lacks this recipe's marker. Adopt a foreign database only through a reviewed offline migration, not by inserting a marker manually.
- Restart fails with a secret mismatch: restore the original signing key from the secure backup. Removing the marker or generating another key is NOT recovery.
- Token revocation/password rotation do not change a completed gate. Upstream first-boot environment variables are not ongoing credential reconciliation.
- Media/upload errors are intentional in this no-file-sharing contract. Do not fix by making directories writable on one service.
- Inspect task failures/readiness and matched source revisions; an HTTP response alone does not prove worker processing.

Provide template version, immutable upstream digests, source revisions, architecture, sanitized error classes and relevant log lines. Never send `.env`, cookies, JWTs, bootstrap/API tokens, DB dumps, signing keys or full exported drafts. Local CLI audit failures are redacted; ignored artifacts still require review before sharing.

For a live credential compromise, revoke sessions/tokens and rotate credentials through supported application/database procedures, contain access and restore from reviewed backups. Do not publish data while debugging. Real incidents and vulnerability reporting belong to your security process/upstream security guidance, not an unaudited template demonstration.
