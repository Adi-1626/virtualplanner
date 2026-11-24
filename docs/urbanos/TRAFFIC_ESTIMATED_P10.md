# City-wide ESTIMATED traffic, p10 (branch `p10-estimated`, off `p9-calibration` 34ead66)

Status: **a city-wide estimated traffic dataset is built and loaded (label: "estimated (project-level, not for decisions)").
Used as study-area edge flows it did worse on the hold-out sites than the current class-typical flows, so it is NOT used
for edge flows.** The traffic model still fails validation (TAG M3.1). No threshold was changed; the banner is unchanged
in substance and now also says that edge flows calibrated to estimated data were tried and are not used.

Allowed by the user on 2026-11-24: a project-level estimated dataset from web sources and rough estimation, every value
labelled estimated, kept apart from the official datasets. Scope (same day, 18:10): the simulation must work anywhere
in Pune, so the dataset is a generic per-road estimate for all of PMC/PCMC; real counts are anchors and checks only.

## 1. Dataset (`/workspace/work/urbanos-data/estimated/traffic-v1/`, outside the repo)

Built by `scripts/build_estimated_traffic.py` (pure Python). Full method and every assumption: `method.md` there.

- `segments.csv`: **93,421 OSM ways** (all drivable roads in PMC + PCMC + fringe): daily volume 2026, by direction,
  09:00 / 19:00 peaks, class shares (2W, car, auto, bus, LCV, HCV, cycle), status, basis, label `estimated`.
- `hourly_major_roads.csv.gz` (844,368 rows): hour × direction × class for every trunk / primary / secondary way.
- `sites_hourly.csv` (16,128 rows): the 17 PMC river crossings + Z-Bridge, 11 rail crossings, main arterials.
- `anchors.csv` (47), `zones.csv` (329), `wards_from_zones.csv`, `profiles.csv`, `sources.json`, `README.md`, `method.md`.
- The compact model the app reads: `backend/data/estimated_traffic/pune_estimated_traffic_v1.json` (59 KB), served at
  `/api/estimated-traffic/pune_estimated_traffic_v1` (`observed/estimated_traffic.py` rejects any file not labelled
  estimated), registered as dataset `pune_estimated_traffic_v1` (theme `estimated_traffic`, data class `estimated`).

Model: ln(daily) = road-type constant + 0.60·ln(lanes) + 0.005·ln(activity) − 0.008·(km from the old city − 5) +
0.79·river bridge; activity = CMP-2024 zone population + employment (zones geocoded from their names), kernel-smoothed.
Fitted to 31 calibration counts (DPR Metro 2021, CMP 2018, Swargate–Katraj DPR 2022, grown 4.5%/yr to 2026); 14
hold-out counts never fitted. Rules: Baba Bhide Bridge closed from 2026-11-17 23:00 IST (volume 0, its traffic moved to
Sambhaji, Shinde and Z-Bridge, an assumption); Z-Bridge two-wheelers only.

| daily volume vs counts | n | median abs error | within 25% | mean peak GEH |
|---|---|---|---|---|
| calibration, prior → fitted | 31 | 43.1% → 25.2% | 7 → 15 | 48.8 → 27.0 |
| **hold-out, prior → fitted** | 14 | **56.0% → 26.7%** | 2 → 7 | 60.4 → 31.6 |

## 2. Code

- `frontend/src/engine/simulation/EstimatedTraffic.ts`: the app port (any road → daily, hour, direction), checked
  against fixtures the build script writes (`EstimatedTrafficP10.test.ts`).
- `AreaDemand.cordonOf` / `compileAreaDemand`: with the model, each main-road edge link takes its estimated directional
  flow at 09:00 / 19:00 × `areaEdgeScale` (0.51); local streets keep no through traffic; the demand label then says the
  edge flows are calibrated to estimated data. Priority: calibrated window file > estimated > class-typical.
- `SimulationMode`: loads the model (`state.estimatedTraffic`); **`useEstimatedTraffic = false`** (see §5). The
  validation harness turns it on with `VAL24_ESTIMATED=1`.

## 3. Calibration / hold-out

