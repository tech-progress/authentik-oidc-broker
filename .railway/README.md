# Offline IaC authoring

Main products: [authentik](https://goauthentik.io/), [source](https://github.com/goauthentik/authentik), and [PostgreSQL](https://www.postgresql.org/).

Run `npm ci --ignore-scripts` in the template directory. Set `SOURCE_REPO=owner/existing-repository`, `SOURCE_BRANCH=release-v1`, and `SOURCE_ROOT_DIR=/authentik-oidc-broker` (use `/` for a standalone distribution).

`node_modules/.bin/railway-iac-ts .railway/railway.ts` evaluates locally; no account, CLI, API, or cloud access is needed. The repository is deliberately required: no placeholder deployment source is invented. Both services use identical source and release channel.

Secrets use Railway `VariableConfig.generator` expressions, never `ctx.randomString`. Inspect the generated graph and offline restored draft with `scripts/audit-template.sh`. Only Server has a domain; Worker and Postgres remain private. Worker readiness runs on port 9301; the upstream worker's 9000 listener is private. Railway supplies domain TLS. The template does not run `railway config plan/apply`, which can access remote state.

This is a local recipe, not a published template. The worker starts before the server **at the application barrier**, independent of platform scheduling; no Railway dependency ordering is assumed.
