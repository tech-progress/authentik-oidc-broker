# Deploy and Host authentik OIDC broker on Railway

Draft only — no deploy button or published code exists for this recipe.

## About Hosting authentik OIDC broker

Deploy [authentik](https://goauthentik.io/) ([source](https://github.com/goauthentik/authentik)) with a private worker and [PostgreSQL](https://www.postgresql.org/) ([source](https://github.com/postgres/postgres)). The Redis-free recipe waits for worker-created administrator credentials and database blueprint completion before starting the public server.

## Why Deploy authentik OIDC broker

Keep identity configuration and signing certificates in SQL, with a worker-first bootstrap barrier, generated-secret references and a documented recovery boundary. This is an unpublished single-region recipe, not a production-certified or highly available SSO offering.

## Common Use Cases

- Evaluate an OIDC identity broker with controlled administrator ownership.
- Design SAML/OIDC federation policies before staging qualification.
- Rehearse database and signing-secret recovery in an isolated local stack.

## Dependencies for authentik OIDC broker

### Deployment Dependencies

- Existing source repository/release channel with identical Server/Worker source roots.
- Private PostgreSQL 16.14 with one dedicated volume and secure backups.
- Worker bootstrap credentials, stable shared signing secret, HTTPS Server domain.
- Real mail provider for email workflows; qualified OIDC/SAML clients and MFA settings.
- Review authentik community/enterprise and third-party license terms.

No Docker socket, managed outposts, shared filesystem media, custom templates, or certificate-file discovery. Production federation, HTTPS forwarding, mail delivery and MFA require separate verification. Filesystem writes are actively denied. Draft description/icon/origins are recorded in `marketplace-metadata.json`; publication is blocked until remaining qualification gates and the repository-wide metadata sync/audit are completed by the authorized publisher.
