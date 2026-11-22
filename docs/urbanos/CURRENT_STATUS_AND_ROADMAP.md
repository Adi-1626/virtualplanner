# UrbanOS — current status (verified) and Phase 3 roadmap

Written 2026-11-14 (IST) from an inspection of `urbanos-final-project-2026-11-14.zip`, `urbanos-data-raw.zip`, `urbanos-data-derived.zip` and `deletion_manifest.tsv`, plus the live checkout. Read-only audit: no code, DB or dataset was changed.

Related: [START_HERE](START_HERE.md) · [PROJECT_OVERVIEW](PROJECT_OVERVIEW.md) · [DATA_CATALOGUE](DATA_CATALOGUE.md) · [DATABASE_AND_CODE_GUIDE](DATABASE_AND_CODE_GUIDE.md) · [LEARNING_GUIDE](LEARNING_GUIDE.md)

**Evidence labels used here**
- **VERIFIED**: checked in this audit against code, the database, archive contents or a test run made on 2026-11-14.
- **REPORTED**: taken from an earlier report in `docs/` and not re-run today.
- **INFERRED**: a judgement drawn from the evidence.

---

## 0. Update 2026-11-22 (IST): what changed since this audit (VERIFIED in code at `ba7a003`)

The 2026-11-14 text below is kept as written except where marked; pass counts in §3 are from 2026-11-14 and were **not** re-run for this update (docs-only pass). Practical companion: [DEVELOPER_HANDBOOK.md](DEVELOPER_HANDBOOK.md).

| Item | Now |
|---|---|
| Where the code is | `main` of `Adi-1626/virtualplanner` (remote `origin`) at `ba7a003` "Road tool: an end left on the ground beside a road it touches takes that road's height". 178 commits after `8c923ac`, all merged through the `next-phase` integration on 2026-11-21. Remote `upstream` = `sumedhpatil2005/virtualplanner`. |
| CI | `.github/workflows/ci.yml` runs on pushes to `main`, so it now covers this work (tsc + oxlint + vitest; backend seed + pytest). |
| Size | 17 routers, **168 endpoints** under `/api`; **44 tables** in `twincity.db`; test files: 130 Vitest, 36 in `backend/tests`, 2 in `backend/datasets/tests`. |

Features added since 2026-11-14 (each with its own doc in `docs/urbanos/`):
- **Data-freshness service + official-only facts** (`backend/updater/`, `/api/updater`, Reports → Data catalogue → Fact updates). Watches official pages for Pune project facts (lengths, stations, tunnel depth, cost, dates, status), proposes changes with quoted evidence; a named reviewer approves and `apply` writes a new immutable registry version of `pune_infra_project_facts`. Since 2026-11-21 only government and agency sites count (`backend/updater/official.py`; news is never a source). Seed list: `docs/urbanos/pune_project_facts.json` (v2, 22 projects, 108 records). Docs: `DATA_FRESHNESS_SERVICE.md`, `DATA_FRESHNESS_RESEARCH.md`, `PUNE_PROJECT_FACTS.md`.
- **Underground screening** (`backend/coordination/screening*.py`, `/api/coordination/underground/*`): sourced clearance rule table (CPHEEO, IRC:98, IS 1255, PNGRB T4S, UDCPR metro NOC), statuses Potential conflict / Requires investigation / Verified / Insufficient data, saved runs with stale detection, PDF/DOCX/CSV report, records within 250 m of what was drawn; OSM metro tunnels kept at "depth not mapped". Docs: `UNDERGROUND_CHECKS.md`, `UNDERGROUND_WORKSPACE.md`, `UNDERGROUND_QA.md`.
- **Curved geometry editor** (`frontend/src/engine/geometry/alignment/`, `engine/editing/AlignmentEditor.ts`, `geometryCommit.ts`, `components/design/AlignmentPanel.tsx`): PIs with radii, design speed and eMax, IRC screening flags (never a design check), one-undo-step commit pipeline. Doc: `GEOMETRY_EDITOR_DESIGN.md`.
- **Simulate refine**: live traffic stepping in a Web Worker (`liveTraffic*.ts`) with inline fallback, analysis reuse by run fingerprint, emissions as relative change, units on every value. Docs: `SIMULATE_WORKSPACE.md`, `SIMULATE_AUDIT.md`.
- **Environment refine + performance**: planner-first panel ("what would a proposal touch": census trees and green area in a metre-buffered footprint, `POST /api/env-data/footprint`), layers grouped as Measured / Modelled / Inferred, tiled tree census (`GET /api/env-data/trees/tile`), render-on-demand (`components/environment/envPerf.ts`). Docs: `ENVIRONMENT_WORKSPACE.md`, `ENVIRONMENT_AUDIT.md`.
- **Projects refine**: report section 7 "Proposal elements and conflict check", per-work checkboxes, metro NOC rule citing UDCPR 2020 cl. 14.2.1.7. Docs: `PROJECTS_WORKSPACE.md`, `PROJECTS_AUDIT.md`.
- **Overpass proxy** (`backend/osm/overpass.py`, `GET /api/osm/overpass`): a fresh clone without `osm_index.db` can still import study areas (cached, rate-limited).
- **Server-down wording**: API clients go through `trackedFetch`; a failed request marks the header Offline and says the server could not be reached.

