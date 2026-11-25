# Project-level validation against estimated data, p13 (branch `p13-validation`, off `p11-sim` 036e805)

Status: **Done (2026-11-25). The project check FAILS on its hold-out records, with the default and with the tuned parameters. The tuned set is NOT on by default (opt-in, labelled estimated). The official-count check is unchanged: 2/15 within GEH 5, still fails.**

Why this exists: the traffic model fails the official-count check (UK DfT TAG M3.1: 2 of 15 CMP 2008 / Gunjan 2017 count
sites within GEH 5, hold-out 1/8, river screen line −26.5 %). Pune publishes no current official counts. On 2026-11-25
the user agreed that, for this college project, a **project-level check on available non-official data** is acceptable,
provided it is labelled *estimated / third-party*, kept apart from the official data, and never mixed with it. The
official-count check is unchanged and still reports its own result. No threshold was loosened, nothing hides the banner.

## 1. Data (`/workspace/work/urbanos-data/estimated/validation-v1/`, outside the repo)

Every record carries its source, URL, access date, method and label (`journey_times.csv`, `counts.csv`, `sources.json`).

| Set | Records | Source | Year / date | Label | Notes |
|---|---|---|---|---|---|
| Journey times | 28 corridors × 2 periods = 56 | Google Maps directions, driving, "Depart at" Tue 2026-12-01 **09:00** and **23:00** IST, first (recommended) route: "typically X–Y min", distance, via-road | read 2026-11-25 | estimated (third-party) | Point value = midpoint of the range; the range is kept. O/D are coordinates snapped to the app's own OSM index (`scripts/snap_corridors.py`), so Google and the model route between the same points. |
| Counts | 32 sites, peak hour, both directions | Maha-Metro Pune Metro Phase-2 DPR Part 1 (2024), UMTC videographic surveys, typical working day | Nov–Dec 2021 | published-study count, factored to 2026: estimated | 16 screen-line crossings (9 river bridges, 7 rail crossings), 10 mid-blocks, 6 outer-cordon roads; motor vehicles (cycles removed by the site's NMT share); × 1.045⁵ = 1.246 to 2026 (growth assumption carried from the p10 estimated dataset); OSM ways as matched in p10. |
| City cross-check | 1 | TomTom Traffic Index 2025, Pune (city) | 2025 | estimated (third-party) | Tue 09:00: 35 min 40 s per 10 km (16.8 km/h); Tue 23:00: 22 min 40 s (26.5 km/h). Not in the pass/fail. |

Corridors (road class group / city sector): Satara Rd Katraj–Swargate, Sinhagad Rd, Karve Rd, FC Rd, JM Rd, Nagar Rd,
Solapur Rd, Paud Rd, Baner Rd, Ganeshkhind (University) Rd, Old Mumbai–Pune Hwy, Shivaji Rd via Shivaji Bridge, Tilak Rd,
Bajirao Rd, Airport Rd, Bund Garden Rd, Senapati Bapat Rd, University Rd (Aundh), Mumbai–Bengaluru bypass (Chandani Chowk–
Warje), Kondhwa Rd, NIBM Rd, Kharadi bypass, Pashan Rd, Alandi Rd, Hinjewadi–Wakad, Laxmi Rd, Sangamwadi–Yerwada (river
crossing), MG Rd–Camp. Google's mean speed over the 28 corridors: 18.0 km/h at 09:00, 21.8 km/h at 23:00 (TomTom city:
16.8 / 26.5 km/h).

Data quality, stated plainly:
- Google "typical" times are Google's own estimates from historical speeds, not measurements we can audit; the range is
  wide (e.g. 10–22 min). One browser session read the wrong hours (it converted the URL time stamp to UTC: 03:30 and
  17:30); those six corridors were read again at the right hours and the bad read is kept in `raw/` marked REJECTED.
- At 2 corridors Google's 23:00 card showed one value instead of a range; at Laxmi Rd the recommended route at 23:00 is a
  different one (2.9 km instead of 4.0 km). Route length (Google vs our OSM route) differs by more than 15 % on 3 corridors
  (Shivaji Rd, Laxmi Rd AM, Sangamwadi–Yerwada): the model routes between the same points and reports its own length.
- Counts are 2021 on a 2026 network (5 years; factored by an assumption). The Metro lines and new flyovers opened since
  then are in the network, not in the counts. Six count sites are at the same crossings as official-check sites (Mhatre,
  Lakdi/Sambhaji, Shinde, Shivaji, Rajaram, Firodia/Sancheti): the data differ (2021 vs 2008) but the places are the same, so the
  "official check not worse" guard is not fully independent of these six.
