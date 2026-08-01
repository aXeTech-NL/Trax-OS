# Trax OS Product Scope

**Status:** Canonical V1 functional scope  
**Language:** English-first; user-facing copy is localization-ready.

## 1. Product promise

Trax OS is a manually complete, offline-capable travel operating system. Atlas accelerates planning and operations but never becomes the only way to use the product.

Two experiences share the same functional core:

- **Personal** — individuals and companions plan and operate their own journeys through simple sharing;
- **Agency** — travel organisations create journeys for customers, assign staff and leaders, and isolate families/parties through configurable access.

## 2. Core capability map

```text
Identity and workspaces
Journeys, travellers and travel parties
Planning board and scheduled timeline
Places, stays, moves, accommodation and activities
Packing and luggage
Tasks and notes
Budget and add-ons
Documents and device vault
Emergency information
Safety, health, entry, weather and sources
Discovery and shortlists
Atlas, MCP and change review
Offline, sync and readiness
Agency portfolio, roles and white-label configuration
```

The coherent V1 release includes this complete manual capability map, offline reads/writes and device transfers, BYO Atlas, external OAuth/MCP research and Agency mode. Trax-managed Atlas routing/credits is the only listed provider service deferred until after V1.

## 3. Identity and onboarding

Personal flow:

1. register or use the local-only app;
2. create/open a Personal workspace;
3. create a journey with optional travellers and luggage;
4. receive a default packing list;
5. enter Home or the journey cockpit.

Personal sharing offers simple editor/viewer access over the common permission engine. Managed accounts require email verification, password reset and session/device management. TOTP plus recovery codes is mandatory for agency owners/admins and platform support.

Agency flow:

1. create or enter an Agency workspace;
2. configure staff roles and permissions;
3. create a journey for registered or placeholder travellers;
4. create privacy parties before invitations;
5. assign organisers and journey leaders;
6. invite customers through a revocable email link with a seven-day default expiry into only their permitted journey/party scope.

Setup that affects several records is one composite command, not a chain of unrelated frontend requests.

## 4. Home and operational overview

Home answers:

```text
Where am I?
What is happening now?
What comes next?
What needs attention?
Are tasks, packing and documents ready?
What is available offline on this device?
Can Atlas help through the selected provider?
```

Prefer one policy-filtered `HomeSnapshot` read model. Status cards navigate to the exact module or record rather than a generic hub.

No provider snapshot is labelled “all clear”; absence remains unknown/unavailable.

## 5. Planning board

The planning board models ideas before dates or bookings are fixed.

```text
country lanes
locations
stay options
route/move ideas
buffers and planning notes
status and stable order
linked tasks, notes, documents and budget entries
```

Actions:

- add/edit/archive/reorder countries and locations;
- add provider candidates or manual places;
- add/edit/reorder stay options and route ideas;
- promote an option into a scheduled stay/move;
- review inferred details before promotion;
- retry promotion without duplicate segments;
- represent repeat visits to the same saved place as separate planning/scheduled occurrences.

A stay option is not a booking. Scheduling never implies reservation or payment.

## 6. Scheduled timeline

Scheduled travel contains ordered typed segments:

```text
stay
move
```

Users can:

- create/edit/reorder/archive stays and moves;
- use ordered, date or exact-datetime precision;
- set origin/destination timezones without fabricated UTC values;
- add accommodation and activities to stays;
- link tasks, packing, notes, documents and budget context;
- inspect travel-day details, check-in, luggage and tickets;
- review and undo supported changes.

Desktop combines map, timeline and detail/Atlas panels. Mobile uses compact timeline and travel-day flows.

## 7. Packing and luggage

Capabilities:

- default, segment-specific and custom packing lists;
- quantity and partially packed quantity;
- traveller assignment;
- luggage with handling type, weight and capacity;
- splitting item quantities across luggage;
- context links to places, segments and activities;
- filters by traveller, luggage, category, context, essential and to-buy;
- linked purchase budget entries;
- progress/readiness summaries.

Every drag interaction has a non-drag equivalent.

## 8. Tasks and notes

Tasks support:

```text
create/edit
status and completion
priority and due date
assignee
source
context links
archive/restore/delete policy
```

Notes are contextual to journey, segment, activity, accommodation, document or planning item and carry an explicit audience. Private notes never enter another party's sync set or Atlas context.

