# ADR-004 — Canonical traveller/traveler terminology

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owner:** `@Maurice-aXeTech`
- **Approver:** `@Maurice-aXeTech`
- **Decision issue:** [#6](https://github.com/aXeTech-NL/Trax-OS/issues/6)
- **Related capabilities:** All public contracts and domain modules

## Context

Canonical prose uses British English (`traveller`), while technical examples predominantly use `traveler`, including `traveler_id`, `traveler_profiles` and `journeys_and_travelers`. Leaving this implicit would create incompatible schemas, generated clients and package names.

## Decision

Use British English in authoritative prose and English user-facing copy. Use American English in stable machine contracts.

- prose and English UI: `traveller`, `travellers`, `travelling`;
- code, package/module names, permission keys, API paths and fields, events, database identifiers and other wire contracts: `traveler`, `travelers`, `traveler_id`;
- localised visible copy is independent of machine identifiers;
- do not expose both spellings as aliases in one public contract;
- generated clients preserve canonical wire names unchanged.

The canonical terms and examples are maintained in the [architecture glossary](../GLOSSARY.md).

## Alternatives rejected

### British English everywhere

This would provide one spelling but would change the dominant technical vocabulary and increase contract churn.

### Unspecified layer-by-layer spelling

This would allow generators, routes, packages and schemas to drift and would make compatibility failures likely.

## Compatibility and migration impact

No current migration, generated API or implemented runtime contract contains a traveller/traveler domain identifier, so acceptance is documentation-only and non-breaking today. Future machine contracts must use `traveler`; introducing `traveller` as a compatibility alias is prohibited. Changing the machine spelling after a public contract or migration ships requires an explicitly versioned breaking change and replacement ADR.

## Validation evidence

- Owner approval and review scope: [issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6).
- Normative vocabulary and an illustrative contract shape: [architecture glossary](../GLOSSARY.md).
- Automated decision metadata, link, vocabulary and fixture validation: [`scripts/architecture-decisions.mjs`](../../../scripts/architecture-decisions.mjs), run by `npm run architecture:check` and `make check`.
- Pull-request review and required CI provide the final manual and automated evidence before issue closure.

## Consequences

Contributors must distinguish visible language from stable identifiers. Search and review may show both spellings intentionally; conformance checks target machine-identifier patterns rather than British prose.

## Revisit trigger

Revisit only before a first public contract/migration is released, or through an explicitly versioned breaking change afterward.
