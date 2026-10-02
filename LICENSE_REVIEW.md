# License review boundary


## Owner-approved recipe license

On October 2, 2026, the code owner explicitly approved MIT for newly authored recipe, wrapper, application and test code. `LICENSE` records that narrow scope. Upstream components are not relicensed: all original notices, corresponding-source/network-use obligations, enterprise exceptions and artwork/trademark terms remain applicable. This approval resolves the authored-code license hold only; it does not close the artifact or behavioral publication gates.

Observed 2026-10-02. This is a source-boundary review, **not a completed image SBOM/legal review**. No new license is assigned to upstream binaries or this whole container.

## authentik 2026.8.3

Source commit: `e5a0d2f7572cb776eee7a3e9355937ce38973761`.

- Root license: https://github.com/goauthentik/authentik/blob/e5a0d2f7572cb776eee7a3e9355937ce38973761/LICENSE — community content outside exceptions is MIT; expressly excludes enterprise, website and third-party components from that blanket description.
- Enterprise license: https://github.com/goauthentik/authentik/blob/e5a0d2f7572cb776eee7a3e9355937ce38973761/authentik/enterprise/LICENSE — production use and redistribution/modification rights are subscription/terms-dependent; development/testing permissions are distinct. Do not advertise enterprise production rights from a community recipe.
- Enterprise terms origin: https://goauthentik.io/legal/terms — must be reviewed for the intended use by the responsible publisher; this implementation did not accept terms or purchase a subscription.
- Website has CC BY-SA 4.0 boundaries; client-side JavaScript and third-party libraries have their specified licenses. The recipe links upstream docs; it does not repackage website text/assets.
- Official image packaging includes application/enterprise directories and dependencies: https://github.com/goauthentik/authentik/blob/e5a0d2f7572cb776eee7a3e9355937ce38973761/lifecycle/container/Dockerfile . This derivative references that immutable official image, adds only the recipe wrapper, and preserves upstream contents/notices. It is NOT labelled an MIT-only artifact.

## PostgreSQL and authoring toolchain

- PostgreSQL license: https://www.postgresql.org/about/licence/ . Container packaging/Alpine dependencies have their own notices; source: https://github.com/docker-library/postgres and https://github.com/postgres/postgres . Full image dependency inventory is pending.
- `railway@3.6.0` npm package metadata declares MIT; primary tarball https://registry.npmjs.org/railway/-/railway-3.6.0.tgz and source origin https://github.com/railwayapp/railway-ts-sdk . It is a pinned **development-only** authoring dependency, not copied into the deployment image; npm integrity locks transitive dependencies. Inspect all dependency licenses before distribution.
- Wrapper runtime libraries come from the immutable authentik image, not a floating `pip install`; inspect upstream `uv.lock` and image dependencies as part of release qualification.

## Remaining legal/publication gates

Inventory the pinned image and dependency notices/SBOM; verify community-only production feature use and redistribution terms for the exact derivative distribution. Review enterprise and third-party clauses with the responsible organization. No enterprise entitlement, commercial support contract, trademark endorsement, patent clearance or compliance classification is claimed. Publication remains blocked until that review and the separate behavioral gates pass.
