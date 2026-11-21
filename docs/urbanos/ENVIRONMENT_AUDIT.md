# Environment workspace audit (2026-11-21)

Headless end-user audit of the Environment workspace on branch `env-refine` (base `9e56ccc`), done the way a first-time
planner would use it: open Environment at Swargate / Karve Road, try every control, layer, panel and chart.
User guide: [ENVIRONMENT_WORKSPACE.md](ENVIRONMENT_WORKSPACE.md). Data wiring: [ENVIRONMENT_DATA.md](ENVIRONMENT_DATA.md).

## How it was tested

- **Build under test:** production `vite build` of this worktree, served statically on :4583; FastAPI backend on :8383 on a
  **copy** of `backend/twincity.db` (`/workspace/work/env-e2e/db/`; the original was never touched), real derived datasets
  in `URBANOS_DATA_DIR`, local OSM index.
- **Browser:** headless Chromium (SwiftShader WebGL, 1440 × 900), Playwright, **real clicks** on the panel buttons, selects
  and the map. External imagery tiles are fetched by the harness, not by Chromium.
- **Place:** camera over Swargate (73.8567 E, 18.5010 N, 2.5 km up); proposal used: road `r1` "Pune Central Boulevard"
  (2 vertices, 19 m wide, 1.06 km) from the project list.
- **Timings are HEADLESS** (SwiftShader on a shared 2-CPU box): click-to-"Shown" wall time. They compare states on this
  machine; they are not what a user sees in a real browser.
- Screenshots: `/workspace/work/urbanos/shots/environment/env-base-*.png` (before) and `env-*.png` (after), outside the repo.

Verdicts: **works** · **broken** (does not do what it says) · **misleading** (does something, but a planner would draw the
wrong conclusion) · **missing** (expected, absent).

## Baseline findings (before any fix)

### First impression and guidance
| Item | Verdict | Root cause |
|---|---|---|
| What to do first | **missing** | The panel opens on "Constraint screening — select a road…", an empty Emissions card and a 30-row data catalogue. No statement of what the workspace is for or a first step (Underground has a 3-step get-started card). |
| Catalogue readability | **misleading** | Every row prints source, date and the full licence text inline (4–6 lines each); 16 available + 14 unavailable rows are interleaved per group, so the useful layers are buried (e.g. land cover is ~row 20). |
| Unavailable data (noise, heat, geology, seismic, groundwater, drainage, flood) | works / cluttered | Honest "Not imported · UNKNOWN", but each takes a full card inside the main list; groups like "Noise 0/1 available" read as a feature. |
| Population exposure | **missing** | Not in any catalogue (`wired=0` in the registry); no "not available" row at all. |
| Developer text in the UI | **misleading** | OSM rows' source reads "OpenStreetMap via local file (feasibility:water); status computed on read"; the footer cites `GET /api/...` routes; land-cover areas print the internal file name. |

### Layers (all at Swargate, headless click → Shown)
| Layer | Draw | Legend / units | Evidence class shown | Verdict | Notes |
|---|---|---|---|---|---|
| Land cover (ESA WorldCover 2021) | 0.85 s | 8 classes, no units needed | "Derived" | works / **misleading** label | WorldCover is a machine-learning classification: the roadmap keeps it labelled *inferred*; "Derived" hides that. |
| NDVI (Sentinel-2) | 0.88 s | ramp −0.2…0.8 "index" | "Derived" | works | Scene-date selector 2025-11-14 / 2019-11-26 is the only time control. |
| MNDWI (Sentinel-2) | 0.87 s | ramp −0.6…0.6 "index" | "Derived" | works | — |
| JRC surface-water occurrence | 0.85 s | ramp 1…100 % | "Derived" | works | Classifier output, should read *inferred*. |
| SoilGrids (6 properties) | 0.87 s | per-property ramp with unit | "Estimated" | works | ML prediction at 250 m: *inferred*. |
| Derived catchments | 2.4 s | 6 catchments with km² | "Derived" | works | Modelled from a DSM. |
| Derived flow paths (D8) | 0.92 s | 1 line item | "Derived" | works / **misleading** | Nothing says these are computed from a surface model, not mapped drains, until "Limitations" is opened. |
| Tree census 2019 | **13.8 s** (cold) | point / rare / cluster | "Observed" | works, slow first time | First query reads the 436 MB index from a cold disk; later queries 35–110 ms. 46,024 trees in view → 99 clusters. |
| Air-quality stations | 0.85 s | 2 items | "Observed" | works | 8 of 11 drawn, 3 with unknown coordinates listed. |
| Water (OSM) | **9.3 s** | swatch only | none | works, slow | Requests the **whole** OSM coverage box (73.55–74.20 E, 3.7 MB, 1,409 features) and builds polygon entities for all of them, whatever the view. |
| Heritage (OSM) | 1.4 s | swatch only | none | works | — |
| Railway (OSM) | 1.4 s | swatch only | none | works | — |
| Metro (engine layer) | 1.0 s | none | none | works | Toggles the city model's metro layer. |
| Slope | — | — | — | **missing** | Exists only in Explore → Terrain; not reachable from Environment. |
| Noise / heat / exposure | — | — | — | missing (honest) | No data (`wired=0`). |

