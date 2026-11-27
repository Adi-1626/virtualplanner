# P17 — three fix branches integrated (branch `p17-all`)

Branch `p17-all` (worktree `/workspace/work/wt-p17-all`) from `p16-citywide` 4f85c3e, merging `p17-access`,
`p17-junction` and `p17-oldcity`. Judged on the p16 city-wide harness ([CITYWIDE_P16.md](CITYWIDE_P16.md): 41 areas x
4 hours, bands committed in 8d141c8 before any tuning). **No band was changed.** Reference row set: `p16-run/fix3.jsonl`
(30/164, the p16-citywide model). Runs and scripts: `/workspace/work/p17-run/` (`all_run.sh`, `acc_cmp.py`, rows
`all.jsonl`, `nowb.jsonl`, `final.jsonl`). The old-city diagnosis draft (OLDCITY_P17.md) is folded into §3 and kept as
the detailed note.

Adoption rule (written before the integrated run): adopt the set as default if the total pass count is ≥ fix3 **and** no
band's total failure count is worse than fix3; if a band worsens, find the branch causing it, drop or fix that part,
re-run only the affected areas (labelled).

## 1. Access (loading) nodes on long links (`p17-access`: 647cb92, 308fd57, 0568d10)

**Root cause (R3).** The study-area network had no mid-link nodes, so trips loaded only at junction nodes; a building
30-100 m from a mapped road was often 150-240 m from that road's nearest junction (fringe villages, long blocks, one-way
stubs). R3 (≥ 90 % of building-end veh/h load within 100 m) failed in 89/164 fix3 area-hours.

**Fix.** `simulation/accessNodes.ts` `addAccessNodes`: for building points with no main-network node within 95 m, the
nearest point on a frontable ground-level main-network link within 95 m (not flyover / bridge / tunnel / motorway /
`*_link`, ≥ 60 m) becomes an access node; points merge within 60 m; never within 20 m of a link end. The link is split
(both directions when two-way, same segment key `${key}.${i}`); lengths split proportionally (free-flow time unchanged);
access nodes have two arms, so no junction control. The micro-simulation corridor, the section and edited junctions are
never split. 0568d10: a building with no junction node within the 250 m access distance stays out of the plan (access nodes
change where trips load, not which buildings are in the area). App: `SimulationMode.withAccessNodes` after buildings load;
**`ACCESS_NODES_DEFAULT` now ON**. Details: `p17-run/acc_doc_method.md`.

## 2. Junction micro-simulation (`p17-junction`: 6bea53f, a264b35, d756529)

**Root cause (M1 gridlock, replays of the 09:00 corridors, `P16_MICRO_DUMP` + `P17JunctionDiag.test.ts`).** Wait-for
chains at priority junctions: a side road (or the median gap of a divided crossing) waiting for a 3-4 s gap in a main-road
queue crawling at walking pace never got one; its queue stood until it counted as gridlock and blocked the junction behind
(`blockedExit` events). Second cause: one entry queue per source node, so a vehicle waiting for a full road blocked
vehicles bound for empty roads (head-of-line blocking). Third: vehicles took their lane at the junction, so a branch that
narrows ahead was served from the wrong lanes.

**Fixes** (`TrafficMicroSim.ts`, options `courtesyS` / `entryPerLink` / `laneSorting`, all on by default):
- *Courtesy / forced entry*: a vehicle in a priority stream crawling under 18 km/h lets in a vehicle that has stood
  **COURTESY_S = 60 s** at its line on a crossing / merging approach. 60 s is the same minute as the existing
  MERGE_TURN_S turn-taking; forced minor-road entries into slow major streams at Indian priority junctions are documented
  by Dutta & Ahmed 2017 (J. Mod. Transp., doi 10.1007/s40534-017-0151-9) and TRR 2020
  (doi 10.1177/0361198120925258). The branch's first value (30 s) was an unsourced assumption and was not kept.
  `PriorityGaps.test.ts` header now states this rule; **its assertions are unchanged and pass**.
