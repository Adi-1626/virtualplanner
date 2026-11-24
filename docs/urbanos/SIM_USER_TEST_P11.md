# Simulate as a planner uses it: user test, p11 (branch `p11-sim`, off `p10-estimated` 312e731)

What this document is: three planning questions run end to end in the browser the way a planner at PMC would run
them (pick a road, see what is wrong, save the existing city, draw the change in a proposal, compare), the
validation record re-run on the p11 engine, every bug the test found and how it was fixed, and an honest verdict.

Read with: [TRAFFIC_CALIBRATION_P9.md](TRAFFIC_CALIBRATION_P9.md) (counts, sites, calibration/hold-out split),
[TRAFFIC_ESTIMATED_P10.md](TRAFFIC_ESTIMATED_P10.md) (the city-wide estimated traffic dataset and why it is not used),
[SIMULATE_WORKSPACE.md](SIMULATE_WORKSPACE.md) (the workspace itself).

Test set-up: production build of `p11-sim` served statically, backend on a copy of the project database
(`backend/twincity.db` never touched), headless Chromium (SwiftShader), 1440 × 900. Weekday, 09:00 (morning peak),
2 km study area, 3 seeds (42, 7, 11) on both sides. **Estimated flows off** (the shipped configuration): edge flows are
class-typical flows per lane; neither the city-wide estimated traffic nor the p11 zone demand / estimate match is used.

---

## 1. The planner workflow

The Simulate panel (right) is built around one road and three steps. Nothing here needs the developer tools.

| Step | Where | What the planner does | What they get |
|---|---|---|---|
| 0 | Simulate, map | Click a road (both carriageways of a divided road are taken together) | Header: road, length, "area 2 km around it"; WHEN chips (morning peak / midday / evening peak / night) |
| 1 | **1 · What's wrong** | Read the diagnosis | Load (v/c) and speed per direction, the binding stretch or junction, who uses the road (through traffic vs trips of the area), bottlenecks nearby; all labelled *modelled* |
| 2a | **2 · Improve & compare → Save existing city** | Save the baseline | The existing city's run, frozen demand, hour and seeds. Kept in the browser (IndexedDB `sim-baselines`) per road, range and direction, and restored after a page reload ("Baseline saved …, restored from this browser") |
| 2b | Alternative switcher → **New proposal**; Design | Draw the change in a proposal (flyover, lane change, closure by deleting the road) | The existing city is untouched; the proposal holds only the changes |
| 3 | **Compare** | Run the proposal on the same frozen demand and seeds | Verdict per scale (Road / Neighbourhood / Area) and overall, confidence and how many runs agree, headline cards, roads that gain / lose, Where traffic moved (also on the map), fuel and emissions, results tables (summary, roads, junctions), lane change and capacity |
| 4 | Export buttons under the results; Reports | Take it away | Report (HTML), Roads CSV, Junctions CSV, Summary CSV; the comparison also appears in Reports → Scenario traffic report and in the planning project PDF |

The red banner "Traffic model fails validation" stays on every Simulate screen and in every export. It is computed
from the recorded per-site results in `frontend/src/components/ui/badges/trafficValidation.ts` against fixed TAG M3.1
criteria; nothing in this test loosened a threshold or hid it.

How to read a verdict: the direction (better / worse / mixed / no clear change) and which roads gain or lose are what
the model can support; absolute volumes and times are not (see §2 and §5). "Confidence: low" is shown on every result
because the model fails validation.

---

## 2. Validation (TAG M3.1, the same 15 count sites and river screen line as p9/p10)

Each site is run in its own 2 km study area at its counted hour; assigned volume, motor vehicles; counts are CMP 2008
river bridges and ROBs plus Gunjan Chowk 2017 (TRAFFIC_CALIBRATION_P9.md §4). Calibration 7 sites, hold-out 8 sites
(never fitted). Pass needs ≥ 85 % of sites at GEH < 5 and the screen line within ±5 %.

| Run | Engine / demand | GEH < 5 (all) | Hold-out GEH < 5 | Hold-out mean GEH | River screen line | Shipped |
|---|---|---|---|---|---|---|
| p10 `base0` | p10 engine, class-typical edge flows | 2/15 | 1/8 | 32.8 | −26.2 % | was |
| **p11 `base1`** | **p11 engine, class-typical edge flows** | **2/15** | **1/8** | **31.4** | **−26.5 %** | **yes** |
| p11b | + zone demand inside the area + match to estimated volumes | 3/15 | 0/8 | 30.3 | +33.2 % | no |
| p11c | + match to estimated volumes only | 3/15 | 1/8 | 31.2 | +28.5 % | no |

