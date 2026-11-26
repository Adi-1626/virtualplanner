# City-wide robustness of the demo model (branch `p16-citywide`)

Branch `p16-citywide` from `p15-demo` (434e209). Goal (user, 2026-11-26): any road, bridge or area of Pune can be
simulated in demo mode and behaves close to real from the project's assumption data, not only the main corridors.

Three parts: (A) a city-wide robustness harness that defines what "plausible" means before anything is tuned, with a
baseline; (B) legitimate model fixes judged on that harness and on the existing project check; (C) a headless browser
check of six diverse areas.

Hard rules kept: the bands (§3) were written and committed (8d141c8) before the first baseline run and never moved; no
TAG M3.1 threshold, target or split changed; the hold-out was never used to choose; the synthetic data stays labelled
synthetic in data and docs (never on the main screens); `backend/twincity.db` untouched (runs used copies).

## 1. What "the model" is here

Demo mode as the app runs it (DEMO_P15.md §3.3): the city-wide land-use model (`pune_synthetic_demand_v2`, SYNTHETIC) cut
to the study area at the clock hour (`syntheticAreaPlan`, recorded `SYNTHETIC_PARAMS`: β × 0.8, gateway loading 1, capacity
× 1.3, saturation flow × 1.3, local-road route factor 1.5), the p14 Indian urban road supply (SUPPLY_P14.md), the area's
static user equilibrium (60 Frank-Wolfe iterations, deterministic) and the micro-simulation of the selected road's 700 m
corridor with the assignment's paths (analysisJob.ts).

## 2. The city-wide test set (`frontend/src/engine/testing/citywideAreas.json`)

41 study areas, sampled by `frontend/src/engine/testing/citywide/sample_areas.py` with seed 16 from the app's own OSM index
(the roads the app loads; `db_osm_index.db`, OSM of 2026-11-02). Each area = one click on one road at the app's default
2 km range, so the network, the corridor and the demand are what a planner gets. Rare strata are drawn first so the minimum
spacing (1.5-3 km between areas; 0.6 km in the old city) never squeezes them out. Every record keeps its reason (`why`).

| Stratum | n | How the pool is defined |
|---|---|---|
| bridge | 5 | river bridges: OSM `bridge=*` main/collector ways crossing the PMC river polygons (Mula, Mutha, Mula-Mutha; OpenCity PMC rivers) + one named Pavana bridge (PCMC) |
| flyover | 3 | `bridge=*` trunk / primary / secondary (+links) ≥ 250 m not over a river (flyovers, road over-bridges) |
| oldcity | 4 | residential / unclassified / living street / tertiary in the Peth box 73.846-73.872 E, 18.504-18.523 N (ASSUMED box) |
| itpark | 3 | a road within 700 m of 3 of 6 IT-park anchors (Hinjawadi Ph 1 / Ph 3, Kharadi EON, Magarpatta, Talawade, Yerawada) |
| midc | 3 | a road within 800 m of 3 of 4 industrial anchors (Bhosari MIDC, Telco Rd, Chinchwad MIDC, Hadapsar industrial estate) |
| fringe | 4 | a road ≤ 1.2 km from a CMP-2024 rest-of-PMR zone point and outside the PMC / PCMC ward outlines |
| arterial | 5 | OSM trunk / primary (IRC:86 arterial) |
| subarterial | 4 | OSM secondary |
| collector | 4 | OSM tertiary |
| local | 6 | residential / living street / unclassified: 2 PMC, 2 PCMC, 1 Cantonment, 1 fringe |

Jurisdiction: PMC 20, PCMC 10, Cantonment 2, rest of PMR 9 (from the PMC 2022 and PCMC electoral ward outlines, datameet,
community traced; outside both and within 2 km of a CMP Cantonment zone = Cantonment). Anchors are approximate centres
read off OpenStreetMap (ASSUMED), not survey points.

Hours: 09:00 (morning peak), 14:00 (midday), 19:00 (evening peak), 23:00 (night).

## 3. Plausibility bands (written before tuning; `frontend/src/engine/testing/citywide/citywideBands.ts`)

