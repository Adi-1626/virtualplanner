# Synthetic land-use demand and the p14 candidate model (branch `p14`)

Label: **synthetic** everywhere (demo data from assumptions and web sources; not measured, not for decisions). Built for the
demo "simulate anywhere in Pune"; synthetic data is never mixed with official or estimated data.

Branch `p14` = `p14-demand` (b19c7a8, the synthetic 4-step demand) + `p14-supply` (f4babc3, Indian urban road supply) merged
(`p14-merge-scratch`), then the structural fixes, the joint calibration and the evaluation below. Checks are the p13 project
check (VALIDATION_P13.md: same 60 records, same 50/50 seed-13 split, same TAG M3.1 thresholds; the hold-out decides) and
the official 15-site check (unchanged data and criteria). Nothing was loosened.


## 1. The synthetic city model (v1 as built on `p14-demand`)

Built offline by `urbanos-data/synthetic/demand-v1/scripts/build_demand.py` (numpy) from `urbanos-data/synthetic/landuse-v1`
(293,803 OSM buildings with residents and jobs reconciled to the CMP-2024 zone totals). Full method and every assumption:
`urbanos-data/synthetic/demand-v1/method.md`. ASSUMED = chosen for the demo, no source behind it.

| Step | What | Parameters | Source |
|---|---|---|---|
| Zones | 253 internal model zones (the 272 in-box CMP-2024 zones; zones sharing one geocoded point grouped), 46 out-of-box CMP zones as external zones | — | CMP-2024 Annex 2.1/2.2 via landuse-v1 |
| 1. Generation | productions per resident = PCTR × (1 − NHB) × purpose share; attractions HBW jobs, HBE seats, HBO 0.7 retail/service jobs + 0.3 residents, NHB jobs | PCTR PMC 1.30, PCMC 1.17, PMR 1.47; work 77.0 %, education 16.6 %, other 6.4 %; NHB 8 % (ASSUMED) | CMP-2024 Tables 2-36, 2-37 |
| | freight (LCV + truck) P = A ∝ 0.8 industrial + 0.2 all jobs, 2.1 % of motor vehicle trips, mean 10 km | ASSUMED | truck share: Gunjan Chowk counts (Thakur et al. 2017) |
| Impedance | peak running time on the OSM main-road skeleton (motorway–tertiary, 17,303 nodes), 3 connectors per zone at 15 km/h × 1.3; intrazonal = ½ to the nearest zone | trunk 28, primary 22, secondary 20, tertiary 18 km/h (ASSUMED) | OSM (ODbL); CMP-2024 Table 3-18 (25 km/h network speed) |
| 2. Distribution | gravity F(t) = t^α exp(βt); doubly constrained (HBW, HBO, NHB, freight), education production-constrained | α = −1.07986; v1: one β per purpose fitted to 5.38 km overall | α and the gamma form: PMC DP traffic report 2011 §7.5; CMP-2024 Table 2-38 |
| 3. Mode split | P(m\|d) ∝ w_m · Erlang-2(d; L_m) by production jurisdiction; vehicles = person trips / occupancy | L_m CMP-2024 Table 2-38; shares Table 2-55 + 2026 metro; occupancy 2W 1.51, car 2.47, auto 2.97, bus 26 | CMP-2024; Metro DPR 2A/2B Table 3-24 |
| 4. Time of day | outbound / return profile per purpose, IPF-fitted so each hour's vehicles follow the project's all-vehicle profile (7.5 % of the day at 09:00) | | trip_rates.json; pune_hourly_profile_v1 (Mendeley 2023 CCTV) |

The study-area cut (`frontend/src/engine/demand/syntheticDemand.ts`, `syntheticAreaPlan`): building trip ends inside the
area (the heaviest building of each 250 m cell of a zone carries the cell), boundary roads where each zone's city path
(shortest path on the skeleton) enters or leaves the area, and through traffic for zone pairs whose city path runs ≥ 600 m
inside it. Label `source: 'synthetic'` on every plan.

