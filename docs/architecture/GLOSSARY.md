# Canonical architecture glossary

- **Status:** Accepted terminology baseline
- **Decision:** [ADR-004](decisions/ADR-004-CANONICAL-TERMINOLOGY.md)

Trax OS uses British English in authoritative prose and English user-facing copy, while stable machine contracts use American English where the spellings differ. Localised copy remains independent of machine identifiers.

| Concept | Prose and English UI | Code, wire, route and database identifiers |
|---|---|---|
| Person who travels | traveller / travellers | `traveler`, `travelers`, `traveler_id` |
| Travel participation record | journey participant | `journey_participant`, `journey_participants` |
| Access to a Journey | Journey membership | `journey_membership`, `journey_memberships` |
| Privacy group inside a Journey | travel party | `travel_party`, `travel_parties`, `party_id` |
| Person whose access is evaluated | principal | `principal_type`, `principal_id` |
| Product aggregate | Journey | `journey`, `journey_id` |

Illustrative machine-contract shape (not a claim that this API or schema is implemented):

```text
GET /journeys/{journey_id}/travelers
traveler_profiles.traveler_id
journeys_and_travelers
```

Rules:

- Do not publish both spellings as aliases in one API, event, command, package or database contract.
- Generated clients preserve the canonical wire spelling without conversion.
- URLs, permission keys, schema names and serialised fields are machine contracts.
- Documentation may quote a legacy or rejected identifier only when it is clearly labelled as such.
- Dutch and future locale catalogues translate visible copy; they do not rename machine contracts.
