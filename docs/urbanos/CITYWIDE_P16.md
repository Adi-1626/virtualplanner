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
