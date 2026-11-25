# Simulate → Design → re-test (P12)

The planner's loop in Simulate is: study a road, see what is wrong, change something in Design, test the change
against the existing city, and repeat. Before P12 every step of that loop worked on its own, but the planner had to
stitch them together by hand. P12 makes it one round trip, adds a map key that lists only what the map draws, and
rewrites the validation banner in plain words.

Branch `p12-flow` (from `036e805`). Code: `frontend/src/engine/simulation/roundTrip.ts` (engine-free model),
`frontend/src/shell/roundTripController.ts` (the flow), `frontend/src/shell/roundTrip.ts` and `roundTripNav.ts`
(wiring and browser history), `frontend/src/components/simulate/RoundTripBar.tsx` (bar and panel),
`frontend/src/components/MapLegend.tsx` and `MapSymbolTooltip.tsx` (map key),
`frontend/src/components/ui/badges/ValidationBanner.tsx` (banner). Tests: `RoundTrip.test.ts` (14),
`RoundTripKeys.test.ts` (1), `MapLegend.test.ts` (10).

---

## 1. Audit: the loop before P12

| Step | Before P12 | Problem for the planner |
|---|---|---|
| Change a road for a study | Design edits went into the active proposal, and Simulate re-ran on the active proposal's network. **Changes did reach the simulation.** | Nothing took the planner from a suggestion to the road in Design; they had to find it, and could edit Base by mistake (Base was editable in Design). |
| Compare with the existing city | "Save" a baseline on Base, switch to the proposal, "Compare". | The baseline had to be saved by hand first; forgetting it meant comparing a proposal with itself or with nothing. |
| Come back from Design | The rail back to Simulate. | **The comparison was cleared on any edit** (it is stale) and the planner had to go back to the Improve tab and press Compare again by hand. The study (roads, range, direction, hour) was kept only if nothing else had changed it. |
| Suggestions after a change | Re-computed from a fresh run. | **The suggestions re-ran on the current demand, not on the baseline's trips**, so a suggestion could move or disappear because the demand changed, not because the change worked. Nothing said which suggestion had been tried. |
| Repeated tests | Each compare replaced the last. | No record of test 1, 2, 3 against the original baseline; no "since your last test". |

## 2. Research: how planning tools hold a base and its changes

- **PTV Visum / Vissim** — one *base version*; *modifications* are groups of changes layered on it; a *scenario* is the
  base plus a set of modifications, calculated with the same procedure and compared. "A change into the base network
  = change for all scenarios", so the base is not edited for a scheme.
  Sources: https://cgi.ptvgroup.com/vision-help/VISUM_2025_ENG/Content/2_Szenarien_verwalten_Netze_vergleichen/2_1_Szenariomanagement.htm,
  https://blog.ptvgroup.com/en/modeling-planning/scenario-management-one-of-the-key-features-for-traffic-simulation-2
- **Aimsun Next** — *geometry configurations* hold the objects present or absent in a scenario on one base network;
  objects are not deleted, only left out of the run; *revisions* store only what changed from the base model, and the
  base model's results can be compared with the revision's.
  Sources: https://docs.aimsun.com/next/latest/UsersManual/GeometryConfigurationEditing.html,
  https://docs.aimsun.com/next/latest/Tutorials/8_Scenario_Management/8_Scenario_Management.html
- **ArcGIS Urban** — every plan/project has an *Existing* scenario and design scenarios; "You cannot edit the existing
  conditions scenario"; metrics are compared against the existing condition or other scenarios.
  Sources: https://doc.esri.com/en/arcgis-urban/latest/help/help-edit-project.html,
  https://doc.arcgis.com/en/urban/latest/help/help-scenarios.htm

What UrbanOS takes from them: one base (the existing city, never edited by the flow), each change in a proposal
layered on it, every test of a study run on the same base inputs (trips, hour, seeds) and compared with the same
saved baseline, and results that go stale when their inputs change.

## 3. Design: the round trip

