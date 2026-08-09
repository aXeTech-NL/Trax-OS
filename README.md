# Trax OS

**Your Travel OS**

Trax OS is a free and open-source, agentic travel operating system for keeping an entire journey organised in one place. It brings together destinations, accommodation, transport, documents, budgets, family travel, offline information and contextual assistance. Users can operate it manually, through Atlas or through authorised external MCP clients; AI is an additional interface, never a requirement.

It is designed for travellers who need more than a holiday planner: families on long journeys, slow travellers, remote workers and digital nomads who regularly move between cities and countries while keeping work, life and travel organised.

Official clients are intended to work with either a self-hosted Trax OS server or the managed Trax Cloud service through the same public API contract.

Trax OS was initiated by Marcel Marinus Bijl, trading as aXeTech, a sole proprietorship registered with the Dutch Chamber of Commerce (KVK). It is intended to grow as an open community project rather than a closed, vendor-controlled product.

> **Project status:** The current feature build includes an authenticated, PostgreSQL-backed Personal web API for sessions, Journeys, typed timeline items and packing, plus the integrated English/Dutch authenticated Journey web UI. Authoritative browser-local web mode was rejected; standalone local-only belongs to future encrypted Android/macOS clients.

## Server-backed web baseline

The web product requires a self-hosted server and authenticated session. PostgreSQL—not IndexedDB—is authoritative, so clearing browser data cannot delete the only copy of a Journey. The current backend provides Argon2id password authentication, opaque/hashed sessions, CSRF protection, Personal workspace isolation, RLS defence in depth and Journey/timeline/packing APIs.

The earlier IndexedDB authority was removed from production composition; the UI now uses the authenticated HTTP adapter and canonical server reloads. See [Server-backed web](docs/development/SERVER_BACKED_WEB.md) and [superseded local prototype](docs/development/LOCAL_JOURNEY_SLICE.md).

## Develop the current foundation and server-backed app

