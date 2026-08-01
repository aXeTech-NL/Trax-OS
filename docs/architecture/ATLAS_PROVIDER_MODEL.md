# Atlas Model Provider Architecture

**Status:** Canonical extension to the Agentic Core Architecture  
**Related:** [Agentic Core Architecture](AGENTIC_CORE.md), [V1 Agent-assisted Web Research](AGENT_RESEARCH_V1.md)

## 1. Purpose

Atlas supports multiple model-provider modes without changing its command, MCP, authorisation or audit behaviour. Users may use no model, a local model, their own OpenAI-compatible provider or a Trax-managed provider.

Model selection changes who processes prompts and who bills model usage. It never changes what Atlas is authorised to read or mutate.

## 2. Provider modes

```text
NONE
└── manual application; Atlas model features disabled

LOCAL
└── compatible model on the user's device or local network

BYO_OPENAI_COMPATIBLE
└── user-provided endpoint, API key and model; provider bills the user directly

MANAGED_CREDITS
└── Trax-managed provider routing; usage consumes Trax Atlas credits
```

All enabled modes use the same Atlas orchestration interfaces and MCP client. A deployment advertises supported modes through capability discovery; authenticated workspace entitlements determine which modes a user may select.

## 3. OpenAI-compatible provider contract

A provider configuration contains non-secret metadata:

```text
id
workspace_id
owner_principal_id
display_name
provider_type = OPENAI_COMPATIBLE
base_url
model
compatibility_profile
credential_reference
status
created_at
updated_at
last_tested_at
```

Optional compatible settings may include:

```text
organization_header
project_header
custom_headers_allowlist
request_timeout
max_output_tokens
supports_streaming
supports_tool_calls
supports_responses_api
supports_web_search
web_search_profile nullable
```

V1 supports explicit versioned profiles for OpenAI-style `/v1/chat/completions` and Responses API requests, including separately declared streaming/tool-call capabilities. A provider can pass one or both profiles; compatibility is tested rather than inferred. Provider adapters normalise streaming, tool-call and error behaviour into the public Atlas model-provider contract.

OpenAI API compatibility does not imply internet access. V1 research is enabled only after a provider advertises and passes a supported web-search capability profile. Providers without it may reason over existing authorised Trax context but cannot claim current web research.

## 4. BYO provider flow

```text
User
  │ configures endpoint, model and API key
  ▼
Provider Configuration API
  ├── validates metadata and endpoint safety
  ├── writes API key to CredentialStore
  └── stores only credential_reference with provider metadata
          │
Atlas request
  ▼
Atlas orchestration
  ├── obtains policy-filtered context
  ├── resolves provider configuration
  ├── asks CredentialStore for runtime credential
  └── sends OpenAI-compatible request through controlled egress
          │
User-selected provider
  ├── processes prompt
  ├── bills user's provider account directly
  └── returns response/tool proposal
          │
Atlas MCP client
  └── applies normal preview, policy, command and audit flow
```

Trax does not deduct credits, add a model surcharge or intermediate model-usage invoice for BYO requests. The external provider may charge the user independently under its own terms.

## 5. Credential storage

API keys are secrets and never belong in command payload logs, PostgreSQL application columns, analytics, error reports, backups or model context.

The public core depends on a `CredentialStore` abstraction. Supported implementations may include:

- platform secure storage for a device-local provider;
- a self-hosted secret manager or encrypted operator-controlled store;
- a managed cloud secret vault with per-workspace isolation.

For managed Trax Cloud BYO mode:

- the configuration database stores only an opaque secret reference;
- the key is encrypted at rest in the managed secret vault;
- only the narrowly scoped BYO model-router workload can retrieve it at runtime;
- support users and agency roles cannot read the secret;
- key values are never returned after creation;
- update replaces the secret rather than exposing the previous value;
- deletion removes both configuration and secret according to a defined lifecycle;
- secret material is excluded from normal database backups.

Trax Cloud necessarily handles the key at runtime when proxying BYO requests. The UI must explain this. A device-local direct mode can avoid cloud custody where the client platform, networking and CORS policy support it.

## 6. Endpoint and egress security

A user-configurable endpoint creates an SSRF and data-exfiltration boundary. Managed deployments enforce:

- HTTPS for every endpoint, including self-hosted/private-network configurations;
- valid certificate verification;
- rejection of loopback, link-local, private-network and cloud-metadata destinations;
- DNS resolution and rebinding protection;
- redirect revalidation or redirects disabled;
- explicit port and protocol policy;
- egress proxy and network allow/deny controls;
- connection, response-size and request-duration limits;
- safe handling of streaming responses;
- no arbitrary proxy headers;
- an allowlist for optional custom header names;
- redaction of URLs containing accidental credentials;
- rate limits and circuit breakers per workspace and provider.

Self-hosters may explicitly relax private-network destination restrictions for local model endpoints, but TLS/HTTPS and certificate policy remain mandatory. Managed Trax Cloud always denies private, loopback, link-local and metadata destinations.

A connection test sends a minimal synthetic request. It does not include journey data or personal context.

## 7. Context and privacy

Before enabling a provider, the user is told that the selected provider may receive:

- their Atlas prompt;
- policy-filtered journey context required for the request;
- tool schemas and tool results;
- provider-visible metadata required by the protocol.

The selected provider never receives:

- the provider API key inside prompt content;
- device-only document plaintext by default;
- inaccessible workspace, journey, party or traveller context;
- model chain-of-thought from another provider;
- application credentials, OAuth tokens or MCP access tokens.

Atlas minimises context before sending it. Workspace, party, traveller and resource-audience policies are applied before retrieval reaches the provider. Switching providers does not reuse provider-specific prompt caches across trust boundaries.

When web search is enabled, retrieved pages are untrusted data. Research output can enter Trax only through the bounded candidate/source tools in [V1 Agent-assisted Web Research](AGENT_RESEARCH_V1.md); page instructions never broaden tool authority.

## 8. Permissions and ownership

Suggested permissions:

```text
atlas.use
atlas.providers.read
atlas.providers.manage_own
atlas.providers.manage_workspace
atlas.provider_credentials.rotate
atlas.managed_credits.use
atlas.managed_credits.purchase
```

A Personal workspace may store multiple provider configurations and selects one explicit default. Each configuration can use device-local credential custody or an approved managed/operator `CredentialStore`; the UI discloses the resulting device availability and runtime processor. Agency administrators may configure an agency-wide provider and usage quotas, while role policy determines who can use it. A traveller invited to an agency journey cannot see or export the agency provider credential.

Provider administration is not exposed to external MCP clients by default. Creating, changing or deleting a provider requires re-authentication appropriate to the deployment and creates an audited change set. The API key itself is always redacted from the change event.

## 9. Commands and queries

Commands:

```text
atlas.provider.create
atlas.provider.update
atlas.provider.rotate_credential
atlas.provider.test
atlas.provider.set_default
atlas.provider.disable
atlas.provider.delete
```

Queries:

```text
GET /atlas/providers
GET /atlas/providers/{id}
GET /atlas/provider-modes
GET /atlas/providers/{id}/capabilities
GET /atlas/usage
```

Query responses expose provider metadata, health and redacted credential state only.

## 10. Audit and observability

Audit records may contain:

- actor and workspace;
- provider configuration ID and type;
- model identifier;
- provider mode;
- endpoint origin with sensitive URL components removed;
- configuration/test outcome;
- Atlas request correlation ID;
- approximate token or unit counts where supplied;
- whether tool proposals were made.

They never contain:

- API keys or authorization headers;
- full prompts or responses by default;
- private model reasoning;
- device-only document content.

BYO usage may be shown for diagnostics and user awareness but is not entered into the Trax credit ledger.

## 11. Failure behaviour

If a BYO endpoint is unavailable, incompatible, rate-limited or out of provider credit:

- Atlas reports a provider-specific error without leaking secrets;
- commands already approved and accepted continue independently;
- manual application and synchronisation remain available;
- Trax does not silently fall back to a paid managed provider;
- a provider without validated web-search capability cannot create current-web-research claims;
- the user may select another configured provider explicitly.

Provider errors are not retried indefinitely. Non-idempotent model requests require careful retry handling to avoid duplicate cost and tool proposals.

## 12. Managed-credit mode

`MANAGED_CREDITS` uses a Trax-operated model router and credit ledger. It shares the same provider-neutral Atlas contract, but:

- Trax selects from supported managed providers according to product policy;
- usage decrements an included or purchased credit balance;
- model multipliers and estimated cost are disclosed;
- top-ups require explicit payment approval and spending limits;
- exhaustion pauses only managed model requests;
- manual use, sync, data export and otherwise authorised external MCP access continue.

Credits control managed model consumption, not application permissions. The provider-neutral boundary ships in V1, but the Trax-operated `MANAGED_CREDITS` service is post-V1; V1 model use is local/BYO or external MCP.

## 13. Self-hosting

Self-hosters can configure:

- an OpenAI-compatible provider and their own key;
- a local/private HTTPS OpenAI-compatible endpoint;
- another provider through the public model-provider interface;
- their own secret-store implementation;
- no model at all.

No Trax Cloud subscription or Atlas credits are required. The self-hosting operator is responsible for endpoint security, credentials, model billing, privacy terms, monitoring and availability.

## 14. Security invariants

1. Atlas provider mode never broadens application access.
2. BYO provider billing goes directly between the user and provider.
3. BYO requests consume no Trax Atlas credits.
4. API keys are held only in an approved `CredentialStore` and runtime memory.
5. Secrets never appear in PostgreSQL application data, logs, analytics, backups, MCP payloads or audit events.
6. Endpoint validation prevents managed infrastructure from reaching forbidden networks.
7. Context is policy-filtered before it reaches any provider.
8. Switching providers does not silently transfer caches or credentials.
9. Provider failures never disable manual application or synchronisation.
10. Trax never silently falls back from BYO to a paid managed model.
11. Every provider endpoint uses HTTPS; private-network destinations require explicit self-hosted operator policy.
12. A workspace may keep multiple provider configurations but changes the default only explicitly.
13. API compatibility alone never implies browsing capability.
14. Web research uses bounded candidate tools and treats page content as untrusted.
