# Demo mode and the 09:00 over-saturation (branch `p15-demo`)

Branch `p15-demo` from `p14` (dccebe9). Two parts: (A) legitimate structural fixes for the 09:00 over-saturation of the
synthetic demo model, re-screened on the calibration records and evaluated once on every record; (B) how the app presents
the model, changed on 2026-11-25 at the user's request.

Hard rules kept: no threshold loosened, no fitting on the hold-out (the hold-out was evaluated once, after the choice),
targets, split (50/50, seed 13) and TAG M3.1 criteria unchanged; nothing shows a "validated" or pass state the record does
not support; the synthetic data stays labelled synthetic where it is disclosed (Data catalogue, docs, record, exports).

## 1. Part A: what was checked and changed

Baseline: p14 S10 (DEMAND_P14.md §6-7): hold-out journey times 8/28 within 15 % (09:00 1/14, 23:00 7/14), counts 2/16
within GEH 5, river +17.4 %; official 1/15 sites, river +42.5 %; Satara Rd 65.8 min vs Google 16, Hinjewadi 54.7 vs 9.

### 1.1 Peak-hour share (item 1): already within CMP-2024; no change

The 13.8 % figure is the RAW assumed purpose shapes in `landuse-v1/trip_rates.json` (`hourly_departure_profiles`). The
v2 build (`build_demand.py`, "hourly IPF to the vehicle profile") already fits them by IPF so each hour's city vehicles
follow the project's all-vehicle profile (pune_hourly_profile_v1, Mendeley 2023 CCTV). From the installed asset
(`pune_synthetic_demand_v2.json`, `checks.hourlyVehicleTrips`):

| Quantity | Value | Reference |
|---|---|---|
| City vehicle trips 09:00-10:00 / day | 369,766 / 4,954,651 = **7.46 %** (busiest hour of the day: 19:00, 7.81 %) | CMP-2024 peak-hour factor 9.6 % (AM peak 09:30-10:30; trip_rates.json `cmp2024_trip_end_model_peak_hour`, CMP-2024 Table 3-13 note) |
| HBW, both directions, 09:00 share of HBW trips | (18.86 % out + 0.14 % return) / 2 = **9.5 %** | 9.6 % |
| HBW outbound (home → work) at 09:00 | 18.9 % of outbound HBW (raw assumed shape: 33.0 %) | no Pune source by purpose and direction |

The peak hour is already spread to below CMP's factor; raising it to 9.6 % would add 09:00 traffic. Left unchanged.

### 1.2 Diagnosis on calibration records (S10, 09:00, 15 iterations, route decomposition)

`P14_MODE=diag P14_ROUTE_DIAG=1` on three calibration corridors (`/workspace/work/p15-run/diagS10.jsonl`):

| Record (calibration) | Google 09:00 | S10 | area demand 09:00 | through | between buildings | worst link v/c |
|---|---|---|---|---|---|---|
| jt07 Solapur Rd, Pulgate → Hadapsar | 20 min | 62.3 min | 58,705 veh/h | 51 % | 3.6 % | 2.05 (trunk, 1 lane) |
| jt11 Old Mumbai Rd, Bopodi → Shivajinagar | 15 | 80.0 | 96,059 | 56 % | 4.1 % | 1.79 (trunk, 3 lanes, 7,837 PCU/h) |
| jt27 Sangamwadi, RTO → Yerwada | 16 | 81.2 | 90,552 | 50 % | 5.4 % | 2.93 (trunk, 2 lanes) |

At 23:00 the same corridors are within or near 15 % (v/c ≤ 0.9). The time goes into congestion on a few main-road links
loaded at v/c 1.8-2.9 (p14 speed-flow: linear above capacity, ≈ 20-38 × free-flow time there). About half of each area's
09:00 traffic is THROUGH traffic: every zone pair's city path is the one uncongested shortest path on the main-road
skeleton, so all of it piles onto the same corridor and enters at the same boundary road.

### 1.3 Gateway loading (item 2): implemented, bounded, checked at the two 09:00 hot spots

