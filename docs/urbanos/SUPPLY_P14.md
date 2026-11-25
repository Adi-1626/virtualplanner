# Supply model for Indian urban roads, p14 (branch `p14-supply`, off `p13-validation` fd4b984)

Status: **Done (2026-11-25). The p14 supply model is built from Indian standards, used by the area assignment, the corridor
micro-simulation's desired speeds and the p13 project-check harness. With the OLD demand it fixes the night (23:00) speed
bias (hold-out journey times within 15 % / 1 min: 1/14 → 8/14; mean corridor speed 39.5 → 22.1 km/h vs Google 22.4) but
makes the 09:00 results far worse (2/14 → 0/14), because the steeper Indo-HCM speed-flow curve meets the same over-capacity
demand. The project check still FAILS on its hold-out records; the official-count check still fails (2/15). The app keeps
running the p13 model by default (`SUPPLY_MODEL_DEFAULT = 'p13'`); p14 is opt-in in the engine and the harnesses.**

Why: the p13 check (VALIDATION_P13.md §4.2) found the model too fast at night: OSM `maxspeed` 60-85 km/h used as the
free-flow speed (decision D1), no delay at unsignalised junctions, no side friction; model 23:00 corridor speed 39.5 km/h
vs Google 21.8-22.4 km/h. p14 replaces the SUPPLY side only (speeds, capacities, speed-flow, junction delay) and re-runs the
p13 check with the p13 demand (cached areas), same records, same 50/50 seed-13 split and the same TAG M3.1 thresholds.

## 1. Model and parameters

Everything is in one module, `frontend/src/engine/simulation/supplyConfig.ts` (`P14`), each value with a label
(`standard` / `derived` / `fitted` / `international` / `assumed`) and its source; `p14ParameterTable()` lists them (tested:
every entry has a label and a source). The functions are in `indianSupply.ts`; `staticAssignment.ts` runs them when
`supplyModel: 'p14'`.

