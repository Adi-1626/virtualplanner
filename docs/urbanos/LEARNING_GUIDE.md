# UrbanOS learning guide

A beginner-friendly path through UrbanOS. Each step lists exact files to read and a small exercise you can do on your own machine. None of the exercises change the database or the datasets: they read, run tests, or make throwaway copies.

> **Updated 2026-11-22 (IST) for `main` at `ba7a003`.** New steps 9b (curved geometry editor) and 12b (official-only facts and the data-freshness service); counts corrected. Keep [DEVELOPER_HANDBOOK.md](DEVELOPER_HANDBOOK.md) open beside this guide: it has the run commands for Windows and Linux, every dataset with its endpoint, and recipes for common changes.

Related: [DEVELOPER_HANDBOOK](DEVELOPER_HANDBOOK.md) · [START_HERE](START_HERE.md) · [PROJECT_OVERVIEW](PROJECT_OVERVIEW.md) · [DATA_CATALOGUE](DATA_CATALOGUE.md) · [DATABASE_AND_CODE_GUIDE](DATABASE_AND_CODE_GUIDE.md) · [CURRENT_STATUS_AND_ROADMAP](CURRENT_STATUS_AND_ROADMAP.md)

**Before you start**
- Backend: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`
- Frontend: `cd frontend && cp .env.example .env && npm install && npm run dev`, then open http://localhost:5173.
- Point `URBANOS_DATA_DIR` at your `urbanos-data` folder so the real datasets load. Without it (and without `/workspace/work/urbanos-data`) the terrain, Environment and municipal-layer endpoints answer "not available" instead of data.
- Optional: `TWINCITY_OSM_INDEX` (or `backend/data/osm/osm_index.db`, built with `python -m osm.build_index`). Without it, study areas load through the cached Overpass proxy (`GET /api/osm/overpass`).
- **Work on a copy of the database.** Copy `backend/twincity.db` to a scratch path and set `DATABASE_URL=sqlite:////path/to/copy.db` (Windows: `sqlite:///C:/path/to/copy.db`). Then nothing you try can damage the real registry. `twincity.db` is git-ignored; a fresh one is created and seeded on first start, but the derived datasets appear in the registry only after `python -m datasets.importer` (or `POST /api/datasets/import`).

---

## Week 1 — The big picture and GIS basics

### Step 1. What the product does (1 hour)
- Read: [START_HERE](START_HERE.md), then [PROJECT_OVERVIEW §1–§3](PROJECT_OVERVIEW.md).
- **Exercise:** open the app and press Alt+1 to Alt+7 to visit every workspace. For each one, write one sentence on what a planner would do there.

### Step 2. GIS in plain words (2 hours)
- Read: [DATA_CATALOGUE §1](DATA_CATALOGUE.md), the GIS primer.
- Key ideas:
  - **Raster**: a grid of cells, each holding a value. Example: a DEM cell 30 m × 30 m holding the ground height.
  - **Vector**: points, lines and polygons. Examples: a manhole is a point, a sewer pipe is a line, a ward is a polygon.
  - **CRS** (coordinate reference system): how numbers map onto the Earth.
    - EPSG:4326 is longitude and latitude in degrees.
    - EPSG:32643 (UTM zone 43N) is metres, and is what UrbanOS uses for distances in Pune.
  - **DSM vs DTM**: a DSM includes rooftops and trees; a DTM is bare ground. Copernicus is a DSM.
  - **Flow direction and accumulation (D8)**: each cell sends its water to the lowest of its 8 neighbours. Counting how many cells drain through a cell traces the valleys where nallas run.
- **Exercise:** with the backend running, call
  `curl "http://localhost:8000/api/terrain/point?lon=73.8567&lat=18.5204"` (near Shaniwar Wada) and then a point near Katraj (`lon=73.86&lat=18.45`). Which is higher? The response also says which DEM version answered (`dataset_version_id`).

### Step 3. Where the data comes from (2 hours)
- Read: [DATA_CATALOGUE §2–§4](DATA_CATALOGUE.md).
- Open one raw manifest, e.g. `urbanos-data/raw/copernicus_dem_glo30/2026-11-13/manifest.json`, and one derived record, `urbanos-data/derived/elevation_copdem30/v3/processing.json`.
- **Exercise:** for `pmc_sewage_pipelines`, trace raw → derived → registry. Find the OpenCity source file, the pipeline module (`backend/datasets/pipelines/opencity_pune.py`), and the row returned by `GET /api/datasets/pmc_sewage_pipelines`. Write down its licence and why it must stay internal.

---

