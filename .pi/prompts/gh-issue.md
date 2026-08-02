---
description: Implement one Trax OS GitHub issue in an isolated worktree and open a validated PR
argument-hint: "<#number>"
---
Implement Trax OS GitHub issue `$1` end-to-end.

## Issue discovery

1. Accept `$1` as `#123` or `123`; reject missing/non-numeric input before changing files.
2. Confirm the repository is `aXeTech-NL/Trax-OS` and GitHub CLI authentication works.
3. Read the complete issue, labels, milestone and comments with `gh issue view`.
4. Read linked/dependent issues and the relevant canonical repository documentation. Treat issue #68 as the navigation index, not as implementation scope.
5. Inspect current branches/worktrees and check whether another worktree/PR already owns this issue. Never duplicate active work.

## Isolation and branch rules

- Never implement directly on `main`.
- Fetch `origin` and base new work on the latest `origin/main`.
- Require the main worktree to be clean; do not discard another session's changes.
- Create or reuse one dedicated sibling worktree under `../trax-os-worktrees/issue-<number>-<slug>`.
- Use branch `issue/<number>-<slug>`.
- Keep progress/evidence files outside repositories unless the issue explicitly requires versioned product documentation.
- Never expose credentials, tokens, participant data or real travel/identity documents.

## Implementation

- Restate the issue outcome, dependencies, acceptance criteria and non-goals before coding.
- Follow canonical architecture, product scope, design system and security boundaries.
- Implement the smallest complete vertical slice that satisfies the issue: contracts, migration/policy, service/repository, API/client, error states, accessibility, English/Dutch copy, tests and docs where applicable.
- Do not add placeholders or claim unavailable capabilities.
- Web remains authenticated and server-backed. Authoritative standalone local-only behavior belongs only to the dedicated Android/macOS clients.
- Reuse generated contracts; never hand-edit generated files.
- Keep all mutations scoped, versioned and privacy-neutral. Do not weaken RLS, CSRF, audit/change or lifecycle requirements to make tests pass.
- If a required product/security decision is genuinely absent, stop before speculative implementation, document the exact blocker on the issue and ask one concise question.

## Validation

Run the issue-specific tests plus the complete repository gate before handoff:

```bash
make bootstrap
make db-up
make db-migrate
make generate
make check
npm run test:pwa --workspace @trax-os/web
make compose-config
npm audit --audit-level=high
git diff --check
git status --short
```

Add stronger migration, browser, native, security or integration acceptance when the issue requires it. Fix failures rather than bypassing checks. Confirm generated output is deterministic and no unintended files/secrets are present.

## Review and PR

1. Perform a strict self-review for correctness, data loss, privacy leakage, accessibility, compatibility and unsupported claims.
2. Commit with a conventional message referencing the issue.
3. Push only the issue branch, never `main`.
4. Open a PR to `main` containing `Closes #<number>`, outcome, implementation summary, validation evidence, migration/security impact, screenshots when UI changed, residual risks and rollback notes.
5. Monitor required GitHub Actions. Fix failures on the same branch and update the PR.
6. Do not merge the PR automatically. Leave it ready for Maurice's review/admin merge.
7. Comment on the issue with the PR link or, when blocked, the exact missing decision/evidence.

At the end, report the worktree path, branch, commit, PR URL, checks run and remaining risks.