Still true from the 2026-11-14 list: SUMO service stub, hard-coded Simulate validation text (`SimulateContext.tsx`), unwired `scenarioReport.ts`, no authentication, the two data-path resolvers, the traffic model failing TAG M3.1, DEM screening-only.

## 1. Repository and Git state (VERIFIED on 2026-11-14; see §0 for now)

| Item | Value |
|---|---|
| Branch | `urbanos-city-planning-redesign` |
| HEAD | `8c923ac` "Data retention: resolve blockers … execute Phase A cleanup record" |
| Upstream (`sumedhpatil2005/virtualplanner`) | at `1132b8a`. Local is **1 commit ahead** (`8c923ac` not pushed). Nothing is merged to `main` (`main` = `447c09f`, 343 commits behind this branch). |
| Working tree | Clean, apart from the new untracked docs from this audit (`START_HERE.md`, `PROJECT_OVERVIEW.md`, `DATA_CATALOGUE.md`, `DATABASE_AND_CODE_GUIDE.md`, `CURRENT_STATUS_AND_ROADMAP.md`, `LEARNING_GUIDE.md`). |
| Worktrees | Only the main checkout. Phase A removed `uos-wt-qa2` and `uos-wt-qa3`. |
| Project archive | Its `.git` HEAD is also `8c923ac`, with a clean tree, so the zip and the checkout hold the same code. |
| CI | `.github/workflows` triggers only on `main`, `p0` and `phase/*`, so **CI does not run on this branch**. Every test result below comes from a manual run. |

## 2. What each phase delivered

### 2.1 UI transformation (UrbanOS redesign) — VERIFIED in code
- A new shell (`frontend/src/shell/AppShell.tsx`, `workspaces.ts`) with seven workspaces: Explore, Design, Underground, Environment, Simulate, Projects and Reports. Each has a context panel under `frontend/src/shell/contexts/`.
- A design-token system, `ToolPalette`, honesty badges (measured / estimated / inferred / hypothetical), the Data Catalogue overlay, the Underground drawer tabs (Profile, Cross-section, Utility table, Subsurface evidence) and the Simulate drawer (Calibration, ODME, Emissions, Count checks, Through the day).
- Backend coordination module: `/api/coordination` runs conflict detection between projects and against real sewer and building data, with ASCE 38 quality levels.
- Workflow traces for every workspace are in [PROJECT_OVERVIEW §7](PROJECT_OVERVIEW.md).

### 2.2 Phase 2 data acquisition — VERIFIED against the archives and registry
- **19 raw source directories** (about 3.0 GB, all retrieved 2026-11-13), each with a `manifest.json` giving URL, sha256, size and licence.
- **40 derived dataset directories, 42 versions** (about 3.1 GB), each with a `processing.json`.
- **Registry: 101 datasets, 83 versions** (76 active, 1 pending_review, 6 superseded) and 438 file rows (10 withdrawn).
- 25 datasets are placeholders with no version (12 `env:*`, 12 `gap_*`, plus `pmc_portal_traffic_details`). These are deliberate "we know this is missing" records, not data.
- The full inventory is in [DATA_CATALOGUE](DATA_CATALOGUE.md).

