# UrbanOS: Design data sources for Study Area import (Pune)

Researched 2026-11-15 (IST). This is research only, with no code changes. Every claim links to a page that was fetched. **[UNVERIFIED]** marks anything that only came from a search snippet or could not be confirmed.

---

## 1. OpenStreetMap (current source)

### 1.1 ODbL obligations for a derived app

| Obligation | What it means for UrbanOS | Source |
|---|---|---|
| Attribution | Show "© OpenStreetMap contributors" wherever OSM-derived data is displayed, such as a map corner or the Design canvas, and link to openstreetmap.org/copyright. | https://www.openstreetmap.org/copyright |
| Licence notice | Make clear the data is under ODbL. If you distribute OSM *as data* (for example GeoJSON exports or downloadable study-area packs), name the licence and link to it directly. | https://www.openstreetmap.org/copyright |
| Share-alike | "If you alter or build upon our data, you may distribute the result only under the same license." This applies to **Derivative Databases**, such as OSM roads merged with our own lane or signal edits and then published. | https://www.openstreetmap.org/copyright |
| Produced Work vs database | Rendered outputs (PNG, JPG, PDF, SVG, raster images, print) are usually Produced Works and can carry any licence. Output meant for data extraction is a database. Even for a Produced Work, the underlying derivative database must still be offered under ODbL (§4.6). | https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline |
| Attribution style guidance | Requirements differ by medium (browsable map, print, static image). | https://osmfoundation.org/wiki/Licence/Attribution_Guidelines (linked from copyright page; not fetched separately) |

**What this means for UrbanOS:**
- Internal use with no distribution needs no share-alike.
- In-app map views need on-screen attribution.
- Any user-facing "export study area as GeoJSON/CSV" that contains OSM-derived geometry must be offered under ODbL, along with any edits merged into it.
- Keep user-authored "proposed" geometry in a separate layer. It then stays a separate work and is not part of the derivative database.

### 1.2 Overpass API: public instance policy

| Item | Value | Source |
|---|---|---|
| Safe-use guideline (main instance, overpass-api.de) | Under 10,000 queries/day **and** under 1 GB/day download | https://dev.overpass-api.de/overpass-doc/en/preface/commons.html |
| Stricter rule for regular or automated use (wiki, FOSSGIS row) | "If you set something up that uses the Overpass API regularly… divide those numbers by 100": under 100 queries and under 10 MB/day. **For an app, usage counts as the sum of all its users' requests.** | https://wiki.openstreetmap.org/wiki/Overpass_API |
| App backends | Listed as problematic: "Setting up an app for more than just OSM mappers and relying on the public instances as backend". Commercial use should go to self-hosted or paid instances. | commons.html above; wiki above |
| Default timeout / memory | 180 s and 512 MiB unless overridden with `[timeout:]` / `[maxsize:]`. Larger requests get deprioritised and fail with HTTP 504. | commons.html |
| Rate limiting | Per-IP slots plus cool-down. A request waits up to 15 s, then gets HTTP 429. After a 429 or 406, pause 30 s. Send a `User-Agent`/`Referer` that identifies the app. Do not run parallel scripts. | commons.html; wiki |
| Max area | **No fixed area cap is documented.** The limits are runtime and memory (timeout and maxsize). For country-scale pulls the docs recommend extracts or planet files instead. | wiki "Limitations" |
| Reliability | Wiki: "Nowadays this server is overloaded… do not expect high reliability. Use alternatives if possible." | wiki |

**Alternative instances (per the wiki table, fetched 2026-11-15):**

| Instance | Endpoint | Policy |
|---|---|---|
| Private.coffee (formerly **overpass.kumi.systems**) | `https://overpass.private.coffee/api/interpreter` | "no rate limit in place". Notify them in advance for large-scale projects. |
| VK Maps (mail.ru) | `https://maps.mail.ru/osm/tools/overpass/api/interpreter` | "currently no requests limitations" |
| NextGIS | key required | free key, no limits stated |
| Geofabrik, Overspan, Mapsource, Tracestrack | key required | paid |
| Overpass.ch | key required | free tier of 10k req/month and 30 req/min |
| Self-host | AGPL v3 software | Recommended for app backends; can be seeded from the Geofabrik India or western-zone PBF |

Source: https://wiki.openstreetmap.org/wiki/Overpass_API

**What this means for UrbanOS:** live Overpass calls per Study Area import from many users would breach the public instance's guidance. The **local Geofabrik index should be the primary source**. Use Overpass only as a fallback and for freshness checks, with caching and a UA header. For a hosted fallback, use a mirror (Private.coffee) or self-host.

