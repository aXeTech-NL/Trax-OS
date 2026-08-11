# ADR-018 — Connected-sync eligibility and untrusted endpoint boundary

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner/approver:** repository CODEOWNER (`@Maurice-aXeTech`)
- **Traceability:** [GitHub issue #8](https://github.com/aXeTech-NL/Trax-OS/issues/8), [Issue #45](https://github.com/aXeTech-NL/Trax-OS/issues/45), [`P90D` retention policy](../RETENTION_AND_DELETION.md#connected-sync-offline-support-boundary), [R5a/R5b decision packet](../../security/evidence/ISSUE_8_POWERSYNC_CHECKPOINT_RISK.md)

## Context

Connected sync needs a bounded retention and reset lifecycle, but a general Android or macOS application cannot prove to the backend that a hostile or copied client durably applied replicated state or cleared every local copy. PowerSync exposes a meaningful honest-client completion boundary, not a backend-verifiable local-storage attestation. Hardware-backed keys and app/device integrity signals do not bind an ordinary application signature to a SQLite commit or deletion.

The earlier direction to preserve a hostile-client trusted-checkpoint requirement was assessed and found unavailable in reviewed public general-client APIs. The product owner accepts a narrower guarantee rather than rejecting connected sync: the endpoint owns incremental eligibility and all canonical write decisions, while local lifecycle completion remains untrusted honest-client telemetry.

## Decision

1. The connected-sync support window remains exactly `P90D`. At exactly `P90D` a replica remains incrementally eligible; at endpoint time greater than `P90D`, or when its checkpoint target predates the retained graveyard floor, it is reset-required.
2. A **server-recorded eligibility checkpoint** is endpoint state containing the replica ID, current epoch, endpoint-issued target retention watermark and endpoint acceptance time. The endpoint accepts a lifecycle report only for a current authenticated replica/epoch and one-time endpoint-issued target. The accepted endpoint timestamp—not a client clock—is authoritative only for server-owned incremental eligibility.
3. The lifecycle report says that the official client observed local completion. It may trigger the endpoint-owned transition, but it is not proof of durable local apply, clear, crypto-erasure or remote wipe. A modified, copied or rolled-back client can report falsely; this residual endpoint risk is explicitly accepted for the product architecture.
4. An eligible replica may renew its eligibility checkpoint through the scoped lifecycle flow. Once stale or below the retained floor, normal renewal is closed for that epoch. The official client must quarantine still-authorised pending commands, rotate to a new epoch, clear/reset and complete a full sync before reporting completion. A false reset/full-sync report remains possible and is not represented as attestation.
5. Lifecycle state never grants data or mutation authority. Every download scope is derived from current server relationships. Every uploaded command independently reauthenticates and reauthorises current actor/scope, validates current replica epoch, immutable entity incarnation and expected version, and applies digest-bound idempotency through the canonical command/Unit-of-Work path. Permission checks precede replay disclosure. Revoked-scope work is terminally denied.
6. Current endpoint revocation is the verifiable response to a lost or compromised replica: invalidate its credentials/epoch and deny new downloads/uploads. Trax OS does not claim that revocation remotely deletes plaintext, wrapped keys, exports or other copies already disclosed to an endpoint. Product and support UI must say so.
7. Minimal graveyard metadata remains retained through `P90D`; deleted payload does not. Incremental updates to a missing entity fail, and an old incarnation cannot target a recreated entity. Before connected offline create is supported, the endpoint must allocate the fresh immutable entity ID/incarnation. Any pre-allocation names those concrete server-generated values and binds them to the current actor, scope, entity type, replica epoch, expiry and request digest; the canonical create consumes it atomically once under current authorisation. A client cannot choose or recreate a purged identity. Pairing standalone local-only data is a reviewed import, not identity reuse.
8. Lifecycle evidence is minimized to identifiers, enumerated state/codes, endpoint timestamps, counters and digests. It is operational/security lifecycle data, not proof of endpoint storage state, and must follow the repository's telemetry/audit separation and access rules.
9. A workspace explicitly created and kept as standalone local-only authority has no sync eligibility clock. Going offline, revoking a replica or removing endpoint configuration never converts connected state into standalone authority.

## Required server lifecycle

```text
registered → initial-full-sync-required → eligible
eligible → reset-required → epoch-rotation-pending → full-sync-required → eligible
registered | initial-full-sync-required | eligible | reset-required | epoch-rotation-pending | full-sync-required → revoked
```

Registration alone never establishes upload eligibility. The endpoint records the first eligibility checkpoint only after accepting the current initial-full-sync target report. While eligible, it may issue one-time renewal targets. Crossing `P90D` or the retained floor makes the current epoch reset-required before upload; no ordinary renewal transition leaves that state. A reset request rotates credentials/epoch before a fresh full-sync target is issued. Compromise/admin revocation is terminal for that registration; a replacement device enrols as a new replica instead of reviving the revoked epoch.

Each transition is idempotent and serialized per replica. The endpoint recomputes one predicate before issuing or accepting a normal renewal target, issuing/renewing incremental-download credentials and admitting command upload:

```text
state == eligible
AND endpoint_now <= last_eligibility_checkpoint_at + P90D
AND last_accepted_target_watermark >= retained_graveyard_floor
```

Failure atomically enters `reset-required` before the incremental operation. Renewal acceptance additionally requires its one-time target watermark to be at or above the current floor; a target issued before expiry or floor advancement can never revive the old epoch. Initial/post-reset full-sync completion is accepted only in the matching full-sync-required state for the current epoch and current floor target. Adapter credentials expire no later than the eligibility boundary so an already-open transport cannot silently extend it.

Retried reports must match the same replica, principal, epoch, target, expiry and outcome digest. Lifecycle telemetry is stored separately from command receipts/change events and cannot disclose inaccessible resource state.

## Accepted residual risk and compensating controls

The owner accepts, for the connected-sync product architecture, that a hostile/copied endpoint can falsely report lifecycle completion, retain previously authorised local data indefinitely, acknowledge reset without clearing, and re-envelope never-observed old intent. Such intent can apply only when all current server checks still authorise the same mutation; it is audited as a current write, not treated as old checkpoint authority. Replica credentials cannot prove which copied process applied local state.

Compensating controls are current server authorisation before replay disclosure, immutable incarnation and expected-version checks, digest-bound idempotency, short-scoped replica credentials and immediate epoch revocation, endpoint time plus the exact `P90D`/retained-floor gate, one-time lifecycle targets, reset quarantine with explicit review, server-issued create identity, Issue #9 encryption/key custody/backup exclusion and explicit no-remote-wipe disclosure.

This owner architecture acceptance does not mark `RR-SYNC-004` or any other Phase 0 residual risk independently accepted. Production still requires the threat-model review process, immutable implementation evidence, native hardware validation and named security acceptance.

## Compatibility and migration impact

This decision revises the trust meaning of the checkpoint; it does not lengthen or shorten `P90D`. Existing R5a artifacts remain historical negative-capability evidence and are not rewritten. The disposable R2 protocol is not a production contract: specifically, production must not let a stale epoch return to normal eligibility without the reset/rotation/full-sync lifecycle.

Issue #45 must add a server-owned replica/epoch/eligibility state machine and migrate any earlier checkpoint-derived state explicitly. Compatible self-hosted endpoints implement the same state transitions and exact boundary. PowerSync or another selected adapter may transport downloads and maintain an official-client cache, but no adapter becomes command, policy or local-attestation authority.

## Review and validation evidence

The [checkpoint decision packet](../../security/evidence/ISSUE_8_POWERSYNC_CHECKPOINT_RISK.md) records the 2026-08-11 owner acceptance and the commit-bound R5a run that demonstrated false checkpoint/reset reports while independent server controls held. The [bounded platform assessment](../../security/evidence/ISSUE_8_BACKEND_VERIFIABLE_CHECKPOINT_ALTERNATIVE.md) found no qualifying public general Android/macOS storage-bound primitive. The versioned [Phase 0 threat model](../../security/PHASE_0_THREAT_MODEL.md) retains independent residual-risk closure as pending. `architecture:check` validates this Accepted ADR's metadata, required sections and decision-log entry; `security:check` validates threat-register structure and Markdown parity. These repository checks do not prove runtime behavior or risk closure, and immutable PR/CI review evidence remains pending until the branch is published.

R5b's owner decision is complete, but production capability remains `designed`. Open gates include Issue #9 native encryption/key custody/backup exclusion, server-issued create identity, Issue #46 encrypted quarantine and review UX, policy/RLS equivalence, production sizing and operations, real Android/macOS lifecycle tests, independent security acceptance, immutable CI/review evidence and PowerSync FSL-1.1-ALv2 owner/legal acceptance if PowerSync remains selected.
