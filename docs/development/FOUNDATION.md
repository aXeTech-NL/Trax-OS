# v0.1 development foundation

**Version:** 0.1.0
**Status:** executable foundation extended by an authenticated server-backed Personal API; not a production deployment

## Repository boundaries

The v0.1 implementation contains only components with executable or checkable value:

- `apps/api`: FastAPI/Pydantic application and focused tests;
- `apps/web`: URL-routed React client with an injected repository boundary;
- `packages/api-contract`: reviewed generated OpenAPI and TypeScript contracts;
- `compose.yaml`: PostgreSQL/PostGIS development dependency only.

The current feature baseline adds explicit identity/session, Personal workspace, Journey, timeline and packing tables and migrations described in [`SERVER_BACKED_WEB.md`](SERVER_BACKED_WEB.md). Synchronisation, email verification/reset, MFA, document cryptography, Atlas/MCP business flows, native clients and deployment remain absent. The earlier IndexedDB implementation is a superseded prototype only.

## Provisional tool choices

npm 10 workspaces are used because npm is present in the supported local environment. `make` is the stable developer interface where practical, so a later package-manager decision does not need to rename common workflows. The workspace mechanism remains provisional pending issue #12.

[ADR-002](../architecture/decisions/ADR-002-CONTRACT-AUTHORITY.md) accepts public Pydantic wire models plus FastAPI path-operation declarations as the V1 HTTP contract's canonical authored source. `make generate` serialises FastAPI OpenAPI with stable formatting, creates immutable TypeScript declarations with `openapi-typescript`, and produces privacy-neutral runtime fixtures from real instance routes. The generated package owns projections only; it is not a runtime client or a second editable authority.

`make check` generates all contract artifacts twice in independent temporary directories, requires byte-identical results and checks the committed copies without modifying the worktree. Compatibility-policy fixtures prove representative additive and breaking classifications. CI separately compares the candidate OpenAPI document with the trusted base Git revision, fails closed on external references and rejects breaking or unclassified differences. Generated TypeScript is static-only; transport adapters continue to validate untrusted JSON explicitly.

## Runtime shape

The API exposes:

- `/health/live`: process liveness;
- `/health/ready`: readiness of dependencies actually implemented in v0.1;
- `/api/v1/version`: application and public API versions;
- `/api/v1/capabilities`: explicit capability discovery.

Every response passes through request-ID middleware. A syntactically safe incoming `X-Request-ID` is preserved; otherwise a new opaque ID is returned. Expected and unexpected failures use the stable `error.code`, `error.message`, `error.details` and `error.request_id` envelope. The generic handler does not expose exception detail.

The API now provides authenticated server-authoritative Journey/timeline/packing contracts. The production web composition uses authenticated HTTP auth/Journey adapters and reloads canonical server state after mutations; no IndexedDB Journey authority remains. Components remain URL-addressable and tests use in-memory adapters where appropriate. Explicit per-command client methods will replace the current diff-based save adapter before compound workflows expand.

## Database baseline

`compose.yaml` pins the development dependency to a digest of `postgis/postgis:16-3.5-alpine`, persists it in a named Docker volume and checks readiness with `pg_isready`. That digest was runtime-tested only on amd64, so Compose explicitly selects `linux/amd64` rather than claiming multi-platform validation. The explicit `trax-os-foundation` project name avoids collisions with legacy Trax Compose environments, and the published PostgreSQL port binds only to `127.0.0.1`. `.env.example` contains development-only example values. The API connects through `TRAX_DATABASE_URL`; explicit Alembic migrations create the authenticated Personal/Journey baseline and CI applies them to an empty PostGIS service.

Validate configuration with:

```bash
make compose-config
```

Start and migrate the database before API development:

```bash
cp .env.example .env
make db-up
make db-migrate
```

## Deferred decisions

Explicit approval is still required for production deployment, expanded access roles, email delivery/recovery, PowerSync, document cryptography, Atlas/MCP and remaining ADR-controlled contracts. Web is connected-only. The canonical encrypted native runtime, command/change authority, export/import and self-hosted pairing semantics remain requirements for Android and macOS local-only clients.
