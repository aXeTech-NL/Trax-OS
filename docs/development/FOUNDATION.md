# v0.1 development foundation

**Version:** 0.1.0
**Status:** executable foundation extended by an authenticated server-backed Personal API; not a production deployment

## Repository boundaries

The v0.1 implementation contains only components with executable or checkable value:

- `apps/api`: FastAPI/Pydantic application and focused tests;
- `apps/web`: URL-routed React client with an injected repository boundary;
- `packages/api-contract`: reviewed generated OpenAPI and TypeScript contracts;
- `packages/api-client`: validated same-origin browser transport with generated operation/runtime-schema metadata;
- `compose.yaml`: PostgreSQL/PostGIS plus the migration, API and built web services used by the Phase 1 evaluation stack.

The current feature baseline adds explicit identity/session, Personal workspace, Journey, timeline and packing tables and migrations described in [`SERVER_BACKED_WEB.md`](SERVER_BACKED_WEB.md). Synchronisation, email verification/reset, MFA, document cryptography, Atlas/MCP business flows, native clients and deployment remain absent. The earlier IndexedDB implementation is a superseded prototype only.

## Provisional tool choices

npm 10 workspaces are used because npm is present in the supported local environment. `make` is the stable developer interface where practical, so a later package-manager decision does not need to rename common workflows. Issue #12 established the machine boundary registry; Issue #15 now activates four roots with the directed `apps/web → packages/api-client → packages/api-contract` graph, exact exports and honest Python/TypeScript layers. Target native, worker, MCP, Atlas and shared-domain paths remain inactive reservations rather than empty scaffolding.

[ADR-002](../architecture/decisions/ADR-002-CONTRACT-AUTHORITY.md) accepts public Pydantic wire models plus FastAPI path-operation declarations as the V1 HTTP contract's canonical authored source. `make generate` serialises FastAPI OpenAPI with stable formatting, creates immutable TypeScript declarations with `openapi-typescript`, and produces privacy-neutral runtime fixtures from real instance routes. The contract package owns projections only. The separate API-client package combines generated projections with maintained same-origin transport without becoming a second editable HTTP authority.

`make check` generates all contract/client artifacts twice in independent temporary directories, requires byte-identical results and checks the committed copies without modifying the worktree. Compatibility-policy and fail-closed generator fixtures prove representative additive/breaking classifications and the supported schema subset. It also runs `boundaries:check`, which exercises allowed/forbidden synthetic graphs and scans the real TypeScript/JavaScript and Python import trees. CI separately compares candidate OpenAPI with the trusted base Git revision. The runtime client centrally validates unknown transport data; adapters retain client-domain mapping.

## Runtime shape

The API exposes:

- `/health/live`: process liveness;
- `/health/ready`: readiness of dependencies actually implemented in v0.1;
- `/api/contract`: stable version-independent exact API/command support discovery;
- `/api/v1/version`: informational application and current API versions;
- `/api/v1/capabilities`: explicit capability discovery.

Every response passes through request-ID middleware. A syntactically safe incoming `X-Request-ID` is preserved; otherwise a new opaque ID is returned. Expected and unexpected failures use the stable `error.code`, `error.message`, `error.details` and `error.request_id` envelope. The generic handler does not expose exception detail.

The API now provides authenticated server-authoritative Journey/timeline/packing contracts. One shared client performs cached highest-overlap API/command negotiation, runtime request/response/error validation, same-origin credentials and OpenAPI-marked CSRF before the HTTP adapters map wire data. No IndexedDB Journey authority remains. Components remain URL-addressable and tests use in-memory adapters where appropriate. Journey update is the first production canonical command: web save now sends `journey.update@1` with a fresh command UUID, while the legacy `PUT` remains a compatibility adapter over the same executor/UoW. Other mutations remain legacy routes and canonical state is reloaded after save.

