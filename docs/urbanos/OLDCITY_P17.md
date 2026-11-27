# P17 — old-city D2 weak spot: is the zero-flow delay a modelling artefact?

Branch `p17-oldcity` (worktree `/workspace/work/wt-p17-oldcity`), from `p16-citywide` 4f85c3e. Harness and bands as in
[CITYWIDE_P16.md](CITYWIDE_P16.md); **no band was changed**. Runs in `/workspace/work/p17-run/oldcity_*` (scripts
`oldcity_eval.sh`, `oldcity_diag.sh`, `oldcity_cmp.py`); reference row set `p16-run/fix3.jsonl` (30/164).

## 1. The question

D2 (09/14/19 h, vehicle-km-weighted 10th-percentile link speed ≥ 8.8 km/h, CMP-2024 Table 2-56 survey minimum) fails in
all 12 old-city peak area-hours (p16_09..p16_12) and in 82 of 123 peak area-hours city-wide (28/25/29 at 09/14/19).
p16 §5 read the old-city failure as "signal delay at zero flow" (23:00 p10 ≈ 7.1-9.7 km/h).

## 2. Diagnosis (P17Diag.test.ts, `P17DIAG=1`; rows `oldcity_d0.jsonl` before, `oldcity_d2.jsonl` after fixes 1-2)

The test splits every link's zero-flow time into running (length / stream free-flow speed), uniform signal delay and
junction-control delay, and the hour's time into running x VDF, signal x VDF and junction delay, weighted by the 09:00
vehicle-km.

**Zero flow (old city, 09:00 weights).** p10 = 7.8-8.5 km/h. Running alone gives 13.3 km/h (the residential stream speed:
IRC:86 local design speed 30 km/h x 0.865 mean/operating x 0.904 for 3.0 m lanes x 0.7 high side friction x s0 0.81, all
labelled in supplyConfig.ts; not an artefact). Of the slowest decile's time, running 36-41 %, **junction control
(give-way / uncontrolled priority junctions) 32-40 %**, signals 21-31 %. So the floor is mainly priority-junction delay on
30-60 m links, not signals as p16 assumed.

Artefacts found:

1. **One mapped signal signalised several junctions.** The assignment signalised every node with 3+ stretches within
   35 m of a mapped signal; the micro-simulation gives each signal to the nearest junction only
   (`TrafficMicroSim.junctionsWithSignals`). In the Peth lanes one signal on Laxmi / Bajirao / Tilak Rd also signalised the
   lane junctions beside it: p16_09 had 179 signalised nodes for 88 mapped + 38 inferred points, 46 of them not the nearest
   node of any mapped point. Fixed (fix 1).
2. **HCM's 5 s deceleration-acceleration constant on 13 km/h lanes.** Every controlled approach paid HCM 2000 Eq. 17-38's
   +5 s, which HCM defines as the loss of decelerating from free-flow speed to a stop and back; from 13.3 km/h that loss is
   2.7 s with the micro-simulation's own fleet accelerations. Fixed (fix 2).
3. **Every signal ran IRC:93's maximum cycle (120 s) with equal greens, at every hour.** IRC:93-1985 §22.2 designs the cycle
   for least delay with 120 s as the preferred maximum, §22.3 splits green by flow, §22.5 gives separate peak / off-peak
   cycles; the corridor micro-simulation already times every signal by Webster. A quiet two-lane old-city junction held a
   car 37 s on average at night. Fixed (fix 4).

Checked and **not** artefacts (kept): inferred signals (only where two different arterial / sub-arterial roads meet, not
at minor lanes); the uniform-delay formula itself (Webster's, applied to signalised approaches only); the signal delay
scaled by the Indo-HCM VDF at the hour (within ~10 % of HCM d1 + d2 at X = 0.8; larger only above X = 1); speed caps
(the 13.3 km/h lane stream speed comes from IRC:86 / Indo-HCM factors, see above); the HCM 3600/c service term.

**Peak.** The old city's peak p10 is 0.8-2.9 km/h with a speed ratio p10 of 0.05-0.15: congestion, not the zero-flow
floor. In the peak slowest decile 63-79 % of the vehicle-km is on links above v/c 1 (mean v/c 1.3-3.6); its time is 55-66 %
give-way delay at over-capacity minor approaches. The same holds for the peak D2 failures elsewhere (p16_13, p16_29,
p16_40: 89-94 % above v/c 1). These are loading failures (through traffic, p16 §5), not a zero-flow artefact; no
zero-flow fix can lift them to 8.8 km/h. Only the ~16 near-miss area-hours (peak p10 5-8.8 km/h, ratio p10 ≥ 0.2) are
within reach of the floor.

## 3. Extra fix found on the way

5. **access=military roads were public through routes** (fix 3). The OSM importer drops only access=no; the OSRM car
   profile blacklists military, official, agricultural, psv, ... The p16 areas carry ~275 km of access=military roads
   (cantonment / army land: p16_26 96 km, p16_02 72 km). They are now local-access-only like access=private (not a through
   route; a trip that starts or ends there is still routed).

## 4. Changes

RESULTS_PLACEHOLDER
