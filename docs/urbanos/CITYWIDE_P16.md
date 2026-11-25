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

Options added but only on through the record if chosen: IRC:93 warranted signals, congestion-aware city paths with the p14
curve, gateway metering (p16-dev 16fbd23, 1ba5c73).

## 8. Results

_Pending the queued runs (`p16-run/pipeline_p16.sh`, `pipeline_p16b.sh`): choice table, 60-iteration calibration /
hold-out, official 15-site check, final harness with micro-simulation, default decision. Fill from `choice.json`,
`fin60.merged.jsonl`, `fin.score.txt`, `final.jsonl` (summarize.py) next to `base.jsonl`._

## 9. Remaining weak areas

- R3 in fringe villages and long-block areas: loading only at junction nodes; a fix needs access nodes on long links (the
  network builder), not attempted in p16.
- M1 deadlocks between junctions 20-25 m apart in the micro-simulation (IT park, MIDC); not fixed. Untested idea (not
  pre-registered): join nodes up to ~24 m apart (JOIN_JUNCTION_M is 16 m; divided-road crossings in Hinjawadi/Bhosari are
  wider), then re-run the junction tests and the harness M1 rows.
- D2 in the old city: the band as written includes signal delay (misfire, §5); reported strictly.
