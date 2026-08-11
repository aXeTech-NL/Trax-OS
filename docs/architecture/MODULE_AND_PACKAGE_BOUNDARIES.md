# Module and package boundaries

**Status:** Implemented Phase 1 boundary foundation with active validated API client

**Authority:** [`module-boundaries.json`](module-boundaries.json) is the machine-enforced active-root and import-policy registry. [`ADR-002`](decisions/ADR-002-CONTRACT-AUTHORITY.md) remains the HTTP contract-authority decision.

**Owner:** repository CODEOWNER `@Maurice-aXeTech`

## 1. Purpose and evidence semantics

The repository has a small executable foundation and a much larger target map. This document separates them so a future path in the implementation architecture cannot be mistaken for an existing package or capability.

`npm run boundaries:check` validates the registry schema, real repository roots/manifests/exports, TypeScript and JavaScript imports through the TypeScript compiler AST, and Python imports through the standard-library AST helper. Passing proves only the encoded structural rules. It does not validate domain behavior, HTTP compatibility, database migrations, production policy, native runtimes or a future package activation.

## 2. Active roots

Only these modular-monolith product roots are active:

| Root                    | Ecosystem/name                        | Current responsibility                                                                        | Public exports                                   |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/api`              | Python project `trax-os-api`          | FastAPI/Pydantic application, current server-backed application/persistence modules and tests | No npm exports                                   |
| `apps/web`              | npm workspace `@trax-os/web`          | URL-routed React application, repository ports and concrete web adapters                      | Private application; no package exports          |
| `packages/api-contract` | npm workspace `@trax-os/api-contract` | Generator-owned OpenAPI, TypeScript declaration and runtime-fixture projections               | `.`, `./openapi.json`, `./runtime-fixtures.json` |
| `packages/api-client`   | npm workspace `@trax-os/api-client`   | Maintained same-origin transport/negotiation over generated operation and validator metadata  | `.`                                              |

The active cross-root dependency graph is:

```text
apps/web → packages/api-client → packages/api-contract
```

Cross-root relative imports are forbidden. Consumers must use the declared package name and an exported subpath, and the dependency must exist in the consuming manifest. The contract package has no reverse edge, and web no longer bypasses the runtime client to consume static projections directly.

The semantic owner is read from the repository-wide default in `.github/CODEOWNERS`. During the current single-owner v0 phase, enforcement requires exactly one non-comment rule, `* @Maurice-aXeTech`; an additional wildcard owner or path override fails. Supporting later multi-owner/path-specific semantics requires a reviewed registry-schema/checker extension rather than silently weakening this deterministic policy.

Manifest inventory deliberately governs only direct `apps/*` and `packages/*` product roots. Separately scoped experimental or tooling packages elsewhere in the repository, such as `spikes/powersync`, are not active modular-monolith roots and retain their own harness/provenance checks. Issue #12 neither imports those packages into this graph nor claims to inventory every nested `package.json` or `pyproject.toml` in the repository.

## 3. Reserved target roots are not packages

The following canonical target paths are reservations only:

```text
apps/mobile            apps/desktop         apps/worker
apps/mcp-server        apps/atlas
packages/domain        packages/commands
packages/queries       packages/access-control
packages/change-engine packages/sync-engine packages/sync-powersync
packages/credential-store packages/offline-store packages/ui
```

They are `inactive`, `required: false`, absent from npm workspaces and excluded from current capability claims. A missing reserved directory is valid. Adding a package manifest under one is not valid activation. These are the concrete reserved roots. `packages/model-provider-*` in the target map is an unallocated naming family, not a literal or wildcard filesystem reservation; every concrete provider package must first receive its own reviewed registry entry before its directory or manifest is created.

Activation requires, in the same reviewed change:

1. the owning issue or architecture decision named by the registry gate;
2. an actual package/project manifest and exact CODEOWNER;
3. reviewed public exports and allowed root dependency edges;
4. source classification and allowed/forbidden import fixtures;
5. migration and compatibility impact;
6. runtime/security evidence required by that package's product boundary.

Issue #15 activates only the browser runtime client. Issue #12 still does not create mobile, desktop, worker, MCP, Atlas, command, query, sync, offline, credential or UI implementations.

## 4. TypeScript and JavaScript boundaries

The checker parses static imports, re-exports and literal `import()` expressions with the TypeScript compiler. It resolves configured `tsconfig` paths through TypeScript module resolution before applying root/layer rules. An internal `@trax-os/*` name is resolved before lexical package checks and must land on an exact declared export target; a same-root adapter or inactive-source alias cannot shadow the trusted package name. An unresolved configured alias or alias resolving outside the source's active root fails. A non-literal dynamic import is rejected because it could evade package and layer classification.

Active application sources are ESM-only for this policy. TypeScript `import = require(...)`, direct or aliased `require`, `module.require`, imported/aliased `createRequire`, dynamic `node:module` loading and any syntactic use/extraction of Node 22 `process.getBuiltinModule` are rejected outright. This is a bounded static policy: it does not claim to interpret arbitrary runtime-computed strings or general metaprogramming, so additions to the accepted loader syntax require reviewed checker fixtures rather than implicit allowance.

Within `apps/web`, the current layers are:

```text
application/composition
├── features
├── repository interfaces
└── adapters

adapter → repository interface / feature domain mapping       allowed
feature → repository interface                               allowed
feature or repository interface → concrete adapter           forbidden
```

The current web structure is intentionally modest; this is not a claim that all target feature packages exist. Tooling sources (`vite.config.ts`, `eslint.config.js`, and `apps/web/scripts`) are classified separately from application source.

Within `packages/api-contract`, generated sources are the `generated` layer. Within `packages/api-client`, generated metadata cannot import maintained client runtime, while maintained runtime may consume the generated projection and public contract types. Neither package may import application, feature, repository or adapter code. The checker verifies both exact package inventories and public exports; `contract:check` remains responsible for two-run deterministic generated content and byte drift.

The checker also rejects:

- unregistered `package.json` or `pyproject.toml` project manifests and silently activated reserved roots;
- every undeclared, unknown or disallowed `@trax-os/*` manifest dependency (including unused dependency/dev/peer/optional edges);
- unknown internal package names and unexported deep imports;
- root dependency cycles;
- any relative/alias source import outside its own active root, including inactive/reserved source;
- unclassified source, path traversal and source/package symlinks.

## 5. Current Python module layers

The current `trax_api` files are classified individually; adding or removing a module requires an explicit registry update. This is an honest description of the existing server-backed slice, not the final domain-module map.

```text
composition
  → transport, application, persistence, wire, foundation
transport
  → transport, application, persistence, wire, foundation
application
  → application, persistence, wire, foundation
persistence
  → foundation
wire
  → wire
foundation
  → no internal layer
```

Current classifications:

| Layer         | Modules                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| `composition` | `trax_api.main`                                                                            |
| `transport`   | `request_id`, `routes`, `errors`, `server_errors`, `server_routes`                         |
| `application` | `application_errors`, `auth`, `command_executor`, `command_registry`, `journey_repository` |
| `persistence` | `database`, `schema`                                                                       |
| `wire`        | `models`, `server_models`                                                                  |
| `foundation`  | `trax_api`, `settings`                                                                     |

`journey_repository` still combines application workflow and persistence concerns for legacy mutations. The selected Journey update now exposes the no-commit `apply_journey_update` CAS primitive used through `command_executor`; the Unit of Work owns its commit. This does not claim that unrelated repository mutations have migrated.

Issue #14 moved `ApplicationError` to the transport-neutral application layer. `server_errors` now only maps that application outcome to HTTP. The two temporary application-to-transport exceptions were removed; the machine registry contains no exception for this boundary.

The Python helper uses `tomllib` for exact `[project].name` parsing and `ast` for imports; it does not import or execute application modules. Literal internal calls through `importlib.import_module` or `__import__` are reported as edges even through import aliases and simple assignment aliases, while non-literal targets fail closed. Tuple/list/starred destructuring that carries either loader is conservatively diagnosed instead of attempting to prove every runtime binding shape safe. It also rejects unclassified modules, forbidden reverse edges, relative escape, file/directory symlinks, realpath escape and duplicate module identities such as both `foo.py` and `foo/__init__.py`. Registry schema version 1 intentionally supports exactly one active Python root.

## 6. Contract authority and cross-language sharing

ADR-002 is unchanged:

- public Pydantic models and FastAPI operation declarations are the editable HTTP authority;
- deterministic OpenAPI is the language-neutral publication;
- generated TypeScript and runtime fixtures are projections;
- the API client validates untrusted request/response/error data centrally, while web adapters retain wire-to-domain mapping.

No executable Python domain model is shared with TypeScript. No TypeScript feature model becomes server authority. The generated contract/client projections cannot import application code, and the same-origin client adds no native/offline authority.

## 7. CI and local validation

```bash
npm run boundaries:check
make boundaries-check
make check
```

`boundaries:check` runs 79 allowed/forbidden synthetic fixtures and then checks the real tree, now with four active roots and two directed edges. `make check` includes it once and prints the explicit `Module boundaries are consistent` diagnostic. Foundation CI already executes `make check`, so no duplicate boundary run is added.

The fixture suite covers the valid graph, absent reservations, cross-root relative/deep/undeclared/disallowed imports, trusted-package alias shadowing, TypeScript aliases, rejected CommonJS/`getBuiltinModule` loaders, adapter reversals, static and dynamic evasion, generated reverse imports, manifest-only unknown/reverse/cyclic dependencies, npm/Python manifest inventory, exact TOML project names, classifications, Python dynamic-import aliases/destructuring/reverse imports/collisions, exact/stale/widened exceptions, file/directory symlinks, traversal, exact v0 ownership, registry layer/schema checks and generated/export inventory drift.

## 8. Migration and compatibility impact

- **Database/Alembic:** none.
- **Public HTTP contract:** additive unversioned `/api/contract` discovery plus range schemas and canonical-command operation metadata; existing routes/operation IDs remain.
- **Runtime behavior:** web traffic performs one cached fail-closed negotiation and validated transport; Journey update uses the canonical command route.
- **npm:** `@trax-os/api-client` is activated with already-pinned TypeScript/Vitest/Prettier tooling and no new runtime dependency beyond `@trax-os/api-contract`.
- **Database/deployment:** none.
- **Future packages:** all other reservations remain inactive.

Changing an active root, export, dependency edge, module classification or temporary exception is an architecture change and must update the registry, this document, fixtures and delivery traceability together.