## 2. Diagnosis: why the main roads were under-loaded (calibration records only)

Diagnostics were run on calibration records only (`P14_MODE=diag`: vehicle-km by OSM class, trip parts, select-link on
every counted section, and a route time decomposition), so the hold-out stayed unseen until the final evaluation.

| Suspected cause | Finding | Action |
|---|---|---|
| Route choice spreading traffic over local streets | Not the main cause. With the p14 supply, residential/living_street/service roads carry 3–15 % of area vehicle-km at 09:00 and 23:00 on the v1 demand; trips use the main roads. At 09:00 with the larger v2 demand and congested mains, local roads rise to 21–27 %. | Optional link-type cost factor on residential / living_street / service roads in route choice (`localCostFactor`, generalised cost as SATURN / VISUM link types; reported times stay real times), calibrated |
| Trips too short (the gravity) | **Main cause.** v1 fitted one β per purpose to the 5.38 km overall mean over every zone, external zones included; the trips produced inside the city came out far too short: all-mode mean PMC 3.85 km (CMP-2024: 5.84), PCMC 3.59 km (6.14); motorised PMC 4.95 km (6.79), PCMC 4.60 km (7.36); two-wheeler PMC 4.60 km (6.35). Short trips stay local and never cross the counted sections or rivers: area through traffic 19–35 %, counts −66 % on the calibration records, river −77 %. | β by production jurisdiction (§3.1) |
| Intrazonal share | 29–41 % of person trips intrazonal in v1 (zone size: intrazonal time = ½ the nearest zone, with t^−1.08 these are favoured) | falls to 18–26 % with §3.1 (no separate fix) |
| Missing through traffic of the highways | The model had no traffic from beyond PMR at all: no external–internal and no external–external (NH-48, NH-65, NH-60, the expressway). Katraj–Satara Rd cordon (OC 13): model 1,622 vs 7,752 veh/h, of which through 167 veh/h. | Outer-cordon traffic from CMP-2024 (§3.2) |
| Bridge connectivity ("Mundhwa Bridge carried nothing") | The record `cnt_sl_21` ("Magarpatta River Bridge") was OSM way 116839303 only, "Mundhwa Bridge", ONE one-way carriageway (2 lanes, northbound) of four (other ways 756417284 northbound, 568009405 and 756417279 southbound), while the observed count is the site total of both directions. The model's one carriageway carried 0–1,050 veh/h. | A record error, fixed in the data for every model (§4) |
| Zone size | 253 internal zones for ~7 M people; coarse fringe zones keep long intrazonal distances, so the rest-of-PMR length target (4.85 km) cannot be met with a decaying deterrence | rest-of-PMR β kept at v1 (§3.1) |

## 3. Structural fixes (demand v2, `pune_synthetic_demand_v2`, label synthetic)

`build_demand.py --v2 --tag v2` (v1 stays installed and reproducible; same land use, same building trip ends).

### 3.1 Trip length by production jurisdiction

