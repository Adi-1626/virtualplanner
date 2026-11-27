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