- Not used: Kureshi 2026 / NICMAR 2025 junction counts (they set the default edge flows), Gunjan 2017 / CMP 2008 (the
  official check's own sites), DPR 2021 junction totals (no junction-node matching yet), Swargate–Katraj DPR 2022 mid-blocks
  (locations too vague), news articles (never a counts source).

## 2. Split (fixed before any tuning run, `split.json`)

50/50, seed 13, stratified by road class group (trunk / primary / secondary-or-lower; journey times by the corridor's
class, counts by the counted way's class), ordered by area inside each stratum and alternated; both periods of one
corridor stay on the same side.

- Journey times: calibration 14 corridors (28 observations), **hold-out 14 corridors (28)**: Satara Rd, Sinhagad Rd,
  FC Rd, JM Rd, Nagar Rd, Paud Rd, Baner Rd, Ganeshkhind Rd, Bund Garden Rd, bypass Chandani–Warje, NIBM Rd, Alandi Rd,
  Hinjewadi–Wakad, MG Rd–Camp.
- Counts: calibration 16, **hold-out 16**: MB 01 Pashan, MB 05 SB Rd, MB 06 Tilak Rd, MB 07 Nashik Rd, MB 09 Aundh–Ravet,
  MB 11 Wakad–Bhosari, OC 03 Nagar Rd Wagholi, OC 05 Saswad Rd, SL 05 Bhau Patil Rd, SL 08 Firodia, SL 11 BT Kawade,
  SL 15 Mhatre, SL 16 Lakdi, SL 18 Shivaji, SL 19 Rajaram, SL 23 Harris (river hold-out: 5 bridges).

The hold-out records are never seen by the tuning (`P13Validation.test.ts` passes only `split === 'calibration'` to the
objective and to ODME; ODME also refuses a hold-out dataset id).

## 3. Method as built

**Model evaluated.** The app's own code: each record's study area (2 km around the corridor's or count site's OSM ways) is
built by `SimulationMode` exactly as in the Simulate panel (local OSM index, mapped signals, network corrections, hourly
profile, class-typical edge flows, estimated flows OFF), and the area's static user-equilibrium assignment
(`staticAssignment.ts`, Frank–Wolfe, BPR) is run at the record's hour. Journey time = the shortest path between the snapped
O and D on the converged link times (in user equilibrium the travelled paths have the minimum cost); its length is checked
against Google's. Count = the assigned motor vehicles through ONE cross-section of the counted stretch per direction of travel: the busiest
link of the counted ways in each direction (direction from each link's way bearing, so a divided road's two one-way
carriageways are the two directions), both directions added (`sectionCount` in `projectCheck.ts`; the same rule as the
p11 comparison fix 53189e4). Before the fix (draft), each OSM way's busiest piece was added: see §4.1. The micro-simulation is not used for the check (it covers only the neighbourhood of one
road). Harness: `frontend/src/engine/testing/P13Validation.test.ts` (opt-in `P13=1`); areas are built once and cached
(v8-serialised, trimmed to what the assignment reads), then only the assignment is re-run per parameter set.

**Criteria** (`frontend/src/engine/calibration/projectCheck.ts`, fixed): counts GEH < 5 at ≥ 85 % of sites; journey times
within 15 % or 1 minute (whichever is larger) on ≥ 85 % of routes; river crossings' total within 5 %; R² reported. The
verdict uses the hold-out records only. These are TAG M3.1's numbers; the official-count check (`trafficValidation.ts`)
is untouched.

**Supply-side tuning** (`frontend/src/engine/simulation/supplyParams.ts`): 9 parameters, each bounded by published ranges
(stated in the file): free-flow speed factor per IRC category (arterial / sub-arterial / collector, 0.6–1.2 on the 50/40/30
km/h class defaults; Indo-HCM 2017 urban free-flow speeds), mid-block capacity factor (0.7–1.3 on IRC:106-1990), signal
saturation-flow factor (0.7–1.3 on Indo-HCM), BPR α (0.10–1.0) and β (2–6), assumed signal cycle (90–180 s) and one
demand-side factor, a demand scale on the compiled area demand (0.6–1.6). Defaults reproduce the pre-p13 model exactly
(tested). Optimiser: SPSA (Spall 1998) in the unit box, gains a_k = 0.15/(k+2)^0.602, c_k = 0.1/k^0.101, 20 iterations,
2 evaluations per iteration, best evaluated point kept; seeds 1, 2, 3 (each seed is a different perturbation sequence).
Objective on the CALIBRATION records only: mean over journey times of ln(1 + (ln(model/obs)/0.15)²) + mean over counts of
ln(1 + (GEH/5)²) (a robust, Cauchy-type loss scaled by the two pass marks, so one wild site cannot dominate) + 0.5 × the
squared drift from the defaults in the unit box (regulariser). Tuning runs use 15 Frank–Wolfe iterations (fixed, so every
evaluation is deterministic); the before/after evaluations use 60 (the app's own cap).

**Demand side, ODME** (`P13_MODE=odme`): Spiess (1990) gradient ODME (`demand/odme.ts`, unchanged) on each calibration
count's own area matrix, cell factors bounded to 0.5–2, with the TAG M3.1 Table 5 matrix-change checks per area (slope
0.98–1.02, intercept, R² > 0.95, trip ends, trip-length mean and s.d. ±5 %, sector-to-sector). Hold-out records are never
passed in (the estimator also refuses a hold-out dataset id). A study-area matrix belongs to that area only: no hold-out
area shares an OD cell with a calibration area, so area-level ODME cannot improve a hold-out result; the only part of a
demand correction that transfers between areas is its overall scale, which is the SPSA demand-scale parameter.

## 4. Results

### 4.1 Count-matching bug (fixed before any tuning that is reported here)

The draft harness summed, for a count site, the busiest link of **each** OSM way and direction. Count sites are matched to
the whole counted stretch (2 to 20 consecutive ways; MB 06 Tilak Rd 19, OC 08 20), so a site read up to 40 link volumes
added instead of one cross-section. Fixed: one cross-section per direction of travel (busiest link of the stretch in each
direction, both added; `sectionCount` / `sectionDirections` / `wayBearing` in `projectCheck.ts`, used by the evaluation and
by ODME's count groups; 3 tests in `ProjectCheckP13.test.ts`: consecutive two-way pieces, a divided road's two one-way
carriageways, a gently curving stretch). The first tuning run (`tune1.jsonl`, pipeline2) used the buggy matching and was
stopped and discarded; a first SPSA run with a smaller gain (a = 0.05, `tune3_smallgain_aborted.jsonl`) was stopped after
6 iterations because its steps were too small to move off the defaults (no hold-out result was looked at).

| Default parameters, hold-out | Before the fix (`base.jsonl`) | After (`base2.jsonl`) |
|---|---|---|
| Counts within GEH 5 | 0/16 (mean GEH 96.9, bias +117.7 %) | 1/16 (mean GEH 48.9, bias −32.3 %) |
| River crossings (5 bridges) | −31.0 % | −53.7 % |
| Journey times (unchanged by the fix) | 3/28, median −37.1 % | 3/28, median −37.1 % |

With the fix the model's counts are mostly too LOW, not too high; the old river figure (−31 %) looked better only because
the double counting inflated it.

### 4.2 Why the model is too fast, and the gridlocked corridors (default parameters)

Route diagnostics (`diag1.jsonl`, `diag2.jsonl`: each modelled route's time split into running at free-flow speed, signal
delay and congestion delay, and the most loaded links of the gridlocked routes):

- **23:00, no congestion** (route v/c below 0.9 on 12 of 14 corridors): the model takes 45–60 % of Google's time on most
  corridors; almost all of it is running time, signal delay 0–2 min per route (0–8 mapped stop lines on routes of 1.4–7 km
  that pass 11–97 junctions). Model mean speed 39.5 km/h vs Google 21.8 km/h (TomTom city 26.5 km/h).
- **Free-flow speeds above the urban ceiling**: route free-flow speeds of 60–65 km/h on Satara Rd, Karve Rd and FC Rd come
  from OSM `maxspeed` tags (Satara Rd 60, Karve Rd 65, Sangamwadi Rd 85, bypass 80) used as the free-flow speed; the
  50 km/h municipal ceiling (`roadParameters.ts`) applies only to untagged roads. That is a recorded decision
  (PLANNING_DEFAULTS_DECISIONS.md D1: OSM roads keep their tagged speed), not a code bug, so it was not changed here; the
  speed factor (0.6–1.2) is how the tuning can lower it.
- **Not modelled**: delay at unsignalised junctions, side friction (parking, buses, pedestrians; Indo-HCM's speed
  reductions), speed breakers, signals missing from OSM. These, not a bug, are the main reason for the night bias; inside
  the published bounds the tuning can remove only part of it (tuned: 30.9 km/h at 23:00).
- **Gridlock at 09:00** (Solapur Rd 110 min vs 20, Sangamwadi–Yerwada 35 vs 16, bypass Chandani–Warje 16 vs 6, Kharadi
  23 vs 14.5): the area demand puts 3–5× a carriageway's IRC:106 capacity on single corridor links (Solapur Rd main
  carriageway 12,625 pcu/h on 3 lanes; Bund Garden Rd 12,417 pcu/h on 2 lanes, v/c 4.8; bypass 8,220 pcu/h on 2 lanes,
  v/c 3.2; Mundhwa Rd flyover 8,315 pcu/h on 2 lanes) and BPR then multiplies link times by 13–90; on Solapur Rd the
  equilibrium sends 3,777 pcu/h down a one-lane service road. Capacities and signal timings are as coded and documented
  (2,571 pcu/h per 2-lane carriageway of a divided arterial = IRC:106 3,600/2/0.7); no bug was found in capacity, signal
  timing or the network for these links.