1. **Start.** In Simulate → Improve, each buildable suggestion (junction, signal, widen, divert) has **Improve this**;
   the panel also has **Make my own change**. On Base with no baseline for this study, the flow first saves the
   existing city as the baseline (labelled as saved by the flow). It then opens Design.
2. **Where the change goes.** Into the active proposal; on Base the flow makes a new proposal named after the study
   and the suggestion. **Base is never edited**: while a test is open, Base is read-only in Design (the engine's own
   lock) and the bar offers "Back to the proposal".
3. **In Design.** The target is selected and framed (the road, or the junction opened in the junction editor). A
   **Return to study** bar on the map names the study (road, hour, day, area), the change and the proposal, and counts
   the changes as they are made (and how many lie outside the study area).
4. **Done – re-test.** Back to the same study (roads, range, direction, hour, day, Improve tab), the proposal run on
   the baseline's trips, hour and seeds, the comparison opened with the gains/losses overlay, and the suggestions
   recomputed from the proposal run. A suggestion that was tested carries a **Tested** badge with its verdict; one that
   is no longer flagged is listed as resolved.
5. **Repeat.** Every test is numbered against the original baseline, with "since your last test" figures.
6. **State survives a reload** (sessionStorage, this tab only) and resumes with "Return and re-test".

## 4. Edge cases

| Case | What happens | Status |
|---|---|---|
| No baseline for this study | Saved from Base first, labelled "saved by the flow"; failure stops with the reason, nothing changed | done, tested |
| Baseline from a proposal, or for another area | Re-saved from Base (step 1 of 2) before the run | done, tested |
| Done with no change | "You made no change…"; no run when the proposal equals Base; "nothing changed since your last test" when equal to the last test | done, tested |
| Change outside the study area | Asks: widen the study to the next range and re-test (new baseline), re-test anyway, or keep editing | done, tested |
| Underground-only change | Says the traffic model cannot see it; return without a run, or keep editing | done, tested |
| Cancel with no change | Back to the study, nothing to undo | done, tested |
| Cancel with changes | Asks: undo them and return (deletes a proposal the flow made, or undoes back to the leg's start), keep them and return, or stay | done, tested |
| Base selected during a leg | Editing locked; "Back to the proposal" or "End this test" | done, tested |
| Another proposal selected during a leg | The leg follows it; changes made in the first stay there | done, tested |
| Page reload mid-flow | Trip resumes from sessionStorage; proposal re-selected when it loads; a deleted proposal ends the leg with a reason | done, tested |
| Run fails (area not mapped, run stopped) | Back to editing with the reason and **Try again**; never a stuck progress line | done, tested |
| Proposal cannot be created | Plain reason, the existing city unchanged | done, tested |
| **Esc** on a question on the bar | Closes the question only (keep editing); the drawing, selection and test stay | P12 follow-up, tested (`RoundTripKeys.test.ts`) |
| **Esc** on a tapped map-symbol tooltip | Closes the tooltip only; a hover tooltip leaves Esc to the map | P12 follow-up |
| **Esc** in Simulate while a re-test runs | Ignored with a note (it would otherwise clear the study under the run) | P12 follow-up, tested (`simulateEscape`) |
| **Back** while changing, nothing changed | Returns to the study (like Cancel) | P12 follow-up, tested |
| **Back** while changing, with changes | Opens the Cancel question (undo / keep / stay); the change is kept; a second Back comes back to the question, never leaves the app | P12 follow-up, tested |
| **Back** while a re-test runs, or with Simulate already on show | Ignored safely; the leg and its history entry stay | P12 follow-up, tested |
| Cancel → **Undo them and return** after a test of the same proposal | The comparison comes back as it was (the network is again the one it tested), not "the network changed" | P12 follow-up, tested (`EditScope.test.ts`: cleared on the undone network, back on the tested one, dropped again after a study change) |
| Another change, a study change, demand or focus change after that | The parked comparison is dropped; Compare again | P12 follow-up, tested |
| Junction card, approach held by a signal on a piece inside the junction | Its green share is that piece's (walked inside from where the approach enters, as the editor's "as run" plan does), not "—%" | P12 follow-up, tested (`JunctionEditing.test.ts`) |
| Limiting stop line part-way along a direction, or with the assignment's assumed split | Said as such ("the signal part-way along it (assumed green split)"), and the suggestion opens it there | P12 follow-up, tested (`RoadAnalysisPanelPieces.test.ts`) |