### Panels, charts, exports
| Item | Verdict | Root cause / note |
|---|---|---|
| Land-cover class areas, current view | works (0.38 s) | 6.73 km² view: built-up 71.3 %, tree cover 24.5 %. Cleared when the camera moves (good). Method line shows an internal file name. |
| Land-cover areas, selected proposal footprint | works | Only land-cover classes; no tree count. |
| Trees / green area affected by a proposal | **missing** | `POST /api/env-data/trees/count` exists but nothing in the UI calls it. Roadmap theme 7's first indicator. |
| Emissions | **misleading** | Shows absolute corridor fuel/CO₂/NOx/PM per hour from a single run of a traffic model that fails validation. Roadmap theme 7: emissions only as **relative change** with a "model not validated" badge. The before/after comparison (`sim.comparison.result.emissions`) is never shown here. |
| Constraint screening of a selected proposal | works | Opens the existing FeasibilityPanel (6.1 s headless incl. site data). |
| Air-quality chart | works / **missing** parts | Daily or monthly mean, honest sample counts. No value readout on hover, no reference level to read the numbers against, no export. Station cannot be picked by clicking its marker. |
| Rainfall charts | works / **missing** parts | Annual bars have hover titles; no y-axis values, no export. "Not IDF curves" statement present. |
| Time sliders | **missing** (by design) | Only discrete choices exist (NDVI/MNDWI scene date, AQ daily/monthly, IMD cell). The data are two scenes and fixed summaries; a slider would imply a continuous time series that is not there. |
| Exports | **missing** | No CSV/PNG export anywhere in Environment. |
| Hover tooltips on the map | **missing** | Underground has them; Environment overlays (trees, stations, flow paths, OSM features) show nothing on hover. |
| Layers after leaving Environment | **misleading** | Rasters and trees stay draped over Design / Underground / Simulate (nothing hides them), e.g. a red built-up drape under a road being drawn. |
| Camera outside a layer | works | "The camera view does not overlap this layer (Pune study area)." |
| Raw file paths | works (mostly) | Rows use `displayPath`; the backend still returns `data_dir` (absolute path) in `/api/env-data/catalogue` and a "missing" reason with the absolute file path. Not shown on this machine (all files present) but would be on a fresh clone. |
| Console / network | works | 0 console errors, 0 HTTP ≥ 400 during the baseline audit. |

## Fixes and commits

All on branch `env-refine` (not pushed).