- **The demand's spatial pattern is wrong, not only its level**: the same area demand is far above capacity at corridor
  bottlenecks and far below the published counts at the river and rail crossings (hold-out count bias −32 %, river −54 %).
  A single demand scale (the one demand-side parameter) trades one against the other; the official 15-site check shows the
  same under-count (bias −29 %). This is the main limit, and it is on the demand side (zone / gateway demand and its
  distribution), outside what a bounded supply tuning can fix.

No real model bug was found in this step, so no model code was changed for it (only the harness gained the diagnostics).

### 4.3 Tuned parameters, calibration vs hold-out (60 Frank–Wolfe iterations, every record; as run, before the §4.7 record fix)

SPSA, 3 seeds × 20 iterations on the calibration records (a = 0.15, c = 0.1, A = 2, λ = 0.5). The tuned set is the seed
with the lowest CALIBRATION objective: seed 1 (J 6.83 vs 7.49 at the defaults; seeds 2 and 3: 7.10 and 7.03). Seeds 2 and
3 are shown for transparency only; the hold-out was not used to choose.

| Set | Records | Journey times within 15 % / 1 min | 09:00 | 23:00 | JT median error | Counts GEH < 5 | Mean GEH | R² | Count bias | River crossings | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| default | calibration | 3/28 | 2/14 | 1/14 | −43.1 % | 1/16 | 74.5 | -2.03 | −44.2 % | 11,894/38,499 (−69.1 %) | (not used) |
| default | holdout | 3/28 | 2/14 | 1/14 | −37.1 % | 1/16 | 48.9 | -1.68 | −32.3 % | 24,704/53,407 (−53.7 %) | **FAIL** |
| tuned_s1 | calibration | 5/28 | 4/14 | 1/14 | −32.9 % | 1/16 | 71.3 | -2.24 | −34.4 % | 14,739/38,499 (−61.7 %) | (not used) |
| tuned_s1 | holdout | 9/28 | 3/14 | 6/14 | −18.9 % | 0/16 | 53.9 | -2.03 | −24.8 % | 26,132/53,407 (−51.1 %) | **FAIL** |
| tuned_s2 | calibration | 1/28 | 1/14 | 0/14 | −27.8 % | 1/16 | 69.8 | -2.25 | −24.6 % | 16,557/38,499 (−57.0 %) | (not used) |
| tuned_s2 | holdout | 6/28 | 4/14 | 2/14 | −28.4 % | 0/16 | 48.1 | -1.83 | −9.8 % | 32,062/53,407 (−40.0 %) | **FAIL** |
| tuned_s3 | calibration | 6/28 | 5/14 | 1/14 | −24.1 % | 2/16 | 69.2 | -2.15 | −23.5 % | 16,500/38,499 (−57.1 %) | (not used) |
| tuned_s3 | holdout | 4/28 | 3/14 | 1/14 | −22.7 % | 1/16 | 46.3 | -1.88 | −6.9 % | 33,256/53,407 (−37.7 %) | **FAIL** |

