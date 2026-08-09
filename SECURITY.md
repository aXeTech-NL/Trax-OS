# Security Policy

## Supported versions

Security updates are provided for versions identified as supported in the official release documentation.

## Reporting a vulnerability

Do not create a public GitHub issue for a suspected vulnerability.

Report vulnerabilities to:

[`support@axetech.nl`](mailto:support@axetech.nl)

Include where possible:

- affected version or commit;
- affected component;
- reproduction steps;
- proof of concept;
- expected impact;
- suggested remediation;
- whether the issue is already public.

## Sensitive information

Do not include:

- production credentials;
- personal customer data;
- access tokens;
- private keys;
- unrelated confidential information.

## Public security design

The [Phase 0 Threat Model](docs/security/PHASE_0_THREAT_MODEL.md) documents public architecture-level trust boundaries, controls, verification gates and residual-risk review. Keep exploit details and unresolved vulnerabilities out of that public model and follow the confidential reporting process above.

## Architecture-sensitive security areas

Reports are especially welcome for issues involving:

- command authorisation, scope enforcement or actor impersonation;
- command replay, idempotency or optimistic-concurrency bypasses;
- audit-log or change-set integrity;
- OAuth Authorization Code with PKCE, redirect URI validation and token rotation;
- MCP tool/resource scope isolation;
- offline sync conflicts or cross-workspace data exposure;
- privilege escalation through custom roles, assignments or delegation;
- agency-staff access to a traveller's Personal workspace;
- cross-party leakage—including transitive leakage through a traveller with multiple memberships—through queries, search, Atlas, MCP, notifications or offline caches;
- stale access after role, party or journey membership revocation;
- entitlement or capability checks being mistaken for authorisation;
- custom-domain or white-label configuration crossing workspace boundaries;
- BYO model-provider API key disclosure or cross-workspace secret access;
- custom model-endpoint or submitted-source SSRF, DNS rebinding, redirect or metadata-service access;
- indirect prompt injection causing MCP scope escalation or candidate-review bypass;
- fabricated citations or unverified safety/health/entry data becoming trusted state;
- Atlas context leakage across providers or silent paid-provider fallback;
- device identity, key wrapping and secure transfer;
- server access to device-only document plaintext or decryption keys;
- central-file size/MIME/malware verification or quarantine bypass;
- Row-Level Security policy gaps for workspace/party data;
- prompts, document content or health data entering telemetry;
- browser caching or retention of memory-only document sessions.

Device-only documents must remain end-to-end encrypted. Do not attach real identity, medical or travel documents to a vulnerability report; use synthetic test data.

## Disclosure

The maintainers aim to coordinate remediation and disclosure responsibly. Do not publicly disclose an unresolved vulnerability before a reasonable remediation period has passed, unless required by law or necessary to prevent immediate harm.

## Scope

The public security policy applies to the open-source Trax OS repository and official builds. Trax Cloud may have a separate operational incident and disclosure policy.
