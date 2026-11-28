# P19 — synthetic demand correction (demand-v3 folder, asset `pune_synthetic_demand_v4`) and the city-wide harness

Branch `p19-demand` (from p18-pass 7852cd9). Run directory `/workspace/work/p19-run` (STATUS_p19.md is the running log,
RULE_p19.md the pre-registered rule). Bands (`citywideBands.ts`) and every threshold untouched. Reference = adopted p18
defaults `p18-run/mz.jsonl` **50/164** (D1 33, D2 80, M1 32, M2 37, N2 4, R3 56).

## 1. Is the synthetic demand too high? (factor check against official sources)

p18 reported the synthetic demand "+59 % above official counts". Checked before changing anything:

| Check | Finding | Source |
|---|---|---|
| Daily motorised person trips (internal) | model 9.43 M vs CMP-2024 10.38 M (−9 %) | CMP-2024 Table 3-3 (p15 `cmp_check.txt`, DEMO_P15.md §1.6) |
| Road vehicle trips 2W+car+auto | model 4.35 M vs 4.76 M (−9 %) | CMP-2024 Table 3-3 ÷ occupancy |
| Morning peak-hour vehicles | model 369,766 (09:00) vs ≈ 488,000 CMP peak hour (−24 %) | CMP-2024 Table 3-18 |
| Peak-hour share | 7.5 % (measured CCTV profile) vs CMP-2024 PHF 9.6 % | pune_hourly_profile_v1; CMP-2024 |
| Occupancy 2W/car/auto | 1.51 / 2.47 / 2.97 | Metro DPR 2A/2B Table 3-24 (latest urban screen lines; CMP-2024 prints none) |
| Mode shares | fitted equal to CMP-2024 Table 2-55 | — |
| The "+59 %" | is against **2008** counts (CMP 2008 survey); against the project's estimated 2026 targets the bias is +23 %, concentrated on two river crossings (Yerwada, Sancheti ROB) | p18 official.score.txt (A) vs (B) |

So **no trip-rate, occupancy, mode-share or peak-hour cut is supported by a source**: every total is at or below CMP-2024,
and cutting it to match 2008 counts would fit 16-year-old data. The error is spatial (which zone pairs trade trips, hence
which crossings carry them), as p14/p15 already found (calibration side −22 %, hold-out side +25 % on the river).

## 2. The general correction: congested-time feedback (demand-v3 folder)

`/workspace/work/urbanos-data/synthetic/demand-v3/` (README.md, sources.json, scripts/feedback.py, scripts/build_demand.py).
Label `synthetic`; official and estimated data untouched.

- v2's gravity used free-running skeleton times at assumed peak speeds, so it sent trips across bottlenecks (river
  bridges) as if they were free. Standard four-step practice feeds the assignment's congested times back to distribution
  (NCHRP Report 716, TRB 2012; FHWA Travel Model Validation and Reasonableness Checking Manual 2010), converged by
  averaging successive skims (Boyce, Zhang & Lupa 1994, TRR 1443).
- Loading: the 09:00 road OD in Indo-HCM Table 5.2 mid-block PCU, MSA 8 iterations on the build's main-road skeleton with
  the app's own skeleton capacities (Indo-HCM Table 5.4) and curve (Indo-HCM Table 5.7 fit normalised at v/c 0.75, as
  `congestedSkeletonTimes(…, 'p14')`); 3 feedback rounds (skim change 3.7 % → 1.3 %).
- The gravity β is refitted on the congested skim to the **same** CMP-2024 trip-length targets; trip ends, totals, mode
  shares, hourly profiles and cordon traffic are v2's. Round 0 rebuilt v2 exactly (parity: only id/build time differ).
- ASSUMED: 09:00 as the single loading hour (HBW is 71 % of trips), 8 iterations, 3 rounds.

## 3. Hold-out and official checks (RULE_p19.md)

Project check (validation-v1, 50/50 split seed 13, recorded set p16-K0_S10gb1k4_fix, 60 iterations, p14 supply), both
demands on the same wt-p19 HEAD:

| Demand | Cal JT | Cal counts | Cal river | Jcal | **Hold-out JT** | **Hold-out counts** | **Hold-out river** | Hold-out mean GEH |
|---|---|---|---|---|---|---|---|---|
| v2 (hv2, reference) | 5/28 | 2/16 | −22.4 % | 5.722 | 7/28 (09:00 0/14) | 2/16 | +24.9 % | 36.2 |
| v4 (hv4) | 6/28 | 1/16 | −27.5 % | 5.678 | 7/28 (09:00 0/14) | **1/16** | **+10.3 %** | 32.9 |
| v4 + city congestion (hv4cc, V4CC) | 6/28 | 1/16 | −19.3 % | 5.766 | **8/28** (09:00 1/14) | **3/16** | **+5.2 %** | 28.4 |