`balanceGateways` (commit 3807617, `frontend/src/engine/demand/syntheticDemand.ts`): per side of the area (entering,
leaving), a boundary road loaded above `gatewayBalance` × its capacity (lanes × Indo-HCM lane capacity by road rank)
keeps traffic up to that and hands the excess to other boundary roads with spare capacity, only where the area's roads
lead from the new boundary road to the trip's other end. Totals are kept; nothing is dropped.

Two changes in this phase (resume):

- **Memory bound (the crash).** Each moved trip was split over every candidate boundary road within 3 km, so on a large
  area the plan multiplied (Satara Rd at 09:00: one vitest process at 5.7 GB RSS, killed by the kernel OOM killer,
  `dmesg`: "Out of memory: Killed process … (node) anon-rss:5744884kB"). That, not a test failure, is what ended the
  60-iteration evaluation ("Worker exited unexpectedly"). A moved trip now goes to at most `GATEWAY_SPREAD_K = 4` boundary
  roads (the best by spare capacity × distance decay that reach its other end). Same Satara run: peak ≈ 4.0 GB, completes.
- **Reach (item 2, "spread over all reachable boundary roads").** New option `gatewayReachM`: default 3,000 m (nearby
  roads, decay 1 km, the 3807617 behaviour); `0` = every boundary road of that side that reaches the trip's end, nearest
  first by a 3 km decay, farther ones as those fill. Unit test in `SyntheticDemandP14.test.ts`.

Route-diagnosis runs at the two hot spots (hold-out records; diagnosis only, nothing fitted to them; 30 iterations;
`/workspace/work/p15-run/hot_*.jsonl`):

| Record, 09:00 (hold-out) | Model | Google min (km) | Model min (route km) | running / junction delay / link congestion (min) | Worst link v/c | Area demand veh/h | Moved between boundary roads veh/h |
|---|---|---|---|---|---|---|---|
| jt01_satara_katraj_swargate | S10 (p14 record) | 16 (4.8) | 67.3 (8.2) | 33.1 / 23.7 / 10.0 | 1.76 (trunk) | 96,861 | 0 |
| jt25_hinjewadi_wakad_phase1 | S10 (p14 record) | 9 (2.2) | 55.2 (3.2) | 9.4 / 4.9 / 39.7 | 2.36 (primary) | 46,501 | 0 |
| jt01_satara_katraj_swargate | S10 + gateway loading, nearby roads (gb1, chosen by loss) | 16 (4.8) | 67.7 (8.3) | 33.5 / 23.6 / 10.0 | 1.81 (trunk) | 96,861 | 26,358 |
| jt25_hinjewadi_wakad_phase1 | S10 + gateway loading, nearby roads (gb1, chosen by loss) | 9 (2.2) | 55.3 (3.2) | 9.3 / 5.0 / 39.9 | 2.33 (primary) | 46,501 | 6,970 |
| jt01_satara_katraj_swargate | S10 + gateway loading, all boundary roads (gbA) | 16 (4.8) | 65.2 (7.9) | 30.9 / 24.2 / 9.6 | 1.83 (trunk) | 96,861 | 26,358 |
| jt25_hinjewadi_wakad_phase1 | S10 + gateway loading, all boundary roads (gbA) | 9 (2.2) | 52.1 (3.8) | 12.0 / 19.4 / 20.2 | 2.08 (primary) | 46,501 | 6,970 |

### 1.4 Mixed traffic: two-wheeler PCU and capacity (item 2): consistent, no change

The p14 supply loads links in Indo-HCM 2017 mid-block PCUs (two-wheeler 0.22, car 1.0, auto 0.90, bus 4.60, truck 3.90;
`supplyConfig.ts` `pcuMidblock`) against Indo-HCM base capacities in the same unit (2-lane undivided 1,200, 4-lane divided
1,350, 6-lane 1,400, 8-lane 1,700 PCU/h/lane). The gateway capacities and the city-wide skeleton loading
(`congestedSkeletonTimes`) use the same `pcuMidblock` set. The build script's IRC:106-1990 set (two-wheeler 0.75) is used
only for its reported city PCU totals, never for loading. So the PCU unit and the capacities match; a two-wheeler is not
over-weighted on the links. No change.

### 1.5 Intrazonal leakage (item 2): negligible, no change