- *Entry queued per road* at a source (no head-of-line blocking).
- *Lane pre-sorting* for a narrowing branch within 150 m ahead.

**Replays (09:00, two seeds, branch value 30 s; `p17-run/j_ab_off.log` vs `j_ab_all.log`).** Gridlocked vehicles at the
end of the window: flyover p16_06 8 / 6 → 0 / 0; IT park p16_15 2 / 0 → 0 / 0; MIDC p16_16 4 / 1 → 0 / 0. MIDC's edge
queue (M2) slightly worse on seed 42 (124 → 187 waiting; seed 7 108 → 83). Sangam bridge p16_05 unchanged (3 / 11 → 2 /
12): a real downstream signal-box capacity limit (flow-ratio sum 2.19), not a junction-logic artefact.

## 3. Old-city supply (`p17-oldcity`: cb2f603, 9152f78, 834ba15, c82336f, b962fdd)

Diagnosis (OLDCITY_P17.md §2, `P17Diag.test.ts`): at zero flow the old city's p10 (7.8-8.5 km/h) is running time on
13.3 km/h lanes (IRC:86 / Indo-HCM factors, not an artefact) plus mostly priority-junction and signal delay on 30-60 m
links. Artefacts found and fixed:
1. *One signal point signalised several junctions* (cb2f603, `P14.signalOneJunction`): now the nearest folded junction
   within 35 m (+ the other carriageway of the same crossing), as the micro-simulation does. p16_09 had 179 signalised
   nodes for 88 mapped + 38 inferred points.
2. *HCM's 5 s deceleration-acceleration constant on 13 km/h lanes* (9152f78, `P14.decelAccelS`): the term is now the
   kinematic stop loss at the approach's stream speed with the micro-simulation fleet, capped at HCM's 5 s.
3. *Roads closed to public motor traffic (access=military, official, ...) were through routes* (834ba15): now local access
   only, as the OSRM car profile blacklists them (~275 km in the p16 areas, mostly cantonment land).
4. *Every assignment signal ran IRC:93's 120 s maximum with equal greens at every hour* (b962fdd,
   `P14.signalTimingWebster`): Webster timing as the micro-simulation (IRC:93-1985 §22.2-22.5). **Not adopted as default
   (§5).**

Peak D2 failures are real over-capacity, not a zero-flow artefact: in the peak slowest decile 63-79 % of the old city's
vehicle-km (89-94 % at p16_13 / p16_29 / p16_40) is on links above v/c 1.

## 4. Integrated run (`all.jsonl`: access nodes P17_ACCESS=buildings, P16_MICRO=1 with the three micro options, fixes 1-4)

Pass counts and band failures, **fix3 → all → all + nowb** (`all_nowb.jsonl`: the `all` rows with the four areas whose
D1 / D3 got worse re-run with fix 4 off, `nowb.jsonl`, labelled; see §5). R3 on the node-used measure; on the pre-registered
nearest-node measure (`p16-run/r3cmp.py`) the pass counts are 37 → 52 → 52 (R3 failures 61 → 38 → 38).

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 → 2/5 → 2/5 | 2/5 → 2/5 → 2/5 | 2/5 → 2/5 → 2/5 | 3/5 → 3/5 → 3/5 | 9/20 → 9/20 → 9/20 |
| subarterial | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 2/4 → 2/4 → 2/4 | 2/16 → 2/16 → 2/16 |
| collector | 0/4 → 0/4 → 0/4 | 0/4 → 1/4 → 1/4 | 0/4 → 0/4 → 0/4 | 0/4 → 2/4 → 2/4 | 0/16 → 3/16 → 3/16 |
| local | 0/6 → 1/6 → 1/6 | 0/6 → 1/6 → 1/6 | 0/6 → 1/6 → 1/6 | 1/6 → 2/6 → 2/6 | 1/24 → 5/24 → 5/24 |
| bridge | 1/5 → 1/5 → 1/5 | 1/5 → 1/5 → 1/5 | 0/5 → 0/5 → 0/5 | 2/5 → 2/5 → 2/5 | 4/20 → 4/20 → 4/20 |
| flyover | 1/3 → 1/3 → 1/3 | 1/3 → 1/3 → 1/3 | 1/3 → 1/3 → 1/3 | 3/3 → 3/3 → 3/3 | 6/12 → 6/12 → 6/12 |
| oldcity | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 1/4 → 1/4 → 1/4 | 1/16 → 1/16 → 1/16 |
| itpark | 0/3 → 0/3 → 0/3 | 0/3 → 0/3 → 0/3 | 0/3 → 0/3 → 0/3 | 1/3 → 2/3 → 2/3 | 1/12 → 2/12 → 2/12 |
| midc | 0/3 → 0/3 → 0/3 | 1/3 → 1/3 → 1/3 | 0/3 → 0/3 → 0/3 | 1/3 → 1/3 → 1/3 | 2/12 → 2/12 → 2/12 |
| fringe | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 4/16 → 12/16 → 12/16 |
| **all** | 5/41 → 8/41 → 8/41 | 6/41 → 10/41 → 10/41 | 4/41 → 7/41 → 7/41 | 15/41 → 21/41 → 21/41 | 30/164 → 46/164 → 46/164 |

