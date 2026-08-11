# ADR-002 — HTTP contract authority and generated package ownership

- **Status:** Accepted, effective when this change is merged
- **Date:** 2026-08-02
- **Decision owner/approver:** repository CODEOWNER (`@Maurice-aXeTech`)
- **Traceability:** [GitHub issue #7](https://github.com/aXeTech-NL/Trax-OS/issues/7), P0-07, G0-CONTRACT

## Context

Trax OS needs one editable authority for public HTTP payloads and operations while Python enforces the server runtime and TypeScript clients consume the same wire contract. The v0.1 foundation already uses Pydantic models and FastAPI route declarations to emit OpenAPI 3.1, then generates TypeScript declarations with `openapi-typescript`.

The Phase 0 decision compared that path with two language-neutral authored alternatives:

1. raw JSON Schema as payload authority; and
2. TypeSpec as an API-first authority that emits OpenAPI.

A checked-in neutral artifact is useful, but a separately authored neutral source would also need to generate or be mapped into Pydantic runtime models and FastAPI operation metadata. Raw JSON Schema does not describe HTTP paths, methods, responses, security or media types. TypeSpec does, but would add another model language and a Python implementation-mapping step before Trax OS has a second server implementation language.

Generation drift is not compatibility detection. Updating both generated files could previously make a breaking API change pass CI. Generated TypeScript declarations also disappear at runtime and therefore cannot validate untrusted JSON by themselves.

## Decision drivers

- one editable source rather than synchronized Python and neutral definitions;
- Python runtime validation and response filtering must match the authored source;
- a language-neutral, reviewable OpenAPI publication artifact;
- deterministic output under locked Python and Node toolchains;
- explicit compatibility detection for official clients;
- no new schema language without demonstrated multi-language server value;
- generated TypeScript must not become a second domain or wire authority.

## Options considered

| Concern                                | Pydantic/FastAPI → OpenAPI 3.1                   | Raw JSON Schema authority             | TypeSpec authority                       |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------- | ---------------------------------------- |
| Python runtime validation              | Native; the authored models execute              | Generated or mapped Pydantic required | Generated or mapped Pydantic required    |
| HTTP operation metadata                | Native FastAPI declarations                      | Requires another authority            | First-class HTTP model                   |
| TypeScript projection                  | Existing pinned generator                        | Payload types only                    | Emitted OpenAPI or another emitter       |
| Determinism                            | Existing locked pipeline; strengthen to two runs | Still requires locked generators      | Still requires locked compiler/emitters  |
| Compatibility                          | Compare emitted OpenAPI                          | Needs operation-level contract first  | Compare emitted OpenAPI                  |
| Current repository cost                | Lowest                                           | High and incomplete for an HTTP API   | Additional language and mapping boundary |
| Neutrality for future server languages | Lower                                            | High for payloads                     | High for the whole API                   |

## Decision

### Authored authority

For the V1 HTTP API, the canonical authored contract is the combination of:

- public Pydantic wire models under `apps/api/src/trax_api`; and
- FastAPI path-operation declarations that own methods, paths, status codes, headers, media types and model binding.

Pydantic-only validators may enforce semantic or cross-field policy that is not expressible in generated TypeScript. Such behavior must return stable documented errors and have runtime tests; generated types must not be described as equivalent client-side validation.

### Published and generated artifacts

`packages/api-contract` owns projections, not editable truth:

- `generated/openapi.json` is the deterministic, language-neutral publication and review artifact;
- `generated/schema.ts` is a generated static TypeScript projection;
- `generated/runtime-fixtures.json` is a privacy-neutral fixture generated from real FastAPI instance-discovery responses for Python/HTTP/TypeScript conformance tests.

All three files are generator-owned and committed. They are never hand-edited. A public contract change starts in the Python models or FastAPI declarations and then runs `make generate`.

### Python and TypeScript ownership

- Python API modules own wire validation, serialization and HTTP operation declarations.
- The contract package generator owns OpenAPI, TypeScript declarations and runtime fixtures.
- TypeScript adapters own runtime treatment of untrusted JSON and explicit wire-to-client-domain mapping. TypeScript feature/domain models remain client-owned and do not redefine the wire contract.
- `packages/api-client` owns the generated/maintained same-origin browser transport selected by [ADR-017](ADR-017-VERSIONED-RUNTIME-CLIENT.md). It remains a projection/consumer of this authored authority rather than a second HTTP contract source.
- Human review remains the repository-wide v0.x CODEOWNER rule. This ADR does not invent unavailable owner teams or freeze the broader package map from issue #12.

### Determinism and drift

`npm run contract:check` generates every artifact twice in independent temporary directories, compares the two runs byte-for-byte, and then compares one run with the committed artifacts. Locked dependencies and fixed JSON formatting are necessary inputs. Same-host equality is direct deterministic-generation evidence, not a claim of untested cross-platform byte identity.

### Compatibility policy

The compatibility check remains authoritative for source changes even after the exact initial `1..1` client ranges selected by ADR-017:

- every pull request is compared with the base branch's committed OpenAPI document;
- pushes to `main` are compared with the event's prior revision, and manual runs require an explicit trusted commit SHA;
- removed operations/responses/response fields, removed optional request fields, newly required request fields or operation parameters, request-constraint narrowing, operation-ID changes, response-enum widening for exhaustive generated clients, security/server-boundary changes, and unclassified changes fail;
- compatible additive changes may pass but still receive human review;
- external or dangling local `$ref` values fail closed and are never fetched by the compatibility check;
- intentional breaking V1 changes require a separately approved versioning/migration decision. There is no silent waiver or same-branch baseline update.

This decision also corrects the legacy generated document to describe the session cookie, required double-submit CSRF header, dependency-unavailable readiness response and success request-ID headers that the runtime already enforced or emitted. The checker admits that security metadata correction only when the old contract has none and the candidate exactly covers every enumerated authenticated/mutating operation; partial or later security-boundary changes still fail. This is an additive documentation correction with no runtime authentication or CSRF-policy change.

The pinned checker is qualified by repository fixtures using the actual FastAPI OpenAPI 3.1 shape. Its passing result proves only the encoded compatibility policy. It does not prove business behavior, authorization, persistence, migration safety or complete support for every future OpenAPI/JSON Schema keyword.

### Runtime evidence

The Python suite validates representative routed request/response models, serializes them to JSON, restores them through Pydantic and checks semantic equality. Real FastAPI instance-discovery responses generate the shared runtime fixture; both Python HTTP tests and the TypeScript adapter test consume that fixture. This is shared-fixture runtime conformance, not a claim that TypeScript declarations perform runtime validation or that every TypeScript adapter is already a generated client.

## Consequences

### Positive

- Server runtime and authored payload constraints remain co-located.
- OpenAPI stays language-neutral and reviewable without becoming a second editable source.
- Contract generation has direct two-run evidence and distinct drift diagnostics.
- CI rejects fixture-proven incompatible changes against a trusted Git revision.
- Package and mapping ownership is explicit without pre-implementing issues #12 or #15.

### Trade-offs and residual risks

- Python remains the authoring language for HTTP wire contracts.
- Some cross-field Pydantic behavior cannot be represented fully by generated static types; adapters must handle stable server validation errors.
- The current TypeScript package is static-only and most handwritten adapters still need explicit runtime parsing and conformance as their slices evolve.
- Compatibility classification can be conservative or incomplete for future OpenAPI keywords. New schema constructs require new fixtures before reliance.
- ADR-017 implements exact initial range negotiation and a generated/maintained runtime client; future range widening, support removal and any deprecation window remain separately reviewed lifecycle decisions.

## Reconsideration triggers

Reconsider a neutral authored authority through a new ADR when at least one is true:

- independently implemented server runtimes must share the same contract;
- several SDK languages require API-first lifecycle ownership;
- generated Pydantic/FastAPI mappings prove reliable enough to avoid dual authority;
- the selected OpenAPI projection cannot faithfully represent required cross-runtime contracts; or
- organization-scale version projections justify TypeSpec's additional compiler and mapping boundary.

## Non-goals

- freezing the complete modular-monolith/package map (issue #12);
- widening/removing supported client ranges or adding native/cross-origin/offline client authority beyond ADR-017;
- making browser web local-authoritative;
- changing persistence, RLS, CSRF, audit/change or lifecycle policy;
- claiming OpenAPI schema conformance proves domain or security behavior.

## Primary references

- [OpenAPI 3.1.1 Schema Object and dialect](https://spec.openapis.org/oas/v3.1.1.html#schema-object)
- [JSON Schema Draft 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core.html)
- [FastAPI response models](https://fastapi.tiangolo.com/tutorial/response-model/)
- [Pydantic JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/)
- [Pydantic serialization](https://docs.pydantic.dev/latest/concepts/serialization/)
- [TypeSpec HTTP library](https://typespec.io/docs/libraries/http/)
- [TypeSpec OpenAPI emitter](https://typespec.io/docs/emitters/openapi3/reference/)
- [openapi-typescript](https://openapi-ts.dev/introduction)
