# Architecture decision log

Accepted architecture decisions in this directory are normative for Trax OS implementation and review. Canonical architecture documents link to a decision instead of defining a competing rule.

A decision may be marked **Accepted** only when it names a decision owner and approver, records compatibility and migration impact, and links its review and validation evidence. Replacing an accepted decision requires a new reviewed ADR; accepted records are not silently rewritten to change their outcome.

Maurice (`@Maurice-aXeTech`) is the sole human product, architecture and security approver during the current v0.x foundation phase, as recorded in [`CODEOWNERS`](../../../.github/CODEOWNERS). Independent implementation and security review remains required at the later gates named by each ADR.

| ID | Decision | Status | Owner | Approver | Evidence |
|---|---|---|---|---|---|
| [ADR-004](ADR-004-CANONICAL-TERMINOLOGY.md) | Canonical prose and machine terminology | Accepted | `@Maurice-aXeTech` | `@Maurice-aXeTech` | [Issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6), [glossary](../GLOSSARY.md), [`architecture:check`](../../../scripts/architecture-decisions.mjs) |
| [ADR-005](ADR-005-MEMBERSHIP-AND-PARTICIPATION.md) | Journey access membership versus travel participation | Accepted | `@Maurice-aXeTech` | `@Maurice-aXeTech` | [Issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6), [shared policy cases](fixtures/adr-016-policy-cases.json), [`architecture:check`](../../../scripts/architecture-decisions.mjs) |
| [ADR-016](ADR-016-ACCESS-POLICY-ALGEBRA.md) | Access, audience and resource-grant algebra | Accepted | `@Maurice-aXeTech` | `@Maurice-aXeTech` | [Issue #6](https://github.com/aXeTech-NL/Trax-OS/issues/6), [shared policy cases](fixtures/adr-016-policy-cases.json), [`architecture:check`](../../../scripts/architecture-decisions.mjs) |

The fixture checker is a design-conformance oracle, not the runtime policy engine. Issues that implement application policy, PostgreSQL RLS, sync, search, Atlas, MCP, notifications or export must prove their adapters against the same cases and add implementation-specific negative tests.