Dataset level: §1 split (p9 hold-out sites stay hold-out; others by a hash, fixed before the fit). App level: the p9 split
of the 15 sites, scored two ways: (A) the official counts exactly as p9 (CMP 2008 / Gunjan 2017, motor vehicles, counted
hour); (B) the ESTIMATED 2026 volumes of the same crossings (anchor daily × the Pune hourly share at the run's hour; 10 of
the 15 sites have one). (B) is estimated, never shown as counts.

## 4. The one app-level parameter

At the full estimate the 2 km study areas carried 1.9× the calibration targets (run est1: (B) calibration bias +93%),
because the areas hold no land use in central Pune and every edge vehicle is driven across. `areaEdgeScale` = 0.51 was
fitted on the 6 calibration crossings only (grid search on mean GEH, (B) basis). Hold-out crossings were not used.

## 5. Results (each site in its own 2 km area at its own hour; assigned volume, motor vehicles)

| run | what | (A) all GEH<5 | (A) cal GEH<5 / mean | (A) **hold-out GEH<5 / mean** | (A) river (9) | (A) river hold-out (4) | (B) cal mean | (B) **hold-out mean** (4) | (B) river |
|---|---|---|---|---|---|---|---|---|---|
| **base (shipped)** | class-typical edge flows (= p9) | 2/15 | 1/7 / 30.1 | **1/8 / 32.8** | −26.2% | −14.9% | 62.1 | **38.7** | −38.7% |
| est1 | estimated, scale 1 | 0/15 | 0/7 / 101.0 | 0/8 / 101.0 | +177.9% | +201.0% | 73.5 | 101.4 | +130.7% |
| est2 | scale 0.51, dataset with 7 anchors unmatched (bug) | 1/15 | 0/7 / 33.5 | 1/8 / 30.8 | +41.1% | +55.2% | 27.7 | 32.3 | +17.1% |
| **est3** | scale 0.51, final dataset | 0/15 | 0/7 / 37.3 | **0/8 / 36.9** | **+51.5%** | +67.2% | 27.2 | **38.0** | +25.8% |

GEH < 5 against the estimated volumes (B): 0/4 hold-out in base, est2 and est3.

**Decision: not shipped.** The final dataset (est3) is worse than the shipped configuration on the hold-out sites against
the counts (0/8 vs 1/8 within GEH 5, mean GEH 36.9 vs 32.8, river screen line +51.5% vs −26.2%) and no better against the
estimated volumes (hold-out mean GEH 38.0 vs 38.7, 0/4 both; river hold-out +40.2% vs −28.6%). It fits the calibration
crossings far better ((B) 62.1 → 27.2), which is not a selection criterion. est2 looked better on the hold-out but used a
dataset in which a name-matching bug had dropped 7 anchors; with the bug fixed the improvement is gone, so est2 is not a
basis for shipping. Not iterated further (two app-level tries).

Why: the edge flows are now right-sized road by road, but a 2 km area with no land use routes all of it edge-to-edge, and
the Furness pairing sends much of it over the river crossings (Yerwada 36,054 vs 21,694 estimated, Rajaram 14,560 vs
7,743). A single scale cannot fix the share of through traffic, which varies by area. What would: land use (the CMP zone
activity already in this dataset) inside study areas so trips start and end there; path-based sub-area extraction from a
city assignment instead of Furness; current classified counts (see TRAFFIC_CALIBRATION_P9.md §7).

## 6. Shipped verdict (unchanged numbers)

2/15 within GEH 5 (calibration 1/7, hold-out 1/8), flow criterion 2/15, river screen line −26.2%: **FAILS TAG M3.1**.
The validation popover adds two rows scored against the estimated 2026 volumes (labelled "estimated, not counts"):
hold-out 0/4 within GEH 5, river −38.7%. Banner: "… Edge flows: class-typical flows per lane; edge flows calibrated to
estimated data (pune_estimated_traffic_v1: estimated, project-level, not for decisions) were tried and are not used,
being worse on the hold-out sites."

## 7. Reproducing

Run directory `/workspace/work/p10-run` (not part of the app): `start_backend.sh` (port 8391, a copy of the project
database in `/workspace/work/p9-run/db/`; `backend/twincity.db` never touched), `EST=1 run_val.sh <tag>` (15-site harness;
`EST=1` sets `VAL24_ESTIMATED=1`, needed now that the flag is off), `score_p10.py <run>.area.jsonl` (both bases).
