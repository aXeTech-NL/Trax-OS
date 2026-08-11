# Authenticated server-backed web baseline

**Status:** Backend and authenticated web adapter integrated

The web application is never an authoritative browser-local product. Web users authenticate against the self-hosted API and PostgreSQL remains authoritative. Browser caches, when introduced, must be disposable and fully reconstructable after sign-in.

## Implemented API baseline

- Email/password registration and login.
- Argon2id password hashes.
- Opaque random session cookies; only SHA-256 token hashes are stored.
- HttpOnly, SameSite=Lax session cookie plus double-submit CSRF cookie/header.
- Session introspection and revoking logout.
- Atomic registration, Personal workspace and OWNER membership creation.
- Server-derived Personal workspace context; clients cannot submit actor/workspace authority.
- Server-authoritative Journey, stay/move timeline and packing CRUD.
- Optimistic record versions and privacy-neutral not-found responses.
- PostgreSQL constraints, cascades and RLS policies for Journey-owned records.
- Database-aware readiness, capability discovery and stable `/api/contract` API/command range bootstrap.
- English/Dutch registration, sign-in, session restoration and sign-out UI.
- One shared validated same-origin API client for auth/instance/Journey adapters, with cached exact `1..1` negotiation, CSRF metadata and canonical reload after mutation.
- Clearing browser data removes only disposable session/locale/app cache; sign-in reconstructs authorised Journey state.

Only Journey update has the production command/UoW skeleton: the web uses the negotiated typed `journey.update@1` route with a fresh command UUID, and the retained `PUT` route shares the same executor, locked expected-version CAS, scoped idempotency receipt and atomic change set/event. Legacy compatibility means the existing request and successful-response wire shape; authorization is deliberately corrected so every Journey, segment and packing mutation shares `journey.write` and only OWNER/EDITOR may write. Other mutations, generic undo execution and full change-history UX are not canonical yet. Email verification, password reset, MFA, invitations, additional workspaces, session/device administration, retention tombstones and native sync are not implemented and are not claimed.

## Development

```bash
make db-up
make db-migrate
make check
```

For a retained development volume created before the database-role split, do not delete data or run the full stack first. Follow the one-time `make db-upgrade-development-roles` procedure in [`FOUNDATION.md`](FOUNDATION.md#database-baseline) with caller-supplied current administrator credentials, then migrate.

The Phase 1 Compose evaluation packages the same connected application behind one web origin:

```bash
make compose-up
make compose-smoke
```

The unprivileged web container serves the built PWA and proxies `/api` and `/health` to the internal API; it does not add browser-local authority or a second persistence path. The synthetic smoke proves registration, CSRF and Journey table access after the one-shot migration. See [`COMPOSE_EVALUATION.md`](COMPOSE_EVALUATION.md).

`TRAX_DATABASE_URL` selects the authoritative PostgreSQL database for host-run commands; `TRAX_COMPOSE_DATABASE_URL` selects it on the Compose network. Production deployments must set `TRAX_SESSION_COOKIE_SECURE=true`, provide TLS and use managed secrets rather than the development credentials in `.env.example`.

## Contract bootstrap

`GET /api/contract` is public and privacy-neutral. It advertises positive inclusive API and per-command `current`/minimum/maximum ranges sourced from canonical server constants and the immutable command registry. The official browser client currently supports exact API `1..1` and `journey.update` `1..1`, selects the highest overlap and fails before versioned traffic on malformed or disjoint metadata. This preflight is compatibility UX, not a substitute for server validation or authorization.

## Auth routes

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/session
POST /api/v1/auth/logout
```

Authenticated mutations require the `trax_session` cookie plus an `X-CSRF-Token` header matching the `trax_csrf` cookie. Authentication failures do not disclose whether an email exists.

## Domain routes

```text
/api/v1/journeys
/api/v1/journeys/{journey_id}
/api/v1/journeys/{journey_id}/segments
/api/v1/journeys/{journey_id}/segments/{segment_id}/reorder
/api/v1/journeys/{journey_id}/packing
/api/v1/journeys/{journey_id}/packing/{item_id}/progress
```

Every lookup is scoped to the Personal workspace derived from the current server session. PostgreSQL RLS adds defence in depth through transaction-local `trax.user_id` and `trax.workspace_id` settings. Runtime requests use fixed non-superuser/non-inheriting/non-`BYPASSRLS` `trax_app` without role memberships; `trax_admin` is limited to development initialization, migrations and test setup. Because the shared application login can set those GUCs, FORCE RLS protects against application scoping mistakes, not hostile arbitrary SQL using a compromised shared credential. Command receipts/change sets/events additionally bind the selected actor, while current membership permission is rechecked before receipt lookup.

The before/after Journey event contains personal travel data rather than telemetry-safe minimal metadata. The [canonical two-year Personal audit-event policy](../architecture/RETENTION_AND_DELETION.md#1-default-schedule) applies; purge/redaction enforcement, deletion behaviour, operator access and acceptance evidence remain unimplemented production gates.

## Migration and tests

Alembic revision `0001_server_backed_web` creates the baseline and forward revision `0002_canonical_command_uow` adds the bounded command state plus selected-workspace RLS and explicit `trax_app` grants. A configured local PostgreSQL run on 2026-08-11 upgraded a unique temporary database through `0001` and head, rejected an adversarial runtime-role membership transactionally, inspected catalogs/grants/policies/function security, preserved seeded data through downgrade, re-upgraded and passed Alembic drift checking. The same run passed all 68 API tests at 92.05% coverage. This is mutable local evidence until reproduced by immutable CI/review. Integration tests cover authentication, CSRF, workspace/privacy-neutral behavior, all current VIEWER mutation denials and the bounded canonical Journey update, including applied and terminal receipt replay.
