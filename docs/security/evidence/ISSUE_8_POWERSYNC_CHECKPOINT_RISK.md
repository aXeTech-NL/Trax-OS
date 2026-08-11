# Issue #8 PowerSync checkpoint-attestation decision packet

**Status:** technical limitation demonstrated; owner architecture/risk decision recorded; production security and implementation acceptance pending

**Superseding owner decision:** on 2026-08-11 the repository CODEOWNER (`@Maurice-aXeTech`) accepted the narrower connected-sync trust boundary in [ADR-018](../../architecture/decisions/ADR-018-CONNECTED-SYNC-TRUST-BOUNDARY.md). Exact `P90D` remains, but its checkpoint is server-recorded eligibility state triggered by honest-client lifecycle telemetry—not proof of hostile-client durable apply, clear or remote wipe.

**Platform assessment:** the earlier [backend-verifiable alternative assessment](ISSUE_8_BACKEND_VERIFIABLE_CHECKPOINT_ALTERNATIVE.md) identified no implementation path in the reviewed public general Android/macOS APIs that atomically binds protected replica storage transitions to attested receipts. Its negative finding remains supporting evidence for the policy revision.

**Production decision:** still gated — owner product-architecture residual risk is accepted, but this document records no independent Phase 0 risk closure, implemented production adapter, legal acceptance or production approval

## 1. Decision and scope

The pinned PowerSync 1.23.3 service and Node SDK expose client-observed sync completion, but no application-backend-verifiable proof that a particular client durably applied a checkpoint or cleared its local database. The bounded platform assessment also found no qualifying storage-owning trusted component in reviewed public general Android/macOS APIs.

ADR-018 therefore defines a **server-recorded eligibility checkpoint**: endpoint state bound to current replica/epoch, endpoint-issued target retention watermark and endpoint acceptance time. A replica-authenticated official-client report may trigger that endpoint-owned transition. It is authoritative only for incremental eligibility. At exactly `P90D` the replica remains eligible; at `>P90D`, or below the retained floor, its epoch becomes reset-required and cannot use normal renewal. Current authorisation, epoch, version, incarnation and digest-bound idempotency remain independent for every command.

The owner explicitly accepts that a hostile/copied client can report completion or reset falsely, retain previously authorised data and re-envelope unseen intent when all current server checks still permit the mutation. Server revocation prevents future access; local deletion is not claimed. This product-architecture choice completes the missing R5b owner follow-up, but Issue #45 remains gated on implementation, Issue #9, create identity, quarantine UX, independent security review, immutable evidence, native validation and legal acceptance.

## 2. Commit-bound negative-capability evidence

Clean candidate commit `b314ead79cb530ac8ebabf5d31e0096b7b7e552f` was executed through the complete local wrapper:

```text
run ID: 1fb0f8db-3938-413e-bb3a-8e97cdb5f68b
source digest: 26e320a138699743e2d81f82e1a0c8188a6e72f571a62bb8cb488c9ffaa582b6
unit tests: 24/24
PowerSync integration subtests: 2/2
R4 restart/offline/cached phases: passed
cleanup: passed
```

The raw adversarial replica used only authenticated HTTP calls. It never opened PowerSync or SQLite. The run demonstrated that:

- at `>P90D`, an upload was initially rejected with `replica_reset_required`;
- immediately issuing and acknowledging a client-observed challenge without sync changed the same replica back to incrementally eligible;
- a previously formed, unchanged and still-authorised update then applied;
- reset and reset acknowledgement rotated the epoch without any local clear or full sync;
- the old epoch was rejected, but a never-server-observed pre-reset intent could be re-enveloped under the new epoch and apply when current checks still matched.

This is a successful test of a **limitation**, not successful attestation. Retained evidence remains local and conservatively `executed-uncommitted` until attached to immutable CI or review evidence.

## 3. Controls that remain server-authoritative

The same bounded scenario confirmed that a false checkpoint acknowledgement did not bypass:

- current relationship-derived authorisation;
- optimistic expected-version conflict handling;
- immutable resource-incarnation checks after UUID reuse;
- generic terminal handling for a missing/purged target;
- digest-bound idempotency for a command already observed by the server;
- rejection of a retired replica epoch.

