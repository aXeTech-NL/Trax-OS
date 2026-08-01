# Target Domain Model

**Status:** Canonical V1 domain model  
**Note:** Names and fields are architectural contracts, not a substitute for reviewed migrations.

## 1. Modelling goals

- explicit workspace, journey, party and traveller ownership;
- separate app access from travel participation;
- Personal and Agency workspace support;
- configurable scoped roles and stable permissions;
- planning ideas separate from scheduled travel;
- one durable money model;
- strict central versus device-only document storage;
- provider provenance separate from owned journey truth;
- offline/sync-ready lifecycle fields;
- universal change sets, audit and compensation.

## 2. Common record shapes

Syncable workspace-owned records use:

```text
id UUID
workspace_id UUID
created_at timestamptz
updated_at timestamptz
deleted_at timestamptz nullable
record_version bigint
created_by_principal_id nullable
updated_by_principal_id nullable
```

Journey-owned records additionally carry `journey_id`; party-scoped records additionally carry `party_id`; traveller-private records carry `traveler_id` and audience policy.

Rules:

- scope and actor are server-derived;
- approved create commands may accept client-generated UUIDs;
- every mutation and tombstone increments `record_version`;
- server time is authoritative when online;
- active queries hide tombstones by default;
- purge is a separate retention process;
- ordered siblings use stable lexical/fractional `position_key` values;
- status/type vocabularies use application enums plus database constraints.

Append-only audit/change events are not ordinary syncable records and are never edited by normal product flows.

## 3. Identity, workspaces and access

```text
users
auth_password_credentials
auth_refresh_sessions
workspaces
workspace_memberships
permission_definitions
role_definitions
role_definition_revisions
role_permission_entries
role_assignments
resource_grants
support_sessions
```

`workspace.type` is `PERSONAL` or `AGENCY`. A user may own a Personal workspace, work in Agency workspaces and participate in agency-created journeys without those scopes merging.

Roles are versioned permission collections. Assignments apply at `PLATFORM`, `WORKSPACE`, `JOURNEY`, `PARTY` or `TRAVELER` scope. Explicit deny wins, OAuth scopes can only reduce access, and non-configurable isolation/audit/device-security invariants run first.

Credential and refresh-session records are server-only and never synchronize to clients.

## 4. Travellers, journeys and parties

```text
traveler_profiles
traveler_guardian_relationships
traveler_private_profiles
journeys
journey_memberships
journey_participants
travel_parties
party_memberships
journey_invitations
```

Journey invitations use single-purpose hashed tokens, a seven-day default expiry, resend/revoke invalidation and identity verification before activation.

Access and participation remain separate:

- `journey_membership` links a user/principal to access state and scoped role assignment;
- `journey_participant` links a traveller profile to the journey;
- a traveller may exist without a user account;
- a user may manage a journey without travelling;
- guardian authority is explicit and never inferred from `adult` or `child` labels.

A traveller may have multiple active privacy-party memberships in one journey. Party access is non-transitive: a caller's own exact membership may authorise one party resource, but a shared traveller never connects or merges parties for other members. Each `party_shared` resource belongs to exactly one party; broader sharing uses `journey_shared` or explicit grants. An optional primary/default membership is UI metadata only.

Illustrative journey fields:

```text
name
start_date/end_date nullable
home_country_code nullable
base_locale
default_currency_code nullable
status = planning | active | completed | archived
timezone_policy
```

## 5. Places and itinerary planning

Saved places are owned records; provider candidates remain external until adopted.

```text
geo_places
journey_country_plans
journey_location_plans
stay_options
planning_items
planning_promotions
```

Planning invariants retained from the rebuild:

- a planned location belongs to a country lane;
- stay options are not bookings;
- route/move ideas may reference source and target locations;
- no planning record contains a second durable money field;
- promotion to scheduled travel is explicit and idempotent;
- promotion records preserve source/result traceability;
- repeat visits to the same `geo_place` are valid distinct location/stay occurrences and are never deduplicated by place identity.

## 6. Scheduled timeline

```text
journey_segments
stay_details
move_details
accommodations
activities
```

A segment is a typed, ordered scheduled unit. A stay has exactly one active `stay_detail`; a move has exactly one active `move_detail`.

Temporal precision is explicit:

```text
ordered   sequence only
date      local dates known
datetime  exact instants plus relevant IANA timezones
```

Unknown local times are never fabricated as UTC values. Base segments do not duplicate place names and typed detail fields; query read models flatten them for clients.

Accommodation and activity booking/payment status is descriptive/manual. No Trax command performs a booking or payment.

## 7. Packing and luggage

```text
packing_lists
packing_items
luggage
packing_item_allocations
packing_item_context_links
```

Every journey has a default packing list. Items track `quantity` and `packed_quantity`; status is derived. Quantity may be split across luggage through allocations.

Allocation updates lock the item or use an equivalently reviewed serializable/constraint strategy so total allocated quantity never exceeds item quantity.

Context links use a closed target allowlist and enforce active same-workspace/same-journey targets.

## 8. Tasks, notes and emergency information

```text
tasks
task_context_links
notes
note_context_links
emergency_info
```

Tasks support status, priority, due time, assignee, source, archive and contextual links. Assignees require current applicable access.

Notes carry an audience rather than only a global journey flag:

```text
journey_shared
party_shared
traveler_private
agency_internal
explicit_grants
```

Emergency records remain manually editable without providers or Atlas and may link to travellers, places and documents through validated context links.

## 9. Budget

All durable planned, estimated, booked, paid and to-buy values use `budget_entries`.

```text
id
workspace_id
journey_id
party_id nullable
traveler_id nullable
title
category
status
amount_minor bigint
currency_code char(3)
quantity nullable
unit_label nullable
notes nullable
due_date nullable
linked_entity_type/id nullable
audience
```

Rules:

- non-negative integer minor units;
- ISO 4217 currency;
- amount is the total, not implicitly multiplied by quantity;
- linked targets are allowlisted and same-scope validated;
- summaries never silently convert currencies;
- supplier cost/margin remains `agency_internal`;
- party/traveller add-ons retain their private audience.

Do not add parallel `cost`, `price` or `rough_budget` fields to activities, accommodation, stay options, planning items or packing items.

## 10. Documents and files

Document metadata includes:

```text
owner_type = agency | journey | party | traveler
owner_id
audience
classification
storage_mode = CENTRAL | DEVICE_ONLY
status
mime_type/size/checksum
issued_at/expires_at nullable
central_max_size_bytes = 10485760 policy (not user-controlled)
```

### Central non-sensitive lifecycle

Useful rebuild concepts retained for non-sensitive files:

```text
file_objects
document_files (version links)
document_context_links
document_access_grants where audience alone is insufficient
```

Lifecycle:

```text
initiated
→ uploaded
→ processing/checksum/malware verification
→ available | quarantined | failed
```

A replacement remains non-current until size, content/MIME, checksum and malware verification succeeds; failed/quarantined versions never replace the last available version. Every central file version is limited to 10 MiB. Object keys are server-generated. Browser clients receive only short-lived object-scoped signed operations.

### Device-only sensitive lifecycle

Highly sensitive documents use:

```text
documents metadata
document_replicas
devices
device_public_keys
encrypted_transfer_sessions
per-device wrapped document keys
```

The service never possesses plaintext or a usable document key. Temporary encrypted blobs are deleted after acknowledgement or expiry. Browser viewing is an approved time-limited end-to-end encrypted session from a trusted device.

Central `offline_available` flags are forbidden. Actual cache/replica availability is per device.

## 11. Sensitive traveller and health data

General destination health information and private traveller health information are different domains.

```text
health_snapshots             destination/provider facts
traveler_private_profiles    individual protected context
medical_documents            DEVICE_ONLY content
```

V1 permits only minimal structured allergy, critical emergency and assistance fields in central storage. They require explicit consent, purpose, narrow audience, encryption at rest and sensitive-read audit. Detailed medical content remains device-only. Private health data never enters Atlas context automatically.

## 12. Sources, weather, safety, entry and discovery

```text
source_references
source_refresh_runs
agent_research_runs
research_candidates
research_candidate_sources
weather_snapshots
safety_snapshots
health_snapshots
entry_requirements
journey_entry_status
journey_risk_items
external_places
discovery_shortlists
```

Every provider-derived record states:

```text
provider
configuration_mode = live | fixture | disabled
provenance = live | fixture | manual | agent_research
published/retrieved/expires times
source URL/attribution where permitted
```