**Copies of the standards (all third-party, so every "standard" value below is UNCONFIRMED against the official print).**
Indo-HCM 2017 (CSIR-CRRI): the official site has only a summary without tables
(https://crridom.gov.in/sites/default/files/files/Indo-HCM%20Snippets.pdf, pdftotext: chapter list, no numbers); tables were
read from a full-text copy at https://pdfcoffee.com/indo-hcm-2017pdf-pdf-free.html. Its Chapter 8 (unsignalised) is missing
from that copy; those values are as quoted second-hand by Shivashankar et al., IJRESM 4(11) 2021, Tables 4-5
(https://journal.ijresm.com/index.php/ijresm/article/download/1546/1489/2078). IRC:106-1990: scan at
https://archive.org/details/gov.in.irc.106.1990 (image-only PDF: pdftoppm + tesseract). IRC:86-2018:
https://archive.org/details/irc-86-2018 (text-layer PDF, pdftotext). IRC:65-2017 Table 9.1: as already coded in
`streetDesign/roundabout.ts`. HCM 2000 values via IIT Bombay NPTEL notes (T. V. Mathew). Local copies and OCR text:
`/workspace/work/p14-run/refs/` (outside the repo).

### 1.1 Free-flow speed

`carFFS = min(posted, V_op x 0.865) x f_lane x f_friction`, `stream FFS = carFFS x s0 (0.81)`; the link's free-flow time
runs at the stream FFS. `V_op = min(design speed of the class, operating speed of the carriageway typology)`.

| Parameter | Value | Label | Source |
|---|---|---|---|
| Design speed, plain terrain (km/h) | expressway 80, arterial 60, sub-arterial 60, collector 40, local 30 | standard | IRC:86-2018 Table 3.1 |
| OSM class → urban class | motorway → expressway; trunk, primary (+links) → arterial; secondary → sub-arterial; tertiary → collector; residential, unclassified, service, living_street → local | assumed | |
| Lane capacity of base sections (PCU/h/lane) | 2-lane undivided 1200; 4-lane divided 1350; 6-lane 1400; 8-lane 1700; 10-lane 2000 (8/10-lane only for expressways: Table 5.4 note, signals 1-3 km apart) | standard | Indo-HCM 2017 Table 5.4 |
| Operating speed of the typology | (C_lane − 210.8) / 20.11, 40-80 km/h: 2-lane undivided 49.2, 4-lane divided 56.6, 6-lane 59.1 km/h | standard (inverted) | Indo-HCM 2017 Eq. 5.4 / Table 5.5 (fitted on divided roads; applied to the undivided value too: assumption) |
| Mean car free speed / operating (85th percentile) speed | 0.865 | assumed | normal distribution, CV 0.15: 1/(1+1.036 × 0.15) |
| Posted limit | a CAP on the mean car speed (OSM maxspeed, a connected piece's maxspeed, the municipal default ≤ 50 km/h, or a drawn road's speed) | decision | replaces D1 (maxspeed as free-flow speed) inside p14 only |
| Lane width | OSM width/est_width ÷ lanes; else 3.5 m; 3.0 m on residential/living_street/service/unclassified | standard | Indo-HCM §5.1.2 (3.5 m), IRC:86-2018 §5.4 and note (i) (3 m permissible on access roads) |
| Lane-width reduction | HCM 2000 Exhibit 21-4 (3.6 m 0 … 3.0 m 10.6 km/h at a 100 km/h base), as a share relative to 3.5 m: 3.0 m → ×0.904 | international | https://archive.nptel.ac.in/content/storage2/courses/105101008/553_MlHway/point6/point.html |
| Stream share at low flow s0 | 0.81 | fitted | Indo-HCM 2017 Table 5.7 (see 1.4) |

### 1.2 Mid-block capacity and PCU

`capacity = C_lane(typology) x lanes this way x f_friction` (Indo-HCM Eq. 5.5 with only the access-point factor);
multilane undivided carriageways (not in Indo-HCM) take ×3000/3600 of the divided value (IRC:106-1990 Table 2, arterial;
derived).

| PCU set | two-wheeler | car | auto | bus | truck | minibus (bus_auto) | Source |
|---|---|---|---|---|---|---|---|
| Mid-block (p14 assignment) | 0.22 | 1.0 | 0.90 | 4.60 | 3.90 (two/three-axle) | 2.07 | Indo-HCM 2017 Table 5.2, divided roads, median (for planning) |
| Signalised stop line | 0.4 | 1.0 | 0.5 | 1.6 | 1.6 | 1.1 (LCV) | Indo-HCM 2017 Table 6.3 |
| p13 (unchanged) | 0.75 | 1.0 | 2.0 | 2.2 | 2.2 | 2.0 | IRC:106-1990 Table 1 |

Indo-HCM saturation flows (width based, unchanged) are in signal PCUs; p14 multiplies them by
`SIGNAL_TO_MIDBLOCK_PCU` = mean mid-block PCU / mean signal PCU of the Pune vehicle mix (`VEHICLE_TYPES` shares) = 1.16,
so stop-line and mid-block capacities are in the same unit as the link flows.

### 1.3 Side friction

| Level | Capacity and FFS factor | Label / source |
|---|---|---|
| none (flyover, bridge, tunnel, ramp, motorway, motorroad) | 1.00 | Indo-HCM base section |
| low | 0.90 | standard: Indo-HCM 2017 Table 5.12 (access points < 200 veh/h entering + leaving) |
| medium | 0.80 | Table 5.12 (200-500 veh/h) |
| high | 0.70 | Table 5.12 (> 500 veh/h) |

Indo-HCM derives these factors from the drop in stream speed against base sections (Annexure 5E.7) and applies them to
capacity (Eq. 5.5); p14 applies the same factor to the free-flow speed (decision). On-street parking (Tables 5.9-5.10:
0.70/0.65/0.40) and bus stops (Table 5.11: kerbside 0.80/0.60) are NOT applied: where cars park and buses stop is not mapped.

Inference per road (OSM ways grouped by name/ref and class, `frictionByRoad`): the higher of
- access points: junctions on the road where another road joins, per km (min length 0.2 km): medium ≥ 8, high ≥ 20 per km
  (assumed: Table 5.12's 200 / 500 veh/h at 25 veh/h per access point);
- frontage (OSM buildings from the backend's OSM index, centroid within 30 m, per 100 m of road): medium ≥ 2, high ≥ 6, or
  ≥ 1 commercial building (building=commercial/retail/office/hotel or a shop/amenity/office tag) per 100 m → high (market
  frontage). Assumed thresholds; IRC:106-1990 cl. 8.2 names frontage development and parked vehicles as the fringe conditions
  that set the capacity class. Without building data (index does not cover the area) access points alone decide (`basis`).

On the 28 journey-time routes at 23:00 the road length is 63 % medium, 17 % high, 9 % low, 11 % none.

### 1.4 Speed-flow (volume-delay) function

`t = t0_car x (1 + α x^β) / s0` for v/c ≤ 1, continued along its tangent above 1 (linear), with α 2.70, β 6.54, s0 0.81,
**fitted** to Indo-HCM 2017 Table 5.7 (LOS of multilane divided urban roads: v/c 0.15/0.45/0.75/0.85/1.00 at 84/76/59/41/22 %
of FFS; the same table is quoted for divided roads by Ahmed et al. 2025, already cited in `roadParameters.ts`). Least squares
on ln(t/t0), grid search (`/workspace/work/p14-run/fit_vdf.py`, result `vdf_fit.json`): fitted 81/80/57/42/22 %. The linear
continuation above capacity is an assumption (Indo-HCM gives nothing below its LOS F boundary; the power law would give
300 × free-flow time at v/c 2). Cross-check, not used: IRC:106-1990 §5.3 gives about 50 % of FFS at LOS C and one-third at
capacity. For comparison the p13 BPR (0.15/4) gives 87 % of FFS at capacity.

### 1.5 Junctions

- **Signalised**: unchanged (Indo-HCM width-based saturation flow, assumed 120 s cycle in the assignment, Webster's uniform
  delay; the micro-simulation's Webster plans). Saturation flow converted to mid-block PCUs (1.2).
- **Unmapped signals (assumed)**: a node where two different arterial/sub-arterial roads (by name/ref, IRC category ≤ 1, not
  ramps) meet, with no mapped signal within 35 m and not on a roundabout ring, is taken as signalised (`inferredSignalPoints`);
  OSM maps few of Pune's signals (p13: 0-8 stop lines on 1.4-7 km routes). The inferred points go to the corridor
  micro-simulation too, like the mapped ones.
- **Unsignalised priority junctions** (3+ stretches, no signal): approaches of the best rank (IRC category, ramps below
  their class) are the major road. Minor approaches give way to all major approach flow; major approaches lose a right-turning
  share (0.15, assumed) to the opposing major flow; when all approaches rank equally the junction is uncontrolled and each
  approach gives way to the others (two equal one-way carriageways merging are not controlled). Capacity: Indo-HCM Ch. 8
  `C = a·vc·e^(−vc(tc−b)/3600) / (1 − e^(−vc·tf/3600))`, `tc = tc,base + f_LV·ln(P_HV)`, `tf = 0.6·tc`; minor approach as the
  minor-road right turn (tc,base 3.80 s, f_LV 0.885, a 1.0, b 2.16), major right turn (2.70, 0.457, 0.8, 1.3) (second-hand,
  IJRESM 2021; the test reproduces its worked capacities 1,116.66 and 585.99 PCU/h). P_HV = 5.6 % (buses + trucks of the
  mix). A minor approach that only merges into one one-way carriageway takes its gaps × 6.2/7.1 (HCM 2000 merge vs crossing,
  international). Delay: HCM 2000 Eq. 17-38, `d = 3600/c + 900T[(x−1) + √((x−1)² + 3600x/(450Tc))] + 5`, T = 0.25 h (HCM
  default; T = 1 h was tried first and made an over-saturated minor approach wait about an hour); the test reproduces the IIT
  Bombay worked example (18.2 s).
- **Roundabouts** mapped in OSM (`junction=roundabout`): each entry gives way to the ring flow arriving at it, IRC:65-2017
  Table 9.1 `C = A·exp(−B·Qc)` per entry lane (up to 2 lanes), ICD = ring length / π (ICD clamped to the table's 20-70 m);
  same delay formula. Drawn roundabouts keep the p7 treatment.
- Conflicting flows come from the current link flows at each Frank-Wolfe iteration (diagonalisation, Sheffi 1985 §8.2): each
  iteration is a separable problem with the conflicting flows frozen.
- **Micro-simulation (IDM)**: each corridor link's desired speed is the p14 car free-flow speed (`MicroSimOptions.desiredSpeedKmh`;
  vehicle classes keep their own speed factors). Give-way behaviour was already Indo-HCM based (critical gaps 2.7/3.8 s with
  impatience, `TrafficMicroSim.criticalGap`) and is unchanged; inferred signals are passed as signal points.

## 2. Code

| File | What |
|---|---|
| `engine/simulation/supplyConfig.ts` | `P14` parameters with labels and sources; `SupplyModel`; `SUPPLY_MODEL_DEFAULT = 'p13'` |
| `engine/simulation/indianSupply.ts` | free-flow speed and capacity (`p14LinkSupply`), VDF (`p14TimeRatio`), PCU conversion, gap capacity and control delay, roundabout entry, side friction (`frictionByRoad`, `buildingPointsFromOsm`), inferred signals, approach rank |
| `engine/simulation/staticAssignment.ts` | `AssignmentOptions.supplyModel` / `buildings`; p14 link supply, PCU, VDF, junction control (`junctionControlP14`) and diagonalised junction delay; results carry `supplyModel`, `junctionDelayS`, `junctionCapacityPcu`, `inferredSignalPoints`. With `supplyModel` absent or 'p13' the code path is the p13 one (the project check reproduces p13's `base2` exactly). |
| `engine/simulation/analysisJob.ts`, `TrafficMicroSim.ts` | job carries `supplyModel` and `buildings`; corridor desired speeds and inferred signals |
| `engine/simulation/trafficSignals.ts` | `buildingPointsIn(bounds)`: building centroids from the backend OSM index (no Overpass fallback) |
| `engine/simulation/SimulationMode.ts` | `supplyModel` state, `setSupplyModel` (part of the study key; a baseline made under the other model goes stale with its own notice), building loading for p14, analysis key |
| `engine/testing/P13Validation.test.ts` | sets may carry `"model": "p14"`; areas' buildings are read through the app's own loader; route diagnostics split out junction delay and friction |
| `engine/testing/NetworkValidation.test.ts` | `VAL24_SUPPLY_MODEL=p14` |
| `engine/testing/SupplyP14.test.ts` | 19 tests (parameters, VDF fit, speeds/capacities, worked gap-capacity and delay examples, IRC:65 entries, PCU conversion, friction inference, inferred signals, assignment p13 unchanged vs p14, micro-sim desired speed) |

## 3. Results: supply only, OLD demand (p13 cached areas), same records, split and thresholds

Run: `/workspace/work/p14-run/full1.jsonl` (`run_p14.sh full1 sets_p14.json`, 60 Frank-Wolfe iterations, both sets in one
run; the `default` row is the p13 model on this branch and reproduces p13's `base2.jsonl` exactly).

### 3.1 Project check (TAG M3.1 criteria, hold-out decides)

| Model | Records | Journey times within 15 % / 1 min | 09:00 | 23:00 | JT median error | Counts GEH < 5 | Mean GEH | R² | Count bias | River crossings | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| p13 | calibration | 3/28 | 2/14 | 1/14 | −43.1 % | 1/16 | 74.5 | −2.03 | −44.2 % | 11,894/38,499 (−69.1 %) | (not used) |
| p13 | **hold-out** | **3/28** | 2/14 | 1/14 | −37.1 % | **1/16** | 48.9 | −1.68 | −32.3 % | 24,704/53,407 (**−53.7 %**) | **FAIL** |
| p14 | calibration | 4/28 | 0/14 | 4/14 | +42.2 % | 1/16 | 73.8 | −1.94 | −43.6 % | 13,080/38,499 (−66.0 %) | (not used) |
| p14 | **hold-out** | **8/28** | 0/14 | 8/14 | +54.6 % | **3/16** | 46.1 | −1.54 | −30.5 % | 25,429/53,407 (**−52.4 %**) | **FAIL** |

Needed: 85 % of journey times, 85 % of counts within GEH 5, river crossings within 5 %. Fails all three, before and after.

### 3.2 Journey times by hour (all 28 corridors; speeds as the mean of corridor speeds, as in p13)

| | 23:00 within tolerance | 23:00 median error | 23:00 mean speed | 09:00 within tolerance | 09:00 median error | 09:00 mean speed |
|---|---|---|---|---|---|---|
| Google (typical) | | | 22.4 km/h (TomTom city 26.5) | | | 18.8 km/h (TomTom 16.8) |
| p13 | 2/28 | −45.9 % | 39.5 km/h | 4/28 | −31.7 % | 23.5 km/h |
| p14 | 12/28 | −0.2 % | 22.1 km/h | 0/28 | +141 % | 6.6 km/h |

Hold-out per corridor (minutes; * = within tolerance):

| Corridor | Google 09:00 | p13 | p14 | Google 23:00 | p13 | p14 |
|---|---|---|---|---|---|---|
| Satara Rd Katraj–Swargate | 16.0 | 10.0 | 32.5 | 12.5 | 6.8 | 11.3* |
| Sinhagad Rd | 6.5 | 8.4 | 42.9 | 5.0 | 3.8 | 5.5* |
| FC Rd | 5.0 | 3.7 | 15.9 | 6.0 | 2.2 | 4.1 |
| JM Rd | 10.5 | 5.2 | 17.1 | 9.5 | 4.2 | 10.4* |
| Nagar Rd | 12.0 | 5.7 | 21.0 | 8.0 | 4.4 | 7.5* |
| Paud Rd | 10.5 | 8.0 | 37.7 | 7.5 | 4.7 | 7.4* |
| Baner Rd | 21.0 | 19.2* | 115.1 | 14.0 | 7.9 | 13.7* |
| Ganeshkhind Rd | 12.0 | 12.2* | 52.9 | 9.0 | 8.5* | 13.9 |
| Bund Garden Rd | 5.0 | 8.2 | 63.7 | 4.0 | 2.3 | 4.0* |
| Bypass Chandani–Warje | 6.0 | 16.4 | 177.2 | 6.5 | 4.2 | 9.3 |
| NIBM Rd | 6.0 | 3.1 | 13.7 | 6.5 | 3.0 | 10.1 |
| Alandi Rd | 9.0 | 4.8 | 12.5 | 7.0 | 3.8 | 5.5 |
| Hinjewadi–Wakad | 9.0 | 5.7 | 26.1 | 5.5 | 3.6 | 5.8* |
| MG Rd–Camp | 11.0 | 8.0 | 26.6 | 11.0 | 5.4 | 15.1 |

Where the 23:00 time goes now: running 76 %, signals 16 % (mapped + inferred; 2,520 s over the 28 routes vs 1,312 s in p13),
unsignalised junctions and roundabouts 8 %; route maximum v/c ≤ 0.8 on 26 of 28 routes at night (0.99 and 1.02 on two). Night misses: too slow on Ganeshkhind Rd (high/medium
friction, 21 km/h free flow), the bypass (the NH 48 bypass is a trunk road classed arterial with low friction: 34 km/h free
flow vs Google's 42 km/h), NIBM Rd and MG Rd–Camp (unsignalised delay 3-5 min on 2-4 km); too fast on FC Rd and Alandi Rd.

**Why 09:00 got worse.** The demand is unchanged and is the p13 finding: the area demand puts more than a carriageway's
capacity on most corridor links at 09:00 (route maximum v/c 0.8-4.8 in p14, 1.2-5.9 in p13; lower in p14 only because
Indo-HCM PCUs count two-wheelers at 0.22 instead of 0.75). The p13 BPR curve (0.15/4) let a link at v/c 1.5 cost 1.8 × its
free-flow time; the Indo-HCM curve, which drops to 22 % of free-flow speed AT capacity, makes it 12.5 ×; equilibrium then sends
traffic down residential roads whose minor approaches have almost no gaps (route junction delays up to 73 min). Google's
09:00 speed (18.8 km/h) is only 16 % below its 23:00 speed, so these corridors are not at capacity at 09:00 in reality: the
09:00 failure is the demand (level and spatial pattern), which a supply change cannot fix and was not tuned.

### 3.3 Counts (hold-out, published 2021 counts factored to 2026)

3/16 within GEH 5 (SL 05 Bhau Patil Rd 0.78, OC 05 Saswad Rd 3.53, OC 03 Nagar Rd Wagholi 4.99, just under the limit)
vs 1/16 (SL 05 3.5); mean GEH 48.9 → 46.1, bias −32.3 % → −30.5 %, river −53.7 % → −52.4 %. Counts
remain too low: a demand-side result (p13 §4.2).

### 3.4 Official 15-site check (unchanged data and criteria; `run_val.sh val_p14 p14`)

| Model | Sites within GEH 5 (all) | Calibration | Hold-out | Mean GEH | River screen line | Bias |
|---|---|---|---|---|---|---|
| p13 (this branch, `val_p13`; identical to p13's `val_default`) | 2/15 | 1/7 | 1/8 | 32.2 | −26.5 % | −29.3 % |
| p14 | 2/15 | 1/7 | 1/8 (Tilak Rd instead of Yerwada/Ambedkar) | 30.7 | −29.1 % | −28.5 % |

Both fail TAG M3.1. By the p13 rule (a set may become the default only if it passes the project hold-out AND does not make the
official check worse: no fewer sites, no larger river error) p14 does not qualify: it fails the project hold-out and its river
error is larger.

### 3.5 Decision (the default)

`SUPPLY_MODEL_DEFAULT` stays `'p13'`, so the app, its banner and its recorded validation numbers (VALIDATION_P13.md) still
describe what Simulate runs. p14 runs with `SimulationMode.setSupplyModel('p14')` (engine) and in both harnesses. It is the
better description of free-flow conditions (night) and the worse one at the peak until the demand is fixed; switching it on
for the app should wait for a demand fix (an OD matrix or ATCS counts, VALIDATION_P13.md §7) and then re-run both checks. No
UI switch was added (the banner would otherwise show p13 numbers for a p14 run).

## 4. Limits

- Every standard value was read from third-party copies; the Indo-HCM unsignalised values are second-hand quotations.
- Side friction is inferred (access points and OSM building footprints with assumed thresholds); parking and bus stops are
  not mapped and not applied; Indo-HCM's friction factors are capacity factors applied here to speed as well.
- The mean-to-85th-percentile ratio (0.865), the right-turning share (0.15), the inferred-signal rule and the linear
  continuation above capacity are assumptions.
- One PCU set (divided-road medians) for every link; Indo-HCM Ch. 8's own PCUs are not known (its capacities are used in
  mid-block PCUs).
- Junction delay uses a link-level approximation of movements (no turning counts); the uncontrolled-junction rule (each
  approach yields to all others) is a simplification of Indian practice.
- The p14 model was not tuned to the data (no parameter was fitted to Google or the counts).

## 5. Gates (2026-11-25, at a44d88f)

`tsc -p tsconfig.app.json` clean; `oxlint` 0 errors (17 warnings, all in files this branch does not touch); full Vitest
162 files passed, 9 skipped (1,355 tests passed, 10 skipped; includes SupplyP14.test.ts 19/19); backend unchanged, pytest
`tests/test_osm_index.py` 5 passed (the building endpoint the friction inference reads). Logs: `/workspace/work/p14-run/gate_*.log`.

## 6. Reproducing

`/workspace/work/p14-run/` (outside the repo): `start_backend.sh` (port 8414, a copy of the project DB in `db/`, OSM index
`/workspace/work/vp-int-e2e/db_osm_index.db`, Python deps in `pydeps/`; `backend/twincity.db` is never touched);
`run_p14.sh TAG SETS` (the p13 harness on this branch reading the p13 caches `/workspace/work/p13-run/v1_c*.cache`, OLD demand;
`flock /workspace/work/heavy.lock`); `sets_p14.json` (p13 defaults and p14); `summary.py`, `showjt.py` (tables);
`run_val.sh TAG [p14]` (official check; scored by `/workspace/work/p10-run/score_p10.py`); `fit_vdf.py` (VDF fit);
`refs/` (standards copies, OCR/pdftotext). Stop the backend with `/workspace/work/vp-sev-e2e/killport.sh 8414`.
