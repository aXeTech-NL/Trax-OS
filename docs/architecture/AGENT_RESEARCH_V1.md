# V1 Agent-assisted Web Research

**Status:** Canonical V1 integration strategy  
**Related:** [Agentic Core Architecture](AGENTIC_CORE.md), [Product Scope](../product/PRODUCT_SCOPE.md)

## 1. V1 strategy

V1 uses browsing-capable LLMs and agents for broad accommodation, activity and source research instead of building direct Booking.com, Tripadvisor, Expedia or similar commercial discovery integrations.

The model performs web research, reads only policy-approved journey context through MCP and submits structured, cited candidates to Trax OS. It never turns web content directly into booked or trusted journey state.

```text
Browsing-capable ChatGPT / Claude / Atlas provider
  → reads scoped Trax MCP resources
  → researches public web sources
  → submits structured candidates and source references
  → Trax validates schema, scope, URLs and policy
  → suggestion inbox
  → user reviews
  → adopt command
  → owned planning/activity record + change set
```

Direct commercial APIs may be added later when reliable live availability, contractual attribution, deterministic refresh, SLA or booking handoff justifies them.

## 2. V1 integration categories

| Category | V1 strategy |
|---|---|
| Accommodation ideas | Agent-assisted web research and candidate submission |
| Activity ideas | Agent-assisted web research and candidate submission |
| Family/party fit | Agent summary with cited sources and explicit uncertainty |
| Geocoding/place normalisation | Approved direct structured provider plus manual fallback |
| Weather | Approved direct structured provider when configured; truthful unavailable/stale fallback |
| Safety | Agent research only from allowlisted authoritative sources, followed by Trax source verification |
| Destination health | Same authoritative-source verification; informational only |
| Entry/visa | Same authoritative-source verification; never presented as legal determination |
| Booking/payment | Not performed in V1 |
| Booking.com/Tripadvisor/Expedia API | Deferred; no official-integration claim in V1 |

## 3. Research is a proposal plane

Research tools write to a suggestion/candidate inbox, not directly to owned journey records.

Candidate states:

```text
submitted
source_check_pending
source_verified
needs_review
adopted
rejected
expired
```

A candidate contains at least:

```text
id
workspace_id
journey_id
candidate_type = accommodation | activity | safety_observation | health_observation | entry_observation
proposed_title
structured_details
location_reference nullable
rationale
source_references[]
observed_at
submitted_by_actor
model_provider/model_name nullable
verification_status
confidence_label
status
created_at/expires_at
```

Optional price, rating, availability and opening-hours data is labelled as an observed snapshot with source and timestamp. It is never represented as guaranteed current inventory.

## 4. Adoption into owned data

User adoption is an explicit command:

```text
research.adopt_accommodation_candidate
research.adopt_activity_candidate
research.adopt_source_observation
```

Adoption:

1. reloads the candidate and current source-verification state;
2. rechecks the actor's workspace/journey/party permission;
3. previews the exact owned records to create;
4. lets the user correct inferred fields;
5. creates a stay option, activity idea or reviewed source-derived record through the owning command service;
6. preserves candidate/source provenance;
7. creates a change set and reversibility data;
8. marks the candidate adopted idempotently.

Scheduling still does not imply booking. Candidate submission itself is low impact because it affects only the review inbox; it still creates a reversible change set and agent audit. Adoption is a separate reviewed mutation.

## 5. MCP resources and scopes

Suggested read resources:

```text
trax://journeys/{journey_id}/research-context
trax://journeys/{journey_id}/planning/suggestions
trax://journeys/{journey_id}/source-requirements
```

`research-context` is deliberately minimised. It may include destination, dates, party size, accessibility/family preferences, budget bands and selected itinerary context. It excludes private documents, provider credentials, inaccessible party context and private health data.

Suggested least-privilege OAuth scopes:

```text
journeys:read
planning:read
planning:suggestions:write
accommodations:candidates:write
activities:candidates:write
research:sources:submit
```

These scopes do not grant general journey write, document request, role management, booking or payment rights.

## 6. MCP tools

```text
research.submit_accommodation_candidates
research.submit_activity_candidates
research.submit_source_references
research.submit_safety_observations
research.submit_health_observations
research.submit_entry_observations
```

Tool constraints:

- strict versioned schemas;
- bounded batch size and text length;
- idempotency key;
- journey and workspace scope derived/revalidated server-side;
- source URL required for externally asserted facts;
- no raw HTML or bulk page content;
- no arbitrary target type;
- no executable instructions in candidate fields;
- no automatic adoption;
- actor, OAuth client, model and input audit metadata;
- reversible candidate-submission change set;
- rate and abuse limits.

Role, payment, document-content and unrestricted write tools are not part of the research tool set.

