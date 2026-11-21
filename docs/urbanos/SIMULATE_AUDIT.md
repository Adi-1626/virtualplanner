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

Branch `simulate-refine`, after `0a7d2ef`. The calibration was not changed.

| Commit | Finding | Root cause | Fix |
|---|---|---|---|
| `8c5b8f4` | Environment's Traffic emissions empty after a real comparison; a full city traffic-graph rebuild on every workspace switch | A workspace switch called `objects.notify()` with no changed types, which the engine reads as "everything changed" | `ObjectManager.notifyViewOnly()` and `classifyObjectChange()`: a switch is `'view'` (redraw only); roads, junctions and flyovers are still `'network'` |
| `264f626` | Save existing city 143 s, Compare 94 s, two analysis jobs at once; "Run the comparison again" before any comparison | Baseline and proposal runs re-ran the deterministic analysis already on show or running; the network-change notice was shown unconditionally | `runFingerprint` (demand content, network, study, section, hour factor, seeds, window, warm-up, simulator options): a run with the fingerprint of the analysis on show, or the one running, reuses it; otherwise the automatic analysis is cancelled first; a run that is the analysis is adopted as it. The notice appears only when a comparison is on show or running |
| `8c830f4` | "Build" everywhere; bare numbers in comparison rows; "136 % of 2,409" | Old workspace name; `fmtDeltaValue` printed only four units | Design wording; every unit printed (L/h, kg/h, g/h, veh/h, PCU/h, trips, stretches), one decimal under 10 |
| `4b7ba20` | Emissions totals quotable; no hour on the comparison; tab lost when coming back from Design; no get-started; no measured/modelled labels | — | Emissions as relative change, distance driven and CO₂ per vehicle-km first, totals under "Model totals (not for quoting)" (Simulate and Environment); comparison hour note and a mismatch warning; remembered tab (reset when another road is chosen); get-started card with the four steps; Measured / Modelled / Hypothetical chips; step 2 is a button to Design; developer references removed from the context panel |
| `5774208` | Live view stepped on the main thread (8.4 ms per step, 51 ms at 4× throttle; ~1 s frames) | `TrafficMicroSim.step()` in `requestAnimationFrame` | The live simulation runs in a Web Worker (`liveTraffic*.ts`); the main thread only interpolates frames and draws. Stepping is time-boxed: when a tick's budget is spent the run falls behind real time instead of freezing. Inline fallback when module workers are unavailable. Only the corridor's roads are sent to the worker |
| `1e2eb4f` | — | — | Tests: the real worker code behind a fake worker that structured-clones every message (`attachLiveWorker`), frame interpolation, step budget and clamp, frame packing, error path, inline fallback, the panel run through the worker and Stop terminating it |
| `2d86582` | Vehicles beyond the 600-model cap not drawn at all | The cap released them with nothing in their place | Vehicles without a model (beyond the cap, beyond 6 km, model not loaded or failed) are points in one `PointPrimitiveCollection`, reused frame to frame; `lastDraw` reports models and points |
| `20d84c3` | The "behind" state was not shown | — | A note under the live controls when the computer cannot keep the chosen speed; lint clean-up |
| `bf9e497` | Found in the re-test: "Failed to fetch" shown to the user with the server down; Environment's emission values wrapped mid-figure ("−0.7" / "%") | Raw browser error text; table cell without `nowrap` | `readableLoadError`: "the server could not be reached."; values kept on one line |

## After the fixes

Same build procedure, place and proposal as the baseline (Karve Road `osm_246580195`, 2 km, 09:00 weekday; a new
local road drawn with real clicks from (73.83914, 18.51513) to (73.84086, 18.51613), 4 vertices). All timings are
**HEADLESS** (SwiftShader, shared 2-CPU box).

**Test-data trap found and removed.** The baseline session's proposal road (`Road 5kc3`) had been saved to the DB copy,
so the first re-test's "existing city" already contained the proposal and the comparison correctly said "No clear
change". Both copies were deleted in Design, the comparison was re-run on the true existing city, and all test objects
(roads, the underground alignment) were deleted at the end and confirmed absent from the DB copy.

| Check (real clicks) | Before | After |
|---|---|---|
| Get started | two "click a road" hints | four-step card; results labelled Modelled |
| Pick a road → analysis ready | 65.8 s | 86.7 s (same work; machine load varies) |
| Save existing city | 143 s | **1.8–2.1 s**, analysis reused (`lastRunReused`) |
| Step 2 | label "Edit in Build" | button "Change it in Design" opens Design |
| Back from Design | tab 1 "What's wrong" | tab 2 "Improve & compare" |
| Message after drawing the proposal | "The network changed. Run the comparison again." | none (no comparison yet) |
| Re-analysis of the edited network | 66 s | 74.5–88.9 s |
| Compare | 94 s (second worker if pressed during the re-analysis) | **0.5–0.6 s**, reused |
| Result | Worse, low; road 59 → 64 s (+9.6%, 3/3) | identical figures field by field to the baseline's freshly computed runs: Worse, low; 59 → 64 s (+9.6%, 3/3); fuel 1,976 → 1,995 L/h; CO₂ 4,647 → 4,689 kg/h |
| Comparison hour | not named | "Existing city vs proposal at 09:00" |
| Units | bare numbers | 6,584 veh/h, 2,613 trips, 721 stretches, 0 veh, PCU/h on load |
| Emissions | absolute totals first | relative: distance driven −0.7% (2/3 runs), CO₂ per veh-km +1.7% (2/3), fuel +1.0% (3/3), CO₂ +0.9% (3/3), NOx −0.5% (2/3), PM no clear change; totals behind "not for quoting" |
| Environment → Traffic emissions after the real comparison | empty | filled (same six rows, 09:00, relative only); the comparison is still there after returning to Simulate |
| Live view click → running | 15.9 s | 11.9 s |
| Where it runs | main thread | worker: `assets/liveTraffic.worker-*.js` listed in `page.workers`, `resources().liveThreaded = true`; gone from `page.workers` after Stop |
| Vehicles drawn | ≤ 600 (rest invisible) | 1,135–1,496: 597–600 models + 570–895 points |

