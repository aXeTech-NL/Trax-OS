# v0.1 development foundation

**Version:** 0.1.0
**Status:** executable foundation extended by an authenticated server-backed Personal API; not a production deployment

## Repository boundaries

The v0.1 implementation contains only components with executable or checkable value:

- `apps/api`: FastAPI/Pydantic application and focused tests;
- `apps/web`: URL-routed React client with an injected repository boundary;
- `packages/api-contract`: reviewed generated OpenAPI and TypeScript contracts;
- `compose.yaml`: PostgreSQL/PostGIS plus the migration, API and built web services used by the Phase 1 evaluation stack.

The current feature baseline adds explicit identity/session, Personal workspace, Journey, timeline and packing tables and migrations described in [`SERVER_BACKED_WEB.md`](SERVER_BACKED_WEB.md). Synchronisation, email verification/reset, MFA, document cryptography, Atlas/MCP business flows, native clients and deployment remain absent. The earlier IndexedDB implementation is a superseded prototype only.

## Provisional tool choices

npm 10 workspaces are used because npm is present in the supported local environment. `make` is the stable developer interface where practical, so a later package-manager decision does not need to rename common workflows. Issue #12 now freezes the three active roots, sole `apps/web → packages/api-contract` edge, public generated-package exports and honest current Python/TypeScript layers in the [module and package boundary registry](../architecture/MODULE_AND_PACKAGE_BOUNDARIES.md). Target native, worker, MCP, Atlas and shared-domain paths remain inactive reservations rather than empty scaffolding.

[ADR-002](../architecture/decisions/ADR-002-CONTRACT-AUTHORITY.md) accepts public Pydantic wire models plus FastAPI path-operation declarations as the V1 HTTP contract's canonical authored source. `make generate` serialises FastAPI OpenAPI with stable formatting, creates immutable TypeScript declarations with `openapi-typescript`, and produces privacy-neutral runtime fixtures from real instance routes. The generated package owns projections only; it is not a runtime client or a second editable authority.

`make check` generates all contract artifacts twice in independent temporary directories, requires byte-identical results and checks the committed copies without modifying the worktree. Compatibility-policy fixtures prove representative additive and breaking classifications. It also runs `boundaries:check`, which exercises allowed/forbidden synthetic graphs and scans the real TypeScript/JavaScript and Python import trees. CI separately compares the candidate OpenAPI document with the trusted base Git revision, fails closed on external references and rejects breaking or unclassified differences. Generated TypeScript is static-only; transport adapters continue to validate untrusted JSON explicitly.

## Runtime shape

The API exposes:

- `/health/live`: process liveness;
- `/health/ready`: readiness of dependencies actually implemented in v0.1;
- `/api/v1/version`: application and public API versions;
- `/api/v1/capabilities`: explicit capability discovery.

Every response passes through request-ID middleware. A syntactically safe incoming `X-Request-ID` is preserved; otherwise a new opaque ID is returned. Expected and unexpected failures use the stable `error.code`, `error.message`, `error.details` and `error.request_id` envelope. The generic handler does not expose exception detail.

The API now provides authenticated server-authoritative Journey/timeline/packing contracts. The connected web composition uses authenticated HTTP auth/Journey adapters and reloads canonical server state after mutations; no IndexedDB Journey authority remains. Components remain URL-addressable and tests use in-memory adapters where appropriate. Explicit per-command client methods will replace the current diff-based save adapter before compound workflows expand.

The digest-pinned Compose evaluation images package the existing application without adding a second business path. A one-shot Alembic service must complete before the API can become ready; an unprivileged static web service serves the built PWA and proxies `/api` and `/health` to the internal API. API and web runtime containers are non-root, read-only and capability-dropped. The browser-facing port remains bound to loopback.

## Database baseline

`compose.yaml` pins the development dependency to a digest of `postgis/postgis:16-3.5-alpine`, persists it in a named Docker volume and checks readiness with `pg_isready`. That digest was runtime-tested only on amd64, so Compose explicitly selects `linux/amd64` rather than claiming multi-platform validation. The explicit `trax-os-foundation` project name avoids collisions with legacy Trax Compose environments, and the published PostgreSQL port binds only to `127.0.0.1`. `.env.example` contains development-only example values. The API connects through `TRAX_DATABASE_URL`; explicit Alembic migrations create the authenticated Personal/Journey baseline and CI applies them to an empty PostGIS service.

Validate configuration with:

```bash
make compose-config
```

Start and migrate the database before host-run API development:

```bash
cp .env.example .env
make db-up
make db-migrate
```

Or build, migrate and boot the complete evaluation stack, then exercise a synthetic schema-backed flow:

```bash
make compose-up
make compose-smoke
make compose-down
```

The normal shutdown preserves the existing `postgres-data` volume. Clean CI evidence uses a unique `COMPOSE_PROJECT_NAME`, an initially empty volume and guarded destructive cleanup. See [`COMPOSE_EVALUATION.md`](COMPOSE_EVALUATION.md) for exact commands, residual synthetic-account behavior and rollback guidance.

## Deferred decisions

Explicit approval is still required for production deployment, expanded access roles, email delivery/recovery, PowerSync, document cryptography, Atlas/MCP and remaining ADR-controlled contracts. The Compose stack is loopback-only development/self-host evaluation and does not supply TLS, production secrets, backups or upgrade guarantees. Web is connected-only. The canonical encrypted native runtime, command/change authority, export/import and self-hosted pairing semantics remain requirements for Android and macOS local-only clients.