Parameter sets (bounds in `supplyParams.ts`):
- tuned_s1 (the tuned set): free-flow speed factor arterial 0.62 / sub-arterial 0.93 / collector 1.06, mid-block capacity
  ×1.06, saturation flow ×1.10, BPR α 0.179 β 2.02, cycle 122 s, demand ×1.22. The arterial speed factor and BPR β went to
  (near) their bounds: the data ask for slower arterials and a flatter delay curve than the bounds allow.
- tuned_s2: speed 0.92 / 1.02 / 0.90, capacity ×1.04, saturation ×0.89, α 0.236 β 2.64, cycle 137 s, demand ×1.34.
- tuned_s3: speed 1.14 / 1.04 / 0.74, capacity ×0.95, saturation ×0.83, α 0.376 β 2.15, cycle 115 s, demand ×1.33.
  The three seeds end far apart at similar objectives: the parameters are poorly identified by these data.

**Hold-out, before → after (default → tuned_s1)**: journey times 3/28 → 9/28 within 15 % / 1 min (85 % needed; median error
−37.1 % → −18.9 %; 23:00: 1/14 → 6/14); published counts within GEH 5 1/16 → 0/16 (mean GEH 48.9 → 53.9; R² −1.68 →
−2.03); river crossings −53.7 % → −51.1 % (5 % needed). **Fails all three criteria, before and after.** Mean modelled
corridor speed: 23.5 → 22.3 km/h at 09:00 (Google 18.0, TomTom 16.8), 39.5 → 30.9 km/h at 23:00 (Google 21.8, TomTom
26.5). Gridlock remains on the bypass (12.2 min vs 6).

### 4.4 Official 15-site check (unchanged code and data; `run_val.sh`)

| Parameters | Sites within GEH 5 (all) | Calibration | Hold-out | River screen line | Bias |
|---|---|---|---|---|---|
| default | 2/15 (mean GEH 32.2) | 1/7 | 1/8 | −26.5 % | −29.3 % |
| tuned_s1 | 2/15 (mean GEH 30.4) | 2/7 | 0/8 | −15.6 % | −16.3 % |

Both fail TAG M3.1. With the tuned set the official hold-out loses its one site (1/8 → 0/8), so by the rule the tuned set
also "makes the official check worse", even though the river error and the bias improve.

### 4.5 Demand side: ODME on the calibration counts (Spiess, cell factors 0.5–2, tuned_s1, `odme3.jsonl`)

