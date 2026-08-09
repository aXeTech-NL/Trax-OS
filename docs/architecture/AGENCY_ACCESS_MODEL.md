# Agency, Group Travel and Access Model

**Status:** Canonical extension to the Agentic Core Architecture  
**Related:** [Agentic Core Architecture](AGENTIC_CORE.md), [ADR-005](decisions/ADR-005-MEMBERSHIP-AND-PARTICIPATION.md), [ADR-016](decisions/ADR-016-ACCESS-POLICY-ALGEBRA.md)

## 1. Purpose

Trax OS supports travel agencies that create and operate journeys for individuals, families and larger groups. A single group journey may contain multiple privacy groups whose members share the main itinerary but must not see another group's documents, private context or add-ons.

The access model must support delegated work without creating privileged application paths. Agency staff, journey leaders, travellers, Atlas and external MCP clients all use the same commands, queries and policies.

## 2. Product modes and hierarchy

Trax OS exposes two workspace modes through the same public application core.

### Personal workspace

A personal workspace is the default, simplified product experience. Its owner can:

- create and manage their own journeys;
- invite companions to a journey;
- manage their own private context and device-only documents;
- share selected journey or party information;
- use Atlas and offline functionality without configuring an access-control matrix.

The UI labels safe built-in assignments as Owner, Editor, Viewer, Traveller and Guardian; internal templates use stable keys such as `personal_owner`, `personal_editor` and `personal_viewer`. The custom Roles & Permissions administration UI is hidden. A personal journey starts with one default travel party; advanced party management is optional rather than part of normal onboarding.

### Agency workspace

An agency workspace enables:

- a portfolio of journeys created for other people;
- agency staff and delegated organisers;
- configurable roles and permissions;
- journey leaders;
- multiple privacy-separated travel parties;
- party- and traveller-specific context, add-ons and documents;
- agency-internal commercial and operational data.

Agency mode is a public capability, not a private cloud fork. Self-hosted installations can enable the full Personal and Agency feature set, including custom roles, MCP and Atlas with an operator-provided model. Managed deployments may attach hosting, model-credit, support, branding or SLA entitlements without changing domain behaviour.

### User and workspace separation

A user may own a personal workspace and also belong to one or more agency journeys or agency workspaces. The client provides a workspace switcher, but access never flows implicitly between workspaces.

- A traveller invited by an agency receives a journey membership, not an agency staff membership.
- Agency staff cannot access the traveller's personal workspace.
- Personal documents and context are not copied into an agency workspace unless the traveller explicitly shares selected metadata or creates a scoped grant.
- An agency-created journey remains in the agency workspace; the traveller receives their permitted shared, party and private overlays.
- The agency remains owner after the journey. Export or creation of an independent personal-workspace copy is an explicit, auditable action; later agency updates do not silently modify the copy.

```text
Platform / Trax OS instance
└── Agency workspace
    ├── Agency members
    │   ├── Owner / admin
    │   └── Travel organisers
    └── Journeys
        ├── Assigned organisers
        ├── Journey leaders
        ├── Shared itinerary and context
        └── Travel parties
            ├── Family or other privacy group A
            │   ├── Party managers
            │   └── Travellers
            └── Family or other privacy group B
                ├── Party managers
                └── Travellers
```

- A **workspace** is the tenant boundary. `workspace.type` is `PERSONAL` or `AGENCY`.
- A **journey** belongs to exactly one workspace.
- A **Journey membership** records an authenticated user's access lifecycle within one Journey. Only an active membership is an access basis, and scoped role assignments remain separate.
- A **Journey participant** links a traveller profile to one Journey and creates no access by itself.
- A **travel party** is the primary privacy-sharing group inside a Journey, such as a family, couple, room-sharing group or custom composition.
- A **traveller** is a person participating in the Journey and may or may not have a user account yet.
- A **principal** is a user, service or authorised OAuth client evaluated by policy.

A verified user↔traveller identity link may establish a self relationship but grants no Journey or party access by itself. A traveller may belong to multiple travel parties in one Journey. Access is evaluated against the caller's exact relationships and never propagates transitively through a traveller to another party. Operational cohorts such as “bus 2” or “vegetarian meals” remain labels unless deliberately created as privacy parties. Each `party_shared` resource retains one exact party boundary; a bounded resource grant can authorise access without merging or reclassifying that boundary.