### 2.3 Phase A cleanup (2026-11-14) — VERIFIED
- Deleted 120 entries: 6,562 files, 4,308,313,242 B (4.01 GiB). Step by step:
  - A1: 98 OpenCity staging duplicates.
  - A2: the unzipped Mendeley `traffic/` folder (the zip is kept).
  - A3: two failed "PDF" downloads.
  - A4: two clean QA worktrees.
  - A5: 17 scratch and harness folders.
- None of the 120 paths exists any more, and the totals match the manifest.
- **Retained:**
  - 8 harness folders cited in docs (`vp-sev-e2e`, `vp-sev2-e2e`, `vp-wt-day-e2e`, `vp-wt-merged-e2e`, `vp-wt-verify-e2e`, `vp-shots`, `urbanos/tools-e2e`, `uos-qa`).
  - All raw originals and active derived data.
  - The three DB backups.
  - Phase B (about 4.3 GiB), which was not executed.
- Registry repairs made in the same pass:
  - The 10 Bhuvan PNG rows were marked `withdrawn`.
  - The duplicate rows were reviewed, and the old ones are now `superseded`.
  - The superseded tree-index `processing.json` was recorded as the one accepted provenance exception.
- Code change: `backend/datasets/quality.py` (`WITHDRAWN_ROLE`), with a test in `backend/tests/test_datasets.py`.
- Record: [DATA_RETENTION_AUDIT §11](DATA_RETENTION_AUDIT.md). Per-step explanation: [DATA_CATALOGUE §6](DATA_CATALOGUE.md).

## 3. Test and count accuracy

| Claim in earlier reports | Status today |
|---|---|
| pytest 254 passed, 3 skipped (PHASE2_FINAL_REPORT §9) | **Outdated.** Run on 2026-11-14 after Phase A: **258 passed**, 0 skipped. 130 test files exist in total: 26 in `backend/tests`, 2 in `backend/datasets/tests`, 102 in the frontend. |
| vitest 772 passed, 7 skipped (102 files) | **Still accurate** (re-run 2026-11-14: 96 files passed, 6 skipped; 772 tests passed, 7 skipped). |
| tsc 0, oxlint 0 errors, build ok | **Still accurate** (tsc `-p tsconfig.app.json` exit 0; oxlint 0 errors, 8 warnings; `vite build` ok). |
| 101 datasets registered | **Accurate.** 101 is the registry count. Only 76 have an active version, and 25 are placeholders. |
| 19 raw sources / 41 derived datasets | 19 raw sources is accurate. Derived is **40 directories / 42 versions**. The earlier "41" counted differently. |
| "Registry active DEM = v1" (PHASE2_FINAL_REPORT §10) | **Outdated.** v3 is active, v2 pending_review, v1 superseded, and `terrain/dem.py` reads v3. |
| Browser tour clean except Cesium ion 401 and Google Fonts | **Still accurate.** Re-run after Phase A at 1440×900 against `8c923ac`: the same two environment errors and nothing else. |
| `URBANOS_OVERVIEW.md` §3 says offline DEM, PMC utilities and Rasterio are missing | **Stale.** All three are present: the DB holds 44,482 sewer and 9,187 storm-drain records. |

## 4. What genuinely works (VERIFIED unless marked)

- **Explore:**
  - Municipal layers (sewer, storm-water, chambers, STPs, rivers, nallas, roads, wards, trees and more) come from `derived/infra_index/v1/infra_index.sqlite` through `GET /api/infra/layers/{lid}/features`.
  - Terrain readout comes from DEM v3 through `GET /api/terrain/point`.
- **Design:**
  - Drawing and editing objects (`POST /api/objects`).
  - Scenario alternatives store *changes*, never edits to base rows (`/api/scenarios/{sid}/changes`).
  - Versions and the delta table.
- **Underground:**
  - Ground profile along an alignment (`POST /api/terrain/profile`; checked live after Phase A).
  - Utility crossings with a quality level. QL-D is used where depth is unknown.
  - Soil, groundwater and sewer evidence (`terrain/evidence.py`).
- **Environment:**
  - CPCB air-quality series, IMD and CHIRPS rainfall, land-cover areas, soil, surface water and tree layers through `/api/env-data/*`.
  - DEM-derived flow paths.
