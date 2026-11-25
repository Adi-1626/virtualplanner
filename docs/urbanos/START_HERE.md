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
| 2a | [DEVELOPER_HANDBOOK §5.7 Logs and errors](DEVELOPER_HANDBOOK.md#57-logs-and-errors) | Where the backend log is (`backend/logs/urbanos.log`), its env vars, how to match the Reference in an on-screen error to its log line, the error codes and messages | 10 min |
| 3 | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Product, architecture, the 7 workspaces, folder structure, one traced workflow per workspace | 30 min |
| 4 | [DATA_CATALOGUE.md](DATA_CATALOGUE.md) | A GIS primer, every raw and derived dataset with sizes and lineage, licences, the Phase A deletion manifest | 45 min |
| 5 | [DATABASE_AND_CODE_GUIDE.md](DATABASE_AND_CODE_GUIDE.md) | The important files and functions, all 168 API endpoints, 44 DB tables, configuration, tests | reference |
| 6 | [CURRENT_STATUS_AND_ROADMAP.md](CURRENT_STATUS_AND_ROADMAP.md) | What changed since 2026-11-14 (§0), what works, what is partial, the DEM and traffic verdicts, the Phase 3 plan | 20 min |
| 7 | [LEARNING_GUIDE.md](LEARNING_GUIDE.md) | A step-by-step study plan with exact files and hands-on exercises | 1–2 weeks |

## Traffic documents (Simulate)

Read in this order; each phase re-runs the same 15-site validation (TAG M3.1).

| Phase | Document | What it holds |
|---|---|---|
| P9 | [TRAFFIC_CALIBRATION_P9.md](TRAFFIC_CALIBRATION_P9.md) | The count sites, the calibration / hold-out split, edge-flow calibration and why it fails |
| P10 | [TRAFFIC_ESTIMATED_P10.md](TRAFFIC_ESTIMATED_P10.md) | The city-wide ESTIMATED traffic dataset (project-level, not for decisions) and why it is not used for edge flows |
| P11 | [SIM_USER_TEST_P11.md](SIM_USER_TEST_P11.md) | The planner workflow, the p11 validation record (zone demand and estimate match tried, not shipped), three scenarios end to end (Katraj flyover, Baba Bhide Bridge closure, Sinhagad Road widening), every bug fixed, the verdict and remaining gaps |
| P13 | [VALIDATION_P13.md](VALIDATION_P13.md) | Project-level check against ESTIMATED data (Google typical journey times, published 2021 counts), kept apart from the official-count check: count-matching fix, why the model is too fast and gridlocks, SPSA tuning and ODME on calibration only, hold-out verdict (fails, default and tuned), tuned parameters opt-in, banner states |
| P14 | [SUPPLY_P14.md](SUPPLY_P14.md) | Supply model for Indian urban roads (Indo-HCM 2017, IRC:106-1990, IRC:86-2018, IRC:65-2017): free-flow speed by class / typology / lane width / side friction capped by the posted limit, Indo-HCM PCUs and capacities, Indo-HCM speed-flow fit, unsignalised and roundabout delay, inferred signals; all parameters in `supplyConfig.ts` with labels and sources; supply-only re-run of the p13 check (night fixed, 09:00 worse, still fails); opt-in, app default unchanged |
| P14 | [DEMAND_P14.md](DEMAND_P14.md) | SYNTHETIC land-use 4-step demand (v2: trip lengths by jurisdiction from CMP-2024, outer-cordon traffic) joined with the p14 supply; calibration-only screening (S10 chosen), record fix for two bridge counts, 60-iteration hold-out (fails: JT 8/28, counts 2/16, river +17.4 %; better than p13 but not passing), official check worse (1/15); stays the opt-in "Synthetic demo model" with an honest banner; browser check at Katraj and Hinjewadi |

## Seven facts to remember
1. **Seven workspaces**: Explore, Design, Underground, Environment, Simulate, Projects, Reports (`frontend/src/shell/workspaces.ts`).
2. **The data has a paper trail.**
   - Raw files sit in `urbanos-data/raw/<source>/<date>/` with a `manifest.json`.
   - Processed files sit in `urbanos-data/derived/<dataset>/<version>/` with a `processing.json`.
   - The Dataset Registry (`ds_*` tables, `/api/datasets`, Reports → Data catalogue) records the status and licence of each one.
   - None of the data, the OSM index or `twincity.db` is in git: copy it from the dev machine or rebuild it (handbook §2.5).
3. **Terrain is screening-grade.** DEM v3 is Copernicus 30 m, a surface model rather than bare earth. Use it to see trends, never for design levels.
4. **The traffic model is not validated.** It fails UK TAG M3.1 (2 of 15 counts reach GEH < 5, hold-out 1 of 8; river screen line −26.5 %). Use it only to compare alternatives against each other.
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