Speed ratio = a link's time at zero flow (free running at the p14 stream free-flow speed, signal delay and junction control
at zero flow, same network and signals) / its time at the hour, weighted by vehicle-km. An area x hour passes when every
applicable band passes. Labels: `sourced` (published figure as is), `derived` (published figure carried through the
model's units or speed-flow curve, step stated), `assumed` (engineering bar for this harness).

| Band | Hours | Test | Label | Source |
|---|---|---|---|---|
| R1 | all | the area builds, the plan exists, the assignment runs | assumed | harness requirement |
| R2 | all | ≥ 98 % of the hour's planned vehicles routed (unrouted + no drivable way ≤ 2 %) | assumed | — |
| R3 | all | ≥ 90 % of the building-end traffic starts / ends on a node within 100 m of the building | assumed | p14 browser check: 90-96 % within 40 m (DEMAND_P14.md §9) |
| N1 | 23:00 | median speed ratio ≥ 0.94 | derived | Indo-HCM 2017 Table 5.7, LOS B (v/c ≤ 0.45, 76 % of FFS) ÷ p14 stream share 0.81; Google 23:00 corridor speed ≈ p14 free flow (SUPPLY_P14.md §3.2) |
| N2 | 23:00 | 10th-percentile speed ratio ≥ 0.73 | derived | Indo-HCM 2017 Table 5.7, LOS C (v/c ≤ 0.75, 59 %) ÷ 0.81 |
| N3 | 23:00 | ≤ 1 % of loaded road length above v/c 1.2 | assumed | night = 1.4 % of daily vehicles (DEMAND_P14.md §3.2) |
| D1 | 09, 14, 19 | median speed ratio ≥ 0.61 | sourced | Google typical 09:00 vs 23:00 on the 28 project-check corridors (validation-v1): slowest corridor 0.61 (Hinjewadi-Wakad), p10 0.67, median 0.80; TomTom Pune 2025 Tue 09:00/23:00 16.8/26.5 = 0.63 |
| D2 | 09, 14, 19 | 10th-percentile speed ≥ 8.8 km/h | sourced | CMP-2024 §2 journey-speed survey (Table 2-56 text): 8.8-59.55 km/h; PMC 20.3, PCMC 25.4, Cantonment 22.2, PMRDA 28.1 km/h |
| D3 | 09, 14, 19 | ≤ 9 % of loaded road length above v/c 1.2 | derived | CMP-2024 Annexure 2.6: 9 % of key-corridor length below 15 km/h (LoS 4); above v/c 1.2 the p14 curve gives < 0.25 of free-flow speed (< 15 km/h on any urban class) |
| M1 | all | micro-simulation: no front vehicle standing ≥ 180 s at the end of the measured window (both seeds) | assumed | a saturated real junction still discharges each cycle |
| M2 | all | micro-simulation: queue waiting at the corridor edge grows ≤ 10 % of the corridor inflow per hour | assumed | — |
| M3 | all | micro-simulation: the two seeds' corridor trip speeds within 15 % of their mean | assumed | run-to-run stability |

Micro-simulation in the harness: 2 seeds (42, 7), 300 s warm-up, 300 s measured (the app: 3 seeds, 300 s + 900 s; shorter
here to fit 41 x 4 runs on 2 CPUs). The static assignment is deterministic (same inputs, same flows), so its stability is
not a band.

## 4. Baseline: the recorded demo model on the p16 harness

Run `p16-run/base.jsonl` (`eval.sh base P16_MICRO=1`, wt-p16 at 8d141c8, recorded S10gb1k4, 60 iterations, micro-simulation
on). Table regenerated with `frontend/src/engine/testing/citywide/summarize.py`; see §8 for the full table next to the
final model. Pattern: nights mostly pass, days fail D2 (nearly everywhere), M1/M2 (micro-simulation queues), D1 (inner
areas) and R3 (about a third of areas at every hour).

**Baseline: 36 / 164 area-hours pass** (09:00 5/41, 14:00 6/41, 19:00 5/41, 23:00 20/41).

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 | 2/5 | 2/5 | 3/5 | 9/20 |
| subarterial | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| collector | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| local | 0/6 | 0/6 | 0/6 | 1/6 | 1/24 |
| bridge | 1/5 | 1/5 | 0/5 | 2/5 | 4/20 |
| flyover | 1/3 | 1/3 | 1/3 | 3/3 | 6/12 |
| oldcity | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| itpark | 0/3 | 0/3 | 0/3 | 2/3 | 2/12 |
| midc | 0/3 | 1/3 | 1/3 | 2/3 | 4/12 |
| fringe | 1/4 | 1/4 | 1/4 | 1/4 | 4/16 |
| **all** | **5/41** | **6/41** | **5/41** | **20/41** | **36/164** |

| Band | 09:00 | 14:00 | 19:00 | 23:00 |
|---|---|---|---|---|
| D1 | 14 | 6 | 15 | 0 |
| D2 | 28 | 26 | 29 | 0 |
| M1 | 25 | 18 | 24 | 4 |
| M2 | 25 | 17 | 23 | 1 |
| N2 | 0 | 0 | 0 | 4 |
| R2 | 2 | 2 | 2 | 2 |
| R3 | 15 | 19 | 15 | 15 |

Band table = number of areas failing that band at that hour.

## 5. What the baseline failures are (diagnosis before any fix)

| Finding | Evidence | Kind |
|---|---|---|
| Overloaded boundary roads. Through traffic is 50-75 % of an inner area's demand (e.g. a river bridge area at 09:00: 85,806 veh/h, 46,654 through); it enters on the boundary road its city path crosses and cannot spread, so a few boundary links reach 5-20 x the zero-flow time (p10 speed 0.2-1.5 km/h, while D3, the loaded length above v/c 1.2, stays ≤ 7 %). | base.jsonl `parts`, `byClass`; P16Diag (excess vehicle-hours by place: boundary nodes) | model (candidates K4/K5 gateway metering, K2-K4 congestion-aware city paths) |
| D2 misfire. D2 is written on link speed including signal and junction delay at the hour; in the old city the zero-flow p10 is already ~7.5 km/h (signal delay on 30-80 m links), so D2 cannot pass there whatever the flow. | 23:00 rows: p10 6.8-9.5 km/h at v/c < 0.3 | band as written: reported strictly; never re-scored in the official counts |
| Unwarranted signals / junction control. Every OSM signal plus every priority junction is controlled; low-volume legs of signalised junctions add 20-40 s per vehicle. | P16Diag cause split | model (K1-K5 IRC:93 volume-warranted signals) |
| R2: trips left out ("no drivable way"). All of it is at plan level (the assignment routes everything it gets: unrouted 0), and almost all of it is *through* traffic (Nagar Rd 09:00: 4,194 of 4,198 veh/h). Fringe village p16_20: every left-out vehicle was a city path whose entry and exit resolve to the same boundary node: it grazes the area's corner and never drives on its roads, but was counted as left out (fixed run: 463 → 0 left out, 463 reported as edge-only). A first guess (buildings on small network fragments) was checked and is not the cause (fixchk.jsonl: unchanged left-out). | `p16-run/ends1.jsonl`, `fixchk*.jsonl` | bug, fixed (§7) |
| R3: building ends far from their node. Trips load at junction nodes only (the network has no mid-link nodes). Buildings 30-100 m from a mapped road are 150-240 m from that road's nearest junction (ends1: road within 100 m for 88-95 % of activity, a junction node for 81-86 %). In fringe villages the lanes to the houses are not mapped. | ends1.jsonl | structural (zone connectors at junctions); not fixed (§9) |
| M1 in an area that is not congested in the assignment (IT park, 09:00/19:00). A deadlock between junction nodes 20-25 m apart (above the 16 m at which the micro-simulation joins nodes into one junction): causes `blockedExit` + `crossingTraffic` (the harness now logs causes and sites). Same pattern in MIDC Bhosari (09:00/14:00, nodes ~20 m apart); old city at 23:00: one vehicle per seed standing 270-310 s on `blockedExit` (exit lane full). | `p16-run/m1d.jsonl` | micro-simulation; not fixed (§9) |

## 6. Candidates and the selection rule

Rule pre-registered in `/workspace/work/p16-run/RULE_p16.md` before any screen ran: J (calibration-only project-check loss,
15 Frank-Wolfe iterations) must be within 0.04 of the incumbent's; among those the highest H (static-band harness passes,
41 x 4); ties by lower J; the incumbent stays unless a candidate beats its H. The hold-out is not used to choose.

