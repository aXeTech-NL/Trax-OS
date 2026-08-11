# Capability-to-client support

**Policy:** Canonical current-state support matrix tracked by Issue [#11](https://github.com/aXeTech-NL/Trax-OS/issues/11)

**Scope:** Authenticated web, Android and macOS arm64

This matrix records what the repository supports today. It is separate from the V1 target architecture and does not turn a design, spike or development stack into a supported client capability. The architecture and product documents continue to define the V1 target; this document is authoritative when describing current client support.

## Support-policy labels

- **Current (limited)** — repository implementation and test sources exist for the narrowly stated behavior. This does not imply production readiness or final Issue #11 acceptance.
- **Target (gated)** — the behavior is in the V1 target, but the named implementation and acceptance gates prevent a current support claim.
- **Target (spike-gated)** — feasibility or security prototype evidence is required before implementation and acceptance. A successful spike alone is not product acceptance.
- **Not supported** — no current support claim is made.
- **Not supported by design** — the architecture intentionally excludes this client/capability combination.

These are support-policy labels, not roadmap lifecycle statuses. They do not replace the roadmap's `designed | implemented | integrated | validated` lifecycle status values. Labels can be qualified in the matrix and details below.

## Current support matrix

| Capability                       | Authenticated web           | Android                  | macOS arm64              |
| -------------------------------- | --------------------------- | ------------------------ | ------------------------ |
| Server authority                 | **Current (limited)**       | **Target (gated)**       | **Target (gated)**       |
| Reconstructable shell/cache      | **Current (shell only)**    | **Target (gated)**       | **Target (gated)**       |
| Encrypted native local authority | **Not supported by design** | **Target (spike-gated)** | **Target (spike-gated)** |
| Offline sync and data writes     | **Not supported**           | **Target (spike-gated)** | **Target (spike-gated)** |
| Device-only documents            | **Target (gated)**          | **Target (spike-gated)** | **Target (spike-gated)** |
| Atlas/MCP                        | **Target (gated)**          | **Target (gated)**       | **Target (gated)**       |
| Production readiness             | **Not supported**           | **Not supported**        | **Not supported**        |

## Capability rationale, evidence and gates

### Server authority

- **Web rationale:** Password-authenticated Personal Journey, timeline and packing reads/writes are PostgreSQL-authoritative. There is no change engine, Agency workspace support or complete V1 module set yet. This behavior does not depend on #2, #8 or #9.
- **Web evidence:** [Server-backed web](SERVER_BACKED_WEB.md#implemented-api-baseline) defines the implemented boundary. The API [server-backed tests](../../apps/api/tests/test_server_backed.py) exercise authentication, CSRF, workspace isolation and Journey/timeline/packing operations. The instance advertises only the five implemented foundation capabilities in [`runtime-fixtures.json`](../../packages/api-contract/generated/runtime-fixtures.json). The [foundation workflow](../../.github/workflows/foundation.yml) runs `make check`, including the API tests.
- **Android and macOS gates:** The V1 design uses the authenticated API, but there is no Android or desktop application workspace, native artifact or client acceptance evidence. The current JavaScript workspaces are only web and API contract ([`package.json`](../../package.json)). A future connected-only client is not inherently blocked by #2/#8/#9, but it must be implemented and accepted before support is claimed.

### Reconstructable shell/cache

- **Web rationale:** After one successful load and service-worker installation, Workbox can reopen the revisioned application shell. Browser state is disposable; `/api` and `/health` are excluded, with no runtime API cache, offline Journey read or offline write guarantee ([offline boundary](LOCAL_JOURNEY_SLICE.md#offline-boundary)).
- **Web evidence:** The source-controlled [offline PWA check](../../apps/web/scripts/check-pwa-offline.mjs) verifies service-worker control and offline shell navigation. The [foundation workflow](../../.github/workflows/foundation.yml) runs that check against both the production build and the Compose web client.
- **Android and macOS gates:** The PWA guarantee does not apply to native clients. No Android shell, native cache or Tauri/macOS shell exists. Any connected offline replica also requires #8 and #9 acceptance.

The linked test sources and workflow establish how the current web claims are checked; they are not immutable proof that a particular revision passed. An immutable passing CI run for the reviewed revision, including the server-backed and PWA checks, remains an Issue #11 closure gate.

### Encrypted native local authority

- **Web rationale:** Authoritative browser-local operation is unsupported by design because site data can be cleared; web remains authenticated and server-backed ([product outcome](LOCAL_JOURNEY_SLICE.md#product-outcome)).
- **Android and macOS gates:** Accountless authority requires the local principal/workspace, canonical command/change/undo, export/import, recovery and pairing decision from [#2](https://github.com/aXeTech-NL/Trax-OS/issues/2), plus encrypted SQLite and OS key-custody evidence from [#9](https://github.com/aXeTech-NL/Trax-OS/issues/9). Platform-specific Android Keystore and macOS Keychain evidence, implementation and acceptance are absent.

### Offline sync and data writes

- **Web rationale:** Journey reads and every mutation require the server. There is no durable browser command queue, reconciliation path or runtime API cache. A future web replica needs explicit design and acceptance; native guarantees must not be inferred.
- **Android and macOS gates:** The [#8 PowerSync spike](https://github.com/aXeTech-NL/Trax-OS/issues/8) must establish scoped replication, revocation purge, canonical command upload, supported-client feasibility, licensing and self-hosting. Canonical local commands depend on #2 and secure local storage depends on #9. Implementation, integration and offline acceptance tests are still required after the spikes ([offline and sync delivery track](IMPLEMENTATION_ROADMAP.md#11-offline-and-sync-delivery-track)). macOS additionally requires Tauri feasibility and Apple-Silicon evidence.
- **Target offline boundary:** Connected replicas for Trax Cloud and compatible self-hosted endpoints target incremental reconciliation through exactly `P90D` after the last successful authoritative sync. Beyond that boundary, pending commands must be preserved for review/export before online replica reset and full resync. An explicitly standalone local-only workspace has no sync clock; removing an endpoint does not create that authority. This is approved target policy only: M3b implementation and native acceptance evidence are absent, so the matrix remains **Target (spike-gated)**.

### Device-only documents

- **Web rationale and gates:** The target is trusted-device approval and memory-only browser rendering, never browser authority. There is no document/device runtime. Phase 6 implementation and an accepted trusted native device/key flow are required ([web viewing](IMPLEMENTATION_ROADMAP.md#web-viewing)).
- **Android and macOS gates:** #9 must supply Android Keystore and macOS Keychain/Apple-Silicon evidence for secure key custody. Client-side encryption, key wrapping, transfer, replica acknowledgement/deletion and document acceptance tests remain absent ([documents and device security](../security/PHASE_0_THREAT_MODEL.md#documents-and-device-security-dom-documents)).

### Atlas/MCP

- **Web rationale and gates:** No Atlas runtime, model provider store, OAuth/MCP adapter, resource or tool is implemented. Phase 8 and its manual-command/policy foundations remain required ([roadmap](IMPLEMENTATION_ROADMAP.md#10-phase-8--atlas-mcp-and-providers); [threat model](../security/PHASE_0_THREAT_MODEL.md#atlas-mcp-and-agent-research-dom-atlas-mcp)).
- **Android and macOS gates:** #2 excludes LLM interaction from standalone accountless mode. Connected use requires a native client plus server Atlas/MCP implementation and acceptance.

### Production readiness

- **Web gates:** The `0.1.0` build and Compose stack are development/evaluation evidence only. There is no attested production browser range, TLS/public ingress, production secret handling, backup/restore, upgrade, high-availability or release support policy ([security and production boundary](COMPOSE_EVALUATION.md#security-and-production-boundary)).
- **Android gates:** There is no artifact, minimum Android/API level, signing/update channel, packaging test, native crypto evidence or production acceptance.
- **macOS gates:** There is no macOS arm64 artifact, minimum macOS version, signing/notarization/update channel, packaging test, native crypto evidence or production acceptance.

## Supported versions today

| Client            | Truthful current statement                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated web | Development build `0.1.0`; the official same-origin client and server currently negotiate exact API `1..1` and `journey.update` `1..1`. This protocol range is not a production browser/version support attestation. A local headless-browser/PWA check remains test evidence only. |
| Android           | No supported artifact, client version or minimum Android/API level.                                                                                                                                                                                                                 |
| macOS arm64       | No supported artifact, client version or minimum macOS release. No signed or notarized client exists.                                                                                                                                                                               |

Application SemVer remains informational at [`/api/v1/version`](../../apps/api/src/trax_api/routes.py). The stable `/api/contract` bootstrap publishes API and command ranges sourced from canonical server constants/registry and projected into generated fixtures/client metadata; neither endpoint is a production release attestation.

## Dependency and acceptance gates

- **[#2 — local-only offline core authority](https://github.com/aXeTech-NL/Trax-OS/issues/2):** must settle and prove the accountless local principal/workspace, canonical offline commands/change/undo, encrypted authority lifecycle, export/import, recovery and later server pairing. It blocks native local-authority support.
- **[#8 — PowerSync privacy, revocation and self-hosting spike](https://github.com/aXeTech-NL/Trax-OS/issues/8):** must provide reproducible evidence for isolation, revocation purge, command upload, supported clients, licensing and complete self-hosting, or lead to approval of an alternative architecture. It blocks native connected-offline/sync support.
- **[#9 — Android and macOS native crypto storage spike](https://github.com/aXeTech-NL/Trax-OS/issues/9):** must prove encrypted local persistence and OS key custody, including restart, key loss, backup exclusion, migration and device-compromise boundaries on both platforms. It blocks encrypted native authority and device-document key-custody claims.

The #8 spike is **not final acceptance**, even if its feasibility harness passes. Product support still requires the selected result to be approved, implemented, integrated with canonical commands and policy, secured with #9 evidence, exercised by client/offline/revocation tests, and accepted against declared client versions. Likewise, resolving any one of #2, #8 or #9 cannot promote a matrix cell while its other named gates remain incomplete.

Authenticated server-backed web and the reconstructable PWA shell do not depend on #2, #8 or #9. They remain limited to the implemented scope stated above and the Issue #11 CI-evidence gate.

## Discovery and compatibility boundary

`GET /api/v1/capabilities` remains implemented **instance-runtime discovery**. Its `available|unavailable` values do not encode client platform, version range, authority class, offline guarantee or production readiness. API/command compatibility is advertised separately by `GET /api/contract`; capabilities must not duplicate it.

Issue #15 adds the same-origin API-client package, generated validation metadata and additive discovery contract without database/deployment migration. Future range widening/removal or production client support changes require separate compatibility, migration and acceptance review before this matrix can be promoted.

## Maintenance trigger

Review and update this matrix whenever a client capability, supported-version or release policy changes; when #2, #8, #9 or another named dependency changes the applicable gate; or when new implementation or acceptance evidence could promote a label. Keep the linked issues as the source of truth for their live state rather than copying transient state labels here.

## Owner decisions still required

Before any production support claim, maintainers must approve and attest:

- the production browser/version range and web release/operations policy;
- the Android client version, minimum Android/API level, distribution/signing/update policy and acceptance environment;
- the macOS arm64 client version, minimum macOS release, signing/notarization/update policy and acceptance environment;
- the final #2 local-authority design, the architecture decision resulting from #8, and the #9 native key/storage design;
- the implementation-specific security review and residual-risk acceptance for native authority, sync, device documents and Atlas/MCP.

Until those decisions and their evidence exist, the gated and unsupported statements in this matrix are the support policy.