## 3. Scoped roles

Access is configured through the public Roles & Permissions module. A role is a named, versioned collection of permissions and constraints; a role assignment applies that definition at a specific scope. Roles are not global booleans on a user record. A person may hold multiple assignments, for example an organiser role in a workspace and a party-manager role in their own family party.

The roles below are built-in templates. Agencies may clone, rename and restrict them or create additional agency roles. Stable permission keys—not display names—form the application contract.

| Role | Scope | Primary purpose |
|---|---|---|
| `platform_super_admin` | Platform | Operate the Trax OS instance and administer workspaces |
| `personal_owner` | Personal workspace | Create and manage the owner's journeys with simplified sharing |
| `personal_editor` | Personal journey | Edit journey-shared operational data without workspace/role administration |
| `personal_viewer` | Personal journey | Read authorised journey-shared data without mutation rights |
| `agency_owner` | Workspace | Own agency settings, staff, policy and all agency journeys |
| `agency_admin` | Workspace | Administer staff and all journeys without ownership transfer |
| `travel_organizer` | Workspace or journey | Create journeys and manage assigned journeys |
| `journey_leader` | Journey | Run the shared journey and operational day-to-day plan |
| `party_manager` | Travel party | Manage one party's members, add-ons and shared context |
| `traveler` | Journey and party | Use shared journey data and their permitted private scope |
| `guardian` | Traveller relationship | Manage permitted data for a minor or dependent traveller |

Role inheritance is explicit:

- platform scope does not silently become model context;
- workspace roles apply only to that workspace;
- journey roles apply only to one journey;
- party roles apply only to the explicitly assigned travel party or parties;
- guardianship applies only to the represented traveller and permitted data categories.

A user account is not required when an agency first creates a traveller record. Invitation, participation and identity linking alone grant no access. Access starts only after identity verification activates the applicable access membership and scoped assignments.

## 4. Role capabilities

The following matrix describes the built-in templates. Actual access is calculated from role permissions, assignment scope, resource audience, bounded resource grants and non-configurable security invariants.

| Capability | Platform super admin | Agency owner/admin | Travel organiser | Journey leader | Party manager | Traveller |
|---|---:|---:|---:|---:|---:|---:|
| Create agency workspace | Yes | No | No | No | No | No |
| Manage agency staff and roles | Break-glass | Yes | No | No | No | No |
| View agency journey index | Operational | Yes | Assigned/default policy | Assigned | Own journeys | Own journeys |
| Create a journey for others | No normal workflow | Yes | Yes | No | No | No |
| Assign organiser or leader | No normal workflow | Yes | Assigned journey if delegated | No | No | No |
| Edit shared itinerary | Support only | Yes | Assigned journey | Assigned journey | No | No |
| Create and manage parties | Support only | Yes | Assigned journey | If delegated | Own party only | No |
| View journey-shared context | Support only | Yes | Assigned journey | Assigned journey | Own journey | Own journey |
| View a party's private context | Exceptional access | Policy/grant | Assigned operational grant | Explicit grant only | Own party | Own party |
| Manage party add-ons | No normal workflow | Operational grant | Assigned journey | Explicit operational grant | Own party | Own selection |
| View traveller-private data | Exceptional access | Lawful-purpose grant | Explicit grant/request | Explicit grant/request | Own/represented traveller | Own data |
| Read device-only document content | Never by role | Never by role | Never by role | Never by role | Device/session approval | Own device/session approval |

“Support only” and “exceptional access” are not ordinary agency-configurable permissions. They require an explicit, time-limited, audited support or break-glass session.

## 5. Roles & Permissions module

The module is part of the public product and is available to self-hosted and managed agency workspaces. Personal workspaces use the same policy engine with safe built-in templates but do not expose the advanced administration UI.

### Permission registry

Permissions use stable namespaced keys and declare their valid scope, risk and delegation behaviour. The registry is versioned application code/data shipped by the public product; agencies can compose registered permissions into roles but cannot invent permissions or redefine their security properties.