| Set | What it adds to S10gb1k4+fix (all p16-dev code, off unless named) |
|---|---|
| K0 | nothing (incumbent on the p16 bug fixes) |
| K1 | IRC:93-1985 volume-warranted signals (an OSM signal or a priority junction is signalised when the hour's flows, scaled to the 8th busiest hour, meet Warrant 1) |
| K2 | K1 + congestion-aware city paths (6 skeleton loading passes) |
| K3 | K1 + congestion-aware city paths (8 passes, p14 speed-flow curve on the skeleton) |
| K4 | K3 + gateway metering 1.3 (entering traffic above 1.3 x a boundary road's capacity is held beyond the edge and reported) |
| K5 | K1 + gateway metering 1.3 |

Screens: `p16-run/calscr*.jsonl` (J), `p16-run/hK*.jsonl` (H); the choice is computed by `p16-run/choose.py` into
`p16-run/choice.json` (no hand step). Results in §8.

## 7. Fixes (code, not tuning)

1. **Same-road carriageway transitions had junction control** (p16-dev 16fbd23): where a divided road becomes one two-way
   road (same road on every arm) the static assignment and the micro-simulation treated the transition as a priority
   junction, each carriageway giving way to the other; up to 26,000 s delay per vehicle on some links. Now no control.
2. **Merge capacity sharing** (16fbd23): a heavy one-way stream merging into a carriageway gets its share of the downstream
   capacity (limited priority) instead of waiting for gaps in the major stream only.
3. **City paths that only graze the area** (p16-fix db7c772): a through path whose entry and exit both resolve to the same
   boundary node is not an area trip (it never uses the area's roads); it is no longer counted as "left out, no drivable
   way" but reported as `edgeOnlyVph` in the plan provenance and the harness rows. Verified on p16_20 (fixchk2.jsonl).
4. **Trips on network fragments** (4670f6d; hygiene, not the R2 cause): a building whose nearest node lies on a small
   fragment of the area's network (not in its largest strongly connected component) loads at the nearest node of the main
   network within the 250 m access distance (`syntheticAreaPlan`; `snapDemandPlan(…, { preferMainNetwork: true })` in the
   app's area assignment, area demand matching, the P14 project check and the harness). No main network (under half the
   nodes, e.g. a one-way corridor) = the old nearest-node rule. Fringe areas with only local boundary roads may use them as
   fall-back gateways (were collector rank and above only). Tests: `CitywideP16.test.ts`.
5. **Harness measurement** (4670f6d): R3 is measured to the node the trip actually loads at (after the snap), not to the
   nearest node; the harness also logs the micro-simulation's gridlock causes and sites. Bands unchanged.

6. **Boundary-road repair on the main network** (5aa70a7): through / outbound / inbound repair falls back to the nearest
   boundary road on the area's main network when all nearest boundary roads sit on a fragment (Nagar Rd p16_27: 4,194
   veh/h through left out at 09:00 -> 0; `fixchk4.jsonl`).
7. **Fix 2, gateway node kept** (dc32690): `snapDemandPlan` keeps a point that is a node (the plan's chosen gateway node)
   instead of re-snapping it to the main network (R2 regression of item 4, §8.4).
8. **Fix 3, direction-aware main-network snapping** (2c3aa82): a building's nearest node is kept for the direction it
   serves (origin: reaches the main network; destination: reached from it); only the other direction loads at the nearest
   main-network node (R3 over-application of item 4, §8.4).

Options added but only on through the record if chosen: IRC:93 warranted signals, congestion-aware city paths with the p14
curve, gateway metering (p16-dev 16fbd23, 1ba5c73).

## 8. Results

All numbers below are files in `/workspace/work/p16-run/`. Bands (`citywideBands.ts`) were not moved.

### 8.1 Choice (RULE_p16.md, scope amendment K0 vs K1)

| Set | J (calibration only, 15 it.) | H (static bands, 164 area-hours) |
|---|---|---|
| K0 = S10gb1k4+fix (incumbent) | 5.664 | 40 |
| K1 = K0 + IRC:93 warranted signals | 5.688 | 40 |

Both eligible (J within 0.04); K1 does not beat K0's H strictly, so the incumbent **K0 stays** (`choice.json`, computed by
`choose.py`, no hand step). K2-K5 were dropped unscreened (scope amendment, written before any screen result), not rejected.

### 8.2 Calibration, hold-out, official check (60 iterations, code at e8b4a25)

| Check | Result |
|---|---|
| Calibration (28 journey times, 16 counts) | JT 5/28, counts 1/16, river -21.3 % |
| Hold-out (evaluated once) | JT 7/28, counts 2/16, river +25.2 % — **fails** (loss 5.850) |
| Official 15 sites (`fin.score.txt`) | 1/15 GEH < 5 (hold-out 1/8), river screenline +44.6 % (bias +60 %) |
| Area estimate it must not be worse than | 2/15, river -26.5 % |

**Default decision (decideSyntheticDefault): the synthetic city-wide model is NOT the default** (hold-out fails, and the
official check is worse than the area estimate). Demo mode stays an explicit, labelled choice. The record
(`syntheticDemandRecord.ts`) was regenerated with these numbers (e8b4a25). These three checks ran on the code before
fixes 2 and 3 below (e8b4a25); fixes 2-3 only change where trip ends load (§8.4) and were not re-run through the
60-iteration check.

### 8.3 City-wide harness: baseline vs final (60 iterations, micro-simulation on, recorded set)

- **Baseline** `base.jsonl`: recorded S10gb1k4 at 8d141c8 (before every p16 fix): **36 / 164**.
- **Final** `final.jsonl`: K0 record on the fix tree e8b4a25 (fixes 1-5 of §7): **29 / 164**.
- **Final + fixes 2-3** `fix3.jsonl` (extra row set, clearly separate, all 41 areas re-run on 2c3aa82): **30 / 164**.

Pass counts, baseline / final / final + fixes 2-3:

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2 / 2 / 2 of 5 | 2 / 2 / 2 of 5 | 2 / 2 / 2 of 5 | 3 / 3 / 3 of 5 | 9 / 9 / 9 of 20 |
| subarterial | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 2 / 2 / 2 of 4 | 2 / 2 / 2 of 16 |
| collector | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 2 / 0 / 0 of 4 | 2 / 0 / 0 of 16 |
| local | 0 / 0 / 0 of 6 | 0 / 0 / 0 of 6 | 0 / 0 / 0 of 6 | 1 / 1 / 1 of 6 | 1 / 1 / 1 of 24 |
| bridge | 1 / 1 / 1 of 5 | 1 / 1 / 1 of 5 | 0 / 0 / 0 of 5 | 2 / 2 / 2 of 5 | 4 / 4 / 4 of 20 |
| flyover | 1 / 1 / 1 of 3 | 1 / 1 / 1 of 3 | 1 / 1 / 1 of 3 | 3 / 3 / 3 of 3 | 6 / 6 / 6 of 12 |
| oldcity | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 0 / 0 / 0 of 4 | 2 / 1 / 1 of 4 | 2 / 1 / 1 of 16 |
| itpark | 0 / 0 / 0 of 3 | 0 / 0 / 0 of 3 | 0 / 0 / 0 of 3 | 2 / 1 / 1 of 3 | 2 / 1 / 1 of 12 |
| midc | 0 / 0 / 0 of 3 | 1 / 0 / 1 of 3 | 1 / 0 / 0 of 3 | 2 / 1 / 1 of 3 | 4 / 1 / 2 of 12 |
| fringe | 1 / 1 / 1 of 4 | 1 / 1 / 1 of 4 | 1 / 1 / 1 of 4 | 1 / 1 / 1 of 4 | 4 / 4 / 4 of 16 |
| **all** | 5 / 5 / 5 of 41 | 6 / 5 / 6 of 41 | 5 / 4 / 4 of 41 | 20 / 15 / 15 of 41 | 36 / 29 / 30 of 164 |

**Baseline (base.jsonl): 36 / 164 area-hours pass**

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 | 2/5 | 2/5 | 3/5 | 9/20 |
| subarterial | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| collector | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| local | 0/6 | 0/6 | 0/6 | 1/6 | 1/24 |
| bridge | 1/5 | 1/5 | 0/5 | 2/5 | 4/20 |
| flyover | 1/3 | 1/3 | 1/3 | 3/3 | 6/12 |
| oldcity | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| itpark | 0/3 | 0/3 | 0/3 | 2/3 | 2/12 |
| midc | 0/3 | 1/3 | 1/3 | 2/3 | 4/12 |
| fringe | 1/4 | 1/4 | 1/4 | 1/4 | 4/16 |
| **all** | **5/41** | **6/41** | **5/41** | **20/41** | **36/164** |

| Band | 09:00 | 14:00 | 19:00 | 23:00 |
|---|---|---|---|---|
| D1 | 14 | 6 | 15 | 0 |
| D2 | 28 | 26 | 29 | 0 |
| M1 | 25 | 18 | 24 | 4 |
| M2 | 25 | 17 | 23 | 1 |
| N2 | 0 | 0 | 0 | 4 |
| R2 | 2 | 2 | 2 | 2 |
| R3 | 15 | 19 | 15 | 15 |

**Final (final.jsonl): 29 / 164 area-hours pass**

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 | 2/5 | 2/5 | 3/5 | 9/20 |
| subarterial | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| collector | 0/4 | 0/4 | 0/4 | 0/4 | 0/16 |
| local | 0/6 | 0/6 | 0/6 | 1/6 | 1/24 |
| bridge | 1/5 | 1/5 | 0/5 | 2/5 | 4/20 |
| flyover | 1/3 | 1/3 | 1/3 | 3/3 | 6/12 |
| oldcity | 0/4 | 0/4 | 0/4 | 1/4 | 1/16 |
| itpark | 0/3 | 0/3 | 0/3 | 1/3 | 1/12 |
| midc | 0/3 | 0/3 | 0/3 | 1/3 | 1/12 |
| fringe | 1/4 | 1/4 | 1/4 | 1/4 | 4/16 |
| **all** | **5/41** | **5/41** | **4/41** | **15/41** | **29/164** |

| Band | 09:00 | 14:00 | 19:00 | 23:00 |
|---|---|---|---|---|
| D1 | 16 | 8 | 17 | 0 |
| D2 | 29 | 28 | 32 | 0 |
| D3 | 0 | 0 | 1 | 0 |
| M1 | 26 | 20 | 26 | 5 |
| M2 | 25 | 17 | 26 | 1 |
| N2 | 0 | 0 | 0 | 5 |
| R2 | 3 | 5 | 4 | 3 |
| R3 | 22 | 26 | 22 | 22 |

**Final + fixes 2-3 (fix3.jsonl, extra row set): 30 / 164 area-hours pass**

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 | 2/5 | 2/5 | 3/5 | 9/20 |
| subarterial | 0/4 | 0/4 | 0/4 | 2/4 | 2/16 |
| collector | 0/4 | 0/4 | 0/4 | 0/4 | 0/16 |
| local | 0/6 | 0/6 | 0/6 | 1/6 | 1/24 |
| bridge | 1/5 | 1/5 | 0/5 | 2/5 | 4/20 |
| flyover | 1/3 | 1/3 | 1/3 | 3/3 | 6/12 |
| oldcity | 0/4 | 0/4 | 0/4 | 1/4 | 1/16 |
| itpark | 0/3 | 0/3 | 0/3 | 1/3 | 1/12 |
| midc | 0/3 | 1/3 | 0/3 | 1/3 | 2/12 |
| fringe | 1/4 | 1/4 | 1/4 | 1/4 | 4/16 |
| **all** | **5/41** | **6/41** | **4/41** | **15/41** | **30/164** |

| Band | 09:00 | 14:00 | 19:00 | 23:00 |
|---|---|---|---|---|
| D1 | 14 | 5 | 17 | 0 |
| D2 | 28 | 25 | 29 | 0 |
| M1 | 24 | 19 | 23 | 4 |
| M2 | 24 | 17 | 25 | 1 |
| N2 | 0 | 0 | 0 | 4 |
| R3 | 22 | 23 | 22 | 22 |

- Baseline (base.jsonl): R2 fails 8, R3 fails 64, rows with assignment-unrouted vehicles > 0: 0
- Final (final.jsonl): R2 fails 15, R3 fails 92, rows with assignment-unrouted vehicles > 0: 127
- Final + fixes 2-3 (fix3.jsonl, extra row set): R2 fails 0, R3 fails 89, rows with assignment-unrouted vehicles > 0: 0


### 8.4 Why the final model is worse than the baseline (and what was fixed)

The final model lost 7 area-hours against the baseline, 5 of them at 23:00 (collector 2, old city 1, IT park 1, MIDC 1),
plus MIDC 14:00 and 19:00. Per-row comparison (`cmpfb.py base.jsonl final.jsonl`): the new failures are almost all
**R2** (15 new) and **R3** (28 new); the speed and micro bands moved little (D1 +6, D2 +5, M1 +8, M2 +6 new failures against
a few fixed ones, mostly in rows that already failed). Night N1/N2/N3 did not get worse except one collector row (N2).
Two causes, both in the p16 change "trips on network fragments" (4670f6d, §7 item 4), neither in the demand or supply:

1. **Gateway nodes re-snapped (bug, R2).** The area plan picks each boundary road's node (checked to reach the other end
   of the trip) and hands it on as a point at that node. `snapDemandPlan(…, { preferMainNetwork: true })` then moved any
   such point whose node lies off the main strongly connected component to another main-network node within 250 m —
   sometimes the trip's other end (same node) or a node that cannot reach it. Those vehicles were counted as unrouted:
   unrouted vehicles in 127 of 164 rows (32 of 41 areas) in `final.jsonl` (baseline: none); e.g. p16_01 Sangam/Holkar bridge 09:00 1,339
   veh/h (4.4 %), R2 failed. **Fix 2 (dc32690):** a point that is a node keeps that node; only a building's own position
   can move. p16_01 09:00: unrouted 1,339 -> 0, R2 passes again (`fix2chk.jsonl`, `fix3.jsonl`).
2. **Building ends moved off one-way-connected nodes (over-application, R3).** 4670f6d moved every building end whose
   nearest node is outside the main component, in both directions, although most such nodes are joined to the main
   network one way (a one-way street cut by the area's edge) and serve one direction of the trip perfectly. The moved
   ends load at the nearest main node, often more than 100 m from the building, and R3 is now measured at the node used
   (§7 item 5; the baseline measured the nearest node): p16_13 Hinjawadi 0.94 -> 0.79 with no routing gain (left out 0
   before and after). **Fix 3 (2c3aa82):** the nearest node is kept for the direction it serves (an origin node that
   reaches the main network, a destination node the main network reaches); only the other direction loads on the main
   network. p16_13 09:00 R3 0.794 -> 0.869, still below 0.90 and reported as a failure. The R3 that remains below the
   baseline is the honest measurement: those trips now load (the baseline dropped them from the building's cell and
   spread them over the zone's other cells), and they load more than 100 m from their building. A variant that moved only
   ends cut off in both directions (`fix2bchk.jsonl`, 4 areas, static only) gave R3 0.94-0.95 by leaving one-way origins to
   the plan's reachability filter; it was not kept because it leaves non-synthetic plans unroutable at such nodes.

The harness now also logs, as diagnostics only (no band), the pre-fix R3 measure (`buildingEndsNearest`) and the unrouted
vehicles whose two ends share a node (`unroutedSameNodeVph`).

### 8.5 R3 under both measures (like-for-like)

R3 changed definition mid-way. The **pre-registered** measure is the one committed with the bands in 8d141c8
(`P16Citywide.test.ts` `buildingEnds`, used by `citywideBands.ts` R3): share of building-end veh/h whose building has a
road node of the area network **(the nearest node) within 100 m**. 4670f6d changed the harness to measure the node the
trip **actually loads at** after the snap (§7 item 5). `base.jsonl` holds only the pre-registered measure,
`final.jsonl` only the changed one, `fix3.jsonl` both (`buildingEndsNearest` = pre-registered, `buildingEnds` = node used).
Band thresholds are the same in every column; pass counts recomputed by `p16-run/r3cmp.py` (output `r3cmp.txt`).

| Row set (164 area-hours) | R3 fails, pre-registered (nearest node) | R3 fails, node used | Pass, R3 pre-registered | Pass, R3 node used (as recorded) |
|---|---|---|---|---|
| Baseline `base.jsonl` | 64 | 64 (inferred: the baseline loads at the nearest node; checked on 2 area-hours, below) | **36** | **36** |
| Final `final.jsonl` | not logged | 92 | not computable | **29** |
| Final + fixes 2-3 `fix3.jsonl` (extra set) | 61 | 89 | **37** | **30** |

R3 failures by hour, pre-registered / node used: baseline 15/19/15/15 (09/14/19/23) both; fix3 14/18/14/15 / 22/23/22/22.

Reading it strictly: on the pre-registered measure, fix3 is 37/164 against the baseline's 36/164; on the measure the
recorded runs used (node used), fix3 is 30/164, the baseline 36/164 (if the inference above holds), the final 29/164.
The headline result stays the recorded one (node used): **fix3 30/164, below the baseline's 36**. R2 recovered fully
(fix3: 0 R2 failures, no row with unrouted vehicles; final: 15 R2 failures, unrouted in 127/164 rows in 32 areas).

**Is the remaining R3 loss a bug?** Diagnosis on the HEAD code (`P16_R3DIAG=1`, `r3diag.sh`, `r3d*.jsonl`; plan and
snapping only, plus a one-iteration assignment to count unrouted vehicles):

| Area | h | R3 pre-reg. | plain nearest (baseline rule) | node used now | moved veh/h (≤100 m -> >100 m) | of it routable at nearest | unrouted at nearest node | unrouted as used |
|---|---|---|---|---|---|---|---|---|
| p16_13_itpark | 09 | 0.940 | 0.940 | 0.869 | 1,534 | 17 | 1,729 | 0 |
| p16_05_bridge | 09 | 0.942 | 0.942 | 0.897 | 1,203 | 35 | 1,785 | 0 |
| p16_17_midc | 09 | 0.933 | 0.933 | 0.879 | 790 | 13 | 1,725 | 0 |
| p16_33_collector | 09 | 0.929 | 0.929 | 0.884 | 272 | 4 | 697 | 0 |

At the nearest node, these trips cannot route (the "unrouted at nearest node" column: the nearest node is on a one-way
spur or fragment that does not reach the trip's other end); after the move they all route (0). Of the moved building-end
traffic, only the "routable at nearest" share would have routed without the move. So the remaining node-used R3 loss is
the R2/R3 trade-off of loading trips that the baseline plan dropped from those cells (§8.4), not a further snapping bug;
no extra fix or extra row set was made. Pre-registered and node-used shares coincide at the baseline's plain nearest
node in every diagnosed area-hour ("plain" column = "pre-reg."), which is what the baseline column above relies on.

### 8.6 M1 experiment (not adopted)

Idea from §9: join junction nodes up to 24 m apart (JOIN_JUNCTION_M and SIM_FOLD_M 16 -> 24, span 30; branch p16-m1),
aimed at the micro-simulation deadlocks between node pairs 20-25 m apart (IT park, MIDC). Rule written before running:
adopt only if the junction tests pass. Result: **4 of 62 junction tests fail** (JunctionEditing x2: Veer Santaji Ghorpade
Marg grouping, a residential T 16 m past a slip-lane end; SignalBox x2: one controller / shared phase), `m1tests.log`.
Not adopted; the harness M1 re-run was skipped. M1 failures stay (fix3: 24 / 19 / 23 / 4 area-hours at 09 / 14 / 19 / 23).

### 8.7 Default decision

**The synthetic city-wide model stays OFF by default** (decideSyntheticDefault: hold-out fails, JT 7/28 counts 2/16 river
+25.2 %; official 1/15 river +44.6 %, worse than the area estimate 2/15 river -26.5 %). Demo mode remains an explicit,
labelled choice. Fixes 2-3 were not re-run through the 60-iteration and official checks.

### 8.8 Code on p16-citywide after the merge

Fixes in order: 16fbd23 (carriageway transitions, merge capacity), db7c772 (grazing through paths), 4670f6d + af20a09
(main-network loading, tests), 5aa70a7 (through/outbound/inbound repair falls back to main-network boundary roads),
dc32690 (fix 2: gateway node kept), 2c3aa82 (fix 3: direction-aware main-network snapping), merged dd9eec1; UI 0d1aac6
(stability chip wraps inside the panel; the amber "more traffic routed than the junctions pass" card is hidden on a road
with no traffic or when nothing is routed into the area); harness diagnosis dd2a5fb (`P16_R3DIAG`).

Gates on the final HEAD: pending

Screenshots (09:00, demo mode): `/workspace/work/urbanos/shots/p16/01..06_*_0900.png`; 04 and 06 retaken after 0d1aac6.

## 9. Remaining weak areas

- R3 in fringe villages and long-block areas: loading only at junction nodes; a fix needs access nodes on long links (the
  network builder), not attempted in p16.
- M1 deadlocks between junctions 20-25 m apart in the micro-simulation (IT park, MIDC); not fixed. Joining nodes up to
  24 m apart was tried and broke 4 of 62 junction tests (§8.6), so it was not adopted; a fix needs junction grouping that
  tells a wide divided-road crossing from two nearby junctions.
- R3 (node used) below the baseline in 18 area-hours (bridge p16_05, IT park p16_13, MIDC p16_17, collectors p16_33/35,
  old city p16_09 at night): building ends whose nearest node cannot route the trip load at the main network > 100 m
  away (§8.5). A fix needs access nodes on long links / two-way access to one-way spurs (network builder).
- Calibration: hold-out and the official check fail (§8.2); the synthetic model stays off by default.
- D2 in the old city: the band as written includes signal delay (misfire, §5); reported strictly.