Official 15-site check (backend 8424 on the DB copy p16-run/db, `officialv4.sh`):

| Demand | Sites GEH < 5 | Mean GEH | Bias | River screen line | River hold-out |
|---|---|---|---|---|---|
| v2 (p18 adopted) | 1/15 | 41.4 | +58.3 % | +44.0 % | +62.1 % |
| v4 | **2/15** | **33.3** | +42.3 % | **+28.2 %** | +46.2 % |
| v4 + city congestion (V4CC) | **2/15** | **25.6** | +25.2 % | **+16.4 %** | +32.0 % |

v4 improves the official check on every criterion and 11 of 16 hold-out count sites, but one hold-out count site
(cnt_sl_15, a river crossing, GEH 1.6 → 7.3) leaves the GEH-5 band, so hold-out counts go 2/16 → 1/16. **By the
pre-registered rule (hold-out not worse on each criterion) v4 is not eligible**, and it is not adopted.

V4CC (RULE_p19: demand v4 plus `cityCongestion 6, cityVdf 'p14'`, i.e. the city-level paths that decide gateway entry
and through traffic use the same Indo-HCM skeleton loading as the feedback) is **eligible**: hold-out JT 7 → 8/28, counts
2 → 3/16 (cnt_sl_15 GEH 2.6, cnt_sl_18 5.0 → inside, cnt_sl_19 0.3), river +24.9 % → +5.2 %; official 1 → 2/15, mean GEH
41.4 → 25.6, river +44.0 % → +16.4 %. Hold-out count sites that got worse vs v2: cnt_sl_08, sl_11, sl_05, mb_05, mb_06
(GEH up 2.5–14); 10 of 16 improved. Step B: V4CC is the only eligible candidate (calibration J 5.766 vs v2 5.722 is recorded,
not a choice criterion between v2 and a candidate). The project check still does not PASS the synthetic-model rule
(JT 8/28, counts 3/16), so the synthetic model stays opt-in whatever the harness says.

## 4. City-wide harness on V4CC (run `hc`, adopted p18 defaults: meter + zip, pockets off, fix E off)

| Run | Pass | D1 | D2 | D3 | M1 | M2 | N2 | R3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mz` (p18 adopted, v2) | **50** | 33 | 80 | 0 | 32 | 37 | 4 | 56 | reference |
| `hc` (V4CC) | 49 | **10** | **77** | 1 | 35 | 37 | 4 | 57 | **not adopted** (total 49 < 50; M1, D3, R3 worse) |

(band columns = failing area-hours; lower is better). V4CC fixes the median-speed band almost everywhere (D1 33 → 10):
the congested city paths stop sending through traffic into already-loaded areas (e.g. p16_12_oldcity 09:00 demand
87,930 → 71,081 veh/h). But M1 (corridor micro-simulation gridlock) gains 13 and loses 10, including rows whose area
demand fell (p16_35_collector 09:00, 30,754 → 23,671), so the M1 change is not a simple load effect; one new D3
(p16_29_subarterial 19:00, demand 10,985 → 14,821) and one new R3 (p16_36_local 19:00). Rows: `p19-run/hc.jsonl`.
Under the pre-registered rule V4CC is **not adopted**; the adopted demand stays v2 and the synthetic model stays opt-in.

### 4.1 Pockets and fix E on the adopted demand
The adopted demand is unchanged (v2) and p19 changed no engine code (`git diff 7852cd9..HEAD` = docs only), so p18's
measured runs stand without a re-run: `pkme` (pockets + E) 62/164 but D1 +1, M1 +7 → not adopted; `mze` (E alone,
partial) D1 worse → not adopted. One pre-registered probe (RULE_p19 addendum, written before running it): V4CC + pockets
+ E (`hcpke`), because V4CC removes most D1 failures, which is what blocked pockets + E.

### 4.2 `hcpke` (V4CC + pockets + meter + zip + fix E, p18 pk caches)

| Run | Pass | D1 | D2 | D3 | M1 | M2 | N2 | R3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mz` (adopted) | 50 | 33 | 80 | 0 | 32 | 37 | 4 | 56 | reference |
| `hcpke` | **66** | **8** | **76** | 1 | **37** | 35 | 3 | **20** | **not adopted** (M1 +5, D3 +1 vs `mz`) |

