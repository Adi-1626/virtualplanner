# UrbanOS (VirtualPlanner) — Handover for Claude Code

Written 2026-11-27 by Hark. Read this first, then `docs/urbanos/START_HERE.md` and `DEVELOPER_HANDBOOK.md`.

## 1. What the project is
UrbanOS is a Cesium 3D digital twin of Pune (React/TypeScript frontend, FastAPI + SQLite backend, OSM import, in-browser IDM micro-simulation). It is a decision-support tool for city planners (PMC, PCMC, Maha-Metro, PMRDA): Select area → Understand → Explore improvements → Simulate → Compare → Decide. It is not a game. Cities: Skylines 2 only inspires tool ergonomics; every default comes from a real standard (IRC, CPHEEO, Pune USDG). Correctness and honesty come before visuals.

## 2. Repository
- Origin: https://github.com/Adi-1626/virtualplanner (owner Aditya). Upstream `sumedhpatil2005` — do not touch.
- All local branches were pushed to origin on 2026-11-27. origin main = p17-all = 852936b (fast-forwarded 2026-11-27 with user approval).
- Restore offline: `git clone UrbanOS-git-history.bundle urbanos` (bundle is in the zip the user holds).

### Branch lineage (newest last)
| Branch | Head | What |
|---|---|---|
| next-phase / origin main (before p17) | c83ccd9 | p5–p7: cross-sections, design tools, realistic visuals |
| p8-basemap | 4f7849e | ion → OSM → neutral ground fallback |
| p9-calibration | 34ead66 | calibration framework |
| p10-estimated | 312e731 | estimated city-wide traffic dataset (OFF by default) |
| p11-sim | c8f311a | simulate user-test fixes (NOT in p17-all; merge decision pending) |
| p12-flow | ede84db | Simulate→Improve→Design→re-test→Compare flow (NOT in p17-all; pending) |
| p13-validation | fd4b984 | project validation vs estimated data (fails hold-out) |
| p14 | dccebe9 | synthetic land use + demand v2 ("Synthetic demo model", OFF) |
| p15-demo | 434e209 | demo mode, gateway balancing, logging, no-red-errors sweep |
| p16-citywide | 4f85c3e | 41-area city-wide harness + fixes (fix3 30/164) |
| p17-access / p17-junction / p17-oldcity | 0568d10 / d756529 / b962fdd | the four weak-spot fixes |
| **p17-all = main** | 852936b | integration of p17 work |
| p18-pass (pushed, not main) | see git log | harness 50/164 adopted (meter + zip merge); opt-in switches: pockets (POCKET_STREETS), gap delay (P14.priorityGapDelay), unsigned-local gap delay (P14.unsignedLocalGap, MVDR 2017 Reg 7/9); pockets + unsigned-local = 62/164 but D1 +1 / M1 +7 vs adopted, so not adopted; docs/urbanos/P18_PASS.md, run dir /workspace/work/p18-run (STATUS_p18.md, mz.jsonl, pkme.jsonl, classify.md). Branch p18-entry: dropped experiment F (entry give-way, no effect) |
| p19-demand (pushed, not main) | see git log | demand v4 (congested-time feedback) + V4CC: eligible on hold-out/official but harness 49/164 (hc) and 66/164 with pockets+E (hcpke), M1/D3 worse, not adopted; fix G adopted (ROOM_ANY_LANE + ENTRY_GIVE_WAY default on, harness mzg 51/164, M1 32 -> 20); docs/urbanos/P19_DEMAND.md, run dir /workspace/work/p19-run (STATUS_p19.md, RULE_p19.md, hc/hcpke/mzg.jsonl). Next: pre-register pockets + meter + E on top of G |
| p16-m1 | e8b4a25 | rejected experiment (JOIN_JUNCTION_M 24 broke 4 tests) |

Other old branches (ug-*, underground-*, geom-*, dr-*, p4–p7 parts) are already merged into c83ccd9.

## 3. Hard rules (from the user)
- Never fake a pass, loosen a threshold, or change a band after seeing results. Bands live in `frontend/src/engine/testing/citywideBands.ts` (fixed in 8d141c8).
- Data: official/certified sources only (gov.in, nic.in, Maha-Metro, PMC, CPHEEO/MoHUA, IRC). Never news. Unknown stays unknown, never 0. Estimated and synthetic data are allowed but must be labelled `estimated` / `synthetic`, kept separate from official data, never called measured.
- Labels: measured / modelled / inferred / assumed. Never call screening "safety", "feasibility" or "compliance".
- Synthetic model default ON only if hold-out passes AND official 15-site check is not worse than the area estimate (2/15, river −26.5%). Currently OFF.
- Demo mode: no synthetic wording on main screens; one neutral line under Data sources.
- UI errors: no red error styling. Short user-facing message + reference ID with Copy. Red only for traffic conditions/results.
- Simulation quality is top priority; it must work anywhere in Pune (any road, bridge, lane).
- Read PDFs by code only (pdftotext; OCR only for scans).
- Never modify `backend/twincity.db` — use copies. No case-only filename differences (Windows).
- Push to main only with the user's approval.