| Band | 09:00 | 14:00 | 19:00 | 23:00 | Total |
|---|---|---|---|---|---|
| D1 | 14 → 14 → 14 | 5 → 6 → 3 | 17 → 17 → 17 | 0 → 0 → 0 | 36 → 37 → 34 |
| D2 | 28 → 25 → 25 | 25 → 24 → 24 | 29 → 27 → 27 | 0 → 0 → 0 | 82 → 76 → 76 |
| D3 | 0 → 0 → 0 | 0 → 0 → 0 | 0 → 1 → 0 | 0 → 0 → 0 | 0 → 1 → 0 |
| M1 | 24 → 16 → 15 | 19 → 16 → 15 | 23 → 16 → 17 | 4 → 4 → 4 | 70 → 52 → 51 |
| M2 | 24 → 24 → 24 | 17 → 15 → 15 | 25 → 26 → 26 | 1 → 2 → 2 | 67 → 67 → 67 |
| N2 | 0 → 0 → 0 | 0 → 0 → 0 | 0 → 0 → 0 | 4 → 4 → 4 | 4 → 4 → 4 |
| R3 | 22 → 13 → 13 | 23 → 15 → 15 | 22 → 14 → 14 | 22 → 14 → 14 | 89 → 56 → 56 |

`all` meets the pass-count condition (46 ≥ 30) but **fails the band condition**: D1 36 → 37 and D3 0 → 1.

## 5. Adoption

**Which branch.** D1 / D2 / D3 are static-assignment bands, so the micro-simulation options cannot move them. The new D1
failures (p16_04 bridge, p16_09 and p16_10 old city, all at 14:00) are absent from the access rows (`access.jsonl`) and
from fixes 1-3 (`oldcity_all.jsonl`); the partial fixes 1-4 run (`oldcity_all4.c1-c5`) has p16_04 and p16_09 D1 failing
at 14:00. Mechanism: D1 is the median ratio of link time at zero flow to link time at the hour. With Webster timing the
zero-flow reference runs the short night cycles (40 s minimum), so the reference gets faster; the hour's real speeds got
*better* (median km/h fix3 → all at 14:00: p16_04 8.7 → 9.4, p16_09 8.2 → 9.3, p16_10 9.9 → 10.6), but the ratio fell
below 0.61. The band is not changed; fix 4 is the cause.

**Targeted re-run (labelled `nowb`, worktree `wt-p17-all-nowb` = p17-all with `P14.signalTimingWebster` false; areas
p16_04, p16_09, p16_10, p16_40, all four hours).** D1 failures in those rows 12 → 9 (all three 14:00 failures gone), D3
1 → 0 (p16_40 19:00), M1 9 → 8 (p16_40 9 / 14 pass, 19 fails). With those rows: **46/164, every band total ≤ fix3**
(D1 34 ≤ 36, D2 76 ≤ 82, D3 0, M1 51 ≤ 70, M2 67 = 67, N2 4 = 4, R3 56 ≤ 89). Caveat: the other 37 areas' rows are from the
Webster-on run; the confirmation run of the adopted defaults on all 164 area-hours is §5b.

