# Issue #8 PowerSync Feasibility Evidence

**Evidence status:** commit-bound M2, M3a and M3b-R1/R2/R3 executions succeeded locally; complete Issue #8 validation is not claimed

**Scope:** commit-bound authenticated scope/revocation, experimental reconciliation, retention, honest-client reset and bounded-capacity observations; restart, native and server-attestation gates remain separate

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

## 3. Latest commit-bound candidate execution

Executed from clean candidate commit `021cdba4eb8c2bc9a06bdacb3f7ab77e60df225a`. Runtime JSON remains ignored and local, so the table retains the conservative `executed-uncommitted` state until the evidence is attached to an immutable review or CI record; the bounded command and assertions nevertheless completed successfully.

```text
run ID: 45e1d37e-89ec-462a-9c72-76bfbc939c64
Compose project: trax-ps8-maurice-45e1d37e-89ec-462a-9c72-76bfbc939c64
Linux x86_64; Node.js v22.23.1; pinned npm 10.9.4
Docker client/server 29.6.2; Docker Compose 5.3.1
```

Exact wrapper command (exit 0):

```bash
COMPOSE_PROJECT_NAME=trax-ps8-maurice-45e1d37e-89ec-462a-9c72-76bfbc939c64 \
PS8_RUN_ID=45e1d37e-89ec-462a-9c72-76bfbc939c64 \
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

The retained structured observation records one passed integration subtest, zero skips and 3.232 seconds of in-test duration; the credential/JWT-sanitized TAP transcript independently records 1/1 passing. The recorded context binds the wrapper, run/project identities, exact Node/npm/Docker/Compose versions, endpoints, container health, service image IDs and immutable PowerSync/PostgreSQL image references.

Older candidate attempts may remain under separate ignored run IDs, but they are not cited or used as evidence. The selected run above is the only run supporting the M2 commit-bound exact observations, and no failed run counts as success evidence.

### 3.1 Latest M3a commit-bound candidate execution

This subsection does **not** rewrite or promote the prior commit-bound M2 evidence. The following newer run exercised clean candidate commit `06b0ae88df2163d01246421644820e5033e926b3`. Its ignored local record conservatively remains `executed-uncommitted`, not attested `passed`, until attached to immutable CI or review evidence:

```text
run ID: 11f5fa45-0590-40ad-a569-9e2664de6dac
Compose project: trax-ps8-maurice-11f5fa45-0590-40ad-a569-9e2664de6dac
Linux x86_64; Node.js v22.23.1; pinned npm 10.9.4
Docker client/server 29.6.2; Docker Compose 5.3.1
wrapper exit: 0; integration subtests: 2/2 passed; cleanup: succeeded
```

Exact wrapper command (exit 0):

```bash
COMPOSE_PROJECT_NAME=trax-ps8-maurice-11f5fa45-0590-40ad-a569-9e2664de6dac \
PS8_RUN_ID=11f5fa45-0590-40ad-a569-9e2664de6dac \
spikes/powersync/scripts/run.sh
```

The sanitized structured record observed:

- the unchanged exact M2 replica allowlists and all four online revocation levels;
- candidate revision `06b0ae88df2163d01246421644820e5033e926b3`, clean executable-source state and digest `8f6f8a394f6a07d51af9b77c7980da935eb57369f5eab96edab278d7151eb0f4`; the recorded scope covers spike executable, configuration, schema and test sources while excluding documentation and generated/runtime artifacts;
- a post-commit response drop with two upload attempts, one resource mutation, version increment, receipt and event;
- grant evaluation serialized against Journey revocation: the barrier-held command committed before revocation, while the next command was denied;
- exact `idempotency_conflict` terminal handling through a real SDK queue followed by successful unrelated work;
- competing expected-version-1 commands producing one `applied` and one durable `conflict` result;
- a digest-bound `command_denied` receipt, denial replay after regrant and later unrelated progress;
- pending overlay observation under an injected pre-commit failure and overlay removal after terminal results;
- a retained version-3 tombstone converging across clients, disappearing on revocation, reappearing after regrant and rejecting stale resurrection;
- twelve terminal receipts and six mutation events across the bounded scenario.

The observation retains command UUIDs, explicit booleans/codes, counts, versions, result states and attempt numbers. It omits JWTs, credentials, command payloads, deleted content and canonical/conflict snapshots. Earlier failed mutable attempts remain under their separate ignored run IDs and do not support this result.

M3a is still a disposable synthetic Issue #8 harness. Its endpoint, envelope, tables, roles, commands, receipts and local completion policy do not define Issue #14 or implement Issues #45/#46. No tombstone retention/purge, restart, capacity, native-runtime, legal or production-policy-equivalence claim follows from this run.

### 3.2 M3b-R1 commit-bound retention candidate

The following later run exercised clean candidate commit `bdb6bcaf61974f717993d74322bee420102cc27b`. Its ignored local record remains conservatively `executed-uncommitted` until attached to immutable CI or review evidence:

```text
run ID: 5459e933-163e-46a7-944d-1ad047a4c37e
Compose project: trax-ps8-maurice-5459e933-163e-46a7-944d-1ad047a4c37e
Linux x86_64; Node.js v22.23.2; pinned npm 10.9.4
Docker client/server 29.7.2; Docker Compose 5.4.0
wrapper exit: 0; unit tests: 9/9; integration subtests: 2/2; cleanup: succeeded
source digest: 110d571142e2130da30d92882e00607cf2f5ab0911391297aecda3470409aefe
```

The sanitized structured record observed:

- endpoint/DB-authoritative deterministic time, with payload retained at exactly `P30D` and cleared immediately after it;
- a payload-free minimal graveyard retained at exactly `P90D`, purged immediately afterward, and idempotent monotonic floor advancement that did not skip a lower retained marker;
- configured `P120D` graveyard retention while the fixed connected-client predicate still required reset immediately after `P90D`;
- immutable resource incarnation IDs in replication, queued-command digests and terminal receipts;
- UUID reuse rejected while a marker existed, then permitted only with a new incarnation after expiry; an old-incarnation command terminated as `stale_incarnation` without mutating the replacement, and later queue work progressed;
- hardened `SECURITY DEFINER` resolution, denied temporary-schema shadowing for the command writer and restricted database TEMP privileges;
- command/retention serialization and a direct limited-writer soft-delete overlap completing without deadlock through the transaction-serialized state counter;
- digest-bound terminal behavior for purged targets and post-commit retries after revocation, without exposing or rewriting the prior applied receipt;
- evidence directory mode `0700`, every retained artifact mode `0600`, credential/JWT sanitization and guarded Docker cleanup.

This R1 slice does **not** prove a server-registered replica, a trusted completed PowerSync checkpoint, actual stale-replica quarantine/reset/full resync, restart/offline-after-pull behavior, capacity/backpressure, encryption, native runtime or production policy equivalence. Injected endpoint time proves boundary logic, not 90 days of elapsed operation. The synthetic tables/functions/limits are not production contracts or migrations.

### 3.3 M3b-R2 commit-bound replica-reset candidate

The following later run exercised clean candidate commit `a037cfbf2b68a51c50799e2f727f1039d9577705`. Its ignored local record remains `executed-uncommitted` until attached to immutable CI or review evidence:

```text
run ID: 2cd1eeda-8c85-4d57-9c0a-9014f6020de6
Compose project: trax-ps8-maurice-2cd1eeda-8c85-4d57-9c0a-9014f6020de6
Linux x86_64; Node.js v22.23.2; pinned npm 10.9.4
Docker client/server 29.7.2; Docker Compose 5.4.0
wrapper exit: 0; unit tests: 11/11; integration subtests: 2/2; cleanup: succeeded
source digest: 995a6a641aff8656610c609d84d993b4de40ebf0e4be9fd7e8b27754e54d6f63
```

The sanitized structured record observed:

- server-generated 32-byte replica credentials with digest-only PostgreSQL storage, generic invalid-replica responses and user/replica/epoch binding;
- per-replica epochs and command/receipt digests, with an exact-`P90D` command applied and `P90D` plus one microsecond rejected with HTTP 428 before any mutation, event or receipt;
- one-time, expiring and floor-bound checkpoint challenges explicitly labelled `client-observed-not-server-attested`;
- stale-only, per-replica reset that left another current replica usable and retired old credentials after acknowledgement;
- request-idempotent HMAC-derived credential rotation recovering the exact session after a committed/lost reset response without persisted plaintext;
- mode-`0600` reset state persisted and acknowledged before destructive clear, plus successful recovery from injected pre-clear and post-clear failures;
- public PowerSync lifecycle reset/full resync without SQL access to internal `ps_*` tables;
- three pending commands preserved outside the SDK queue: one currently authorised same-incarnation command became `pending_review`, while revoked/replaced commands were invalidated with payload removed; zero commands were automatically requeued;
- an explicit 16-replica-per-user spike cap, at most one checkpoint challenge per replica/epoch and no payload-bearing temporary files after injected atomic-write failures;
- application state/quarantine sidecars at mode `0600` under mode-`0700` parents, with separate per-run rotation/fault secrets absent from retained evidence.

PowerSync 1.23.3 does not expose an application-backend-verifiable acknowledgement that a specific client durably applied a checkpoint. The R2 challenge therefore proves an honest-client lifecycle and server-owned age/floor gate, not hostile-client attestation. The sidecars are plaintext protected by filesystem permissions, not encrypted or forensically erased; their writes are not atomic with the SDK queue. Cross-process restart, physical power-loss durability, request/queue-storm backpressure, native runtime and production-policy equivalence remain unvalidated.

### 3.4 M3b-R3 commit-bound capacity candidate

The following later run exercised clean candidate commit `9a5c81fc92d556180eb9211d141cee3f438519ca`. Its ignored local record remains `executed-uncommitted` until attached to immutable CI or review evidence:

```text
run ID: f1b17482-651b-4935-8ffb-173818566b39
Compose project: trax-ps8-maurice-f1b17482-651b-4935-8ffb-173818566b39
Linux x86_64; Node.js v22.23.2; pinned npm 10.9.4
Docker client/server 29.7.2; Docker Compose 5.4.0
wrapper exit: 0; unit tests: 20/20; integration subtests: 2/2; cleanup: succeeded
source digest: 6a45df6e2305ae069556d6e26d7aee0f777ef532605895fab36d376444d77d42
```

The bounded feasibility policy and sanitized observations recorded:

- at most 64 combined pending commands, unresolved results and quarantine entries, with 65,536 reserved serialized bytes and no automatic eviction;
- exact count/byte boundaries accepted and plus-one rejected atomically, including concurrent and duplicate-ID admission;
- globally unique command IDs across overlays, SDK-pending work, unresolved results and persisted quarantine; compatible terminal replay retained the original outcome instead of replacing it;
- terminal results unacknowledgeable until SDK queue completion, with explicit result/quarantine acknowledgement required to free capacity;
- five durable transient attempts before `retry_exhausted`, followed by unrelated successful queue progress; HTTP 428 did not consume retry budget;
- orphan application-sidecar intents discovered before destructive reset and classified into quarantine rather than silently removed;
- persisted quarantine loaded and merged without replacement across a second reset, with combined N+1 rejected before clear;
- genuine migration from R2 application/quarantine sidecars, retaining unknown legacy versions as review-only and failing unfinished legacy reset state closed;
- invalid zero/negative/fractional/unsafe expected versions rejected before any SDK, sidecar or quarantine mutation;
- four process-local concurrent command slots, a fifth request receiving retryable 503, and recovery after release;
- 64 DB-accounted authenticated commands per replica/minute, request 65 receiving 429, and one bounded rate row per replica;
- the retained tombstone and graveyard marker surviving the bounded stress scenario.

These values are feasibility limits, not production capacity promises. The semaphore is process-local and the limiter is not a distributed fairness design. Cross-process restart, offline-after-pull, physical-power-loss behavior, encrypted quarantine, native runtime and production sizing remain unvalidated.

## 4. Implemented spike boundaries

- Token issuance uses per-principal, per-run credentials and a dedicated database read role limited to `users(id, active)`.
- PowerSync's replication role has `SELECT` only on `resources` and the spike-only `sync_grants` projection; the publication contains only those tables. Future-table blanket grants were removed.
- The M3a harness uses an SDK insert-only command queue and local-only overlay/result tables. A separate loopback service accepts only strict synthetic update/soft-delete requests and uses a column-limited PostgreSQL writer role; replication, storage and token roles cannot mutate resources, receipts or events.
- M3a reauthenticates the JWT and current server-derived grant before receipt lookup. A transaction-scoped advisory lock serializes grant evaluation with relationship-triggered projection rebuilds before resource locking. Resource mutation, receipt and the singleton synthetic event commit atomically; denied commands receive digest-bound durable receipts and cannot apply after regrant. Tombstones and their grants are retained for this bounded run.
- M3b-R1 adds spike-only immutable resource incarnations, a payload-free graveyard, strict `P30D`/`P90D` retention transitions and a monotonic retained floor. Its reset predicate uses endpoint time/floor plus checkpoint inputs that are not yet bound to a registered replica; client self-report is not trusted or validated.
- R1 hardens `SECURITY DEFINER` search paths and TEMP privileges, serializes retention against command/grant processing and keeps terminal denied/stale outcomes from blocking later queue work. The deterministic clock and maintenance functions are restricted test controls, not operator APIs.
- R2 registers digest-only replica credentials, binds commands to per-replica epochs and applies the age/floor gate before receipts or mutation. Reset rotation is request-idempotent and recoverable, but its completed-sync acknowledgement remains client-observed rather than server-attested.
- R2 uses public SDK reset/full-sync methods and an application-owned private SQLite/JSON sidecar for results, overlays, replica session and quarantine; it contains no SQL against PowerSync internal tables. Server receipts make interruption retries terminal and idempotent, but the SDK queue and application sidecar are separate transactions and do not define a production client seam.
- R3 adds explicit feasibility backpressure across client state, transient retries, server concurrency and per-replica request windows. It preserves orphan intent and prior quarantine through reset, requires explicit acknowledgement to release capacity and migrates R2 sidecars conservatively; the chosen numbers are not production sizing.
- `sync_grants` is rebuilt transactionally by PostgreSQL triggers from current user, workspace, Journey and party rows. The stream requires every active flag. This explicit projection belongs only to the disposable harness and is **not** a proposed production policy table.
- The host integration controller still uses a known synthetic PostgreSQL superuser over a loopback-only published port to perform revocation fixtures. This is acceptable only for disposable local synthetic evidence and is not a production credential pattern.
- First-sync timeout rejects, `currentStatus.hasSynced` is required, every partial client is closed on failure, reads/HTTP/queries have hard deadlines, and test cleanup failures propagate.
- Every run uses a UUID project/run, refuses existing resources and occupied ports, retains evidence per run, and requires marker plus owner/run labels for destructive cleanup.

## 5. Threat and mitigation traceability

| Threat/control                 | Evidence from this slice                                                                                                                                  | State                  | Missing evidence                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TH-SYNC-001` / `MIT-SYNC-001` | authenticated synthetic identities; exact cross-workspace/second-Journey/party SQLite assertions; forged identity/scope and invalid JWT fixtures rejected | `executed-uncommitted` | TLS, encrypted local storage, native credentials and compromised-service behavior are `not-validated`                           |
| `TH-SYNC-002` / `MIT-SYNC-002` | explicit active hierarchy projection, narrow publication/replication grants, immutable rules config                                                       | `executed-uncommitted` | production RLS equivalence, rule administration, production schema and privileged-role review are `not-validated`               |
| `TH-SYNC-003` / `MIT-SYNC-003` | synthetic singleton upload, incarnation/digest-bound applied/conflict/denied receipts, current-grant/retention serialization, idempotency retry and terminal queue outcomes | `executed-uncommitted` | production canonical command/UoW/policy equivalence, audited conflict UX and immutable evidence remain `not-validated`          |
| `TH-SYNC-004` / `MIT-SYNC-004` | strict endpoint-time retention plus per-replica age/floor gating, recoverable honest-client reset/full sync and revocation/incarnation-filtered quarantine | `executed-uncommitted` | server-attested checkpoint, permanently offline/hostile device, encrypted/forensic/key deletion and cross-process restart are `not-validated` |
| `TH-SYNC-005` / `MIT-SYNC-005` | digest-pinned local self-host stack and exact FSL evidence                                                                                                | `executed`             | license acceptance, offline-after-pull run, restart persistence, upgrade/rollback and operational hardening are `not-validated` |
| `TH-SYNC-006` / `MIT-SYNC-006` | bounded client state/bytes/retries, 16 replicas/user, one challenge/epoch, four command slots, DB-accounted 64 requests/replica/minute and exact plus-one backpressure without tombstone loss | `executed-uncommitted` | production sizing, multi-node/distributed fairness and sustained native-scale storms remain `not-validated` |

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

1. Attach the commit-bound local run to an immutable review or CI evidence record and complete independent review of that immutable result.
2. Repeat invalid-token and broader malformed-input abuse tests against the eventual selected production version; this slice covers only wrong audience, expiry and deterministic signature corruption.
3. Resolve the pinned stack's missing server-attested checkpoint through an explicit residual-risk decision or reviewed alternative. Production sizing/distributed enforcement and quarantine encryption remain gates under Issues #45/#9; standalone local-only authority remains separately gated by Issues #2/#9.
4. Repeat after service restart and after image pulls with outbound network disabled.
5. Validate supported Capacitor and Tauri routes separately; compilation is not runtime acceptance.
6. Complete encryption/key-custody evidence under Issue #9.
7. Decide FSL acceptability and operational purge SLO, then conduct independent security/risk review.

Until all mandatory gates pass, the correct verdict is **conditional feasibility for this server-side slice, not complete Issue #8 validation or production approval**.
