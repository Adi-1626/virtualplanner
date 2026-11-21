# Environment workspace — user guide (2026-11-21)

The Environment workspace answers two questions for a site in Pune:

1. **What is on the ground here?** Green cover and trees, water and where rain would run, slope and soil, where air is
   measured, heritage places and railways.
2. **What would a proposal touch?** For a proposed road, flyover or double-deck: how many census trees and how much green
   area lie inside its footprint, and whether it meets water, heritage or rail.

It is **screening from available data**. It is not an environmental impact assessment, and it never says a proposal is
"acceptable" or "has no impact". Unknown stays UNKNOWN.

Audit of every control and the fixes: [ENVIRONMENT_AUDIT.md](ENVIRONMENT_AUDIT.md). Data wiring: [ENVIRONMENT_DATA.md](ENVIRONMENT_DATA.md).

## Getting started

Open **Environment** in the left rail. The panel opens with three steps:

1. Move the map to your site and press **Show the essentials for this view**. This turns on land cover, PMC census trees,
   computed flow paths and air-quality monitors together.
2. Select a proposed road, flyover or double-deck, on the map or in "Your projects", and press **Count trees & green area**.
3. Open **Air-quality and rainfall records** for context.

The card hides once a dataset layer is on; it comes back when they are all off.

## How to read a layer

Every layer row shows one line like this:

> **Land cover (2021)** — `Inferred` ESA WorldCover · 2021 · CC BY 4.0

| Part | Meaning |
|---|---|
| **Measured** (green) | Observed by a sensor, a survey or a mapper at a place and time: air monitors, the PMC tree census, IMD district gauges, Sentinel-2 indices, OpenStreetMap features. It can still be old, incomplete or have gaps. |
| **Modelled** (blue) | Computed from other data by a model or interpolation: flow paths and catchments from the terrain model, slope, IMD gridded and CHIRPS rainfall, traffic emissions. As good as its inputs. |
| **Inferred** (amber) | Classified or predicted by a machine-learning or statistical model: ESA WorldCover land cover, JRC surface-water history, SoilGrids soil. Plausible, not checked on the ground. |
| Source · date · licence | Who made it, when the data is from (not when it was downloaded), and the licence in short. Hover the chip for why it has that label. |

Press **Show** to draw a layer. While it is shown the row says in one sentence what it shows, gives its **legend with
units** (classes, %, index, degrees, or what one dot or line stands for) and says which area was drawn. **"Details,
limits & licence"** holds the full dataset name, the full licence, limitations and processing provenance.

"Absence on the map proves nothing" is printed under every drawn layer on purpose: OpenStreetMap, the 2019 census and
every satellite product miss things.

### The layers

| Group | Layer | What it is | Label |
|---|---|---|---|
| Green cover & trees | Land cover (2021) | What covers the ground in 10 m squares. Not land use or zoning. | Inferred |
| | Trees (PMC census 2019) | 4.0 million individual trees with species and girth. Zoomed out they show as clusters with counts; the row says "showing N of M as single trees" and to zoom in. | Measured (2019) |
| | Greenness (NDVI) | Vegetation on one satellite date; 2019 comparison scene available. | Measured |
| Water & drainage | Rivers, nallas & lakes (OSM) | Mapped water bodies and waterways (fetched for the view). | Measured |
| | Flow paths (computed) | Where rain would run downhill on a 30 m surface model. **Not** a map of drains or nallas. | Modelled |
| | Surface water history | How often each spot was water, 1984–2024. | Inferred |
| | Water index (MNDWI) | Open water on one satellite date. | Measured |
| | Catchments (computed) | Areas draining to one exit of the study box. | Modelled |
| Ground | Slope | Steepness from the 30 m surface model; buildings and trees show as steep edges. Same layer as Explore → Terrain. | Modelled |
| | Soil properties (0–30 cm) | Predicted clay, sand, silt, carbon, density, water capacity at 250 m. Not a borehole. | Inferred |
| Air | Air-quality stations | Where the continuous monitors are. Click one to open its readings. | Measured |
| Heritage & rail | Heritage places, Railways (OSM), Metro | Locators only; the ASI / PMC heritage lists are not included. | Measured |

