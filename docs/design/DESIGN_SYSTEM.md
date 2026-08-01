# Trax OS — Brand Identity and Design System

## 1. Brand Positioning

**Name:** Trax OS  
**Tagline:** Your Travel OS  
**AI assistant:** Atlas

Trax OS is not a traditional travel planner, but the central operating system for an entire journey. The app brings planning, stays, transport, documents, budgets, family travel, offline information and AI assistance together in one calm and well-organised environment.

The visual identity should feel:

- fresh and modern;
- reliable and organised;
- adventurous without becoming busy or touristy;
- suitable for families, remote workers and slow travel;
- practical while travelling and powerful during preparation;
- premium, yet accessible.

---

## 2. Core Design Concept

Trax OS is built around three time horizons:

### Now
Everything that is relevant at this moment:

- current location;
- daily schedule;
- accommodation;
- local time and weather;
- urgent tasks;
- offline status;
- practical information.

### Next
Everything needed for the next step:

- next destination;
- transport;
- check-in;
- documents;
- outstanding preparations;
- items that still need to be arranged.

### Journey
The complete travel story:

- route;
- locations;
- stays;
- transport;
- budget;
- documents;
- planning;
- memories.

The interface should therefore feel like one continuous journey, not a collection of separate modules.

---

## 3. Visual Direction

### Keywords

- fresh;
- airy;
- cartographic;
- calm;
- tactile;
- premium;
- functional;
- human;
- adaptive across a desktop planning cockpit and a mobile travel companion.

### Do Not Use

Avoid:

- heavy sand and beige tones;
- an overly earthy or dusty appearance;
- dark dashboards with many high-contrast blocks;
- generic SaaS cards;
- overly tourist-oriented photography;
- too many decorative illustrations;
- busy gradients;
- bright neon colours;
- excessive borders.

### Desired Appearance

The refreshed style combines:

- bright off-white surfaces;
- cool light grey;
- subtle mint green;
- emerald-green primary accents;
- fresh sky-blue supporting colours;
- limited coral or orange for warnings and actions;
- topographic lines and maps as a subtle brand layer;
- generous whitespace;
- rounded cards with soft shadows.

---

## 4. Colour Palette

### 4.1 Base Colours

| Name | Hex | Usage |
|---|---:|---|
| Fresh White | `#F8FBFC` | Main background |
| Pure Surface | `#FFFFFF` | Cards, modals and panels |
| Cool Mist | `#EEF3F5` | Secondary surfaces and dividers |
| Soft Mint | `#E8F5F1` | Status areas, filters and soft accents |
| Deep Ink | `#142536` | Primary text and headings |
| Slate Text | `#526273` | Secondary text |
| Muted Text | `#7D8A96` | Metadata, labels and supporting text |

### 4.2 Primary Accent Colours

| Name | Hex | Usage |
|---|---:|---|
| Trax Emerald | `#14866D` | Primary buttons, active navigation and route points |
| Route Teal | `#1599A8` | Maps, routes, active states and data visualisation |
| Atlas Blue | `#3A8FD8` | AI, information, confirmed actions and smart suggestions |
| Sky Tint | `#DFF3FA` | Background for informational cards |

### 4.3 Signal Colours

| Name | Hex | Usage |
|---|---:|---|
| Signal Green | `#2DAA76` | Confirmed, ready and completed |
| Signal Yellow | `#F2B84B` | Attention required or an approaching action |
| Coral Action | `#F26F4C` | Urgent, still to be arranged or important call to action |
| Error Red | `#D94B4B` | Errors and critical warnings |

### 4.4 Colour Distribution

Recommended ratio:

- 65% white and very light grey;
- 20% cool neutral and mint;
- 10% green and teal;
- 5% blue, yellow, orange and red.

Use signal colours sparingly. The interface should remain predominantly light and calm.

---

## 5. Typography

### 5.1 Primary Typeface

For interfaces, navigation and functional text, use:

- **Inter**;
- alternative: **Geist**;
- alternative: **Manrope**.

Recommended default: **Inter**.

### 5.2 Display Typeface

For large location headings and welcome messages, a subtly distinctive serif typeface may be used, such as:

- **DM Serif Display**;
- **Lora**;
- **Newsreader**.

Use this only for:

- large destination names;
- hero headings;
- journey introductions;
- occasional editorial accents.

Do not use serif typefaces for navigation, forms or small text.

### 5.3 Typographic Scale

| Level | Size | Weight | Usage |
|---|---:|---:|---|
| Display XL | 36–40 px | 500–600 | Large location or welcome heading |
| Heading 1 | 28–32 px | 600 | Page or destination heading |
| Heading 2 | 22–24 px | 600 | Section heading |
| Heading 3 | 18–20 px | 600 | Card heading |
| Body | 15–16 px | 400 | Main text |
| Body Small | 13–14 px | 400–500 | Metadata |
| Label | 11–12 px | 600 | Status labels and section titles |

Line height:

- display: 1.1–1.2;
- headings: 1.2–1.3;
- body: 1.45–1.6.

---

## 6. Logo and Brand Use

### 6.1 Logo Construction

The Trax OS logo consists of:

- a compact geometric route or mountain symbol;
- the text `TRAX OS`;
- optionally, the tagline `Your Travel OS`.

The symbol should refer to:

- routes;
- movement;
- connection;
- maps;
- travel;
- a central X as a recognisable element.

### 6.2 Logo Variations

Preferred variations:

1. Trax Emerald on white;
2. Deep Ink on white;
3. white on Trax Emerald;
4. monochrome for small applications.

### 6.3 Usage

- Maintain sufficient clear space around the logo.
- Use a compact logo in mobile headers.
- Use the tagline only on marketing pages, onboarding screens and presentations.
- Avoid gradients in the primary logo.
- Do not use shadows in the logo itself.

### 6.4 Workspace and White-label Branding

Agency workspaces may configure customer-facing brand tokens such as display name, logo, accent colours, support links and invitation copy. Shared managed deployments expose this as workspace theming. True white-label uses a dedicated environment and may also use a custom domain and neutral product surfaces.

Requirements:

- branding is scoped to the active Agency workspace and never alters a Personal workspace;
- the active agency or publisher remains clear to prevent phishing and scope confusion;
- custom colours must retain WCAG AA contrast and visible risk states;
- role, privacy, audit and device-security behaviour cannot be themed away;
- official mobile and desktop apps load the active workspace's allowed branding after first login and cache it for subsequent launches;
- V1 white-label does not include separate package identifiers, signing keys, publisher identities, app-store listings or update channels;
- official Trax OS marks follow the branding and trademark policies.

---

## 7. Shape Language

### 7.1 Corner Radius

| Component | Radius |
|---|---:|
| Large cards | 18–20 px |
| Standard cards | 14–16 px |
| Buttons | 12–14 px |
| Chips | 999 px |
| Modals | 20–24 px |
| Images | 14–18 px |

### 7.2 Shadows

Use soft, cool shadows:

```css
box-shadow: 0 8px 24px rgba(20, 37, 54, 0.08);
```

For smaller cards:

```css
box-shadow: 0 3px 12px rgba(20, 37, 54, 0.06);
```

Shadows should remain subtle and never look heavy or dark.

### 7.3 Borders

Use only where needed:

```css
border: 1px solid #E4EBEE;
```

Avoid thick outlines. Separation should primarily be created through whitespace, background colour and soft shadows.

---

## 8. Iconography

Use a consistent outline icon set, such as:

- Lucide;
- Phosphor;
- Tabler Icons.

Characteristics:

- rounded line caps;
- 1.75–2 px stroke width;
- simple geometry;
- minimal detail;
- limited use of filled icons.

Active icons may be partially filled or use an accent colour.

Examples:

- Home: house;
- Journey: route with points;
- Atlas: compass;
- Documents: file or folder;
- More: horizontal ellipsis;
- accommodation: bed;
- transport: plane, train or car;
- practical: plus, shopping cart, SIM card;
- family: pushchair, baby, washing machine.

---

## 9. Photography and Illustration

### 9.1 Photography

Use photography that is:

- bright;
- natural;
- green and airy;
- lightly blue-toned or fresh in colour temperature;
- free of heavy filters;
- not overly saturated;
- preferably composed with space for text.

Avoid:

- sepia;
- heavy beige filters;
- generic stock images of tourists;
- busy photographs;
- extremely high-contrast images.

### 9.2 Maps and Topography

Maps are an important visual element.

Use:

- light blue and mint-green map areas;
- thin route lines;
- topographic contours;
- subtle national borders;
- rounded route points;
- clear status markers.

Topographic patterns may appear as a very subtle background layer, for example at 3–6% opacity.

---

## 10. Navigation

### 10.1 Personal and Traveller Mobile Navigation

Use these five primary sections:

| Section | Purpose |
|---|---|
| Home | Today, current location and next step |
| Timeline | Route, stays, moves and activities |
| Packing | Packing lists, luggage and readiness |
| Documents | Documents, tickets, vouchers and device availability |
| More | Planning Board, budget, people, settings and synchronisation |

Atlas is always available contextually through a floating button that opens a sheet or side panel. It is not a primary navigation section.

The active tab uses Trax Emerald or Route Teal.

### 10.2 Desktop and Large Tablet

Desktop and large tablet are the primary environments for building, restructuring and extensively managing journeys. Use a compact sidebar with the same main sections and support simultaneous panels for:

- navigation;
- map and journey timeline;
- detail or editing context;
- Atlas and change review.

The planning cockpit should support drag-and-drop, comparison views, bulk actions, complex forms, document-to-device assignment and detailed change-set review. Large tablets may collapse panels and must provide touch-optimised controls.

Mobile exposes the same domain capabilities but favours contextual, step-by-step interactions over reproducing the full cockpit.

### 10.3 Workspace Modes

Users who have access to multiple workspaces use a clear workspace switcher. Personal and Agency modes must be visually distinct enough to prevent accidental actions in the wrong scope, while retaining the same design system.

Personal mode keeps the standard Home, Timeline, Packing, Documents and More navigation, with Atlas available contextually. Agency desktop mode adds portfolio-level areas such as:

- Overview;
- Journeys;
- Travellers and parties;
- Operations;
- Roles & Permissions;
- Audit;
- Settings.

A traveller invited to an agency journey sees that journey in their own experience but does not see agency navigation or staff data.

### 10.4 Route and Registry Behaviour

Every major screen and detail is URL-addressable. Browser back/forward, reload and deep links preserve the active authorised workspace, journey and screen. A single typed navigation registry drives mobile tabs, desktop sidebar and More/hub entries so surfaces cannot drift.

Switching a workspace or journey navigates to an equivalent authorised route where possible. Inaccessible records must not leak through route titles, counts, autocomplete or error states.

---

## 11. Home Screen

The Home screen answers:

1. Where am I?
2. What is happening today?
3. What is the next step?
4. Is everything prepared?
5. Is the information available offline?

### 11.1 Header

Elements:

- compact Trax OS logo;
- notification icon;
- large welcome message;
- current location;
- local time;
- weather;
- current day of the stay.

Example:

> Good morning from  
> Chiang Mai.

Supporting line:

> 26° · Mostly sunny · Day 4 of 8

### 11.2 Today Card

Displays a simple vertical daily schedule:

- time;
- icon;
- activity;
- optional location;
- chevron to view details.

### 11.3 Next Move Card

Displays:

- current destination;
- next destination;
- number of days until departure;
- confirmed items;
- missing items.

Status examples:

- Accommodation — Confirmed;
- Flight — Confirmed;
- Transfer — To arrange.

### 11.4 Offline Status

Use a compact status card:

> Offline-ready  
> Maps, plans & docs available

### 11.5 Atlas Suggestion

Atlas uses a light-blue or mint-coloured card.

Example:

> Doi Suthep is quieter early morning.  
> Go before 8:00 AM for clearer views.

Atlas suggestions are small, relevant and unobtrusive.

---

## 12. Journey Screen

The Journey screen is the heart of Trax OS.

### 12.1 Top Map

Displays:

- route;
- destinations;
- countries;
- current location;
- planned next steps;
- optionally, the type of journey.

