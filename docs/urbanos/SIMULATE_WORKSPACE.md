# Simulate: user guide

Simulate shows how a road works in traffic, what holds it up, and what a change you draw in Design would do to it,
compared with the existing city on the same trips. It is for comparing options, not for forecasting.

> **Read this first.** The traffic model does not yet match Pune's traffic counts (UK DfT TAG M3.1: 0 of 15 count
> sites within GEH 5; the river crossings carry 30.5% less traffic in the model than counted). Every figure Simulate
> computes is **Modelled**. Read a comparison as "better or worse than the existing city on the same inputs", not as
> a prediction of what will happen on the street. Nothing in Simulate declares a proposal safe, feasible or compliant.

## 1. Pick a road

1. Click **Simulate** on the workspace rail.
2. Click a road, bridge or flyover on the map. **Shift+click** adds more roads, for a corridor.
3. Choose **how much of the city around it** to include (500 m to 5 km; 2 km is a good start). A larger area
   catches more of the traffic that reroutes, but takes longer.
4. Choose **when**: Morning peak (09:00), Midday (14:00), Evening peak (19:00) or Night (23:00). The demand for that
   hour comes from Pune's hour-of-day profile. If the profile cannot load, a note says the peak-hour demand is used
   for every hour.

The analysis starts by itself and takes about a minute (longer for a large area or a slow computer). It runs the
same trips three times with different random seeds and reports their average, with how much the runs agree.

To study another road, press the back arrow ("Choose another road") at the top of the panel.

## 2. What's wrong (tab 1)

- **Status, speed, delay, load**: how the road performs at that hour. Load is the traffic routed along it as a share
  of its capacity, in PCU/h (passenger-car units per hour: a bus counts as more than one car, a two-wheeler as less).
- **Directions**: each direction of the road on its own.
- **Why**: what holds the traffic up: its own signal, a junction downstream, too little capacity, or queues spilling
  back from elsewhere.
- **Worst places in the area**: the road stretches nearby that are over capacity; "Show" flies to each.
- **Counted traffic on this road** (only where a count exists): the model's volume against a published count. This
  is the only **Measured** figure in Simulate; its source and year are given.

Each block carries a chip that says how it is known: **Measured** (counted on the road), **Modelled** (computed by
the traffic model) or **Hypothetical** (a what-if setting you chose).

## 3. Improve and compare (tab 2)

The **Suggestions** list changes worth testing (add a lane, retime a signal, open a junction). "Test it" takes you to
the before-and-after steps; "Open the junction in Design" or "Select the road in Design" opens the place to edit.

**Before vs after** has three steps:

1. **Save existing city.** Saves the current network, trips, hour and seeds as the baseline. If the analysis on show
   was made from exactly these inputs, it is reused, so this is immediate.
2. **Change it in Design.** Click the step to go to Design. Draw or edit a road, change lanes, a junction or a signal.
   Undo works as usual. Then click **Simulate** on the rail to come back: the panel returns to this tab, and the
   analysis re-runs on the edited network, marked **Proposal**.
3. **Compare.** Runs the proposal on the baseline's frozen trips, hour and seeds, so the only difference is your
   change. If the re-analysis of the edited network has already produced exactly this run, it is reused.

The result shows:

- a **verdict** (Better / Worse / Mixed / No clear change) at three levels: the road, its neighbourhood and the whole
  area, with a **confidence** and how many of the larger changes every run agrees on;
- the hour the comparison is for. If you switch to another hour afterwards, a notice says the comparison is still for
  the earlier hour: set the time back, or save a new baseline at the new hour;
- the changes, each with its unit (s, km/h, veh/h, PCU/h, trips, stretches);
- **Fuel and emissions nearby**, as **relative change** only. Read the **distance driven** first: a proposal that lets
  more traffic through burns more fuel in total, so "CO₂ up 1%" with "distance driven up 2%" means cleaner driving per
  km, not dirtier traffic. **CO₂ per vehicle-km** says that directly. The model's totals are under "Model totals (not
  for quoting)": the emission factors are European (HBEFA) classes standing in for Pune's vehicles, and the traffic
  behind them is modelled.