**Hover** any drawn tree, cluster, monitor, flow path, OSM feature or footprint outline for a tooltip: what it is, its
name, one detail line and how it is known.

Environment layers belong to Environment (and Explore): they are removed from the map (and from graphics memory) while
you work in Design, Underground, Simulate, Projects or Reports, and drawn again when you return. This now includes the
OpenStreetMap water, heritage and railway overlays, which used to stay drawn over Design.

## What would a proposal touch?

Select a proposed road, flyover or double-deck. The panel shows **Count trees & green area**:

| Indicator | Inside the footprint | With a 10 m margin |
|---|---|---|
| Census trees (and how many are flagged rare) | PMC Tree Census 2019 points inside the polygon | same, footprint widened by 10 m each side |
| Green area | ESA WorldCover tree, shrub, grass, crop and wetland pixels × 100 m² | same |
| Tree cover | WorldCover tree-cover pixels × 100 m² | same |

- The **footprint** is the centreline widened by half the proposal's width on each side, with flat ends. It is drawn on the
  map in magenta (solid = footprint, dashed = with margin). The margin column includes the footprint.
- Counts are **deterministic**: the same drawing always gives the same numbers. Two sites were checked against an
  independent GIS calculation (see the audit): tree counts matched exactly; green area matched or differed by one 10 m pixel.
- What it does **not** tell you: trees felled or planted since 2019, tree health today, legal protection, canopy over the
  footprint from trees outside it, or anything about construction methods. A Trees Act survey and a site visit are still required.
- **CSV** downloads the indicators with their source, date, evidence label and method.
- **Check against constraint layers** opens the existing screening (water, heritage, railway, metro) for the same proposal.
- A proposal without a width says so ("footprint unknown") instead of counting anything. Outside the land-cover data the
  green area is UNKNOWN, not zero.

## Records

- **Air quality — measured at stations.** Pick a station (or click it on the map), a pollutant and daily or monthly means.
  Point at the chart to read a value and its date. On daily PM2.5, PM10, NO₂ and SO₂ a dashed line marks the India NAAQS
  24-hour limit **for reading the chart only** — it is not a compliance check. Sample counts per day are stated; there is no
  gap filling. **Download CSV** saves the series with sample counts.
- **Rainfall.** IMD 0.25° grid cells (annual totals with stored "suspect" flags in amber, monthly means, highest daily
  totals), CHIRPS study-box average, IMD district days. Point at a bar for its value. **Download CSV** for the annual totals.
  These are descriptive statistics — **not IDF curves, not design storms**.
- **Land-cover areas** for the current view or a selected proposal's footprint.

## Traffic emissions

Shows the **relative change** (%) in fuel, CO₂, NOx and PM between a proposal and the existing city, from a before / after
comparison run in Simulate (same demand and seeds), with how many seeds agree. It carries two badges: **Model-based · not
validated** and **Traffic input fails validation (TAG M3.1)**. Absolute totals are not shown here: the traffic model is
not good enough to quote them. Until a comparison exists the card says what to run.

## Not available yet

A collapsed list at the bottom names what is missing **on purpose**, with why and what data would be needed: noise, land
surface temperature (heat), **population exposure**, geology, seismic zone, groundwater, the storm-water network, PMC flood
lines (restricted), a flood model, and the rejected built-up-change layer. Their absence never means "no issue".

## When something goes wrong

- **Data server not answering:** a card says so ("everything is UNKNOWN until it answers") with **Try again**. Layers and
  counts show "the data server did not answer".