Complete resource payload/version/incarnation/deletion invariants and exact receipt/event effects were checked. These controls constrain stale mutations when current server state disagrees. They do **not** prove that a hostile client actually complied with the `P90D` local lifecycle, prove local clear, or prevent previously unseen intent from being re-enveloped. ADR-018 explicitly excludes those claims while retaining the exact server eligibility gate. The spike protocol has no create command, so offline create identity, uniqueness and resurrection behavior remain uncharacterised.

## 4. Threat conclusion

Checkpoint acknowledgement must be treated as honest-client telemetry, not security authority. A compromised, copied or intentionally modified endpoint can:

- acknowledge without applying replicated state;
- retain previously replicated local data indefinitely;
- acknowledge reset without clearing local data;
- carry unseen intent across an epoch rotation and submit it under a new envelope.

Remote wipe cannot be proven. Server-side authorisation still protects current authority, but endpoint compromise commonly includes both principal and replica credentials. An absolute server-owned epoch expiry can force credential rotation, yet it still cannot prove clear or prevent hostile re-enveloping; it is only a supplementary limit.

## 5. Selected policy and compensating controls

| Boundary/control                        | Selected requirement                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Eligibility                             | Endpoint time, current replica/epoch, one-time endpoint-issued target, exact `P90D` and retained floor own the server eligibility transition. A stale epoch cannot return through normal renewal.                  |
| Lifecycle telemetry                     | The official client reports locally observed completion/reset/full sync. The endpoint may record eligibility after the scoped report, but neither side represents it as durable-apply, clear or wipe attestation.  |
| Canonical writes                        | Every command rechecks current authorisation, epoch, expected version, immutable incarnation and digest-bound idempotency. Checkpoint state never grants mutation authority.                                       |
| Revocation                              | Credentials/epoch are invalidated server-side. Future access stops; plaintext, keys and other local copies may remain indefinitely.                                                                                |
| Stale recovery                          | Still-authorised pending work enters encrypted/access-controlled quarantine; revoked work is denied/purged; epoch rotation and full sync precede explicit reviewed reapplication.                                  |
| Resurrection protection                 | Missing targets reject updates; incarnation prevents UUID-reuse targeting. Connected offline create remains blocked until a one-time allocation carries fresh server-generated identity/incarnation, actor/scope/entity type/replica epoch/expiry/digest binding and atomic current-authorisation consumption. |
| Owner-accepted product residual risk    | False reports, retained local copies, false reset and re-enveloped unseen intent remain possible. Re-enveloped intent applies only if all current server checks still match and is audited as a current write.     |
| Independent production security closure | Still pending through the Phase 0 threat-model process; owner architecture acceptance is not immutable implementation evidence or production approval.                                                             |

## 6. Technical recommendation and pending approvals

**Technical recommendation:** implement the Trax-owned eligibility/replica control plane from ADR-018 and use PowerSync only as transport/cache if its separate legal gate passes. Never call a client lifecycle report attestation, keep every command decision independent of it, disclose that remote wipe is unavailable and do not promote connected offline create before server-authoritative identity allocation exists.

| Decision                                | State                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Technical limitation characterization   | Implemented in the disposable Issue #8 harness                                                                                |
| Architecture direction                  | ADR-018 policy revision accepted by owner; R5b implementation/production evidence remains `designed`                          |
| Owner product residual-risk acceptance  | Accepted on 2026-08-11 for the exact ADR-018 endpoint limitations                                                             |
| Independent Phase 0/security acceptance | Pending the repository threat-model closure and production review process                                                     |
| PowerSync FSL-1.1-ALv2 acceptance       | Pending owner/legal review                                                                                                    |
| Production adapter approval             | Gated on #9, create identity, #46, production controls, native validation, immutable evidence and independent security review |

The missing R5b owner decision is complete. Issue #45 is no longer blocked on an impossible local-attestation requirement, but it remains a designed production capability until all listed implementation, legal, native, operations and independent security gates pass. R5a execution-time fields and artifacts remain unchanged historical negative-capability evidence.