Each calibration count's own area matrix, adjusted toward its count (never a hold-out record). Only 5 of 16 reach GEH < 5
(SL 10, SL 22, SL 07, MB 03, OC 08, all below 2; SL 22 already started at 3.95), and **no area's matrix change passes all nine TAG M3.1
Table 5 checks** (slope 0.98–1.02, intercept, R² > 0.95, trip ends, trip length mean and s.d. within 5 %, sector-to-sector):
the counts need matrix changes far larger than TAG allows (totals ×0.66 to ×1.49, up to half the cells at a bound). The
ODME matrices are therefore not used anywhere, and in any case an area's matrix does not carry over to another area
(§3), so ODME cannot change a hold-out result.

- cnt_sl_17: GEH 47.84 → 24.77, matrix total ×1.2514, cells at bound 205/1492, TAG Table 5 2/9 within (outside: Cell values: slope (estimated on prior) 1.4697; Cell values: intercept -3.7372; Cell values: R² 0.8439; Trip ends: slope 1.3382; Trip ends: intercept -55.4688; Trip ends: R² 0.9384; Sector to sector: largest change 79.8554)
- cnt_sl_21: GEH 107.69 → 60.06, matrix total ×1.3237, cells at bound 270/828, TAG Table 5 0/9 within (outside: Cell values: slope (estimated on prior) 1.2031; Cell values: intercept 3.5312; Cell values: R² 0.8114; Trip ends: slope 1.283; Trip ends: intercept 31.7994; Trip ends: R² 0.8325; Trip length: change in mean 6.2782; Trip length: change in standard deviation -6.7655; Sector to sector: largest change 100)
- cnt_sl_22: GEH 3.95 → 0, matrix total ×0.9809, cells at bound 0/168, TAG Table 5 6/9 within (outside: Cell values: intercept -1.8341; Trip ends: slope 0.9883; Trip ends: intercept -8.7789)
- cnt_sl_29: GEH 139.11 → 107.06, matrix total ×1.4288, cells at bound 77/244, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 1.5523; Cell values: intercept -8.8609; Cell values: R² 0.8221; Trip ends: slope 1.4944; Trip ends: intercept -67.5581; Trip ends: R² 0.829; Trip length: change in standard deviation -6.1554; Sector to sector: largest change 96.3698)
- cnt_sl_10: GEH 22.42 → 1.73, matrix total ×0.8268, cells at bound 160/481, TAG Table 5 0/9 within (outside: Cell values: slope (estimated on prior) 0.8435; Cell values: intercept -0.7098; Cell values: R² 0.8141; Trip ends: slope 0.882; Trip ends: intercept -49.2298; Trip ends: R² 0.8565; Trip length: change in mean -11.5596; Trip length: change in standard deviation -7.5597; Sector to sector: largest change 46.073)
- cnt_sl_12: GEH 146.17 → 119.49, matrix total ×1.0811, cells at bound 85/840, TAG Table 5 2/9 within (outside: Cell values: slope (estimated on prior) 1.0522; Cell values: intercept 0.94; Cell values: R² 0.9219; Trip ends: slope 1.0605; Trip ends: intercept 18.1682; Trip ends: R² 0.9087; Sector to sector: largest change 85.6943)
- cnt_sl_20: GEH 98.1 → 52.08, matrix total ×1.2816, cells at bound 101/363, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 1.0578; Cell values: intercept 13.692; Cell values: R² 0.8172; Trip ends: slope 1.2228; Trip ends: intercept 63.7142; Trip ends: R² 0.5586; Trip length: change in mean 6.9223; Sector to sector: largest change 100)
- cnt_sl_07: GEH 6.53 → 0.03, matrix total ×0.9726, cells at bound 0/1249, TAG Table 5 5/9 within (outside: Cell values: intercept -0.2209; Trip ends: slope 0.9769; Trip ends: intercept -4.0556; Sector to sector: largest change 15.0908)
- cnt_sl_14: GEH 104.49 → 36.03, matrix total ×1.4888, cells at bound 191/413, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 1.7287; Cell values: intercept -8.7508; Cell values: R² 0.8932; Trip ends: slope 1.5968; Trip ends: intercept -75.673; Trip ends: R² 0.8933; Trip length: change in mean 7.2066; Sector to sector: largest change 80.4959)
- cnt_mb_03: GEH 14.89 → 0, matrix total ×0.9246, cells at bound 0/916, TAG Table 5 4/9 within (outside: Cell values: slope (estimated on prior) 0.9681; Cell values: intercept -1.4393; Trip ends: slope 0.8989; Trip ends: intercept 23.319; Sector to sector: largest change 22.5318)
- cnt_mb_10: GEH 126.61 → 45.87, matrix total ×0.657, cells at bound 641/1157, TAG Table 5 0/9 within (outside: Cell values: slope (estimated on prior) 0.5925; Cell values: intercept 1.8139; Cell values: R² 0.8159; Trip ends: slope 0.6692; Trip ends: intercept -11.428; Trip ends: R² 0.9651; Trip length: change in mean -7.8074; Trip length: change in standard deviation 5.783; Sector to sector: largest change 47.2619)
- cnt_mb_12: GEH 73.96 → 25.87, matrix total ×1.2322, cells at bound 1176/8184, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 1.2178; Cell values: intercept 0.0391; Cell values: R² 0.895; Trip ends: slope 1.2437; Trip ends: intercept -0.8203; Trip ends: R² 0.9594; Trip length: change in mean 8.9447; Sector to sector: largest change 99.5129)
- cnt_oc_13: GEH 76.32 → 39.18, matrix total ×1.2597, cells at bound 16/67, TAG Table 5 0/9 within (outside: Cell values: slope (estimated on prior) 1.2053; Cell values: intercept 7.3005; Cell values: R² 0.8353; Trip ends: slope 1.1993; Trip ends: intercept 60.3223; Trip ends: R² 0.8828; Trip length: change in mean 15.6989; Trip length: change in standard deviation 11.1065; Sector to sector: largest change 100)
- cnt_oc_14: GEH 92.17 → 35.12, matrix total ×0.7693, cells at bound 162/361, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 0.9338; Cell values: intercept -9.6541; Cell values: R² 0.95; Trip ends: slope 0.7765; Trip ends: intercept -7.1485; Trip ends: R² 0.8569; Trip length: change in mean -9.4685; Sector to sector: largest change 38.6809)
- cnt_oc_08: GEH 17.31 → 0.08, matrix total ×1.1766, cells at bound 0/311, TAG Table 5 3/9 within (outside: Cell values: slope (estimated on prior) 1.2609; Cell values: intercept -3.7863; Trip ends: slope 1.23; Trip ends: intercept -40.3121; Trip length: change in standard deviation -6.142; Sector to sector: largest change 21.9877)
- cnt_oc_09: GEH 61.97 → 28.5, matrix total ×1.4561, cells at bound 18/34, TAG Table 5 1/9 within (outside: Cell values: slope (estimated on prior) 1.0976; Cell values: intercept 42.6099; Cell values: R² 0.7062; Trip ends: slope 1.1546; Trip ends: intercept 187.4726; Trip ends: R² 0.8196; Trip length: change in mean 13.3491; Sector to sector: largest change 100)