## 7. Source verification

An LLM citation is a claim, not proof that a page exists or supports the summary.

Trax verifies submitted sources through a dedicated safe-fetch/source-verification port:

```text
submitted URL
→ canonicalise and validate
→ block private/link-local/metadata networks
→ controlled fetch with timeout/size/redirect policy
→ record final URL, retrieval time, status and content hash
→ classify authoritative/commercial/community source
→ compare the candidate claim with permitted extracted evidence where implemented
```

The system never treats model-generated citation text as a source without URL verification. A valid URL proves retrievability, not factual correctness.

Source records distinguish:

```text
source_type
provider/site name
source_url
published_at nullable
retrieved_at
expires_at nullable
provenance = agent_research
verification_status
reliability
content_hash nullable
```

## 8. Safety, health and entry rules

High-impact source domains use a stricter pipeline.

Allowed authorities are maintained in the controlled [Provider and Authoritative Source Registry](../integrations/SOURCE_REGISTRY.md). They include reviewed national travel-advice, embassy/immigration, WHO/public-health, emergency-management and meteorological authorities. Exact approved hosts/path constraints are required; no blanket government-domain or NGO wildcard is trusted.

Rules:

- versioned exact-host/path allowlist per source category;
- non-authoritative observations remain unverified suggestions and cannot become trusted snapshots;
- the LLM summary is stored separately from source facts;
- source, retrieval time and freshness are always visible;
- unknown remains unknown;
- user sees informational/not-medical-or-legal-advice language;
- no traveller-private health or document context is sent automatically;
- source-derived tasks/risks require explicit adoption or policy-approved conversion.

## 9. Prompt-injection boundary

Web pages are untrusted content and may contain instructions intended to manipulate an agent.

Defences:

- web content is data, never application/system instruction;
- external agents receive narrowly scoped MCP grants;
- MCP schemas and server policy—not model reasoning—define authority;
- research tools cannot call arbitrary HTTP through Trax;
- no candidate field is executed as a command;
- candidates enter an isolated review inbox;
- sensitive and high-risk commands require separate user confirmation;
- indirect prompt-injection tests are a release gate;
- URLs and fetched content are malware/content-type/size constrained as appropriate.

## 10. Provider capability differences

### ChatGPT or Claude connected as external MCP client

If the user's product/account supports both browsing and MCP, the external model can research the web and submit candidates. Model subscription/browsing cost stays outside Trax.

### BYO OpenAI-compatible Atlas provider

OpenAI API compatibility does not imply web access. BYO research is enabled only when the provider configuration advertises and passes a supported web-search capability profile. Without it, Atlas can reason over existing Trax context but cannot claim current web research.

### Managed Atlas

Managed Atlas may expose a controlled web-search/research adapter. Search/model use consumes managed credits according to the commercial policy. It submits candidates through the same research tools and receives no broader application authority.

## 11. Attribution, terms and naming

V1 may cite public Booking.com, Tripadvisor, Expedia or other pages found by the user's agent, subject to applicable access and use terms. Trax OS must not:

- describe this as an official provider integration;
- scrape or republish bulk protected content through a generic crawler;
- copy full reviews or proprietary descriptions unnecessarily;
- imply current availability or price guarantees;
- use provider marks in a way that implies partnership;
- bypass access controls, robots policy or contractual API restrictions.

Store minimal factual candidate data, source URLs, timestamps and user/agent summaries. Direct integrations require separate provider terms, API approval and attribution review.

## 12. Direct integrations deferred

Future adapters may cover Booking.com, Tripadvisor, Expedia or specialist providers when they add value such as:

- deterministic structured search;
- live availability and pricing;
- stable IDs and deduplication;
- scheduled refresh;
- licensed media/reviews;
- affiliate or booking handoff;
- provider SLA and support.

They remain backend/provider adapters and never become a second domain write path. Results still enter external candidate models and require explicit adoption unless a separately approved transactional flow exists.

## 13. V1 acceptance criteria

- external OAuth/MCP client can read a minimised research context;
- browsing-capable agent can submit a bounded cited accommodation/activity batch;
- duplicate submission is idempotent;
- wrong workspace/journey/party submissions are rejected;
- candidates cannot mutate the scheduled timeline directly;
- user can review, correct, adopt and reject candidates;
- adoption creates provenance and a change set;
- price/availability snapshots show observed time and uncertainty;
- safety/health/entry sources pass authoritative-domain and safe-fetch policy;
- fabricated/unreachable citations are visibly rejected or unverified;
- indirect prompt injection cannot broaden tools or invoke commands;
- BYO Atlas without search capability never claims browsing;
- provider outage leaves manual planning functional;
- no UI claims an official Booking.com, Tripadvisor or Expedia integration.
