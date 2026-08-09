# Contributing to Trax OS

Thank you for considering a contribution to Trax OS.

## Licence of contributions

Every intentionally submitted contribution is provided under the Apache License 2.0, without additional terms or conditions.

By submitting a contribution, you confirm that:

- you have the right to submit it;
- it does not knowingly infringe third-party rights;
- any required employer or client permission has been obtained;
- third-party code and assets are clearly identified and licence-compatible;
- you understand that Apache-2.0 permits commercial use, modification, redistribution and inclusion in proprietary products.

Trax OS uses an inbound-equals-outbound contribution model. No Contributor Licence Agreement is required, and contributors are not asked to grant aXeTech separate rights to relicense their work under proprietary terms.

## Local foundation workflow

Use Node.js 22/npm 10, Python 3.12 and uv 0.12. The checked-in npm and uv lockfiles are authoritative.

```bash
make bootstrap       # npm ci, then uv sync --locked
make generate        # update canonical generated contracts
make db-up            # start the PostgreSQL/PostGIS development service
make db-migrate       # apply explicit Alembic migrations
make db-check         # detect migration/metadata drift
make threat-model-check # validate security-design traceability
make check            # contract, security, format, lint, type and test gates
make test             # focused test suites only
make dev              # install dependencies, then start API :18000 and web :5173
make compose-config   # validate the development/evaluation stack
make compose-up       # build, migrate and boot database, API and built web app
make compose-smoke    # run the synthetic same-origin acceptance smoke
make compose-down     # stop containers without deleting PostgreSQL data
```

Run `make generate` after changing a public FastAPI response. Generated files in `packages/api-contract/generated/` are reviewed and committed; `make check` fails when they drift. Both `make dev` and `npm run dev` perform the locked bootstrap before startup. Do not commit `.env`, dependency directories, caches, builds or database data.

`make` selects `.env` when present and otherwise uses `.env.example`; override `COMPOSE_ENV_FILE` explicitly when needed. The Compose workflow is loopback-only Phase 1 evaluation, not production hosting. Read [`docs/development/COMPOSE_EVALUATION.md`](docs/development/COMPOSE_EVALUATION.md) before running the guarded, destructive `CONFIRM_COMPOSE_CLEAN=1 make compose-clean` target.

npm workspaces and Pydantic/OpenAPI-first generation are provisional v0.1 choices, exposed behind root commands where practical. Changing either contract authority or workspace strategy requires explicit architecture review.

## Contribution workflow

1. Open or locate an issue for material changes.
2. Fork the repository and create a focused branch.
3. Add tests and documentation where appropriate.
4. Run formatting, linting, type checks and tests locally.
5. Submit a pull request with a clear explanation of the change.
6. Respond to review comments.

## Pi issue worktrees

Trusted project sessions discover [`.pi/prompts/gh-issue.md`](.pi/prompts/gh-issue.md) as `/gh-issue`. Restart Pi after first pulling the template, then run for example:

```text
/gh-issue #18
```

The prompt reads the complete issue and dependencies, creates an isolated sibling worktree/branch from current `origin/main`, implements and validates one vertical slice, pushes only that issue branch and opens a PR linked with `Closes #18`. It never merges automatically. Use one Pi session per issue/worktree and select only parallel-safe issues from the pinned [master backlog #68](https://github.com/aXeTech-NL/Trax-OS/issues/68).

## Branch names

Examples:

```text
feature/offline-document-bundles
fix/journey-leg-ordering
docs/self-hosting-setup
```

## Commit messages

Use concise, descriptive commits. Conventional Commits are recommended:

```text
feat(sync): add resumable document uploads
fix(api): prevent duplicate journey members
docs(self-hosting): explain S3-compatible storage
```

## Pull-request expectations

A pull request should:

- solve one coherent problem;
- explain user-visible effects;
- include migrations for schema changes;
- preserve backward compatibility or document breaking changes;
- include tests for critical behaviour;
- avoid unrelated formatting changes;
- disclose generated or AI-assisted code where this materially affects review or provenance.

## Architecture requirements

Changes must preserve the shared application core described in [`docs/architecture/AGENTIC_CORE.md`](docs/architecture/AGENTIC_CORE.md):

- every meaningful state mutation enters through a versioned command handler;
- REST, MCP, Atlas, workers and offline sync remain adapters and do not duplicate business rules or write directly to persistence;
- query handlers are read-only;
- command handlers cover actor identity, authorisation, validation, domain rules, optimistic concurrency, transactions, change-set auditing and reversibility;
- high-risk or irreversible actions use preview and explicit approval;
- retries and offline synchronisation are idempotent by `command_id`;
- sensitive device-only document content and decryption keys are never persisted centrally;
- Personal and Agency workspaces reuse the same core and remain tenant-isolated;
- role definitions use stable permission keys and scoped assignments;
- custom roles cannot override non-configurable security invariants or delegate unavailable permissions;
- Atlas model providers use the public provider contract and never create alternative command or context permissions;
- BYO credentials use the `CredentialStore` boundary and custom endpoints are treated as SSRF-sensitive egress;
- V1 web research writes bounded cited candidates only; source verification and user adoption are separate controlled steps;
- web content is untrusted and cannot alter MCP scope, policy or command authority;
- travel-party and traveller-private filtering occurs server-side in queries, sync, search and model context;
- public command, API, MCP, sync and capability contracts remain backward compatible or are explicitly versioned.

Pull requests that change a domain boundary, trust boundary, public contract, persistence model or reversibility policy must update the affected canonical architecture documents and explain the rationale and compatibility impact in the pull request.

## Threat-model review

The authored Phase 0 register in [`docs/security/phase-0-threat-model.json`](docs/security/phase-0-threat-model.json) must remain aligned with trust-boundary changes. Run `make threat-model-check` for normal structural and evidence-status validation.

`npm run security:closure` is a separate human gate. Closure requires review of a fixed commit by a non-author, current CODEOWNER routing, explicit residual-risk acceptance authority and a completed review record. A CODEOWNER entry alone is not risk acceptance, a tracking issue is not passed evidence, and an author must never self-mark the manual review passed.

## Security issues

Do not report vulnerabilities in a public issue. Follow `SECURITY.md`.

## Code of conduct

Contributors must communicate professionally and focus reviews on the technical work.
