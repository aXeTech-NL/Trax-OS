# Local Journey web slice

**Status:** Implemented provisional web slice

**Authority:** Browser-local only

**Schema:** `trax-os-local`, IndexedDB version 1

## Product outcome

A user can work manually in English or Dutch to:

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

## Runtime boundaries

Feature components depend on `JourneyRepository`. Production composition injects `IndexedDbJourneyRepository`; tests inject `InMemoryJourneyRepository`. A single read/write transaction replaces the Journey, segment and packing stores together. Journey deletion removes its related records in the same commit.

IndexedDB object stores:

- `journeys`;
- `segments`, indexed by `journeyId`;
- `packing`, indexed by `journeyId`;
- `preferences` for locale.

Persisted domain values remain language-neutral. Dates are local ISO `YYYY-MM-DD` values and are formatted only at the UI boundary.

## Offline boundary

The Vite production build emits a revisioned Workbox service worker and navigation fallback. `/api` and `/health` navigations are excluded from fallback and no runtime API cache is configured. The app shell can reopen only after a successful first load/service-worker installation.

Network availability and browser-local saving are separate states. An available network does not mean Journey data is synchronized.

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
- IndexedDB adapter test proves persistence across repository instances, locale storage and rejection without data loss.
- Backup tests prove versioned round trips and reject unsupported or orphaned records before replacement.
- App integration tests cover onboarding, Journey creation, stay creation, packing/checking, Dutch switching, API isolation/failure and unknown IDs.
- Existing API and generated contract boundaries remain unchanged.

The later canonical local-only runtime must provide reviewed encryption, export/import, command/change semantics and safe self-hosted pairing before this slice can be described as the secure V1 offline authority.
