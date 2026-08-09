# ADR-016 — Access, audience and resource-grant algebra

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owner:** `@Maurice-aXeTech`
- **Approver:** `@Maurice-aXeTech`
- **Decision issue:** [#6](https://github.com/aXeTech-NL/Trax-OS/issues/6)
- **Related capabilities:** Workspace/Journey policy, RLS, sync, search, MCP, Atlas, notifications and export

## Context

Trax OS combines non-configurable invariants, explicit denies, scoped roles, exact relationships, resource audiences, bounded grants, OAuth scopes, origin/tool allowlists and field filtering. Without one evaluation algebra, each adapter could make a different decision and a traveller shared by two parties could accidentally bridge their data.

## Decision

A resource retains exactly one of four default audiences:

```text
agency_internal
journey_shared
party_shared
traveler_private
```

`explicit_grants` is not an audience. A resource grant is a separate, bounded authorisation path that does not reclassify a resource or merge its audience with another scope. V1 has no grant-only audience or grant-only resource mode; adding one requires a replacement/versioned ADR and schema review.

### Terms and access bases

- **Active access membership:** an unexpired, unrevoked user membership in the applicable workspace or Journey. Journey participation is not an access membership.
- **Journey participant:** a traveller profile included in a Journey, with or without an account or access.
- **Exact party relationship:** the represented user is linked to an active participant in that exact party, or holds an exact party assignment. A participant shared with another party is not a relationship to that other party.
- **Guardian/delegate:** a verified active relationship to one traveller, constrained by permissions and data categories.
- **Approved staff:** an active workspace/Journey member with an applicable scoped assignment; staff status alone does not reveal party/private content.
- **Support access basis:** a validated, time-limited support/break-glass session with strong re-authentication, reason, selected workspace, operation and field allowlists, and audit.
- **System access basis:** an authenticated worker/system execution restricted to an allowlisted command, scope and fields.

Ordinary users require an active applicable access membership. OAuth clients, Atlas and external MCP evaluate a represented user's current membership and relationships, then narrow them. Support and system bases are explicit non-configurable paths; they are neither memberships inferred from participation nor resource grants.

### Owner and audience combinations

Resource-type policy may narrow this matrix but may not broaden it.

| Audience | Permitted owner | Required discriminator | Forbidden discriminator |
|---|---|---|---|
| `agency_internal` | Agency/workspace or Journey | owning `workspace_id`; owning `journey_id` when Journey-owned | `party_id`, `traveler_id` |
| `journey_shared` | Journey | exact owning `workspace_id` and `journey_id` | `party_id`, `traveler_id` |
| `party_shared` | One travel party | exact `workspace_id`, `journey_id` and `party_id` | `traveler_id` |
| `traveler_private` | One traveller | exact `workspace_id`, `journey_id` and `traveler_id` | `party_id` |

Every discriminator is server-resolved and must belong to the same owning workspace and Journey through composite keys/constraints. Party or traveller references needed only for context use validated relationship links; they do not change ownership or audience.

### Audience relationship resolver

An audience restricts a permission; it never grants an operation by itself.

| Audience | Default relationship that can satisfy the audience |
|---|---|
| `agency_internal` | active approved staff in the owning workspace and applicable assigned scope |
| `journey_shared` | active Journey access member in that Journey |
| `party_shared` | active relationship or assignment to that one exact party |
| `traveler_private` | the same traveller or an explicit authorised guardian/delegate for that traveller and data category |

A valid resource grant may bridge a missing default relationship for one resource/category, operation and field set. It never makes a shared traveller, guardian, staff member or grantee a member of another party.

### Normative evaluation order

For request `q = (subject, represented user, resource, operation, fields, origin, OAuth grant, purpose, time)`:

1. Resolve the resource's server-owned workspace, Journey, owner, audience and lifecycle state. Reject scope mismatch, invalid owner/audience combinations and non-configurable tenant, device-security or retention invariants.
2. Validate one explicit access basis: active applicable user membership, validated support session or allowlisted system execution. Client claims never establish the basis.
3. Apply every active explicit deny. A deny cannot be bypassed by a role, grant, support session, system execution, OAuth scope or origin.
4. Resolve independent authorisation paths:
   - ordinary base path: an active scoped role allows the operation **and** the exact audience relationship holds;
   - grant path: a valid resource grant allows the operation/fields;
   - support/system path: the validated access basis explicitly allowlists the operation/fields.
5. Require at least one path. Union the fields allowed by all currently valid independent paths.
6. Intersect the operation and fields with OAuth scopes when OAuth applies. OAuth only narrows represented-user authority.
7. Intersect with the origin/tool allowlist. Web, native, sync, worker, Atlas and MCP do not gain different domain authority.
8. For reads, return only the requested fields in the resulting intersection. For mutations, reject the whole command if any requested field is outside the intersection; never perform a silent partial write.
9. Determine confirmation, sensitive-read audit, change/audit and offline-revocation effects. Confirmation cannot turn a denied request into an allowed request.

Equivalent allow expression (field projection and audit occur afterward):

```text
invariants_and_server_scope
AND valid_explicit_access_basis
AND NOT explicit_deny
AND (
  (role_allows AND exact_audience_relationship)
  OR valid_resource_grant
  OR valid_support_or_system_allowlist
)
AND oauth_allows
AND origin_allows
```

A later step may narrow access but may not bypass an earlier invariant or deny.

### Resource-grant validity

A resource grant is valid only when all of these hold:

- grantee and represented user match;
- resource/category and workspace/Journey scope match;
- the ordinary user's applicable access membership remains active;
- operation and requested fields are permitted by the resource type;
- required purpose is present and matches;
- start/expiry and revocation state are active;
- the grantor held the operation as delegable at grant time and required provenance remains valid;
- the grant does not bypass tenant isolation, explicit deny, device-only cryptography or another non-configurable invariant.

Granting, revoking or expiring one path triggers effective-access recomputation. Offline data and wrapped keys are removed only when no other independent authorisation path remains. A grant authorises bounded access; it never changes the resource's audience.

### Enforcement boundaries

Application policy is authoritative for purpose, field, origin, confirmation and sensitive-read decisions. PostgreSQL RLS provides coarse workspace/Journey/party/traveller defence in depth but cannot replace the application decision. Queries, counts, autocomplete, search, sync, notifications, exports, Atlas and MCP must filter before data leaves their trust boundary and must use privacy-neutral failures.

The machine-readable [shared policy cases](fixtures/adr-016-policy-cases.json) are the normative design examples. The repository checker evaluates them as a conformance oracle. Runtime policy and every adapter implemented later must prove equivalent outcomes independently rather than import the documentation checker as production policy.

## Alternatives rejected

- Treating `explicit_grants` as a fifth audience overloads classification and ACL semantics.
- Representing every visibility rule as an ACL weakens simple privacy invariants and complicates RLS and sync.
- Requiring a grant in addition to every role/audience path makes normal sharing impossible and contradicts the role templates.
- Allowing grants to override denies or create membership would introduce privilege escalation and transitive party access.

## Compatibility and migration impact

No current database table, generated API or runtime policy exposes resource audiences or grants, so acceptance is non-breaking today. Canonical documents that listed `explicit_grants` as an audience or combined Journey membership/participation are reconciled in the same change. Future migrations must constrain the four audience/owner shapes, store grants separately, preserve exact scope keys and add RLS without treating it as the field/purpose policy engine.

## Validation evidence

- Owner approval and review scope: [issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6).
- Normative matrix and executable outcomes: [`fixtures/adr-016-policy-cases.json`](fixtures/adr-016-policy-cases.json).
- Automated metadata, audience vocabulary, membership illustration and fixture evaluation: [`scripts/architecture-decisions.mjs`](../../../scripts/architecture-decisions.mjs), run by `npm run architecture:check` and `make check`.
- Canonical reconciliation: [Agency Access Model](../AGENCY_ACCESS_MODEL.md), [Target Domain Model](../DOMAIN_MODEL.md), [Agentic Core](../AGENTIC_CORE.md) and [Implementation Architecture](../IMPLEMENTATION_ARCHITECTURE.md).
- Pull-request review and required CI provide the final manual and automated evidence before issue closure.

## Consequences

One fixture vocabulary can drive later policy, RLS, sync and adapter acceptance. RLS remains deliberately coarse. Role/grant changes need impact preview, audit and revocation computation. Future service-principal memberships or grant-only resources are not implied by this decision.

## Revisit trigger

Revisit for a new audience/owner type, service-principal membership, grant-only resource mode or adapter that cannot use the shared algebra without special-case privilege broadening.