### 1.3 Geofabrik extracts

| File | Size | Update cadence | Source |
|---|---|---|---|
| `asia/india/western-zone-latest.osm.pbf` | 211 MB (222,246,769 B on 2026-11-14) | **Daily.** Dated daily files run 261108 to 261114; "latest" contains data up to 2026-11-15 02:50 IST. | https://download.geofabrik.de/asia/india/western-zone.html |
| western-zone `.shp.zip` / `.gpkg.zip` | 483 MB / 497 MB | daily | same |
| western-zone Shortbread `.mbtiles` (experimental vector tiles) | n/a | n/a | same |
| `.osc.gz` daily diffs | n/a | daily | same, used for incremental updates |
| `asia/india-latest.osm.pbf` | 1.6 GB | daily | https://download.geofabrik.de/asia/india.html |
| Growth (western zone PBF) | 150 MB (Jan 2022) → 203 MB (Jan 2026) → 222 MB (Nov 2026) | n/a | western-zone.html raw index |

Public extracts strip usernames, user IDs and changeset IDs. Licence: ODbL 1.0.

### 1.4 OSM completeness in Pune: ohsome API counts (queried live)

Bbox `73.75,18.45,73.98,18.62`. The ohsome snapshot timestamp is **2026-07-27T09:00Z**, its latest available, so it is about 3.5 months older than Geofabrik. Endpoint: `https://api.ohsome.org/v1/elements/count?bboxes=…&filter=…`.

| Filter | Count | Coverage |
|---|---|---|
| `highway=traffic_signals and type:node` | **482** nodes | n/a |
| `highway=* and type:way` (all road ways) | **59,783** ways | denominator |
| `highway=* and lanes=* and type:way` | **2,553** ways | **4.3 %** of all highway ways |
| `highway=* and maxspeed=* and type:way` | **1,116** ways | **1.9 %** |
| `highway in (motorway,trunk,primary,secondary,tertiary)` ways | **5,002** | major-road denominator |
| major roads with `lanes=*` | **2,059** | **41.2 %** of major-road ways |
| major roads with `maxspeed=*` | **827** | **16.5 %** |
| `building=* and geometry:polygon` | **199,867** polygons | n/a |
| `railway in (subway,light_rail,rail)` length | **225.6 km** of ways | n/a |
| `railway=subway` length | **78.2 km** of ways | counts both tracks / directions separately [interpretation] |
| `railway=station` count | query failed twice (upstream error) | **not established** |