**Adopted as defaults (a40e052):** access nodes (`ACCESS_NODES_DEFAULT = true`); micro-simulation courtesy 60 s, entry per
road, lane pre-sorting (options default on); one junction per signal (`P14.signalOneJunction`), the kinematic
deceleration-acceleration term (`P14.decelAccelS`), closed roads (access=military etc.) not through routes.
**Dropped as default:** fix 4, assignment Webster timing (`P14.signalTimingWebster = false`; kept as
`assignTraffic(..., { signalTiming: 'webster' })`, its test uses it).

### 5b. Confirmation run of the adopted defaults (`final.jsonl`)

Run 2026-11-27 on a40e052 defaults (Webster off), all 164 area-hours. Columns: fix3 → all+nowb → final.

| Stratum | 09:00 | 14:00 | 19:00 | 23:00 | All |
|---|---|---|---|---|---|
| arterial | 2/5 → 2/5 → 2/5 | 2/5 → 2/5 → 2/5 | 2/5 → 2/5 → 2/5 | 3/5 → 3/5 → 3/5 | 9/20 → 9/20 → 9/20 |
| subarterial | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 2/4 → 2/4 → 2/4 | 2/16 → 2/16 → 2/16 |
| collector | 0/4 → 0/4 → 1/4 | 0/4 → 1/4 → 1/4 | 0/4 → 0/4 → 0/4 | 0/4 → 2/4 → 2/4 | 0/16 → 3/16 → 4/16 |
| local | 0/6 → 1/6 → 1/6 | 0/6 → 1/6 → 2/6 | 0/6 → 1/6 → 1/6 | 1/6 → 2/6 → 2/6 | 1/24 → 5/24 → 6/24 |
| bridge | 1/5 → 1/5 → 1/5 | 1/5 → 1/5 → 1/5 | 0/5 → 0/5 → 0/5 | 2/5 → 2/5 → 2/5 | 4/20 → 4/20 → 4/20 |
| flyover | 1/3 → 1/3 → 1/3 | 1/3 → 1/3 → 1/3 | 1/3 → 1/3 → 1/3 | 3/3 → 3/3 → 3/3 | 6/12 → 6/12 → 6/12 |
| oldcity | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 0/4 → 0/4 → 0/4 | 1/4 → 1/4 → 1/4 | 1/16 → 1/16 → 1/16 |
| itpark | 0/3 → 0/3 → 0/3 | 0/3 → 0/3 → 0/3 | 0/3 → 0/3 → 0/3 | 1/3 → 2/3 → 2/3 | 1/12 → 2/12 → 2/12 |
| midc | 0/3 → 0/3 → 0/3 | 1/3 → 1/3 → 1/3 | 0/3 → 0/3 → 0/3 | 1/3 → 1/3 → 1/3 | 2/12 → 2/12 → 2/12 |
| fringe | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 1/4 → 3/4 → 3/4 | 4/16 → 12/16 → 12/16 |
| **all** | 5/41 → 8/41 → 9/41 | 6/41 → 10/41 → 11/41 | 4/41 → 7/41 → 7/41 | 15/41 → 21/41 → 21/41 | 30/164 → 46/164 → 48/164 |

