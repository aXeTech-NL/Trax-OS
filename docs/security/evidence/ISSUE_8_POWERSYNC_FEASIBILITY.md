# Issue #8 PowerSync Feasibility Evidence

**Evidence status:** executed uncommitted candidate; Issue #8 remains open and not validated

**Scope:** authenticated scoped download replication and online user/workspace/Journey/party revocation only

**Production impact:** none; isolated sibling spike with synthetic data

## 1. Evidence semantics

| State                  | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `designed`             | A check and acceptance condition exist but were not executed.           |
| `executed`             | The command ran, but no pass/fail conclusion is justified.              |
| `executed-uncommitted` | Assertions succeeded on a mutable candidate; this is not attested PASS. |
| `passed`               | A commit-bound, independently repeatable check met its assertions.      |
| `failed`               | The exact bounded check ran and violated an assertion.                  |
| `not-validated`        | Required evidence is absent, unsupported or outside this slice.         |

A successful spike observation is not proof of production architecture, native security or complete Issue #8 acceptance. No `docs/security/phase-0-threat-model.json` status or `EV-SYNC-PLANNED` record is promoted by this document.

## 2. Pinned provenance

Verified from official tagged source, Docker Registry metadata and npm registry metadata on 2026-08-09:

| Artifact                | Selected immutable input                                                                                  | Verification                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PowerSync service       | `1.23.3`, tag `v1.23.3`, commit `6aab57d2602514bf090077a465a0e6a60a28749b`                                | tag resolves to image index `sha256:b6b22fa7d0d862f04bdff62846e656756d17bcf3dd6eca399a0633671051438b`; linux/amd64 manifest `sha256:087fec7b6c5de4f865f9cd0c5328ade7ba9ab13dc082074fc8e4ac1b15816790`; version/revision/license labels match |
| PowerSync Node SDK      | `@powersync/node@0.20.2`, tag `@powersync/node@0.20.2`, commit `d78287483ad1a5d651b6e8c38542efbd62963beb` | npm version/integrity/license metadata plus source tag and Apache-2.0 license hash                                                                                                                                                           |
| PostgreSQL              | `16.10-alpine`                                                                                            | tag resolves to image index `sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297`; linux/amd64 manifest `sha256:ab8380566c3ea09690a9ecaa85a59d82bfc6eb86744151a2a54335866c83a3e9`                                        |
| Token-server Node image | `22.23.1-bookworm-slim`                                                                                   | tag resolves to image index `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`; linux/amd64 manifest `sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27`                                        |

The PowerSync service source and image declare **FSL-1.1-ALv2**, not Apache-2.0 at release time. Source-license SHA-256 is `992fe40fdb672099ceab1f2e97f26af4642a12bd65f8dac49ccdab59196da668`; image-license SHA-256 is `3f59d44cecd6c6959af3849074352289276e85df68b96cd1e9f696acb17e9050`. The PowerSync JS repository Apache-2.0 license SHA-256 is `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`. Legal/product acceptance of service FSL terms is **pending**.

The npm lock pins `better-sqlite3@12.10.0`, but its install script may fetch a platform-specific prebuild or compile native code outside lockfile checksums. The binary actually executed is therefore **not independently provenance-validated**.

## 3. Latest local candidate execution

Executed from base commit `d126c956d88a7f3c1d2ac3a213597da153aa6bf4` with uncommitted candidate files. Runtime JSON remains ignored and local; the command must be repeated against an immutable candidate before any `passed` claim.

```text
run ID: 691787eb-b0bd-44c3-b91d-a76177a807f5
Compose project: trax-ps8-maurice-691787eb-b0bd-44c3-b91d-a76177a807f5
Linux x86_64; Node.js v22.23.1; pinned npm 10.9.4
Docker client/server 29.6.2; Docker Compose 5.3.1
```

Exact wrapper command (exit 0):

```bash
COMPOSE_PROJECT_NAME=trax-ps8-maurice-691787eb-b0bd-44c3-b91d-a76177a807f5 \
PS8_RUN_ID=691787eb-b0bd-44c3-b91d-a76177a807f5 \
spikes/powersync/scripts/run.sh
```

| Check                                                   | State                  | Exact observation                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tag/image/platform/label/source/npm/license provenance  | `executed-uncommitted` | `spikes/powersync/scripts/verify-provenance.sh`; exit 0                                                                                                                                                                              |
| Pinned npm install, TypeScript and unit policies        | `executed-uncommitted` | `npx --yes npm@10.9.4 ci --prefix spikes/powersync/harness && npx --yes npm@10.9.4 run check --prefix spikes/powersync/harness`; 7/7 unit tests, including decoded-signature mutation and local verification rejection; exit 0       |
| Compose interpolation and readiness                     | `executed-uncommitted` | wrapper ran digest/env-file `docker compose ... config --quiet`, digest pulls and `/probes/readiness`; all three services recorded healthy                                                                                           |
| Authenticated identity issuance                         | `executed-uncommitted` | random distinct per-run credentials; Alice-as-Eve and Alice-as-Casey denied; query identity/scope injection denied                                                                                                                   |
| Scoped replication and same-workspace Journey isolation | `executed-uncommitted` | four fresh on-disk replicas matched exact UUID/payload allowlists; second same-workspace Journey remained Alice-only                                                                                                                 |
| Hierarchical online revocation                          | `executed-uncommitted` | user, workspace, Journey and party revocation each purged an existing replica and a fresh replica using the stale JWT; reactivation reconverged before the next case                                                                 |
| Overlapping path preservation                           | `executed-uncommitted` | Casey alpha removal retained Journey/bravo; Alice's independent alpha path remained                                                                                                                                                  |
| Invalid JWT service behavior                            | `executed-uncommitted` | valid-token clients completed first sync; wrong audience returned 401/`PSYNC_S2105`, expiry returned 401/`PSYNC_S2103`, and the deterministically byte-tampered signature returned 401/`PSYNC_S2101` `signature verification failed` |
| Guarded destructive cleanup                             | `executed-uncommitted` | cleanup verified run ownership labels/marker, removed containers/volume/network, and completed before success evidence was written                                                                                                   |