- All four **fail TAG M3.1** by a wide margin. The p11 engine changes (unified road centreline lengths, mid-block
  signals in the micro-simulation) move the shipped numbers only slightly (base0 → base1).
- p11b and p11c gain one calibration site each but are worse where it matters: the river screen line swings from
  about a quarter too low to about a third too high, and p11b loses the only hold-out site that passed. They are in
  the code, off by default, and **not shipped**. The city-wide estimated traffic as edge flows (p10) stays off as well.
- Estimated flows are OFF in every result in §3.
- Raw runs: `/workspace/work/p11-run/{base0,base1,p11b,p11c}.score.txt` (dev machine; `run_val.sh`,
  `score_p10.py`, scored against the counts and, separately, the estimated 2026 volumes).

---

## 3. The three scenarios (final run, build of `bea3385`, 24 Nov 2026)

All three: weekday 09:00, 2 km, 3 seeds, estimated flows off, baseline saved from the existing city, proposal on the
same frozen demand. No console errors and no failed requests in any run.

### S1. Katraj Chowk flyover on Satara Road (`osm_367660757`, proposal `scn_hwco0oea`)

Baseline demand 11,600 veh/h. What's wrong: southbound 9 km/h at v/c 1.63, northbound 12 km/h at 1.05.

**Verdict: Better (Road better, Neighbourhood better, Area better), confidence low; 4 of 5 changes over 5 % seen in every run.**

| Measure | Existing | Proposal | Change | Runs agreeing |
|---|---|---|---|---|
| Time to drive Satara Road | 471 s | 382 s | −19 % | 3/3 |
| Speed on it | 10 km/h | 13 km/h | +28 % | 3/3 |
| Worst junction delay at its ends | 134 s | 109 s | −19 % | 2/3 |
| Traffic through it (simulated) | 3,884 veh/h | 4,031 veh/h | +3.8 % | 2/3 |
| Traffic routed along it | 5,612 veh/h | 5,515 veh/h | −1.7 % | |
| Trips completed in the neighbourhood | 1,793 | 1,926 | +7.4 % | 3/3 |
| Mean delay per trip | 215 s | 191 s | −11 % | 3/3 |
| Total time driving in the area (routed) | 1,472 veh·h | 1,446 veh·h | −1.8 % | |
| Stretches over capacity | 83 | 79 | −4.8 % | |

Where traffic moved: the flyover (southbound) carries 1,149 veh/h; Bharathi Vidyapeeth Road −357, Jambulwadi Road
−320, Khashaba Jadhav Path −301, Wonder City Road −290; Lake Town Road +156 and Sukhasagar Road +96 take more.
Roads that lose: Lake Town Road 60 % → 83 % v/c. No new bottleneck. Fuel in the neighbourhood −5.3 % with +8.9 %
distance driven (more traffic served).

### S2. Baba Bhide Bridge closure (`osm_53759174`, proposal `scn_lc93xfhh`)

Baseline demand 33,399 veh/h (old city, central Pune). The proposal deletes the bridge.

**Verdict: Mixed (Road: no clear change (the road is closed), Neighbourhood mixed, Area no clear change), confidence low.**

| Measure | Existing | Proposal | Change |
|---|---|---|---|
| Traffic through the bridge (simulated) | 561 veh/h | 0 | −100 % |
| Traffic routed along it (both directions) | 1,787 veh/h | 0 | −100 % |
| Share of routed traffic that got through the neighbourhood | 69 % | 66 % | −4.1 % (3/3) |
| Trips completed in the neighbourhood | 3,294 | 3,404 | +3.3 % (3/3) |
| Mean trip time in the neighbourhood | 216 s | 222 s | +2.9 % (3/3) |
| Mean delay per trip | 165 s | 172 s | +4.0 % (3/3) |
| Total time driving in the area (routed) | 5,369 veh·h | 5,412 veh·h | +0.8 % |
| Stretches over capacity | 900 | 917 | +1.9 % |
| Trips that cannot reach their destination | 0 | 0 | none |

Where traffic moved: Baba Bhide Bridge (closed) −1,787 veh/h and its approach Jagannath Kaniram Kasat Path −1,773;
Maharshi Vitthal Ramji Shinde Bridge **+516**, Congress Bhavan Path +491, Chimaji Appa Peshwe Chowk +191,
Chandusheth Kalbhor Marg +181; Narubhau Limaye Path −487. Roads that lose: Congress Bhavan Path 185 % → 231 %,
Shinde Bridge 79 % → 99 %, Shivram Mhatre Path 187 % → 204 %. Every trip still has a route (other bridges absorb it),
the neighbourhood gets slightly slower, the area total barely moves. Fuel −6.7 % in the neighbourhood (model totals).