## 9. Budget, costs and add-ons

Users manage planned, estimated, booked, paid and to-buy entries through one budget model using integer minor units.

Capabilities:

- totals per currency;
- category/status breakdown;
- contextual cost editor;
- links to journey entities;
- party- and traveller-private add-ons;
- agency-internal supplier cost, margin and commission;
- no silent exchange conversion.

Trax records financial and booking state but performs no payment, bank transaction or booking. Transaction execution is outside the product contract; adding it requires a new architecture and product approval.

## 10. Documents and device vault

The Documents area distinguishes:

- metadata readiness;
- central non-sensitive file state;
- device-only replica state;
- assignment/transfer progress;
- actual availability on this device;
- expiry and attention state;
- owner and audience.

For eligible lower-sensitivity files, users choose central or device-only storage. Central versions are limited to 10 MiB and remain unavailable until size, MIME/content, checksum and malware verification succeeds.

Highly sensitive passport, identity, visa, medical and detailed insurance content remains device-only. Web viewing requires explicit trusted-device approval and a time-limited memory-only encrypted session.

Atlas and external LLMs receive metadata only by default.

## 11. Emergency information

Users can create, edit, order and archive:

```text
local emergency numbers
embassy/consulate
insurance contacts
medical contacts
family contacts
custom records
```

Records may link to travellers, places and permitted documents. Manual emergency data remains available when sources and Atlas are unavailable.

## 12. Safety, health, entry, weather and sources

Destination information and personal health data are separate.

Capabilities:

- source/freshness/provenance display;
- safety, destination-health, weather and entry snapshots;
- journey/traveller entry status;
- normalised actionable risks;
- acknowledge/resolve/dismiss;
- atomic risk-to-task conversion;
- manual fallback and notes;
- partial provider failure without damage to owned journey data.

Every source record states `live`, `fixture`, `manual`, `agent_research` or `disabled` truthfully. Information is not presented as medical, legal or immigration advice.

For V1, browsing-capable agents may propose safety, health and entry observations only when they cite sources in the controlled [Provider and Authoritative Source Registry](../integrations/SOURCE_REGISTRY.md). Trax safely verifies the URLs and preserves source facts separately from the model summary before any observation can become reviewed application data. Photon/OpenStreetMap is the place direction and MET Norway Locationforecast is the selected V1 weather provider.

## 13. Discovery

Provider and agent-researched candidates remain external suggestion data until explicitly adopted.

V1 prioritises agent-assisted web research:

- a browsing-capable ChatGPT/Claude client or Atlas provider reads a minimised journey research resource through MCP;
- it submits bounded, structured accommodation/activity candidates with source URLs and observation timestamps;
- candidates enter a review inbox with verification state and uncertainty;
- the user corrects, adopts or rejects each candidate;
- adoption calls the owning planning/activity command and preserves provenance.

Photon-compatible geocoding and MET Norway weather adapters provide structured location/weather data where deterministic freshness is important. Direct Booking.com, Tripadvisor and Expedia APIs are deferred; V1 does not claim official integration or guaranteed live price/availability.

Discovery never books or pays automatically.

## 14. Atlas and external agents

Atlas supports:

- no model;
- a local model;
- a user-provided OpenAI-compatible endpoint;
- a Trax-managed credit-backed provider.

V1 ships no Trax-managed provider service; it ships the provider-neutral boundary, BYO mode and external MCP. Managed-credit routing is the next managed-service phase.

Atlas conversations are creator-private by default, expire 30 days after last activity and can be exported/deleted earlier. Agency admins have no implicit access. Users see which context categories and provider mode are used.

A browsing-capable external MCP client may also perform V1 web research. OpenAI API compatibility alone does not imply browsing; BYO Atlas only exposes research when the configured provider declares a supported search capability.

Initial direct Atlas actions create tasks, packing items and notes. Accommodation/activity output enters the Planning Board as a cited research proposal and requires explicit adoption.

Agent flow:

1. user submits a prompt;
2. policy-filtered context is assembled;
3. model proposes typed actions;
4. each action shows impact, risk and required approval;
5. policy and consent are rechecked at confirmation;
6. canonical command executes idempotently;
7. change/audit result is visible and undo is offered where supported.

Do not default to “confirm all”. External agents use OAuth-authorised MCP resources/tools and the same application policies.

