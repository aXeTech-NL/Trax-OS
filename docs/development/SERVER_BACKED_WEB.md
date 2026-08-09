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
- Database-aware readiness and capability discovery.
- English/Dutch registration, sign-in, session restoration and sign-out UI.
- HTTP Journey repository with CSRF, optimistic versions and canonical reload after mutation.
- Clearing browser data removes only disposable session/locale/app cache; sign-in reconstructs authorised Journey state.

Email verification, password reset, MFA, invitations, additional workspaces, session/device administration, change sets/undo, retention tombstones and native sync are not implemented yet and are not claimed.

## Development

```bash
make db-up
make db-migrate
make check
```

The Phase 1 Compose evaluation packages the same connected application behind one web origin:

```bash
make compose-up
make compose-smoke
```

The unprivileged web container serves the built PWA and proxies `/api` and `/health` to the internal API; it does not add browser-local authority or a second persistence path. The synthetic smoke proves registration, CSRF and Journey table access after the one-shot migration. See [`COMPOSE_EVALUATION.md`](COMPOSE_EVALUATION.md).

`TRAX_DATABASE_URL` selects the authoritative PostgreSQL database for host-run commands; `TRAX_COMPOSE_DATABASE_URL` selects it on the Compose network. Production deployments must set `TRAX_SESSION_COOKIE_SECURE=true`, provide TLS and use managed secrets rather than the development credentials in `.env.example`.

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

Every lookup is scoped to the Personal workspace derived from the current server session. PostgreSQL RLS adds defence in depth through a transaction-local `trax.user_id` setting.

## Migration and tests

Alembic revision `0001_server_backed_web` creates the complete baseline from an empty PostgreSQL database. Integration tests exercise authentication, password/session handling, CSRF, workspace isolation, Journey/version validation, typed segments, packing bounds, logout and privacy-neutral lookup behaviour against PostgreSQL. The CI job boots PostGIS, applies migrations and then runs the full checks.
