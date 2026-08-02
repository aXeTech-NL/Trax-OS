# Trax OS — Agentic Core Architecture

**Status:** Canonical architecture  
**Language:** English is authoritative for repository documentation.

## 1. Purpose and premise

Trax OS is an **agentic travel operating system**.

It is not a traditional travel planner with an AI chat window attached. It is a platform in which:

- people can work manually in the web, desktop and mobile clients;
- Atlas can perform actions on a user's behalf;
- external LLMs and agents can interact through MCP;
- every meaningful mutation passes through the same backend logic;
- every mutation is visible, reviewable and reversible where possible;
- the product remains fully usable without an LLM;
- offline operation is a first-class architectural concern;
- sensitive documents are stored only on trusted devices.

> AI is a faster way to operate Trax OS, not the only way to operate Trax OS.

## 2. Architecture overview

```text
Clients
Web · Mobile · Desktop · Atlas · External LLM
        │
Adapters
REST/HTTP · Sync API · MCP Server · Background Workers
        │
Application Layer
Commands · Queries · Policies · Validation
        │
Change Engine
Preview · Apply · Audit · Undo · Redo
        │
Domain and Persistence
PostgreSQL · PostGIS · Event Log · Document Metadata
```

All clients use the same application layer. Only their transport and interaction model differ.

## 3. Command service

The command service is the central mutation and business-logic layer. A command represents one meaningful action, for example:

```text
journey.create
journey.add_stop
journey.move_stop
stay.update
activity.create
task.complete
budget.update_expense
document.assign_to_device
change.undo
```

Commands are implemented by focused handlers.

```typescript
interface AddJourneyStopCommand {
  type: "journey.add_stop";
  journeyId: string;
  locationId: string;
  afterStopId?: string;
  arrivalDate: string;
  departureDate: string;
}

class AddJourneyStopHandler {
  async execute(
    command: AddJourneyStopCommand,
    context: ExecutionContext,
  ): Promise<ChangeSet> {
    // Authorisation
    // Input validation
    // Domain rules
    // Impact analysis
    // Database transaction
    // Audit logging
    // Undo information
  }
}
```

Every command handler:

1. identifies the actor;
2. verifies access;
3. validates input;
4. enforces domain rules;
5. checks concurrency and expected versions;
6. applies mutations transactionally;
7. creates a change set;
8. records audit information;
9. classifies reversibility;
10. returns a structured result.

No client or adapter may mutate the database directly.

```text
MCP Server → Command Handler → PostgreSQL
UI API     → Command Handler → PostgreSQL
Sync API   → Command Handler → PostgreSQL
```

## 4. Commands and queries

### Commands

Commands change system state. They are validated, authorised, audited, transactionally applied and associated with a change set.

```text
journey.add_stop
activity.reschedule
task.complete
budget.add_expense
document.assign_to_device
change.undo
```

### Queries

Queries read state and cause no domain mutation.

```text
GET /journeys/{id}
GET /journeys/{id}/timeline
GET /tasks
GET /budget
GET /changes
```

The query layer is optimised independently for filtering, pagination, caching, dashboards, search, maps and synchronisation. MCP resources use the query layer; mutating MCP tools use the command layer.

## 5. Canonical command contract

Every client uses the same versioned command envelope.

```json
{
  "command_id": "cmd_01K...",
  "command_type": "journey.add_stop",
  "command_version": 1,
  "payload": {
    "journey_id": "journey_123",
    "location_id": "location_456",
    "position": 3
  },
  "client_context": {
    "client_type": "mobile",
    "device_id": "device_789"
  }
}
```

Supported `client_type` values:

```text
web
mobile
desktop
atlas
external_mcp
offline_sync
system
```

`command_id` is the idempotency key across retries and offline synchronisation. Contract evolution is explicit through `command_version`.

## 6. UI and MCP share the same logic

Every meaningful UI action maps to a command.

| UI action | Command |
|---|---|
| Add a stop | `journey.add_stop` |
| Reorder a stop | `journey.move_stop` |
| Complete a task | `task.complete` |
| Schedule an activity | `activity.create` |
| Add an expense | `budget.add_expense` |
| Assign a document to a device | `document.assign_to_device` |
| Undo a change | `change.undo` |