```text
workspace.read
workspace.settings.manage
workspace.members.invite
workspace.members.remove
access.roles.read
access.roles.manage
access.assignments.manage
access.effective_access.inspect

journey.create
journey.read
journey.update
journey.archive
journey.organizers.assign
journey.leaders.assign
journey.travelers.invite
journey.travelers.remove

party.create
party.read
party.update
party.members.manage
party.addons.read
party.addons.manage

traveler.read_basic
traveler.private_context.read
traveler.private_context.manage

documents.metadata.read
documents.assign_to_device
documents.request_from_device

research.context.read
research.candidates.submit
research.candidates.review
research.candidates.adopt

atlas.use_workspace_provider
atlas.providers.manage_workspace
atlas.usage_quotas.manage

budget.read
budget.manage
audit.read
changes.undo
```

A permission definition includes:

```text
key
allowed_scope_types
allowed_resource_types
operations
field_set
risk_level
delegable
requires_purpose
requires_explicit_grant
```

There is deliberately no configurable `documents.content.read_all` permission. Device-only content access remains a cryptographic consent flow rather than an RBAC shortcut.

### Role definitions

Built-in role templates provide safe defaults:

```text
personal_owner
personal_editor
personal_viewer
agency_owner
agency_admin
travel_organizer
journey_leader
party_manager
traveler
guardian
```

An agency can:

- clone a built-in template;
- create and name a custom role;
- add or remove permissions it is allowed to delegate;
- constrain a role to assigned journeys or parties;
- define whether assignments may be delegated;
- set assignment start and expiry dates;
- archive a role that is no longer used.

The `personal_owner` template is managed by the product's simple personal-sharing workflow rather than the advanced role editor. The platform role `platform_super_admin` and break-glass permissions are not editable by any workspace.

### Policy combination

Effective access follows the normative ordering and independent authorisation paths in [ADR-016](decisions/ADR-016-ACCESS-POLICY-ALGEBRA.md): server-derived invariants and scope, a valid explicit access basis, explicit deny, scoped role plus exact audience relationship or a valid bounded grant, OAuth/origin narrowing, field policy, then confirmation/audit/revocation effects. Support and system execution use separate allowlisted access bases rather than implicit customer membership.

A role manager cannot grant a permission that they do not hold with `delegable = true` at the same or a broader applicable scope.

### Administration UI

The agency desktop console provides:

- role templates and custom roles;
- a permission matrix grouped by domain;
- user-to-role assignments with scope and expiry;
- warnings for high-risk permission combinations;
- an impact preview before changing a role used by existing assignments;
- an “effective access” inspector for a selected user and resource;
- assignment and permission-change history;
- emergency revocation.

Role-definition changes, high-risk assignments and permission broadening create change sets and require preview. Changes that affect offline access create revocation tombstones and invalidate relevant sessions where necessary.

## 6. Resource audiences

Every resource that can contain scoped information carries exactly one audience classification.

```text
agency_internal
journey_shared
party_shared
traveler_private
```

### `agency_internal`

Ordinary default visibility is limited to active approved agency staff in the applicable scope. Explicit support/system access bases remain separately constrained and audited under ADR-016. Examples:

- supplier contracts;
- margin and commission;
- internal operational notes;
- staff task assignments.

### `journey_shared`

Visible to active Journey access members whose scoped permissions allow the operation. Participation alone grants no access. Examples:

- group itinerary;
- meeting points;
- journey-wide announcements;
- shared transport updates.

### `party_shared`

Visible to members and managers of one travel party plus staff who have an explicit operational grant. Examples:

- family-specific room allocation;
- party add-ons and invoices;
- private pickup arrangement;
- party notes and packing list.

### `traveler_private`

Visible to the traveller, an authorised guardian/delegate and explicitly approved staff where required. Examples:

- personal preferences that are not shared with the party;
- individual assistance needs;
- personal document metadata;
- personal emergency details.

### Resource grants are separate

When default audience relationships are insufficient, a resource grant identifies the grantee, resource or category, allowed operations and fields, purpose, validity window and delegation provenance. A grant does not change the resource audience, create membership or propagate access through a shared traveller. V1 defines no grant-only audience or resource mode.

