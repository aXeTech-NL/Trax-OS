# Retention and Deletion

**Status:** V1 default policy  
**Scope:** Public defaults; managed legal/billing obligations may retain a separate minimal record when documented.  
**Principle:** Retention does not grant content access. Device-only plaintext is never held by the service.

## 1. Default schedule

| Data class | V1 default | Behaviour at expiry |
|---|---:|---|
| Soft-deleted journeys and ordinary owned records | 30 days | Idempotent content purge after restore window |
| Minimal sync deletion/revocation graveyard metadata | 90 days from deletion or revocation | Purge after the connected-sync offline window; stale replicas then require reset |
| Personal change/audit events | 2 years | Purge/redact content fields while retaining only required integrity evidence |
| Agency change/audit events | 7 years | Purge/redact according to contract and legal basis |
| Atlas conversations/messages | 30 days from last activity | Delete content; retain minimal tool/change audit without prompt text |
| Superseded provider/source snapshots | 90 days | Purge raw snapshot; retain adopted fact provenance as long as the owned record exists |
| Superseded/deleted central file versions | 30 days | Delete object and version metadata not required for security audit |
| Encrypted device-transfer blob | Until acknowledgement or 24 hours, whichever comes first | Delete blob; retain minimal transfer outcome audit |
| Support and break-glass logs | 7 years | Purge unless an active incident/legal hold applies |
| Cancelled Personal cloud account data | Six-month export-only window | Purge within 30 days after the window ends |
| Backups containing centrally permitted data | 35 days rolling default | Expire through backup lifecycle; document delayed deletion semantics |

### Connected-sync offline support boundary

The V1 connected-sync offline window is `P90D` (90 consecutive days), measured using authoritative endpoint time from the last **server-recorded eligibility checkpoint**. The endpoint records this checkpoint for a current replica/epoch and endpoint-issued retention target after the official client reports locally observed lifecycle completion. The record is authoritative only for server-owned incremental eligibility; it is honest-client telemetry, not proof of durable local apply or clear. Exactly `P90D` remains inside the boundary; a replica is stale only when the elapsed time is greater than `P90D`.

During this window the endpoint retains only the graveyard fields required to prevent stale resurrection, such as stable resource ID, immutable incarnation, last authoritative version, deletion/revocation time and retention watermark. Deleted payload is not retained for this purpose: recoverable soft-deleted content still expires after 30 days, after which the minimal non-restorable graveyard may remain through day 90.

A connected replica whose eligibility checkpoint predates the retained graveyard floor, including one stale by more than `P90D`, must not upload or reconcile incrementally. Normal checkpoint renewal is closed for that stale epoch. Before an online replica reset/epoch rotation and full resync, the official client places still-authorised pending commands in encrypted, access-controlled quarantine or makes them explicitly exportable by the user. Commands for a revoked scope are terminally denied and securely purged under revocation policy, never made exportable. Reapplication requires explicit user review plus current authorisation, version, incarnation and conflict validation. Issue #46 must define the detailed inbox, unlock/access, export-confirmation, bounded quarantine-retention and secure-deletion behaviour before implementation.

The [connected-sync trust-boundary decision](decisions/ADR-018-CONNECTED-SYNC-TRUST-BOUNDARY.md) accepts that a hostile, copied or rolled-back endpoint can falsely report completion and retain data. Checkpoint/reset reports never replace current server authorisation, replica epoch, expected-version, incarnation or digest-bound idempotency checks. Revocation stops future server access but does not prove remote wipe. Before connected offline create is supported, the endpoint must allocate a fresh immutable entity ID/incarnation; any one-time pre-allocation carries those concrete server-generated values, binds them to current actor/scope/entity type/replica epoch/expiry/digest and is consumed atomically once under current authorisation, so purged identities cannot be resurrected as new creates.

The same boundary applies to Trax Cloud and compatible self-hosted endpoints. A self-hoster may retain graveyard metadata longer, but that does not expand official client support without a reviewed policy change; shortening retention below `P90D` is incompatible with the advertised V1 connected-sync boundary.

Only a workspace explicitly created and kept as standalone local-only authority is exempt because it has no backend sync clock. Going offline or removing endpoint configuration does not convert a formerly connected replica into standalone local authority. Local-only encryption, recovery, export/import and later pairing remain separately gated.

## 2. Atlas conversation rules

- Conversations are creator-private by default.
- The creator can export or delete them before scheduled expiry.
- Agency administrators receive no implicit conversation access.
- Sharing with a journey or party is explicit and creates a new scoped resource/grant.
- Provider-side retention/training terms are disclosed separately and cannot be controlled by deleting the Trax copy.

## 3. Cancellation and export

During the six-month Personal cancellation window:

- hosted product data is read-only except for export and account-security actions;
- exports are available as canonical JSON and generated PDF/XLSX reports;
- device-only files can be exported only from devices that hold decryptable replicas;
- no new sync writes, model usage or hosted research is accepted;
- the UI shows the final deletion date.

Agencies use contract-specific offboarding, with these defaults as the minimum documented baseline.

## 4. Holds and overrides

A legal/security hold:

- applies only to identified data classes and purpose;
- records authoriser, reason, start and review/expiry date;
- does not make device-only plaintext recoverable;
- does not grant support access to retained content;
- is visible in internal compliance audit.

Self-hosters may configure retention, but the application must ship secure defaults and expose effective values through operator configuration—not silently use infinite retention.

## 5. Required evidence

Retention jobs are idempotent and observable. Tests prove deletion from primary data, object storage, transfer storage and normal backup lifecycle. Audit reports contain identifiers/timestamps and outcomes, not deleted payloads.
