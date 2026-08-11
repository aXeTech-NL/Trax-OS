# Issue #8 backend-verifiable checkpoint alternative assessment

**Status:** historical bounded public-platform capability assessment negative for general Android and macOS; its direction was superseded by ADR-018

**Assessment date:** 2026-08-11

**Assessed owner direction at that time:** preserve the then-canonical trusted-checkpoint interpretation and evaluate a backend-verifiable alternative

**Later decision:** after this negative result, the owner accepted the narrower [ADR-018 connected-sync trust boundary](../../architecture/decisions/ADR-018-CONNECTED-SYNC-TRUST-BOUNDARY.md). This assessment remains evidence for why lifecycle reports cannot be called local apply/clear attestation. It is not itself a policy revision, native support claim or production approval.

## Assessment inventory

This is a bounded review of public interfaces and documentation retrieved on 2026-08-11:

- PowerSync Service `1.23.3`, `@powersync/node` `0.20.2` and SQLite core `0.5.2` at the pinned commits below;
- Android Keystore (`KeyGenParameterSpec`, API 23+), key attestation (API 24+), StrongBox (API 28+), current Play Integrity documentation and KeyMint HAL source at commit `1a56e38edc2f2f6189ef405ee1edce554e15cbc0`;
- macOS App Attest declarations (macOS 11+), Secure Enclave/Keychain APIs on Apple Silicon and Managed Device Attestation (managed Apple Silicon, macOS 14+); and
- the ordinary application threat boundary, not private vendor APIs, custom silicon or an externally certified trusted application.

Mutable vendor documentation and future platform releases are re-evaluation triggers. Apple publishes macOS-specific material in its App Attest server-validation documentation despite explicitly documenting `isSupported == false` for apps running on Mac; every future supported macOS version therefore requires a runtime capability check.

## 1. Required property

The backend must be able to distinguish these two executions for one registered replica, epoch and retention watermark:

1. the canonical delta is durably committed to the authoritative local replica before a receipt is emitted; and
2. a hostile or copied endpoint emits the same protocol receipt without installing that state.

A reset proof additionally has to distinguish a trusted crypto-erasure/reinitialisation transition for the component-managed authoritative replica from a client that skips that transition or rolls the managed store back. No endpoint mechanism can prove remote wipe or non-retention of plaintext that was legitimately disclosed outside the trusted component; an old export, screenshot or hostile pre-reset copy remains explicitly unprovable.

The proof must therefore bind all of the following:

- a non-copyable replica identity;
- the exact endpoint-issued checkpoint identifier and retention watermark;
- a durable and rollback-resistant local commit;
- a signing operation that cannot be invoked independently of that commit;
- managed-store reset/key-destruction state that cannot be rolled back; and
- fresh server challenges plus monotonic anti-replay state, held by the trusted component or backend.

A server-derived full-replica root is one possible strengthening, not a universal requirement. Any design that uses one must first define deterministic row canonicalisation, the exact authorised subscription/scope snapshot and treatment of local-only/application tables.

## 2. PowerSync capability result

The pinned scope is PowerSync Service `1.23.3`, `@powersync/node` `0.20.2` and PowerSync SQLite core `0.5.2`.

PowerSync has a meaningful honest-client local boundary: SQLite core handles `checkpoint_complete`, applies downloaded state and updates local sync state before the JavaScript status transition is observed. The service-side checkpoint has a different meaning: the service protocol defines completion after all data for the checkpoint has been **sent**. The service exposes no inbound, device-bound receipt proving that the client applied that checkpoint.

The public Node API exposes `hasSynced`, `lastSyncedAt`, status listeners and `waitForFirstSync()`, but not a cryptographic exact-watermark receipt visible to the application backend. An internal applied checkpoint request ID in the pinned core is not exposed as a trusted server acknowledgement. Write checkpoints cover uploaded writes entering the source replication stream; they travel in the opposite direction and do not attest local download application.

`disconnectAndClear()` performs local work and emits no trusted network deletion receipt. The ordinary client ID is SQLite state and is copied with the database.

Primary sources:

- [PowerSync Service v1.23.3 sync protocol](https://github.com/powersync-ja/powersync-service/blob/v1.23.3/docs/specs/sync-protocol.md#L60-L76)
- [Service v1.23.3 checkpoint/data stream](https://github.com/powersync-ja/powersync-service/blob/v1.23.3/packages/service-core/src/sync/sync.ts#L438-L518)
- [Service v1.23.3 protocol request/response types](https://github.com/powersync-ja/powersync-service/blob/v1.23.3/packages/service-core/src/util/protocol-types.ts#L58-L130)
- [SQLite core v0.5.2 checkpoint application](https://github.com/powersync-ja/powersync-sqlite-core/blob/c5c231342fe883b3437e86dc7e0a4a010d105846/crates/core/src/sync/streaming_sync.rs#L332-L380)
- [Node SDK 0.20.2 transaction commit boundary](https://github.com/powersync-ja/powersync-js/blob/d78287483ad1a5d651b6e8c38542efbd62963beb/packages/common/src/db/DBAdapter.ts#L258-L275)
- [Node SDK 0.20.2 public sync status](https://github.com/powersync-ja/powersync-js/blob/d78287483ad1a5d651b6e8c38542efbd62963beb/packages/common/src/db/crud/SyncStatus.ts#L80-L94)
- [Node SDK 0.20.2 local clear](https://github.com/powersync-ja/powersync-js/blob/d78287483ad1a5d651b6e8c38542efbd62963beb/packages/shared-internals/src/client/BasePowerSyncDatabase.ts#L410-L426)

**Result:** an honest wrapper can report a post-commit local observation, but PowerSync does not supply the backend-verifiable, hostile/copied-client property required by R5b.

## 3. Why ordinary cryptographic wrappers do not close the gate

| Candidate control          | What it proves                       | Missing property                                                       |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Server nonce/challenge     | Fresh response and replay resistance | The client can answer without applying state                           |
| HMAC or software signature | Possession of a copyable secret      | A copied/hostile client can produce the same receipt                   |
| Hardware-backed signature  | Use of a non-exportable device key   | Ordinary app code can ask the key to sign a false state claim          |
| Merkle root/state digest   | Knowledge of the expected state      | State can be hashed without becoming the durable authoritative replica |
| TLS delivery/socket close  | Bytes reached a transport endpoint   | No durable SQLite application                                          |
| Epoch/credential rotation  | Old server authority is revoked      | Old local plaintext, keys, snapshots and unseen intent may remain      |
| Signed clear intent        | A key signed before or around reset  | No proof of the post-delete state or destruction of copies             |
| Application crypto-erasure | Honest code deleted or dropped a key | No proof that a hostile client did not copy the key/plaintext first    |

For every wrapper above, a hostile process with access to the same signing API can produce the server-visible message from expected inputs without performing the claimed database transition. The backend observations are therefore indistinguishable. Stronger cryptography around the same client assertion reproduces the R5a trust gap rather than removing it.

## 4. Android platform gate

Android can provide a backend-verifiable device-bound key and app/device integrity evidence:

- Android Keystore and StrongBox can make private key material non-exportable;
- key attestation exposes key origin, security level, root of trust, OS/patch state and application identity;
- Play Integrity can bind a server challenge or request hash to app/licensing/device-integrity verdicts; and
- the KeyMint HAL defines optional rollback-resistant key deletion on qualifying implementations.

`ROLLBACK_RESISTANCE` is a KeyMint implementation capability, not a public `KeyGenParameterSpec.Builder` option available to an ordinary application. These mechanisms do not measure arbitrary SQLite pages or couple a signature to a SQLite transaction. Android explicitly separates protection against key extraction from the possibility that a compromised OS uses the key on-device. Attestation challenges and Play Integrity request hashes are application-supplied opaque data; the hardware/service does not verify that they equal a durable database state. Key deletion returns no remotely verifiable post-deletion certificate, and rollback-resistant deletion support is not universal.

Primary sources:

- [Android Keystore security properties and compromise boundary](https://developer.android.com/privacy-and-security/keystore)
- [Android hardware-backed key attestation](https://developer.android.com/privacy-and-security/security-key-attestation)
- [Android attestation record fields](https://source.android.com/docs/security/features/keystore/attestation)
- [Play Integrity verdict semantics](https://developer.android.com/google/play/integrity/verdicts)
- [Play Integrity standard request binding](https://developer.android.com/google/play/integrity/standard)
- [Pinned KeyMint rollback-resistance tag](https://android.googlesource.com/platform/hardware/interfaces/+/1a56e38edc2f2f6189ef405ee1edce554e15cbc0/security/keymint/aidl/android/hardware/security/keymint/Tag.aidl#217)
- [Pinned KeyMint deletion contract](https://android.googlesource.com/platform/hardware/interfaces/+/1a56e38edc2f2f6189ef405ee1edce554e15cbc0/security/keymint/aidl/android/hardware/security/keymint/IKeyMintDevice.aidl#540)

**Result:** Android public application APIs establish a stronger replica identity and integrity signal, but no storage-owning `commit_and_attest` or `reset_and_attest` primitive was identified.

## 5. macOS Apple Silicon platform gate

Secure Enclave keys on Apple Silicon can be non-exportable and device-bound. Keychain access controls, Developer ID signing, notarization and the hardened runtime improve key-use and application-distribution security. None attests arbitrary SQLite contents, durability or deletion.

App Attest cannot supply the missing binding on Mac: Apple documents that `DCAppAttestService.isSupported` is `false` for an app running on a Mac, including native Mac, Mac Catalyst and iOS/iPadOS-on-Apple-Silicon execution. Even where App Attest is supported, its assertion signs an application-provided client-data hash and proves app-instance/request integrity rather than the truth of a database claim.

Managed Device Attestation on managed Apple Silicon Macs can attest device identity and posture and provision hardware-bound credentials. It is a device-management/ACME facility, not a general application API, and does not attest the replica agent, SQLite state or deletion.

Primary sources:

- [Apple `DCAppAttestService.isSupported`](https://developer.apple.com/documentation/devicecheck/dcappattestservice/issupported)
- [Apple App Attest integrity and assertion model](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- [Apple Secure Enclave key protection](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)
- [Apple hardened runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [Apple notarization boundary](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple Managed Device Attestation](https://support.apple.com/guide/security/managed-device-attestation-sec8a37b4cb2/web)

**Result:** no public macOS primitive was identified that remotely attests an atomic protected-store commit or clear. App Attest is not operational for Mac apps.

## 6. Minimum technically plausible architecture

A qualifying **Trusted Replica Authority (TRA)** would have to be more than an ordinary application wrapper:

1. It exclusively owns the encrypted replica store, plaintext access, store key, attestation key and rollback-resistant counter.
2. The UI, sync connector and ordinary application cannot directly mutate the store or invoke a generic signing oracle.
3. The endpoint issues `{replica, epoch, checkpoint_id, target_watermark, nonce}` plus an expected root only when that optional root contract is fully defined.
4. One trusted operation applies and durably commits the canonical delta plus a sealed `{checkpoint_id, watermark, counter}` header and any defined root, then signs that committed header.
5. The backend verifies the component measurement, non-exportable key binding, nonce, epoch, checkpoint, counter and any defined server-derived root before advancing `last_authoritative_sync`.
6. Commands bind to the accepted receipt digest and still undergo current authorisation, expected-version, incarnation and idempotency checks.
7. A separate trusted reset operation destroys the sole old TRA-managed store key, advances rollback-resistant epoch state, creates the fresh managed store and emits an attested post-reset receipt. This proves at most crypto-erasure of that managed authoritative replica, not deletion of plaintext previously exposed outside the TRA.

Required states are `registered → syncing → attested-current → stale → reset-required → reset-attested → full-syncing → attested-current`.

No qualifying storage-owning trusted component is exposed by the reviewed general Android or macOS application APIs. Simulating this TRA in Node, SQLite, a normal native process or a container would prove only a protocol under an assumed oracle. It would not provide the platform property selected in R5b and must not be presented as closure evidence.

## 7. Mandatory falsification suite if a real primitive becomes available

A future candidate must reject or safely recover from:

- raw HTTP acknowledgement and valid-key signing without database apply;
- Merkle calculation without installation;
- copied database, sidecar and software-visible credentials;
- same-key use from modified, downgraded, rooted or re-signed clients;
- receipt, challenge, nonce, watermark and epoch replay;
- database, sealed-header and counter rollback;
- crashes before commit, after commit, before signing, after signing and after backend acceptance;
- response loss and idempotent retry at every transition;
- corrupt, omitted, additional, wrong-scope and revoked rows;
- authorisation/revocation races during receipt verification;
- exact `P90D`, `P90D + ε` and retained-floor advancement;
- snapshot/backup restoration and old-key use after reset;
- hardware-attestation trust-root and revocation changes; and
- real-device restart, power-loss, key-loss, migration and recovery on every supported Android/macOS version.

Evidence must remain sanitized to enumerated codes, booleans, counts and digests. Hardware identity, keys, tokens, payloads, local paths and raw attestation certificates must not enter retained artifacts.

## 8. Gate conclusion

As of this bounded assessment, **no implementation path for direction 1 was identified in the reviewed public APIs for the intended general Android and macOS clients under the current hostile/copied-endpoint requirement**. The limitation is at the endpoint trust boundary, so changing sync engines alone does not fix it unless the new environment also supplies the missing storage-bound trust primitive.

No software-only implementation spike is authorized by this result. Building one would demonstrate honest-client state-machine mechanics already bounded by R5a/R2-R4, not backend-verifiable durable apply or clear.

This assessment made none of the then-pending follow-up decisions. The owner subsequently selected policy revision in ADR-018 with named product-architecture residual-risk acceptance: exact `P90D` now governs server-recorded eligibility and the official-client lifecycle, not a hostile-client proof of durable local apply or clear.

That later choice resolves the missing owner decision, not production acceptance. Issue #45 still requires the ADR-018 state machine, independent command controls, create identity, native/operations evidence, independent security review and any selected adapter's legal approval. A future qualified storage-owning primitive may trigger re-evaluation, but it is not required by the revised general-client product guarantee.