Changing an audience classification or adding broader access through a grant is a high-risk command with preview and explicit approval. V1 research context and submitted candidates inherit an explicit Journey/party/traveller audience; external agents never receive a full agency Journey or unrelated party preferences.

## 7. Shared plan and private overlays

A group journey has one shared baseline and scoped overlays.

```text
Journey baseline
├── shared route
├── shared stays and transport
├── shared activities
└── shared announcements

Party overlay
├── room allocation
├── transfers
├── add-ons
├── invoices
└── party notes

Traveller overlay
├── personal tasks
├── individual add-ons
├── assistance requirements
└── private document metadata
```

Queries compose only the overlays visible to the caller. Clients never receive a complete journey response and hide unauthorised parties locally.

## 8. Documents

Documents have both an owner and an audience.

```text
document.owner_type = journey | party | traveler | agency
document.owner_id
document.audience
document.storage_mode = CENTRAL | DEVICE_ONLY
```

Examples:

| Document | Owner | Audience | Storage |
|---|---|---|---|
| General tour handbook | Journey | `journey_shared` | Central allowed |
| Family hotel voucher | Party | `party_shared` | Central or device-only by sensitivity |
| Agency supplier contract | Agency | `agency_internal` | Central allowed |
| Passport scan | Traveller | `traveler_private` | `DEVICE_ONLY` |
| Medical certificate | Traveller | `traveler_private` | `DEVICE_ONLY` |

Agency staff may request a device-only document or a minimal extracted field when operationally necessary, but role membership alone never grants content access. The trusted device owner or authorised guardian must approve the time-limited request. The server still cannot decrypt the content.

## 9. Add-ons, bookings and financial visibility

Add-ons and bookings retain an owner and operational fulfilment grants.

- Journey-wide inclusions are `journey_shared`.
- A family's excursion, upgrade or invoice is `party_shared`.
- A personal add-on is `traveler_private` unless deliberately shared.
- Agency staff responsible for fulfilment receive the minimum operational fields through an explicit policy grant.
- Supplier cost, margin and commission remain `agency_internal` and are not exposed to journey participants.

Trax does not execute payments or provider bookings. Any audience/financial-visibility broadening remains a high-risk action.

## 10. Commands and queries

Agency behaviour extends the canonical command contract rather than bypassing it.

### Commands

```text
workspace.create_personal
workspace.create_agency
workspace.invite_member

access.role_definition.create
access.role_definition.update
access.role_definition.archive
access.role.assign
access.role.revoke
access.grant
access.revoke

journey.create_for_travelers
journey.assign_organizer
journey.assign_leader
journey.invite_traveler
journey.remove_traveler

party.create
party.update
party.add_member
party.remove_member
party.replace_memberships
party.assign_manager
party.archive

resource.change_audience

addon.create
addon.book_for_party
addon.book_for_traveler
```

Role changes, party-membership changes, traveller removal, access grants and audience broadening require an impact preview because they can expose or revoke data across devices and offline replicas.

### Queries

```text
GET /agency/journeys
GET /agency/staff
GET /agency/access/roles
GET /agency/access/assignments
GET /access/effective
GET /journeys/{id}/participants
GET /journeys/{id}/parties
GET /journeys/{id}/my-context
GET /parties/{id}/addons
GET /travelers/{id}/documents
```

Every query is policy-filtered server-side. List counts, search facets, autocomplete and error messages must not reveal inaccessible parties or travellers.

## 11. Policy evaluation

RBAC provides baseline capabilities; [ADR-016](decisions/ADR-016-ACCESS-POLICY-ALGEBRA.md) defines the normative attribute-, relationship-, grant- and origin-aware decision. The ordinary authorisation paths are `(scoped role AND exact audience relationship) OR valid bounded resource grant`; invariants, active access basis and explicit deny are mandatory before either path.

`ExecutionContext` includes at least server-derived:

```text
actor_type
actor_id
represented_user_id
workspace_id
active_access_memberships
active_role_assignments
journey_id
resolved_party_relationships
resolved_traveler_relationships
oauth_client_id
scopes
origin
purpose
support_session_id
```

