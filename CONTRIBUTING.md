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

## Contribution workflow

1. Open or locate an issue for material changes.
2. Fork the repository and create a focused branch.
3. Add tests and documentation where appropriate.
4. Run formatting, linting, type checks and tests locally.
5. Submit a pull request with a clear explanation of the change.
6. Respond to review comments.

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

## Security issues

Do not report vulnerabilities in a public issue. Follow `SECURITY.md`.

## Code of conduct

Contributors must communicate professionally and focus reviews on the technical work.
