# Retention and Deletion

**Status:** V1 default policy  
**Scope:** Public defaults; managed legal/billing obligations may retain a separate minimal record when documented.  
**Principle:** Retention does not grant content access. Device-only plaintext is never held by the service.

## 1. Default schedule

| Data class | V1 default | Behaviour at expiry |
|---|---:|---|
| Soft-deleted journeys and ordinary owned records | 30 days | Idempotent purge after restore window |
| Personal change/audit events | 2 years | Purge/redact content fields while retaining only required integrity evidence |
| Agency change/audit events | 7 years | Purge/redact according to contract and legal basis |
| Atlas conversations/messages | 30 days from last activity | Delete content; retain minimal tool/change audit without prompt text |
| Superseded provider/source snapshots | 90 days | Purge raw snapshot; retain adopted fact provenance as long as the owned record exists |
| Superseded/deleted central file versions | 30 days | Delete object and version metadata not required for security audit |
| Encrypted device-transfer blob | Until acknowledgement or 24 hours, whichever comes first | Delete blob; retain minimal transfer outcome audit |
| Support and break-glass logs | 7 years | Purge unless an active incident/legal hold applies |
| Cancelled Personal cloud account data | Six-month export-only window | Purge within 30 days after the window ends |
| Backups containing centrally permitted data | 35 days rolling default | Expire through backup lifecycle; document delayed deletion semantics |

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
