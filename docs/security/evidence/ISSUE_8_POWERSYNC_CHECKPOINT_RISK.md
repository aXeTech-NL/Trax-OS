# Issue #8 PowerSync checkpoint-attestation decision packet

**Status:** technical limitation demonstrated; owner-selected direction has a negative bounded public-platform assessment for general Android/macOS

**Owner direction:** on 2026-08-11 the repository CODEOWNER (`@Maurice-aXeTech`) selected the backend-verifiable checkpoint alternative. The canonical `P90D` policy remains unchanged and no residual risk is accepted by this selection.

**Platform assessment:** the [backend-verifiable alternative assessment](ISSUE_8_BACKEND_VERIFIABLE_CHECKPOINT_ALTERNATIVE.md) identified no implementation path in the reviewed public general Android/macOS APIs that atomically binds protected replica storage transitions to attested receipts. A simulated or ordinary signed-receipt spike is not closure evidence.

**Production decision:** blocked — this document records no concrete alternative acceptance, security acceptance, architecture implementation, legal acceptance or production approval

## 1. Decision required

The connected-sync policy requires a trusted checkpoint before a replica remains incrementally eligible across the [`P90D` boundary](../../architecture/RETENTION_AND_DELETION.md#connected-sync-offline-support-boundary). The pinned PowerSync 1.23.3 service and Node SDK expose client-observed sync completion, but no application-backend-verifiable proof that a particular client durably applied a checkpoint or cleared its local database.

The owner selected the first direction: preserve the current policy and pursue a backend-verifiable alternative. The platform assessment found that PowerSync, ordinary signatures, hardware-backed generic keys, Android app/device integrity and macOS Secure Enclave/device posture do not bind a receipt to a durable SQLite transition. No qualifying storage-owning trusted component was identified in the reviewed public general-client APIs.

The production adapter in Issue #45 remains blocked. This direction does not approve PowerSync checkpoint acknowledgement as authority, select a concrete implementation, accept residual risk or imply production approval.

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

Complete resource payload/version/incarnation/deletion invariants and exact receipt/event effects were checked. These controls constrain stale mutations when current server state disagrees. They do **not** enforce the current `P90D` incremental-eligibility rule for unchanged, still-authorised state, prove local clear, or prevent previously unseen intent from being re-enveloped. The spike protocol has no create command, so offline create identity, uniqueness and resurrection behavior remain uncharacterised.

## 4. Threat conclusion

Checkpoint acknowledgement must be treated as honest-client telemetry, not security authority. A compromised, copied or intentionally modified endpoint can:

- acknowledge without applying replicated state;
- retain previously replicated local data indefinitely;
- acknowledge reset without clearing local data;
- carry unseen intent across an epoch rotation and submit it under a new envelope.

Remote wipe cannot be proven. Server-side authorisation still protects current authority, but endpoint compromise commonly includes both principal and replica credentials. An absolute server-owned epoch expiry can force credential rotation, yet it still cannot prove clear or prevent hostile re-enveloping; it is only a supplementary limit.

## 5. Options for the owner/security decision

| Option                                                                                      | Required evidence                                                                                                                                                             | Consequence                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Backend-verifiable checkpoint alternative — owner-selected, bounded assessment negative** | The backend independently binds replica identity to a durable applied watermark; replay, copied-client and failure-recovery tests pass                                        | Could preserve the policy, but no qualifying path was identified in reviewed public general Android/macOS APIs               |
| Policy revision with compensating controls                                                  | Explicit hostile-client model, longer or indefinite protective history, current-authority/version/incarnation/idempotency controls, production sizing and operations evidence | Accepts that checkpoint/clear remain unverified and changes the canonical guarantee                                          |
| Reject connected-sync support for the intended general clients                              | Product/support migration, offline-mode consequences and replacement user-flow acceptance                                                                                     | Avoids claiming an unsupported trusted checkpoint; changing only the sync engine does not remove the endpoint trust boundary |

Server epoch expiry or honest-client reset alone is not a fourth attestation option and does not satisfy the current canonical gate.

## 6. Technical recommendation and pending approvals

**Technical recommendation:** do not use the PowerSync client checkpoint acknowledgement as authority. Keep every command decision independent of it, do not claim hostile-client `P90D` enforcement or verified wipe, and do not promote create support before Issue #14 defines server-authoritative creation and identity allocation.

| Decision                              | State                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Technical limitation characterization | Implemented in the disposable Issue #8 harness                                                                           |
| Architecture direction                | Backend-verifiable alternative selected; bounded general-client platform assessment negative and owner follow-up pending |
| Security residual-risk acceptance     | Pending independent security authority                                                                                   |
| PowerSync FSL-1.1-ALv2 acceptance     | Pending owner/legal review                                                                                               |
| Production adapter approval           | Blocked                                                                                                                  |

The owner-direction part of R5b is recorded, but its first platform-capability assessment is negative. R5b completes only after an owner follow-up selects a viable qualified environment, rejects the connected-sync direction or explicitly revises policy, with the corresponding independent security authority, immutable review and production acceptance evidence. Until then Issue #8 remains conditionally feasible only for its bounded server-side mechanics, while Issue #45 and complete sync acceptance remain blocked.