- **Camera outside the data:** "The camera view does not overlap this layer (Pune study area)."
- **Too many trees in view:** the map is split into tiles; a tile with more trees than its cap shows its trees as clusters
  with their exact counts. The row says "Showing N of M census trees … as single trees; the other … are in K clusters.
  Zoom in to see them one by one." Counts are the server's, never estimated in the browser.

## Performance (2026-11-21)

Concern: with every Environment layer on, the map must stay smooth on an ordinary laptop. Audit first, then fixes; all
figures below are **HEADLESS Chromium** (SwiftShader software WebGL, 1440 × 900, CPU throttled ×4 with CDP
`Emulation.setCPUThrottlingRate 4` to approximate a weak laptop) on a shared 2-CPU box. They compare the build before and
after on the same machine; they are **not** real-browser frame rates. **Real Windows Chrome FPS was not measured.**
In headless Chromium `requestAnimationFrame` hardly fires, so frame time is the time of an explicit `viewer.render()`
per camera step, and "idle" is the cost of one render-loop tick with nothing moving. SwiftShader rasterises on the CPU, so
frame times are dominated by software rasterisation and are noisy (another agent's browser used ~90 % of one CPU during
both runs). Harness (outside the repo): `/workspace/work/env-perf-e2e/{measure,idle,ovh}.py`; raw results
`perf-base.json`, `perf-new.json`, `idle-*.json`, `ovh-*.json` there.

Scenario: Environment, camera straight down over the whole city (30 km up, ~0.33° wide), then every map toggle turned on
one after the other (land cover, trees, NDVI, water OSM, flow paths, surface-water history, MNDWI, catchments, slope,
soil, air stations, heritage, railway; metro and buildings were already on), then panning / zooming, then real camera
moves (city pan, Swargate 2.5 km, Swargate 900 m), hover, and Design afterwards.

### Root causes found

| # | Problem | Why it lagged |
|---|---|---|
| 1 | Trees, flow paths and the OSM water / heritage / railway overlays were **one Cesium Entity per object** (3,401 entities with everything on; up to 3,000 tree entities when zoomed in). | Entities are re-evaluated by the data-source display on every frame, and their GPU batches are built inside the render call: a refetch after a pan built thousands of entities in one frame (frames of 30–48 s and main-thread long tasks up to 48 s at ×4 throttle). |
| 2 | Every pan or zoom refetched the trees for the exact view (no cache, no cancellation); a superseded request still downloaded and was thrown away. | Repeated downloads and rebuilds of the same trees. |
| 3 | Water, heritage and railway each downloaded the **same** 653 kB site-data answer (it contains all three). | 3 × the bytes and parse time. |
| 4 | Layers were only hidden (`show = false`) outside Environment: textures, entities and buffers stayed allocated under Design / Underground / Simulate (2,768 entities, 7 imagery layers, heap 165 MB in Design); OSM overlays even stayed drawn there. | Memory and per-frame entity work in workspaces that do not show them. |
| 5 | The scene rendered continuously (60 times a second when the browser allows) over a still map. | A full frame every tick: ~95 ms per tick at ×4 here. |
| 6 | Hover picked (one pick pass + a drill pick of 6) on every throttled mouse move, also while the camera moved and when no Environment layer was drawn. | Each pick re-renders the scene in a pick buffer. |
| 7 | Found after the first fixes (their median pan / zoom frame was slower than before): flow paths and OSM lines as a `PolylineCollection`. | A PolylineCollection rebuilds its draw commands on every rendered frame by walking every line; with ~1,000 lines that was ~76 ms of main-thread script per frame at ×4 (CPU profile of a warm pan). |

### What changed