### 4.6 Verdict

The project check against estimated data **fails** with the default parameters and with the tuned parameters; only the
hold-out decides, and no threshold was changed. Tuning improves the journey times (hold-out 3 → 9 of 28; most of the gain
at 23:00) but not the counts, and it costs the official hold-out its one site. The tuned set is therefore **not on by
default** (`TUNED_DECISION`: "the tuned set does not pass the project check on its hold-out records"); it is an opt-in
setting labelled "tuned (estimated)".


### 4.7 Record fix, 2026-11-25 (divided / twin carriageways; data correctness, applied to every model)

Found during p14 (DEMAND_P14.md §2): the DPR 2021 screen-line counts are site totals over every carriageway, but two count
records did not give the model every carriageway. **cnt_sl_21** Magarpatta (Mundhwa) River Bridge (calibration) was matched
to OSM way 116839303 only, ONE northbound one-way carriageway of four (northbound 116839303 + 756417284, southbound
568009405 + 756417279): a two-way total was compared with one direction of one bridge. **cnt_sl_23** Harris Bridge + New
Harris Bridge (hold-out) had all its ways, but the two bridges are separate divided roads and the check took the busiest way
per direction across both, i.e. one bridge. Fix in the data (`validation-v1/CHANGELOG.md`, `build_records.py` EXTRA_WAYS /
CARRIAGEWAYS): the missing ways added and `count.carriageways` groups; the modelled count is the per-direction cross-section
count per carriageway group, the groups added (`sectionCountGrouped`, projectCheck.ts; tested). Every count record was
checked with two scripts (`/workspace/work/p14-final/dircheck.py`: ways covering one direction only; `parcheck.py`:
same-direction ways side by side > 6 m apart); no other record has the problem (HK Firodia: a ramp; Spine Rd: service-road
pieces; NDA Rd: pieces 2.2 km apart). Targets, split and criteria are unchanged.

The recorded p13 run (`projectValidationRecord.ts`) was re-scored: the two records re-run with the same cached areas,
parameters and 60 iterations (`p13rescore.jsonl`, harness on branch p14 with the p13 supply model), every other value as run
(`p13_record_patch.py`). tuned_s2 / s3 were not re-run (they are not used anywhere).

| Set | Records | Counts GEH < 5 | Mean GEH | Count bias | River crossings | cnt_sl_21 model (obs 10,963) | cnt_sl_23 model (obs 14,948) |
|---|---|---|---|---|---|---|---|
| default, before | calibration | 1/16 | 74.5 | −44.2 % | 11,894/38,499 (−69.1 %) | 2,195 | |
| default, after | calibration | 2/16 | 67.6 | −38.1 % | 20,723/38,499 (−46.2 %) | 10,788 (GEH 1.7) | |
| default, before | holdout | 1/16 | 48.9 | −32.3 % | 24,704/53,407 (−53.7 %) | | 4,860 |
| default, after | holdout | 1/16 | 47.1 | −30.6 % | 27,139/53,407 (−49.2 %) | | 7,084 |
| tuned_s1, before | holdout | 0/16 | 53.9 | −24.8 % | 26,132/53,407 (−51.1 %) | | 4,648 |
| tuned_s1, after | holdout | 0/16 | 51.8 | −22.7 % | 29,137/53,407 (−45.4 %) | | 7,865 |

