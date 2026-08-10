# Issue #8 PowerSync feasibility spike

**Status:** disposable Phase 0 candidate evidence; committed M2 scoped download/revocation plus experimental M3a command-upload mechanics

This sibling harness exercises the real self-hosted PowerSync service and the official Node client against a spike-only PostgreSQL model. It does not import Trax OS production code or establish a production sync architecture.

## What this harness checks

- The token issuer authenticates four simulated principals with distinct, cryptographically random per-run credentials. Query parameters cannot select identity or scope, and Alice cannot obtain Eve or Casey credentials.
- PowerSync returns 401 for expired, wrong-audience and deterministically tampered-signature JWT fixtures. The tampered signature produces `PSYNC_S2101` with `signature verification failed`; a local `jose` control independently proves the changed signature bytes cannot verify.
- Sync Streams derive access from `auth.user_id()` plus a spike-only server-maintained projection of active user, workspace membership, Journey membership and exact party membership rows. The projection makes every contributing relationship explicit for this harness and is not a production schema proposal.
- Alice, Bob, Casey and Eve each use a fresh on-disk SQLite replica.
- Two Journeys in workspace one prove that workspace access alone cannot expose a foreign Journey. Exact Journey-shared and party-private rows are asserted by UUID and unique payload marker.
- Online revocation at user, workspace, Journey and party level purges descendant data. Each level is checked in an existing replica and a fresh replica reusing the pre-revocation JWT.
- Casey's alpha-party revocation preserves Journey-shared and bravo-party data, while Alice's independent alpha grant remains.
- An SDK-tracked, insert-only `command_queue` uploads only strict experimental update and soft-delete commands through a separately hardened loopback command server. Replicated `resources` remain read-only to the normal harness flow.
- The experimental server derives actor and current workspace/Journey/party scope from the JWT and PostgreSQL, serializes grant evaluation against relationship revocation, commits mutation/receipt/change event atomically, reauthorizes every retry before receipt lookup, records digest-bound denial receipts, rejects changed idempotency payloads, and retains bounded logical tombstones.
- The harness observes local overlay state while an injected pre-commit failure remains queued, overlay removal after terminal results, later unrelated progress, canonical convergence, post-commit response-drop retry, competing optimistic outcomes and stale-resurrection rejection. Local result persistence and SDK queue completion are separate SQLite transactions; server receipts make interruption retry-safe, but the harness does not claim local atomicity.

The M3a endpoint, envelope, tables, command names and completion policy are spike-only facsimiles. They do not define or freeze Issue #14, implement production Issue #45, or establish Issue #46 queue/conflict behavior.

A pre-revocation JWT can authenticate until expiry, but active server relationships determine its current scope. This is not token blacklisting. Logical disappearance from a connected SQLite query is not forensic erasure, and a permanently offline or hostile endpoint cannot be remotely wiped.

## Explicit non-goals