Caveats:
- Percentages are by **way count, not road length**. Short ways skew them. A length-weighted query (`/elements/length` with the same filters) is the better next metric.
- 482 signal nodes is a *node* count. A single junction is often mapped with 2 to 4 signal nodes, so this is **not** a junction count. PMC publishes a "Traffic Lights Pune" dataset on data.gov.in with fields `No_of_traffic_lights` and `No_of_Intersections` (https://www.data.gov.in/resource/traffic-lights-pune, metadata from a search snippet; the page body did not render). Its values were **not** retrieved, so the OSM-vs-official comparison is **[UNVERIFIED]**.
- Pune Metro Line 3 (Pink, Maan to District Court) is listed by Wikipedia as opening 3 Nov 2026 (https://en.wikipedia.org/wiki/Pune_Metro, search snippet **[UNVERIFIED]**). That is after the ohsome snapshot, so the counts above may not include it. Geofabrik "latest" might.
- Published studies of Pune OSM completeness: none found in this pass **[gap]**. Geofabrik taginfo for the region, https://taginfo.geofabrik.de/asia:india:western-zone/ (not fetched), is the next place to check tag stats.

**Takeaway:** road geometry and buildings are dense. `lanes` exists on roughly 40 % of major-road ways. `maxspeed` is sparse (under 20 % major, about 2 % overall). Signals cover only part of the network. Lanes, speeds and signal timing must be filled with defaults and labelled as estimates.

---

## 2. Other sources for Pune

| Source | Content | Licence | Coverage / currency | Format & access | Limits | Usable in app? | Source URL |
|---|---|---|---|---|---|---|---|
| **Overture Maps: Transportation** | Road segments and connectors, with GERS IDs | **ODbL** (from OSM + TomTom) | Global, monthly-ish releases (e.g. `2026-10-21.0`) | GeoParquet on S3 (`s3://overturemaps-us-west-2/release/…`), `overturemaps` Python CLI with `--bbox`, DuckDB, STAC catalog, PMTiles | No API quota, since it is static cloud files | **Yes**, with the same ODbL duties as OSM. Attribution: "© OpenStreetMap contributors, Overture Maps Foundation". Mostly OSM-derived for India, so little gain over OSM for roads [inference]. | https://docs.overturemaps.org/attribution/ ; https://docs.overturemaps.org/getting-data/ |
| **Overture Maps: Buildings** | Footprints conflated from OSM, Esri Community Maps, Microsoft ML, Google Open Buildings | **ODbL** (theme licence) | Global | Same as above | n/a | **Yes** (ODbL). Best one-stop building fill. | https://docs.overturemaps.org/attribution/ |
| **Overture Places** | POIs | CDLA-Permissive 2.0 / Apache / CC0 per source | Global | Same | n/a | Yes (permissive) | same |
| **Microsoft Global ML Building Footprints** | ML footprints, partly with heights | Repo states **CDLA-Permissive 2.0**. Overture's page describes it as ODbL. **The two conflict; use the repo's own statement.** | 1.4B buildings; India received about 110M edits (2024-03) and 24M (2023-10); imagery 2014 to 2024; last refresh 2026-08-13 | Line-delimited GeoJSON in `.csv.gz` by quadkey, via `dataset-links.csv`; Planetary Computer | none stated | **Yes**. Permissive, attribution recommended. Height is -1 where not estimated; India height coverage **[UNVERIFIED]**. | https://github.com/microsoft/GlobalMLBuildingFootprints |
| **Google Open Buildings v3** | Footprints with a confidence score (no type, no height) | **CC BY 4.0 or ODbL**, user's choice | India covered; inference May 2023 | CSV per S2 L4 cell (up to 7.8 GB), Colab region download, Earth Engine asset | none stated | **Yes** (CC BY). Filter at the 90 %-precision threshold CSV. Data dates from 2023. A 2.5D "Temporal" dataset also exists (not reviewed). | https://sites.research.google/gr/open-buildings/ |
| **PMC Open Data Portal** | 238 datasets, mostly PDF/XLS stats | Portal policy; licence per dataset not reviewed **[UNVERIFIED]** | PMC area; some published Dec 2025 | Download; login historically required | n/a | Check each dataset | https://opendata.pmc.gov.in/datasets |
| **OpenCity: Pune Road Centerline Map** | PMC road centerlines | "Other (Public Domain)" per OpenCity | PMC area; uploaded Nov 2025, source vintage unknown | KMZ, 3.7 MiB | n/a | **Likely yes**, but the PD label is OpenCity's; confirm with the PMC source. No lanes/speeds known. Good for a **validation** layer against OSM. | https://data.opencity.in/dataset/pune-road-centerline-map (search snippet) |
| **OpenCity: Pune Bus Stops & Routes** | PMPML stops (KML), depots (KML), routes list (CSV: id, description, km) | Public Domain (OpenCity) | Updated Nov 2025 | KML/CSV via CKAN API | n/a | Yes (stops). Routes are a list without geometry. | https://data.opencity.in/dataset/pune-bus-stops-and-routes (search snippet) |
| **OpenCity: other PMC layers** | Stormwater drains, sewage network (KMZ), ward boundaries (GeoJSON), tree census (~4M trees), streetlights (ward counts) | Public Domain (OpenCity) | Various | KMZ/KML/GeoJSON/CSV | n/a | Yes, for infrastructure overlays | https://data.opencity.in/organization/pune-municipal-corporation (search snippet) |
| **data.gov.in / Smart Cities portal** | Pune traffic lights and intersections (counts by year), street lights | **Government Open Data License – India** (stated on the smartcities.data.gov.in footer) | Annual tables; aggregates, **not geometry** | XLS/JSON/XML; API "Request API" (key-based) | API key and quota **[UNVERIFIED]** | Yes, as **city-level calibration numbers** only | https://smartcities.data.gov.in/catalog/street-lights-pune ; https://www.data.gov.in/resource/traffic-lights-pune |
| **Bhuvan (NRSC/ISRO)** | Thematic WMS (LULC, admin, roads), imagery | Bhuvan ToS: no copying, derivative works or redistribution without written authorisation. Thematic services allow single-user internal use and value-added products, but other terms exclude Internet hosting. | All-India | OGC WMS/WMTS | n/a | **Internal reference only.** Do not ingest or redistribute in the app without NRSC permission. | https://bhuvan.nrsc.gov.in/terms.php (search snippet); https://www.nrsc.gov.in/nrscnew/termsConditions.php (snippet: non-commercial with attribution) |
| **PMPML GTFS (community)** | 315 routes (compat feed valid 2026-10-07 to 2027-04-05) | Repo licence MIT-0 covers the **code**. Data comes from the PMPML/Chartr app API; **data licence unclear [UNVERIFIED]**. | Pune and PCMC | GTFS zip in the GitHub repo | n/a | **Internal or prototype only** until the data licence is clarified. Earlier official PMC-portal GTFS dates from 2019. | https://github.com/croyla/pmpml-gtfs ; https://sites.gtfs.zone/countries/in/ (snippets) |
| **Pune Metro (Maha-Metro)** | Official station lists and alignment lengths (L1 17.4 km, 14 stn; L2 15.7 km, 16 stn; extensions 1A/1B) | Website content; **no open GTFS or geodata found** | Lines 1 and 2; Line 3 (Pink, PPP) separate | HTML / PDF maps | n/a | Use **OSM** geometry (route relations exist: OSM wiki relation 13994916). Use the official page only to validate station names and status. | https://www.punemetrorail.org/project-profile (snippet); https://wiki.openstreetmap.org/wiki/Pune_Metro (snippet) |
| **Mendeley: Pune heterogeneous traffic counts (Jan 2023)** | Class-wise counts at 3 signalised intersections | Not checked | 3 junctions | Dataset download | n/a | Possible calibration input **[UNVERIFIED licence]** | https://data.mendeley.com/datasets/xnf2k6n288/1 (snippet) |

---

## 3. Recommendation: what to wire into Study Area import

### Priority order

| # | Source | Layers | Why |
|---|---|---|---|
| **P0 (keep)** | **Geofabrik western-zone PBF → local index**, refreshed daily or weekly via `.osc.gz` diffs | Roads, junctions (derived from way topology), `traffic_signals`, rail/metro, buildings, amenities | Daily, complete for geometry, no quota, ODbL handled with one attribution |
| **P1** | **Overpass via mirror or self-host**, not overpass-api.de | Freshness fallback for a single study area; cache it | The public main instance's guidance rules out an app backend |
| **P2** | **Building gap-fill: Overture Buildings (ODbL)** *or* **Google Open Buildings (CC BY, ≥90 %-precision threshold)** | Footprints where OSM has none | OSM already has about 200k polygons in the bbox, so fill gaps by spatial difference |
| **P3** | **OpenCity PMC road centerline (KMZ)** | QA layer: flag OSM roads missing from the PMC data and vice versa | Public domain; validates OSM, does not replace it |
| **P4** | **OpenCity PMPML stops (KML)** plus OSM bus stops | Transit stops | Public domain |
| **P5** | **data.gov.in signal and intersection counts** | Calibration only (OSM signal coverage vs official count) | Aggregates, GODL |
| Hold | PMPML community GTFS, Mendeley counts | Internal modelling only | Licence unclear |
| Do not ingest | Bhuvan | Visual reference at most, internally | Restrictive ToS |

### Must be labelled "estimated" or "hypothetical" in the UI

| Attribute | Reason |
|---|---|
| `lanes` where the OSM tag is missing (about 59 % of major-road ways, about 96 % of all ways) | Default by highway class |
| `maxspeed` where missing (about 83 % major, about 98 % overall) | Default by class or IRC norms |
| Signal presence at junctions without `highway=traffic_signals`; **all signal timing and phasing** | No open timing data found |
| Junction type and geometry derived from way topology | Algorithmic |
| ML building footprints (Google/Microsoft/Overture-ML) and any building height | Model output, with imagery dated 2014 to 2024 |
| Traffic volumes, speeds, capacity | No open per-link source found |
| Metro Line 3 and under-construction lines, unless present in the OSM data | Opened or opening after the ohsome snapshot |
| All user-drawn proposals | Hypothetical by definition, and stored as a separate layer so they stay outside the ODbL derivative database |

### Compliance checklist
1. Show "© OpenStreetMap contributors" (plus "Overture Maps Foundation" if used) with a link to /copyright on every map view.
2. Exports containing OSM- or Overture-derived data are ODbL. Ship a licence note and keep user proposals separate.
3. Credit Google Open Buildings (CC BY 4.0) and Microsoft (CDLA-P 2.0) when used.
4. Send an identifying User-Agent to every Overpass call and back off 30 s on a 429.

## Open gaps
- Length-weighted ohsome coverage for lanes and maxspeed, and `railway=station` count: not run (station query failed).
- Official PMC count of signalised intersections: not retrieved.
- data.gov.in API quota and key terms: not verified.
- PMPML GTFS data licence and any official Maha-Metro GTFS: not found.