Unknown is never displayed as safe. Provider or agent failure does not mutate owned journey data. External and agent-researched candidates become owned places, activities, accommodation or reviewed source observations only through an explicit idempotent adoption command.

V1 research candidates record submitting actor/model, structured type, rationale, source URLs, observed time, source-verification state, uncertainty and expiry. Safety/health/entry candidates require safely fetched allowlisted authoritative sources; model summaries remain separate from source facts.

Future Booking.com, Tripadvisor, Expedia or other direct adapters populate the same external candidate/provenance model. They do not write owned journey records or bypass adoption commands.

Risk-to-task conversion creates the task, contextual relationship, change events and requested risk transition atomically.

## 13. Atlas and model providers

```text
atlas_provider_configurations
atlas_conversations
atlas_messages
atlas_proposals
atlas_proposal_actions
atlas_tool_executions
```

Provider configurations store non-secret metadata and an opaque `credential_reference`; credentials live behind `CredentialStore`.

Conversations are creator-private by default. `context_manifest` records categories and IDs used, not secret content. V1 default retention is 30 days from last activity; creators can export/delete earlier, agency admins have no implicit access and sharing is explicit.

Proposal actions are separate typed rows with:

```text
action_type
schema_version
validated payload
risk level
required permission
confirmation requirement
idempotency key
status
result/error
```

The command handler revalidates actor permission, consent, versions and idempotency at confirmation. One action plus its change/audit result commits atomically.

## 14. Change engine, audit and undo

```text
change_sets
change_events
sensitive_access_events
```

Every meaningful mutation creates a change set. Events record ordered before/after state sufficient for review and compensation without making the event log the sole source of truth.

Every command declares:

```text
risk_level
reversibility = full | compensatable | partial | none
compensating_command where applicable
```

Undo/redo creates new change sets and revalidates current policy/domain state. Sensitive reads, support sessions, role changes, document requests and exports receive dedicated access audit even when no domain mutation occurs.

## 15. Offline and sync state

Syncable records use UUIDs, versions, timestamps and tombstones. The client maintains:

```text
local command queue
selective workspace/journey dataset
sync cursor/state
conflict records
local encrypted document inventory
revocation tombstones
```

Provider snapshots may be server-wins or append-only. Agent research candidates are server-validated proposal records and never sync as trusted facts before adoption. User-owned records require explicit conflict policy. Revocation removes inaccessible cached records and wrapped keys.

V1 supports offline reads/writes, encrypted local data, a durable command queue, device file cache and transfers. PowerSync is the V1 replication/local-SQLite adapter; canonical command upload and server policy remain authoritative regardless of adapter.

## 16. Generic relationship policy

Generic context links are allowed only when:

- target type is a closed enum;
- one shared resolver validates existence;
- source and target share workspace/journey and applicable party audience;
- active target is required on create;
- duplicate active links are constrained;
- no arbitrary table name or user-supplied lookup exists;
- integration tests cover cross-workspace, wrong-journey and wrong-party IDs.

Use explicit association tables where database-enforced integrity is more important than schema compactness.

## 17. Soft delete, restore and purge

- Soft delete marks aggregate root and required owned children in one command.
- Normal reads hide tombstones.
- Restore rechecks parent, uniqueness, policy and the default 30-day retention window.
- Restoring membership never silently restores private grants, consents or wrapped keys.
- Purge is an idempotent background retention process.
- Audit retention is independent.
- Syncable user data does not use hard cascade as its normal lifecycle.

Default windows are defined in [Retention and Deletion](RETENTION_AND_DELETION.md); documented legal/contract holds are narrow overrides.

## 18. Database acceptance rules

Before migrations are accepted:

- every table is classified as syncable, server-only, provider cache, audit, central file metadata, encrypted transfer metadata or device-local;
- every journey FK preserves workspace consistency;
- every party-private record preserves party/journey/workspace consistency;
- access and participation are separate;
- permissions and roles are scoped/versioned;
- dates, amounts, quantities, coordinates and paired fields have checks;
- planning and scheduled records are separate;
- costs exist only in budget entries;
- central and device-only document lifecycles cannot be confused;
- provider provenance is truthful;
- migrations are explicit and immutable;
- change/audit implications are defined for every mutation.