### S3. Sinhagad Road widening, 3 → 4 lanes each carriageway (`osm_1157871403` and its pair, proposal `scn_95q3cdf1`)

Baseline demand 30,193 veh/h, all of it through traffic (the area's project holds no buildings or zones with
activity; §5). The header reads "2.28 km, both carriageways".

**Verdict: Better (Road better, Neighbourhood no clear change, Area better), confidence low; 4 of 4 changes over 5 % seen in every run.**

| Measure | Existing | Proposal | Change | Runs agreeing |
|---|---|---|---|---|
| Time to drive it | 323 s | 289 s | −11 % | 3/3 |
| Speed on it | 16 km/h | 18 km/h | +13 % | 3/3 |
| Worst junction delay at its ends | 89 s | 65 s | −27 % | 3/3 |
| Traffic through it (simulated) | 3,711 veh/h | 4,236 veh/h | +14 % | 3/3 |
| Traffic routed along it | 10,109 veh/h | 10,839 veh/h | +7.2 % | |
| Mean trip time in the neighbourhood | 470 s | 477 s | +1.5 % | 2/3 |
| Total time driving in the area (routed) | 8,507 veh·h | 7,790 veh·h | −8.4 % | |
| Stretches over capacity | 757 | 734 | −3.0 % | |

Lane change and capacity: each direction's mid-block capacity rises from 3,857 to 5,143 PCU/h (IRC:106), but the
signal at its end (3,267 PCU/h at the stop line) limits it more than the road does: the widening moves the queue to
the junction. Where traffic moved: Late Narayanrao Kondiba Jagtap Path −791, Janta Road −416, Nilayam Bridge −280,
Janata Vasahat Road −178 (traffic drawn back onto Sinhagad Road, 11,677 → 12,322 veh/h both carriageways).
Roads that lose: Panmla Road 266 % → 282 %.

### Evidence

Screenshots: `/workspace/work/urbanos/shots/p11/` (s1-*, s2-*, s3-*). Exports (report HTML, roads/junctions/summary
CSV) for each scenario: `/workspace/work/urbanos/shots/p11/exports/{s1,s2,s3}-*`. Panel text and result JSON:
`/workspace/work/p11-e2e/{s1,s2,s3}_compare_p11final.{txt,json}`.

---

## 4. Bugs found and fixed in p11 (branch `p11-sim`, since 312e731)

Each fix is its own commit with a test.

**Comparison results**
- `044b279` a new bottleneck must have been under capacity before; comparison tables tolerate a missing junction list.
- `f63fdb1` headline cards wrap the proposal figure instead of clipping it ("4,031 veh/").
- `55a8dd2` another road's result is no longer badged "Proposal" against a baseline saved for a different road.
- `48171b6` Where traffic moved lists roads that gained as well as lost (a closure showed none of the bridges that took
  its traffic); mapped signals loading no longer says "Run the comparison again" before any comparison ran.
- `4ebe7be` the neighbourhood's mean speed is completed trips' distance over time (it was a snapshot of vehicles
  standing in queues: 2.4 km/h beside 216 s trips).
