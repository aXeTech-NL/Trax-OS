# `@trax-os/api-contract`

This package contains generated projections of the Trax OS public HTTP contract. See [ADR-002](../../docs/architecture/decisions/ADR-002-CONTRACT-AUTHORITY.md).

## Ownership

| Concern                                                               | Owner                                             |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| Payload validation and serialization                                  | Pydantic wire models in `apps/api/src/trax_api`   |
| HTTP paths, methods, statuses, headers and model binding              | FastAPI path-operation declarations               |
| OpenAPI, TypeScript declarations and runtime fixtures                 | `scripts/contracts.mjs`                           |
| Generated operation/runtime-schema projection and validated transport | `scripts/contracts.mjs` and `@trax-os/api-client` |
| Wire-to-domain mapping                                                | Each TypeScript web adapter                       |

Generated files are committed for review and must never be edited by hand:

- `generated/openapi.json` — language-neutral OpenAPI 3.1 publication artifact;
- `generated/schema.ts` — static TypeScript declarations; not a runtime validator;
- `generated/runtime-fixtures.json` — privacy-neutral instance responses produced by real FastAPI routes for conformance tests.

This package remains projection-only. The separate [`@trax-os/api-client`](../api-client/README.md) consumes its public types and owns the generated/maintained same-origin runtime client selected by [ADR-017](../../docs/architecture/decisions/ADR-017-VERSIONED-RUNTIME-CLIENT.md).

## Contributor workflow

After changing a public Pydantic model or FastAPI route declaration:

```bash
make generate
make contract-check
```

`make contract-check` generates contract and API-client artifacts twice, requires byte-identical results, compares them with committed files, and runs compatibility plus fail-closed client-generator fixtures.

To compare a candidate with a trusted base contract locally:

```bash
git show origin/main:packages/api-contract/generated/openapi.json > /tmp/trax-base-openapi.json
git show origin/main:packages/api-contract/generated/runtime-fixtures.json > /tmp/trax-base-runtime-fixtures.json
make contract-compat \
  BASE_CONTRACT=/tmp/trax-base-openapi.json \
  BASE_RUNTIME_FIXTURES=/tmp/trax-base-runtime-fixtures.json
```

CI materializes the contract from the pull request's base SHA (or the prior `main` revision) and runs the same compatibility command; manual runs require an explicit trusted commit SHA. External or dangling references and breaking or unclassified differences fail closed. The only encoded legacy exception requires the complete, exact session-cookie/CSRF metadata correction recorded by ADR-002; partial or subsequent security changes still fail. Do not replace the trusted Git baseline with another file edited in the same change.

Intentional breaking V1 changes require an approved versioning and migration decision; regenerating files is not a compatibility waiver.
