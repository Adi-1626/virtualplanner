# Traffic calibration, p9 (branch `p9-calibration`)

Status: **the traffic model still fails validation (TAG M3.1).** This round fixed real bugs, corrected how counts
are compared, fixed a calibration / hold-out split before any fit, and tried calibrated window edge flows. The
window flows made the hold-out sites worse and are **not shipped**. The thresholds were not changed.

Criteria: UK DfT TAG unit M3.1 (May 2026): GEH < 5 at > 85% of sites; flow criterion at > 85%; screen-line
totals within 5%; matrix-change limits of Table 5.

## 1. Bugs fixed (code was wrong)

| # | Bug | Effect | Fix |
|---|---|---|---|
| 1 | `TrafficMicroSim`: a trip whose assigned route (`viaLinkIds`) crossed a stretch *inside* a joined junction (two nodes < 16 m apart merged into one junction, so the stretch has no simulator link) lost its whole route and fell back to the simulator's own shortest path. | A drawn flyover (`5farkpgcf`, proposal `scn_zoh03juw`, 09:00) was assigned 551 veh/h but the simulation passed **1 veh/h** (earlier diagnosis: 10). Every assigned route through such a junction was silently re-routed. | The internal stretch is skipped, the rest of the route is kept. Test: `AssignmentFeedback.test.ts` "a pinned route through a joined junction keeps its links". |
| 2 | Screen-line check accepted the model hour after the counted hour as "same hour" (`peakStartHour + 1`). | A 18:00–19:00 count was compared with 19:00. | Only the counted hour matches (`screenlines.ts`; `CalibrationP9.test.ts`). |
| 3 | Counts compared with published totals that include cycles, carts and cycle rickshaws; the model has motor vehicles only. | Every CMP 2008 site biased low by the non-motorised share. | `veh_motorised` added to each count and `peakMotorVehicles` to the river screen-line file (non-motorised share **inferred** from CMP 2008 Table 4.1 12 h class split, stated per count as `motorised_basis`). |
| 4 | Sambhaji Bridge (two-wheelers excluded from the count) compared with the model's total. | Site biased high in the model. | Compared with the model's non-two-wheeler volume (`class_filter: no_two_wheeler`, two-wheeler share 0.52 from the Gunjan 2017 mix). |
| 5 | `RoadAnalysis`: "no traffic on this road" gave no reason. | The flyover case looked like a model failure. | Names the end that joins only a private / restricted road and joins part-way along (`sectionJoins`, `joinsExplanation`). |

Data limits (not bugs, not fixable in code): counts are from **2008** (CMP) and **2017** (Gunjan) on a 2026 network;
central Pune has **no land use** in the project (no ward population / employment), so all demand in a study area is
edge-to-edge through traffic at class-typical flows per lane; the rail screen line has only 3 of 10 sites mapped;
Z-Bridge and Sambhaji access rules (two-wheeler only / time restrictions) are not in OSM.

## 2. Calibration / hold-out split (fixed before any fit)

`backend/data/observed_validation/pune_network_validation_v1.json` → `split` (decided 2026-11-22, before any run):

- **Calibration (7, may be fitted):** Shivaji, Shinde, Sangam, Sancheti ROB, Raja Ram, S. M. Joshi, Wadia ROB.
- **Hold-out (8, never fitted):** Mhatre, Yerwada + Ambedkar, Tilak, Sambhaji, Range Hill RUB, Gunjan Chowk 09/14/19.
- Not scored: Z-Bridge (two-wheelers only).

ODME (`estimateOd`) receives only calibration sites; hold-out sites are passed as held out and only evaluated.

## 3. Window calibration tried (`WindowCalibration.test.ts`, opt-in `WINCAL=1`)

One window (seeds `osm_22841323, osm_858493453, osm_207164105`, range 4.5 km, 30,552 segments, 374 cordon points,
6,275 OD cells). AM fitted at 10:00, PM at 18:00, written at the period reference hours (09:00 / 19:00).

Inside the window's own assignment (window run `w2`):

| Period | Sites | Mean GEH prior → ODME | GEH < 5 prior → ODME |
|---|---|---|---|
| AM | calibration 3 | 23.2 → 9.3 | 0 → 2 |
| AM | hold-out 3 | 35.1 → 23.1 | 0 → 1 |
| PM | calibration 4 | 75.3 → 42.0 | 0 → 0 |
| PM | **hold-out 5** | **22.6 → 38.8 (worse)** | 1 → 1 |

**TAG M3.1 Table 5 matrix-change checks: every structural limit is breached in both periods** (`matrixChangeStats`):

| Check | Limit | AM | PM |
|---|---|---|---|
| Cell values slope | 0.98–1.02 | 1.032 ✗ | 1.025 ✗ |
| Cell values R² | > 0.95 | 0.855 ✗ | 0.601 ✗ |
| Trip ends slope | 0.99–1.01 | 1.093 ✗ | 1.067 ✗ |
| Trip ends R² | > 0.98 | 0.869 ✗ | 0.525 ✗ |
| Trip length mean change | ±5% | +2.8% ✓ | −15.5% ✗ |
| Trip length s.d. change | ±5% | +0.3% ✓ | −24.5% ✗ |
| Sector-to-sector largest change | ±5% | 76.9% ✗ | 93.9% ✗ |

With 3–4 counts per period ODME is under-determined; the matrix it returns is not a credible demand estimate.

## 4. Decision on calibrated flows: hold-out results of the app's own per-site runs

