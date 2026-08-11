# ADR-017 — Versioned same-origin runtime API client

- **Status:** Accepted
- **Date:** 2026-08-11
- **Decision owner/approver:** repository CODEOWNER (`@Maurice-aXeTech`)
- **Traceability:** [GitHub issue #15](https://github.com/aXeTech-NL/Trax-OS/issues/15), [ADR-002](ADR-002-CONTRACT-AUTHORITY.md)

## Context

Static TypeScript projections do not validate untrusted HTTP data, and `/api/v1/version` cannot serve as a version-independent bootstrap forever. The official web adapters also duplicated transport, error and CSRF handling. Trax OS needs explicit supported API/command ranges without creating a second HTTP contract authority or implying native/offline support.

## Decision

1. `GET /api/contract` is the small public, version-independent bootstrap contract. The existing `/api/v1/version` remains available and application SemVer remains informational.
2. API and command support use positive inclusive integer ranges with `current`, `minimum_supported` and `maximum_supported`. Negotiation selects the highest overlap. Initial API and `journey.update` support is exactly `1..1`; widening or dropping support requires separate review and migration impact.
3. `@trax-os/api-client` is scoped to the official same-origin browser web client. It does not define native, cross-origin, offline or local authority.
4. Pydantic/FastAPI remains the only editable public HTTP authority. Repository-owned generation projects operation metadata, types and runtime schemas from canonical OpenAPI and server discovery output. Generation fails on unsupported constructs, runs twice and drift-checks committed output.
5. Maintained transport treats network data as `unknown`, validates requests and declared success/error responses, fixes `credentials` to `same-origin`, and adds CSRF only to OpenAPI-marked mutations. Unknown request fields fail; unknown response fields are tolerated so ADR-002's additive response policy remains usable.
6. Client negotiation is fail-fast compatibility UX, not authorization or a security boundary. Server CSRF, authorization, validation, command-version resolution and error envelopes remain authoritative.

## Compatibility and migration impact

The bootstrap endpoint and discovery schemas are additive. `/api/v1/version` and existing operation IDs remain unchanged. The web dependency graph becomes `apps/web → packages/api-client → packages/api-contract`; all web HTTP adapters share one client instance, while feature repository ports and wire-to-domain mappings remain client-owned. Journey update now uses the canonical `journey.update@1` route; other legacy mutations are unchanged. There is no database or deployment migration.

## Evidence and limits

`contract:check` proves deterministic generated output and the encoded fail-closed schema subset. Trusted-base compatibility also blocks advertised API/command range contraction, command removal and canonical command-marker drift. Client tests cover range negotiation, retry-safe canonical command IDs, malformed metadata, transport/security defaults, request/response/error validation and additive response fields. Boundary fixtures enforce package activation, exact inventory and dependency direction. These checks do not prove Pydantic cross-field equivalence, browser production support, native credentials, offline authority or future-version compatibility.
