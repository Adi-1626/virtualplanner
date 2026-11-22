# Start here — UrbanOS

UrbanOS is a 3D decision-support tool for city planning in Pune. Planners pick an area, see what is there (roads, buildings, terrain, sewers, storm drains, trees, air quality, rainfall), sketch alternatives (a new road, a flyover, an underground alignment), screen them for conflicts and constraints, compare them, and export a report. It is a tool for planning authorities, not a game.

It is built on VirtualPlanner:
- Frontend: React and Cesium in `frontend/`.
- Backend: FastAPI and SQLite in `backend/`.
- Real data: under `urbanos-data/` (outside the repo, set by `URBANOS_DATA_DIR`; on the dev machine `/workspace/work/urbanos-data`).

**Honesty rule.** Every value is labelled as measured, modelled/estimated, inferred or hypothetical; outputs are screening, never compliance or approval; unknown stays unknown; facts about projects come only from official government or agency sites.

Status (updated 2026-11-22 IST):
- All UrbanOS work is on `main` of `Adi-1626/virtualplanner` (last checked at `ba7a003`). CI runs on `main`.
- Since the first version of these guides (2026-11-14): official-only project facts and the data-freshness updater, Underground screening with reports, the curved geometry editor, live traffic in a Web Worker, Environment refinement and render-on-demand, Projects refinement, an Overpass proxy for fresh clones.

## The guides, in reading order

| # | Document | Read it to learn | Time |
|---|---|---|---|
| 1 | **START_HERE.md** (this file) | What UrbanOS is and where to go next | 5 min |
| 2 | **[DEVELOPER_HANDBOOK.md](DEVELOPER_HANDBOOK.md)** | **The practical guide**: product goal and honesty rules; every dataset with publisher, licence, official or not, files, pipeline, registry id, endpoint and the feature that uses it; the official-only rule and the updater (CLI and review flow); architecture and code map; running on Windows and Linux; tests; pitfalls; how to add a road type, a check, a dataset or a report section; known limits | 1–2 h, then reference |
| 3 | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Product, architecture, the 7 workspaces, folder structure, one traced workflow per workspace | 30 min |
| 4 | [DATA_CATALOGUE.md](DATA_CATALOGUE.md) | A GIS primer, every raw and derived dataset with sizes and lineage, licences, the Phase A deletion manifest | 45 min |
| 5 | [DATABASE_AND_CODE_GUIDE.md](DATABASE_AND_CODE_GUIDE.md) | The important files and functions, all 168 API endpoints, 44 DB tables, configuration, tests | reference |
| 6 | [CURRENT_STATUS_AND_ROADMAP.md](CURRENT_STATUS_AND_ROADMAP.md) | What changed since 2026-11-14 (§0), what works, what is partial, the DEM and traffic verdicts, the Phase 3 plan | 20 min |
| 7 | [LEARNING_GUIDE.md](LEARNING_GUIDE.md) | A step-by-step study plan with exact files and hands-on exercises | 1–2 weeks |

## Seven facts to remember
1. **Seven workspaces**: Explore, Design, Underground, Environment, Simulate, Projects, Reports (`frontend/src/shell/workspaces.ts`).
2. **The data has a paper trail.**
   - Raw files sit in `urbanos-data/raw/<source>/<date>/` with a `manifest.json`.
   - Processed files sit in `urbanos-data/derived/<dataset>/<version>/` with a `processing.json`.
   - The Dataset Registry (`ds_*` tables, `/api/datasets`, Reports → Data catalogue) records the status and licence of each one.
   - None of the data, the OSM index or `twincity.db` is in git: copy it from the dev machine or rebuild it (handbook §2.5).
3. **Terrain is screening-grade.** DEM v3 is Copernicus 30 m, a surface model rather than bare earth. Use it to see trends, never for design levels.
4. **The traffic model is not validated.** It fails UK TAG M3.1 (0 of 15 counts reach GEH < 5). Use it only to compare alternatives against each other.
5. **Project facts are official-only.** `backend/updater/official.py` is the one allow-list (`*.gov.in`, `*.nic.in`, Maha-Metro, Parliament, MSRDC); news is never a source, and a named reviewer approves every change.
6. **Much of the municipal data is licence-restricted** (OpenCity/PMC, IMD, AutoDCR). It must stay internal.
7. **Never commit `twincity.db`, data or `.env`**, and never add two files whose names differ only by case (it breaks Windows).

## Older docs worth knowing
- `docs/urbanos/DATA_FRESHNESS_SERVICE.md`: how to run and schedule the updater, review in the app, the official-only migration.
- `docs/urbanos/UNDERGROUND_CHECKS.md`, `GEOMETRY_EDITOR_DESIGN.md`, `ENVIRONMENT_WORKSPACE.md`, `SIMULATE_WORKSPACE.md`, `PROJECTS_WORKSPACE.md`: one guide per recent feature.
- `docs/urbanos/PHASE2_FINAL_REPORT.md`: the data acquisition summary. Its test counts and DEM status are partly outdated; see the roadmap doc, §3.
- `docs/urbanos/DATA_RETENTION_AUDIT.md`: the cleanup audit and the Phase A record (§11).
- `docs/urbanos/DEM_V1_V3_COMPARISON.md`: why DEM v3 is active.
- `docs/ENGINEERING_VALIDATION.md`: the traffic validation evidence.
- `docs/urbanos/MISSING_DATA_AND_COLLECTION_PLAN.md`: what data is missing and how to request it.
