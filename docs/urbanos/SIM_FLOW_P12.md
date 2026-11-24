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

(Symbol table: see §8.1 below.)

## 9. Screenshots

(see §9 list below)

## 10. Remaining gaps

(see below)