Journey times are unaffected. The p13 verdict does not change (every criterion still fails on the hold-out).

## 5. In the app

- **Two results, kept apart.** The official-count check (`trafficValidation.ts`, TAG M3.1 on the 15 CMP 2008 / Gunjan 2017
  sites) is unchanged and always shown first. The project check (`components/ui/badges/projectValidation.ts`) is labelled
  "Project check against estimated data (journey times from Google/TomTom, counts from published studies)"; its numbers
  come from `engine/calibration/projectValidationRecord.ts`, generated from the recorded runs by `gen_record.py` (never
  typed by hand) and scored by `projectCheck.ts` on the hold-out records only.
- **Banner** (Simulate panel, `SimulateContext.tsx`): a headline naming both checks, one line for the official-count check,
  one for the project check (for the parameters in use), and what the result means for use. Four states
  (`bannerState`/`bannerText`):
  - both fail: "Traffic model fails the official-count check and the project check against estimated data". Meaning: "Use
    it to see the direction of a change and the trade-offs between alternatives run on the same inputs; do not quote its
    volumes, times or percentages."
  - project passes, official fails: "...passes the project check against estimated data but fails the official-count
    check". Meaning: "Good enough for a project-level comparison: the direction of a change, the trade-offs between
    alternatives and rough magnitudes. Not validated against official counts, so not for design or approval numbers."
  - official passes, project fails: "...meets the official-count criteria but fails the project check against estimated
    data". Meaning: "Volumes match the official counts but journey times or the estimated counts do not: treat times with
    caution."
  - both pass: "...meets the official-count criteria and passes the project check against estimated data". Meaning:
    "Numbers are still model estimates; screening, not approval."
  The project check is never called "validated". The banner is never hidden.
- **Validation popover** (`ValidationSummary.tsx`): the official table, then the project check's table for the default
  parameters (hold-out rows with PASS/FAIL, a calibration row marked "not used for the verdict"), and the tuned set's table
  when one is recorded, with whether it is on by default and why.