### 12.2 Timeline

Use a vertical timeline with:

- stay blocks;
- travel blocks;
- country sections;
- status labels;
- dates;
- number of nights.

#### Stay Block

Contains:

- location;
- date;
- number of nights;
- status;
- accommodation, if known.

#### Travel Block

Contains:

- mode of transport;
- transport number;
- date;
- travel time;
- confirmation status.

### 12.3 Statuses

- Complete;
- Current;
- Upcoming;
- Draft;
- Missing information.

---

## 13. Location Page

Each destination has its own overview.

### 13.1 Hero

Contains:

- destination photograph;
- location;
- dates;
- number of nights;
- quick back button;
- more menu.

### 13.2 Family Layer

Display relevant attributes as compact chips:

- Child-friendly;
- Washing machine;
- Pushchair friendly;
- Cot available;
- Quiet area;
- Kitchen.

### 13.3 Main Sections

#### Stay
- accommodation;
- address;
- check-in;
- contact details;
- booking document.

#### Plan
- activities;
- work blocks;
- rest days;
- daily schedule.

#### Practical
- hospital;
- pharmacy;
- supermarket;
- local transport;
- SIM card;
- emergency information.

#### Notes
- free-form notes;
- journal;
- local observations;
- Atlas summaries.

---

## 14. Atlas

Atlas is a contextual AI assistant, not a standalone chat product.

### 14.1 Role

Atlas helps with:

- planning;
- preparation;
- document checks;
- route optimisation;
- practical information;
- family-friendly choices;
- offline preparation;
- identifying missing items.

### 14.2 Interaction

Atlas opens from a persistent contextual floating button as a mobile sheet or desktop side panel. It should preferably provide action-oriented cards with options such as:

- Add task;
- Save to location;
- Compare;
- Mark complete;
- Dismiss.

Initial direct actions create a task, packing item or note. Accommodation and activity ideas appear as cited Planning Board research cards and require separate adoption.

### 14.3 Visual Style

Use:

- Atlas Blue;
- Sky Tint;
- compass icon;
- light cards;
- short, specific suggestions.

Atlas should not have the dominant appearance of a chatbot.

### 14.4 Action Safety

Atlas uses the same commands and policies as the manual interface. The UI must distinguish:

- low-risk actions that can execute immediately;
- medium-risk actions that show a clear confirmation after execution and offer undo;
- high-risk actions that first show an exact preview and require explicit approval.

Agent actions display the actor, reason, affected entities and reversibility. Do not expose model chain-of-thought.

### 14.5 Model Provider Settings

Atlas settings distinguish:

- No model;
- Local provider;
- Bring your own OpenAI-compatible provider;
- Trax-managed provider with credits.

The BYO form requests display name, HTTPS base URL, model and API key. The key is write-only: after save, show only a redacted configured state with rotate and delete actions. A connection test uses synthetic content and clearly states that no journey context is sent.

Before activation, explain which policy-filtered prompt and journey context the selected provider may receive. BYO mode shows “Billed by your provider — no Trax credits used”; managed mode shows balance, estimated credit use and spending controls. Provider failure must leave all manual and synchronisation screens available and must never trigger an automatic paid fallback.

### 14.6 Research Suggestions

Agent web research appears in the Planning Board suggestion inbox, not as silently scheduled journey data. Candidate cards show:

- candidate type and proposed title;
- source links and observed timestamp;
- agent/provider identity;
- verification and freshness state;
- price/availability uncertainty where applicable;
- rationale and matched journey preferences;
- Review, Adopt and Reject actions.

Adopt opens an editable preview before creating owned planning data. Safety/health/entry cards distinguish verified official sources from unverified observations. Do not use Booking.com, Tripadvisor or Expedia branding in a way that implies an official V1 integration.

---

## 15. Documents

Documents provides one clear surface for document metadata, central files and the device vault.

Categories:

- flights;
- trains;
- stays;
- passports;
- visas;
- insurance documents;
- tickets;
- invoices;
- screenshots;
- notes.

Important statuses:

- Metadata synced;
- Available on this device;
- Assigned to another trusted device;
- Transfer pending;
- Encrypted;
- Needs attention.

