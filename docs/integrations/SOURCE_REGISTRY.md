# Provider and Authoritative Source Registry

**Status:** V1 controlled baseline  
**Owner:** Trax OS security/product maintainers  
**Last architectural review:** 2026-08-01  
**Runtime rule:** Production activation requires a current terms, endpoint and ownership check even when this document marks the source approved in principle.

## 1. Governance

This is the human-review source of truth for provider and authoritative-domain policy. Runtime configuration must be generated from or validated against a versioned machine-readable registry with the same fields.

Every entry records:

```text
id
category
organisation
exact host or constrained host suffix
allowed path prefixes where needed
authority = official | intergovernmental | supplemental
purpose
status = candidate | approved | suspended | retired
attribution/licence/terms reference
last_verified_at
review_due_at
reviewer/change reference
```

Rules:

- HTTPS is mandatory.
- Exact hosts/path constraints are preferred; a top-level suffix alone is insufficient.
- Redirect targets are revalidated.
- A `.gov`, government-looking or NGO domain is not automatically trusted.
- Ownership, source category, terms, attribution and safe-fetch behaviour are reviewed before activation.
- Compromised, repurposed or terms-incompatible sources are suspended without an application release.
- Safety/health/entry facts preserve source URL, publication/observation/retrieval times and content hash where lawful.
- Agent summaries remain separate from fetched source facts.

## 2. Structured providers

| ID | Category | Selection | V1 use | Production condition |
|---|---|---|---|---|
| `places.photon_osm` | Places/geocoding | Photon-compatible API using OpenStreetMap data | Selected geocoder adapter | Self-hosted or contracted HTTPS endpoint; attribution and usage terms verified |
| `maps.osm` | Map data | OpenStreetMap | Selected base geographic data | Configurable terms-compliant tile service; required attribution |
| `weather.met_no_locationforecast` | Weather | `api.met.no/weatherapi/locationforecast/2.0` | Selected no-key weather adapter | Identifying User-Agent, attribution, caching/fair use and current terms verification |
| `weather.open_meteo` | Weather | `api.open-meteo.com` | Optional/self-hostable alternative | Hosted commercial use only under applicable current terms or contract |

Operational notes:

- Public Photon, Nominatim or OpenStreetMap tile endpoints are not assumed to support production autocomplete, bulk traffic or an SLA.
- Nominatim may be used for development/manual diagnostics under its usage policy, not as an unreviewed production fallback.
- Provider responses are snapshots with provenance/freshness, never owned journey truth.
- Cache keys and request precision must minimise personal-location disclosure.

## 3. Initial safety authorities

These are initial authority families. Runtime entries use exact hosts and, where indicated, constrained paths.

| ID | Organisation | Host/path family | Authority | Intended use |
|---|---|---|---|---|
| `safety.nl_worldwide` | Government of the Netherlands | `nederlandwereldwijd.nl` | Official | Dutch travel advice and consular information |
| `safety.uk_fcdo` | UK Government/FCDO | `gov.uk/foreign-travel-advice/` | Official | Country travel advice |
| `safety.us_state` | US Department of State | `travel.state.gov` | Official | Travel advisories and consular information |
| `safety.ca_travel` | Government of Canada | `travel.gc.ca` | Official | Travel advice and advisories |
| `safety.au_smartraveller` | Australian Government/DFAT | `smartraveller.gov.au` | Official | Destination travel advice |
| `safety.nz_safetravel` | New Zealand Government/MFAT | `safetravel.govt.nz` | Official | Destination travel advice |

Additional countries are added through the review workflow. “All government websites” means all **reviewed relevant official authorities**, not automatic trust for every government-controlled host.

## 4. Initial health authorities

| ID | Organisation | Host/path family | Authority | Intended use |
|---|---|---|---|---|
| `health.who` | World Health Organization | `who.int` | Intergovernmental | Global destination/public-health guidance |
| `health.ecdc` | European Centre for Disease Prevention and Control | `ecdc.europa.eu` | Official EU | European public-health/travel risk information |
| `health.nl_rivm` | Government of the Netherlands/RIVM | `rivm.nl` | Official | Dutch public-health guidance |
| `health.us_cdc` | US Centers for Disease Control and Prevention | `cdc.gov` | Official | Destination/travel health notices |
| `health.uk_nhs` | UK National Health Service | `nhs.uk` | Official | Public health and vaccination information |
| `health.uk_travelhealthpro` | UK travel-health service | `travelhealthpro.org.uk` | Official specialist | Destination travel-health guidance after ownership verification |
| `health.ca_public` | Government of Canada | constrained `canada.ca` health/travel paths | Official | Public-health and travel-health guidance |
| `health.au_public` | Australian Government Department of Health | `health.gov.au` | Official | Public-health guidance |
| `health.ifrc` | International Federation of Red Cross and Red Crescent Societies | `ifrc.org` | Supplemental | Humanitarian context; not official entry/medical determination |
| `health.msf` | Médecins Sans Frontières | `msf.org` | Supplemental | Humanitarian health context; not official entry/medical determination |

WHO is an intergovernmental authority, not an NGO. Supplemental NGO sources may provide context but cannot alone satisfy an official-source requirement or produce personal medical advice.

## 5. Initial entry and visa authorities

| ID | Organisation | Host/path family | Authority | Intended use |
|---|---|---|---|---|
| `entry.eu_portal` | European Union | `europa.eu` and `travel-europe.europa.eu` constrained travel/entry paths | Official | EU/Schengen entry information |
| `entry.uk` | UK Government | constrained `gov.uk` visa/immigration paths | Official | UK entry and visa information |
| `entry.us_state` | US Department of State | constrained `travel.state.gov` visa paths | Official | US visa information |
| `entry.ca_ircc` | Government of Canada/IRCC | constrained `canada.ca` immigration paths | Official | Canadian entry and visa information |
| `entry.au_home_affairs` | Australian Department of Home Affairs | `immi.homeaffairs.gov.au` | Official | Australian entry and visa information |
| `entry.nz_immigration` | Immigration New Zealand | `immigration.govt.nz` | Official | New Zealand entry and visa information |
| `entry.destination_authority` | Destination government/immigration ministry | Exact host added per country | Official | Destination-specific entry requirements |
| `entry.official_embassy` | Official embassy/consulate | Exact host manually verified | Official | Consular/visa procedure, subordinate to destination authority where conflicting |

No model summary is a legal determination. Users see nationality/residency/travel-document assumptions, source date and a link to verify the official rule.

## 6. Review and change process

1. Propose an entry with category, exact host/path, authority owner and use case.
2. Verify HTTPS ownership, redirects, content type, terms, attribution and rate/robot restrictions.
3. Security-review safe-fetch and prompt-injection exposure.
4. Product/legal-review whether the source is official, supplemental or unsuitable.
5. Approve through a reviewed change; publish the registry version.
6. Reverify at least every 180 days and immediately after ownership/terms incidents.
7. Suspend on failed verification; cached data becomes stale/unavailable, never “safe”.

Direct Booking.com, Tripadvisor and Expedia adapters remain deferred after V1. Public pages found by a user's browsing agent may be cited as uncertain discovery observations, subject to applicable terms, but do not become official provider integrations.