Relationship fields are resolved for the selected resource; they are not reusable client claims. Policies return a structured decision with allowed fields, denied fields, reason, required confirmation and audit requirements. Reads project allowed fields, while mutations with any unauthorised field fail atomically. The decision records the evaluated role-definition revisions and independent authorisation paths so later role/grant edits cannot make historical access decisions ambiguous.

## 12. Persistence model

Illustrative tables:

```text
workspaces
├── id
├── type = PERSONAL | AGENCY
├── name
├── created_by
└── policy_configuration

permission_definitions
├── key
├── allowed_scope_types
├── allowed_resource_types
├── risk_level
├── delegable
└── invariant

role_definitions
├── id
├── workspace_id
├── key
├── display_name
├── template_source
├── current_revision
└── archived_at

role_definition_revisions
├── id
├── role_definition_id
├── revision
├── changed_by
└── created_at

role_permission_entries
├── role_definition_revision_id
├── permission_key
├── effect = ALLOW | DENY
└── constraints

role_assignments
├── id
├── principal_type
├── principal_id
├── role_definition_id
├── scope_type = PLATFORM | WORKSPACE | JOURNEY | PARTY | TRAVELER
├── scope_id
├── starts_at
├── expires_at
└── revoked_at

traveler_user_links
├── user_id
├── traveler_id
├── verification_status
├── established_at
└── revoked_at

journey_memberships
├── id
├── journey_id
├── user_id
├── status = INVITED | ACTIVE | DECLINED | REMOVED
├── joined_at
└── revoked_at

journey_participants
├── id
├── journey_id
├── traveler_id
├── status = ACTIVE | REMOVED
├── joined_at
└── removed_at

travel_parties
├── id
├── journey_id
├── display_name
├── party_type
└── status

party_memberships
├── party_id
├── journey_participant_id
├── status
├── is_default_for_ui
├── joined_at
├── revoked_at
└── record_version

resource_grants
├── id
├── workspace_id
├── journey_id
├── resource_type
├── resource_id
├── principal_type
├── principal_id
├── operations
├── allowed_fields
├── purpose
├── granted_by
├── delegation_provenance
├── starts_at
├── expires_at
└── revoked_at
```

All journey-owned tables include `workspace_id` and `journey_id`; party-scoped records also include `party_id`. PostgreSQL row-level security provides defence in depth from the first migration, but application policies remain authoritative for field-level and purpose-based decisions.

## 13. Invitations, removal and offline revocation

For Agency Journeys:

1. An organiser creates a Journey and separate placeholder Journey-participant records.
2. Parties, party memberships and private audiences are assigned before email invitations with a seven-day default expiry are sent.
3. Invitees verify their user identity; an approved invitation creates/activates a separate Journey access membership and may create the explicit user↔traveller link named by the invitation. Resend and revoke invalidate earlier tokens.
4. Participation and an identity link grant no access; access starts only after the Journey membership and required scoped assignments become active.
5. The sync API issues only records permitted by the active access basis and exact relationships.
6. A role, party or journey removal creates revocation tombstones.
7. Clients purge inaccessible cached records and wrapped document keys on next sync.
8. Security-sensitive revocations invalidate relevant sessions and refresh tokens immediately.

Adding, removing or replacing a traveller's party membership is a high-risk operation. The preview lists resources that will become accessible, remain accessible or be removed from offline replicas. Revoking one membership preserves independently authorised data from another membership/grant.

## 14. Atlas, MCP, search and context isolation

Atlas and external MCP clients receive the same filtered view as the represented user and granted scopes.

- MCP resources never return an unfiltered full journey.
- V1 `research-context` exposes only the destination, dates and preference fields approved for the selected journey/party scope.
- Research candidate submission cannot adopt or schedule a candidate; a permitted user performs that separate command.
- Tool schemas accept explicit journey and party context where needed.
- OAuth grants may be restricted to a workspace, journey or party.
- Administrative scopes such as `roles:write` are never granted to Atlas or external agents by default.
- Role and permission management is not part of the default MCP tool set; any explicit administrative integration remains high risk and requires agency-admin consent.
- Semantic-search embeddings carry workspace, journey, audience, party and traveller filters.
- Retrieval filters are applied before context reaches a model.
- Cached prompts and responses cannot be reused across principals or parties.
- Agency-wide model context is never inferred from `platform_super_admin` access.
- Audit records include represented user, role scope, selected audience and policy decision.