Highly sensitive identity, personal visa, medical and detailed insurance documents use device-only storage. For eligible lower-sensitivity files, the user chooses central or device-only storage. Central versions are limited to 10 MiB and remain in processing until malware/content verification succeeds. The Documents area may show centrally stored metadata, but must not imply that device-only document content is available in the cloud. Browser viewing requires explicit device approval and a time-limited, memory-only encrypted session.

Documents must be quick to search and filter by:

- journey;
- person;
- country;
- location;
- date;
- document type.

---

## 16. Family Mode

Family features are part of the Trax OS core.

### 16.1 Traveller Profiles

For each traveller:

- name;
- date of birth;
- documents;
- luggage;
- preferences;
- relevant health information;
- seat preference;
- emergency contacts.

### 16.2 Packing Lists

Divide items into:

- general;
- per person;
- hand luggage;
- checked luggage;
- work equipment;
- children;
- baby.

Items can be assigned to a bag or person.

### 16.3 Daily Rhythm

Support:

- rest periods;
- afternoon naps;
- work blocks;
- quiet travel days;
- short activities;
- family time.

Atlas uses this context when making realistic suggestions.

---

## 17. Budget

The budget overview should remain visual and simple.

Display:

- total planned;
- total booked;
- total spent;
- remaining budget;
- difference by category;
- difference by location.

Categories:

- transport;
- accommodation;
- food;
- activities;
- visas and administration;
- work;
- other.

Use calm progress bars and avoid heavy charts.

---

## 18. Agency and Group Travel

### 18.1 Personal Mode

Personal mode focuses on creating and managing the user's own journeys. Sharing uses simple invitations and audience choices rather than exposing a role matrix. Advanced agency terminology must not appear during normal personal onboarding.

### 18.2 Agency Console

The agency desktop console supports:

- journey portfolio and operational status;
- creating journeys for unregistered or registered travellers;
- organiser and journey-leader assignment;
- traveller invitation state;
- travel-party composition;
- shared itinerary and private overlays;
- add-on and booking fulfilment;
- roles, permissions and audit review.

### 18.3 Roles & Permissions

The access module uses a permission matrix grouped by domain. It must show:

- built-in templates and custom roles;
- assignment scope and expiry;
- the number of affected users;
- warnings for high-risk combinations;
- an impact preview before broadening permissions;
- an effective-access inspector that explains why access is allowed or denied;
- emergency revocation.

Never reduce access configuration to an unexplained list of technical permission keys. Use clear descriptions while keeping stable keys available in detail and audit views.

### 18.4 Travel Parties and Audiences

A travel party is displayed as a privacy boundary, not only as a grouping chip. Every scoped editor shows its audience:

- Agency only;
- Entire journey;
- This travel party;
- Only this traveller;
- Specific people.

Party colours or initials may aid orientation, but access is never communicated through colour alone. A traveller may belong to multiple parties. Before adding, removing or replacing a membership, the UI previews newly visible data, revoked data and offline-device effects; it never implies that shared travellers merge party access.

Journey leaders see only operationally relevant party information. Families and other parties never see another party's names, documents, private context, add-ons or notifications unless those items are deliberately journey-shared.

---

## 19. Offline-First

Offline status is visible in the interface.

Example status:

> Chiang Mai is ready offline

Available offline:

- journeys, maps and timelines;
- bookings and practical information;
- documents stored on this device;
- tasks, budgets and notes;
- emergency information and contact details;
- pending commands.

When connectivity is limited:

> Offline mode — changes will sync later

Use a calm information bar, not an alarming error message. Pending changes should expose a compact state such as `pending`, `syncing`, `conflict` or `failed`. Conflicts need a clear resolution path; failed optimistic changes must be reverted or visibly reconciled.

---

## 20. Design Tokens

