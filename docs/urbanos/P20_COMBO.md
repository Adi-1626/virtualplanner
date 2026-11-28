# P20 — combined candidates (pockets + fix E on fix G; plus V4CC) on the city-wide harness

Branch `p20-combo` (from p19-demand a13330d). Run dir `/workspace/work/p20-run` (STATUS_p20.md running log). Bands (`citywideBands.ts`) and thresholds untouched.

## 1. Pre-registered rule (verbatim copy of p20-run/RULE_p20.md, written before any p20 run)

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