Each of the 15 sites run in its own 2 km study area at its own hour (`NetworkValidation.test.ts`, assigned volume,
motor vehicles, scored with `score.py`). Options: (a) no calibrated flows; (b) unfitted window; (c) AM ODME fit, PM
unfitted window; (d) AM and PM fit.

| Option | Hold-out GEH < 5 (of 8) | Hold-out mean GEH | Hold-out flow criterion | River screen line (9) | River, hold-out crossings (4) | All 15 GEH < 5 | Calibration GEH < 5 (of 7) |
|---|---|---|---|---|---|---|---|
| **(a) none — shipped** | **1** | 32.8 | 1 | **−26.2%** | **−14.9%** | 2 | 1 |
| (b) unfitted window | 0 | 49.0 | 0 | +63.9% | +98.2% | 1 | 1 |
| (c) AM fit | 1 | 47.5 | 1 | +73.8% | +104.6% | 3 | 2 |
| (d) AM + PM fit | 1 | 30.2 | 1 | +45.7% | +55.8% | 2 | 1 |

**Shipped: (a), no calibrated flows file.** Hold-out GEH < 5 ties (1/8) for (a), (c), (d). Among the options without a
PM fit, (a) is best on every hold-out measure. (d) has a slightly lower hold-out mean GEH (30.2 vs 32.8), but it
contains the PM fit, which made the hold-out worse inside the window (22.6 → 38.8), and its river screen line is
+45.7% (hold-out crossings +55.8%) against −26.2% (−14.9%) for (a). (c)'s extra GEH < 5 site is a calibration
site, which is not a selection criterion. No option is chosen on calibration sites.

Why the window flows over-shoot: cutting a 2 km area out of the window by **cordon volumes** (`AreaDemand.cordonOf`
with a flows file) more than doubles its through demand (Tilak 36.0k → 71.9k veh/h, more than the whole window's
51.9k). A trip that leaves and re-enters the ragged network-range cordon is counted once per crossing, and the
Furness re-pairing discards the window's own origin-destination pattern. The standard remedy is path-based sub-area
matrix extraction from the window assignment; it is not implemented. The code path stays (inactive without a file,
`SimulationModeState.edgeFlows.status = 'none'`) so a better window can be tried and checked against the hold-out.

## 5. Before → after (shipped configuration)

| Measure | Before (recorded, `c916854`) | After (p9) | Required | Status |
|---|---|---|---|---|
| All 15 sites GEH < 5 | 0 / 15 | **2 / 15** (Raja Ram, Yerwada + Ambedkar) | > 85% | FAIL |
| Calibration sites GEH < 5 | — | 1 / 7 | > 85% | FAIL |
| Hold-out sites GEH < 5 | — | **1 / 8** | > 85% | FAIL |
| Mean GEH, all | 32.3 | 31.5 (calibration 30.1, hold-out 32.8) | — | — |
| Flow criterion | 0 / 15 | 2 / 15 | > 85% | FAIL |
| River screen line (9 crossings) | 54,493 vs 78,357 (−30.5%) | 54,505 vs 73,824 motor vehicles (**−26.2%**) | ±5% | FAIL |

The assigned volumes did not change: the whole difference comes from comparing like with like (motor vehicles,
counted hour, Sambhaji without two-wheelers). Scored on the old basis the same run gives 0/15, mean GEH 32.3,
−30.4%. Speeds were not re-run (docs/ENGINEERING_VALIDATION.md §5.0: 4/21, 27/120, 2/9, all FAIL).

The banner, the validation popover and the dataset registry compute these numbers from the recorded per-site
results (`frontend/src/components/ui/badges/trafficValidation.ts`, `backend/observed/traffic_validation.py`;
`test_traffic_validation.py` keeps the two in step) against fixed TAG criteria, and still say **fails validation**.

## 6. Flyover after the simulator fix

Proposal `scn_zoh03juw`, flyover `5farkpgcf`, 09:00, 3 seeds: assigned 551 veh/h (408 westbound, 142 eastbound).
Simulated **before: 1 veh/h** (status `no_traffic`); **after: 492 veh/h** (westbound 420, range 400–440; eastbound
72, range 32–108), status `flowing`, LOS A–B. The eastbound shortfall is simulation (arrivals and junction delay),
not route loss.

## 7. What real data would make it pass

1. **Current (2024 or later) classified hourly counts**, both directions, at all **17 river crossings** and the **10
   rail crossings** (both CMP screen lines complete), plus **window-edge arterials** (each road crossing the central
   window's edge). Sources: Pune Traffic Police, PMC Traffic Planning cell, Pune Smart City ATCS signal detectors,
   CMP-2018 annexures (PMRDA / PMC). With these the screen lines can be checked on today's traffic, and edge flows can
   be measured instead of estimated.
2. **Ward-level population and employment** (PMC / Census, ward GIS) so central Pune has trips that start and end
   inside it; today every study-area trip is through traffic.
3. **Access rules for Z-Bridge and Sambhaji Bridge** (vehicle classes and hours) in the network corrections layer.
4. Enough counts per period (tens, not 3–4) for ODME to stay within the Table 5 matrix-change limits, and path-based
   sub-area extraction before any window flows are shipped again — always judged on the hold-out sites.

## 8. Reproducing

Scripts in the run directory used for this report (not part of the app): window `WINCAL=1 … WindowCalibration.test.ts`;
per-site `VAL24=1 VAL24_RUNS=<15 x_<site>_r2000 runs> … NetworkValidation.test.ts`; flyover
`VAL24_SCENARIO=scn_zoh03juw VAL24_CHANGES=… VAL24_DUMP_LINKS=5farkpgcf`. All against a **copy** of the project
database; `backend/twincity.db` is never modified.