```css
:root {
  --color-bg: #F8FBFC;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF3F5;
  --color-mint-soft: #E8F5F1;

  --color-text-primary: #142536;
  --color-text-secondary: #526273;
  --color-text-muted: #7D8A96;

  --color-primary: #14866D;
  --color-primary-teal: #1599A8;
  --color-atlas: #3A8FD8;
  --color-atlas-soft: #DFF3FA;

  --color-success: #2DAA76;
  --color-warning: #F2B84B;
  --color-action: #F26F4C;
  --color-error: #D94B4B;

  --border-subtle: #E4EBEE;

  --radius-card-lg: 20px;
  --radius-card: 16px;
  --radius-button: 14px;
  --radius-chip: 999px;

  --shadow-card: 0 8px 24px rgba(20, 37, 54, 0.08);
  --shadow-small: 0 3px 12px rgba(20, 37, 54, 0.06);
}
```

---

## 21. Component Rules

### 21.1 Buttons

#### Primary
- background: Trax Emerald;
- text: white;
- radius: 14 px;
- minimum height: 48 px.

#### Secondary
- background: Soft Mint or white;
- text: Trax Emerald;
- subtle border.

#### Destructive
- background: Error Red;
- use only for deletion or irreversible actions.

### 21.2 Chips

Use chips for:

- status;
- filters;
- attributes;
- number of nights;
- offline status.

Chips are compact and should not look like large buttons.

### 21.3 Cards

Cards should preferably contain:

- a clear title;
- no more than one primary action;
- limited metadata;
- a calm background;
- sufficient vertical space.

Avoid too many nested cards.

### 21.4 Lists

List rows contain:

- an icon or status dot;
- a title;
- supporting text;
- optional metadata on the right;
- a chevron when the row opens a detail view.

### 21.5 Application States

Every route defines loading, empty, permission-limited, validation, network/provider unavailable, stale, optimistic rollback, version conflict, sync conflict, deleted/not-found and online-required states as applicable. Expected domain errors use specific recovery actions rather than one generic failure surface.

---

## 22. Accessibility

Minimum requirements:

- contrast compliant with WCAG AA;
- touch targets of at least 44 × 44 px;
- text no smaller than 12 px;
- do not communicate status through colour alone;
- full dark-mode support;
- clear focus styles;
- scalable typography;
- icons with labels or accessible names.

---

## 23. Dark Mode

Dark mode uses:

- deep blue-grey instead of black;
- lighter teal and blue accents;
- cards with subtle elevation;
- no harsh white text;
- limited colour saturation.

Example:

```css
[data-theme="dark"] {
  --color-bg: #0F1922;
  --color-surface: #16232D;
  --color-surface-muted: #1D2C37;
  --color-text-primary: #F3F7F9;
  --color-text-secondary: #B8C4CB;
  --color-text-muted: #87959E;
  --border-subtle: #293A46;
}
```

---

## 24. Initial Screens to Design

The first design phase consists of:

1. Personal create-journey flow and simple companion sharing;
2. desktop and large-tablet planning cockpit with navigation, map, timeline and detail/Atlas panel;
3. Agency journey portfolio and create-for-others flow;
4. Roles & Permissions matrix, assignment and effective-access inspector;
5. travel-party composition and privacy-audience preview;
6. desktop journey construction and stop reordering;
7. detailed change-set preview, activity log and undo;
8. device-only document assignment and transfer status;
9. mobile Home while travelling;
10. mobile Journey with map and compact timeline;
11. mobile location and Today views;
12. mobile offline queue and conflict state;
13. Atlas action and approval surfaces;
14. Documents, family packing list and budget overview.

The desktop cockpit establishes the management model; mobile Home, Journey and Location establish the companion model. Both use the same components, commands and design tokens.

---

## 25. Summary

The refreshed Trax OS brand identity is:

- fresher than the previous sand-coloured direction;
- light, cool and airy;
- based on white, mint, emerald, teal and sky blue;
- cartographic without becoming technical;
- premium without feeling distant;
- suitable for mobile use while travelling;
- recognisable through routes, topography and Journey elements;
- designed for individuals, families, group travellers and travel organisations;
- adaptable between a simple Personal experience and an advanced Agency console;
- privacy-aware through visible audiences and travel-party boundaries;
- offline-first and contextually supported by Atlas.

Trax OS should feel like a calm and intelligent travel operating system that always shows where you are, what matters now and what comes next.