- **Tuned parameters** (`engine/calibration/tunedSupply.ts`, `SimulationMode.setTunedSupply`, the "Traffic parameters"
  section of the Simulate panel, shown only when a tuned set is recorded): a checkbox "Tuned parameters (estimated)".
  On by default only if the tuned set passes the project check on its hold-out records AND does not make the
  official-count check worse (no fewer sites within GEH 5 overall and on the hold-out, no larger river error)
  (`decideTunedDefault`; computed from the record, never set by hand). Switching it changes the area assignment's
  parameters, re-runs the analysis and makes the saved baseline stale ("The traffic parameters changed since the
  baseline (defaults vs tuned, estimated). Save again for a new baseline, or switch them back."). The setting is part of
  the study key, so the notice is not cleared by re-exploring the area and a baseline saved with one setting is not
  restored onto the other after a reload (`TunedSupplyBaseline.test.ts`). The micro-simulation's own speeds are not
  tuned.
- **List-of-checks banner (p12-flow, commit 9ee7092).** p12-flow draws the banner from `VALIDATION_CHECKS`
  (`ValidationCheck` entries in `trafficValidation.ts`, drawn by `ValidationBanner.tsx`). This branch does not edit that
  one; `projectValidationCheck(using)` in `projectValidation.ts` returns the project check as one entry of the same shape
  (`id`, `label`, `outcome`, `checked`, `result`, `why`; tested). Mapping after both branches are merged:
  `VALIDATION_CHECKS = [COUNTS_CHECK, projectValidationCheck('default')]`, and in Simulate
  `<ValidationBanner checks={[COUNTS_CHECK, projectValidationCheck(sim.supplySet)]} />` so the entry follows the
  parameters in use; the headline/meaning lines of `bannerText` then become the banner's summary line.
- **Current state in the app**: both checks fail, so the banner reads "Traffic model fails the official-count check and the
  project check against estimated data", with the line "Project check (estimated data), default parameters, hold-out:
  journey times 3/28 within 15% (85% needed), published counts 1/16 within GEH 5 (85% needed), river crossings −49.2%
  (5% needed; −53.7% before the 2026-11-25 record fix, §4.7): fails." and the meaning "Use it to see the direction of a change and the trade-offs between alternatives
  run on the same inputs; do not quote its volumes, times or percentages." With the tuned box ticked the project line
  shows the tuned numbers (9/28, 0/16, −45.4 %; −51.1 % before §4.7); the state stays "both fail".

## 6. Scenarios S1 and S3

Not re-run. The rule was to re-run S1 (Katraj Chowk flyover, Satara Rd osm_367660757, 09:00) and S3 (Sinhagad Rd widening,
scn_95q3cdf1) with tuned parameters only if the tuned set is enabled by default; it is not (it fails the hold-out and makes
the official hold-out worse), so the app runs S1 and S3 exactly as in p11 (default parameters) and their recorded results
(SIM_USER_TEST_P11.md) stand. A planner who ticks "Tuned parameters (estimated)" gets a new baseline and tuned results;
those are not recorded here.

## 7. Limits and what data would fix it

- **The project check fails, so the model is not fit for numbers**: use it for directions of change and trade-offs between
  alternatives run on the same inputs, as the banner says.
- **Demand, not supply, is the binding limit** (§4.2): the area demand is too concentrated on corridor bottlenecks and too
  low at the river and rail crossings. What would fix it: an origin–destination matrix for Pune (CMP / PMRDA household
  survey OD, or a Metro DPR travel-demand matrix) instead of the land-use / gateway demand; current classified counts at
  the cordon and screen lines (PMC / Pune Traffic Police ATCS detector data) to estimate the matrix with ODME at city scale
  within the TAG Table 5 limits.
- **Missing delays**: unsignalised-junction and side-friction delay are not modelled; mapped signals cover only a part of
  Pune's signals. Data that would fix it: Pune ATCS signal locations and timing plans; floating-car speed data by link
  (TomTom / HERE / Google link speeds, which are licensed) to fit a speed–flow relation per road class.
- **Estimated data**: Google typical times are Google's estimates (wide ranges); counts are 2021 factored to 2026 by an
  assumed growth rate; six count sites share crossings with the official check (so "official not worse" is not fully
  independent). The split is 14 + 14 corridors and 16 + 16 sites: small samples, so one record moves a share by 3–6
  points.
- **Tuning is weakly identified**: three seeds end far apart at similar calibration objectives; with 9 parameters and 44
  calibration observations the set is a compromise, not an estimate. The arterial speed factor and BPR β end at their
  bounds: the published ranges, not the fit, limit them, and they were not widened.
- **The micro-simulation** (the corridor's vehicle-by-vehicle run) is not part of this check and is not tuned.

## 8. Reproducing

Everything runs from `/workspace/work/p13-run` (outside the repo) against the backend on port 8413 (`start_backend.sh`;
`backend/twincity.db` is only read). Heavy steps take `flock /workspace/work/heavy.lock` (2 CPUs / 8 GB shared).

1. Data: `/workspace/work/urbanos-data/estimated/validation-v1/` (`journey_times.csv`, `counts.csv`, `sources.json`,
   `split.json` seed 13, `records.json` built by `scripts/`, `tomtom_city.json`, `raw/`).
2. Build the record areas once, in chunks (`chunks.txt`, `build_chunks.sh`, `build_rest.sh`, `build_c3.sh`): each chunk runs
   `run_p13.sh build_cN eval` with `P13_ONLY=<ids> P13_CACHE=v1_cN.cache`; the caches (`v1_c*.cache`, v8-serialised,
   trimmed to what the assignment reads) are then read together with `P13_CACHE_READ`. A trimmed cache gives the same
   numbers as an untrimmed build (`trimcheck.jsonl` vs `smoke.jsonl`).
3. Default baseline: `base2.sh` (`P13_ITERS=60 run_p13.sh base2 eval`) → `base2.jsonl`; `python3 show.py base2.jsonl default -v`.
4. Route diagnostics: `diag1.sh` (all corridors, time split into running / signal / congestion) and `diag2.sh`
   (`P13_DIAG_LINKS=1`: the most loaded links of the gridlocked routes).
5. Tuning and checks: `pipeline3.sh`: SPSA on the calibration records (`tune3.jsonl`, seeds 1-3, 20 iterations,
   a = 0.15, c = 0.1, A = 2, λ = 0.5, 15 Frank-Wolfe iterations), the seed with the lowest CALIBRATION objective is chosen
   (`chosen3.json`; the hold-out is not looked at), all sets evaluated on all records with 60 iterations
   (`evaltuned3.jsonl`), ODME on the calibration counts (`odme3.jsonl`), the official 15-site check with the chosen set
   (`run_val.sh val_tuned3 chosen3.json` → `val_tuned3.score.txt/json`); the default official check is
   `run_val.sh val_default` (`val_default.score.*`).
6. App record: `python3 gen_record.py <run-id> evaltuned3.jsonl default val_default.score.json tuned_sN val_tuned3.score.json`
   writes `frontend/src/engine/calibration/projectValidationRecord.ts`; `tunedSupply.ts` computes the on-by-default
   decision from it (never set by hand).
7. Tests: `ProjectCheckP13.test.ts` (scoring, count cross-section matching, tuned-default rule, banner states and the
   ValidationCheck entry, supply parameters); the harness itself is `P13Validation.test.ts` (opt-in, `P13=1`).
