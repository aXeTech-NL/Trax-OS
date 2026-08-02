# Local Journey web prototype

**Status:** Superseded UI/persistence prototype; not a supported web mode

**Authority:** Prototype evidence only; authenticated PostgreSQL is authoritative for web

**Prototype schema:** `trax-os-local`, IndexedDB version 1

## Product outcome

This prototype demonstrated reusable Journey UI/domain seams. Authoritative browser-local operation was subsequently rejected because clearing site data predictably destroys it. The supported web product uses the authenticated server baseline in [`SERVER_BACKED_WEB.md`](SERVER_BACKED_WEB.md).

The prototype allowed a user to:

- create, edit, archive, restore and delete a generic Journey;
- use the same model for one or many stops, countries and activities;
- add typed stays and moves to an ordered timeline;
- edit, delete and reorder timeline items with explicit controls;
- create category/quantity-aware packing items and track packed quantity;
- see local Now/Next, timeline and packing summaries;
- move journeys through planning, active and completed states;
- download and restore a validated, versioned local JSON backup;
- revisit deep-linked routes after local data has loaded.

The Journey library and workflows do not call the API. Public instance discovery remains on About and cannot block local planning.

## Runtime boundary after the decision

Feature components still depend on `JourneyRepository`, so the useful UI/domain work was retained. Production composition now injects `HttpJourneyRepository`; only tests inject `InMemoryJourneyRepository`. IndexedDB Journey authority and browser backup code were removed. Locale preference may remain disposable browser-local state.

Persisted domain values remain language-neutral. Dates are local ISO `YYYY-MM-DD` values and are formatted only at the UI boundary.

## Offline boundary

The Vite production build emits a revisioned Workbox service worker and navigation fallback. `/api` and `/health` navigations are excluded from fallback and no runtime API cache is configured. The app shell can reopen only after a successful first load/service-worker installation.

The shell can render an honest reconnect state offline. Authorised Journey reads and every mutation require the self-hosted server; the service worker never caches API responses.

## Explicit limitations

This slice is not:

- encrypted storage or OS-secure key custody;
- server/PostgreSQL persistence;
- account, workspace, role, party or traveller authority;
- multi-device sync, PowerSync, automatic/cloud backup or conflict resolution;
- server-compatible canonical export/import or pairing;
- Android/Capacitor or macOS/Tauri packaging;
- Atlas/LLM, provider, booking, payment, maps or document storage.

Browser/site data can be cleared or evicted. Sensitive documents, identity data and credentials must not be stored in this provisional slice.

## Routes

| Route | Function |
|---|---|
| `/` | Journey library and onboarding |
| `/journeys/new` | Journey creation |
| `/journeys/:journeyId` | Overview, Now/Next and journey lifecycle |
| `/journeys/:journeyId/timeline` | Ordered stay/move planning |
| `/journeys/:journeyId/packing` | Packing checklist and quantities |
| `/settings/data` | Locale and truthful local-data explanation |
| `/about` | Product boundary and optional instance discovery |

Unknown paths and IDs return a privacy-neutral localized not-found state.

## Acceptance evidence

- Typed domain/service tests cover date validation, segment ordering, cascade deletion and packing bounds.
- Auth tests cover anonymous bootstrap, registration, session restoration, CSRF logout and no Journey load before authentication.
- HTTP adapter tests cover canonical mapping, CSRF mutation and server reload after browser preferences are cleared.
- App integration tests cover onboarding, Journey creation, stay creation, packing/checking, Dutch switching, API failure and unknown IDs.
- Generated API contracts cover authenticated server authority.

The later canonical local-only runtime must provide reviewed encryption, export/import, command/change semantics and safe self-hosted pairing before this slice can be described as the secure V1 offline authority.
