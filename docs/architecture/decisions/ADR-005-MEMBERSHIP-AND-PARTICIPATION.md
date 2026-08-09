# ADR-005 — Separate Journey access membership from travel participation

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owner:** `@Maurice-aXeTech`
- **Approver:** `@Maurice-aXeTech`
- **Decision issue:** [#6](https://github.com/aXeTech-NL/Trax-OS/issues/6)
- **Related capabilities:** Identity, Journeys, invitations, parties and access control

## Context

A user can manage a Journey without travelling, and a traveller can participate without a user account. Combining the user's access state with the traveller's participation row would make placeholder travellers and non-travelling organisers difficult to represent and would encourage implicit or transitive access.

## Decision

Journey access and travel participation are separate relationships.

```text
users ──< journey_memberships >── journeys
traveler_profiles ──< journey_participants >── journeys
journey_participants ──< party_memberships >── travel_parties
users ──< traveler_user_links >── traveler_profiles
```

The names are conceptual contracts; reviewed migrations choose exact keys and constraints while preserving these boundaries.

Minimum invariants:

1. `journey_memberships` record an authenticated user's Journey-access lifecycle. Only an active membership is an access basis, and the membership does not contain or require `traveler_id`.
2. `journey_participants` link a traveller profile to a Journey. They do not contain or require `user_id`.
3. Role definitions and assignments remain separate from membership state. Activating a membership does not silently create an unscoped role.
4. Party membership references a Journey participant and one party in the same Journey. Sharing a participant never links two parties for authorisation.
5. A verified user↔traveller identity link may establish a self relationship for policy evaluation, but it grants neither Journey access nor party access by itself.
6. Invitation acceptance verifies identity and creates or activates only the explicitly approved access membership and assignments. It may link an existing participant only when that link was part of the approved invitation.
7. Guardian/delegate authority is an explicit verified relationship plus permission. It is never inferred from labels or participation.
8. Removing access does not silently delete participation. Removing participation revokes invalid party relationships and private grants without removing an independently valid access membership.
9. Access and participation changes produce the required change, audit and offline-revocation effects in their implementation issues.

OAuth clients and Atlas act through a represented user's current memberships and can only narrow that user's authority. They do not receive Journey memberships of their own. Time-limited support sessions and allowlisted system execution are separate non-configurable access bases defined by [ADR-016](ADR-016-ACCESS-POLICY-ALGEBRA.md), not participation records.

## Alternatives rejected

A combined Journey membership containing both `user_id` and `traveler_id` conflates the actor with the person travelling, prevents clean placeholder and organiser cases, and creates a path for party access to propagate through shared traveller records.

## Compatibility and migration impact

The current application has no Journey membership, participant or party-membership tables and exposes no related public contract, so acceptance requires no migration or compatibility alias today. The first implementation must introduce separate tables, same-workspace/Journey constraints, explicit identity links and policy/RLS coverage. Any future deployed combined schema requires a reviewed data migration rather than editing this ADR.

## Validation evidence

- Owner approval and review scope: [issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6).
- Canonical model reconciliation: [Target Domain Model §4](../DOMAIN_MODEL.md#4-travellers-journeys-and-parties) and [Agency Access Model §12](../AGENCY_ACCESS_MODEL.md#12-persistence-model).
- Executable design cases cover a non-travelling organiser, a placeholder traveller without access, exact/non-transitive party relationships and guardians: [`fixtures/adr-016-policy-cases.json`](fixtures/adr-016-policy-cases.json).
- Automated decision, schema-illustration and fixture validation: [`scripts/architecture-decisions.mjs`](../../../scripts/architecture-decisions.mjs), run by `npm run architecture:check` and `make check`.
- Pull-request review and required CI provide the final manual and automated evidence before issue closure.

## Consequences

Composite Journey setup uses one command and Unit of Work even though it creates separate access and participation records. Queries must join relationships explicitly and must not infer access from a shared traveller.

## Revisit trigger

Revisit only before the first schema freeze or when a new verified identity/representation requirement cannot be modelled without weakening these invariants.