- `7567630` the demand line says how trips split; an area with no trips of its own says all of it is through traffic.
- `00e7d3b`, `53189e4`, `2328d7a` (this pass) a road's volume in the road table, Where traffic moved and the exports is
  its busiest stretch in each direction, added (both carriageways of a divided road, direction from the link's
  bearing), as "Traffic routed along it" counts the studied road: the closed Baba Bhide Bridge read 1,031 veh/h beside
  "routed along it 1,787"; a baseline restored from the browser gives the same volumes as a fresh one (Karve Road read
  4,427 → 8,423 because only the proposal knew its pieces' directions).

**Closures**
- `1b8364d` a proposal can delete the studied road: the study and baseline stay, the area is mapped from the joining
  roads, Compare reports the closure.
- `6f81900` a removed road is not listed among roads that gain.
- `7c2fc3e` the closure's area is measured from the closed road's ends (it was larger than the baseline's: Dandekar
  Bridge "lost" 638 veh/h).
- `d0f2921` the removed road is marked "(closed)" in Where traffic moved.
- `7ca6239` the header says "closed in this proposal", not the joining roads' length.
- `ad3bd16` report titles and file names name the closed road, not its id.

**Baseline and run state**
- `f7c6187` a cancelled run no longer leaves "Analysing… 22 %" for good.
- `66317db` selecting another road mid-analysis no longer sticks at "Analysing… 0 %".
- `16d174f` selecting another road clears the previous result instead of showing it under the new name.
- `01db689` a saved baseline survives a page reload (IndexedDB), only for the same roads, range and direction and never
  onto an existing city whose network changed.
- `aebb7c3` the stored baseline is restored once the mapped signals arrive after the reload.
- `bea3385` (this pass) with baselines saved for two roads, each gets its own back after a reload whichever is studied
  first (Satara Road showed Baba Bhide Bridge's baseline under "The study roads changed since the baseline").

**Design objects as Simulate reads them**
- `4c8cfcf` header "Saving…" follows writes only; a flyover ramp no longer joins a side road ending under it; the
  flyover connection check names the roads each ramp joins; an empty proposal is not "Unsaved changes".
- `d992358`, `1373cd9` a class change carries the class speeds; Simulate and the alignment checks read a class-default
  design speed from the current class (the Katraj flyover made arterial ran and was screened at 30 km/h).
- `71d73ef` a divided road's U-turn openings are not part of its section (they showed as two extra directions).
- `96d729a` a long road is not offered as "part of" a junction because of one short piece.
- `b83e96c` after a road edit the inspector shows the proposed state, not the base road.
- `4081e6e` a lane or direction edit keeps the road's existing footpaths (widening added a right footpath).

**Reports, data loading, engine**
- `cb75f76` comparison tables, report and CSV exports; roundabout give-way; comparison summary in the planning PDF;
  zone demand and estimate match (off by default); underground objects hidden in Simulate; Esc closes popovers.
- `f8f51b3` mid-block signals in the micro-simulation; validation record re-run on the p11 engine (§2).
- `e8a01a2` no 404 in the console when no calibrated-flow file is installed.
- `13a3502`, `5551b12` planning report section 5 leads with the latest comparison per alternative and labels results
  as Simulate records them.

---

## 5. Verdict

**Simulate now helps a planner judge direction and trade-offs; it does not give numbers to design or approve with.**

What it does well, seen in all three scenarios:
- It runs a real before/after on the same frozen demand and seeds, says how many runs agree, and keeps the existing
  city untouched. The workflow (pick road → what's wrong → save → draw in a proposal → compare → export) works without
  developer help, survives a page reload, and handles a closure.
- The direction of each result is plausible and explainable: the flyover relieves the corridor and pulls traffic off
  parallel roads; the closure pushes its traffic onto Shinde Bridge and Congress Bhavan Path and slows the
  neighbourhood a little; the widening speeds the road but the signal at its end becomes the limit, so the queue moves
  to the junction. That trade-off reading is what a planner needs at the options stage.

Why the confidence is low, and must stay low:
- **The model fails TAG M3.1**: 2 of 15 sites within GEH 5 (hold-out 1/8, mean GEH 31.4), river screen line −26.5 %.
  It under-carries central river crossings by about a quarter. Absolute volumes, times and percentages are model
  output from estimated demand, not forecasts.
- **Area demand is 100 % through traffic** unless the project holds buildings or zones with activity in the study area:
  in S3 all 30,193 veh/h cross the area from its edges at class-typical flows per lane. A scheme that changes local
  access (a new connection to a neighbourhood, a closure that cuts local trips) is therefore under-represented.
  The zone demand that would fix this (p11b) made validation worse and is off.
- Estimated flows (city-wide estimated traffic, estimate match) are off because they were worse on the hold-out sites.
- No speed or journey-time validation was re-run in p9–p11.

Use it to rank alternatives on the same inputs and to see where traffic moves; do not quote its numbers.

---

## 6. Remaining gaps

- Validation: Pune has no openly published current counts. Classified turning counts at the study junctions and
  journey times on the corridors (collection plan in MISSING_DATA_AND_COLLECTION_PLAN.md) are the only route to a pass.
- Local demand: OSM buildings in the old city are sparsely attributed; without project buildings or zones the area has
  no trips of its own.
- Junction rows can repeat a name (two "Baba Bhide Bridge / Jangli Maharaj Path" rows in S2, one signalised, one
  priority): they are different simulated nodes named from the same two roads, but read as duplicates.
- Where traffic moved hides small changes on the studied road itself (under 10 % of its volume), so a widening can
  list only the roads that lost traffic; the table and "Traffic routed along it" carry the gain.
- "Baseline saved …" shows the browser's clock; on a machine in UTC it is not IST.
- Map: gateway "IN/OUT ×n" labels and signal markers crowd the 2 km view; the gains/losses overlay has no legend.
- Per vehicle class: travel times by class are not modelled (only the demand by class is shown).
- Earlier visual gaps from p10 still open (crossings and bus stops as point markers, paths as flat lines, IRC:35
  markings after reload, roundabout rings only).
