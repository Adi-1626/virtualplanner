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

(section 4, harness, filled when run `hc` finishes)