## 15. Agency portfolio and customer experience

Agency desktop capabilities:

- journey portfolio and operational state;
- create journeys for customers/groups;
- staff and custom role administration;
- effective-access inspector;
- organiser and leader assignment;
- traveller invitations;
- travel-party composition;
- shared baseline plus party/traveller overlays;
- add-on and fulfilment workflows;
- access/change audit;
- agency branding and customer portal configuration.

A customer sees the shared journey, overlays for parties they directly belong to and their personal overlay—never an unauthorised party or agency-internal data. Shared travellers do not propagate access between parties. Agency membership never exposes the customer's Personal workspace.

## 16. Offline, sync and readiness

V1 offline data includes:

- journeys, places and timeline;
- packing, tasks, notes and budget;
- emergency information;
- last-known permitted source snapshots;
- document metadata and files stored on the current device;
- pending commands and conflicts.

Local-only mode encrypts its database, stores keys in OS secure storage, performs no app-managed automatic or implicit Trax Cloud backup (and opts out of OS cloud backup where supported) and requires explicit canonical JSON export for recovery, with generated PDF/XLSX reports for human use. Losing the only device and exports may be unrecoverable.

Connecting Local to a sync workspace supports full-workspace or selective journey import. Non-conflicting records merge. Every actual conflict shows a preview and requires `Use device`, `Use cloud` or an explicit reviewed merge; neither side wins silently.

UI terminology must reflect actual capability:

- before local storage/sync exists: `Readiness` or `Offline Preflight` only;
- with local read storage: show last local availability;
- with offline writes: show pending/syncing/conflict/failed states;
- with encrypted device files: show verified device availability.

V1 implements encrypted local storage, offline reads/writes, a durable command queue, conflict handling and device file caching/transfers. PowerSync is the V1 sync adapter; canonical commands remain authoritative.

No server boolean proves a file is present on a device.

V1 notifications use in-app and email delivery for invitations, document/transfer requests, role changes, Atlas approvals and travel alerts. Mobile push follows stable mobile packaging and device identity.

## 17. Global interaction states

Every feature handles:

```text
session restoring
loading and empty
permission-limited
validation errors
network/provider unavailable
stale provider data
optimistic rollback
version conflict
sync conflict
soft-deleted/not found
online required
```

Expected domain errors use specific localized copy, not one generic failure.

## 18. Route and navigation principles

- Every major screen and detail is URL-addressable.
- Active workspace/journey and safe detail/filter state live in the route.
- Browser back/forward and deep links work.
- A typed registry drives mobile, desktop and More/hub navigation.
- Switching workspace or journey preserves an equivalent authorised route where possible.
- Inaccessible records do not leak through titles, counts or error messages.

Mobile primary navigation is `Home · Timeline · Packing · Documents · More`. Atlas is available throughout authorised modules as a contextual floating button and sheet/panel rather than a primary tab.

## 19. Non-goals for the first coherent release

Unless explicitly changed:

- microservices;
- event sourcing as the source of truth;
- booking or payment execution;
- direct Booking.com, Tripadvisor or Expedia API integrations in V1;
- Trax-managed Atlas provider service in V1;
- bank integration and expense settlement;
- arbitrary plugins or provider HTTP tools;
- arbitrary LLM document-content access;
- claims of offline editing without acceptance evidence;
- silent currency conversion;
- AI-only operation.

## 20. End-to-end acceptance journey

A coherent release demonstrates:

1. create a Personal or Agency journey with valid scoped access;
2. add travellers without conflating them with user accounts;
3. configure parties and verify cross-party isolation where applicable;
4. add countries, locations and options to planning;
5. promote a stay and route idea to the scheduled timeline idempotently;
6. add accommodation, activity, packing, luggage, tasks, notes and costs;
7. create non-sensitive document metadata/file and a device-only sensitive document replica;
8. add emergency information;
9. let a browsing-capable agent submit cited accommodation/activity suggestions and adopt one after review;
10. inspect a safely verified official source and convert a reviewed risk to a task;
11. use Atlas through a BYO provider, review one action and open its result/change set;
12. use deep links and reload major routes;
13. reject wrong-workspace, wrong-journey, wrong-party, stale-version and duplicate-command attempts;
14. demonstrate the exact offline behaviour claimed for that release.