The digest-pinned Compose evaluation images package the existing application without adding a second business path. A one-shot Alembic service must complete before the API can become ready; an unprivileged static web service serves the built PWA and proxies `/api` and `/health` to the internal API. API and web runtime containers are non-root, read-only and capability-dropped. The browser-facing port remains bound to loopback.

## Database baseline

`compose.yaml` pins the development dependency to a digest of `postgis/postgis:16-3.5-alpine`, persists it in a named Docker volume and checks readiness with `pg_isready`. That digest was runtime-tested only on amd64, so Compose explicitly selects `linux/amd64` rather than claiming multi-platform validation. The explicit `trax-os-foundation` project name avoids collisions with legacy Trax Compose environments, and the published PostgreSQL port binds only to `127.0.0.1`. `.env.example` contains development-only example values. The API and application tests connect through `TRAX_DATABASE_URL` as the fixed `trax_app` login, which must remain non-superuser and non-`BYPASSRLS`; the `trax_admin` login is restricted to database initialization, Alembic and test setup through separate admin/migration URLs. Compose provisions only the development login from environment values using psql-safe identifier/literal formatting and mode-`0600` temporary password files, while production must provision distinct secrets out of band. Alembic `0002` fails closed unless `trax_app` is a login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS` and no role memberships. It grants only the current API's explicit table operations and schema usage—not DDL, role administration, sequence/default privileges, audit update/delete or membership update/delete. The authored temporary-database upgrade/downgrade/catalog test still requires a configured PostgreSQL execution before validation is claimed.

The shared `trax_app` login can itself set the transaction-local `trax.user_id` and `trax.workspace_id` GUCs. `FORCE ROW LEVEL SECURITY` therefore catches application scoping mistakes but is not a hostile-SQL security boundary after compromise of that shared credential. Command events currently contain full before/after Journey snapshots and therefore personal travel data. The [canonical two-year Personal audit-event policy](../architecture/RETENTION_AND_DELETION.md#1-default-schedule) applies; purge/redaction enforcement, deletion behaviour, operator access and acceptance evidence remain unimplemented production gates.

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

A volume initialized before the `trax_admin`/`trax_app` split must be upgraded explicitly before
`make compose-up`; normal PostgreSQL initialization does not rewrite roles in a retained volume.
Start only the database, supply the volume's actual legacy administrator credentials at invocation
time, and run the transactional development-only role upgrade:

```bash
make db-up
TRAX_LEGACY_ADMIN_USER='<current-admin>' \
TRAX_LEGACY_ADMIN_PASSWORD='<current-password>' \
make db-upgrade-development-roles
make db-migrate
```

The credentials travel to the container over stdin and are not stored in the repository or passed
as Docker arguments. The script creates or normalizes only fixed `trax_admin` and `trax_app`, fails
without revoking if `trax_app` has any membership, and performs no application-data DML or volume
deletion. Back up valuable development data first; this path is not a production role migration.

Or build, migrate and boot the complete evaluation stack, then exercise a synthetic schema-backed flow:

```bash
make compose-up
make compose-smoke
make compose-down
```

The normal shutdown preserves the existing `postgres-data` volume. Clean CI evidence uses a unique `COMPOSE_PROJECT_NAME`, an initially empty volume and guarded destructive cleanup. See [`COMPOSE_EVALUATION.md`](COMPOSE_EVALUATION.md) for exact commands, residual synthetic-account behavior and rollback guidance.

## Deferred decisions

Explicit approval is still required for production deployment, expanded access roles, email delivery/recovery, PowerSync, document cryptography, Atlas/MCP and remaining ADR-controlled contracts. The Compose stack is loopback-only development/self-host evaluation and does not supply TLS, production secrets, backups or upgrade guarantees. Web is connected-only. The canonical encrypted native runtime, broad command/change authority, export/import and self-hosted pairing semantics remain requirements for Android and macOS local-only clients. The bounded Journey-update skeleton does not satisfy those native gates.