Prerequisites: Node.js 22, npm 10, Python 3.12 and [uv 0.12](https://docs.astral.sh/uv/). Docker Compose v2 is used for PostgreSQL/PostGIS and for the complete Phase 1 evaluation stack.

```bash
make bootstrap       # clean installs from package-lock.json and uv.lock
make db-up           # start development PostgreSQL/PostGIS
make db-migrate      # apply explicit Alembic revisions
make generate        # regenerate OpenAPI and TypeScript contracts
make check           # contract drift, formatting, lint, types and PostgreSQL-backed tests
make test            # focused API and web tests
make dev             # install dependencies, then start API :18000 and web :5173
make compose-config  # validate compose.yaml without starting services
make compose-up      # build, migrate and start the API plus built web app on :8080
make compose-smoke   # exercise the same-origin stack with synthetic data
make compose-down    # stop containers while preserving PostgreSQL data
```

The API exposes public health/version/capability discovery, authenticated `/api/v1/auth/*`, and server-authoritative `/api/v1/journeys/*`. During `make dev`, Vite proxies `/api` and `/health` to the API. The Compose web service provides the same-origin proxy for its built static app. The frontend registers/restores sessions and uses these authenticated endpoints for every Journey mutation.

The Compose path is loopback-only development/self-host evaluation evidence, not a production deployment. It uses development credentials and HTTP cookies; see the [Docker Compose evaluation guide](docs/development/COMPOSE_EVALUATION.md) for isolated clean runs, persistent-volume safety, compatibility and production security boundaries.

npm workspaces are the provisional JavaScript workspace mechanism because npm is available in the supported development environment. The root Make interface keeps common workflows stable. Pydantic/OpenAPI-first generation is likewise a provisional v0.1 contract foundation rather than a final architecture decision. See [Foundation development](docs/development/FOUNDATION.md).

## What Trax OS aims to provide

- A clear view of what matters **Now**, what comes **Next** and the complete **Journey**
- Destinations, stays and transport in one timeline
- Bookings, identity documents, tickets and notes in one Documents area
- Budget and packing tools for individuals and families
- Personal workspaces for people planning their own journeys
- Agency workspaces for organisers creating privacy-separated individual and group journeys
- Configurable roles and permissions for agency staff, journey leaders and travel parties
- Reliable offline access while travelling, including a durable local command queue
- Atlas as a contextual travel assistant and official MCP client rather than a privileged chatbot
- Local, bring-your-own OpenAI-compatible and managed-credit Atlas provider modes
- V1 agent-assisted web research with cited accommodation and activity suggestions
- Auditable, reviewable and reversible human and agent changes
- Device-only encrypted storage for highly sensitive documents
- Portable data and clients that are not locked to one hosted provider

## Free and open by design

Trax OS is intended to be a real FOSS product, not a limited community edition or a temporary open-source funnel for a later proprietary product.

Our commitment is simple:

- the public core should be complete, useful and independently self-hostable;
- project-authored source code and accepted contributions are released under Apache-2.0;
- no Contributor Licence Agreement is required and contributors are not asked to grant aXeTech special proprietary relicensing rights;
- code already released as FOSS remains FOSS permanently;
- essential self-hosting features should not be withheld to force adoption of Trax Cloud;
- open standards, documented APIs and data portability are preferred over vendor lock-in;
- important technical decisions, contribution guidelines and release information should be discussed in the open whenever practical.

Apache-2.0 allows everyone—including individuals, companies and competing hosting providers—to use Trax OS commercially. That freedom is intentional. Trax Cloud should earn support through convenience, reliability and good operations, not by weakening the public project.

Cloud-specific infrastructure and operational services may remain private, but they must consume the public Trax OS product rather than becoming a private replacement for it.

A self-hosted instance can enable the complete Personal and Agency capability set, including synchronisation, configurable roles and permissions, MCP, travel parties, device security and Atlas integration with an operator-provided model. Trax Cloud plans charge for managed hosting, model usage, backups, support and enterprise operations—not for a privately withheld functional core.

## Architecture

Trax OS is built around one versioned command contract and a shared application layer. The web, mobile and desktop clients, offline synchronisation, Atlas and external MCP clients all invoke the same command handlers and policies. Read-only access goes through a separate query layer.

Every meaningful state change must be authorised, validated, transactionally applied, audited and represented by a change set. Risky actions require a preview and explicit approval; reversible actions expose undo through compensating commands. Sensitive identity and medical documents are device-only: the server stores metadata and temporary encrypted transfer material, but never document decryption keys.

Desktop and large tablet are the primary planning cockpit. Mobile remains fully functional, but is optimised as an offline companion for travel-day context and quick changes. The application must remain usable without an LLM, network connection or Trax Cloud.

The same public core supports two workspace modes. Personal workspaces keep planning and sharing simple. Agency workspaces add journey portfolios, configurable roles and permissions, journey leaders and privacy-separated travel parties. Agency invitations never expose a traveller's personal workspace.

See the [Agentic Core Architecture](docs/architecture/AGENTIC_CORE.md) and [Agency Access Model](docs/architecture/AGENCY_ACCESS_MODEL.md) for the canonical design and repository boundaries.

## Community

We want to build an open, welcoming and product-oriented community in which users can become contributors and contributors can help shape the project.

Good ideas should be evaluated on their usefulness and technical merit, regardless of who proposes them. We aim for transparent discussions, respectful reviews, documented decisions and a low barrier to contribution.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

## Technical principles

- Free, open-source and independently self-hostable
- One command and change engine for Personal and Agency workspaces, UI, sync, Atlas and external MCP clients
- Configurable scoped permissions and server-enforced travel-party privacy
- Separate command and query paths with PostgreSQL as the source of truth
- Versioned public API, command, MCP and capability contracts
- Audit logging, optimistic concurrency, risk policies, preview and undo
- Offline-first clients with idempotent command synchronisation
- Desktop-first journey management and a fully functional mobile companion
- Device-only end-to-end encrypted storage for sensitive documents
- Fully usable without an LLM and without hardcoded Trax Cloud dependencies
- Complete Personal and Agency functionality for self-hosters
- Portable, exportable user data

## Project documentation

- [Documentation index](docs/README.md)
- [Agentic Core Architecture](docs/architecture/AGENTIC_CORE.md)
- [Agency, Group Travel and Access Model](docs/architecture/AGENCY_ACCESS_MODEL.md)
- [Atlas Model Provider Architecture](docs/architecture/ATLAS_PROVIDER_MODEL.md)
- [V1 Agent-assisted Web Research](docs/architecture/AGENT_RESEARCH_V1.md)
- [Implementation Architecture](docs/architecture/IMPLEMENTATION_ARCHITECTURE.md)
- [Target Domain Model](docs/architecture/DOMAIN_MODEL.md)
- [Product Scope](docs/product/PRODUCT_SCOPE.md)
- [Provider and Authoritative Source Registry](docs/integrations/SOURCE_REGISTRY.md)
- [Phase 0 Threat Model](docs/security/PHASE_0_THREAT_MODEL.md)
- [Implementation Roadmap](docs/development/IMPLEMENTATION_ROADMAP.md)
- [Architecture documentation index](docs/architecture/README.md)
- [Design system](docs/design/DESIGN_SYSTEM.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Branding guidelines](BRANDING.md)
- [Trademark policy](TRADEMARKS.md)

## Licence

The Trax OS source code is licensed under the [Apache License 2.0](LICENSE). Contributions are accepted under the same licence without a separate CLA.

The source-code licence does not grant permission to use the Trax OS or Atlas trademarks, logos, app icons or other protected brand assets except as described in the [trademark policy](TRADEMARKS.md).
