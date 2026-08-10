# Architecture documentation

Trax OS is an agentic, offline-first travel operating system with a shared command and change core.

## Canonical architecture

- [Architecture decision log](decisions/README.md) — accepted decisions, named owners/approvers and linked conformance evidence.
- [Canonical architecture glossary](GLOSSARY.md) — authoritative prose and machine-contract vocabulary.
- [Agentic Core Architecture](AGENTIC_CORE.md) — system boundaries, commands and queries, MCP, risk policy, audit and undo, offline sync, device-only documents, persistence and repository split.
- [Agency, Group Travel and Access Model](AGENCY_ACCESS_MODEL.md) — Personal and Agency workspace modes, configurable roles and permissions, journey leadership, travel-party privacy and delegated access.
- [Atlas Model Provider Architecture](ATLAS_PROVIDER_MODEL.md) — local, bring-your-own OpenAI-compatible and managed-credit provider modes, credential handling and egress security.
- [V1 Agent-assisted Web Research](AGENT_RESEARCH_V1.md) — browsing-capable agent research, MCP candidate submission, source verification and deferred commercial APIs.
- [Implementation Architecture](IMPLEMENTATION_ARCHITECTURE.md) — modular monolith, React/FastAPI boundaries, PowerSync integration, Unit of Work, contracts, routing, migrations and fitness checks.
- [Module and Package Boundaries](MODULE_AND_PACKAGE_BOUNDARIES.md) — machine-enforced active roots, current TypeScript/Python import DAGs and explicitly inactive target paths.
- [ADR-002: HTTP contract authority](decisions/ADR-002-CONTRACT-AUTHORITY.md) — Pydantic/FastAPI authored authority, generated OpenAPI/TypeScript ownership and compatibility policy.
- [Target Domain Model](DOMAIN_MODEL.md) — consolidated ownership, journey, planning, operations, document, provider, change and sync model.
- [Retention and Deletion](RETENTION_AND_DELETION.md) — V1 retention, cancellation/export and purge defaults.
- [Provider and Source Registry](../integrations/SOURCE_REGISTRY.md) — controlled V1 provider and authoritative-domain baseline.

The cross-cutting [Phase 0 Threat Model](../security/PHASE_0_THREAT_MODEL.md) traces these canonical boundaries to threats, controls, owners, verification and residual risks. It is a security companion, not an alternative source of product or architecture authority.

## Authority and language

Repository documentation is English-first. The English documents in this directory are authoritative for implementation and review.

If implementation and documentation diverge, bring the implementation back into compliance or update the affected canonical documents through a reviewed pull request before changing behaviour.

## Required invariants

- `Journey` is the canonical product, API and persistence term across all contracts.
- Adapters never write directly to persistence.
- UI, sync, Atlas, MCP and workers reuse the same command handlers.
- Queries do not mutate domain state.
- Every meaningful mutation creates an auditable change set.
- Risk, approval and reversibility are application policies.
- Offline retries are idempotent and conflict-aware.
- Sensitive document plaintext and decryption keys remain on trusted devices.
- Personal and Agency modes share one public application core.
- Roles are permission collections assigned at an explicit scope.
- Journey access membership and travel participation are separate relationships.
- Resources use exactly four default audiences; bounded resource grants are a separate authorisation mechanism.
- Travel parties are server-enforced, non-transitive privacy boundaries; a traveller may belong to multiple parties.
- Self-hosters can enable all public Personal and Agency capabilities.
- Managed entitlements and Atlas credits never replace authorisation or gate data access.
- BYO model usage consumes no Trax credits and never broadens Atlas permissions.
- V1 web research creates cited review candidates; it never writes trusted or booked state directly.
- Trax Cloud consumes versioned public artefacts and does not fork the core.
