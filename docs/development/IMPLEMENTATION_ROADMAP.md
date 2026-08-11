# Implementation Roadmap

**Status:** Accepted V1 delivery sequence  
**Constraint:** Architecture and security gates take precedence over milestone speed.

## 1. Delivery principles

1. Build a modular monolith first.
2. Establish Personal and Agency ownership boundaries before feature tables.
3. Implement manual commands before Atlas tools that call them.
4. Complete one vertical slice across schema, policy, command/query, API, client and tests.
5. Keep offline contracts in every slice even if the sync engine is delivered on a separate track.
6. Do not call a feature complete until it is implemented, integrated and validated.
7. Preserve self-hosted functional parity from the beginning.

## 2. Phase 0 — architecture, sync spike and traceability gate

Freeze versioned contracts and validate the connected-sync control plane plus selected transport/cache adapter before detailed sync implementation. PowerSync remains the V1 target only if its owner/legal gate passes. Prove scoped replication, multi-party isolation, server revocation plus official-client purge lifecycle with no remote-wipe claim, tombstones, canonical command upload, the [ADR-018 untrusted-endpoint lifecycle](../architecture/decisions/ADR-018-CONNECTED-SYNC-TRUST-BOUNDARY.md), Capacitor/Tauri support, acceptable licensing and complete self-hosting. A failed mandatory gate blocks release and requires reviewed updates to the canonical sync architecture before implementation continues.

Create and maintain a traceability matrix:

```text
capability
canonical requirement
product requirement
command/query/policy
persistence/integration
client flow
acceptance test
migration impact
status = designed | implemented | integrated | validated
```

The repository-owned [delivery traceability evidence index](DELIVERY_TRACEABILITY.md) maintains this matrix without copying volatile GitHub issue state. Architecture and this roadmap remain the stable requirement authorities; issues own executable scope, and Issue #68 is navigation only.

### Phase 0 threat-model traceability