Purely visual interactions such as collapsing a panel, zooming a map, local sorting and unsaved form input remain client-side.

```text
UI → Command API → Command Handler
LLM → MCP Tool → MCP Adapter → Command Handler
```

The command layer is the core. MCP is an adapter.

## 7. Product and screen strategy

### Desktop and large tablet: planning cockpit

Desktop and large tablet are the primary environments for building and extensively managing a journey. They are optimised for:

- constructing and restructuring complete journeys;
- viewing multiple stops and travel legs together;
- using map, timeline and detail context side by side;
- comparing stays, transport and activities;
- managing budgets, travellers, devices and documents;
- reviewing agent-created previews and change sets;
- detailed undo, bulk actions and complex forms;
- drag-and-drop of stops and activities;
- using Atlas alongside the plan;
- assigning device-only documents.

```text
┌─────────────┬──────────────────────────────┬────────────────────┐
│ Navigation  │ Map and journey timeline     │ Detail / Atlas     │
└─────────────┴──────────────────────────────┴────────────────────┘
```

Large tablets may use the same workspace with collapsible, touch-optimised panels.

### Mobile: companion and quick context

Mobile is primarily for use while travelling. It is optimised for:

- current location, today and the next move;
- quick task completion and expense capture;
- booking details, addresses and practical information;
- locally stored documents and offline data;
- short notes, activities and Atlas requests;
- notifications, approvals and change review;
- simple undo;
- receiving device-only documents.

Mobile is not read-only. It exposes the same domain capabilities through more compact and contextual workflows. Its primary navigation is `Home · Timeline · Packing · Documents · More`; Atlas opens contextually as a floating sheet/panel from authorised modules.

| Action | Desktop/large tablet | Mobile |
|---|---|---|
| Build a complete route | Primary workflow | Supported, simplified |
| Reorder stops | Map and timeline | Compact list or guided flow |
| Analyse budget | Full overview | Summary and quick entry |
| Manage documents | Metadata and device assignment | Receive and view locally |
| Use Atlas | Side panel | Chat or action sheet |
| Review changes | Detailed diff | Summary, review and undo |
| View today | Available | Primary workflow |
| Work offline | Supporting | Primary workflow |

> Desktop and large tablet are the planning cockpit. Mobile is the companion for context, execution, offline use and quick changes.

## 8. Optimistic UI and offline commands

Low- and medium-risk interactions may be shown optimistically.

```text
1. User changes an item
2. UI applies the local projection immediately
3. Client persists the command locally
4. Client sends the command when connectivity permits
5. Server validates and confirms it
6. Client reconciles or rolls back on rejection
```

High-risk actions such as deleting a journey, sharing sensitive data or transferring a document are not applied optimistically.

```text
local_command_queue
├── command_id
├── command_type
├── command_version
├── payload
├── created_at
├── expected_entity_version
├── device_id
├── retry_count
└── sync_status
```

Supported statuses:

```text
pending
syncing
applied
conflict
failed
cancelled
```

Sync must be idempotent by `command_id`. Conflicts are explicit outcomes, not silent last-write-wins behaviour.

## 9. Atlas as the official MCP client

Atlas has no hidden database or backend access.

```text
Atlas
├── chat interface
├── conversation context
├── model provider
├── policy context
└── MCP client
```

Atlas uses the same MCP contracts available to authorised external models. Tool semantics, authorisation, policy decisions, audit logging and undo therefore remain consistent.

Atlas is provider-neutral. It supports no model, a local model, a user-provided OpenAI-compatible endpoint or a Trax-managed credit-backed provider. Provider selection never broadens application access. See [Atlas Model Provider Architecture](ATLAS_PROVIDER_MODEL.md).

## 10. External LLMs, MCP and OAuth

Users may connect their own LLM or agent through OAuth-protected MCP access.

Requirements:

- Authorization Code Flow with PKCE;
- exact redirect URI validation;
- short-lived access tokens;
- refresh-token rotation;
- revocable grants;
- audience/resource validation;
- explicit consent;
- least-privilege scopes.