β is fitted per purpose AND per production jurisdiction (doubly-constrained Furness kept; coordinate bisection) so each
jurisdiction's all-mode mean trip length equals CMP-2024 Table 2-38 "Average Trip Length (Motorised & Non-motorized)":
PMC 5.84 km, PCMC 6.14 km (Cantonments: the PMC value, ASSUMED); purpose ratios as v1. β is never made steeper than v1's
(the rest-of-PMR target 4.85 km cannot be reached with coarse fringe zones; those zones keep v1's β, reported).
The asset stores β per production zone (`betaZ`); the app's TypeScript reproduces the build (parity test).

Result (internal zones; **not fitted**: motorised and by-mode lengths are a check):

| Production jurisdiction | all modes v1 → v2 (CMP) | motorised v1 → v2 (CMP) | two-wheeler v1 → v2 (CMP) | car v1 → v2 (CMP) | intrazonal v1 → v2 |
|---|---|---|---|---|---|
| PMC | 3.85 → 5.80 (5.84) | 4.95 → 7.53 (6.79) | 4.60 → 6.94 (6.35) | 7.63 → 12.06 (11.48) | 29 → 18 % |
| PCMC | 3.59 → 6.14 (6.14) | 4.60 → 7.96 (7.36) | 4.82 → 8.36 (8.16) | 5.35 → 9.65 (9.56) | 37 → 21 % |
| Rest of PMR | 4.72 → 4.40 (4.85) | 6.65 → 6.15 (5.78) | 8.40 → 7.62 (8.10) | 5.73 → 5.40 (5.10) | 40 → 40 % |

### 3.2 Outer-cordon traffic (external–internal and through)

| Item | Value | Source / label |
|---|---|---|
| Stations | the 12 CMP-2024 outer-cordon stations, daily vehicles both directions: Khed Shivapur toll (NH-48) 138,868; Saswad–Jejuri 60,361; Patas toll (NH-65) 64,635; Nagar Rd–Shirur 98,083; Nashik Hwy–Peth 73,618; Expressway Lonavala toll 10,968; old Mumbai–Pune Hwy 32,317; Mulshi Rd 6,251; Nirvi–Nhavare 5,525; Kedgaon–Supa 15,157; Uruli Kanchan–Jejuri 6,330; Velhe 2,714; total 514,827 | CMP-2024 Table 2-44 (24 h classified counts) |
| Station locations | approximate from the names; a station outside the skeleton box attaches to the nearest skeleton node of its road class (where the highway leaves the box). The expressway's one-way carriageways are cut at the box edge and drop out of the skeleton's strongly connected component, so its traffic joins at Kiwale / Dehu Road | ASSUMED |
| Vehicle mix | two-wheeler 44.0 %, car 40.1 %, auto/taxi 3.8 %, truck + MAV + LCV 12.1 % | CMP-2024 Tables 3-7 and 3-4 (observed outer-cordon peak-hour PCUs by mode, both directions) ÷ IRC:106-1990 PCUs (ASSUMED: CMP does not print its PCU set); buses not in those tables (left out) |
| Through (EE) share of cordon trips | two-wheeler 14.3 %, car 6.4 %, IPT 18.4 %; trucks: the passenger-vehicle average 10.9 % (ASSUMED, not published) | CMP-2024 Table 3-3 (daily IE / EI / EE trips by mode) |
| Trips | crossings = EI/IE + 2 × EE → 414,953 EI/IE + 49,642 EE vehicle trips/day (model crossings 514,237) | derived |
| EI/IE distribution | production-constrained from the stations to all zones, attraction ½ residents + ½ jobs, deterrence exp(−0.02 t) | ASSUMED (freight β magnitude) |
| EE pairs | stations ≥ 90° apart seen from Swargate, ∝ product of their EE ends, balanced (symmetric Furness) | ASSUMED |
| Hours | the project's all-vehicle profile (CMP-2024 outer-cordon peak hour 7.06 %, Table 2-44) | ASSUMED shape |

City totals v2 (weekday): road vehicle trips 4.49 M internal + 0.46 M cordon; 09:00–10:00 369,766 vehicles (v1 335,056);
23:00–24:00 70,802.

### 3.3 Route choice: local-road cost factor (optional, calibrated)

`AssignmentOptions.localCostFactor` (staticAssignment.ts): route choice runs on perceived cost = real time × factor on OSM
residential / living_street / service links (link-type generalised cost); Frank-Wolfe's gap and line search use the same
perceived cost; reported link times and journey times are real times. Absent or 1 = the model as before.

## 4. Record fix found during p14 (applied to every model compared)

Two count records did not give the model every carriageway of a site whose published count is the site total:
`cnt_sl_21` (Mundhwa / Magarpatta River Bridge, calibration: one northbound carriageway of four) and `cnt_sl_23` (Harris +
New Harris bridges, hold-out: two parallel divided bridges read as one). Fixed in the estimated data
(`urbanos-data/estimated/validation-v1/CHANGELOG.md`, `build_records.py`) with `count.carriageways` and
`sectionCountGrouped` (projectCheck.ts); every other record was checked by script and is unaffected. This is a data
correction, not tuning: targets, split and criteria are unchanged, and the p13 baseline was re-scored with the same records
(VALIDATION_P13.md §4.7: hold-out counts 1/16 → 1/16, river −53.7 % → −49.2 %; journey times unchanged 3/28). Every p14
number below uses the fixed records.

The 09:00 capacity question (busy corridors ~4,000 PCU/h per direction observed vs ~2,200 modelled) was researched against
Indo-HCM's width-based capacity (SUPPLY_P14.md §1.6): the standard supports capacity by carriageway width class, but OSM has
no usable carriageway widths in Pune (3 plausible `width` tags on major roads; the common `18` is a right-of-way), so the
fallback reproduces today's capacity. Not applied; no re-screen was needed for it.


## 5. Joint calibration (calibration records only; the hold-out unseen)

Candidate sets were screened with demand v2 and the p14 supply model at 15 Frank–Wolfe iterations on the 44 calibration
observations (`P14_MODE=screen`, `/workspace/work/p14-joint-run/screen1.jsonl`, `screen2.jsonl`). Both screens ran before
the §4 record fix, so `cnt_sl_21` (the only calibration record the fix touches) was re-run for every set with the fixed
record (`fix21.jsonl`, `P14_ONLY=cnt_sl_21`) and every set re-scored (`ProjectRescore.test.ts` → `screens_rescored.jsonl`;
records are evaluated independently, so this equals a full re-run). The fix changed the ranking: before it S3 and S9 led
(5.724 / 5.723); after it S10 leads.

Loss J = the p13 project-check objective on the calibration records (lower is better). s = demand scale, m = β multiplier
(deterrence), c = mid-block capacity ×, sat = saturation flow ×, L = local-road route-choice factor (§3.3).

| Set | J | Counts GEH < 5 | Mean GEH | Count bias | JT within 15 % / 1 min | River |
|---|---|---|---|---|---|---|
| S1 s1.0 c1.0 | 5.865 | 1/16 | 45.9 | −32.1 % | 6/28 | −26.6 % |
| S2 s0.8 c1.3 | 5.962 | 0/16 | 52.3 | −45.2 % | 4/28 | −41.8 % |
| S3 s1.0 c1.3 L1.5 | 5.545 | 2/16 | 44.1 | −31.1 % | 7/28 | −26.5 % |
| S4 s0.7 c1.3 L1.5 | 5.895 | 2/16 | 55.1 | −50.8 % | 3/28 | −50.4 % |
| S5 s0.8 m1.25 c1.3 L1.5 | 5.864 | 1/16 | 53.9 | −49.1 % | 3/28 | −48.7 % |
| S6 s0.6 c1.3 L1.5 | 6.053 | 1/16 | 61.4 | −57.4 % | 4/28 | −59.3 % |
| S7 s1.0 c1.3 L1.5 sat1.3 | 5.548 | 2/16 | 43.9 | −31.0 % | 6/28 | −26.4 % |
| S8 s1.2 c1.3 L1.5 sat1.3 | 5.726 | 1/16 | 41.5 | −16.9 % | 5/28 | −10.6 % |
| S9 s1.0 c1.3 L2.0 sat1.3 | 5.527 | 2/16 | 44.1 | −30.7 % | 6/28 | −26.7 % |
| **S10 s1.0 m0.8 c1.3 L1.5 sat1.3** | **5.512** | 2/16 | 42.3 | −25.3 % | 6/28 | −19.2 % |

**Chosen: S10** (lowest calibration loss): demand scale 1.0, β × 0.8 (slightly longer trips), mid-block capacity × 1.3,
saturation flow × 1.3, local-road factor 1.5. The four best sets (S10, S9, S3, S7) lie within 0.04 of each other, which is
within what 15 iterations resolve: the parameters are weakly identified, as in p13. Every candidate's supply factors are
inside SUPPLY_BOUNDS. Width-based capacity (SUPPLY_P14.md §1.6) was not applied, so no re-screen was needed for it.

## 6. Evaluation: S10 on every record, 60 Frank–Wolfe iterations

`P14_MODE=eval`, demand v2 (`P14_ASSET=…/demand-v1/out/pune_synthetic_demand_v2.json`), `P14_SUPPLY_MODEL=p14`, 60
iterations, fixed records (§4); `/workspace/work/p14-joint-run/eval60.jsonl` (run id `p14-joint-eval60-S10`, 38 min).
Baseline: the p13 default (area-estimate demand, p13 supply) re-scored after the record fix (VALIDATION_P13.md §4.7).

| Model | Records | Journey times within 15 % / 1 min | 09:00 | 23:00 | JT median error | Counts GEH < 5 | Mean GEH | R² | Count bias | River crossings | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| p13 default (re-scored) | calibration | 3/28 | | | −43.1 % | 2/16 | 67.6 | | −38.1 % | 20,723/38,499 (−46.2 %) | (not used) |
| p13 default (re-scored) | hold-out | 3/28 | 2/14 | 1/14 | −37.1 % | 1/16 | 47.1 | | −30.6 % | 27,139/53,407 (−49.2 %) | **FAIL** |
| p14 synthetic S10 | calibration | 6/28 | 3/14 | 3/14 | +10.9 % | 3/16 | 42.2 | −0.38 | −25.7 % | 30,919/38,499 (−19.7 %) | (not used) |
| p14 synthetic S10 | hold-out | 8/28 | 1/14 | 7/14 | +39.0 % | 2/16 | 38.6 | −1.05 | +20.2 % | 62,681/53,407 (+17.4 %) | **FAIL** |

Criteria (unchanged, TAG M3.1 as in p13): ≥ 85 % of journey times within 15 % (or 1 min), ≥ 85 % of counts within GEH 5,
river screen line within 5 %. **The hold-out fails all three**, as p13 did, though every hold-out figure is closer than the
p13 baseline: journey times 3 → 8 of 28, counts 1 → 2 of 16 (mean GEH 47.1 → 38.6), river −49.2 % → +17.4 % (the error
is now an overshoot). By hour: at 23:00 half the hold-out corridors are within 15 % (7/14, p13 1/14); at 09:00 only 1/14.
The 09:00 failure is congestion, not distance: routes match Google's length (except jt01, jt04, jt10, jt16, jt25, where
the shortest converged-time path detours), but modelled times are 2–9 × Google's on Satara Rd (65.8 vs 16 min), FC Rd,
Ganeshkhind Rd, Bund Garden Rd and Hinjewadi (54.7 vs 9 min). The static assignment sends more 09:00 vehicles through the
mapped bottlenecks than their lane-based capacity carries (SUPPLY_P14.md §1.6), and BPR times explode above v/c ≈ 1.5.
Counts swing from too low on the calibration side (−25.7 %) to too high on the hold-out (+20.2 %; cnt_oc_05 15,073 vs
5,624, cnt_mb_07 15,278 vs 7,183, cnt_sl_23 24,964 vs 14,948): the error is spatial (where the synthetic land use puts
trips), not a global scale that one factor could fix.

