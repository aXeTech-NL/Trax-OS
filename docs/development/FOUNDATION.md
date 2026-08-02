# v0.1 development foundation

**Version:** 0.1.0
**Status:** executable foundation, not a production deployment

## Repository boundaries

The v0.1 implementation contains only components with executable or checkable value:

- `apps/api`: FastAPI/Pydantic application and focused tests;
- `apps/web`: URL-routed React client with an injected repository boundary;
- `packages/api-contract`: reviewed generated OpenAPI and TypeScript contracts;
- `compose.yaml`: PostgreSQL/PostGIS development dependency only.

No domain tables, migrations, identity/access implementation, synchronisation runtime, document cryptography, Atlas/MCP business flows, mobile/desktop placeholders or deployment configuration are implied by this foundation.

## Provisional tool choices

npm 10 workspaces are used because npm is present in the supported local environment. `make` is the stable developer interface where practical, so a later package-manager decision does not need to rename common workflows.

For v0.1, FastAPI/Pydantic models are the canonical wire source. `make generate` serialises FastAPI OpenAPI deterministically and uses `openapi-typescript` to create the TypeScript schema consumed by the HTTP repository. `make check` regenerates both artifacts in a temporary directory and compares bytes, so it detects missing or stale generated files without modifying the worktree.

These choices are foundations, not permanent architecture decisions. A change to contract authority, compatibility policy or workspace tooling requires owner-approved architecture documentation.

## Runtime shape

The API exposes:

- `/health/live`: process liveness;
- `/health/ready`: readiness of dependencies actually implemented in v0.1;
- `/api/v1/version`: application and public API versions;
- `/api/v1/capabilities`: explicit capability discovery.

Every response passes through request-ID middleware. A syntactically safe incoming `X-Request-ID` is preserved; otherwise a new opaque ID is returned. Expected and unexpected failures use the stable `error.code`, `error.message`, `error.details` and `error.request_id` envelope. The generic handler does not expose exception detail.

The web application obtains version and capability data through `InstanceRepository`. Only `HttpInstanceRepository` may use `fetch`; ESLint enforces this boundary for feature code. Components render distinct loading, error and success states. Foundation and About routes are URL-addressable.

## Database baseline

`compose.yaml` pins the development dependency to a digest of `postgis/postgis:16-3.5-alpine`, persists it in a named Docker volume and checks readiness with `pg_isready`. That digest was runtime-tested only on amd64, so Compose explicitly selects `linux/amd64` rather than claiming multi-platform validation. The explicit `trax-os-foundation` project name avoids collisions with legacy Trax Compose environments, and the published PostgreSQL port binds only to `127.0.0.1`. `.env.example` contains development-only example values. The API does not connect to this service yet, and no application schema or migrations are invented.

Validate configuration with:

```bash
make compose-config
```

Starting the database is optional:

```bash
cp .env.example .env
docker compose up -d database
```

## Deferred decisions

After v0.1, explicit approval is still required for production/deployment shape, domain and persistence schemas, identity and access, offline/PowerSync integration, local-only runtimes, document cryptography, Atlas/MCP business flows, and contract/workspace choices that need an ADR.
