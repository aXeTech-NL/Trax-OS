# Issue #8 PowerSync checkpoint-attestation decision packet

**Status:** technical limitation demonstrated; owner/security decision pending

**Production decision:** blocked — this document records no risk acceptance, architecture revision, legal acceptance or production approval

## 1. Decision required

The connected-sync policy requires a trusted checkpoint before a replica remains incrementally eligible across the [`P90D` boundary](../../architecture/RETENTION_AND_DELETION.md#connected-sync-offline-support-boundary). The pinned PowerSync 1.23.3 service and Node SDK expose client-observed sync completion, but no application-backend-verifiable proof that a particular client durably applied a checkpoint or cleared its local database.

The production adapter in Issue #45 must therefore remain blocked until the owner and security authority either:

1. select and validate a backend-verifiable alternative that satisfies the current policy; or
2. explicitly revise the policy and accept the resulting hostile/copied-client residual risks.

An approval is not implied by the spike, this packet, an issue state or a local test result.

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

| Option                                     | Required evidence                                                                                                                                                             | Consequence                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Backend-verifiable checkpoint alternative  | The backend independently binds replica identity to a durable applied watermark; replay, copied-client and failure-recovery tests pass                                        | Can preserve the current policy if the proof is independently reviewed              |
| Policy revision with compensating controls | Explicit hostile-client model, longer or indefinite protective history, current-authority/version/incarnation/idempotency controls, production sizing and operations evidence | Accepts that checkpoint/clear remain unverified and changes the canonical guarantee |
| Reject the pinned sync selection           | Alternative adapter evaluation with equivalent isolation, revocation, retention, offline and licensing evidence                                                               | Avoids accepting an unsupported checkpoint claim                                    |

Server epoch expiry or honest-client reset alone is not a fourth attestation option and does not satisfy the current canonical gate.

## 6. Technical recommendation and pending approvals

**Technical recommendation:** do not use the PowerSync client checkpoint acknowledgement as authority. Keep every command decision independent of it, do not claim hostile-client `P90D` enforcement or verified wipe, and do not promote create support before Issue #14 defines server-authoritative creation and identity allocation.

| Decision                               | State                                          |
| -------------------------------------- | ---------------------------------------------- |
| Technical limitation characterization  | Implemented in the disposable Issue #8 harness |
| Architecture choice or policy revision | Pending owner decision                         |
| Security residual-risk acceptance      | Pending independent security authority         |
| PowerSync FSL-1.1-ALv2 acceptance      | Pending owner/legal review                     |
| Production adapter approval            | Blocked                                        |

R5b completes only when the selected option, canonical-document change if any, named risk authority, immutable review reference and production acceptance evidence are recorded. Until then Issue #8 remains conditionally feasible for its bounded server-side mechanics, while Issue #45 and complete sync acceptance remain blocked.