Browser history: one same-URL entry (`history.state.uosRoundTrip = <leg id>`) is pushed when a leg starts, adopted
(not pushed again) after a reload, and taken off when the leg ends (that `popstate` is skipped).

## 5. Keys and navigation

See the Esc and Back rows above. Popovers (`AnchoredPopover`) already close on Esc in the capture phase and mark the
key handled, so the global shortcuts skip it; the round-trip bar's questions and tapped tooltips now do the same.

## 6. Why the Sinhagad Road widening reads differently from P11 (S3)

P11 (`SIM_USER_TEST_P11.md` S3) said the widening was limited by "the signal at its end (3,267 PCU/h)" in both
directions and gave **Better**; the P12 browser re-test gave **Mixed** with "the signal at its end (1,836 PCU/h)".
**Not a regression of the stop-line change.** The P12 stop-line work only records *where* the limiting stop line stands
(`AssignLink.stopLine`, `DirectionFlow.stopLine`); the PCU/h values come from the same formulas as P11 (the engine's
assignment and simulation code is unchanged between `p11-sim` and `p12-flow` apart from that). The two numbers come
from two different sources and two different tests:

| | P11 S3 | P12 re-test |
|---|---|---|
| Change | both carriageways 3 → 4 lanes (`osm_1157871403` + pair) | only the south-west carriageway (`osm_199637816`) 3 → 4 lanes |
| Study | 2.28 km, both carriageways | NE 1.10 km (`osm_1157871405`, `osm_1157871403`), SW 2.51 km (`osm_199637816`) |
| Demand in the area | 30,193 veh/h, all through traffic | 38,780 veh/h planned, 13,245 trips (demand key `fb6242db`) |
| Stop line shown | 3,267 PCU/h in **both** directions | SW: 1,836 PCU/h (after; 1,570 before) |
| Where it comes from | the assignment's *assumed* split: Indo-HCM S(4 × 3.5 m = 14 m) = 7,000 PCU/h × g/C 0.467 (120 s cycle, 2 phases, 4 s lost each) = 3,267. The corridor runs did not end at a signal in either direction, so `combineAnalysis` fell back to it (the identical figure in both directions is the sign) | the run's **own** Webster plan at the signal where the SW direction ends: Sinhagad Road × Late Narayanrao Kondiba Jagtap Path (Anandnagar/Karve Nagar, 73.82759 E, 18.48326 N). 7,000 × g/C 0.262 = 1,836 after; 5,355 (10.5 m) × 0.293 = 1,570 before |

So the tighter figure is the real green the simulated signal gives that approach, and it is right that it caps a
4-lane carriageway well below its 5,143 PCU/h mid-block capacity: widening one carriageway into a signal that gives it
a quarter of the cycle moves the queue to the junction, so time on the road goes up (+11 %) while the area total
improves: Mixed. The NE direction's stop line (2,499 PCU/h, assignment) stands part-way along `osm_1157871403` at
Dattawadi (73.83817 E, 18.49592 N), not at its end.

**What was wrong, and fixed:** the words. The lane-change insight and the diagnosis said "the signal at its end" for
every stop line, including an assignment stop line in the middle of a carriageway and an assumed green split.
`stopLineWords()` (`engine/simulation/stopLineWords.ts`) now says where it stands (at its end / part-way along it / on
it for a crossing), what it is (signal, roundabout entry, signalised crossing) and whether its green is the run's plan
or "assumed green split"; used by the lane-change insight, the diagnosis reasons and the signal suggestion. Test:
`RoadAnalysisPanelPieces.test.ts` "stop line words…".

## 7. Validation banner

The Simulate banner now says, in plain words: the headline verdict (TAG M3.1); then **a list of checks**, each its own
labelled row with its outcome, what was checked, what it found and why it fails; then what that means for using a
result (direction of change and trade-offs between options run on the same inputs, never volumes, speeds or times as
forecasts). The old one-line summary is under "Technical summary".