**Performance, 20×, same build and road, worker vs the inline path (forced with `__VP_NO_WORKER__`), 6 s probe each.
HEADLESS.** "Main-thread ms per frame" is `advance()` + `draw()`, the live view's own work per frame.

| | Vehicles | Main-thread ms per frame (median / p95) | Event-loop lag ms (median / p95 / max) | Simulated s per real s (target 20) | Behind |
|---|---|---|---|---|---|
| Worker, normal CPU | 1,378 | 2.9 / 8.6 | 3.9 / 13.9 / 261 | 17.0 | no |
| Inline, normal CPU | 1,276 | 21.5 / 41.7 | 24.8 / 72.8 / 113 | 10.9 | yes |
| Worker, 4× CPU throttle | 1,496 | 19.4 / 53.3 | 27.5 / 157 / 569 | 13.9 | no |
| Inline, 4× CPU throttle | 1,313 | 56.1 / 93.6 | 91.4 / 278 / 367 | 2.8 | yes |

The worker takes stepping off the main thread (about 7× less live-view work per frame at normal CPU, 3× at 4×) and
keeps the simulation near the chosen speed. At 4× throttle the remaining main-thread cost is drawing about 1,500
vehicles (600 glTF models); long tasks up to 349 ms remain there (Cesium), and the max lag was higher than inline in
this one sample. Drawing cost, not stepping, is now the limit on a slow machine (open).

**Memory, 3 repeated live runs (worker), main-thread JS heap after a forced GC. HEADLESS.** 187 → 187 → 187 → 187 MB
after each Stop (206–209 MB while running); primitives back to 128 after each Stop (930–932 while running); one live
worker per run, terminated by Stop. `resources()` all false/0 after each Stop.

**Server down** (backend on :8387 stopped mid-session, another road picked): top bar shows Offline; the analysis
still completes in the browser; "Some roads around this area could not be loaded, so it may stop short" with Retry;
mapped signals fail (`signals.status = 'error'`; the panel's signals note for that state says signals are placed where two main roads cross, read from the code, its collapsed section was not opened); Count checks says "Traffic data
could not be read" (now "the server could not be reached") while the bundled 2008 bridge counts still show. Nothing
unknown is shown as zero. No console errors other than the refused connections.

**Through the day:** four periods in 277.9 s on the edited network: 09:00 and 19:00 identical by design (both the
peak-hour demand, ×1.00), midday ×0.70, night ×0.18. Night reads "Severe" at 13 km/h with runs disagreeing, and "got
through" (1,242 veh/h) above demand (1,158 veh/h): model behaviour, reported, not changed (calibration out of scope).

**Regression smoke after the workspace-switch change (real clicks):** Design: road drawn (18,274 → 18,275) and Undo
removed it (→ 18,274). Environment: proposal road selected by a map click, "Count trees & green area": 12 census trees
in the footprint, 39 with the 10 m margin, 500 / 1,700 m² green area. Underground: alignment drawn through the
editing API (as the Underground QA does), "Check conflicts" by click: findings listed (three metro crossings with
"Vertical: not checkable", two sewer clearances, cover, nalla). Switching workspaces kept Simulate's comparison; the
Design edit (a real network change) marked it stale, as intended.

**Gates (branch, 2026-11-21):** `tsc -p tsconfig.app.json --noEmit` 0 errors · `oxlint` 0 errors (8 warnings, none in
files touched here) · `vite build` ok (16:16 UTC build; the worker ships as `assets/liveTraffic.worker-*.js`; the last
code commit after it only changed two text cells and an error string, and was not rebuilt) · full vitest
`--maxWorkers=1` on the final code: **108 files passed, 6 skipped; 895 tests passed, 7 skipped** · targeted re-run
(SimulateRefine, VehiclePoints, LiveTrafficWorker, RoadAnalysisPanelPieces) 41/41 · earlier targeted run of SimulateRefine,
Overhaul, SimulateFlow, FocusTraffic, EditRecompute, ScenarioIsolation, ScenarioGenerator, TimelineStale, Calibration and
Odme: all passed · full pytest **not run on the branch** (the coordinator runs it on the merged tree; no backend file
changed here).

### Still open
- At 4× CPU throttle the main thread still spends ~20 ms per frame drawing ~1,500 vehicles; instancing the vehicle
  models (one draw per variant) is the next step.
- Simulate's emissions list shows PM as "no clear change" (+0.4%, 1/3 runs, under its 3% threshold) while Environment's
  card prints +0.4% (1/3 seeds): same data, different display threshold.
- The live figures strip at the bottom of the map is clipped on the right at 1440 px with both side panels open
  ("MEAN SPEE… 7 km/").
- Night (23:00) "Severe" and throughput above demand: traffic-model behaviour under the current (unchanged) calibration.
- The worker path is verified in headless Chromium only; Safari/Firefox module-worker support falls back to the
  inline path (tested in unit tests, not in those browsers).
