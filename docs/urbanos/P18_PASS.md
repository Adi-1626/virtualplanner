# P18 — city-wide harness pass (branch `p18-pass`)

Goal: push the 41-area x 4-hour city-wide harness (CITYWIDE_P16.md; bands in `citywideBands.ts`, unchanged) from the
p17 final 48/164 area-hours toward 164/164, honestly: every model change is a general rule with a source, nothing is
specific to the 41 areas, and a change is adopted only if the total pass rises and no band total is worse than
`p17-run/final.jsonl` (D1 33, D2 80, D3 0, M1 47, M2 66, N2 4, R3 56).

**Result: 48 -> 50/164** with the adopted defaults (sub-area meter + zip merging). Band totals D1 33, D2 80, D3 0,
M1 47 -> 32, M2 66 -> 37, N2 4, R3 56 (no band worse). Pocket streets would give 58/164 (R3 56 -> 20) but make D2 one
row worse, so they stay opt-in. Run: `p18-run/mz.jsonl` (code 895ddd5 behaviour; seeds 42 and 7 as in the harness).

## Fixes tried (general rules, each with a source)

| Id | Change | Source | Switch | Effect (full runs, 164 area-hours) | Decision |
|---|---|---|---|---|---|
| A | Pocket streets: a study area takes in the local-access streets (OSM residential / living_street / service / unclassified) inside its convex outline that its 2 km network range did not reach, when they connect to the area (`StudyAreaExplorer.closePockets`) | Jafari et al. 2015, TRR 2498, doi 10.3141/2498-03 (sub-network extraction must keep the local streets that carry access trips); Qian & Zhang 2012, Transp. Res. B (sub-network analysis) | `POCKET_STREETS.enabled`, harness `P18_POCKETS` | `pk` alone 48 -> 57/164: R3 56 -> 20, M2 66 -> 64, D1 33 -> 32, but D2 80 -> 81 and M1 47 -> 50 | **Not adopted** (opt-in): D2 one row worse (p16_36_local 19:00 p10 9.01 -> 8.60 km/h) |
| B | Sub-area meter: the corridor micro-simulation receives the flow each path's tightest upstream bottleneck outside the corridor can pass (min(1, capacity / assigned flow)); held vehicles are reported in the plan label (modelled), never dropped silently | Bliemer, Raadsen, Smits, Zhou & Bell 2014, Transp. Res. B 68:363-384, doi 10.1016/j.trb.2014.07.001 (quasi-dynamic assignment, residual point queues, proportional node model) | `SUBAREA_METER.enabled` (app), harness `P18_METER=1` | with A (`pkm`): M2 64 -> 35, M1 50 -> 44 | see adoption |
| C | Gap-acceptance delay at unsignalised priority approaches: (1-x) min(Adams' delay, 3600/c) + x 3600/c + HCM queue term + stop loss on the delayed share; equals HCM 2000 Eq. 17-38 at x >= 1 and never exceeds it | Austroads AGTM Part 2 (2020) Eqs 5.1-5.2 (Adams 1936); Troutbeck & Brilon, FHWA Revised Monograph on Traffic Flow Theory ch. 8 | `P14.priorityGapDelay`, harness `P18_GAP=1` | km/h rise (median and p10), but the D1 / N2 ratios fall because the zero-flow reference speed loses its junction delay: on 38 rows (chunks c1-c2) D1 15 -> 19, N2 3 -> 4 vs `pkm` | **Not adopted** (opt-in, default off): same zero-flow-reference mechanism that dropped assignment Webster timing in p17 |
| D | Zip merging at a lane drop: two lanes of one approach that lead into one lane beyond the junction take the room in turn (the head of the other lane that has waited longer than 60 s goes first, whatever held it last) | StVO §7(4) Reissverschlussverfahren (official text https://www.gesetze-im-internet.de/stvo_2013/__7.html) | `ZIP_MERGE.enabled` (TrafficMicroSim) | p16_24_arterial 23:00: head of lane 2 waited 357 s / 366 s (both seeds) at a 44 s signal with a 7 s green, kerb lane took every gap -> longest wait about 60 s, gridlock 0 on both seeds | see adoption |

## Diagnosis notes

- M1 is not noise at the rows checked: p16_24_arterial 23:00 failed on both seeds at the same node (73.82957, 18.51070) for a deterministic reason (fix D). The micro-sim's turn-taking (`longerWaiting`, docs/OVERHAUL.md §18) only looked at other approaches, never at the other lanes of the vehicle's own approach.
- p16_11_oldcity 23:00 seed 7 (one vehicle, 242 s): a different cause, a piece inside a signal box (group -1, never stopped) keeps a moving claim on the conflict area during a 7 s phase of an 84 s, 5-phase signal. Not fixed (needs box-internal phase holding); reported.
- Most remaining M1 sites are `blockedExit` in peak hours with corridor inflows of 15,000-36,000 veh/h (spillback from a full exit); classified with evidence in p18-run/classify.md.
- D2 p16_36_local 19:00 with pockets: zero-flow p10 is only 9.92 km/h (10.59 without pockets) because each short minor approach carries HCM's stop-controlled delay (3600/c + 5 s) even at zero flow; the slowest decile is 84 % minor approaches. Only fix C removes that floor, and C fails D1.

## Adoption

| Run | Switches | Pass | D1 | D2 | M1 | M2 | N2 | R3 | Rule |
|---|---|---|---|---|---|---|---|---|---|
| p17 final | — | 48 | 33 | 80 | 47 | 66 | 4 | 56 | reference |
| `pk` | A | 57 | 32 | **81** | **50** | 64 | 4 | 20 | fails (D2, M1) |
| `pkm` | A + B | 58 | 32 | **81** | 44 | 35 | 4 | 20 | fails (D2) |
| `pkmgz` (c1-c2 only, 38 rows) | A + B + C + D | — | worse than `pkm` on D1 (+4) and N2 (+1) | | | | | | stopped: C fails |
| **`mz`** | **B + D** (A off) | **50** | 33 | 80 | **32** | **37** | 4 | 56 | **passes: adopted** |

Adopted defaults: `SUBAREA_METER.enabled = true`, `ZIP_MERGE.enabled = true`, `POCKET_STREETS.enabled = false`,
`P14.priorityGapDelay = false`. The harness env `P18_METER`, `P18_POCKETS`, `P18_POCKETS_CORRIDOR`, `P18_GAP` now
default to the code defaults when unset, so `mz` is the adopted-defaults run (only defaults changed after it).

What changed row by row (`mz` vs final): 3 area-hours newly pass (p16_17_midc 19:00, p16_24_arterial 23:00,
p16_36_local 19:00), 1 newly fails (p16_36_local 14:00, M1, one seed). Band entries: 24 M1 and 31 M2 entries fixed,
8 M1 and 1 M2 entries new (single stuck vehicles; see below). The meter holds 26 % of the assigned corridor flow
upstream summed over all rows (529,082 of 2,000,867 veh/h); each run states its held flow in the plan label (modelled).

### Pass by stratum x hour (final -> mz)

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 → 2/5 | 2/5 → 2/5 | 2/5 → 2/5 | 3/5 → 4/5 | 9/20 → 10/20 |
| subarterial | 0/4 → 0/4 | 0/4 → 0/4 | 0/4 → 0/4 | 2/4 → 2/4 | 2/16 → 2/16 |
| collector | 1/4 → 1/4 | 1/4 → 1/4 | 0/4 → 0/4 | 2/4 → 2/4 | 4/16 → 4/16 |
| local | 1/6 → 1/6 | 2/6 → 1/6 | 1/6 → 2/6 | 2/6 → 2/6 | 6/24 → 6/24 |
| bridge | 1/5 → 1/5 | 1/5 → 1/5 | 0/5 → 0/5 | 2/5 → 2/5 | 4/20 → 4/20 |
| flyover | 1/3 → 1/3 | 1/3 → 1/3 | 1/3 → 1/3 | 3/3 → 3/3 | 6/12 → 6/12 |
| oldcity | 0/4 → 0/4 | 0/4 → 0/4 | 0/4 → 0/4 | 1/4 → 1/4 | 1/16 → 1/16 |
| itpark | 0/3 → 0/3 | 0/3 → 0/3 | 0/3 → 0/3 | 2/3 → 2/3 | 2/12 → 2/12 |
| midc | 0/3 → 0/3 | 1/3 → 1/3 | 0/3 → 1/3 | 1/3 → 1/3 | 2/12 → 3/12 |
| fringe | 3/4 → 3/4 | 3/4 → 3/4 | 3/4 → 3/4 | 3/4 → 3/4 | 12/16 → 12/16 |
| **all** | 9/41 → 9/41 | 11/41 → 10/41 | 7/41 → 9/41 | 21/41 → 22/41 | 48/164 → 50/164 |

| Band | 09:00 | 14:00 | 19:00 | 23:00 | Total |
|---|---|---|---|---|---|
| D1 | 14 → 14 | 3 → 3 | 16 → 16 | 0 → 0 | 33 → 33 |
| D2 | 28 → 28 | 25 → 25 | 27 → 27 | 0 → 0 | 80 → 80 |
| M1 | 15 → 10 | 10 → 10 | 18 → 9 | 4 → 3 | 47 → 32 |
| M2 | 23 → 14 | 17 → 9 | 25 → 13 | 1 → 1 | 66 → 37 |
| N2 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 4 | 4 → 4 |
| R3 | 13 → 13 | 15 → 15 | 14 → 14 | 14 → 14 | 56 → 56 |

### Band failures by hour (final -> pk -> pkm -> mz)

| Band | 09:00 | 14:00 | 19:00 | 23:00 | Total |
|---|---|---|---|---|---|
| D1 | 14 → 13 → 13 → 14 | 3 → 3 → 3 → 3 | 16 → 16 → 16 → 16 | 0 → 0 → 0 → 0 | 33 → 32 → 32 → 33 |
| D2 | 28 → 28 → 28 → 28 | 25 → 25 → 25 → 25 | 27 → 28 → 28 → 27 | 0 → 0 → 0 → 0 | 80 → 81 → 81 → 80 |
| M1 | 15 → 18 → 14 → 10 | 10 → 14 → 12 → 10 | 18 → 13 → 13 → 9 | 4 → 5 → 5 → 3 | 47 → 50 → 44 → 32 |
| M2 | 23 → 23 → 12 → 14 | 17 → 15 → 8 → 9 | 25 → 25 → 14 → 13 | 1 → 1 → 1 → 1 | 66 → 64 → 35 → 37 |
| N2 | 0 → 0 → 0 → 0 | 0 → 0 → 0 → 0 | 0 → 0 → 0 → 0 | 4 → 4 → 4 → 4 | 4 → 4 → 4 → 4 |
| R3 | 13 → 4 → 4 → 13 | 15 → 6 → 6 → 15 | 14 → 5 → 5 → 14 | 14 → 5 → 5 → 14 | 56 → 20 → 20 → 56 |

## Second round (after the adopted defaults): fixes E and F

| Id | Change | Source | Switch | Effect | Decision |
|---|---|---|---|---|---|
| E | At a junction where every approach is a local-access street (OSM residential / living_street / service) of equal rank, i.e. no major road and in the model no sign, the assignment charges the gap-acceptance delay of fix C instead of HCM's stop-controlled delay (a full stop and the service time 3600/c for every vehicle) | Motor Vehicles (Driving) Regulations 2017, G.S.R. 634(E), 23 June 2017 (official text, upload.indiacode.nic.in): Reg. 7(1) a stop is required only where a STOP sign is displayed; Reg. 9(1)-(2) at other intersections slow down and give way to traffic from the right (Reg. 15(2): two roads of the same category, the vehicle on the right has the right of way). Delay form: Austroads AGTM Part 2 (2020) Eqs 5.1-5.2 (Adams), as fix C | `P14.unsignedLocalGap` (default false), harness `P18_LOCALGAP=1` | probe p16_36_local with pockets: D2 09:00 p10 8.05 -> 9.45 km/h, 19:00 8.60 -> 10.12 km/h (the pockets' D2 blocker passes); full runs below | **Not adopted** (opt-in): D1 worse, see below |
| F | A trip entering the network at a junction (source) gives way, lane by lane, to a vehicle that has waited there more than 60 s for room in the same lane | MVDR 2017 Reg. 7(4): "the vehicle emerging onto a road from a property bordering thereon shall give way to the motor vehicles and other traffic already running on that road" | `ENTRY_GIVE_WAY.enabled` (default false), branch `p18-entry` only, harness `P18_ENTRYGW=1` | probe p16_40_local (all hours, mz settings): no change (seed 7 identical, seed 42 one more stuck vehicle); the vehicles taking the room ahead of the stuck truck are not source entries as the trace suggested | **Dropped** (not merged; step-loop limit reached on this residual) |

Diagnosis of the truck residual (p16_40_local 09:00, `p18-run/stuck40.log`, `P18StuckDiag`): node 73.84966, 18.56545 is a
priority junction; the truck (needs 12.0 m) is refused `room` on both lanes of the 28 m exit link (free 2.4 m / 5.4 m) for
minutes while smaller vehicles (need 8.2 m) take each opening as it appears. `heldFor` never reserves the lane for it
(`held false` in every request). Not fixed; left as an M1 residual.

### Full runs of the second round

| Run | Switches | Pass | D1 | D2 | M1 | M2 | N2 | R3 | Rule (vs `mz`) |
|---|---|---|---|---|---|---|---|---|---|
| `mz` (adopted) | B + D | 50 | 33 | 80 | 32 | 37 | 4 | 56 | reference |
| `pkme` | A + B + D + E | **62** | **34** | 74 | **39** | 33 | 4 | 20 | fails (D1 +1, M1 +7) |
| `mze` (chunks c1-c4, 80 rows; stopped) | B + D + E | 27 vs 24 | **25 vs 23** | 40 vs 43 | 16 vs 18 | 16 vs 16 | 3 vs 4 | 18 vs 18 | fails (D1 +2 new, 0 fixed) |

`pkme` (pockets + E) is the best total so far, 62/164, and fixes the D2 row that blocked pockets, but M1 rises (14 new
area-hours, 7 fixed; single vehicles stuck 3-5 min in rows that are mostly over-capacity) and D1 gains one row net
(p16_12_oldcity 14:00 and p16_35_collector 09:00 new, p16_13_itpark 09:00 fixed; all three class C, at the threshold).
`P18_POCKETS_CORRIDOR` turned out to have no effect on the harness corridor (a 23-row rerun `pke0` with it off was
identical in every value), so the M1 change comes from the area assignment feeding the corridor, not from pocket streets
inside the corridor.

E alone (`mze`) lowers the D1 median ratio in old-city rows at 14:00 (p16_09 0.617 -> 0.597, p16_12 0.610 -> 0.584):
D1 and N2 are ratios to the model's own zero-flow speed, which E raises (no stop at an unsigned local junction), while at
14:00 the same junctions carry flow and keep a gap delay. It is the reference mechanism that ruled out fixes C (p18) and
assignment Webster timing (p17), smaller in size. Under the rule (no band worse than the adopted run) E cannot be adopted
without changing how the bands measure, which is not allowed. `mze` was stopped after 80 complete rows (chunks c1-c4)
once D1 had 2 new failures and none fixed (on those rows: D2 3 fixed / 0 new, M1 6 fixed / 4 new, N2 1 fixed, pass
24 -> 27); its rows are `p18-run/mze.partial.jsonl`. E and pockets stay available as switches; with both on the harness
passes 62/164 (`p18-run/pkme.jsonl`). The adopted defaults stay as in `mz` (50/164); the official check is unchanged
(E is off by default, so no re-run).

## Honest ceiling (what is left, and why it is not forced)

Every failing area-hour x band of `mz.jsonl` is classified with evidence in `p18-run/classify.md` (copied below as
§A); summary:

| Band | Class | Area-hours |
|---|---|---|
| D1 | C genuine over-capacity (>=10% of vkm above v/c 1.2) | 31 |
| D1 | U slow without area-wide over-capacity | 2 |
| D2 | A zero-flow floor (the same area at 23:00 is already below 8.8 km/h: junction delay on short minor approaches) | 21 |
| D2 | C genuine over-capacity (>=10% of vkm above v/c 1.2) | 27 |
| D2 | U slow without area-wide over-capacity | 32 |
| M1 | A artefact candidate (no area-wide saturation) | 11 |
| M1 | C genuine over-capacity (area assignment loads >=10% of vkm above v/c 1.2) | 17 |
| M1 | U unresolved (5-10% vkm above v/c 1.2) | 4 |
| M2 | A artefact candidate (no area-wide saturation) | 14 |
| M2 | C genuine over-capacity (area assignment loads >=10% of vkm above v/c 1.2) | 16 |
| M2 | U unresolved (5-10% vkm above v/c 1.2) | 7 |
| N2 | A night slowest decile (no over-capacity) | 4 |
| R3 | A network extent: own street exists but outside the area network (fix A, pockets, opt-in) | 52 |
| R3 | B data: no mapped street within ~95 m of some trip ends (OSM) | 4 |


- **R3, 4 area-hours (p16_22_fringe, all four hours): data.** At least 8 % of trip ends have no mapped street within
  100 m in OSM. With pockets on, R3 still fails 20 area-hours; at 09:00 the remaining 4 (p16_22, p16_28, p16_34,
  p16_38) are trip points with no mapped street within about 95 m (private campus / service ways only). Not fixable in the model.
- **R3, 52 area-hours: network extent.** The trip end's own street exists in OSM (16-45 m away) but lies in a pocket
  of the area outline that the 2 km network range does not reach. Fix A closes these (R3 56 -> 20) but adds many short
  minor approaches and costs one D2 row; it stays opt-in until the D2 floor below is solved within the band rules.
- **D2, 21 area-hours: zero-flow floor.** The same area at 23:00 is already below 8.8 km/h at the 10th percentile:
  HCM 2000 Eq. 17-38 charges each vehicle on a short minor approach 3600/c + 5 s even with no conflicting traffic.
  Fix C (gap acceptance) removes the floor and raises km/h, but D1 and N2 are ratios to the model's own zero-flow speed,
  which then loses its junction delay, so D1 / N2 get worse. Same mechanism that dropped assignment Webster timing in p17.
- **D1 31, D2 27, M1 17, M2 16: over-capacity in the model** (>= 10 % of the area's vehicle-km above v/c 1.2). The
  synthetic demand runs about +59 % above the official counts at the 15 sites, so part of this is demand error; it is
  reported, not tuned away (no demand scaling to the 41 areas).
- **M1 residual artefacts (11 class A rows)**, two traced: p16_11_oldcity 23:00 seed 7, a piece inside a signal box
  (never stopped) keeps a moving claim on the conflict area during a 7 s phase of an 84 s 5-phase signal; p16_40_local
  09:00 / 14:00, a truck waits 198-330 s for room in a full 28 m two-lane link where smaller vehicles take each gap.
  Both need micro-simulation rule changes (box-internal phase holding; room reservation for long vehicles) not made in p18.
- **N2, 4 area-hours** (night slowest decile below 0.73 of free speed without over-capacity): unresolved.
- **U rows** (D1 2, D2 32, M1 4, M2 7): slow without area-wide over-capacity; not diagnosed one by one.

## Official 15-site check and hold-out

Adopted defaults, backend 8424 on the DB copy `p16-run/db` (never `backend/twincity.db`), synthetic demand,
`p18-run/official.sh` -> `p18-run/official.score.txt`:

| Check | p17 (head.score / official) | p18 adopted |
|---|---|---|
| Sites with GEH < 5 | 1/15 | 1/15 |
| Mean GEH | 41.5 | 41.4 |
| River screenline | +44.1 % | +44.0 % |
| River hold-out (4) | +62.1 % | +62.1 % |

Not worse. Hold-out (p13 journey times and counts): the adopted changes act only on the corridor micro-simulation
(`analysisJob.corridorPlanOf` -> `subareaDemand` meter, and `TrafficMicroSim`); the hold-out and official checks use the
static assignment only (`P14Validation`, `NetworkValidation` do not call either), so the hold-out is unchanged by
construction and was not re-run. The synthetic model default stays **OFF**.

## Tools added

- `src/engine/testing/P18StuckDiag.test.ts` (opt-in `P18STUCK=<dump> P18_NODE=<node>`): control at a node, signal state of
  every approach over one cycle, and a trace of each grant request / refusal of the longest-waiting front vehicle.
- Harness: `P16_MICRO_DUMP` dumps (`p18-run/dump.sh`), `P18_WHY` R3 split, `P18_*` switches (unset = code defaults).

## Gates (code 895ddd5 + test fix)

tsc `-p tsconfig.app.json` 0 errors; oxlint 0 errors / 19 warnings; vite build ok; vitest (10 chunks, `--maxWorkers=1`)
1431 passed / 18 skipped; pytest 490 passed / 3 skipped. One test needed a change: `VehicleAccounting.test.ts`
"gridlock left in place is reported" used an overloaded lane-drop network that zip merging (fix D) no longer deadlocks;
the test checks the gridlock report, so it now runs that network with `ZIP_MERGE.enabled = false` (restored after).
Logs: `p18-run/gates/`.
