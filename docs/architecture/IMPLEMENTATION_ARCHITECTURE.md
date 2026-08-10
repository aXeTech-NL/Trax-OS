# Implementation Architecture

**Status:** Accepted V1 implementation baseline  
**Authority:** Must preserve the Agentic Core, Agency Access, Atlas Provider and device-document invariants  
**Scope:** V1 public core for self-hosted and managed deployments.

## 1. Architectural style

Start as a modular monolith, not a collection of microservices.

```text
React/TypeScript clients
→ feature hooks and application services
→ repository/gateway interfaces
→ online or local adapters
→ FastAPI transport adapters
→ command/query application layer
→ domain modules and ports
→ PostgreSQL and controlled integrations
```

Separate deployables may exist for the API, workers and MCP transport, but they consume the same public application contracts and command handlers. Extract a service only after a demonstrated scaling, deployment, ownership or regulatory boundary.

## 2. V1 technology baseline

```text
Web client           React + TypeScript
Mobile shell         Capacitor over shared TypeScript feature packages
Desktop shell        Tauri over shared TypeScript feature packages
API                   Python + FastAPI + Pydantic v2
Persistence           SQLAlchemy 2.x + async Postgres driver + Alembic
Database              PostgreSQL + PostGIS; no pgvector in V1
Non-sensitive files   S3-compatible object storage; 10 MiB per central file version
Device-only transfer  temporary encrypted transfer storage
Offline/sync          PowerSync + encrypted local SQLite + canonical command queue
Workers               Python worker process reusing application services
MCP                   public adapter over the same command/query contracts
Client contracts      OpenAPI/JSON Schema plus generated/validated TypeScript types
Self-hosting          Docker Compose in V1; Helm/Kubernetes after V1
```

The complexity of composite keys, row-level security, partial indexes, explicit constraints and migration control justifies direct SQLAlchemy/Alembic use rather than treating an ORM convenience layer as the schema authority.

For the V1 HTTP API, public Pydantic wire models plus FastAPI path-operation declarations are the canonical authored contract. Deterministic OpenAPI 3.1 is the language-neutral publication/review artifact, and TypeScript declarations are generated static projections rather than runtime validators. [ADR-002](decisions/ADR-002-CONTRACT-AUTHORITY.md) defines ownership, compatibility policy and reconsideration triggers.

## 3. Public monorepo mapping

```text
apps/
├── web/                 URL-routed React application
├── mobile/              mobile shell over shared feature contracts
├── desktop/             desktop planning cockpit shell
├── api/                 FastAPI modular monolith
├── worker/              background-job adapter
├── mcp-server/          MCP transport adapter
└── atlas/               provider-neutral Atlas orchestration/client surface

packages/
├── api-contract/        versioned public wire schemas
├── api-client/          generated/maintained clients
├── domain/              language-neutral vocabulary and documentation, not shared ORM models
├── commands/            canonical command schemas/registry
├── queries/             canonical query schemas/registry
├── access-control/      permission registry and policy contracts
├── change-engine/       preview/change-set/undo contracts
├── sync-engine/         offline command and reconciliation contracts
├── sync-powersync/      selected PowerSync replication/local-store adapter
├── model-provider-*/    Atlas provider interfaces and adapters
├── credential-store/    secret-storage port
├── offline-store/       client local persistence contracts
└── ui/                  shared design-system implementation
```

Python domain models and TypeScript UI models are not forced into one executable package. Python API modules own HTTP wire constraints and operation declarations; `packages/api-contract` owns only generated projections. TypeScript adapters retain explicit untrusted-JSON checks and wire-to-domain mapping. CI regenerates artifacts twice, checks committed drift and rejects fixture-proven incompatible changes against the trusted base revision.

## 4. Backend module boundaries

FastAPI application modules:

```text
identity
workspaces_and_access
journeys_and_travelers
places
planning_timeline
scheduled_timeline
packing
activities_and_stays
tasks_and_notes
budget
documents_and_devices
emergency
safety_health_entry
sources_and_discovery
atlas
changes_and_audit
sync
```

Each module owns its persistence and application commands. Cross-module writes call the owning module's service inside the same Unit of Work. A timeline handler may call the task command service; it does not insert a task row directly.

## 5. Request and command flow

```text
FastAPI route / MCP tool / sync adapter / worker
→ authenticate principal
→ resolve workspace, journey, party and resource
→ evaluate permission, audience, purpose and risk policy
→ validate versioned command
→ begin Unit of Work
→ execute owning application/domain services
→ create change set and ordered change events
→ commit once
→ publish post-commit work through an outbox where required
→ return typed result
```

Routes parse transport input, invoke dependencies and map expected errors. They do not construct persistence models, call `commit()` for business workflows or duplicate policies.

One user intent is atomic whenever all effects are in PostgreSQL. Required examples:

- create a Personal/Agency journey with initial access, parties and default packing list;
- create a stay/move with typed detail;
- promote a planning option into the scheduled timeline;
- change a role assignment and create revocation effects;
- convert a risk into a linked task;
- apply one Atlas proposal action and its audit/change records;
- switch the current non-sensitive document file version after verification.

External object storage and model/provider calls cannot join a database transaction. Use explicit staged state plus idempotent cleanup or an outbox.

## 6. FastAPI conventions

- Use domain-focused `APIRouter` instances with prefixes, tags and shared dependencies declared at router level.
- Use `Annotated[..., Depends(...)]` aliases for reusable dependencies.
- Use Pydantic v2 request and response models; do not expose ORM records directly.
- Give path operations explicit return types or response models to filter sensitive fields.
- Use `async def` only with non-blocking database/provider calls; never run blocking work inside the event loop.
- Use a lifespan context manager for shared clients and controlled startup/shutdown.
- Keep one HTTP operation per function.
- Use stable machine-readable error codes and request IDs.
- Stream Atlas responses through a reviewed SSE/streaming contract when implemented; streaming does not bypass proposal persistence or policy.

Dependency resolution returns an immutable execution context. Long-lived client claims never replace current policy checks for sensitive actions.

## 7. Principal and execution context

[ADR-016](decisions/ADR-016-ACCESS-POLICY-ALGEBRA.md) defines the normative evaluation order. Context relationships are resolved server-side for the selected resource and cannot be supplied as reusable client authority.

```text
principal_type = user | oauth_client | system
principal_id
represented_user_id
session_or_grant_id
workspace_id
workspace_type
journey_id
active_access_memberships
resolved_party_relationships
resolved_traveler_relationships
role_assignments and evaluated revisions
oauth_scopes
origin = web | mobile | desktop | atlas | external_mcp | offline_sync | worker
purpose
request_or_job_id
support_session_id
```

Security context is server-derived. Clients may provide resource IDs, client-generated entity IDs, expected versions and idempotency keys, but never authoritative actor, workspace owner, role, grantor or confirmation identity.

Every object-ID lookup resolves:

```text
object ID
→ owning workspace/journey/party
→ current resource audience and grants
→ requested operation and permitted fields
```

Use privacy-preserving not-found responses where revealing existence would leak another workspace or travel party.

## 8. Commands, queries and read models

Practical separation is sufficient; no event-sourcing framework is required.

Commands:

- are versioned and idempotent where retryable;
- validate optimistic entity versions;
- declare required permission and risk level;
- create change sets;
- define reversibility and compensation;
- execute in one Unit of Work.

Queries:

- never mutate domain state;
- apply server-side workspace, party, traveller and field filtering;
- may return view-oriented aggregates;
- use cursors or `updated_since` semantics for growing/syncable collections;
- do not return full data and rely on the client to hide it.

Useful read models retained from the rebuild:

```text
HomeSnapshot
PlanningBoard
ScheduledTimeline
PackingSummary
BudgetSummary
DocumentVaultSummary
SafetyHealthEntrySummary
JourneyReadinessSummary
EffectiveAccessExplanation
ChangeSetDetail
```

## 9. Frontend data boundary

```text
screen/component
→ query or command hook
→ injected repository/gateway interface
→ online adapter now and/or local adapter
```

Feature components never call `fetch`, object-storage SDKs, local storage, SQLite, sync engines or model providers directly.

Separate syncable repositories from online-only gateways.

Syncable domain examples:

```text
journeys and travellers
planning and scheduled timeline
packing, tasks, notes and budget
document metadata and replicas
emergency information
last-known source snapshots
```

Online-only gateway examples:

```text
provider candidate search
source refresh
safe source-URL verification
signed transfer session issuance
BYO/managed model calls
external discovery and agent research submission
```

An offline client may show cached output from an online gateway but never imitate a successful live call.

## 10. Routing and UI state

Every major screen is URL-addressable. The active workspace, journey, mode and detail identity live in the route where safe. Browser back/forward and reload restore the same authorised location.

Every feature defines:

```text
loading
empty
permission-limited
validation error
network/provider unavailable
stale source data
version conflict
soft-deleted/not found
offline with pending command
sync conflict
```

A typed navigation registry drives mobile, desktop and hub surfaces so they cannot drift. Mobile uses `Home · Timeline · Packing · Documents · More`; Atlas is a contextual floating panel/sheet rather than a primary tab.

## 11. Error contract

Representative response:

```json
{
  "error": {
    "code": "journey_write_forbidden",
    "message": "You do not have permission to change this journey.",
    "details": {},
    "request_id": "req_01K..."
  }
}
```

Stable categories include:

```text
not_authenticated
resource_not_found
workspace_access_forbidden
journey_read_forbidden
journey_write_forbidden
party_access_forbidden
permission_required
sensitive_data_forbidden
validation_failed
invalid_state_transition
version_conflict
idempotency_conflict
online_required
provider_unavailable
source_verification_failed
research_candidate_invalid
upload_not_ready
atlas_action_blocked
```