| Band | 09:00 | 14:00 | 19:00 | 23:00 | Total |
|---|---|---|---|---|---|
| D1 | 14 → 14 → 14 | 5 → 3 → 3 | 17 → 17 → 16 | 0 → 0 → 0 | 36 → 34 → 33 |
| D2 | 28 → 25 → 28 | 25 → 24 → 25 | 29 → 27 → 27 | 0 → 0 → 0 | 82 → 76 → 80 |
| M1 | 24 → 15 → 15 | 19 → 15 → 10 | 23 → 17 → 18 | 4 → 4 → 4 | 70 → 51 → 47 |
| M2 | 24 → 24 → 23 | 17 → 15 → 17 | 25 → 26 → 25 | 1 → 2 → 1 | 67 → 67 → 66 |
| N2 | 0 → 0 → 0 | 0 → 0 → 0 | 0 → 0 → 0 | 4 → 4 → 4 | 4 → 4 → 4 |
| R3 | 22 → 13 → 13 | 23 → 15 → 15 | 22 → 14 → 14 | 22 → 14 → 14 | 89 → 56 → 56 |

Result: **48/164** (fix3 30, baseline 36). Every band total ≤ fix3 (D3 0 failures, not listed). Adoption rule holds; bands unchanged.


## 6. Official 15-site check

On a40e052 (adopted defaults), backend 8424 on a copy of the DB (`p17-run/db`), `p17-run/official.sh` (as
`p16-run/official_head.sh`), synthetic demand. Output `p17-run/official.score.txt`.

| | p16 HEAD (`p16-run/head.score.txt`) | p17-all a40e052 |
|---|---|---|
| GEH < 5 (of 15) | 1 | **1** |
| GEH < 10 | 2 | 2 |
| mean / median GEH | 43.0 / 35.2 | 41.5 / 35.0 |
| bias (model / count - 1) | +60.1 % | +58.5 % |
| river screenline (9 sites) | +44.6 % | **+44.1 %** |
| river hold-out (4) | +64.1 % | +62.1 % |

Not worse, still a fail (1/15). The synthetic-model default stays **OFF** (hold-out not re-run; not expected to pass).

## 7. Gates and screenshots

Gates on a40e052 (`p17-run/gates/`, pattern of `p16-e2e/gates3.sh`): `tsc -p tsconfig.app.json` 0 errors; oxlint 0 errors
(19 warnings, as p16); vite build OK; vitest in 10 chunks of 20 files, all pass (1,431 passed, 17 skipped); pytest 490
passed, 3 skipped. Junction / signal / micro test files (`p17-run/jtests.sh`, 7 chunks incl. PriorityGaps, JunctionEditing,
SignalBox, JunctionNetwork) all pass; targeted CitywideP16 / AccessNodesP17 / AccessRestriction / SupplyP14 /
SyntheticDemandP14 pass.

Screenshots, demo mode (city-wide land-use model), 09:00, build against backend 8424 / static 4624
(`/workspace/work/p17-e2e/`), `/workspace/work/urbanos/shots/p17/`:
- `p17_06_flyover_shankar_maharaj_0900.png`: Sadguru Shankar Maharaj Uddanpul, Congested, North 16 km/h vs 49, LOS E,
  queue from Satara Road; no error notice, no console errors, no gridlock state (amber run-to-run stability chip).
- `p17_13_itpark_hinjawadi_0900.png`: the p16 IT-park seed road (86 m residential), Almost no traffic; no error notice.
  The corridor's vehicle accounting still shows 7 gridlocked vehicles across the three runs (of ~4,600 entered per run):
  not zero; reported, not hidden.
- `p17_05_sangam_bridge_0900.png`: Sangam Bridge, Severely congested, East 2 km/h, LOS F, queue backing up from Veer
  Santaji Ghorpade Road: the known downstream signal-box capacity limit (flow-ratio sum 2.19). Red is the severity pill /
  LOS, not error styling; no error notice.

## 8. Known limits (reported, not tuned away)

- Peak D2 failures (24-27 area-hours per peak hour) are real over-capacity (v/c > 1 on most of the slowest decile's
  vehicle-km), not a speed-floor artefact.
- Sangam bridge (p16_05) is a downstream signal-box capacity limit (flow-ratio sum 2.19); courtesy does not and should not
  clear it.
- Webster timing in the assignment is better physics for real link times but fails D1 more often via the band's zero-flow
  reference; kept as an option, off.
- Synthetic-model default stays OFF (hold-out / official not passed; not re-run).