- **Simulate:**
  - In-browser IDM micro-simulation (`TrafficMicroSim.ts`) and static assignment.
  - ODME and HBEFA4 emissions.
  - Baseline-versus-proposal comparison.
  - Runs are recorded through `POST /api/runs`.
- **Projects:**
  - Create and edit projects with an append-only audit log (SQLAlchemy hooks plus 4 SQLite triggers).
  - Conflict detection (`POST /api/coordination/projects/{pid}/detect`).
- **Reports:**
  - Project PDF and DOCX (`planning/report.py`, `feasibility/docgen.py`), conflict CSV and the dataset catalogue.
- **Data provenance:**
  - Registry, quality checks and `provenance_check`. After Phase A: 427 files verified, 10 withdrawn, 0 missing, and 1 accepted exception.

## 5. Partial, incomplete or inconsistent (VERIFIED, with evidence)

| Area | Finding | Evidence |
|---|---|---|
| SUMO | Stub: `SumoService` raises `NotImplementedError`. Only `/api/sim/spike` works, and only with `SUMO_HOME` set. | `backend/sumo/service.py` |
| Simulate banner | The validation banner ("0 of 15 … −30.5%") is fixed text, not computed. | `frontend/src/shell/contexts/SimulateContext.tsx` |
| Scenario report | `scenarioReport.ts` is not imported anywhere. | `frontend/src/engine/report/scenarioReport.ts` |
| Not-wired analyses | 7 registry features have `wired=0`: ground model, noise, heat, seismic, flood screening, drainage model, population exposure. | table `ds_features` |
| Env catalogue | All 17 `environment_layers` rows say `not_imported` while `/api/env-data` serves real data. Only the UI reconciles the two (`mergeCatalogue`). | `environment_layers`, `envDataModel.ts` |
| Data paths | Two data-folder resolvers disagree (`datasets/paths.py` vs `envdata/paths.py`). `envdata/series.py` hard-codes version folders instead of asking the registry. | files named |
| Read side effect | `GET /api/datasets` runs `sync_catalogues` and commits on every call. | `api/datasets_router.py` |
| Unused endpoints | About 27 endpoints are never called by the frontend. | [DATABASE_AND_CODE_GUIDE §6](DATABASE_AND_CODE_GUIDE.md) |
| Fetch discipline | 12 files called `fetch()` directly on 2026-11-14; on 2026-11-22 only `OverpassClient.ts` does (offline fallback). | grep |
| Security | No authentication. The actor is self-declared (`x-actor` header or browser storage), and CORS allows any origin. | `backend/main.py`, `planning/audit.py` |
| Growth | `areas` gains one row per Simulate study-area load (1,322 rows). Writes to `city_objects` and `areas` are not audited. | DB |
| Dependencies | `@tanstack/react-query`, `geoalchemy2` and `psycopg2-binary` are unused. Nothing uses PostGIS. | package files |
| Provenance gaps | Elevation pipeline: NASADEM is used (for the difference raster) but not listed as an input in `processing.json`. `bhuvan_wms_samples` is still `active` with only its manifest left. Registry CRS, dates and coverage are mostly empty, and most licences read UNKNOWN; the real values live in the manifests. | [DATA_CATALOGUE §7](DATA_CATALOGUE.md) |
| Explore scale | Storm-water drains (150 MB) are not indexed for Explore. The merged 622 MB buildings layer is not wired at full size, and Explore caps buildings at 2,000 in view. | REPORTED, PHASE2_FINAL_REPORT §10 |
| Performance | Opening Projects took about 31 s on the harness DB. | REPORTED |
| Base imagery | The Cesium ion token is refused (401) in the sandbox, so real imagery has never been seen here. | VERIFIED (tour) |

## 6. Key engineering questions