## Week 2 — How the code is put together

### Step 4. Backend entry point (1 hour)
- Read: `backend/main.py` (table creation, routers mounted under `/api`), then skim `backend/api/` (14 router files, 17 routers).
- **Exercise:** open http://localhost:8000/docs (FastAPI's automatic API page). Find `POST /api/terrain/profile` and run it with
  `{"coordinates": [[73.85,18.52],[73.87,18.53]], "step_m": 200}`.
  Compare the response with `Dem.profile` in `backend/terrain/dem.py`.

### Step 5. Frontend entry point and shell (1 hour)
- Read: `frontend/src/main.tsx` → `App.tsx` → `frontend/src/shell/AppShell.tsx` and `frontend/src/shell/workspaces.ts`.
- Read: `frontend/src/lib/api.ts`. It holds `VITE_API_BASE` and is how the frontend calls the backend.
- **Exercise:** find where `AppShell.tsx` picks the context panel for "underground" and follow it to `shell/contexts/UndergroundContext.tsx`.

### Step 6. Trace a full workflow (2 hours per workspace)
- Read: [PROJECT_OVERVIEW §7](PROJECT_OVERVIEW.md). It traces one workflow per workspace.
- **Exercise (Explore):**
  1. Open the browser dev tools' Network tab and switch on a municipal layer.
  2. Find the `GET /api/infra/layers/{lid}/features?...` request.
  3. Follow it into `backend/api/infra_router.py`, then `query()` in `backend/datasets/infra_store.py`, then the SQLite file `derived/infra_index/v1/infra_index.sqlite`.
- **Exercise (Underground):** draw an alignment, open the Profile tab, and follow `ElevationProfile.tsx` → `POST /api/terrain/profile` → `Dem.profile`.

### Step 7. The database (2 hours)
- Read: [DATABASE_AND_CODE_GUIDE §3](DATABASE_AND_CODE_GUIDE.md).
- **Exercise (on your DB copy):**
  ```bash
  sqlite3 copy.db "select review_status, count(*) from ds_dataset_versions group by 1;"
  sqlite3 copy.db "select role, count(*) from ds_files group by 1;"
  ```
  On the 2026-11-14 database this gave 76 active, 1 pending_review and 6 superseded versions, and 10 withdrawn file rows (a freshly created and imported database will differ). Explain in your own words what "superseded" and "withdrawn" mean (see [DATA_CATALOGUE §4.2](DATA_CATALOGUE.md)).

---

## Week 3 — Engineering modules

### Step 8. Terrain and drainage (3 hours)
- Read:
  - `backend/datasets/pipelines/_hydro.py`: `flow_direction`, `accumulation`, `label_catchments`, `stream_segments`.
  - `backend/datasets/tests/test_hydro.py`.
  - `docs/urbanos/DEM_V1_V3_COMPARISON.md`.
- **Exercise:** in a Python shell, build a 5×5 numpy array shaped like a tilted plane. Run `flow_direction` and `accumulation`, and check that all water ends at the lowest edge. Then add a pit in the middle and see what happens. Pits are why real hydrology needs depression filling.

### Step 9. Underground and conflicts (3 hours)
- Read:
  - `backend/terrain/evidence.py`.
  - `backend/coordination/geometry.py`: UTM conversion and Shapely.
  - `run_detection` in `backend/coordination/service.py`.
  - `docs/urbanos/UNDERGROUND_WORKSPACE.md`.
- Key idea: **ASCE 38 quality levels** say how sure we are where a pipe is. QL-D comes from old records only, while QL-A means it was physically exposed and surveyed. Most PMC pipes have no recorded depth, so UrbanOS shows QL-D and does not invent a depth.
- **Exercise:** run `python -m pytest tests/test_coordination.py -q` in `backend/` and read one test to see how a conflict is defined (clearance distance between two elements).

### Step 9b. Curved geometry editor (2 hours)
- Read: `docs/urbanos/GEOMETRY_EDITOR_DESIGN.md` §2–§4, then `frontend/src/engine/geometry/alignment/index.ts` (the public API), `fillet.ts` (PI + radius → arc), `criteria.ts` (IRC tables, each value with its source string) and `checks.ts` (screening flags).
- Then `frontend/src/engine/editing/AlignmentEditor.ts` (grips, one undo step per change) and `geometryCommit.ts` (what happens on release: regenerate → rejoin ends → T-splits → crossings → flyover ramps → road sections by chainage → one batch).
- **Exercise:** run `npx vitest run src/engine/testing/GeometryFillet.test.ts src/engine/testing/GeometryCommit.test.ts` and read one test of each. Then, in Design, draw a road, select it, drag a radius grip and undo it with Ctrl+Z.