The retained structured observation records one passed integration subtest, zero skips and 3.201 seconds of in-test duration; the credential/JWT-sanitized TAP transcript independently records 1/1 passing. The recorded context binds the wrapper, run/project identities, exact Node/npm/Docker/Compose versions, endpoints, container health, service image IDs and immutable PowerSync/PostgreSQL image references.

Older candidate attempts may remain under separate ignored run IDs, but they are not cited or used as evidence. The selected run above is the only run supporting current exact observations, and no failed run counts as success evidence.

## 4. Implemented spike boundaries

- Token issuance uses per-principal, per-run credentials and a dedicated database read role limited to `users(id, active)`.
- PowerSync's replication role has `SELECT` only on `resources` and the spike-only `sync_grants` projection; the publication contains only those tables. Future-table blanket grants were removed.
- `sync_grants` is rebuilt transactionally by PostgreSQL triggers from current user, workspace, Journey and party rows. The stream requires every active flag. This explicit projection belongs only to the disposable harness and is **not** a proposed production policy table.
- The host integration controller still uses a known synthetic PostgreSQL superuser over a loopback-only published port to perform revocation fixtures. This is acceptable only for disposable local synthetic evidence and is not a production credential pattern.
- First-sync timeout rejects, `currentStatus.hasSynced` is required, every partial client is closed on failure, reads/HTTP/queries have hard deadlines, and test cleanup failures propagate.
- Every run uses a UUID project/run, refuses existing resources and occupied ports, retains evidence per run, and requires marker plus owner/run labels for destructive cleanup.

## 5. Threat and mitigation traceability

| Threat/control                 | Evidence from this slice                                                                                                                                  | State                  | Missing evidence                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TH-SYNC-001` / `MIT-SYNC-001` | authenticated synthetic identities; exact cross-workspace/second-Journey/party SQLite assertions; forged identity/scope and invalid JWT fixtures rejected | `executed-uncommitted` | TLS, encrypted local storage, native credentials and compromised-service behavior are `not-validated`                           |
| `TH-SYNC-002` / `MIT-SYNC-002` | explicit active hierarchy projection, narrow publication/replication grants, immutable rules config                                                       | `executed-uncommitted` | production RLS equivalence, rule administration, production schema and privileged-role review are `not-validated`               |
| `TH-SYNC-003` / `MIT-SYNC-003` | excluded by first-slice non-goals                                                                                                                         | `not-validated`        | canonical uploads, replay/idempotency, conflict and current-policy command checks                                               |
| `TH-SYNC-004` / `MIT-SYNC-004` | online user/workspace/Journey/party purge with stale-token fresh replicas and overlapping path preservation                                               | `executed-uncommitted` | permanently offline/hostile device, forensic deletion, tombstone retention, key purge and delayed reconnect are `not-validated` |
| `TH-SYNC-005` / `MIT-SYNC-005` | digest-pinned local self-host stack and exact FSL evidence                                                                                                | `executed`             | license acceptance, offline-after-pull run, restart persistence, upgrade/rollback and operational hardening are `not-validated` |
| `TH-SYNC-006` / `MIT-SYNC-006` | excluded by first-slice non-goals                                                                                                                         | `not-validated`        | subscription/cardinality limits, rate limits, queue/conflict storms and backpressure                                            |

The production threat register remains correct at `not-implemented`/`designed` with `EV-SYNC-PLANNED`.

## 6. Security and product limitations

- The pinned service returned stable 401 responses for the three tested invalid-JWT fixtures. This bounded result does not prove general parser/error robustness against other malformed or adversarial inputs.
- The spike uses loopback HTTP and unencrypted test SQLite. It proves logical scoping, not encrypted transport/storage or forensic erasure.
- A valid pre-revocation identity token may authenticate until expiry. Current server relationships remove its data scope; this is not immediate token blacklisting.
- A permanently offline, copied or hostile endpoint cannot be remotely wiped by PowerSync.
- Logical replication needs source visibility and may bypass application/RLS paths. Production policy equivalence remains unproven.
- The synthetic schema and full-rebuild grant trigger are feasibility tools, not production migration/application-handler designs.
- The Node SDK is beta; native runtime, background, encryption, backup and device-key evidence remain separate gates.
- FSL use and future-license terms need explicit owner/legal review.

## 7. Remaining Issue #8 gates

1. Rerun from an immutable committed candidate under Node 22/npm 10 and independent review.
2. Repeat invalid-token and broader malformed-input abuse tests against the eventual selected production version; this slice covers only wrong audience, expiry and deterministic signature corruption.
3. Add tombstone/offline-window, upload/idempotency, reconciliation/conflict and resource-bound tests.
4. Repeat after service restart and after image pulls with outbound network disabled.
5. Validate supported Capacitor and Tauri routes separately; compilation is not runtime acceptance.
6. Complete encryption/key-custody evidence under Issue #9.
7. Decide FSL acceptability and operational purge SLO, then conduct independent security/risk review.

Until all mandatory gates pass, the correct verdict is **conditional feasibility for this server-side slice, not complete Issue #8 validation or production approval**.