### Is DEM v3 suitable for screening or engineering design?
**Screening only.**
- Copernicus GLO-30 is a **surface** model (DSM): it includes buildings and trees, so it is not bare earth.
- Its resolution is about 30 m. The vertical datum (EGM2008) comes from the publisher; the file itself carries no vertical CRS.
- Measured against the source tile, v3 has an RMSE of 0.40 m. Against 44,482 PMC manhole top levels, the spread (NMAD) is 2.19 m.
- That is fine for seeing which way the ground slopes along a 2 km alignment, or which areas are low-lying.
- It is **not** fine for invert levels, cut and fill quantities, drainage design or flood depths. Those need survey-grade data: DGPS or total station, or LiDAR at 1 m or better.
- Source: [DEM_V1_V3_COMPARISON.md](DEM_V1_V3_COMPARISON.md).

### Is the traffic model calibrated and validated?
**No.**
- Latest measured results ([../ENGINEERING_VALIDATION.md](../ENGINEERING_VALIDATION.md), run on `c916854`): 0 of 15 counts reach GEH < 5 (mean GEH 32.3), and the river screen line is −30.5% against a ±5% requirement. It **fails UK TAG M3.1**.
- The model is uncalibrated: no parameter was fitted to Pune observations.
- ODME fitted its 4 calibration counts, but held-out validation is 0 of 3, and TAG matrix-change limits were breached.
- Demand is estimated from land use, not measured.
- These results were not re-run in this audit (REPORTED). Calibration options are listed as PROPOSED, NOT APPLIED.
- Use Simulate for **relative, qualitative** comparison of alternatives, never for absolute volumes or speeds.

## 7. Phase 3 roadmap — engineering capability, not UI

Three kinds of work, kept separate:
- **Deterministic GIS analysis**: geometry and raster operations with no randomness. Overlays, buffers, D8 flow routing, clearance checks. The output is exactly as good as the input data.
- **Engineering simulation**: physics or behaviour models (hydraulics, traffic). These need calibration *and* independent validation data before their numbers can be trusted.
- **ML/AI**: statistical models learned from data. Only justified where there is labelled data and a clear benefit. **None is proposed** for Phase 3. Existing inferred inputs (ML building footprints, WorldCover) stay labelled `inferred`.

Ordered by value ÷ (risk × data dependency):

