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
2. Select a proposed road, flyover or double-deck, on the map or in "Your drawn works", and press **Count trees & green area**.
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
| | Trees (PMC census 2019) | 4.0 million individual trees with species and girth. Zoomed out they show as clusters with counts. | Measured (2019) |
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

Environment layers belong to Environment (and Explore): they are hidden while you work in Design, Underground, Simulate,
Projects or Reports, and come back when you return.

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
- **Too many trees in view:** clusters with the exact total; zoom in for single trees.

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
- `components/environment/envTips.ts`, `EnvHoverTooltip.tsx` — tooltip registry (entity id → tip) and the throttled
  pick handler (`window.__envHoverMs` holds the last pick durations for QA); station click → `envFocus` store.
- `components/environment/EnvBits.tsx` — evidence chip and meta line. `download.ts` — CSV download.
- `envDataOverlay.ts` — registers tips; hides imagery / data sources outside `ENV_WORKSPACES` (environment, explore) via
  a `useShellStore` subscription. `constraintOverlay.ts` — OSM water / heritage / railway now fetched for the camera view
  padded by 50 % (whole coverage only when zoomed out past 0.35°), refetched on `moveEnd` when the view leaves the drawn
  box; per-layer request sequence so a hide during a fetch draws nothing.
- `EnvDataPanels.tsx` — chart readouts (`useReadout`), NAAQS reference line, CSV buttons, focus station.

**Backend.**
- `backend/envdata/footprint.py`, `POST /api/env-data/footprint {coordinates, width_m}` → WGS84 GeoJSON Feature, buffered
  in EPSG:32643, flat caps, mitre joins (limit 3); 422 on bad input. Browser-side vertex offsetting twisted the polygon at
  doubled-back snapped vertices and narrowed bends (counts off by up to 11 trees on a 517 m road).
- `envdata/catalogue.py`: a missing file is named relative to the data folder; `data_dir` is "configured" / "not found",
  never the absolute path. Test: `backend/tests/test_envdata.py`.

**Evidence mapping.** Explicit per id in `EVIDENCE_BY_ID`; otherwise by catalogue class (observed → measured; derived /
estimated / synthetic → modelled; inferred → inferred). WorldCover, JRC GSW and SoilGrids are *inferred* (ML / classifier
output), per CURRENT_STATUS_AND_ROADMAP.md §7.

**Not done / decisions.** No time slider (two scenes and fixed summaries only). No raster value on hover (would need a
point-query API). The OSM constraint overlays stay visible in Design (Explore and Feasibility also control them).