| Commit | Fix | Audit items closed |
|---|---|---|
| `a927fa3` | This audit (baseline) | — |
| `6734ef1` | Backend: a missing dataset file is named relative to the data folder; `data_dir` is "configured" / "not found" instead of the absolute server path (pytest) | raw paths |
| `e8b4597` | Planner-first panel: get-started card with **Show the essentials**; "What would a proposal touch?" (census trees + WorldCover green area in the footprint and with a 10 m margin, CSV); layers grouped by planner question with a **Measured / Modelled / Inferred** chip and a short source · date · licence line (full text under details); slope row (shared with Explore); one-line "what it shows"; legends with units; records with chart readouts, NAAQS 24-h reference line and CSV export; **emissions as relative change only** with "Model-based · not validated"; "Not available yet" list incl. population exposure; hover tooltips + click a monitor to open its readings; OSM overlays fetched for the view; Environment layers hidden in other workspaces | guidance, readability, evidence labels, developer text, slope, exposure, trees/green indicator, emissions, exports, tooltips, layers left on, water performance |
| `c72ff65` | Footprints buffered in metres on the server (`POST /api/env-data/footprint`) — browser vertex offsetting twisted the polygon at doubled-back snapped vertices (145 vs 156 trees on a 517 m road); plain "not available" reasons (no doc paths, no internal refs) with suggested sources; 16 unit tests | indicator accuracy, developer text |
| `6358cba` | Footprint outline drawn through buildings (depth-fail material); smaller, dark-outlined tree clusters | outline hidden under clusters / buildings |
| `5acd9e5` | Tooltip flips away from the side panels; air chart dates read from the series' IST stamps (was "2024-11-05 IS" / "Mon 2024-0"); "the data server did not answer" instead of "Failed to fetch" / "backend unreachable" | tooltip clipped, chart readout, error wording |

## After the fixes (headless, same harness)

### Workflows (real clicks)
| Workflow | Result | Screenshot |
|---|---|---|
| A. First look at Swargate: get-started card → **Show the essentials** → 4 layers shown with legends and units | Pass — 0.49–0.78 s for all four (warm) | env-01-entry-get-started, env-02-essentials-swargate |
| B. Proposal "Pune Central Boulevard" (r1, 19 m × 1,056 m) from "Your projects" → **Count trees & green area** → outline on map → CSV | Pass — 0.81 s; 118 trees (203 with margin), 0 rare, green 5,700 m² (10,000), tree cover 5,200 m² (9,500) | env-03-proposal-trees-green-area |
| C. New road drawn in **Design** at Karve Road (2 clicks + double-click, snapped, 517 m × 10 m) → Environment → count | Pass — 1.81 s; 54 trees (156), 1 rare in margin, green 2,300 m² (7,300) | env-a09-new-road-impact (earlier build) |
| D. Hover a census tree / cluster / flow path / monitor / footprint | Pass — e.g. "Tree · PMC census 2019 · Indian Tulip Tree · Thespesia populnea · girth 41 cm …"; tooltip stays over the map | env-04-hover-tree |
| E. Click the Karve Road monitor on the map → Records open on that station → point at the chart | Pass — "2025-01-21 IST: 45.1 µg/m³", dashed NAAQS line 60 µg/m³ (daily only; none for monthly) | env-09-station-click-air-readout |
| F. Air CSV (NO₂ daily, 491 days + header, sample counts) and rainfall CSV (annual totals with stored QA flags); point at a rainfall bar | Pass — "2005: 6,765.6 mm · flagged suspect (value as stored)" | env-05-rainfall-readout |
| G. Water (OSM) and slope | Pass — water 53 features for the view in 1.6 s (was 1,409 for the whole box in 9.3 s), redrawn after a pan (32); slope legend in degrees | env-a06-water-slope |
| H. Not available yet | Pass — 10 items incl. population exposure; no doc paths | env-a07-not-available |
| I. Data server stopped → Reload → "not answering … UNKNOWN" card; NDVI toggle and count say the server did not answer → server restarted → **Try again** restores 14 layer rows | Pass | env-06-backend-down |
| J. Emissions | Empty state verified with real state. The relative-change card was verified with a **programmatically injected comparison (synthetic values)**: −4.0 % fuel, −4.2 % CO₂, +2.4 % NOx, −1.3 % PM, 3/3 seeds, both badges. A real Simulate before/after run was **not** executed in this QA. | env-08-emissions-relative-synthetic |