- **Trees as tiles, drawn as GPU batches.** New `GET /api/env-data/trees/tile?level&tx&ty&limit`: a tile is 4 × 4 cells
  of the census index's own grid (0.16 / 0.04 / 0.01 / 0.0025° wide). Membership uses the index pipeline's cell rule
  (`int(lon // size)`), so the tiles of a level **partition the census exactly** (every tree in one tile; tile total = sum
  of the pipeline's cell counts). A tile returns single trees when it holds ≤ its cap (500; 1,500 at the finest level;
  5,000 once the view is narrower than one fine tile), else its 16 cells as clusters with exact counts. The browser picks
  the level so ≤ ~3 tiles span the view (≤ 24 tiles), draws each tile as **one `PointPrimitiveCollection`** (+ one
  `LabelCollection` for cluster counts ≥ 300), caches 120 tile answers (LRU), keeps tiles already drawn when panning,
  cancels requests the view no longer needs and loads at most 4 tiles at once, centre first. The row says
  "Showing N of M census trees in the drawn tiles … as single trees; the other … are in K clusters. Zoom in…" (M is the
  exact server total for the drawn tiles, which cover the view and a little around it).
- **Flow paths** and the **OSM water / railway lines** as one static `Primitive` of `PolylineGeometry` instances per layer
  (`staticLines.ts`, each line keeps its id for hover); **OSM water / heritage / railway** polygons as one `Primitive`, points
  and labels as one point / label collection per layer, sharing one site-data request per box.
- **Caches and cancellation:** rendered rasters (10 PNGs) and flow-path answers (10) cached by request URL; a newer view
  aborts the older request (`AbortController`, also for rasters); no refetch when the camera stops where the layer was
  drawn (within 1 % of the box).
- **Freed outside Environment / Explore:** leaving destroys every Environment texture and batch and cancels requests; the
  layers stay on and are drawn again on return, from the caches.
- **Render on demand in Environment** (`scene.requestRenderMode`): a frame is drawn when something changes. Cesium
  requests frames for camera moves and tile / imagery loads; we add requests on user input (pointer, wheel, keys),
  data-source and imagery-layer changes, shell state changes, and a 1 s heartbeat as a safety net. It is switched off
  outside Environment and whenever a traffic simulation is animating, so Design, Underground and Simulate render exactly as
  before.
- **Hover:** no pick at all when no Environment overlay is drawn; no pick while the camera moves, judged from the camera's
  view matrix (a pick waits until it has been still for 150 ms, and retries if it moved meanwhile) — not from Cesium's
  `moveEnd`, which is raised only by a later render and could arrive late or never with render on demand or a paused render
  loop, which blocked every pick (found in this audit: 0 picks in the step-render scenario); drill pick 6 → 4.
- **Tooltips** for trees and flow paths are built lazily from the drawn data instead of one registered tip per object.