This harness does not test production commands, create/restore/purge, tombstone expiry, capacity bounds, service restart, native clients, encryption, TLS, production RLS/policy equivalence, upgrades or rollback. It does not validate Android, Capacitor, Tauri or macOS support. Tombstones are retained only for the bounded run. The repository has selected a [`P90D` minimal-graveyard plus stale-replica-reset policy](../../docs/architecture/RETENTION_AND_DELETION.md#connected-sync-offline-support-boundary), but expiry, quarantine and reset are not implemented or tested here. The root `compose.yaml`, application schema, Alembic history and generated contracts are untouched.

## Pinned inputs

`versions.env` records immutable image indexes, linux/amd64 manifests, source commits, exact npm integrity and PowerSync service/SDK license hashes. The verifier independently resolves version tags, platform manifests and PowerSync image version/revision/license labels. PowerSync service `1.23.3` is labelled `FSL-1.1-ALv2`; legal/product acceptance remains pending.

The lockfile pins `better-sqlite3`, but its install script may download a platform prebuild or compile native code outside npm lockfile checksums. The executed native binary is therefore **not independently provenance-validated** by this slice.

## Requirements

- Linux x86_64 for the currently recorded runtime evidence
- Node.js 22
- `npx` able to execute exact npm `10.9.4`
- Docker Engine, Docker Compose and Docker Buildx
- Git, curl, Bash, and either `sha256sum` or `shasum`
- outbound access for source/registry verification and the first image/package pull
- free loopback ports 15432, 16060, 17070 and 18080, or explicit `PS8_*_PORT` overrides

The scripts fail rather than reuse an occupied port or an existing Compose project.

## Run

From the repository root:

```bash
spikes/powersync/scripts/verify-provenance.sh
spikes/powersync/scripts/run.sh
```

`run.sh` generates a UUID run identity, distinct per-principal credentials, an ownership marker and a unique Compose project. It enforces Node 22/npm 10.9.4, performs locked installation, compilation, unit tests, Compose validation, digest-pinned pulls, readiness-gated startup and the real M2/M3a integration tests. Initial sync requires a completed checkpoint; timeouts reject and close the partial replica.

Runtime evidence is retained per run under ignored `spikes/powersync/.evidence/<run-id>/`. Each successful run keeps structured assertion/token-probe observations plus a credential/JWT-sanitized TAP transcript. A successful observation is recorded as `executed-uncommitted`, not immutable `passed`, and only after guarded stack/volume cleanup succeeds. Failed-run evidence is not deleted by the next run.

`PS8_KEEP_STACK=1` retains the stack only when a run fails or is interrupted before the mandatory success-path cleanup. A successful run always removes its containers, volume and network so its cleanup-attested evidence remains truthful. For deliberate failed-run inspection, record the printed run/project identity and use those exact values for cleanup.

## Guarded cleanup of a deliberately retained stack

```bash
export PS8_RUN_ID=<exact-v4-uuid>
export COMPOSE_PROJECT_NAME=<exact-trax-ps8-project>
export PS8_OWNER_FILE="$PWD/spikes/powersync/.runtime/$PS8_RUN_ID/owner"
spikes/powersync/scripts/clean.sh
```

Cleanup requires a matching ownership marker and verifies the custom run/owner labels on every project container, volume and network before invoking `down --volumes`. A reusable name prefix alone is insufficient.

## Focused checks without a live stack

```bash
npx --yes npm@10.9.4 ci --prefix spikes/powersync/harness
npx --yes npm@10.9.4 run check --prefix spikes/powersync/harness

PS8_RUN_ID=12345678-1234-4234-8234-123456789abc \
PS8_TOKEN_CREDENTIALS_JSON='{"alice":"configuration-only-secret-000000001","bob":"configuration-only-secret-000000002","casey":"configuration-only-secret-000000003","eve":"configuration-only-secret-000000004"}' \
PS8_POST_COMMIT_FAULT_SECRET='configuration-only-fault-secret-000001' \
docker compose \
  --project-name trax-ps8-configcheck \
  --env-file spikes/powersync/versions.env \
  --env-file spikes/powersync/.env.example \
  -f spikes/powersync/compose.yaml config --quiet
```

The real integration command intentionally refuses direct execution without wrapper-bound run identity, endpoints and service metadata.

## Evidence semantics

Evidence entries use `designed`, `executed`, `executed-uncommitted`, `passed`, `failed` or `not-validated`. Execution states require an exact command, UTC time, platform and exit code. `executed-uncommitted` additionally binds the run UUID, Compose project, wrapper command, container image IDs/digests, service state, structured assertions and sanitized test transcript. Candidate identity includes a digest over the spike executable, configuration, schema and test sources; documentation and generated/runtime artifacts are explicitly outside that digest so post-run evidence writing cannot invalidate the executable attestation. It means assertions succeeded on a mutable candidate; only a committed, independently rerun artifact can become attested `passed` evidence. See [`docs/security/evidence/ISSUE_8_POWERSYNC_FEASIBILITY.md`](../../docs/security/evidence/ISSUE_8_POWERSYNC_FEASIBILITY.md).