`hcpke` is the best total measured so far (66/164, +16 area-hours; D1 33 -> 8, R3 56 -> 20), but the pre-registered rule
needs every band total not worse than `mz`, and M1 (37 vs 32) and D3 (1 vs 0) are worse. It is **not adopted** and no
post-hoc variant of it was run (rule addendum). Rows: `p19-run/hcpke.jsonl`; switches stay opt-in
(`P18_POCKETS`, `P18_METER`, `P18_LOCALGAP`, demand v4 + `cityCongestion 6` / `cityVdf p14` in the synthetic set).
What blocks it is M1 (corridor gridlock), which is why section 6 goes after the M1 residual.


## 5. Supply check of the undiagnosed rows (classify3.md)

`p19-run/classify3.py` re-reads the p18 rows that classify.md left undiagnosed (U) plus N2 (mz.jsonl, adopted v2):
D2 36 rows (K main road near capacity 15, ZK zero-flow floor + K 12, ZT/ZKT/KT 4, ? 3), M1 11, M2 14, N2 4, D1 2.
"K" means the area's main road class runs at speed ratio < 0.6, i.e. v/c about 0.85–1.2 on the Indo-HCM curve, with
< 10 % of vkm above v/c 1.2.

To tell a supply error from a demand / standard question, `p19-run/supplyscan.mjs` and `owscan.mjs` read every main-road
way (trunk / primary / secondary / tertiary, incl. links) inside the 41 harness areas from the p16 caches (6,386 ways):

| Class | Ways | OSM `lanes` tagged | `maxspeed` tagged | `width` tagged | Lanes used when untagged |
|---|---|---|---|---|---|
| trunk | 904 | 600 (66 %) | 246 | 13 | one-way carriageway 3 (57), two-way 4 |
| primary | 1,799 | 959 (53 %) | 180 | 2 | one-way carriageway 2, two-way 2 (1 per direction) |
| secondary | 1,374 | 613 (45 %) | 98 | 2 | one-way 2, two-way 2 |
| tertiary | 2,309 | 388 (17 %) | 229 | 4 | one-way 2, two-way 2 |

Findings (evidence, no change made):
- Where OSM has `lanes`, the model uses it (2,548 of 2,560 tagged ways match `laneCount`; the other 12 are two-way ways tagged `lanes=1`, kept at one lane per direction). Untagged ways follow the OSM
  convention (two-way without `lanes` = one lane each way; a mapped dual carriageway is two one-way ways). No systematic
  lane loss was found, so there is no sourced general lane correction to make.
- Lane capacities are Indo-HCM 2017 Table 5.4 values (1200 / 1350 / 1400 PCU/h/lane, two-lane undivided / 4- / 6-lane
  divided) times the recorded capacityFactor 1.3; a two-lane two-way road therefore carries 2 x 1200 x 1.3 = 3,120 PCU/h,
  already above IRC:106-1990 Table 2's design service volumes for a two-lane two-way arterial (1,500 PCU/h, LOS C, both
  directions; capacity is higher than DSV but Table 2 gives no capacity column). Raising capacity further is not sourced.
- `width` is tagged on < 1 % of main ways, so lane-width and parking/bus-stop friction (Indo-HCM Tables 5.9–5.11) stay
  unmapped; this is a data gap, not a model error, and stays a stated limitation.
- `maxspeed` is tagged on 12 % of main ways; untagged ways are capped at the IRC:86-2018 design speed of their class,
  which is above the Indo-HCM operating speed of the base section, so it does not bind on the K rows.
Conclusion: the K rows are main roads loaded close to their Indo-HCM capacity by the synthetic demand. With no measured
lanes/width survey and no counts on those roads, they cannot be called a supply error; the lever is the demand's spatial
pattern (sections 2–4), which is where p19 acted.


## 6. M1 residual: truck starvation at a merge into a full lane (fix G, adopted)

Diagnosis (`P19TruckDiag.test.ts`, opt-in; dump `p18-run/dump/p16_40_local_9.v8`, node 73.84966, 18.56545, a priority
junction whose 28 m two-lane exit is full in the 09:00 jam). Who takes the room the 8 m truck (needs 12 m with its gap)
waits for, by seed:
- seed 42: two-wheeler trips **entering the network at that node** took each opening in lane 0, while the truck, refused
  room in **both** exit lanes (tryGrant searches every lane when the lane counts differ or the tail stands), was owed only
  the lane its own lane maps to (`heldFor` / p18 F used `mappedLanes`). That is why p18's F (entry give-way) "had no effect".
- seed 7: the truck stood on the give-way approach; small vehicles of the priority stream took every opening, because
  turn-taking never runs against priority and the p17 courtesy covered only gap / crossing holds, not room.

Fix G (two general rules, both micro-sim only, no area-specific code, no threshold touched):