Accuracy: counts are unchanged and still come from the server. The proposal indicators (`/trees/count`, land-cover areas)
were not touched; the tree layer's totals are sums of server tile totals. Tests: `backend/tests/test_envdata.py::
test_tree_tiles_partition_the_census_exactly` (all levels, all-points / mixed / all-clusters, trees on tile edges: every
tree exactly once) and a full-census check on the real index (levels 0 and 1: 4,009,623 = all rows; 300 random level-3
tiles: points returned = tile total). Frontend: `src/engine/testing/EnvTreeTiles.test.ts` (levels, caps, tile cover and
cap, summary text, LRU, cluster sizing, render-on-demand rule, lazy tips, pick skip).

### Before / after (HEADLESS, CPU ×4)

| Measure | Before | After |
|---|---|---|
| Map objects with every layer on (city view) | 3,401 entities | 35 entities (8 stations + 27 non-Environment); trees 25 cluster points in 9 tile batches, 532 flow-path lines in 1 batch, OSM in 3 batch groups |
| Draw commands per frame (city view, all on) | 864 | 882 |
| JS heap after GC, all on | 175.0 MB | 134.9 MB |
| JS heap after GC, Design after Environment | 165.4 MB | 132.3 MB |
| Left allocated in Design after Environment | 2,768 entities, 7 imagery layers (OSM overlays still drawn) | 27 entities (none from Environment), 1 imagery layer (base map) |
| Network, turning all 13 layers on | 5.29 MB in 13 requests | 3.98 MB in 19 requests (heritage + railway: 0 B, shared) |
| Main-thread long tasks while turning them on (count / total / longest) | 43 / 60.1 s / 17.2 s | 34 / 31.9 s / 9.1 s |
| Pan across the city (moveEnd → redraw): settle time / API bytes / requests | 3.81 s / 2.92 MB / 8 | 1.95 s / 2.92 MB / 7 |
| Pan across the city (moveEnd → redraw): long tasks (count / total / longest) | 7 / 2.3 s / 1.3 s | 3 / 0.5 s / 0.2 s |
| Pan across the city (moveEnd → redraw): frame time while panning there (median / p95) | 223 / 29.6 s | 291 / 7.0 s (after = build before 499f2c0, not re-measured) |
| Fly to Swargate 2.5 km: settle time / API bytes / requests | 3.84 s / 1.73 MB / 8 | 3.86 s / 1.73 MB / 19 |
| Fly to Swargate 2.5 km: long tasks (count / total / longest) | 7 / 2.2 s / 0.8 s | 7 / 1.4 s / 0.8 s |
| Fly to Swargate 2.5 km: frame time while panning there (median / p95) | 155 / 36.5 s | 261 / 27.1 s (after = build before 499f2c0, not re-measured) |
| Zoom to Swargate 900 m: settle time / API bytes / requests | 2.66 s / 1.08 MB / 8 | 2.14 s / 1.08 MB / 7 |
| Zoom to Swargate 900 m: long tasks (count / total / longest) | 7 / 1.6 s / 0.8 s | 5 / 1.3 s / 0.8 s |
| Zoom to Swargate 900 m: frame time while panning there (median / p95) | 183 / 16.7 s | 154 / 0.6 s (after = build before 499f2c0, not re-measured) |
| Render-loop tick with nothing moving, Environment, essentials on (median) | 95.6 ms, frame drawn 30/30 | 6.1 ms, frame drawn 2/30 (heartbeat) |
| Same in Design after Environment (median) | 92.2 ms | 30 ms |
| Hover with real mouse moves after the fixes (smoke, 2.5 km / after a wheel zoom / step renders with the loop off / 600 m / back from Simulate) | — | tooltips shown for a tree cluster, a flow path, a cluster right after a wheel zoom, a cluster after loop-off step renders (2 picks), a single tree at 600 m, and a cluster after returning; pick times 60–2,785 ms (first pick compiles pick shaders) |

Pan / zoom frame time after `499f2c0` (static line Primitive), `frames.py`: same city view, all 13 layers on, CPU ×4,
time of one explicit `viewer.render()` per camera step. Median ms of run 1 / run 2 (p95 of each run). Base and after were
run one at a time under the lock, but **after run 1 overlapped another agent's headless browser outside the lock** (load
~8 on 2 CPUs); after run 2 ran with load ~3, like the base runs.

| Steps | Before (base 3e8f65e, 2 runs) | After (499f2c0, 2 runs) |
|---|---|---|
| 40 pan steps, first pass (tiles still loading) | 117 / 120 (p95 9.3 / 18.5 s) | 174 / 122 (p95 28.8 / 9.2 s) |
| 30 zoom steps, first pass | 137 / 184 (p95 9.7 / 14.6 s) | 392 / 141 (p95 77.4 / 9.7 s) |
| 40 pan steps, warm | 69 / 51 (p95 4.9 / 2.6 s) | 76 / 50 (p95 34.5 / 8.1 s) |
| 30 zoom steps, warm | 67 / 116 (p95 1.7 / 2.4 s) | 76 / 82 (p95 1.3 / 5.5 s) |
| 40 pan steps, warm, render on demand forced off | 83 / 104 (p95 15.2 / 16.1 s) | 108 / 71 (p95 13.3 / 13.6 s) |

Verdict, plainly: the build before `499f2c0` had slower median frames (warm pan 159 ms, warm zoom 187 ms, n = 1); its CPU
profile showed the PolylineCollection walk, and that script time is gone from the after profiles (only WebGL calls on top).
In the clean after run every median is equal to or below base. With only 2 runs each and one after run disturbed, it is
**not proven** that the first-pass (cold) medians and the p95 / max frames are no worse: in this data they are worse in run 1
and similar in run 2. Single frames of 10–90 s are SwiftShader rasterising freshly loaded tiles and drapes on a shared CPU,
in both builds.

Time to first paint per layer (click → row says Shown, then one explicit render), city view:

| Layer | Before: shown + first render | After |
|---|---|---|
| landcover_worldcover2021 | 1.24 + 4.19 s, 243 kB | 1.02 + 1.13 s, 243 kB |
| tree_census_2019 | 1.6 + 1.22 s, 7 kB | 0.78 + 2.15 s, 5 kB |
| s2_ndvi | 0.89 + 0.56 s, 1338 kB | 0.79 + 0.39 s, 1338 kB |
| water | 4.09 + 2.03 s, 654 kB | 5.41 + 6.15 s, 654 kB |
| dem_streams | 19.08 + 0.63 s, 181 kB | 0.91 + 0.33 s, 181 kB |
| jrc_gsw_occurrence | 0.83 + 0.37 s, 49 kB | 2.12 + 0.57 s, 49 kB |
| s2_mndwi | 10.75 + 4.91 s, 796 kB | 0.53 + 0.27 s, 796 kB |
| dem_catchments | 0.92 + 4.75 s, 6 kB | 0.61 + 7.0 s, 6 kB |
| slope | 0.51 + 3.72 s, 405 kB | 1.26 + 2.98 s, 405 kB |
| soil_soilgrids | 0.33 + 7.06 s, 300 kB | 0.7 + 3.72 s, 300 kB |
| air_cpcb_caaqms | 0.64 + 4.5 s, 0 kB | 0.51 + 7.56 s, 0 kB |
| heritage | 3.81 + 1.68 s, 653 kB | 0.39 + 1.66 s, 0 kB |
| railway | 3.03 + 0.74 s, 653 kB | 0.37 + 0.68 s, 0 kB |

### Not done / open

- Still worse or unproven, plainly: the "frame time while panning there" rows for the three real camera moves were
  measured on the build before `499f2c0` and not re-measured (fly to Swargate 2.5 km was slower there: median 261 vs
  155 ms); first-pass pan / zoom medians and the p95 / max frames after `499f2c0` are not proven no worse (n = 2, one run
  disturbed, see above).
- Smoke after `499f2c0` (headless, real mouse): r1 Pune Central Boulevard 118 / 203 trees (unchanged); Underground and
  Simulate open with every Environment layer freed; back in Environment the layers redraw from the caches; no console
  errors. A road drawn in Design after Environment with real clicks + Enter was added; in the longer smoke a
  double-click finish right after the proposal screening added no road. Not investigated (not a performance change).
- Real-GPU frame rates (Windows Chrome) were **not measured**; SwiftShader frame times above are CPU rasterisation.
- Rasters are still re-rendered by the server for each new view (only an unchanged view is skipped); with eight drapes on,
  a pan downloads ~2.9 MB. A padded raster box with reuse while the view stays inside would cut this.
- Eight semi-transparent drapes at once remain expensive to rasterise; nobody needs them all at once, but nothing stops it.
- The earlier "bindTexture: attempt to use a deleted object" WebGL warning did not appear in the before or after runs of
  this audit (no WebGL warnings except SwiftShader's own driver notices); with the layers now destroyed only from our own
  code outside the render call, the earlier suspicion (entity data sources destroyed while swapped) no longer applies, but
  it is not proven fixed.

---

## Appendix — developer notes

**Files.**
- `frontend/src/shell/contexts/EnvironmentContext.tsx` — the panel: get-started card, proposal section, layer groups
  (`PLANNER_GROUPS`), records, emissions, not-available list. Mounts `EnvHoverTooltip`.
- `components/environment/envPlanner.ts` — pure planner model: evidence class per layer (`evidenceOf`), plain titles,
  short source / date / licence, legend unit notes, `unavailableOf` (+ `NOT_WIRED` exposure), proposal indicator maths
  and CSV, relative emissions, NAAQS reference values, chart readout, OSM request box (`requestBox`, `boxHolds`).
  Tests: `src/engine/testing/EnvPlannerModel.test.ts`.
- `components/environment/EnvImpact.tsx` — proposal indicators; footprint polygons from `POST /api/env-data/footprint`,
  counts from `POST /trees/count` and `POST /layers/landcover_worldcover2021/areas`; outline data source `env-impact`.
- `components/environment/envTips.ts`, `EnvHoverTooltip.tsx` — tooltip registry (object id → tip, plus lazy resolvers by
  id prefix for trees / flow paths / OSM features, and `anythingToPick()`), and the throttled pick handler (skipped when
  nothing is drawn or the camera moves; `window.__envHoverMs` holds the last pick durations for QA); station click →
  `envFocus` store.
- `components/environment/treeTiles.ts` (pure: tile levels, caps, LRU, summary text) and `treeLayer.ts` (Cesium: one
  `PointPrimitiveCollection` + `LabelCollection` per tile, request cancellation, cache) — the tree census layer.
  `envPerf.ts` — `ENV_WORKSPACES`, `sameBox`, render-on-demand switch. `window.__envOverlayCounts()` reports what is drawn
  (for QA). Tests: `src/engine/testing/EnvTreeTiles.test.ts`.
- `components/environment/EnvBits.tsx` — evidence chip and meta line. `download.ts` — CSV download.
- `envDataOverlay.ts` — rasters (cached PNGs), flow paths (one static line `Primitive`, `staticLines.ts`), trees (`treeLayer.ts`), stations
  (entities, ≤ 11); frees everything outside `ENV_WORKSPACES` (environment, explore) and redraws on return; turns render on
  demand on in Environment. `constraintOverlay.ts` — OSM water / heritage / railway fetched for the camera view padded by
  50 % (whole coverage only when zoomed out past 0.35°), one shared site-data request per box, drawn as GPU batches,
  refetched on `moveEnd` when the view leaves the drawn box, freed outside Environment / Explore; per-layer request
  sequence so a hide during a fetch draws nothing.
- `EnvDataPanels.tsx` — chart readouts (`useReadout`), NAAQS reference line, CSV buttons, focus station.

**Backend.**
- `backend/envdata/footprint.py`, `POST /api/env-data/footprint {coordinates, width_m}` → WGS84 GeoJSON Feature, buffered
  in EPSG:32643, flat caps, mitre joins (limit 3); 422 on bad input. Browser-side vertex offsetting twisted the polygon at
  doubled-back snapped vertices and narrowed bends (counts off by up to 11 trees on a 517 m road).
- `envdata/catalogue.py`: a missing file is named relative to the data folder; `data_dir` is "configured" / "not found",
  never the absolute path. Test: `backend/tests/test_envdata.py`.
- `envdata/trees.py::tile`, `GET /api/env-data/trees/tile` — tree census tiles (see § Performance). The bbox endpoint
  `GET /trees` is unchanged.

**Evidence mapping.** Explicit per id in `EVIDENCE_BY_ID`; otherwise by catalogue class (observed → measured; derived /
estimated / synthetic → modelled; inferred → inferred). WorldCover, JRC GSW and SoilGrids are *inferred* (ML / classifier
output), per CURRENT_STATUS_AND_ROADMAP.md §7.

**Not done / decisions.** No time slider (two scenes and fixed summaries only). No raster value on hover (would need a
point-query API). The OSM constraint overlays are now freed outside Environment / Explore like the other layers (they
used to stay drawn in Design).
