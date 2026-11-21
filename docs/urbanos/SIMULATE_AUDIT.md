# Simulate workspace audit (2026-11-21)

Headless end-user audit of the Simulate workspace on branch `simulate-refine` (base `3e8f65e`), done the way a
first-time city planner would use it: open Simulate, pick a road, read the result, change the period, save the existing
city, draw a proposal in Design, compare, look at the emissions, watch live traffic, and leave and come back.
User guide: [SIMULATE_WORKSPACE.md](SIMULATE_WORKSPACE.md). Model background: `docs/OVERHAUL.md`, `docs/CALIBRATION.md`,
`docs/ENGINEERING_VALIDATION.md`.

**The model's calibration is not changed in this work.** The traffic model still fails validation (TAG M3.1: 0 of 15
count sites within GEH 5, river screen line −30.5%; `docs/ENGINEERING_VALIDATION.md` §5). The proposed calibrations
need the project owner's decisions (`docs/OVERHAUL.md` §24.7).

## How it was tested

- **Build under test:** production `vite build` of this worktree, served statically on :4587; FastAPI backend on :8387
  on a **copy** of `backend/twincity.db` (`/workspace/work/sim-e2e/db/`; the original was never touched), the local OSM
  index (mapped signals), real data folder.
- **Browser:** headless Chromium (SwiftShader WebGL, 1440 × 900), Playwright, **real clicks** on the panel buttons,
  tabs and on the map (road picked by a mouse click on the canvas; the proposal road drawn with three clicks and a
  double-click in Design). External imagery is fetched by the harness, not by Chromium.
- **Place:** Karve Road at the Yashwantrao Chavan Bridge / Prabhat Path junction (`osm_246580195`, 129 m, both
  carriageways), 2 km study area, morning peak 09:00 weekday.
- **Proposal:** a new local road drawn in Design from Residential Road (73.83914, 18.51513) to Aravind Ranade Path
  (73.84086, 18.51613), 4 vertices (one crossing inserted by the tool), about 200 m north of the studied road.