| Rule | Source | Switch |
|---|---|---|
| A vehicle held for `room` after MERGE_TURN_S (60 s) is owed **every** exit lane it searched (edited lane maps kept), so room accumulates until it fits (the "reservation" of room for a long vehicle after a bounded wait); trips entering at the junction give way to it (p18 F) | turn-taking §18 (docs/OVERHAUL.md); MVDR 2017 G.S.R. 634(E) Reg. 7(4) (entering vehicles give way to traffic already on the road) | `ROOM_ANY_LANE`, `ENTRY_GIVE_WAY`; harness `P19_ROOMANY`, `P18_ENTRYGW` |
| At a priority junction a priority-stream vehicle crawling under COURTESY_CRAWL_MS leaves the exit room to a vehicle that has stood COURTESY_S (60 s) at its line waiting for that room | same sources as the p17 courtesy: forced / courtesy merging into a slow queue, Dutta & Ahmed 2017 (doi 10.1007/s40534-017-0151-9), TRR 2020 (doi 10.1177/0361198120925258) | part of `ROOM_ANY_LANE` |

Probe before the run (longest truck wait at the node, seeds 42 / 7 / 13): 199 / 425 / 202 s -> 127 / 156 / 84 s, all under
GRIDLOCK_S (180 s). Pre-registered (RULE_p19 addendum 2) before the harness run; hold-out and official checks do not run
the micro-simulation (P14Validation / NetworkValidation import only types/constants from TrafficMicroSim), so they are
unchanged by construction.

| Run | Pass | D1 | D2 | D3 | M1 | M2 | N2 | R3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mz` (p18 adopted) | 50 | 33 | 80 | 0 | 32 | 37 | 4 | 56 | reference |
| `mzg` (mz + fix G) | **51** | 33 | 80 | 0 | **20** | 37 | 4 | 56 | **adopted** (total > 50, no band worse) |

M1 fixed on 12 area-hours, new on none; only one row flips to pass (p16_36_local 14:00) because 11 of the 12 also fail
D1/D2/M2/R3. Remaining M1: 20 (09:00 5, 14:00 6, 19:00 6, 23:00 3); only p16_11_oldcity 23:00 fails on M1 alone (the
signal-box residual of P18). Fix G is the code default from commit f3d1d07 (`ENTRY_GIVE_WAY` and `ROOM_ANY_LANE` true).

## 7. D2 main-road rows (v/c 0.85-1.2)

Section 5 is the diagnosis: on the K rows the main road runs at speed ratio < 0.6 with < 10 % of vkm above v/c 1.2, lanes
follow OSM (2,548 / 2,560 tagged ways match), capacities are Indo-HCM 2017 Table 5.4 x 1.3 (already above IRC:106-1990
design service volumes), and `width` is tagged on < 1 % of ways. No sourced supply change exists, so none was made. The
demand lever (V4CC) removes most D1 failures but only 3-4 D2 rows (80 -> 77 / 76), i.e. these roads are near capacity
under every synthetic demand tried. Closing them needs measured data (classified counts or speeds on those roads, a lane
and width survey), not a parameter change. In `mzg`, D2 fails on 80 rows, 14 of them on D2 alone.

## 8. Outcome and ceiling

- Adopted: fix G (micro-sim, 50 -> 51/164, M1 32 -> 20). Demand stays v2 (V4 not eligible; V4CC eligible but its harness
  49/164 has M1/D3/R3 worse; `hcpke` 66/164 has M1/D3 worse). Synthetic model stays opt-in: no candidate's hold-out passes
  the synthetic-model rule (TAG M3.1: >= 85 % of JT within 15 % and counts GEH < 5; best V4CC 8/28 and 3/16).
- Official 15-site (adopted v2): 1/15, mean GEH 41.4, river +44.0 % (unchanged; fix G does not touch it). V4CC would give
  2/15, 25.6, +16.4 % (recorded, not adopted).
- Failing rows in `mzg` (113): R3 alone 24, D2 alone 14, D1+D2 13, D2+R3 10, the rest mixed. The pocket streets
  (p18 A) remove most R3 failures (56 -> 20) but were blocked by M1 / D2 rows that fix G and fix E now address in part;
  pockets + meter + E on top of fix G is the obvious next pre-registered candidate (not run in p19, by the rule that no
  variant is picked after seeing the result). Without measured counts / speeds the D2 main-road rows are the ceiling.
- Gates on f3d1d07 (fix G default on), p19-run/gates2: tsc 0 errors, oxlint 0 errors / 19 warnings, vite build ok, vitest 1431 passed / 19 skipped (`--maxWorkers=1`, 10 chunks), pytest 490 passed / 3 skipped. (Earlier run on e215841/888395e: same counts, 18 skipped.)
