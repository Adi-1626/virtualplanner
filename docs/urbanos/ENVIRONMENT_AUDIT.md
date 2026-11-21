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

## Fixes
See the section "Fixes and commits" (filled in as the work lands).
