# Design tools, phase 7: street design (2026-11-22)

Seven tools from BUILD_VISUALS_AND_TOOLS_PLAN.md §B4 (#1–#4, #6–#8; #5 "elevation while drawing" is not in this phase).
Code: `frontend/src/engine/streetDesign/` (one module per tool, `sources.ts` holds every number with its source),
UI `frontend/src/components/design/StreetDesignPanels.tsx`, tests `frontend/src/engine/testing/StreetDesignTools.test.ts`
and `StreetDesignMetro.test.ts`, backend `planning/quantities.py`, `coordination/seed.py`, `coordination/screening.py`.

Every check is **screening only**: the best result is "no flag found", never "safe" or "compliant"; a value the
data does not give is **unknown**, never a pass. Rendering beyond a simple placeholder is the visuals work's (p7-visuals);
these tools emit data (positions, marking lines, sizes).

## Status of the values

| Status | Meaning | Shown in the app as |
|---|---|---|
| **official** | read from a government / agency copy: Pune USDG 2016 (PMC), MoUD/IUT Code of Practice Parts 1–2 (2012), Maha-Metro Pune Metro Phase-2 DPR (Rev. 4, July 2024) | "official copy" |
| **IRC copy, unconfirmed** | IRC text read from the Public.Resource.Org mirror (law.resource.org); the title page of each file was checked, but it is a third-party copy, not an IRC-issued one | "IRC text, third-party copy — unconfirmed" |
| **app** | a value the app already uses elsewhere (micro-simulator amber 3 s, all-red 2 s); not from a code | "app value, not from a code" |
| **assumed** | no source; a placeholder the UI labels assumed | "assumed — no source" |

All PDFs were read with `pdftotext`. Spot-checked again on 2026-11-22 against the text copies: IRC:35 §11.3.3 (10.5 m,
1.2 m), IRC:93 Tables 2–3 (650/800/200/250; 1000/1200/100/150), IRC:65 Table 6.1 (28–40 / 40–70 m) and Table 9.1
(A, B by diameter), IRC:124 §6.1 (3.5 m lane, 0.5 m divider, 3.5 / 4 m station), IRC:54 §8 (5.50 m urban), IRC:11
Table 4 (2.2 m two-lane minimum, 2.5–5.0 m desirable), DPR §5.9.2 p. 5-80 (5 m setback).

## Tools

### #1 Junction control brush + IRC:35 markings (`junctionTool.ts`)

Click an imported junction (three or more roads within 40 m) with the brush set to **Signal / Stop (minor roads) /
Give way (minor roads) / Uncontrolled**. Writes the same whole-junction edit the junction editor writes
(`JunctionEditSpec`, one Undo step), keeping bans, lane connections, a user's signal plan and major arms already set.
Turn bans and lane links stay in the junction editor (not separate brushes, unlike the plan's list).

| Value | Source | Status |
|---|---|---|
| Stop line 200 mm (urban) | IRC:35-2015 §6.1.3, p. 32 | IRC copy |
| At signals: zebra 1 m ahead of the signal, stop line 1 m ahead of the zebra | §6.1.4 / §11.3.2, pp. 32, 72 | IRC copy |
| Unsignalised: stop line 2–3 m before the zebra; no zebra: 1.25–9 m from the crossing carriageway edge | §6.1.4 | IRC copy |
| Double stop line 2 × 200 mm, 300 mm apart (with STOP sign) | §6.1.7 | IRC copy |
| Give-way line: two broken 200 mm lines, 600 mm dash / 300 mm gap | §6.2.1, p. 34 | IRC copy |
| Zebra ≥ max(2.0 m, footpath width) | §11.3.5, p. 72 | IRC copy |
| Zebra stripe 0.5 m | IRC:35 Table A.4 not transcribed | assumed |
| Arrow length 3.5 m (≤ 50 km/h) / 5.0 m (51–100) | §8.1.2 Table 8.1, p. 45 | IRC copy |
| Arrow position 10 m behind the last transverse marking | not stated in the text read | assumed |
| Signal warrants 1–2 (veh/h, each of any 8 hours) | IRC:93-1985 Tables 2–3, pp. 25–26 | IRC copy |

**Checks**: signal warrant (Warrants 1 and 2) against approach volumes — **unknown** without volumes; with Simulate's
modelled peak hour it says whether that hour reaches the thresholds, and always says the warrants need 8 hours of
counts. Below both warrants under a signal = warning (Warrants 3–5 not screened). Markings are data (`MarkingItem`
lines with their source keys) for the visuals; an uncontrolled junction gets none and a note (IRC:35 §6.1.1).

**Downstream**: Simulate (assignment and corridor micro-simulation) through the existing junction-edit path: a signal
gets a fixed-time plan (approach-wise phases, app defaults 25 s green / 3 s amber / 2 s all-red when no plan exists);
stop and give way are both **priority control** in the model (they differ only in markings and the report).

**Limits**: signal warrants cannot be screened without volumes, and the model's one peak hour is not validated
against counts; "Stop" vs "Give way" has no different capacity in the model; markings are placed from the network
geometry (set back by half the widest arm), not from a surveyed kerb line; only junctions edited in this session have
markings cached for display.

### #2 Pedestrian crossings (`crossings.ts`)

Click a road (snaps within 30 m): zebra, raised (table-top) or signalised mid-block crossing, optional refuge island.

| Value | Source | Status |
|---|---|---|
| Refuge needed when > 10.5 m in one go; refuge ≥ 1.2 m | IRC:35 §11.3.3, p. 72 | IRC copy |
| Refuge ≥ 1 m; ≥ 3 m for wheelchair users | Pune USDG §4.1.2, p. 17 | official |
| Roads of 4+ lanes: median refuge ≥ 3 m | IRC:86-2018 §5.1.2, p. 9 | IRC copy |
| Raised crosswalk ≥ 3 m wide, vehicle ramps 1:8 | IRC:86 §5.1.2 | IRC copy |
| Mid-block crossings every 50–200 m | IRC:86 §5.1.2 | IRC copy |
| BRT corridor: every 150 m | Pune USDG (BRT lanes), p. 12 | official |
| Mid-block signal ≥ 300 m from another cross-walk; no kerb parking 75 m either side | IRC:93 §5.4, p. 27 | IRC copy |
| Pedestrian green = width / 1.2 m/s + 7 s | IRC:93 §22.1, pp. 21–22 | IRC copy |
| Pedestrian warrant 150 ped/h (+ 600 veh/h), each of any 8 h | IRC:93 §5.1 Warrant 3 | IRC copy |
| Mid-block signal cycle 60 s | design input (IRC:93 §22.2: multiple of 5 s, ≤ 120 s) | assumed |
| Amber 3 s, all-red 2 s | micro-simulator | app |

**Checks**: width, raised width, refuge need and refuge width, spacing to the next *drawn* crossing on the same road,
mid-block signal spacing, pedestrian warrant (**unknown** without a count), the timing the model uses.

**Downstream**: only a **signalised** crossing changes the model: the road's assignment links passing within 5 m of it
get Webster uniform delay C(1 − g/C)²/2 and a stop-line capacity cap (Indo-HCM saturation flow × g/C), on a copy of the
road (`streetEffects`, never stored). Zebra and raised crossings change nothing in the model (pedestrian volume unknown,
no Indian capacity factor read) — said in the inspector.

**Limits**: mapped zebras and junction crossings are not counted in the spacing check; the 60 s cycle is assumed until
the planner enters one; the corridor micro-simulation does **not** run the mid-block signal (assignment only);
pedestrians themselves are not modelled.

### #3 Bus lane / BRT upgrade and bus stops (`busLane.ts`, `busStops.ts`)

Bus lane / BRT is an upgrade on the road (road inspector), stored as `road.busPriority`; the road's lanes are not
rewritten, so removing it restores the road exactly. Bus stops are placed on a road: kerb-side, bay (in the
parking/furniture strip) or BRT median station.

| Value | Source | Status |
|---|---|---|
| BRT lane 3.5 m one-way, passing lane 4 m, divider ≥ 0.5 m (≥ 1 m at crossings) | IRC:124-2017 §6.1, p. 36 | IRC copy |
| Median station inner ≥ 3.5 m, outer ≥ 4 m | IRC:124 §6.1, p. 37 | IRC copy |
| Dedicated bus lanes on RoW ≥ 30 m; two-way busway ≥ 7 m undivided | Pune USDG (BRT lanes), p. 12 | official |
| Stops 500 m – 1 km apart | MoUD CoP Part 1 §5.9, p. 27 | official |
| Stop ~50 m from any junction; no parking 50 m before / 20 m after; shelter 10 × 1.5 × 2.2 m | Pune USDG (Bus stops), p. 11 | official |
| Clear walking zone 2 m | Pune USDG §3.1, p. 7 | official |

**Checks**: lane width, divider, two-way busway, RoW (**unknown** when the available RoW is not recorded — the drawn
strips are not the RoW), general lanes left; stop spacing (drawn stops only), junction distance, clear walkway past a
kerb shelter (**unknown** with no footpath recorded), bay strip width, BRT station widths and whether the road has BRT.

**Downstream**: Simulate's copy of the road has **one general-traffic lane fewer per listed direction** (assignment and
micro-simulation both read lanes from the road; IRC:106 capacity of what is left). The upgrade is blocked when a
direction would be left with no general lane. Bus stops change nothing in the model. Planning report: bus / BRT lane
length (road length × directions) on new or changed roads; stops counted.

**Limits**: buses are **not** a separate mode: bus speed, bus priority and mode shift are not modelled; a kerb-side
stop's blocking of the kerb lane is not modelled (Indo-HCM factor not transcribed); existing PMPML stops are not loaded,
so spacing is against drawn stops only.

### #4 Streetlights and street trees (`roadside.ts`)

A run of N items at a spacing along one side of a road (furniture strip, footpath or median); every position is stored.

| Value | Source | Status |
|---|---|---|
| Pole height / spacing: path < 5 m 4.5–6 m / 12–16 m; RoW ≤ 9 m 8–10 m / 25–27 m; RoW > 9 m 10–12 m / 30–33 m | IRC:86 §5.8 Table 5.6, p. 16 | IRC copy |
| No pole above 12 m; one row generally enough up to 12 m street width | IRC:86 §5.8 | IRC copy |
| Tree pit ≥ 1 × 1 m; canopy clearance ≥ 3 m | IRC:86 §5.1.10, p. 11 | IRC copy |
| Clear walking zone 2 m | Pune USDG §3.1 | official |
| Street-tree spacing 8 m | no value in the texts read | assumed |
| Utility reach: half the pit + 0.5 m (pole 0.5 m); pole base 0.3 m | — | assumed |

**Checks**: pole height and spacing by the Table 5.6 row (available RoW when recorded, else the drawn width, said so),
rows on streets wider than 12 m, tree pit, canopy, clear walkway in the footpath zone, pits/foundations over a
recorded utility → "requires investigation" (**unknown** when no utility is loaded: absence of records is not absence of
utilities).

**Downstream**: none in Simulate (said so). Planning report counts poles and trees. Underground: the utility check is
done in the inspector, not in the Underground screening run.

**Limits**: footing depth and size unknown; no lux / uniformity calculation; tree census comparison (Environment) not
wired.

### #6 Metro viaduct setback and clearances (`metroSetback.ts`; no new object)

Automatic on metro lines and double-decks.

| Value | Source | Status |
|---|---|---|
| Viaduct about 8.5 m edge to edge (Phase-1) | Pune Metro Phase-2 DPR §5.9.2, p. 5-80 | official |
| Setback about 5 m from either edge (or 10 m each side of the centreline), no structures | DPR §5.9.2, p. 5-80 | official |
| Rail ≥ 8.4 m above existing road; 5.5 m road clearance beyond the crash-barrier face | DPR §5.7.1.2, p. 5-62 | official |
| Circular pier 2–3 m; 25 mm gap pier–barrier | DPR §5.7.1.2 | official |

**Checks**: buildings inside the setback (proposed = flag, mapped = warning), rail level over crossed roads,
double-deck rail above its road deck, pier in the median (too narrow = flag; wide enough = **unknown**: barrier base
width not stated).

**Downstream**: Projects coordination seed rule **`metro_dpr_setback_5m`** (`coordination/seed.py`): 5 m, edge to
edge, subject kinds building / foundation / pier / bridge / flyover / metro_station / other, other kind metro_viaduct;
roads, utilities and excavations are not "structures" here (they keep the 20 m NOC trigger).

**Limits**: the coordination rule table has only two rule types (permission distance / engineering clearance); the
setback is stored as a cited distance (`permission_distance`, basis `cited_permission_distance`), so the Projects UI
labels it with the generic "permission distance" wording; its own note says it is a DPR planning setback, not a
statutory rule and not an engineering clearance. "About 5 m" is the DPR's own wording.

### #7 Roundabouts (`roundabout.ts`)

Click a junction (three or more roads); pick urban single-lane, double-lane or mini.

| Value | Source | Status |
|---|---|---|
| ICD urban single-lane 28–40 m, double-lane 40–70 m; ≤ 4 arms at 90° | IRC:65-2017 §6.1.1 Table 6.1, p. 13 | IRC copy |
| Single-lane ICD 28/30/32/36/40 → island 4/8/12/18/24 m, CCW 12/11/10/9/8 m | Table 6.2 (interpolated between rows, said so) | IRC copy |
| Double-lane CCW 1–1.2 × entry width (1.1 × 2 × 3.5 m used) | Table 6.1 | IRC copy (factor choice assumed) |
| Entry lane 3–4.5 m at the give-way line | §6.3.2, p. 13 | IRC copy |
| Splitter island ≥ 2.4 m on arterial approaches | §6.4.3, p. 16 | IRC copy |
| Mini roundabout ICD 13–25 m, island < 4 m | MoUD CoP Part 2 Table 2-6, §2.3.1.1.1, p. 30 | official (IRC:65 has no mini category) |
| Entry capacity C = A·exp(−B·Qc), A, B by diameter (from Indo-HCM 2017) | IRC:65 §9 Table 9.1, p. 35 | IRC copy |
| Circulating flow Qc = 600 PCU/h | the assignment cannot feed the modelled circulating flow back | assumed |
| Default ICD: 32 / 50 / 20 m | tool default | assumed (editable) |

**Checks**: ICD in the category range, island and circulatory width against the size rule, arms (3–4), fit
(**unknown** until the available diameter from the DP / survey is entered), entry lane width from the approach lanes,
splitters (**unknown**: not drawn), crossings on the arms, the capacity the model uses.

**Downstream**: in Simulate's **static assignment** the junction's approaches lose any signal (mapped or edited) and
get the Table 9.1 entry capacity per entry lane (× min(approach lanes, entry lanes)). The roundabout rides on copies of
its arm roads, so the network key changes and Base is untouched. Planning report lists its size.

**Limits**: the **corridor micro-simulation does not model a roundabout** (it keeps the junction's previous control);
Qc is assumed, not iterated; Table 9.1 is stated per entry — applying it per entry lane for double-lane entries is an
interpretation; geometry (deflection, entry path radius, sight distance) is not designed or screened; ICD outside
20–70 m gets no capacity (signals removed only).

### #8 Standalone paths, FOB and subway (`paths.ts`)

Draw a line: footpath, cycle track one-way / two-way, shared path; at ground level, as a foot-over-bridge or a subway.

| Value | Source | Status |
|---|---|---|
| Cycle track ≥ 2 m one-way / 3 m two-way; buffer 0.5 m | IRC:86 §5.2, p. 12 | IRC copy |
| Two-lane cycle track min 2.2 m, desirable 2.5–5 m; shared footpath + cycle track 3–4 m for ≤ 40 m | IRC:11-2015 §6.1 Table 4, p. 7 | IRC copy |
| Footpath ≥ 1.8 m (residential pedestrian zone) | IRC:86 §5.1 Table 5.1, p. 7 | IRC copy |
| Clear walking zone 2 m | Pune USDG §3.1 | official |
| FOB / subway discouraged; ramp 1:20 with landings; lift mandatory, ≥ 1.5 × 1.5 m | IRC:86 Annexure I, p. 40 | IRC copy |
| Subway ≥ 2.5 m × 2.75 m; with cycles 5 m one-way / 6.5 m two-way | IRC:86 Annexure I | IRC copy |
| FOB clearance over a road ≥ 5.5 m (urban) | IRC:54-1974 §8, p. 8 (current edition unknown) | IRC copy |
| Footway / cycle clearance under a structure ≥ 2.25 m | IRC:SP:90 §4.18.3, p. 36 | IRC copy |
| IRC:103-2022 (pedestrian facilities) stair / ramp values | not obtainable (catalogue + drafts only) | **unknown** |

**Checks**: widths per type, shared length ≤ 40 m, buffer (**unknown** when not entered), grade-separated warning,
ramp and lift, subway size, utilities crossed by a subway (**unknown** with no records loaded), FOB clearance
(**unknown** until entered), roads a FOB spans, clearance under a structure for a ground path (deck depth assumed 2 m).

**Downstream**: none in Simulate (pedestrians and cyclists are not modelled; said so). A **subway** is read by the
Underground screening as a cut-and-cover box dug from the surface: internal width / 2 as half-width, crown at ground,
invert **unknown** (`coordination/screening.py` `is_subway`, mirrored in `ConflictCheck.tsx`); other street elements do
not change the Underground inputs or their hash. Planning report: path length.

**Limits**: no walking / cycling times or mode shift; FOB piers and stair landings are not modelled; subway wall
thickness and depth are not designed.

## Common behaviour

- One object type `street_element` (kind + kind-specific fields), stored as any other city object: proposal
  copy-on-write, Undo/Redo, save → reload (`objectToRow` / `objectFromRow`) apply unchanged; the bus lane lives on the
  road. Layer "Street elements" (placeholders only).
- Simulate reads roads only: street elements reach it as `streetEffects` on **copies** of the roads they act on
  (`streetDesign/network.ts simulationRoads`), so the network key, the stale marker, the proposal / Base split and Undo
  follow automatically. Tested: `StreetDesignTools.test.ts` (each tool: checks; effect in the assignment network; Base
  view unchanged; Undo back to the Base key; save → reload gives the same key / data).
- Single-click tools (crossing, bus stop, roadside, roundabout, brush) clear the click and show the message when the
  click is not usable (no road within 30 m, no junction within 40 m).
- Planning report (`planning/quantities.py`): street elements listed with their detail; new items counted by kind;
  path length and bus / BRT lane length in the totals. A bus lane on a changed base road counts only when the base
  road did not already have the same one.

## Not done / open

- #5 elevation while drawing (L effort) — not in this phase.
- Junction markings are cached only for junctions edited (or opened) in the session; a reload recomputes them when the
  junction is opened.
- Roundabout and mid-block signal are not in the corridor micro-simulation.
- IRC copies are unconfirmed third-party copies (decision C6 of BUILD_VISUALS_AND_TOOLS_PLAN.md is still open).