| Field                   | Issue #10 trace                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Capability              | Seven-domain Phase 0 security threat model                                                                                |
| Canonical requirement   | [Architecture index](../architecture/README.md) and [Phase 0 Threat Model](../security/PHASE_0_THREAT_MODEL.md)           |
| Product requirement     | [GitHub issue #10](https://github.com/aXeTech-NL/Trax-OS/issues/10)                                                       |
| Command/query/policy    | Design traceability through stable `TH-*` and `MIT-*` IDs; canonical application policy is unchanged                      |
| Persistence/integration | Authored JSON register plus dependency-free npm/Make validation; no runtime persistence change                            |
| Client flow             | Server-backed authenticated web and separately gated Android/macOS local authority, sync, documents and Atlas/MCP flows   |
| Acceptance test         | `make threat-model-check`; `npm run security:closure` only after independent review and explicit residual-risk acceptance |
| Migration impact        | None: no database, API, generated contract, dependency or deployment migration                                            |
| Status                  | `integrated`; becomes `validated` only after the separate closure review passes                                           |

The model's integrated status records documentation and CI traceability only. It does not promote any future native, sync, document, Atlas/MCP, expanded-access or production self-host control beyond its actual implementation evidence.

## 3. Phase 1 — repository and contract foundation

Deliver:

```text
monorepo tooling
React/TypeScript web shell
Capacitor mobile and Tauri desktop shells
FastAPI/Pydantic application
PostgreSQL/PostGIS (without pgvector) and explicit Alembic baseline
self-host development Compose
API contract and generated/validated client
command/query registries
stable error envelope
English-first i18n keys
architecture fitness checks
CI/security/dependency baseline
```

Required foundations:

- URL routing from day one;
- injected frontend repositories/gateways;
- no direct feature I/O;
- no route-level business writes;
- one Unit of Work per top-level command;
- client command IDs, entity UUIDs and expected versions;
- immutable migration policy.

Exit: API and client boot against a migrated empty database without development seed assumptions.

Current foundation evidence includes the Issue #15 same-origin `@trax-os/api-client`: stable `/api/contract` bootstrap, exact initial API/`journey.update` `1..1` negotiation, deterministic generated runtime-schema/operation metadata and validated web transport. This does not complete the separately listed native shells, production browser support or broader Phase 1 exit.

## 4. Phase 2 — identity, workspace, access and change skeleton

Deliver:

```text
users, email verification, password reset and session/device management
TOTP/recovery codes (mandatory for agency owners/admins and platform support)
Personal and Agency workspaces
permission registry and built-in role templates
role definitions/revisions/assignments
resource audiences and grants
execution context and policy engine
change sets/events
basic preview and reversibility registry
sensitive-read audit
```

Tests:

- authentication/session rotation;
- workspace isolation;
- custom-role delegation limits;
- support/break-glass constraints;
- client actor/scope spoof rejection;
- no last-owner removal;
- change set created for every mutation.

No journey module proceeds until resource-scoped policy tests pass.

## 5. Phase 3 — journeys, travellers and parties

Deliver:

```text
journeys
traveller profiles and guardian relationships
journey memberships separate from participants
travel parties and party membership
expiring email invitations for registered/unregistered travellers
create-journey-with-setup composite command
default packing list
workspace/journey switcher
Personal Home shell
Agency portfolio shell
```

Tests:

- atomic setup rollback;
- Personal versus Agency separation;
- agency invitation does not create staff access;
- multi-party, non-transitive traveller/party isolation;
- party-membership add/remove impact preview;
- offline revocation/tombstone contract.

## 6. Phase 4 — places and timeline vertical slice

### Scheduled timeline

Deliver saved/manual places, provider-candidate gateway, stay/move segments, typed details, safe timezones, ordering, accommodation and activity CRUD.

### Planning board

Deliver country/location lanes, stay options, route ideas, stable ordering and idempotent promotion into scheduled segments.

Acceptance:

```text
add country and locations
→ add stay options and route idea
→ promote option and move atomically
→ edit/reorder/deep-link
→ retry without duplicate
→ review change set and undo where supported
```

## 7. Phase 5 — preparation and operations

Deliver in vertical slices:

- packing lists, quantities, luggage and allocations;
- complete task lifecycle and contextual notes;
- one minor-unit budget model;
- party/traveller add-ons and agency-internal cost audiences;
- emergency information;
- completed Home/readiness read model.

Gate: every module works manually without providers or Atlas.

## 8. Phase 6 — documents, devices and transfers

### Non-sensitive central files

Deliver metadata, user-selectable storage mode for eligible documents, 10 MiB central-file limits, signed operations, versioning, mandatory MIME/checksum/malware verification, quarantine, replacement safety and cleanup.

### Sensitive device-only files

Deliver device identity, secure key storage, client-side encryption, wrapped keys, temporary encrypted transfer, replica acknowledgement/deletion and local verified storage.

### Web viewing

Deliver explicit trusted-device approval, one-time session keys, WebRTC/relay transport and memory-only browser rendering.

Tests prove that application servers, support roles, Atlas and backups cannot obtain device-only plaintext or decryption keys.

## 9. Phase 7 — sources, safety, health, entry and discovery

Start with manual data; explicitly labelled fixtures exist only in development/demo environments and never appear as live production data.

Deliver:

```text
source references, safe URL verification and refresh runs
agent research runs, candidate inbox and cited-source state
Photon/OSM place integration and MET Norway weather snapshots
safety/destination-health/entry snapshots from the controlled source registry
entry requirements and traveller status
journey risk items
atomic risk-to-task
discovery candidates and shortlists
explicit adoption into owned records
```

V1 discovery uses browsing-capable ChatGPT/Claude or Atlas providers through MCP to submit accommodation/activity/source candidates. Safety/health/entry candidates require verified allowlisted authoritative sources. Direct Booking.com, Tripadvisor and Expedia APIs are deferred.

Gate: live/fixture/manual/agent_research/disabled provenance and freshness are visible; fabricated/unreachable citations and indirect prompt injection are rejected; provider failure leaves manual data intact.

## 10. Phase 8 — Atlas, MCP and providers

Atlas begins after underlying manual commands and policy are stable.

Deliver:

```text
creator-private conversations and retention controls
provider-neutral ModelProvider contract
BYO OpenAI-compatible adapter and CredentialStore
managed-credit adapter boundary only (managed service is post-V1)
typed proposal actions
individual review/confirm/reject
idempotent action execution
V1 research-context resources and candidate-submission MCP tools
remaining MCP resources/tools generated from canonical contracts
OAuth Authorization Code + PKCE and scoped grants
Atlas as official MCP client
provider/context/change audit
```

Initial tool allowlist includes bounded Planning Board research-candidate submission plus direct low-risk task, packing item and note creation. Research candidates require citation/provenance and never mutate owned planning state directly. Expand only after target-domain policy tests pass.

BYO egress and secret security are release gates, not optional hardening.

## 11. Offline and sync delivery track

Offline is a V1 capability delivered incrementally across all phases, not a marketing label added at release.

### Foundation in every phase

- repository/local-adapter seams;
- UUIDs, versions, timestamps and tombstones;
- idempotent command IDs;
- selective scope policy;
- explicit online-only gateways.

### Local reads

- encrypted local database;
- selective journey download;
- cold-start/airplane-mode reads;
- policy-aware cache eviction.

### Local writes and sync

- durable command queue;
- pending/syncing/applied/conflict/failed states;
- a Trax-owned replica/epoch/eligibility control plane with the selected transport/cache adapter and canonical command upload/reconciliation;
- conflict and optimistic reconciliation;
- current-scope server revocation and official-client purge, with explicit no-remote-wipe disclosure;
- a server-time `P90D` eligibility checkpoint and graveyard/retention watermark for connected replicas;
- one-time replica-authenticated lifecycle targets whose accepted reports can advance only server-owned eligibility and never replace command/policy checks or claim local apply/clear attestation;
- one serialized predicate—eligible state, endpoint time at or before checkpoint time plus `P90D`, and accepted target at or above the current retained floor—before normal target issue/acceptance, incremental credential issue/renewal and command upload; failure atomically enters reset-required and an outstanding old target cannot revive the epoch;
- an irreversible reset-required state for the stale epoch plus quarantine, epoch rotation, online replica reset and full resync when endpoint elapsed time is greater than `P90D` or a target is older than the retained graveyard floor;
- encrypted/access-controlled quarantine, revocation-safe denial/purge, explicit export and bounded retention/secure deletion;
- independent current authorisation, expected-version, incarnation, replica-epoch and digest/idempotency validation on every command;
- fresh server-generated entity ID/incarnation before connected offline create: any pre-allocation names those values, binds current actor/scope/entity type/replica epoch/expiry/digest and is atomically consumed once under current authorisation;
- boundary acceptance at exactly `P90D` and `P90D + ε`, including false reports, copied/rolled-back clients, delayed reconnect, floor advancement, UUID reuse, unseen-intent re-enveloping and pending-command review;
- an explicit standalone local-only exemption that cannot be entered by merely removing endpoint configuration.

### Device file cache

- secure platform storage;
- checksum verification;
- explicit pin/evict/logout behaviour;
- readiness from actual device inventory.

No offline claim is released without corresponding acceptance tests.

## 12. Agency and white-label completion

Build on the same public modules:

```text
agency journey portfolio
role/permission matrix and effective-access inspector
organiser/leader assignment
customer invitation and party management
agency operations/add-ons
workspace branding and dedicated custom-domain contracts
audit export
```

Private Trax Cloud work adds entitlements, managed email and EU shared operations first. Dedicated white-label deployment follows its operational gate. SSO/SCIM and separate branded applications are not V1 capabilities.

## 13. Clean V1 data baseline

V1 starts with a new schema and no previous-MVP production-data importer. Development/demo fixtures are recreated against current commands and remain explicitly labelled; no password/session secrets or legacy scope assumptions are carried forward.

## 14. CI and release gates

### Architecture

- no direct feature/component I/O;
- no route-level business writes;
- workers, sync, Atlas and MCP reuse application handlers;
- contract compatibility passes.

### Security

- cross-workspace/journey/party/traveller negative matrix;
- custom-role and delegation tests;
- sensitive-document/device-key invariants;
- BYO provider secret, mandatory HTTPS and managed/private-network SSRF tests;
- research candidate, citation safe-fetch and indirect prompt-injection tests;
- Atlas context isolation and creator-private conversations;
- no secrets/sensitive payloads in logs or audit.

### Data

- empty database to migration head;
- constraints, partial indexes, PostGIS and initial workspace/party RLS policies match the model;
- transaction rollback, idempotency and optimistic concurrency;
- soft delete, restore and purge;
- change/undo classification.

### Product

- manual end-to-end journey without Atlas;
- truthful source and offline states using the controlled provider/source registry;
- Personal and Agency access journeys;
- no booking or payment execution;
- self-host deployment with all public capabilities.

## 15. Implementation order within a slice

```text
1. product requirement and audience
2. command/query schemas
3. permission, risk and reversibility
4. migration and persistence
5. application handler and Unit of Work
6. API/MCP/sync adapters as applicable
7. frontend repository/hook and route
8. change/activity UI
9. unit/integration/security/end-to-end tests
10. self-host and migration documentation
```
