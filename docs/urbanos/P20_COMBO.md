# P20 — combined candidates (pockets + fix E on fix G; plus V4CC) on the city-wide harness

Branch `p20-combo` (from p19-demand a13330d). Run dir `/workspace/work/p20-run` (STATUS_p20.md running log). Bands (`citywideBands.ts`) and thresholds untouched.

## 1. Pre-registered rule (verbatim copy of p20-run/RULE_p20.md, written before any p20 run; addenda dated)

### RULE p20 (written 2026-11-28 06:05 IST, BEFORE any p20 harness run)
Reference = adopted defaults `p19-run/mzg.jsonl` (branch p19-demand a13330d, fix G default on) = **51/164**
(failing area-hours per band, lower is better: D1 33, D2 80, D3 0, M1 20, M2 37, N2 4, R3 56). Bands/thresholds untouched.

Candidates (all general and sourced, already coded opt-in in p18/p19; no harness-area tuning; reasons from diagnosis):
- **C1** = mzg (demand v2, meter ON, zip ON, fix G ON) + pockets (p18 A, `P18_POCKETS=1 P18_POCKETS_CORRIDOR=1`,
  p18 pk caches) + fix E (p18, `P18_LOCALGAP=1`, unsigned equal-rank local junction gap delay, MVDR 2017 Reg 9).
  Reason: pockets removed most R3 failures (pkme R3 56->20) but pkme was blocked by M1 (+7) and D1 (+1); fix G (p19)
  removed 12 M1 rows by a diagnosed truck-starvation mechanism, which is the M1 failure type pockets added
  (single stuck vehicles). Run tag `c1`.
- **C2** = C1 + V4CC demand (demand v4 asset + set p19-V4CC: cityCongestion 6, cityVdf p14). Reason: V4CC removed most D1
  failures (hc 33->10) that blocked pockets+E; V4CC passed RULE_p19 Step A (hold-out + official). Run tag `c2`
  (`hcpke` + fix G).
Order: C1 then C2, both run to completion whatever C1 gives.

Adoption (per candidate, vs mzg on the same 164 rows): total pass > 51 AND no band total worse than mzg
(D1<=33, D2<=80, D3<=0, M1<=20, M2<=37, N2<=4, R3<=56). If both qualify: C1 is preferred unless C2 qualifies and C1 does
not, because C2 changes the demand (more surface, needs Step 3); if both qualify, choose the higher total; tie -> C1.
Before any default change:
- fix E changes the static assignment (staticAssignment unsignedLocal), so for an adopted C1/C2 the project check
  (validation-v1 hold-out, 60 it, recorded set + E) and the official 15-site check (backend 8424 on DB copy
  p16-run/db) are re-run with E on and must be not worse than their reference on each criterion
  (C1 ref: hv2 hold-out JT 7/28, counts 2/16, |river| 24.9 %; official 1/15, mean GEH 41.4, |river| 44.0 %;
   C2 ref: same v2 references, as RULE_p19 Step A). Pockets and fix G are micro-sim / explorer only (checked by code path).
  If the re-check is worse, the candidate is NOT adopted (switches stay opt-in).
- Demand v4/V4CC as default also needs the synthetic-model rule for default-ON (decideSyntheticDefault); otherwise the
  synthetic model stays opt-in exactly as in p19 and only the harness defaults change.
Step 2 (only if a candidate fails on band totals alone): diagnose the specific NEW failing rows of that band vs mzg; a
fix is allowed only for a genuine, general, sourced model bug found in those rows; the fixed candidate is pre-registered
here as an addendum (with the diagnosis) BEFORE its run. No parameter sweeps, no picking among post-hoc variants.
At most two such fix rounds (then document and stop).