Example scopes:

```text
workspaces:read
agency:read
agency:manage
roles:read
roles:write
journeys:read
journeys:write
planning:read
planning:suggestions:write
accommodations:candidates:write
activities:candidates:write
research:sources:submit
parties:read
parties:write
activities:read
activities:write
tasks:read
tasks:write
budget:read
budget:write
travelers:read
travelers:write
documents:metadata
documents:request
audit:read
changes:undo
```

Authorisation may be restricted to a journey, household, workspace, tool set, device or validity period.

## 11. MCP contract

### Resources

```text
trax://journeys/{journey_id}
trax://journeys/{journey_id}/timeline
trax://journeys/{journey_id}/budget
trax://journeys/{journey_id}/travelers
trax://journeys/{journey_id}/parties
trax://journeys/{journey_id}/research-context
trax://journeys/{journey_id}/planning/suggestions
trax://parties/{party_id}
trax://locations/{location_id}
trax://tasks/open
trax://changes/{change_set_id}
```

### Tools

```text
journey.create
journey.update
journey.add_stop
journey.move_stop
journey.remove_stop
journey.create_for_travelers
journey.invite_traveler

party.create
party.add_member
party.remove_member
party.replace_memberships

research.submit_accommodation_candidates
research.submit_activity_candidates
research.submit_source_references
research.submit_safety_observations
research.submit_health_observations
research.submit_entry_observations

stay.create
stay.update

activity.create
activity.reschedule
activity.cancel

task.create
task.complete
task.reopen

packing_item.create
note.create

budget.add_expense
budget.update_expense

document.assign_to_device
document.request_from_device

change.preview
change.undo
change.redo
```

### Prompts

```text
plan_family_day
prepare_next_destination
prepare_group_departure
research_accommodation_options
research_destination_activities
review_official_travel_sources
check_journey_readiness
create_packing_list
review_travel_day
optimize_slow_travel_route
```

MCP schemas are generated from or validated against the canonical application contracts. Adapters may not implement alternative domain behaviour.

The V1 Atlas direct-action grant is limited to `task.create`, `packing_item.create` and `note.create`. Browsing-capable external agents and Atlas providers may submit cited accommodation, activity and authoritative-source candidates to the Planning Board review inbox. Submission never creates booked/trusted state; adoption is a separate user-reviewed command. See [V1 Agent-assisted Web Research](AGENT_RESEARCH_V1.md).

## 12. Risk and confirmation levels

### Level 1 — low risk

May execute immediately, for example:

- add a note;
- create a task;
- add a label;
- save an idea;
- submit a bounded cited candidate to the scoped Planning Board suggestion inbox.

### Level 2 — medium risk

May execute with a clear confirmation afterwards and an available undo path, for example:

- move an activity;
- update a packing list;
- change stay details;
- modify a day plan;
- adopt a reviewed research candidate into owned planning data.

### Level 3 — high risk

Requires an exact preview and explicit prior approval, for example:

- delete a journey;
- restructure a complete route;
- broaden a role, permission assignment or resource audience;
- add, remove or replace a traveller's privacy-party memberships;
- share sensitive data;
- request document content from a device;
- invite a traveller.

```text
Agent proposes action
        ↓
Trax OS creates preview
        ↓
User reviews exact impact
        ↓
User explicitly approves
        ↓
Command executes
```

Risk classification belongs to application policy, not to individual clients or model prompts.

## 13. Change engine and audit logging

### Change sets

```text
change_sets
├── id
├── workspace_id
├── journey_id
├── actor_type
├── actor_id
├── client_type
├── model_provider
├── model_name
├── conversation_id
├── command_type
├── reason
├── created_at
├── reversibility
├── undo_status
└── reversed_by_change_set_id
```

### Change events

```text
change_events
├── id
├── change_set_id
├── sequence
├── entity_type
├── entity_id
├── operation
├── before_state
├── after_state
├── command_version
└── created_at
```

Actor types:

```text
user
atlas
external_mcp_client
system
sync
background_worker
```

Agent actions additionally record:

- OAuth client;
- represented user;
- granted scopes;
- MCP tool and input arguments;
- policy decision;
- model provider and model name;
- confirmation status;
- concise change summary.

Private conversation content and model chain-of-thought are not required for the audit log and should not be stored by default.

## 14. Undo and redo

Undo is implemented through compensating commands.

```text
Original: journey.add_stop(stop_456)
Undo:     journey.remove_stop(stop_456)
```

Undo creates a new change set rather than deleting history.

```text
Change A
└── reversed_by → Change B

Change B
└── reverses → Change A
```

Every command definition has one reversibility class:

```text
full
compensatable
partial
none
```

Actions classified as `none` require explicit prior confirmation. Redo is another explicit command and must revalidate current authorisation, versions and domain rules.

## 15. Activity log

Users can review relevant human, Atlas, external-agent, sync and system changes.

```text
Atlas moved Elephant Nature Park
10:00 → 14:00

Reason:
Rain expected in the morning

[View changes] [Undo]
```

Suggested filters:

- all changes;
- my changes;
- Atlas;
- external agents;
- synchronisation;
- system.

The same review and undo model applies to human and AI actions.

## 16. Device-only document storage

Highly sensitive documents are not permanently stored centrally. Examples include passport scans, identity cards, visas, medical certificates and insurance documents containing extensive personal data.

The server stores metadata only.

```text
documents
├── id
├── journey_id
├── owner_traveler_id
├── document_type
├── display_name
├── mime_type
├── size
├── checksum
├── created_at
└── storage_mode = DEVICE_ONLY
```

```text
document_replicas
├── document_id
├── device_id
├── status
├── assigned_at
├── received_at
├── verified_at
└── transfer_deleted_at
```

The server may temporarily hold an encrypted transfer blob, but never plaintext or a document decryption key.

## 17. Browser upload to trusted devices

```text
1. User selects a file
2. Browser generates a random document key
3. Browser encrypts the file locally
4. Browser wraps the document key for each target device
5. Encrypted blob enters temporary transfer storage
6. Target devices download the blob
7. Devices decrypt and persist it locally
8. Devices verify and acknowledge the checksum
9. Server deletes the temporary transfer blob
10. Only metadata and replica status remain centrally
```

Transfer storage needs a strict expiry and deletion lifecycle. The central service never possesses the document key in decryptable form.

## 18. Device identity and key management

Every device has a cryptographic identity.

```text
Device
├── device_id
├── public_key
├── encrypted_private_key_reference
├── display_name
├── platform
├── trust_status
└── last_seen_at
```

Private keys are kept in platform security facilities such as Keychain, Secure Enclave, Android Keystore or an equivalent trusted store.

```text
document_key = random symmetric key
encrypted_file = encrypt(file, document_key)

wrapped_key_device_a = encrypt(document_key, public_key_a)
wrapped_key_device_b = encrypt(document_key, public_key_b)
```

Device trust, revocation and key rotation are explicit application concepts.

## 19. Viewing a device-only document in the web client

```text
Browser                      Server                       Device
   │                            │                            │
   │ Request document           │                            │
   ├───────────────────────────▶│                            │
   │                            │ Approval request           │
   │                            ├───────────────────────────▶│
   │                            │ User approves              │
   │                            │◀───────────────────────────┤
   │ Establish secure session   │                            │
   │◀──────────────────────────▶│◀──────────────────────────▶│
   │◀════ end-to-end encrypted document stream ═════════════│
```

Requirements:

- explicit approval on the trusted device;
- time-limited session;
- memory-only browser rendering;
- no persistent browser cache;
- no server-side plaintext copy;
- automatic session termination;
- audit logging of the access request.

Transport preference:

1. WebRTC data channel;
2. end-to-end encrypted relay fallback;
3. one-time session keys in either case.

## 20. Document access for LLMs

LLMs have no document-content access by default.

```json
{
  "id": "doc_passport_maurice",
  "type": "passport",
  "owner": "Maurice",
  "stored_on_devices": 2,
  "expires_on": "2031-04-12",
  "content_accessible": false
}
```