The same comparison appears in **Environment → Traffic emissions** once it has run. Switching workspaces no longer
clears it. Editing the network does: the comparison then says the network changed since it was run; press Compare
again.

What invalidates a comparison: editing the network after it ran, or changing the demand settings (through traffic,
what-if demand). Changing the land use since the baseline is flagged; Compare then keeps the baseline's trips (road
changes alone) unless you include the new land use.

## 4. Watch live traffic

**Watch live traffic** shows vehicles moving on the study area, starting from a 5-minute warm-up so the roads are
already in use. Pause, Resume, Restart, Stop and speed (1×, 5×, 20×) work as expected. Roads are coloured by speed
(green free-flowing, amber slow, red stopped).

- The live view is an illustration. The figures in the tabs come from the repeatable analysis, not from the animation.
- The simulation runs in the background (a Web Worker), so the map stays responsive. If the computer cannot keep up at
  the chosen speed, a note says the view runs slower than that; the figures are not affected.
- The 600 vehicles nearest the camera are drawn as 3D models; the rest are drawn as small dots.
- Click a vehicle to inspect it (Details tab → "Live view figures").
- Leaving Simulate, choosing another road or pressing Stop releases the live view completely.

## 5. Through the day and Details

- **Through the day** (tab 2): the same road at the four periods on the same network, to see when it is a problem.
- **Details**: the demand (where the trips come from and how many), assumptions and data sources, network checks
  (roads that lead nowhere, roads drawn twice; "Fix in Design" opens them), and the live view figures.
- The drawer at the bottom has **Calibration**, **ODME** (fitting the demand to counts, for experts), **Emissions**,
  **Count checks** and **Through the day**.

## 6. When something goes wrong

- **The server cannot be reached**: map-based work still runs in the browser, but data that comes from the server
  (mapped signals, traffic counts, the hour-of-day profile) is shown as not loaded, never as zero. Retry buttons
  appear where a load failed.
- **"No traffic is routed through this road's neighbourhood at this hour"**: nothing to show live; try a larger area or
  another hour.
- **The analysis is slow**: a 5 km area on a slow computer can take several minutes. Progress is shown in the panel.

## 7. Data

Pune has no openly published official traffic counts. The checks use research transcriptions: 6 junctions (NICMAR
2025), 8 CCTV cameras (2023) and the 2008 river-bridge counts. The model is therefore compared with old or partial
counts only. Section speeds are from 2025–2026 observations.

---

## Developer appendix

- Panel: `components/SimulationPanel.tsx`, `components/RoadAnalysisPanel.tsx`, `components/simulate/SimulatePieces.tsx`
  (engine-free pieces: get-started card, evidence tags, comparison hour note, emissions as relative change).
- State: `engine/simulation/SimulationMode.ts`. Baseline and proposal runs carry a fingerprint of every input
  (`runFingerprint`): a run with the fingerprint of the analysis on show, or of the one running, reuses it; otherwise
  the automatic analysis is cancelled first, so two analysis jobs never run at once.
- A workspace switch calls `ObjectManager.notifyViewOnly()`; `classifyObjectChange` returns `'view'` and the engine
  only redraws (no traffic-graph rebuild, no `networkChanged`).
- Live view: `liveTrafficCore.ts` (the simulation and its step budget, frame packing), `liveTrafficWorkerMain.ts`
  (worker side, `attachLiveWorker`), `liveTraffic.worker.ts` (entry), `liveTrafficProtocol.ts` (messages, budgets),
  `liveTrafficRun.ts` (main side: `WorkerLiveRun` with `FrameInterpolator`, `InlineLiveRun` fallback when there are
  no module workers). `resources().liveThreaded` says which one runs.
- Drawing: `MicroTrafficVisualizer.ts`: models for the 600 nearest vehicles within 6 km, the rest as points in one
  `PointPrimitiveCollection` (`lastDraw` reports both counts).
- Tests: `SimulateRefine.test.ts`, `LiveTrafficWorker.test.ts`, `VehiclePoints.test.ts`.
- Audit and verification: [SIMULATE_AUDIT.md](SIMULATE_AUDIT.md).