Checks are `ValidationCheck` entries (`id`, `label`, `outcome`, `checked`, `result`, `why`) in
`components/ui/badges/trafficValidation.ts` (`VALIDATION_CHECKS`), rendered by `ValidationBanner`. A second check
(for example a project check against estimated data) is one more entry, or a `checks` prop, with its own label; the
counts check keeps its test ids (`validation-checked`, `validation-why`), others get `validation-checked-<id>`.

## 8. Map key and every map symbol

A collapsible **Map key** (bottom right of the map) lists only what is drawn now, in the active workspace and overlay,
with units and colour scales; each entry has a tooltip, and hovering (mouse) or tapping (touch) a symbol on the map says
what it is. Colours come from the renderers' own constants (tests check them against the drawing code). Open/closed is
remembered; it opens by default from 1280 px wide.

Placement (browser check, P12 wrap-up): 46 px above the map's bottom edge (clear of Cesium's fullscreen button, 12 px
up and 29 px tall), 86 px with the drawer's tab strip closed, drawer height + 46 px with it open, and 112 px while a
drawing tool's hint is showing (bottom centre, ~80 px tall). On a tablet (768–1024 px) with the inspector open the key
moves to the left above the compass and is no wider than the map left of the 27rem inspector (at 768 px it ran 12 px
under it). `MapLegend.test.ts` checks these rules in `index.css`.

### 8.1 Every map symbol and its key entry

Each map symbol is listed under the key group that names it, with the code that sets the group (`mapLegend.set(id, …)`).
A group is shown only while its layer is drawn.

| Where it is drawn | Map symbol | Key group → entry | Set by |
|---|---|---|---|
| All 3D workspaces | Road carriageway; lane and centre lines; yellow edge line of a divided road | City model → Road; Lane and centre lines; Edge line of a divided road | `cityLegend.ts` |
| All | Flyover / bridge deck on piers; elevated metro viaduct; double-deck | City model → Flyover or bridge deck; Elevated metro viaduct; Double-deck (road over metro) | `cityLegend.ts` |
| All | Buildings (realistic: one plaster colour; schematic: commercial / industrial / residential) | City model → Building (or the three Building, … entries) | `cityLegend.ts` |
| All | Street tree; streetlight; selected object outline | City model → Street tree; Streetlight; Selected object | `cityLegend.ts` |
| Design, Simulate | Demand zone outline (rose; cyan selected); gateway dot (amber; "(not connected)" label); gateway link (cyan) | Traffic demand inputs (estimated) → Demand zone; Gateway; Gateway link | `TwinCityEngine` `demand` |
| Design (drawing) | Snap markers (road end, onto a road, junction/node); line being drawn; alignment guide | While drawing → five entries | `TwinCityEngine` `design-draw` |
| Design (Connect) | Dashed link Connect would add | Connect preview → Link Connect would add | `TwinCityEngine` `road-gap` |
| Design (Junction tool) | Drawn junction (cyan), selected (amber), not placeable (rose) | Junctions you drew → three entries | `JunctionEditorOverlay.ts` |
| Design (junction edit) | Approach / exit / inside-junction arrows; arm being edited | Junction being edited → four entries | `JunctionHighlight.ts` |
| Design / Simulate (road edit) | Binding stretch; lanes the edit changes | Highlight → Binding stretch; Lanes this edit changes | `RoadHighlight.ts` |
| Design (street design) | Crossing, bus stop, streetlights, trees, roundabout, footpath placeholders | Street elements (placeholders) → one entry per kind shown | `streetDesign/placeholders.ts` |
| Design (Map → Junction points) | T junction, crossroads, 5+ roads, roundabout, dead end dots | Junction points (traffic network) → five entries | `TrafficNetworkVisualizer.ts` |
| Simulate (study) | Studied road glow; downstream / upstream / both-ways roads; junction, roundabout, dead-end dots; enter / leave / both markers; roads crossing without meeting; network error / warning; cut road at the mapped edge | Study area → one entry each | `simLegend.ts` `studyLegend` |
| Simulate (live) | Speed lines (free / slow / stop-and-go / no vehicles); vehicles; signal heads | Live traffic (simulated) → one entry each | `simLegend.ts` `liveLegend` |
| Simulate (overlay: flows) | Share of the road's traffic, none → most | Where its traffic comes from and goes → colour scale | `simLegend.ts` |
| Simulate (overlay: load) | V/C bands; faint under 30 %; worst stretches | How full each road is → scale and entries | `simLegend.ts` |
| Simulate (overlay: why slow) | Studied road; queue traced back; queue start | Why it is slow → three entries | `simLegend.ts` |
| Simulate (overlay: compare) | Less / more loaded; little change; new bottleneck | Proposal against the existing city → four entries | `simLegend.ts` |
| Simulate (study) | Direction arrows, same colour as the panel | Directions of the studied road → one per direction | `simLegend.ts` `directionsLegend` |
| Underground | PMC sewers / storm drains; OSM metro tunnel and station; proposed alignments by kind; utilities by type | Existing records (as published); Metro (OpenStreetMap); Proposed alignments (colour = kind); utilities | `UndergroundLegend.tsx` (also in the panel) |