| # | Theme | Already have | Missing | Reuse | Build | Success test |
|---|---|---|---|---|---|---|
| 1 | **Data quality & provenance** (do first) | Registry (`backend/datasets/registry.py`, `quality.py`, `provenance_check.py`), manifests, review flow, update monitor | Registry metadata (CRS, dates, coverage, licence) mostly empty; NASADEM missing from lineage; Bhuvan row still active; two path resolvers; read endpoint with side effects; no CI on this branch | `importer.py`, `seed.py`, `catalogue_doc.py` | Back-fill registry fields from manifests and `processing.json`; record every input in `processing.json`; one path resolver; make `GET /api/datasets` side-effect free; turn on CI for this branch | `provenance_check` reports 0 unregistered inputs and 0 empty required fields; CI green on every push; a test asserts a GET leaves the DB unchanged |
| 2 | **Terrain & hydrology (deterministic)** | DEM v3, own D8 (`datasets/pipelines/_hydro.py`, `test_hydro.py`), flow paths, slope, hillshade, profile API | Bare-earth terrain; depression handling documented; catchment delineation on request; comparison with mapped nallas | `_hydro.py`, `terrain/dem.py`, `envdata/render.py` | Catchment and upstream-area tool for a clicked point; stream-network agreement metric against `pmc_nallas` and `pmc_rivers`; DSM caveat on every output | Matched against PMC nalla lines within a stated buffer (report % agreement); unit tests on synthetic DEMs with known answers; outputs labelled "screening, DSM" |
| 3 | **Flood & stormwater** | IMD 0.25° and CHIRPS rainfall, JRC surface water, PMC storm drains and chambers, flow paths; AutoDCR flood-line render (probe only, restricted) | IDF curves, drain sizes and invert levels, outfall levels, observed flood extents, bare-earth DEM | Rainfall series (`envdata/series.py`), infra index, D8 | **Now:** deterministic screening only. Low-lying and flow-convergence zones × drain density × historical water occurrence, presented as a ranked screening map. **Later**, only once IDF data and drain inverts and sizes are obtained: a 1D drainage model such as EPA SWMM, which is open source. | Screening: compare against documented flood spots (news or PMC lists) as a hit-rate, not as validation. No flood depth or extent is claimed until a hydraulic model is calibrated against observed events. |
| 4 | **Underground geology & utility confidence** | ASCE 38 QL-D/QL-C handling, 44,482 sewer and 9,187 storm-drain records, SoilGrids 250 m, NWDP groundwater wells, evidence API | Boreholes, sewer inverts for most pipes, water-supply network, metro tunnel depths, GSI geology (account needed) | `terrain/evidence.py`, `coordination/subsurface.py`, `subsurface_index.py` | Per-utility confidence score shown in the Utility table (QL plus source age plus depth basis); import boreholes when obtained; a "data needed" report per alignment | Every crossing shows a QL and depth basis; a test fixture of known crossings; no depth shown where only QL-D exists |
| 5 | **Infrastructure feasibility (screening)** | `feasibility/` layers (water, heritage, trees, railway), `siteAssessment.ts`, `investigationRules.json`, PDF/DOCX | Heritage and ROW official layers, land ownership, setback rules sourced from DCPR | Feasibility engine, docgen | Rule table that cites DCPR clauses for each check; screening output "constraints found / investigation required", never "feasible" | Each rule cites a source clause; golden-file tests per rule; a review by a planner on 3 real sites |
| 6 | **Project coordination & spatial conflicts** | `/api/coordination` detect, clearance rules, conflicts UI, audit log | Authentication and roles; cross-agency project data; performance (about 31 s open) | `coordination/service.py`, `planning/*` | Auth with real actors; index-backed queries; conflict rule sources documented; projects-open profiling | Projects open in under 3 s on the harness DB; conflict detection regression set; audit actor comes from authentication |
| 7 | **Environmental impact** | CPCB AQ series, HBEFA4 emission factors, land cover, NDVI, trees | Noise, heat, population exposure (all `wired=0`); air dispersion inputs (meteorology, stack data) | `engine/emissions/hbefa4.ts`, env-data APIs | Deterministic indicators only: trees and green area affected by a proposal, emissions change from the traffic delta **labelled as model-based**, exposure counts from census wards | Tree and green-area counts match a manual GIS check on 2 sites; emissions shown only as relative change with a "model not validated" badge |
| 8 | **Traffic calibration & validation** (data-gated) | IDM micro-sim, static assignment, ODME, 15 counts, TraffiCure speeds, validation harness | Enough independent classified counts (a TAG screen line of 5 or more links), measured speeds, a demand source (household survey or CMP matrix) | `ENGINEERING_VALIDATION` harness, `engine/demand/odme.ts`, `CALIBRATION.md` candidates | Obtain counts (field or RTI) first; split calibration and validation sets; apply calibration candidates one at a time | TAG M3.1: GEH < 5 at more than 85% of **held-out** sites, screen lines within ±5%, journey times within 15%. Until then, keep the "not validated" banner, computed rather than hard-coded. |

**Suggested order:**
1. Weeks 1–2: theme 1 (data provenance and CI), plus computing the Simulate banner instead of hard-coding it.
2. Weeks 3–6: theme 2 (terrain and hydrology), theme 4 (utility confidence) and theme 5 (rule sourcing).
3. In parallel: start the data requests that gate themes 3 and 8 (PMC GeoServer, RTI for drain inverts and traffic counts, IMD IDF, borehole logs). Their templates are in [MISSING_DATA_AND_COLLECTION_PLAN.md](MISSING_DATA_AND_COLLECTION_PLAN.md).
4. Theme 6 performance and auth work before any external pilot.

**Do not build yet**, because the data cannot support it:
- 2D flood depth modelling.
- Absolute traffic forecasts.
- Air-dispersion maps.
- Settlement or tunnelling geotechnical models.
- Any ML predictor.

## 8. Open decisions for the project owner (carried forward)
- ~~Push `8c923ac`. It is local only.~~ Done: the work is on `main` (2026-11-22 update).
- Phase B cleanup (about 4.3 GiB) stays pending.
- OpenCity, IMD and AutoDCR licence treatment. These must stay internal (see [DATA_CATALOGUE §5](DATA_CATALOGUE.md)).
- Accounts and keys: Bhuvan, GSI Bhukosh, data.gov.in, OpenAQ, Copernicus Data Space.
- DEM v2 rejection: it is still `pending_review`.
- Traffic: counts source, thresholds, calibration choices.