### Indicator check against an independent GIS calculation
Script `/workspace/work/env-e2e/gischeck.py` (outside the repo): shapely metric buffer in EPSG:32643 (flat ends, mitre
limit 3), trees by point-in-polygon over the raw `trees` table (no R*Tree, no API code), WorldCover pixels by
`rasterio.features.geometry_mask` (pixel centre rule).

| Site | Trees footprint / margin | Rare | Green m² footprint / margin | Tree cover m² |
|---|---|---|---|---|
| r1 Pune Central Boulevard — UI | 118 / 203 | 0 / 0 | 5,700 / 10,000 | 5,200 / 9,500 |
| r1 — independent | 118 / 203 | 0 / 0 | 5,700 / 10,000 | 5,200 / 9,500 |
| s42t new road, Karve Rd — UI | 54 / 156 | 0 / 1 | 2,300 / 7,300 | 2,300 / 7,300 |
| s42t — independent | 54 / 156 | 0 / 1 | 2,400 / 7,300 | 2,400 / 7,300 |

Trees: exact on both sites. Green area: exact on 3 of 4 polygons; one boundary pixel (100 m²) differs on the 10 m-wide
footprint (pixel-centre-on-edge rule differs between shapely and GDAL rasterisation). Before `c72ff65` the same road gave
53 / 145 trees (browser-side footprint).

### Console, errors, timings
- **Console errors:** 0 unexpected. 8 × `ERR_CONNECTION_REFUSED` only while the server was stopped on purpose (I).
  **HTTP 5xx: 0** (browser and backend log). HTTP 4xx: 0.
- **WebGL warnings:** twice, 12–22 × "bindTexture: attempt to use a deleted object" appeared during a hover right after
  zooming from 1.5 km to 400 m with the essentials and a footprint shown. Not reproduced in four targeted attempts
  (programmatic pick / drill-pick after the same zooms and redraws). Warnings only; nothing visibly wrong. **Open.**
- **Timings (HEADLESS — SwiftShader on a shared 2-CPU box; not real-browser figures):**
  - Panel ready after clicking Environment: 1.8 s. Essentials (4 layers): 0.5–0.8 s warm.
  - Tree census, first query after a server start: 13.8 s (cold read of the 436 MB index; later 35–110 ms API).
  - Water (OSM): 9.3 s → 1.6 s. Count trees & green area: 0.8–1.8 s. Land-cover areas for the view: 0.4 s.
  - Hover pick: first pick after load or a big redraw 2.8–9.9 s (pick shaders), then 34–170 ms.
  - `viewer.render()` with the essentials on: median 5.4 ms (p95 524 ms while tiles load), 141 data-source entities,
    2 env imagery layers; Underground afterwards median 18.1 ms.
- **Regression:** Underground after Environment — Environment layers hidden (imagery and 3 data sources `show=false`),
  get-started / legend / ground opacity 35 % / records (490 sewers, 117 storm drains) work (env-07). Design — road drawn
  with real clicks (18,274 → 18,275 roads) with Environment layers hidden. Simulate opens with its validation banner.
  Back in Environment the layers return. Explore's water toggle uses the same overlay code: **not re-tested in the browser**.
- The backend process died once without a traceback while vitest ran beside it (likely memory on the 8 GB box); restarted.

### Verdicts after the fixes
| Area | Verdict |
|---|---|
| Guidance | works — get-started card, one-line "what it shows" per layer |
| Labels (measured / modelled / inferred, source, date, licence) | works — every available layer; unit-tested |
| Legends with units | works — ramps carry units; categorical legends say what a class / dot / line is |
| Raw paths | works — none in UI, catalogue or "not available" text (tested) |
| Not-available states | works — UNKNOWN, never zero; exposure / noise / heat listed with what is needed |
| Proposal indicators | works — deterministic, matched an independent check |
| Emissions | works (relative only); real comparison not exercised in this QA |
| Tooltips | works |
| Exports | works — proposal CSV, air CSV, rainfall CSV |
| Time controls | decision: no slider (two scenes, fixed summaries); scene-date and daily/monthly selectors kept |
| Performance | improved — water 9.3 → 1.6 s; tree index cold start unchanged |