Not in the key: Environment layers (land cover, trees census, flow paths, air monitors) keep their own legends and
evidence badges in the Environment panel beside their Show buttons; the key there lists only the city model and demand
inputs (see §10). Map labels (zone and gateway names) and the Cesium imagery are not symbols and have no entry.


## 9. Screenshots

All in `/workspace/work/urbanos/shots/p12/` (driver: `/workspace/work/p12-e2e`, 1440×900 unless named).

| File | What it shows |
|---|---|
| `s1-01` … `s1-13` | S1 Satara Road (osm_367660757): study, suggestions, round-trip bar in Design, flyover drawn and built, re-test, compare overlay, "Improve this" signal, test 2 "since last test", badges |
| `s1-14-cancel-question-undo.png` | Cancel with 1 road change (lanes 2 → 3): the question "Undo them and return / Keep them and return / Stay here" |
| `s1-15-cancel-undo-comparison-kept.png` | After "Undo them and return": back in Simulate, lanes 2 again, the comparison (Mixed, medium) shown again and not stale; status "your changes … were undone" |
| `s2-01` … `s2-06` | S2 signal retiming round trip |
| `s3-01` … `s3-10` | S3 Sinhagad Road: no-change Done, outside-area question, widen and re-test, reload resume, cancel question, Keep |
| `p12f-01-flyover-bar-wording.png`, `p12f-02-junction-tool-key-1440.png` | Bar wording after a flyover; key with the Junction tool group |
| `p12k-design-1440.png` | Map key in Design: Junctions you drew, Traffic demand inputs, City model; clear of the fullscreen button |
| `p12k-underground-1440.png` | Map key in Underground: adds Existing records, Metro (OSM), Proposed alignments |
| `p12k-environment-1440.png` | Map key in Environment beside the drawn-works inspector: demand inputs and city model only |
| `p12k-explore-1440.png` | Map key in Explore |
| `p12k-simulate-compare-1440/1366/1024/768.png` | Simulate with a comparison: Directions, Study area, demand, city model; at 1024 and 768 the key sits left above the compass, at 768 narrowed to the map left of the inspector |

## 10. Remaining gaps

- Environment layers (land cover, tree census, flow paths, air monitors) are explained in the Environment panel, not in
  the map key; with a layer shown the key does not list its colours.
- At 768–1024 px with the inspector open only ~240–260 px of map is left; the key (open) covers most of it. It is
  collapsible and remembers that, but there is no automatic collapse at tablet widths.
- The Underground group truncates long entries ("Underground station — depth not m…"); the full text is in the tooltip.
- Flyover drawing in the headless browser needs exact clicks on road ends; the Cancel → Undo check used a lane change.
- An undo that cannot reach the leg's start (history cleared, or edits made outside the undo stack) still leaves those
  changes in the proposal and says so; this is by design, not tested in the browser.
