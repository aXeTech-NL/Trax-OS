# Phase 0 Threat Model

**Status:** Integrated design baseline; independent review and residual-risk acceptance pending
**Model:** `TM-PHASE0-001` version `1.1.0`
**Architecture baseline:** `78c6b5dd8aa4a35c2bcb747c2ce154ea9b363bc1`
**Tracking:** [GitHub issue #10](https://github.com/aXeTech-NL/Trax-OS/issues/10)

## 1. Purpose and authority

This document and the authored [`phase-0-threat-model.json`](phase-0-threat-model.json) cover identity, access, native local authority, sync, documents, Atlas/MCP and self-hosting. The normalized register contains 43 trust boundaries, 48 threats, 49 controls and 48 residual-risk records. Every boundary traces to accountable maintainer roles and verification. English canonical architecture remains authoritative; this model cannot silently choose product, cryptographic, OAuth, sync or deployment details.

The register is public architectural analysis. Do not add exploit details, credentials, participant data, private keys or real identity/medical/travel documents. Suspected vulnerabilities follow the private process in [`SECURITY.md`](../../SECURITY.md).

## 2. Outcome, dependencies and non-goals

- **Outcome:** a versioned seven-domain threat model and deterministic completeness/parity gate.
- **Inputs/reopening triggers:** issues [#2](https://github.com/aXeTech-NL/Trax-OS/issues/2), [#6](https://github.com/aXeTech-NL/Trax-OS/issues/6), [#7](https://github.com/aXeTech-NL/Trax-OS/issues/7), [#8](https://github.com/aXeTech-NL/Trax-OS/issues/8), [#9](https://github.com/aXeTech-NL/Trax-OS/issues/9) and [#11](https://github.com/aXeTech-NL/Trax-OS/issues/11). Issue #68 is navigation only.
- **Current baseline:** only authenticated/session persistence and server-derived Personal access/RLS are partial. Identity verification/recovery/MFA/invitations, expanded roles/break-glass/revocation, native authority, PowerSync, document crypto, notifications, Atlas/MCP, telemetry/audit operations and production self-hosting are not implemented.
- **Non-goals:** implementing those future systems, choosing cryptographic suites/token formats/sync-adapter topology, reviving browser-local authority, proving hostile-client local apply/clear, or treating planned evidence as proof. ADR-018 now selects the server-owned eligibility lifecycle; its implementation remains future work.

## 3. Method and risk rubric

Threat categories are STRIDE plus privacy, abuse and supply-chain. Likelihood is `unlikely=1`, `possible=2`, `likely=3`; impact is `limited=1`, `serious=2`, `severe=3`, `critical=4`. Score is likelihood × impact: low 1–2, medium 3–4, high 6–8, critical 9–12. This rubric assesses security exposure and is distinct from the Level 1–3 action-confirmation policy.

All declared categories are represented by at least one threat: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege, privacy, abuse and supply chain. Representative resource-exhaustion threats cover public authentication, sync queues/replication, upload/scanning, provider/safe-fetch and worker/dependency surfaces.

Each register boundary has typed assets and data flows; each threat has specific preconditions, inherent risk, controls, an accountable owner role, evidence and a post-control rationale explaining what remains and why likelihood/impact change. Structural completeness does not establish control quality.

## 4. Authority and data-flow invariants

```text
Untrusted client / native replica / OAuth client / model / worker
  → authenticated adapter
  → server-derived principal and workspace/journey/party/resource scope
  → policy-filtered query or canonical versioned command
  → one Unit of Work, change/audit record and controlled integration ports
  → PostgreSQL / approved stores / explicitly scoped replicas
```

- Web remains authenticated and server-backed; browser state is disposable.
- Native Android/macOS alone may own accountless local authority after their separate gates.
- Adapters, sync, Atlas, MCP and workers never gain an alternate write path.
- Device-only plaintext and usable keys never enter server, support, Atlas, telemetry or backups.
- Notification delivery never proves identity or activates membership.
- Operational telemetry and application/sensitive-read audit are separate, typed stores; non-essential telemetry exposes a clear opt-out.
- Cancellation, export, holds, purge and backup delay preserve purpose, scope and current authorization.
- Capabilities and managed entitlements never replace authorization.
- Self-hosting preserves the complete public functional core.

## 5. Trust-boundary inventory

### Identity (`DOM-IDENTITY`)

Current capability: **partial**. Accountable role: `OWN-IDENTITY`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-IDENTITY-001` Untrusted client to authentication boundary | `partial` | Untrusted client → Authentication API | `TH-IDENTITY-001` An attacker abuses credentials, enumerates accounts, fixes or steals a session, or forges a state-changing request. | `MIT-IDENTITY-001` Use the current privacy-neutral authentication responses, Argon2id password verification, opaque random sessions stored only as SHA-256 token hashes, HttpOnly/SameSite cookies, double-submit CSRF checks and server-derived Personal principals.; `MIT-IDENTITY-006` Add session rotation/reuse detection, current device/session inventory, compromise-wide revocation, security-event audit and reauthentication policy before claiming complete identity lifecycle security. | `EV-IDENTITY-CURRENT` (available), `EV-IDENTITY-PLANNED` (planned) | `RR-IDENTITY-001` medium; pending explicit Phase 0 acceptance |
| `TB-IDENTITY-002` Authentication service to credential and session store | `partial` | Authentication service → Server-only credential store | `TH-IDENTITY-002` A storage or application flaw exposes credentials, accepts forged session state, or fails to revoke a session. | `MIT-IDENTITY-002` Keep password and session records server-only, persist only Argon2id password hashes and SHA-256 session-token hashes, and revoke the presented session during logout.; `MIT-IDENTITY-006` Add session rotation/reuse detection, current device/session inventory, compromise-wide revocation, security-event audit and reauthentication policy before claiming complete identity lifecycle security. | `EV-IDENTITY-CURRENT` (available), `EV-IDENTITY-PLANNED` (planned) | `RR-IDENTITY-002` low; pending explicit Phase 0 acceptance |
| `TB-IDENTITY-003` Verification, recovery, MFA and device channel | `not-implemented` | Unverified external channel → Verified account security context | `TH-IDENTITY-003` An attacker replays or intercepts recovery material, enrolls a factor, or exploits a weaker recovery path to take over an account. | `MIT-IDENTITY-003` Require single-purpose hashed expiring tokens, strong reauthentication, mandatory MFA for privileged roles, recovery-code rotation and security notifications. | `EV-IDENTITY-PLANNED` (planned) | `RR-IDENTITY-003` high; pending explicit Phase 0 acceptance |
| `TB-IDENTITY-004` Invitation or local identity to server principal | `not-implemented` | Invitation/native local principal → Server identity and scoped membership | `TH-IDENTITY-004` A replayed or misbound invitation/pairing claim links the wrong principal or grants broader workspace access. | `MIT-IDENTITY-004` Bind single-use invitations/pairing to verified identity, exact workspace/journey/party scope and explicit conflict review; never derive staff access. | `EV-IDENTITY-PLANNED` (planned) | `RR-IDENTITY-004` medium; pending explicit Phase 0 acceptance |
| `TB-IDENTITY-005` Notification and email delivery | `not-implemented` | Policy-filtered application/outbox → External delivery provider and recipient channel | `TH-IDENTITY-005` A recovery or invitation token, recipient address, party-private detail or security message is sent to the wrong recipient, exposed in provider telemetry, or reused as proof of activated access. | `MIT-IDENTITY-007` Minimise template fields, resolve recipient/audience server-side, hash and expire single-purpose tokens, redact provider logs, prevent message delivery from activating access, and test wrong-party/recipient cases. | `EV-NOTIFICATION-PLANNED` (planned) | `RR-IDENTITY-005` medium; pending explicit Phase 0 acceptance |

Additional cross-boundary/resource-exhaustion threats:

| Threat | Attached boundaries | Scenario | Controls | Evidence | Residual risk |
|---|---|---|---|---|---|
| `TH-IDENTITY-006` | `TB-IDENTITY-001` | Automated registration/login attempts consume Argon2 CPU, database connections or session storage and deny legitimate authentication. | `MIT-IDENTITY-005` Apply endpoint/account/network-aware rate limits, bounded concurrency and timeouts, generic backoff responses, abuse metrics without identifiers, and capacity tests that preserve privacy-neutral errors. | `EV-IDENTITY-PLANNED` (planned) | `RR-IDENTITY-006` medium; pending explicit Phase 0 acceptance |

### Access and privacy (`DOM-ACCESS`)

Current capability: **partial**. Accountable role: `OWN-ACCESS`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-ACCESS-001` Client IDs to server-derived execution context | `partial` | Untrusted adapter input → Trusted execution context | `TH-ACCESS-001` A client spoofs actor/scope/confirmation or uses an object ID to cross workspace, journey, party or traveller boundaries. | `MIT-ACCESS-001` Derive execution context on the server, resolve object ownership/audience for every lookup and return privacy-neutral not-found results. | `EV-ACCESS-CURRENT` (available), `EV-ACCESS-PLANNED` (planned) | `RR-ACCESS-001` medium; pending explicit Phase 0 acceptance |
| `TB-ACCESS-002` Application policy and queries to PostgreSQL/RLS | `partial` | Application policy/query layer → PostgreSQL with RLS | `TH-ACCESS-002` A policy gap, direct adapter write or RLS mismatch exposes or mutates data outside the evaluated scope. | `MIT-ACCESS-002` Use canonical server-backed Personal handlers, server-side workspace filtering and the transaction-local PostgreSQL user setting with RLS as defence in depth. | `EV-ACCESS-CURRENT` (available), `EV-ACCESS-PLANNED` (planned) | `RR-ACCESS-002` medium; pending explicit Phase 0 acceptance |
| `TB-ACCESS-003` Scoped roles, audiences and delegation | `not-implemented` | Role/grant administration → Protected resource audiences | `TH-ACCESS-003` A custom role, transitive party relationship or delegation grants permissions the actor does not hold. | `MIT-ACCESS-003` Evaluate invariants and denies first, limit assignments to explicit scope, prevent undelegable grants and keep party access non-transitive. | `EV-ACCESS-PLANNED` (planned) | `RR-ACCESS-003` medium; pending explicit Phase 0 acceptance |
| `TB-ACCESS-004` Support and operator break-glass | `not-implemented` | Operational administration → Customer content plane | `TH-ACCESS-004` An operator uses standing privilege, weak reauthentication or an unaudited export to access customer content. | `MIT-ACCESS-004` Require a case, MFA/reauthentication, selected workspace, least privilege, short expiry, immutable sensitive-read audit and separate export approval. | `EV-ACCESS-PLANNED` (planned) | `RR-ACCESS-004` medium; pending explicit Phase 0 acceptance |
| `TB-ACCESS-005` Revocation to sessions, caches and replicas | `not-implemented` | Authoritative access policy → Sessions, caches and offline replicas | `TH-ACCESS-005` Stale sessions or an offline client retain data after access is revoked or reintroduce it through a conflict. | `MIT-ACCESS-005` Invalidate sensitive sessions immediately, emit revocation tombstones, purge only lost scopes and revalidate every uploaded command. | `EV-ACCESS-PLANNED` (planned) | `RR-ACCESS-005` medium; pending explicit Phase 0 acceptance |

### Native local authority (`DOM-NATIVE`)

Current capability: **not-implemented**. Accountable role: `OWN-NATIVE`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-NATIVE-001` Person and OS account to local principal | `not-implemented` | Physical/OS user → Native local application | `TH-NATIVE-001` Device theft, shared OS access or an unlocked compromised endpoint lets another person act as the local principal. | `MIT-NATIVE-001` Use OS authentication and secure storage, explicit local identity state, lock/timeout policy and clear endpoint-compromise limitations. | `EV-NATIVE-PLANNED` (planned) | `RR-NATIVE-001` high; pending explicit Phase 0 acceptance |
| `TB-NATIVE-002` Native application to encrypted local database | `not-implemented` | Native process → Encrypted SQLite store | `TH-NATIVE-002` Filesystem access, rollback or application compromise reads or silently modifies authoritative local records. | `MIT-NATIVE-002` Use reviewed encrypted persistence, authenticated integrity/versioning, canonical command/change semantics and migration/restart tests. | `EV-NATIVE-PLANNED` (planned) | `RR-NATIVE-002` medium; pending explicit Phase 0 acceptance |
| `TB-NATIVE-003` Runtime to OS keystore and device keys | `not-implemented` | Application runtime → OS key custody | `TH-NATIVE-003` Keys are exported through weak fallback storage, OS backup, debugging or a compromised unlocked runtime. | `MIT-NATIVE-003` Require reviewed Keychain/Android Keystore custody, non-exportability where supported, no insecure fallback and platform compromise tests. | `EV-NATIVE-PLANNED` (planned) | `RR-NATIVE-003` medium; pending explicit Phase 0 acceptance |
| `TB-NATIVE-004` Local authority to backup, export and import | `not-implemented` | Encrypted local authority → OS backup and user-controlled export/import | `TH-NATIVE-004` OS backup or an unprotected export leaks data; a tampered or rollback import destroys or rewrites authority. | `MIT-NATIVE-004` Exclude app-managed/implicit cloud backup, use explicit versioned export, validate before atomic import and disclose loss/recovery limits. | `EV-NATIVE-PLANNED` (planned) | `RR-NATIVE-004` medium; pending explicit Phase 0 acceptance |
| `TB-NATIVE-005` Local authority to server pairing | `not-implemented` | Standalone native authority → Authenticated self-hosted server | `TH-NATIVE-005` A malicious server/device impersonates pairing or silent last-write-wins loses or broadens local data. | `MIT-NATIVE-005` Authenticate both sides, preview full/selective import, preserve stable IDs and require explicit device/cloud/reviewed merge for real conflicts. | `EV-NATIVE-PLANNED` (planned) | `RR-NATIVE-005` medium; pending explicit Phase 0 acceptance |

### Synchronisation and replicas (`DOM-SYNC`)

Current capability: **not-implemented**. Accountable role: `OWN-SYNC`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-SYNC-001` Encrypted local replica to replication service | `not-implemented` | Native encrypted replica → PowerSync replication service | `TH-SYNC-001` A token, subscription rule or service compromise sends records from another workspace or party. | `MIT-SYNC-001` Use short-scoped credentials, server-derived subscriptions, encrypted transport/local storage and negative workspace/party replication tests. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-001` medium; pending explicit Phase 0 acceptance |
| `TB-SYNC-002` Replication rules to scoped PostgreSQL source | `not-implemented` | Replication control plane → Authoritative PostgreSQL | `TH-SYNC-002` A rule/configuration error or privileged service role bypasses application/RLS isolation. | `MIT-SYNC-002` Review/version rules, minimize DB privileges, preserve RLS where supported and gate changes with cross-scope fixtures. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-002` medium; pending explicit Phase 0 acceptance |
| `TB-SYNC-003` Durable command queue to canonical upload | `not-implemented` | Untrusted offline queue → Canonical command/policy handlers | `TH-SYNC-003` A client alters actor/scope, replays IDs, collides idempotency keys or exploits conflict handling to bypass current policy. | `MIT-SYNC-003` Treat queue contents as untrusted, reauthenticate and reauthorize, enforce idempotency/version checks and expose explicit conflicts. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-003` medium; pending explicit Phase 0 acceptance |
| `TB-SYNC-004` Revocation and eligibility to official-client purge | `not-implemented` | Authoritative revocation/eligibility state → Potentially offline untrusted replica; lifecycle telemetry returns | `TH-SYNC-004` A permanently offline, copied, rolled-back or hostile device retains previously authorized data and keys, falsely reports sync/reset lifecycle completion or re-envelopes unseen intent after revocation or expiry. | `MIT-SYNC-004` Invalidate current grants and replica epochs server-side; enforce endpoint-time P90D and retained-floor eligibility; bind lifecycle reports to one-time replica/epoch targets but treat them only as telemetry; independently check current authorization, version, incarnation and idempotency; quarantine/reset official clients and disclose that remote wipe is not guaranteed. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-004` medium; owner product scope accepted in ADR-018, independent Phase 0 acceptance pending |
| `TB-SYNC-005` Operator or vendor to sync control plane | `not-implemented` | Self-host operator/vendor → Sync configuration and credentials | `TH-SYNC-005` Vendor outage, licence restriction, unsafe upgrade or operator misconfiguration breaks self-host parity or isolation. | `MIT-SYNC-005` Require reproducible self-host deployment, pinned compatible versions, least-privilege admin access, rollback and issue #8 feasibility evidence. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-005` low; pending explicit Phase 0 acceptance |

Additional cross-boundary/resource-exhaustion threats:

| Threat | Attached boundaries | Scenario | Controls | Evidence | Residual risk |
|---|---|---|---|---|---|
| `TH-SYNC-006` | `TB-SYNC-001`, `TB-SYNC-003` | A client or compromised sync identity creates unbounded subscriptions, command retries, conflicts or tombstones that exhaust replication, upload or reconciliation capacity. | `MIT-SYNC-006` Bound subscription scope and batch/queue sizes, rate-limit per principal/device, cap retries with explicit failed state, apply backpressure and test large queues/conflict storms without dropping tombstones. | `EV-SYNC-PLANNED` (planned) | `RR-SYNC-006` medium; pending explicit Phase 0 acceptance |

### Documents and device security (`DOM-DOCUMENTS`)

Current capability: **not-implemented**. Accountable role: `OWN-DOCUMENTS`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-DOCUMENTS-001` Sensitive plaintext to client-side encryption | `not-implemented` | Trusted client plaintext memory → Ciphertext and wrapped-key domain | `TH-DOCUMENTS-001` A compromised client, incorrect crypto framing or plaintext staging exposes a sensitive document to server/storage. | `MIT-DOCUMENTS-001` Keep plaintext/key client-side, use reviewed authenticated encryption/key wrapping, minimize memory/files and prove server never obtains usable keys. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-001` medium; pending explicit Phase 0 acceptance |
| `TB-DOCUMENTS-002` Trusted device keys to temporary transfer | `not-implemented` | Trusted device identity → Temporary encrypted transfer store | `TH-DOCUMENTS-002` Key substitution, replay or a revoked/incorrect target device receives a decryptable replica. | `MIT-DOCUMENTS-002` Authenticate device keys/enrollment, bind transfer to document and targets, prevent replay/downgrade, verify checksum and delete after ack/expiry. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-002` medium; pending explicit Phase 0 acceptance |
| `TB-DOCUMENTS-003` Trusted device to memory-only browser view | `not-implemented` | Trusted device → Untrusted browser runtime via E2E session | `TH-DOCUMENTS-003` XSS, browser cache/service worker, relay confusion or session replay persists or redirects plaintext. | `MIT-DOCUMENTS-003` Require device approval, authenticated one-time peer/session keys, strict expiry, memory-only rendering/cache exclusion and access audit. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-003` medium; pending explicit Phase 0 acceptance |
| `TB-DOCUMENTS-004` Central upload to scanner and object store | `not-implemented` | Untrusted uploaded bytes → Quarantine/scanner/object storage | `TH-DOCUMENTS-004` Polyglot/archive malware, scanner failure, signed-URL overreach or TOCTOU makes unverified content available/current. | `MIT-DOCUMENTS-004` Use server-generated object keys, method/object-scoped expiry, isolated fail-closed scanning and atomic verified-version promotion. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-004` low; pending explicit Phase 0 acceptance |
| `TB-DOCUMENTS-005` Document metadata to APIs and observers | `not-implemented` | Policy-protected metadata → API, Atlas/MCP, support, audit and backups | `TH-DOCUMENTS-005` Metadata, counts, checksums or telemetry reveal identity/health/document facts across parties or to models/support. | `MIT-DOCUMENTS-005` Minimize metadata, apply audience/field filtering and sensitive-read audit; expose metadata-only to Atlas and never generic content access. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-005` low; pending explicit Phase 0 acceptance |
| `TB-DOCUMENTS-006` Storage lifecycle to retention and deletion jobs | `not-implemented` | Live and superseded storage → Deletion jobs and backup lifecycle | `TH-DOCUMENTS-006` Failed/idempotency-broken cleanup leaves undeclared copies or logs deleted payloads as evidence. | `MIT-DOCUMENTS-006` Use idempotent observable purge across all stores, secure defaults, minimal outcome-only audit and documented backup deletion delay. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-006` low; pending explicit Phase 0 acceptance |

Additional cross-boundary/resource-exhaustion threats:

| Threat | Attached boundaries | Scenario | Controls | Evidence | Residual risk |
|---|---|---|---|---|---|
| `TH-DOCUMENTS-007` | `TB-DOCUMENTS-004` | Many files, archives, decompression bombs or abandoned signed uploads consume object storage, scanner CPU/memory or quarantine capacity. | `MIT-DOCUMENTS-007` Enforce pre/post-upload size and content limits, archive expansion/depth limits, per-principal quotas, isolated scanner resources/timeouts, abandoned-upload cleanup and fail-closed backpressure. | `EV-DOCUMENTS-PLANNED` (planned) | `RR-DOCUMENTS-007` medium; pending explicit Phase 0 acceptance |

### Atlas, MCP and agent research (`DOM-ATLAS-MCP`)

Current capability: **not-implemented**. Accountable role: `OWN-ATLAS-MCP`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-ATLAS-MCP-001` User to provider selection and disclosure | `not-implemented` | Authenticated user → External/local model provider | `TH-ATLAS-MCP-001` A user misunderstands provider processing/retention or an entitlement is mistaken for authority. | `MIT-ATLAS-MCP-001` Show provider/runtime disclosure, require explicit selection, minimize context and keep capability/entitlement separate from authorization. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-001` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-002` Atlas orchestration to CredentialStore | `not-implemented` | Atlas/model router → Approved secret store | `TH-ATLAS-MCP-002` A key leaks through database, logs, backups, support access, cross-workspace lookup or runtime memory. | `MIT-ATLAS-MCP-002` Store only opaque references, scope workload access by workspace/config, redact all observability, rotate/delete without returning prior values. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-002` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-003` Controlled egress to custom provider endpoint | `not-implemented` | Hardened egress adapter → User-configurable network endpoint | `TH-ATLAS-MCP-003` SSRF, DNS rebinding, redirects, alternate IP forms or headers reach private/metadata services or exfiltrate context. | `MIT-ATLAS-MCP-003` Validate URL/DNS before and during connection, deny forbidden networks in managed mode, revalidate redirects, constrain ports/headers/size/time. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-003` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-004` OAuth client to authorization server and MCP | `not-implemented` | External client → OAuth/MCP boundary | `TH-ATLAS-MCP-004` Redirect abuse, code/token interception, refresh replay or audience confusion impersonates or over-scopes a user. | `MIT-ATLAS-MCP-004` Use exact redirect validation, PKCE, short-lived tokens, refresh rotation/reuse detection, resource/audience checks, revocation and explicit consent. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-004` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-005` MCP adapter to canonical application core | `not-implemented` | MCP tool/resource input → Canonical policies, queries and commands | `TH-ATLAS-MCP-005` Schema injection, represented-user confusion or an adapter-specific write bypasses policy/change/audit. | `MIT-ATLAS-MCP-005` Generate/validate bounded schemas, derive scope server-side, filter resources and route mutations only through canonical handlers. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-005` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-006` Model proposal to preview and execution | `not-implemented` | Untrusted model proposal → User-approved canonical command | `TH-ATLAS-MCP-006` A changed/stale proposal, replayed approval or race executes more than the user reviewed. | `MIT-ATLAS-MCP-006` Bind approval to exact typed payload, actor, versions, expiry and single-use nonce; recheck policy/consent at execution and avoid confirm-all. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-006` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-007` Untrusted web to candidate and adoption | `not-implemented` | Untrusted web/model content → Safe-fetch and isolated suggestion inbox | `TH-ATLAS-MCP-007` Prompt injection, SSRF or fabricated/misleading citations broadens tools or makes untrusted content trusted state. | `MIT-ATLAS-MCP-007` Treat content as data, bound tools/batches, safe-fetch exact sources, separate summaries/facts and require user-reviewed adoption via owning command. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-007` medium; pending explicit Phase 0 acceptance |
| `TB-ATLAS-MCP-008` Principal/provider context to cache, audit and telemetry | `not-implemented` | Scoped model session → Caches, change audit and telemetry | `TH-ATLAS-MCP-008` Cache reuse, raw arguments or observability leaks context across principals, parties or providers. | `MIT-ATLAS-MCP-008` Partition caches by principal/scope/provider, prohibit sensitive telemetry, redact typed audit fields and expire creator-private conversations. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-008` low; pending explicit Phase 0 acceptance |

Additional cross-boundary/resource-exhaustion threats:

| Threat | Attached boundaries | Scenario | Controls | Evidence | Residual risk |
|---|---|---|---|---|---|
| `TH-ATLAS-MCP-009` | `TB-ATLAS-MCP-003`, `TB-ATLAS-MCP-007` | Prompts, streaming responses, redirects, candidate batches or fetched pages consume egress sockets, tokens, CPU, memory or verification queues. | `MIT-ATLAS-MCP-009` Limit prompt/output/batch/redirect/response sizes and durations, cap concurrent work per workspace/provider, use circuit breakers and cancellation, budget retries, and isolate safe-fetch parsers/queues. | `EV-ATLAS-MCP-PLANNED` (planned) | `RR-ATLAS-MCP-009` medium; pending explicit Phase 0 acceptance |

### Self-hosting and operations (`DOM-SELF-HOSTING`)

Current capability: **not-implemented**. Accountable role: `OWN-SELF-HOSTING`.

| Boundary | Capability | Flow | Primary threat | Control | Evidence | Residual risk |
|---|---|---|---|---|---|---|
| `TB-SELF-HOSTING-001` Internet and reverse proxy to web/API | `not-implemented` | Public network → Reverse proxy and application | `TH-SELF-HOSTING-001` TLS/proxy/cookie/origin misconfiguration enables interception, forged client scheme/IP or cross-origin requests. | `MIT-SELF-HOSTING-001` Ship secure TLS/proxy/origin/host defaults, Secure cookies, trusted-proxy allowlist, rate/resource limits and configuration diagnostics. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-001` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-002` Services to configuration, secrets and identities | `not-implemented` | Application services → Secret/configuration authority | `TH-SELF-HOSTING-002` Secrets leak through files, environment dumps, logs/backups or an overprivileged workload crosses service boundaries. | `MIT-SELF-HOSTING-002` Use an operator-controlled secret store, distinct service identities, rotation, redaction, least privilege and no development credentials in production. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-002` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-003` API and workers to public dependencies | `not-implemented` | Application/worker layer → Database, object, transfer, sync, scanner and provider services | `TH-SELF-HOSTING-003` Compromised/unavailable dependency, direct write path or overprivileged worker corrupts data or bypasses policy. | `MIT-SELF-HOSTING-003` Pin/review dependencies, authenticate ports, limit worker commands, use UoW/outbox/idempotency and fail closed for security processing. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-003` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-004` Operator and support to customer data | `not-implemented` | Self-host operator/support role → Customer data plane | `TH-SELF-HOSTING-004` Standing admin access, missing MFA/audit or unsafe exports enable undetected disclosure or mutation. | `MIT-SELF-HOSTING-004` Separate operational metadata from content, require privileged reauth/cases/time limits, audit reads/exports and preserve device-only cryptographic exclusion. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-004` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-005` Live data to backup, restore and deletion | `not-implemented` | Live encrypted stores → Backup/restore/retention systems | `TH-SELF-HOSTING-005` Unencrypted/overretained backups, untested restores or restoration of revoked/deleted data causes loss or disclosure. | `MIT-SELF-HOSTING-005` Encrypt and scope backups, separate keys, test authorized restore/RPO/RTO, apply 35-day default and document delayed deletion/holds. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-005` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-006` Release supply chain to deployed versions | `not-implemented` | Source/release pipeline → Self-host deployment and client negotiation | `TH-SELF-HOSTING-006` Dependency/artifact compromise, downgrade or incompatible migration breaks security or silently changes authority. | `MIT-SELF-HOSTING-006` Produce reviewed immutable artifacts/SBOM, verify signatures/provenance, migrate backups safely and reject unsupported version ranges clearly. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-006` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-007` Public core to optional Trax Cloud services | `not-implemented` | Independent self-hosted core → Optional managed operations | `TH-SELF-HOSTING-007` A cloud-only dependency, private fork or entitlement check gates public functionality or becomes authorization. | `MIT-SELF-HOSTING-007` Keep all functional core public/self-hostable, consume versioned public contracts and treat entitlements only as service availability—not data authorization. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-007` low; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-008` Operational telemetry and application audit separation | `not-implemented` | Application and integration emitters → Separated telemetry and audit stores | `TH-SELF-HOSTING-008` Raw command arguments, prompts, document/health data, secrets or inaccessible party context enters telemetry; audit is weakened or overexposed; or non-essential telemetry ignores/obscures the required opt-out. | `MIT-SELF-HOSTING-011` Use typed field allowlists and emitter redaction, prohibit sensitive payload categories, separate telemetry from immutable application/sensitive-read audit, assign distinct access/retention, expose a clear non-essential telemetry opt-out, and test exclusions plus opt-out enforcement. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-008` medium; pending explicit Phase 0 acceptance |
| `TB-SELF-HOSTING-009` Cancellation, export, holds and general lifecycle | `not-implemented` | Active authoritative data and policy → Export, hold, purge and backup lifecycle authorities | `TH-SELF-HOSTING-009` An export includes inaccessible data, cancellation remains writable, a hold is broad or indefinite, purge misses a primary/object/backup copy, or restore resurrects deleted or revoked state. | `MIT-SELF-HOSTING-012` Policy-filter exports, enforce cancellation read-only rules, require narrow dated hold authorization/review, expose effective retention, make purge idempotent across stores, and reconcile restores against current deletion/revocation state. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-009` medium; pending explicit Phase 0 acceptance |

Additional cross-boundary/resource-exhaustion threats:

| Threat | Attached boundaries | Scenario | Controls | Evidence | Residual risk |
|---|---|---|---|---|---|
| `TH-SELF-HOSTING-010` | `TB-SELF-HOSTING-003` | A failing provider, poison job, retry loop or saturated database/object/scanner dependency causes workers to amplify load and starve public API operations. | `MIT-SELF-HOSTING-010` Use bounded queues/concurrency/retries, idempotent jobs, circuit breakers, dead-letter inspection, separate worker/API resource pools, dependency health/load shedding and recovery runbooks. | `EV-SELF-HOSTING-PLANNED` (planned) | `RR-SELF-HOSTING-010` high; pending explicit Phase 0 acceptance |

## 6. Evidence semantics

| Status | Meaning |
|---|---|
| `planned` | A linked future issue/procedure; traceability only, not evidence that a control works. |
| `available` | A runnable repository test/check exists but this register does not attest a particular run. |
| `passed` / `failed` | Requires a repository commit that exists, ISO date, exact environment/result, immutable GitHub reference and applicable typed coverage. No item in this author-created baseline is self-marked passed. |

Existing Personal-web tests are linked only to session/CSRF and workspace/privacy-neutral lookup assertions. They do not prove MFA, invitations, notification privacy, party policy, direct RLS denial, native storage, PowerSync, document cryptography, Atlas/MCP, malware scanning, production TLS, telemetry separation or restore.

Normal validation (`npm run security:check`) checks typed structure, stable IDs, bidirectional references, local files/anchors/selectors, risk arithmetic, evidence honesty, compatibility coverage, methodology coverage and overview/register parity. It does not perform human risk acceptance.

## 7. Residual-risk acceptance and review

All residual risks start `pending` with scope `phase-0-design`. The durable maintainer role recommends disposition. Closure additionally requires:

1. a typed, non-empty author list and a reviewer who is not any named human author;
2. mandatory routing to the current repository CODEOWNER;
3. an explicit strict-boolean statement that the reviewer has authority to accept the listed design risks—CODEOWNER status alone is not that authority;
4. the exact model version and an existing 40-hex repository commit that actually contains the reviewed threat-model register with the same immutable design subject;
5. a valid ISO review date and immutable GitHub pull-request review reference;
6. exact manual-review coverage of the model, domains, owners, boundaries, threats, controls, evidence, residual risks and compatibility, plus exact acceptance of every residual-risk ID;
7. every acceptance bound to the same reviewer/date/reference/review/scope and passed manual execution bound to that same commit/date/reference;
8. an existing review artifact whose approved result, reviewer, version, commit, immutable reference and explicit risk-authority statement match the register.

The pending [`evidence/PHASE_0_REVIEW.md`](evidence/PHASE_0_REVIEW.md) is a procedure, not passing evidence. `npm run security:closure` must remain blocked until a genuine review updates the register. Even accepted Phase 0 design risk reopens when implementation differs, a dependency changes or verification fails; it never waives later implementation gates.

## 8. Compatibility and migration impact

| Target | Current impact | Migration impact |
|---|---|---|
| `authenticated-web` | Documentation/check only; current auth and isolation evidence remains narrowly scoped. | No database, API or client migration. |
| `android` | Threat model defines gates without claiming an Android capability. | Future native migration/design owned by #3/#9/#11. |
| `macos-arm64` | Threat model defines gates without claiming a macOS capability. | Future native migration/design owned by #3/#9/#11. |
| `api-contract` | No wire-contract change. | None. |
| `command-contract` | No command schema is added by this documentation slice. | None now; future commands remain versioned. |
| `mcp-contract` | No MCP capability is claimed; gates remain planned. | None now; future MCP changes require versioning. |
| `sync-contract` | PowerSync remains conditional on #8 evidence. | None now; future sync compatibility is gated. |
| `self-hosted` | No production deployment claim; complete self-host acceptance remains planned. | None to current deployment. |
| `managed-cloud` | Model preserves the no-private-core and no-entitlement-as-authorization boundary. | None. |

No runtime/API/database migration, generated contract, dependency, lockfile or current self-host configuration changes are introduced. The additive npm/Make validation gate intentionally fails future changes that leave model traceability or the authored overview stale.

## 9. Maintenance triggers

Review this model when a linked Phase 0 decision closes; a trust boundary, client authority, notification/provider or retention path changes; a command/API/MCP/sync contract version changes; a security/load test fails; a vulnerability class is reported; or evidence ages beyond its owning gate. Retired IDs remain reserved and are never silently reused.