## 4. How to run and test
- Backend: `cd backend && uvicorn main:app --port 8000` (see README / `Add run commands` commit). Frontend: `cd frontend && npm install && npm run dev`.
- Gates: `npx tsc -p tsconfig.app.json`, `npx oxlint`, `npx vite build`, `vitest --maxWorkers=1` in chunks (NODE_OPTIONS=--max-old-space-size=4096), `pytest` in backend.
- City-wide harness: `frontend/src/engine/testing/P16Citywide.test.ts` with env `P16=1 P16_MODE=eval P16_MICRO=1 P17_ACCESS=buildings`, demand asset `urbanos-data/synthetic/demand-v1/out/pune_synthetic_demand_v2.json`, trip ends `trip_ends.csv.gz`. Script: `p17-run/all_run.sh TAG` (9 chunks, resumable, ~30 min on 2 CPUs). Tables: `p17tables.py fix3.jsonl X.jsonl`. R3 comparison: `p16-run/r3cmp.py`.
- Official 15-site check: backend on a DB copy, compare with `p16-run/head.score.txt`.

## 5. Results so far (honest)
City-wide harness, 41 areas × 4 hours (09/14/19/23) = 164 area-hours:
- Baseline 36/164; fix3 (p16 HEAD) 30/164 (37 on pre-registered R3); p17-all final defaults 48/164 with every band total ≤ fix3 (D1 33, D2 80, D3 0, M1 47, M2 66, N2 4, R3 56 vs fix3 36/82/0/70/67/4/89).
- Fringe areas 4/16 → 12/16 (access nodes); M1 peak gridlock at 09:00 24 → 15.
- Official 15-site: 1/15 GEH<5, river +44.1% → synthetic default stays OFF. Hold-out FAIL (JT 7/28, counts 2/16).
- Gates on a40e052: tsc 0, oxlint 0 errors/19 warnings, vite build OK, vitest 1,431 passed/17 skipped, pytest 490 passed.
- Details: `docs/urbanos/P17_FIXES.md`, `CITYWIDE_P16.md`, `OLDCITY_P17.md`.

### p17 adopted defaults (a40e052)
Access nodes ON; micro-sim courtesy 60 s for starved minor approaches at priority junctions, entry queue per road, lane pre-sorting (150 m); one signal per junction; decel-accel delay term (≤5 s); closed-access roads (military etc.) are local-only. Webster signal timing in assignment OFF (kept as `signalTiming: 'webster'` option) because it worsened D1/D3.

## 6. Unfinished work — exact next steps
1. Confirmation run of final defaults: `cd /workspace/work/p17-run && ./all_run.sh final` then `python3 p17tables.py ../p16-run/fix3.jsonl all_nowb.jsonl final.jsonl`; fill §5b of P17_FIXES.md; re-check adoption rule (total ≥ 30, no band worse than fix3). DONE 2026-11-27 19:12 IST: 48/164, all bands ≤ fix3 (P17_FIXES §5b).
2. DONE: origin main fast-forwarded to p17-all 852936b (2026-11-27).
3. Remaining weak spots: peak D2 over-capacity at minor give-way approaches (real v/c>1); Sangam Bridge p16_05 downstream signal box saturated (flow-ratio sum 1.73–2.19) — needs signal plan/capacity, not a model trick; IT park p16_13 still 7 gridlocked vehicles at 09:00; MIDC M2 queues; R3 access in old city.
4. Replays at p16_06/15/16 were done with 30 s courtesy; re-run with 60 s.
5. Merge decisions: p11-sim and p12-flow into p17-all line; p12/p13 validation banners (project check as ValidationCheck entry).
6. Visual backlog: p10 visual bugs (`urbanos/shots/p10/shots.md`), 18 tour findings (`shots/tour/shots.md`): crossings, bus stops, FOB/subway, roundabouts, underground-on-surface, https tiles, terrain label.
7. Logging gaps: `NO_ROADS_IN_AREA`, `AREA_TOO_LARGE` lack routes; CORS doesn't expose `Content-Disposition`/`X-Findings`.

## 7. Open decisions for the user
1. Show the demo-mode switch on the site? Catalogue synthetic wording?
2. Courtesy rule: minor roads may force entry after 60 s (departs from "main roads never yield"; sourced: Dutta & Ahmed 2017 doi 10.1007/s40534-017-0151-9; TRR 2020 doi 10.1177/0361198120925258).
3. Merge p11-sim / p12-flow; p12/p13 banners.
4. Ever enable estimated flows (`useEstimatedTraffic`, OFF)?
5. Confirm defaults: IRC:86-2018 speeds, 2.0 m footpath, superelevation 4%/7%, flyover grades 4%/3.3%, 50 m cut-and-cover, CPHEEO 3.0/0.5 m, Realistic/box-girder/Medium tier, CC0 textures.
6. Which Pune corridor to prove end to end; RTI drafts need address/email/phone/₹10 fee.
7. Optional official IRC copies; gated data logins (Bhuvan, GSI, data.gov.in, Copernicus); real Cesium ion token.

## 8. Data and environment notes
- `urbanos-data/estimated/` (traffic-v1, validation-v1) and `urbanos-data/synthetic/` (landuse-v1, demand-v1) are in the zip. `raw/` (3.2 GB) and `derived/` (2.9 GB) are NOT — re-create with the import scripts in DEVELOPER_HANDBOOK.md.
- Sandbox had 2 CPUs / 8 GB: one heavy job at a time (`flock heavy.lock`). On a PC you can run chunks in parallel.
- Run dirs in the old sandbox (not in zip): p16-run, p17-run (jsonl results), urbanos/shots/p10–p17.