### Step 10. Environment (2 hours)
- Read: `aq_series` in `backend/envdata/series.py`, plus `backend/envdata/render.py` and `docs/urbanos/ENVIRONMENT_DATA.md`.
- **Exercise:**
  1. Call `GET /api/env-data/air/series` for a station listed by the API.
  2. Compare the daily mean with the raw CPCB CSV in `derived/cpcb_caaqms_pune/`.
  3. Note that `series.py` hard-codes the version folder. This is one of the Phase 3 clean-up items.

### Step 11. Traffic simulation (4 hours)
- Read:
  - `frontend/src/engine/simulation/TrafficMicroSim.ts`: `idmAcceleration` (the Intelligent Driver Model, where each car speeds up or brakes based on the gap to the car ahead).
  - `frontend/src/engine/simulation/SimulationMode.ts`: `captureBaseline`, `runComparison`.
  - `docs/ENGINEERING_VALIDATION.md` §4–§5.
- Key idea: **calibration** tunes a model to observations; **validation** checks it against *different* observations. GEH is a standard score comparing modelled and counted flows, and GEH < 5 at more than 85% of sites is the target. UrbanOS currently has 0 of 15.
- **Exercise:** run one baseline and one proposal comparison in Simulate and read the banner. Then find that banner text in `frontend/src/shell/contexts/SimulateContext.tsx`. It is hard-coded, not computed, which is a Phase 3 fix.

---

## Week 4 — Data provenance and contributing safely

### Step 12. Registry and provenance (2 hours)
- Read:
  - `backend/datasets/registry.py`: `add_version`, `review_version`, `active_version`.
  - `backend/datasets/quality.py`: `run_checks`, `WITHDRAWN_ROLE`.
  - `backend/datasets/provenance_check.py`.
  - `docs/urbanos/DATA_QUALITY_AND_PROVENANCE.md`.
- **Exercise:** run `URBANOS_DATA_DIR=... python -m datasets.provenance_check` from `backend/`. Expect every file to match except one accepted exception (the superseded tree-index `processing.json`) and one unregistered input. Explain both using [DATA_CATALOGUE §7](DATA_CATALOGUE.md) and [DATA_RETENTION_AUDIT §11](DATA_RETENTION_AUDIT.md).

### Step 12b. Official-only facts and the data-freshness service (2 hours)
- Read: `backend/updater/official.py` (the one allow-list: any `*.gov.in` / `*.nic.in` host plus `punemetrorail.org`, `mahametro.org`, `sansad.in`, `msrdc.in`; news never), its UI mirror `frontend/src/lib/officialSources.ts`, then `docs/urbanos/DATA_FRESHNESS_SERVICE.md` §1–§4 and §11.
- Then `backend/updater/__main__.py` (all CLI commands), `review.py` (approve → apply → new registry version) and `frontend/src/engine/underground/reportedFacts.ts` (where an approved official tunnel depth appears: the Underground hover tooltip, never the drawing).
- **Exercise (on your DB copy):** `python -m updater check-config`, then `python -m updater evaluate` (offline golden test on the seed quotes), then `python -m updater run --dry-run` (fetches official pages, writes nothing). Open Reports → Data catalogue → Fact updates and read one proposal card.

### Step 13. Run every check (1 hour)
- Backend: `python -m pytest -q` in `backend/` (258 passed on 2026-11-14; there are now 36 test files, so expect more).
- Frontend:
  - `npx tsc -p tsconfig.app.json --noEmit` (note: `-p .` checks nothing)
  - `npx oxlint`
  - `npm test` (772 passed, 7 skipped on 2026-11-14 with 102 files; there are now 130)
  - `npm run build`
- **Exercise:** make a one-line harmless change on a scratch branch, run all five checks, then discard it.

### Step 14. Pick a Phase 3 starter task
- Read [CURRENT_STATUS_AND_ROADMAP §5 and §7](CURRENT_STATUS_AND_ROADMAP.md). Good first tasks:
  1. Compute the Simulate validation banner from the validation data instead of hard-coding it.
  2. Make `GET /api/datasets` side-effect free, and add a test that the DB is unchanged after a GET.
  3. Add NASADEM to the elevation pipeline's recorded inputs.
  4. Unify `datasets/paths.py` and `envdata/paths.py`.

**Rules for contributing:**
- Never commit datasets, archives, DB backups or secrets.
- Keep restricted data internal.
- Label every new value as measured, estimated, inferred or hypothetical.