New check in the area plan (`provenance.synthetic.intrazonalEdgeVph`): intrazonal trips (both ends in one zone) that cross
the area's edge. At 09:00: Satara Rd 17 veh/h of 96,861; Hinjewadi 284 of 46,501 (0.6 %). Intrazonal trips are not loaded
on the city skeleton (`o !== d`) and are not counted as through traffic. They are not what overloads the main roads.

### 1.6 Demand against CMP-2024 (resume, 2026-11-25 evening): totals are not inflated

The 09:00 over-saturation was checked against the CMP-2024 report itself (local copy
`urbanos-data/raw/traffic-p10/pdf/cmp_pmr_update_2024_final.txt`, read as text). Script output:
`/workspace/work/p15-run/cmp_check.txt`.

| Quantity | Model (v2) | CMP-2024 | Reading |
|---|---|---|---|
| Motorised person trips / day (internal) | 9.43 M | 10.38 M (Table 3-3, internal-internal: TW 5.02 M, car 1.74 M, IPT 2.17 M, PT 1.46 M; these are passenger trips, Table 3-18) | model 9 % lower |
| Road vehicle trips / day (2W + car + auto, internal) | 4.35 M | 4.76 M (Table 3-3 ÷ the model's occupancies 1.51 / 2.47 / 2.97) | model 9 % lower |
| All road vehicle trips / day (with cordon traffic, freight, bus) | 4.95 M | — | — |
| Vehicles in the morning peak hour | 369,766 (09:00-10:00) | ≈ 488,000 (Table 3-18: 717,548 private + 180,360 IPT passenger trips in the 09:30-10:30 peak hour, split 2W/car as Table 3-3, ÷ occupancy) | model 24 % lower |
| Mode split (walk, cycle, 2W, IPT, car, bus, metro) | PMC 26.7 / 0.4 / 34.8 / 17.6 / 10.0 / 8.7 / 1.8 % | Table 2-55 (+ the 2026 metro adjustment of trip_rates.json) | fitted, equal |
| Occupancy 2W / car / auto | 1.51 / 2.47 / 2.97 | Metro DPR 2A/2B Table 3-24 (UMTC 2021 screen lines, peak); CMP-2024 prints no occupancy table | most recent urban source; whole-day 2008 values (1.56 / 2.91 / 2.32, PMC DP) would give fewer cars and more autos, about the same vehicles |
| Jobs in the Hinjewadi zones | 226,737 (Hinjawadi CT) + 92,152 (Maan, Marunji) | CMP-2024 Annex 2.2 (exact); MIDC 2,17,412 for RGIP alone (May 2024) | not over-concentrated: zone totals are CMP's; the employer anchors only place them on buildings |
| PCU on the links | Indo-HCM mid-block (2W 0.22) against Indo-HCM capacities | — | consistent (§1.4); the IRC set (2W 0.75) only in the build script's reported PCU totals |

So the city demand is at or below CMP-2024 on every total; the model's 09:00 hour is lighter than CMP's own peak hour.
Reducing city trips to cure the 09:00 jams would contradict the source. Two things in the demand were not consistent
with CMP-2024 and were fixed (attempt 1, demand v3); a second, structural attempt changed how through traffic reaches an
area (attempt 2).

### 1.7 Attempts after §1.6 (rules written before each screen ran: `/workspace/work/p15-run/RULE_attempt1.md`, `RULE_attempt2.md`)

Both screened on CALIBRATION records only (15 iterations, p14 supply, same harness); the hold-out was evaluated once,
after the choice, and never used to choose. Incumbent: S10gb1k4 on demand v2 (screen J 5.4934, `screen2.merged.jsonl`).

| Attempt | What changed | Calibration screen (15 it) | Rule outcome | 60-iteration run, every record |
|---|---|---|---|---|
| 1. Demand v3 (`pune_synthetic_demand_v3.json`) | Purpose split by jurisdiction (CMP-2024 Table 2-37) and the gravity beta fitted to CMP-2024 **motorised** trip lengths by jurisdiction (Table 2-38, motorised row) instead of all-mode lengths; trip totals unchanged | V3 m0.8 J **5.4908**, V3 m1.0 J 5.6513 (incumbent 5.4934; the margin, 0.003, is within what 15 iterations resolve) | V3 m0.8 wins the screen as the rule was written | `pipeline3.log`: calibration JT 7/28 (09:00 3/14, 23:00 4/14), counts 2/16, river −25.7 %; **hold-out JT 7/28 (09:00 0/14, 23:00 7/14), counts 1/16, river +10.1 %**; loss 5.635; pass: no |
| 2. Congestion-aware city paths (`cityCongestion = 4`, MSA on the main-road skeleton) on demand v3 + attempt-1 set | Zone-pair city paths (which boundary road a trip enters by, whether it passes through) from a capacity-restrained city loading instead of the one free-flow shortest path | V3 …cc4 J **5.672** (cal JT 5/28, counts 2/16, river −22.6 %) | higher than attempt 1 (5.4908): not adopted, no hold-out run | — |

**Demand v3 is not chosen.** Its hold-out fails (no record passes; 09:00 journey times 0/14 on the hold-out) and on the
hold-out it is no better than the p14 S10 record on journey times (7/28 vs 8/28) or counts (1/16 vs 2/16); only the river
crossings move closer (+10.1 % vs +17.4 %). The two 09:00 hot spots barely move (Satara Rd 64.1 min vs Google 16;
Hinjewadi 52.3 vs 9). The official 15-site check was not run for v3 (the hold-out had already failed). The installed
demand stays **v2** (`DEFAULT_SYNTHETIC_DEMAND = 'pune_synthetic_demand_v2'`); v3 stays in
`urbanos-data/synthetic/demand-v1/out/` with its parity test (`SyntheticDemandP14.test.ts`, skipped when the asset is
absent). Judgement call: the overall loss of v3 (5.635) is lower than S10gb1k4's (5.675), but the record is chosen on the
hold-out criteria, not on the loss, and those are worse.

## 2. Part A: the record (60 iterations, every record; hold-out evaluated once)

| Model | Split | Journey times within 15 % (09:00 / 23:00) | Counts GEH < 5 | River crossings | Loss (all) |
|---|---|---|---|---|---|
| p14 S10 (60 it) | calibration | 6/28 (3/14 / 3/14) | 3/16 | -19.7 % | 5.629 |
| p14 S10 (60 it) | holdout | 8/28 (1/14 / 7/14) | 2/16 | +17.4 % | 5.629 |
| p15 S10gb1k4 (60 it) | calibration | 5/28 (2/14 / 3/14) | 4/16 | -22.4 % | 5.675 |
| p15 S10gb1k4 (60 it) | holdout | 8/28 (1/14 / 7/14) | 1/16 | +16.4 % | 5.675 |

S10gb1k4 (gateway loading on nearby roads, spread capped at 4 boundary roads) is the regenerated synthetic record
(`frontend/src/engine/calibration/syntheticDemandRecord.ts`, commit 07358ee): hold-out fails (JT 8/28, counts 1/16, river
+16.4 %), official check 1/15. Because the hold-out fails, `decideSyntheticDefault` keeps the city-wide land-use model
**off by default**; it is the one-click demo mode (§3.3). Nothing in the app shows a pass.

The 09:00 over-saturation is therefore still there: the demand totals are at or below CMP-2024 (§1.6), the peak-hour share
is already below CMP's factor (§1.1), and neither gateway loading (§1.3), the motorised trip lengths (§1.7 attempt 1) nor
congestion-aware city paths (§1.7 attempt 2) cure it. What remains is the area model's through traffic on a few main-road
links; no further model research is planned in this branch.

## 3. Part B: how the app presents the model

### 3.1 The user's decision (2026-11-25 19:58 IST)

The first plan was a calm amber chip ("Demo data · synthetic · not yet checked against real counts") in demo mode. The user
then asked for **no mention of synthetic/demo data on the main screens**: in demo mode no status chip, no "synthetic" /
"Not validated" badges and no "About these numbers" panel in the top bar, Simulate panel, inspector or Models list. The
disclosure lives in (1) the Data catalogue (one neutral line per dataset) and (2) the docs. Nothing shows a "validated" or
pass state anywhere. (Resume, 2026-11-25 evening: app errors no longer show in red either, §3.5.)

### 3.2 Banner states (tested in `DemoP15.test.ts`)

| State | When | Top bar | Simulate panel | Inspector / Models list |
|---|---|---|---|---|
| `hidden` / `none` | demo mode: the city-wide land-use model is the active traffic model | no chip | no validation note; "Traffic model" section with the **City-wide land-use model** switch (no badge) | no trust badges (`TrustBadge` renders nothing except "Stale", which is about inputs); demand line reads "City-wide land-use model: trips start and end at N of the area's buildings…", no SYNTHETIC source badge or provenance label; Models list shows names only |
| `limitation` | any other model (the app default: area estimate, p13 roads) | amber chip "Traffic model fails validation · details" (was red), opens the recorded results | compact amber note "Compare options; do not quote the numbers." + one line of meaning + collapsed **About these numbers** (official and project check results) | amber "Fails validation (TAG M3.1)" badges (were red); Models list "Not validated" in amber |
| app error | the city-wide model cannot be loaded, the analysis or the live view fails | — | calm neutral notice (`ErrorNotice`, §3.5): "The city-wide model could not be loaded, so the area estimate runs instead." + a short catalogue message, reference with Copy for a server fault | — |

There is no "passes" / "matches" state: the record does not support one (§2), so none is drawn. If a future record passes
its hold-out and the official check is not worse, `decideSyntheticDefault` turns the model on by default; the screens
would still show no chip in demo mode, and the docs would carry the result.

### 3.3 Demo mode switch

- One click: Simulate → Traffic model → **City-wide land-use model** (`data-testid=demo-mode-toggle`). It calls
  `setSyntheticDemand(true)`, which also switches the supply to the p14 Indian road model (one switch, as in p14), and
  persists the choice in `localStorage['urbanos.demoMode']`; `App` re-applies it at start-up.
- `engine/simulation/demoMode.ts`: a dependency-free store that `SimulationMode.setSyntheticDemand` keeps in step with the
  active demand model; `useDemoMode()` reads it (badges do not import the engine).
- Switching invalidates a saved baseline (as before): compare runs made on the same model.

### 3.4 Where the disclosure is

- **Data catalogue** (Reports → Data catalogue; backend `datasets/seed.py`): two datasets with source "UrbanOS project city
  model": *City land use: residents and jobs per building* (`synthetic_landuse_v1`) and *City-wide traffic demand model
  (land use, 4-step)* (`synthetic_city_demand_v2`, active version DATASET_VERSION). One neutral line each, and nothing else
  (resume: the validation sentence and the method line were removed from the catalogue): "Project model (synthetic): built
  from CMP-2024, OpenStreetMap and published standards; modelled, not measured." Data class `synthetic`, suitability
  `visualisation`. The registry only inserts a missing dataset, so a database that already holds the earlier text keeps it
  until those two rows are removed (the browser check used a fresh copy).
- **Docs**: DEMAND_P14.md, this file (the check results live here, not in the app).
- Unchanged and still truthful: the plan's provenance (`source: 'synthetic'`), the generated record, comparison and report
  exports, the "How these figures are made" notes under a collapsed disclosure, and tooltips.

Judgement call: the catalogue line keeps the word "synthetic" (the class the registry uses for modelled, not measured
data) so the one place the app discloses it says what it is; it carries no validation wording.

### 3.5 Failures in Simulate: calm notices, never red (merged from `p15-logging`)

Branch `p15-logging` (3352264: request log, X-Request-ID, coded JSON errors, `ErrorNotice` + `lib/errorCatalogue.ts`) is
merged into `p15-demo` (one conflict, `index.css`: both style blocks kept). The Simulate screens now use that pattern:

| Where | Before | Now |
|---|---|---|
| SimulationPanel: study error (`sim.error`) | red `Notice tone="bad"` with the raw message | `ErrorNotice` (neutral surface, Info icon, `role="status"`) |
| SimulationPanel: live view error (`traffic.error`) | amber text | `ErrorNotice` |
| RoadAnalysisPanel: analysis failed | red `Notice tone="bad"` "The analysis could not run: <raw>" | `ErrorNotice` with prefix "The analysis could not run." |
| RoadAnalysisPanel: through-the-day failed | rose text with the raw message | `ErrorNotice` with prefix "The day could not be analysed." |
| Simulate context: city-wide model not loaded | red `uos-banner-fail` alert with the raw error | `ErrorNotice` "The city-wide model could not be loaded, so the area estimate runs instead." |

The strings these screens keep in state pass through `userErrorText()` (errorCatalogue.ts): our own words (catalogue
messages, which already carry "Reference: <id>." for a server fault, and app-authored sentences) pass unchanged; a
JavaScript runtime fault's text (`… is not a function`, `Cannot read properties …`, a stack frame) becomes the catalogue
message for the context ("The simulation couldn't start. Try again. …"). A server fault shows its short reference with a
Copy button; no raw server text reaches the screen (ApiError's message is the catalogue text; the server detail stays on
the error object for the console). Red stays only where it encodes a value (v/c above capacity, GEH > 10, LOS F).
Tests: `P15ErrorsAndPcu.test.ts`.

### 3.6 Red-error sweep (rest of the app)

After §3.5, every remaining app or API failure display was moved to the same pattern: `ErrorNotice` with the stored text
passed through `userErrorText(text, context)` (load, save, upload, export), a short prefix saying what could not be done,
and Try again where it helps. No raw `error` string in brackets, no red.

| Where | Before | Now |
|---|---|---|
| CalibrationPanel (run failed) | red `Notice tone="bad"` + XCircle, raw message | `ErrorNotice` "Calibration could not run." |
| FeasibilityPanel (assess, document, upload, review) | red notice "Assessment failed: <raw>" | `ErrorNotice` "The assessment could not be completed. …" (and the three others) |
| PlanningPanel (project list, new project) | red notice "… could not be loaded (<raw>)" | `ErrorNotice` with prefix and the Try again button kept (`projects-retry`) |
| Projects: ProjectPage, OverviewTab (delete), AlternativesTab | red notices with raw text | `ErrorNotice` (ProjectPage keeps its "project no longer exists" note for a 404) |
| ScenarioVersions, ScenarioGeneratorPanel ("Not created: …") | rose text, raw | `ErrorNotice` (versions: Try again re-reads the list) |
| TrafficDataPanel (load, import preview, road counts, save result) | red notices; "could not be loaded: <raw>" | `ErrorNotice`; a failed save keeps its per-field list inside the notice; a successful save stays green |
| Data catalogue (section, view, dataset), fact-update review queue, Reports list, Environment data panels | amber text with "(<raw>)" | `ErrorNotice` |
| Toasts (`window.showToast(msg, 'error')`, 21 callers) | red-bordered toast unless the text was already catalogue text | always the neutral notice toast, text through `userErrorText` |
| Crash screen (`ErrorBoundary`) | rose box, "Application Encountered an Error", raw `error.message` | neutral box, "Something went wrong on this screen", catalogue text; the stack stays under the collapsed developer details |
| Connection badge (backend offline) | rose pill | neutral pill (WifiOff + Retry) |

Red stays only where it encodes a value or a choice, not a failure: congestion and v/c above capacity, LOS F, GEH above
10, "worse than before" deltas and losers, new bottlenecks, peak period colour, critical feasibility constraints, conflict
findings, validation rows with bad input, a disconnected flyover ramp (a design state), and destructive buttons
(Delete, Clear, the delete-confirm box). Test: `frontend/src/engine/testing/P15ErrorSweep.test.ts` (each swept file uses
ErrorNotice + userErrorText and has no red error notice or raw "({error})"; toast, crash screen and badge neutral; a raw
runtime fault renders as catalogue text).

### 3.7 Logging (merged from `p15-logging`, 3352264)

Every request is logged at INFO on the console and in `backend/logs/urbanos.log` (the same line in both; rotated at
5 MB); every response carries `X-Request-ID`; failures answer with a stable JSON `code` (`backend/app_errors.py`). The
reference a planner copies from an `ErrorNotice` is the first 8 characters of that id, so the matching log line can be
found with `grep <reference> backend/logs/urbanos.log`. Noisy paths can be quieted with `URBANOS_LOG_QUIET_PATHS`
(`QUIET_SUGGESTED`). Details: DEVELOPER_HANDBOOK.md §5.7.

## 4. Micro-simulation PCU set (`pcuSet`, commit 9029bfb)

`MicroSimOptions.pcuSet` (`frontend/src/engine/simulation/TrafficMicroSim.ts`):

- `'irc'` (**default**, unchanged behaviour): IRC:106-1990 PCUs (`VEHICLE_TYPES`, two-wheeler 0.75) for Webster design
  flows and counted link PCUs.
- `'indo-hcm'` (set by `SimulationMode` and `analysisJob.ts` whenever the p14 Indian road supply is active, i.e. in demo mode): Webster design flows in Indo-HCM 2017 signal
  PCUs (Table 6.3, two-wheeler 0.4; `P14.pcuSignal`), the unit of the Indo-HCM saturation flow they are divided by, and
  counted link PCUs in Indo-HCM mid-block PCUs (Table 5.2, two-wheeler 0.22; `P14.pcuMidblock`), the unit of the p14 link
  capacities they are compared with. The static assignment already used these sets (`staticAssignment.ts`). Vehicle
  movement is unaffected; only signal timings and reported PCU/h change.

Tests: `P15ErrorsAndPcu.test.ts` (default and `'irc'` identical; with `'indo-hcm'` the Webster flow-ratio sum scales by the
mean signal-PCU ratio and is lower for a two-wheeler-heavy mix; the same vehicles are counted, at fewer PCU per vehicle).

## 5. Browser check (2026-11-25, headless Chromium, `p15-demo` at 2d0de1a)

Production build (`VITE_API_BASE=http://127.0.0.1:8416`) served on 4616; backend on 8416 on a **copy** of
`backend/twincity.db` (`/workspace/work/p15-e2e/db/twincity.db`; the original was not touched). Screenshots in
`/workspace/work/urbanos/shots/p15/`:

| Screenshot | What it shows |
|---|---|
| `demo-on-katraj-satara-0900.png` | Demo mode ON (city-wide land-use model, p14 supply), 09:00, Satara Road at Katraj (`osm_1286673303`): no status chip in the top bar, no validation note, no "synthetic" / "Not validated" words on the main screens (checked in the DOM as well); Models list shows names only. The road reads "Severely congested", South 6 km/h vs 39 free-flow, v/c 150 %, LOS F: the 09:00 over-saturation of §2 (red here is the traffic condition) |
| `demo-on-hinjewadi-wakad-0900.png` | Demo mode ON, 09:00, Wakad Road (Hinjewadi-Wakad corridor, `osm_53199255`): same clean screens; East 2 km/h vs 40, West v/c 216 %, LOS F |
| `demo-off-katraj-satara-0900.png` | Demo mode OFF (area estimate, p13 roads), same road and hour: amber top-bar chip "Traffic model fails validation · details", amber "Compare options; do not quote the numbers." note with the collapsed "About these numbers", amber "Fails validation (TAG M3.1)" badge, "Not validated" in amber in the Models list |
| `api-error-backend-stopped-projects.png` | Backend stopped (`killport.sh 8416`), Projects opened: neutral `ErrorNotice` "The project list could not be loaded. Nothing was changed. The server isn't responding right now. Try again in a moment." with Try again; computed colours text rgb(230,234,240), border rgb(74,85,99) (no red); header badge "Offline" in the neutral style. After restarting the backend, Try again cleared the notice and the badge returned to Online |

No page errors; the only console errors were the two `ERR_CONNECTION_REFUSED` lines while the backend was deliberately
stopped. The demo-OFF screenshot keeps the earlier camera angle (the map view did not re-centre before the capture);
the panels are what the check is about.

## 6. Open issues

- The 09:00 over-saturation remains (§2): the city-wide land-use model fails its hold-out (JT 8/28, counts 1/16) and the
  official check (1/15), so it stays off by default and the main screens make no claim about it.
- The Data catalogue only inserts missing datasets: a database that already holds the earlier catalogue text for the two
  synthetic datasets keeps it until those rows are removed (§3.4).
- oxlint reports 19 warnings (0 errors), unchanged in kind (unused imports such as `GatewayObject`).