Do not expose a generic `document.read_content` MCP tool for sensitive documents. With explicit consent, narrowly scoped non-secret fields such as expiry date or nationality may be stored centrally when the product has a clear need for them.

## 21. Offline-first behaviour

Without a network connection, users retain access to:

- journeys and stops;
- stays and activities;
- tasks, budgets and notes;
- practical information;
- documents stored on the current device;
- pending commands and their sync state.

Atlas modes:

```text
No model connected
└── complete manual application, no AI

Local model
└── limited offline assistance with device/operator-managed credentials

BYO OpenAI-compatible model
└── Atlas uses a user-selected endpoint and key; provider bills the user directly

Managed model
└── Atlas uses Trax-managed routing and credits
```

Offline data is scoped and encrypted appropriately for the device. Synchronisation reuses the canonical command contract rather than bypassing domain rules. PowerSync is the selected local-data/replication adapter; command upload, policy, change sets and reconciliation remain Trax-owned contracts.

## 22. PostgreSQL as the source of truth

Trax OS uses PostgreSQL as its primary database, with:

- PostGIS for locations and geospatial operations;
- JSONB for flexible provider data;
- policy-filtered relational/search projections for Atlas context; pgvector is not required in V1;
- object storage for non-sensitive content;
- temporary encrypted transfer storage for device-only documents.

A graph database is not part of the initial architecture.

## 23. Target public monorepo structure

```text
trax-os/
├── apps/
│   ├── web/
│   ├── mobile/
│   ├── desktop/
│   ├── api/
│   ├── worker/
│   ├── mcp-server/
│   └── atlas/
│
├── packages/
│   ├── domain/
│   ├── commands/
│   ├── queries/
│   ├── policies/
│   ├── access-control/
│   ├── validation/
│   ├── change-engine/
│   ├── audit-log/
│   ├── mcp-contract/
│   ├── api-contract/
│   ├── api-client/
│   ├── oauth/
│   ├── model-provider-contract/
│   ├── model-provider-openai-compatible/
│   ├── credential-store/
│   ├── research-contract/
│   ├── source-verification/
│   ├── sync-engine/
│   ├── offline-store/
│   ├── device-identity/
│   ├── document-crypto/
│   ├── secure-transfer/
│   ├── branding-config/
│   └── ui/
│
├── infrastructure/
│   ├── docker/
│   └── compose/
│
├── migrations/
├── docs/
└── .github/
```

Dependency direction should point inward: adapters depend on public application contracts; application services depend on domain abstractions; the domain does not depend on transports, model providers or Trax Cloud.

## 24. Open-source and cloud boundary

The public repository contains the complete functional product:

```text
trax-os
├── clients
├── backend and workers
├── MCP server and Atlas interfaces
├── commands, queries and change engine
├── sync and offline support
├── device identity and document crypto
└── self-hosting
```

The private cloud repository contains managed-service concerns:

```text
trax-os-cloud
├── production infrastructure
├── tenant provisioning
├── billing and subscriptions
├── managed Atlas operations
├── monitoring and backups
├── support tooling
└── commercial operations
```

Official clients negotiate `api_version`, `command_contract_version`, `mcp_contract_version`, `sync_contract_version`, capabilities and explicit minimum/maximum client versions through instance discovery. Unsupported combinations fail with a clear upgrade requirement; capability flags never replace authorisation.

The managed platform consumes immutable, versioned public artefacts. It may configure public capabilities and add operational services, but it must not maintain a private fork of core domain behaviour or make self-hosting dependent on Trax Cloud.

A self-hosted deployment can enable every public functional capability, including Personal and Agency workspaces, sync, roles and permissions, MCP, non-transitive multi-party membership, white-label configuration and Atlas interfaces with an operator-provided model. Trax Cloud differentiates through managed infrastructure, model credits, backups, agency-facing support, SLA, tenant provisioning and dedicated white-label/custom-domain operations. Official apps use dynamic workspace branding rather than separate branded builds.

```text
trax-os.io    → open-source project, documentation and downloads
trax-os.cloud → managed product, app, API and account environment
```

## 25. Personal and Agency workspace modes

Trax OS uses one public application core for two product experiences:

```text
PERSONAL workspace
└── simple ownership, own journeys, companions and private data

AGENCY workspace
└── journey portfolio, organisers, leaders, configurable roles and travel parties
```

A user may own a Personal workspace while also participating in agency-created journeys or working in an Agency workspace. Membership and data never cross workspace boundaries implicitly. An accepted, identity-verified agency invitation may activate only the approved Journey membership and scoped assignments; the invitation, participation and identity link alone create no access. It never creates agency staff access or exposes the traveller's Personal workspace.

Agency access is based on a public Roles & Permissions module:

- built-in role templates provide safe defaults;
- agencies may create versioned custom roles from stable permission keys;
- role assignments are scoped to platform, workspace, journey, party or traveller;
- a principal cannot delegate permissions they do not hold as delegable;
- resources retain exactly one audience: `agency_internal`, `journey_shared`, `party_shared` or `traveler_private`;
- bounded resource grants are a separate authorisation path and never reclassify an audience or create membership;
- non-configurable tenant, audit, risk and device-crypto invariants override role configuration.

Journey access membership is separate from travel participation. A travel party is a privacy boundary within a group Journey. A traveller may have multiple party memberships, but access never propagates transitively between parties through that traveller. Every party-scoped resource retains one exact party; `journey_shared` is a separate classification, and a bounded grant may authorise specific access without merging audiences. Filtering occurs server-side in queries, sync, search and model retrieval. See [ADR-005](decisions/ADR-005-MEMBERSHIP-AND-PARTICIPATION.md) and [ADR-016](decisions/ADR-016-ACCESS-POLICY-ALGEBRA.md).

`platform_super_admin` is an operational role. Customer-content access uses an explicit, time-limited, audited break-glass session and can never provide device-only plaintext or decryption keys.

See the canonical [Agency, Group Travel and Access Model](AGENCY_ACCESS_MODEL.md).

## 26. Core principles

1. The command layer is the central mutation and business-logic layer.
2. MCP is an adapter, not a second implementation of the domain.
3. UI, Atlas, external agents, workers and sync use the same commands.
4. Every meaningful mutation is audited in a change set.
5. Human and AI changes are reversible where possible.
6. High-risk actions require preview and explicit approval.
7. The application remains fully usable without an LLM.
8. Offline operation is a core capability.
9. Highly sensitive documents remain device-only.
10. The central service never owns device-only document decryption keys.
11. LLMs receive document metadata only by default.
12. PostgreSQL remains the primary source of truth.
13. The public product remains independently self-hostable.
14. Trax Cloud consumes versioned public artefacts rather than forking the core.
15. Personal and Agency modes share the same application contracts and domain behaviour.
16. Roles are configurable permission collections applied at explicit scopes.
17. Travel parties are server-enforced, non-transitive privacy boundaries; travellers may belong to multiple parties.
18. No role can bypass tenant isolation, audit or device-only cryptography.
19. Self-hosters can enable the complete public Personal and Agency feature set.
20. Managed plan entitlements configure services but never replace server-side authorisation.
21. Atlas provider selection never changes command, context or MCP permissions.
22. BYO provider usage consumes no Trax credits and never silently falls back to a paid model.
23. V1 agent web research creates cited candidates; verified user adoption creates owned state.
24. Safety, health and entry research requires validated authoritative sources.
25. V1 supports offline reads/writes and device-file availability; no offline claim ships without acceptance evidence.
26. Central files are user-selected only for eligible classifications, limited to 10 MiB and unavailable until malware verification passes.
27. Every BYO model endpoint uses HTTPS; self-hosted private-network access is an explicit operator opt-in.

## 27. Summary

Trax OS is organised around one shared command and change engine. The UI uses an optimised API and offline command queue. Atlas and external models invoke the same application behaviour through MCP.

The same core serves individuals through a simple Personal workspace and organisations through an Agency workspace with configurable access control and private travel parties. This produces one consistent system in which people can manage every function manually, agents can act within the same policies, actions remain reviewable and reversible, sensitive data does not become central by default, and both self-hosted and managed deployments preserve the same functional core.