## 7. Official 15-site check (unchanged data and criteria)

`VAL24_SYNTHETIC=1 run_val.sh val_p14joint_S10 wt-p14` (backend 8415; the official harness `NetworkValidation.test.ts`
with the synthetic demo model and S10's recorded parameters, `SYNTHETIC_PARAMS`), scored by `score_p10.py`:
`/workspace/work/p14-demand-run/val_p14joint_S10.score.txt/json`.

| Model | Sites within GEH 5 (all) | Calibration | Hold-out | Mean GEH | Bias | River screen line |
|---|---|---|---|---|---|---|
| area estimate, p13 default (the app's default) | 2/15 | 1/7 | 1/8 | 32.2 | −29.3 % | −26.5 % |
| p14 synthetic S10 | 1/15 | 0/7 | 1/8 | 42.6 | +55.3 % | +42.5 % |

Fails TAG M3.1, and **is worse than the area estimate** (one site fewer overall; the river error grows from 26.5 % to
42.5 %, now an overshoot). On the official sites' 2 km areas the synthetic demand is too high (bias +55 %; Yerwada /
Ambedkar 35,637 vs 19,143; Sancheti ROB 21,069 vs 6,255; Gunjan Chowk +59–65 % at all three hours), while on the
project check's calibration records it is too low (−26 %): the error is where the trips land, not their total.

## 8. Decision (computed from the record, not set by hand)

`syntheticDemandRecord.ts` is generated by `/workspace/work/p14-joint-run/gen_record.py p14-joint-eval60-S10
eval60.jsonl S10_s1.0_m0.8_c1.3_L1.5_sat1.3 pune_synthetic_demand_v2 …/val_p14joint_S10.score.json` (every hold-out and
calibration observation, the parameters, the official numbers). `decideSyntheticDefault` (syntheticDemandDecision.ts):
on by default only if the project check passes on its hold-out records AND the official check is not worse.
**Both conditions fail, so the synthetic demand stays OFF by default**; the app keeps the area estimate and the p13 roads.

It stays available as the opt-in **"Synthetic demo model"** (Simulate → Demo model, badge SYNTHETIC) for the demo
"simulate anywhere in Pune". When ticked, it loads `pune_synthetic_demand_v2` with S10's β × 0.8 and scale 1.0, runs the
p14 supply model with capacity × 1.3, saturation flow × 1.3 and the local-road factor 1.5, and needs a new baseline. The
banner (never hidden) then reads, generated from the record:

> Model: synthetic demo model (label synthetic: synthetic demand on the Indian urban road supply model; demo data, not
> measured). Project check with it, hold-out (records it was not fitted to): journey times 8/28 within 15%, published
> counts 2/16 within GEH 5, river crossings +17.4%: fails. Official-count check with it: 1/15 sites within GEH 5, river
> screen line +42.5% (area estimate: 2/15, −26.5%; worse). In plain words: it does not match Pune's estimated travel
> times and counts well enough to quote its numbers; use it to explore the demo and to compare alternatives run on the
> same inputs.

The "(area estimate: …; worse / not worse)" comparison was added in this phase (`syntheticDemandCheck.ts`, tested in
`SyntheticDemandP14.test.ts`) so the banner states both halves of the rule.

## 9. Browser check (production build, headless Chromium, synthetic demo model on, 09:00 weekday)

`/workspace/work/p14-e2e` (`build.sh`, `static.sh` on port 4614, `drv.sh`; API 8415). Screenshots in
`/workspace/work/urbanos/shots/p14/`. No console errors and no failed requests in any step.

| Check | Satara Rd near Katraj (osm_1286673303) | Hinjawadi Road, Phase 1 (osm_53199257) |
|---|---|---|
| Demand | 38,708 veh/h in the 2 km area at 09:00: 5 % between its buildings, 49 % buildings ↔ beyond, 46 % through; 13,225 buildings in, 0 without a road | 3,603 buildings in, 147 without a road; inbound 19,849 veh/h (the IT park at 09:00), through 17,035 |
| Trips start / end at buildings | internal trips: 96 % start and 90 % end within 40 m of a building; outbound 96 % start at one; inbound 93 % end at one (boundary trips enter where their city route crosses the edge) | same rule; corridor plan cut at the corridor's edge as before |
| Live view, 5–10 min simulated | trip speed 19–25 km/h, network snapshot 9–14 km/h; Satara Rd southbound 6 km/h (v/c 152 %, LOS F); 0 gridlock removals, 1–2 short gridlock events that cleared; queue at the area edge grows (683 at 10 min) | trip speed 20–24 km/h; westbound 22 km/h (v/c 159 %); 0 gridlock events; queue at the edge grows fast (2,000 at 8 min): 19,275 veh/h of the corridor's 35,395 enter at one point, the Wakad flyover |
| Screenshots | `katraj-live-0900.png`, `katraj-live-0900-top.png` | `hinjewadi-live-0900.png`, `hinjewadi-live-0900-top.png` |

Design → re-test → Compare (Hinjawadi Road, proposal "P14 Hinjawadi Rd 4 lanes"): Save existing city → Select the road in
Design → eastbound 3 → 4 lanes and westbound 2 → 3 lanes → Simulate → Compare. Result "Mixed, confidence low": routed
traffic on the road +15.5 % (8,887 → 10,262 veh/h), time to drive it −2.8 %, area driving time 137,294 → 132,747 veh·h
(better), road stretches over capacity 168 → 165, no new bottleneck; the end-junction delay reads "no data" in the
proposal, with the app's own explanation (the edit changed which junctions count as its ends). Widening only the
uncongested eastbound carriageway first gave no area change (v/c 15 %), as expected. Screenshots
`hinjewadi-compare-4lanes.png`, `hinjewadi-compare-widen-both.png`. No code bug was found in this check.

What the check shows about the model (not artefacts of the app, but the hold-out failure seen on screen): at 09:00 the
synthetic demand exceeds the mapped capacity at both sites, so corridor speeds on the studied road are 2–3 × slower than
Google's typical 09:00 (Satara Rd 6 km/h southbound vs ≈ 18 km/h) and vehicles queue at the area's edge instead of
gridlocking inside it.

## 10. Limits

- **Fails on the hold-out and makes the official check worse**: a demo model for "simulate anywhere in Pune", never for
  numbers; the banner says so.
- **Synthetic land use and assumed parameters** (§1, `method.md`): residents and jobs per building are reconciled to zone
  totals, not observed; the cordon station locations, EE pairing, deterrence and time profiles are ASSUMED.
- **09:00 over-saturation**: the demand reaches the corridors at v/c 1.5–4; with lane-based capacity (no usable carriageway
  widths, SUPPLY_P14.md §1.6) and a static assignment without peak spreading, 09:00 times are far too long. Data that would
  fix it: measured carriageway widths, ATCS detector counts, an OD survey for the IT parks (Hinjewadi, Kharadi, Magarpatta).
- **Spatial error**: too few trips on the calibration side, too many at the official sites and several hold-out counts
  (cnt_oc_05, cnt_mb_07, cnt_sl_23): the zone system (253 internal zones) and synthetic jobs place trips coarsely.
- **Weak identification**: the four best candidate sets lie within 0.04 of each other in calibration loss; S10 is the
  calibration minimum, not a well-determined estimate. The hold-out was looked at once, after the choice.

## 11. Reproducing

All runs from `/workspace/work/p14-joint-run` (outside the repo) with `run.sh TAG MODE [env]` (P14Validation.test.ts on
the p13 cached areas, backend 8415 started by `/workspace/work/p14-demand-run/start_backend.sh /workspace/work/wt-p14`
with a COPY of the DB, never `backend/twincity.db`; heavy steps take `flock /workspace/work/heavy.lock`).

1. Screens: `screen1.sh`, `screen2.sh` (15 iterations, calibration only); record-fix re-run `fix21.sh`
   (`P14_ONLY=cnt_sl_21`); re-score: `RESCORE=1 RESCORE_IN=screens_all.jsonl RESCORE_PATCH=fix21.jsonl
   RESCORE_OUT=screens_rescored.jsonl` with `ProjectRescore.test.ts`; `showscreen.py`.
2. Evaluation: `eval60.sh` (`sets_eval.json` = S10, 60 iterations, every record) → `eval60.jsonl`.
3. Official: `val.sh` (`run_val.sh val_p14joint_S10 /workspace/work/wt-p14 VAL24_SYNTHETIC=1`), after step 4's first
   record so the harness reads S10's parameters.
4. Record: `gen_record.py` (above); the decision follows from it.
5. Browser: `/workspace/work/p14-e2e` (`f_site.py`, `f_live.py`, `flows.py`, `/workspace/work/p12-e2e/lanes.py`).
