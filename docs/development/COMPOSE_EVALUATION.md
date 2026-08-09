# Docker Compose evaluation stack

**Status:** Phase 1 development and self-host evaluation evidence; not a production deployment

The Compose stack proves that a clean Trax OS checkout can build locked application images, migrate an empty PostgreSQL/PostGIS database, boot the API and built web client, and complete same-origin smoke requests without fixtures or development seeds.

## Supported evaluation environment

- Docker Engine with Docker Compose v2 (`service_completed_successfully` and `up --wait` support)
- Linux/amd64 for the complete stack
- A clean checkout when collecting reproducibility evidence

The API and web base images are digest-pinned and multi-platform, but the current PostGIS digest has only been runtime-validated as `linux/amd64`. Do not infer ARM support from the application images.

## Configuration

Copy the development example before changing local values:

```bash
cp .env.example .env
```

`make` uses `.env` when it exists and otherwise uses `.env.example`. Set `COMPOSE_ENV_FILE=/path/to/file` to select another file explicitly. The example contains development-only credentials and disables secure cookies for loopback HTTP.

The container network uses `TRAX_COMPOSE_DATABASE_URL`, whose hostname is `database`. Host-run API, test and migration commands use `TRAX_DATABASE_URL`, whose hostname is `127.0.0.1`. If credentials change while creating an empty volume, update both URLs and URL-encode credentials where required.

PostgreSQL applies `POSTGRES_USER`, `POSTGRES_DB` and `POSTGRES_PASSWORD` only when it initializes an empty volume. Editing those values does not rotate credentials or rename objects in an existing database. For a development password rotation, connect with the current credentials, run interactive `\password <role>` in `psql`, and only then update `POSTGRES_PASSWORD` plus both URLs. Do not recreate a persistent volume as a credential-rotation shortcut.

The database and web ports bind to `127.0.0.1` only. Override non-secret evaluation settings through the environment when parallel checkouts need isolation:

```bash
export COMPOSE_PROJECT_NAME=trax-os-evaluation
export POSTGRES_PORT=55432
export TRAX_WEB_PORT=18080
make compose-up
make compose-smoke
```

Keep those variables exported for every lifecycle command targeting that stack. A distinct `COMPOSE_PROJECT_NAME` creates a distinct network and PostgreSQL volume. It is required for clean CI evidence and recommended for parallel worktrees.

## Build, boot and smoke

```bash
make compose-config
make compose-build
make compose-up
make compose-smoke
```

Startup order is enforced as:

```text
database healthy → migration exits successfully → API ready → web ready
```

The smoke runs from a container through the browser-facing web origin. It checks the static root and a deep link, proxied liveness/readiness/version/capabilities, privacy-neutral unauthenticated errors, registration, CSRF rejection, an initially empty workspace, and a synthetic Journey create/query/delete round trip. It uses a random address below the reserved `.example` domain and never prints credentials, cookies, user IDs or Journey IDs. CI additionally launches the built client in Chrome through the Compose origin, verifies the server-backed sign-in screen, installs the service worker and rechecks the honest reconnect shell offline.

After a successful smoke, the Journey is removed and the session is revoked. A failed smoke makes a best effort to clean up, but interrupted connectivity can leave the Journey or session as well. The current API has no account-deletion endpoint, so a privacy-neutral synthetic user/workspace always remains when smoke runs against a persistent local volume. Use a dedicated disposable Compose project when residue is undesirable.

## Inspect and stop

```bash
make compose-ps
make compose-logs
make compose-down
```

`make compose-down` removes containers and the network but preserves the `postgres-data` volume. Re-running `make compose-up` applies the immutable Alembic revisions again safely and retains existing data.

Deleting the volume is intentionally guarded and destructive:

```bash
CONFIRM_COMPOSE_CLEAN=1 make compose-clean
```

Run that only for a disposable evaluation project. It permanently deletes that project's PostgreSQL data. It is not an application rollback procedure.

## Security and production boundary

This stack is intentionally loopback-only HTTP evidence. It does not provide:

- TLS termination or public ingress;
- production secret management or credential rotation;
- registration controls, rate limiting or email verification;
- backup/restore, upgrade, high availability or disaster-recovery guarantees;
- observability, malware scanning, sync, Atlas/MCP or future worker services.

Do not expose the example stack to an untrusted network. A production deployment must provide TLS, managed secrets, `TRAX_SESSION_COOKIE_SECURE=true`, backup/restore and reviewed operational controls. Those remain in the backlog's Phase 10 production/release issues, beginning with #60. Browser web remains authenticated, connected and PostgreSQL-backed; this stack does not add browser-local authority or claim native offline behavior.

## Compatibility and rollback

The stack adds no API contract, migration or persisted-schema change. Removing the API, migration and web container definitions returns to the host-run development workflow without downgrading PostgreSQL. Normal rollback is `make compose-down` followed by the previous host-run release against the preserved volume. Never use `alembic downgrade` or volume deletion as an automatic rollback.