## 15. Administrative and break-glass access

`platform_super_admin` is an operational role, not an invisible universal application user.

Normal access provides tenant health, deployment and metadata needed to operate the instance. Access to centrally stored customer content requires:

- a support case or incident reason;
- strong re-authentication and MFA;
- an explicitly selected workspace;
- a time-limited support session;
- least-privilege fields and operations;
- immutable access audit;
- optional customer notification according to policy;
- no export unless separately approved.

No administrative role can retrieve device-only plaintext or decryption keys because the platform does not possess them.

Agency owners and admins may administer all agency journeys and staff. By default they receive no party- or traveller-private content merely because of their workspace role; a configured lawful-purpose grant is required and sensitive reads are audited.

## 16. Audit requirements

In addition to command change sets, sensitive reads and administrative sessions record:

- actor and represented principal;
- assigned role and scope;
- workspace, journey, party and traveller scope;
- resource and allowed fields;
- purpose and policy decision;
- support or consent reference;
- timestamp and expiry;
- export or disclosure outcome.

The audit UI distinguishes agency actions, journey-leader actions, party actions, Atlas, external MCP, sync and platform support.

## 17. Client experiences

### Personal experience

- own journey list and create-journey flow;
- simple companion invitations and sharing controls;
- own private context and device-only documents;
- no staff, portfolio or custom-role administration;
- optional switcher when the user also has agency or invited journeys.

### Agency desktop console

- journey portfolio and status;
- roles, permission matrix and effective-access inspection;
- organiser and leader assignment;
- traveller invitation state;
- party composition and privacy boundaries;
- shared itinerary management;
- operational add-on and booking fulfilment;
- role/access review and audit history.

### Dedicated white-label agency experience

- agency-scoped name, logo, colours, customer copy and support/legal links;
- custom web domain, branded email/invitations and PDF/export output;
- branding loaded after first workspace login and cached by official clients;
- the same server-enforced permissions and privacy audiences;
- a clear active-agency identity to prevent scope confusion;
- no brand leakage into the user's Personal workspace;
- no separate package, signing identity, publisher, app-store listing or update channel.

### Journey leader workspace

- shared schedule and announcements;
- attendance and operational contact data;
- explicitly granted party requirements;
- no automatic access to private documents or unrelated party context.

### Traveller and party experience

- shared journey baseline;
- overlays for each party the caller is directly authorised to access;
- own or represented traveller-private data;
- clear audience labels before sharing;
- party add-ons, invoices and documents;
- no names, counts, search results or notifications from inaccessible parties unless deliberately journey-shared.

## 18. Security invariants

1. Personal and agency workspaces use the same command, query and policy engine.
2. Workspace type selects product capabilities and UX, not alternative domain logic.
3. Workspace, journey and party filtering happens server-side.
4. An agency invitation never creates agency staff access implicitly.
5. No role or membership crosses a workspace boundary implicitly.
6. Roles are configurable permission collections with scoped assignments, never unscoped user flags.
7. A principal cannot delegate permissions they do not hold as delegable.
8. Platform break-glass, tenant isolation, audit and device-only cryptography are not workspace-configurable.
9. A travel party is a privacy boundary, not merely a UI grouping.
10. A traveller may belong to multiple privacy parties, but authorisation never propagates transitively between them.
11. Every `party_shared` resource retains one exact party; a bounded grant may authorise specific access but never broadens or reclassifies that audience.
12. Agency staff access follows purpose and least privilege.
13. Audience broadening, role broadening and party-membership changes require preview and approval.
14. Sensitive reads are audited as well as mutations.
15. Offline revocation removes inaccessible cached data and wrapped keys.
16. Atlas, MCP and search cannot bypass party isolation.
17. Device-only content remains unavailable to every server-side role.