#### Addendum 1 (written 2026-11-28 ~09:40 IST: after C1 final and C2 c1-c5 partial, BEFORE any run of the candidate below)
C1 = 64/164 fails (D1 34 > 33 by the p18 zero-flow-reference mechanism of fix E, not a model bug -> no fix allowed;
M1 31 > 20). C2 partial fails M1 so far (D1 already far below mzg). Step 2 diagnosis of new M1 rows (dumps, P18StuckDiag,
P20NodeProbe): p16_17_midc 19:00 seed 42 (425 s, light load) is a genuine model bug: at a node WITHOUT a junction control
(controls exist only at >= 3 arms) `longerWaiting` returns false, so nothing is owed to a vehicle waiting for room and the
other lane of its own approach changes lane at the node and takes every opening. Fix H = NODE_TURNS (turn-taking for room
also at uncontrolled nodes; the existing rule of docs/OVERHAUL.md §18 / ZIP_MERGE / ROOM_ANY_LANE, restriction lifted;
p20-fixh 52a6551). Other diagnosed rows (p16_03 19, p16_14 9, p16_11 9/14, p16_08_flyover 9) are load / priority /
short-link cases on which H has no effect (documented, no change).
Candidate **C2H** = C2 + fix H (`P20_NODETURN=1`, worktree wt-p20h), run `c2h` after C2 completes, whatever C2 gives,
unless C2 is adopted outright (then C2H is informational and not run). C1H is NOT run: C1's D1 failure is not
addressable by H (micro-only), so C1H cannot meet the rule. Adoption of C2H: same rule (total > 51, no band worse than
mzg) + Step 3 re-checks. No other variant after seeing c2h.

#### Addendum 2 (written 2026-11-28 ~10:30 IST, after C2 final, BEFORE any run of the candidate below)
C2 = 66/164 (D1 8, D2 76, D3 1, M1 27, M2 37, N2 3, R3 20) fails: M1 27 > 20 and D3 1 > 0. The D3 row (p16_29_subarterial
19:00) is the V4CC demand pattern (through traffic 6,687 -> 10,549 veh/h, overLenShare 0.075 -> 0.094; p19 found the same
in `hc`), assignment-side, not a code bug. Fix H changes the micro-simulation only, so C2H cannot change D3 and cannot meet
the rule by construction: c2h was STOPPED after 5 rows of chunk c1 (rows moved unread to p20-run/stopped/, not used for any
decision). Same reasoning as C1H (addendum 1).
Candidate **GH** = adopted defaults (`mzg`: demand v2, meter, zip, fix G) + fix H (`P20_NODETURN=1`), p16 caches, run `gh`
on wt-p20h. Reason: fix H is a diagnosed general model bug (addendum 1), not a score-driven variant. Micro-sim only:
D1/D2/D3/R*/N* must come out identical to mzg (sanity check of the code path); hold-out/official unaffected by
construction (P14Validation / NetworkValidation do not run the micro-sim). Adopt (NODE_TURNS default true) only if total
> 51 AND no band total worse than mzg. Otherwise H stays opt-in. No other variant is run after seeing gh.

#### Addendum 3 (written 2026-11-28 07:45 IST, during the gh run (c1-c2 partial, 0 flips vs mzg), BEFORE any C1+H run)
C1+H (C1 + `P20_NODETURN=1`) is NOT run. Diagnosis-based reason, not a score: C1 fails the rule on D1 (34 > 33); the
extra D1 rows (p16_12_oldcity 14:00, p16_35_collector 09:00) come from fix E raising the model's own zero-flow reference
speed in the static assignment (P18_PASS.md, addendum 1), and D1 is computed from the assignment, not from the micro-sim.
Fix H changes only the micro-simulation (TrafficMicroSim room hold at uncontrolled nodes), so C1+H has exactly C1's D1 = 34
and cannot meet the rule by construction (same reasoning as C1H in addendum 1 and C2H in addendum 2). The gh run is the
code-path check: D1/D2/D3/R3/N2 of gh must equal mzg. No further variant is pre-registered in p20.

## 2. C1 = mzg + pockets + fix E (demand v2), run `c1`