- **Timings are HEADLESS** (SwiftShader on a shared 2-CPU box with other agents' browsers running): wall time from the
  click. They compare states on this machine; they are not what a planner sees in a real browser.
- Screenshots: `/workspace/work/urbanos/shots/simulate/sim-base-*.png` (before fixes) and `sim-*.png` (after), outside
  the repository.

Verdicts: **works** · **broken** (does not do what it says) · **misleading** (a planner would draw the wrong
conclusion) · **missing** (expected, absent).

## Baseline findings (before any fix)

### First impression and guidance
| Item | Verdict | Root cause |
|---|---|---|
| What to do first | **missing** | Two "click a road" hints (context panel and inspector), no statement of the workflow (pick a road → read what is wrong → save the existing city → change it in Design → compare). Environment and Underground have a get-started card. |
| Developer text in the UI | **misleading** | The context panel's data notice cites `PUNE_DATA_AVAILABILITY.md` and "plan §2.7"; its "Technical details" cites `docs/ENGINEERING_VALIDATION.md §5`. A planner cannot open either. |
| Workspace name | **broken** | Every hand-off says **Build** ("Edit in Build", "Open the junction in Build", "Fix in Build", "make the change in Build"). The workspace has been called **Design** since the UrbanOS shell; there is no "Build" on the rail. |
| Step 2 of "Before vs after" | **missing** | "Edit in Build" is a label, not a button: nothing takes the planner to the place where a proposal is drawn. |
| Coming back from Design | **misleading** | The study panel re-opens on tab 1 "What's wrong" (tab state lives in the component and is lost when the workspace unmounts), so after drawing the proposal the Compare button is out of sight. |

### Picking an area, demand and period
| Item | Verdict | Notes |
|---|---|---|
| Click a road on the map | works | One click on Karve Road at 700 m selected `osm_246580195`; area (2 km) mapped, 111 mapped signals loaded, analysis ready **65.8 s** after the click (headless). |
| Distance around the road (500 m … 5 km) | works | Labelled, explained under a disclosure. |
| Period (morning / midday / evening / night) | works | Re-runs the analysis for the hour. A kept result comes back without a re-run when the period is set back. |
| A comparison after a period change | **misleading** | The comparison card (computed at 09:00) stays on show unchanged after switching to 19:00 while the panel header says 19:00. Only the small "Baseline: 09:00" line says otherwise; the comparison itself names no hour. |
| Demand settings (through traffic, what-if %) | works / hidden | Under Details → "Assumptions & data sources"; labelled Hypothetical. A change invalidates the comparison (correct). |

### Run, pause, reset (live view)
| Item | Verdict | Notes |
|---|---|---|
| Watch live traffic → running | works, slow | 15.9 s from the click to running (warm-up of 300 s simulated off screen, in 14 ms slices **on the main thread**). 1,094 vehicles at start, 1,448–1,549 a minute later. |
| Pause / Resume / Restart / Stop / speed | works | Stop releases everything (`resources()`: no sim, no frame, no timers, 0 vehicles). |
| Where the simulation runs | **broken** (performance) | The live micro-simulation steps on the main thread inside `requestAnimationFrame`. Headless medians per 0.25 s step: **8.4 ms** at 1,448 vehicles, **51 ms** with 4× CPU throttling. At 20× a frame needs 1.3 steps (normal) or up to 20 steps after a slow frame (`realDt` clamp 0.25 s): **~1 s frames, a death spiral on a slow laptop**. Road recolouring (`segmentSpeedRatios` + `setSegmentSpeeds`) 16.5 ms (79 ms throttled) once a second, also on the main thread. |
| Vehicle drawing | works / heavy | Capped at 600 glTF models (nearest the camera; 683–704 pooled); vehicles beyond the cap are **not drawn at all**. `draw()` 7.2 ms median (47 ms throttled); one draw call per model. |

### Before / after with a drawn proposal
| Item | Verdict | Notes |
|---|---|---|
| Save existing city | works, **slow for no reason** | 143 s headless. It re-runs exactly the analysis already on show (same network, demand, hour, seeds, window), although the analysis is deterministic. |
| Draw the proposal in Design, come back | works | Road drawn with real clicks (`Road 5kc3`, 4 vertices); the analysis re-runs on the edited network (66 s) and the panel shows a PROPOSAL badge. |
| Message after the edit | **misleading** | "The network changed. Run the comparison again." in amber, though no comparison had run yet (editing after the baseline is the intended step). |
| Compare | works, **slow for no reason** | 94 s headless. It re-runs the proposal analysis the automatic re-analysis had just produced: the two outputs were identical field by field (deterministic). Pressing Compare while that re-analysis is still running starts a **second worker at the same time** (double CPU and about +300 MB per worker); the page crashed once in this situation (cause not proven: another agent's browser started at the same moment). |
| Inputs of the comparison | works | Frozen inputs matched (demand 7,350 trips / 30,799 veh/h, 09:00 weekday, seeds 42/7/11, warm-up 300 s, 900 s measured, Webster, mapped signals, corrections on). |
| Result | works (plausible) | Overall **Worse**, confidence low. Area routing identical to the last decimal (3,997.39 veh·h; the new local road carries no routed traffic); the road's time 59 → 64 s (+9.6%, 3/3 runs). The drawn road crosses Residential Road and adds a give-way junction inside the simulated neighbourhood; that is the only change the simulation sees. |
| Units in the comparison rows | **broken** | `fmtDeltaValue` prints a unit only for s, km/h, % and veh·h: "Fuel 1,976 → 1,995", "CO₂ 4,647 → 4,689", "NOx 9,919 → 9,867", "Traffic routed along it 6,584 → 6,584", "Trips completed 2,666 → 2,613", "Road stretches over capacity 721 → 721" have no unit. |
| "runs agree on 1/2 changes" | misleading | Unclear what the 2 changes are; it counts only simulated changes ≥ 5%. |

### Results, charts and units (single analysis)
| Item | Verdict | Notes |
|---|---|---|
| Status, LOS, speed, delay | works | Units shown (km/h, s/veh), Indo-HCM named, run-to-run stability 3/3, fails-validation badges. |
| Load v/c | **misleading** | "136 % of 2,409": the capacity unit (PCU/h) is only in the tooltip; the traffic figures next to it are in veh/h. |
| Measured vs modelled | **missing** in places | Demand ESTIMATED and speeds SIMULATED badges at the top; the counted-traffic card says observed. The comparison, emissions, through-the-day, live view and worst-places outputs carry no measured/modelled label of their own. |

### Emissions
| Item | Verdict | Notes |
|---|---|---|
| Emissions in the comparison (real before/after run, first time) | **misleading** | Shows absolute neighbourhood totals (1,976 L/h fuel, 4,647 kg/h CO₂, 9,919 g/h NOx) with the % change. Environment decided (ENVIRONMENT_AUDIT, roadmap theme 7) that absolute totals from this model are not reliable enough to quote. The proposal served a different number of vehicle-km (8,119 → 8,060 veh·km/h, −0.7%) while CO₂ rose 0.9%: nothing tells the planner whether a change is more traffic or dirtier traffic. |
| Environment → "Traffic emissions" after a real comparison | **broken** | Empty ("No before / after comparison yet") although the comparison had just been computed. Root cause: leaving Simulate calls `TwinCityEngine.setPlanningModeActive`, which calls `objects.notify()` with **no changed types**; the engine treats that as "every object changed": it calls `simMode.networkChanged()` (which clears the comparison result, the calibration and ODME state) and queues a full city traffic-graph rebuild (60–70 s of worker CPU here) on **every workspace switch**. The Environment card had only ever been checked with an injected comparison. |
| Emissions drawer tab | works | Single-run totals with fails-validation badge and ESTIMATED label; HBEFA stand-in classes named. |

### Validation banner, seeds, errors, memory
| Item | Verdict | Notes |
|---|---|---|
| "Traffic model fails validation (TAG M3.1)" banner | works | Text matches `docs/ENGINEERING_VALIDATION.md` §5 (0 of 15 within GEH 5; screen line 54,493 vs 78,357 = −30.5%). Top-bar pill and per-output badges present. |
| Seeds and reproducibility | works | Seeds 42/7/11; the proposal analysed by two different workers (automatic re-analysis and the comparison run) gave identical outputs field by field. |
| Errors | see after-fix section | |
| Memory across repeated runs | see after-fix section | Each analysis worker adds about 300 MB to the renderer while it runs (sampled with `ps`: 349 → 761 → ~640 MB) and is terminated when done. |

## Fixes and commits
(filled in as the work lands)

## After the fixes
(filled in after the re-test)