Clients localise by error code and never parse English message text.

## 12. Persistence and migration discipline

All online authoritative schema changes use explicit immutable Alembic revisions.

- Never import current ORM metadata from a historical migration.
- Never edit an applied migration.
- Upgrade an empty database to head in CI.
- Compare migrated schema and ORM mappings.
- Use database foreign keys, checks, partial uniqueness and indexes for durable invariants.
- Do not build a previous-MVP importer: V1 starts from a clean database because no production data is retained.
- Retain minimal sync graveyard metadata and reject stale incremental reconciliation according to the canonical [`P90D` connected-sync reset boundary](RETENTION_AND_DELETION.md#connected-sync-offline-support-boundary).

PostgreSQL row-level security is defence in depth for workspace/party isolation. Application policies remain authoritative for field, purpose and relationship rules.

## 13. Integration ports

Backend integrations use narrow ports such as:

```text
ObjectStoragePort
EncryptedTransferPort
CredentialStore
PlaceSearchPort
WeatherProviderPort
SourceProviderPort
SourceVerificationPort
ModelProviderPort
NotificationPort
Clock
IdGenerator
Outbox
```

Atlas never receives arbitrary HTTP, SQL, filesystem, payment or booking tools. BYO model endpoints use a dedicated validated provider adapter and hardened egress rather than a generic URL proxy.

V1 agent research uses least-privilege MCP candidate-submission tools. Submitted source URLs are checked through `SourceVerificationPort`, which applies safe URL canonicalisation, DNS/private-network/metadata protection, redirect/size/time limits and source-category allowlists. Web content remains untrusted data and cannot alter system instructions or tool authority.

## 14. Background work

Likely jobs:

```text
source refresh and expiry
research candidate/source verification and expiry
abandoned non-sensitive upload cleanup
malware/checksum processing
soft-deleted object purge
encrypted transfer expiry/deletion
Atlas proposal and conversation expiry
revocation/session invalidation
notification delivery
change/outbox publication
```

Workers use authenticated, command-allowlisted system principals and normal application handlers. They do not contain a second implementation of business logic.

## 15. Observability and audit

Operational telemetry records request/job IDs, command names, policy denials, provider mode/latency, transfer states and sanitized failures.

Do not log:

- passwords, refresh tokens or OAuth tokens;
- provider API keys or authorization headers;
- document bytes or device keys;
- raw health data;
- inaccessible party/traveller context;
- full sensitive Atlas context or chain-of-thought.

Application audit/change history and operational telemetry remain separate stores with distinct retention and access policy. Operational telemetry uses explicit field allowlists and contains only privacy-preserving crash, performance and coarse counter data. Prompts, responses, document content, health data and raw command payloads are prohibited. Non-essential telemetry exposes a clear opt-out. Apply [Retention and Deletion](RETENTION_AND_DELETION.md).

## 16. Architecture fitness checks

Automate at least:

- direct network calls exist only in approved adapters;
- feature code does not import concrete adapters;
- routes do not add/commit ORM business records;
- workers, sync and Atlas call canonical handlers;
- every mutating command declares permission, risk and reversibility;
- every syncable model has workspace/lifecycle/version fields;
- every Journey record preserves workspace and party consistency;
- Journey access membership remains separate from participation under [ADR-005](decisions/ADR-005-MEMBERSHIP-AND-PARTICIPATION.md);
- runtime policy and every adapter prove equivalent outcomes against the shared [ADR-016 cases](decisions/fixtures/adr-016-policy-cases.json);
- restricted query projections, atomic rejection of unauthorised mutation fields and sensitive read audits are tested;
- BYO endpoint/secret boundaries are tested;
- research MCP scopes, citation validation, safe-fetch and indirect prompt-injection boundaries are tested;
- migrations upgrade an empty database and core workspace/party tables have RLS policies from their first migration;
- OpenAPI generation is byte-identical across independent runs, generated files match, and HTTP changes remain compatible with the trusted base revision;
- command, MCP, sync and TypeScript contracts remain compatible with advertised client ranges as those contracts are introduced;
- fixture data is never labelled live;
- offline claims have matching local-store acceptance evidence;
- the PowerSync integration passes party filtering, revocation, idempotency, client and licence/self-hosting gates;
- every central file remains unavailable until size, MIME/checksum and malware verification succeeds.

## 17. Release gates

A vertical feature is complete only when:

- product requirement and audience are defined;
- command/query and policy exist;
- transaction, change set and undo classification exist;
- persistence/integration failure behaviour is defined;
- web/mobile/desktop contract use is integrated as applicable;
- loading, permission, offline, conflict and error states exist;
- unit, PostgreSQL integration, API contract and security tests pass;
- migration and self-hosting impact are documented;
- Docker Compose can run every required public dependency, including malware scanning and the selected sync path.