| Run | Pass | D1 | D2 | D3 | M1 | M2 | N2 | R3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mzg` (adopted, p19) | 51 | 33 | 80 | 0 | 20 | 37 | 4 | 56 | reference |
| `pkme` (p18, no fix G) | 62 | 34 | 74 | 0 | 39 | 33 | 4 | 20 | p18, not adopted |
| `c1` | **64** | **34** | 74 | 0 | **31** | 33 | 4 | 20 | **not adopted** (D1 +1, M1 +11) |

(band columns = failing area-hours, lower is better; rows `p20-run/c1.jsonl`.) Fix G lowers the pockets' M1 cost
(pkme 39 -> c1 31) but M1 still has 18 new / 7 fixed rows vs `mzg`. D1: p16_12_oldcity 14:00 (median ratio 0.610 ->
0.592) and p16_35_collector 09:00 (0.68 -> 0.58) new, p16_13_itpark 09:00 fixed: the rows and mechanism p18 found for
`pkme` (fix E raises the model's own zero-flow speed at unsigned local junctions, and D1 is a ratio to it; P18_PASS.md),
a measurement-reference effect, not a model bug, so no fix is allowed for it under the rule.

### 2.1 Diagnosis of new M1 rows (Step 2)
Micro dumps (`p20-run/dump`, `dump.sh`) and `P18StuckDiag` / `P20NodeProbe`:

| Row (seed) | Stand | Finding | Class |
|---|---|---|---|
| p16_17_midc 19:00 (42) | 425 s, light load (20 km/h) | bus/truck (needs 16 m) in lane 1 at a node **without a junction control** (a two-arm way continuation); `longerWaiting` returns at once where no control exists, so nothing is owed to it and vehicles of the other lane of its own approach change lane at the node and take every opening | **model bug** -> fix H |
| p16_03_bridge 19:00 (42) | 233 s | truck on a residential approach, 45 m exit standing full (queue to a primary road at 19:00), back 11.1 m < 12.2 m needed | load / spillback |
| p16_14_itpark 09:00 (7) | 209 s | priority junction: truck owed room, the priority stream (5.3 m/s, not crawling) fills the 30 m exit | priority by design (MVDR) |
| p16_11_oldcity 09:00 / 14:00 | 184-241 s | 1-3 vehicles in the old-city jam | load |

## 3. C2 = C1 + V4CC demand, run `c2`

| Run | Pass | D1 | D2 | D3 | M1 | M2 | N2 | R3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mzg` (adopted) | 51 | 33 | 80 | 0 | 20 | 37 | 4 | 56 | reference |
| `hcpke` (p19, no fix G) | 66 | 8 | 76 | 1 | 37 | 35 | 3 | 20 | p19, not adopted |
| `c2` | **66** | **8** | **76** | **1** | **27** | 37 | 3 | **20** | **not adopted** (M1 +7, D3 +1) |

Fix G cuts the M1 cost of `hcpke` (37 -> 27) but M1 has 17 new / 10 fixed rows vs `mzg`. D3: p16_29_subarterial 19:00
(the `hc` row of p19): V4CC routes more through traffic into the area (6,687 -> 10,549 veh/h; overLenShare 0.075 -> 0.094 vs
the 0.09 band), a demand-pattern effect, not a code bug. C2's new M1 rows diagnosed (C2-env dumps `p20-run/dump2`):
p16_08_flyover 09:00 (seed 42, 306 s: a bus/truck needing 16 m at an uncontrolled node in front of a 16 m two-lane link
that feeds a 2 -> 1 lane drop, standing under the 09:00 load), p16_18_midc 09:00 (31 m exit standing full: load),
p16_05_bridge 19:00 (bridge jam, corridor 30,952 veh/h with 20,169 held upstream: load); fix H has no effect on them.
Since D3 is assignment-side and fix H is micro-only, C2H (addendum 1) cannot meet the rule; it was stopped unread (addendum 2).
