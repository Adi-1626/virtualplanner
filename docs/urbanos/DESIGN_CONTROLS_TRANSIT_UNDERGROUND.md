# Design controls: transit and underground tools

Scope: the Design palette tools **Metro line, Station, Double-deck, Utility, Tunnel, Demand zone, Gateway**, and their
inspector editors (`frontend/src/components/design/TransitUndergroundEditors.tsx`, wired from `PropertiesPanel.tsx`).
Branch `dr-tools2`, commits 0c5140c, fe6a469 and the follow-ups listed at the end. Unit tests:
`frontend/src/engine/testing/TransitUndergroundTools.test.ts`.

"Verified (browser)" means checked in headless Chromium (SwiftShader) against the running app with Pune data: the
object read back from the engine/back end after the action, plus a screenshot in `/workspace/work/urbanos/shots/design/tr_*.png`.

## Per tool

### Metro line (`draw_metro`)
- **Broken**: inspector Track count, Deck width and Elevation changed the stored object but not the 3D. The generator
  hard-coded a 5 m deck with two rails 3 m apart, and ignored `elevation` whenever vertices carried a height
  (a vertex snapped onto another track's end carried that deck's height, and imported OSM tracks store 12 / -6 m per vertex).
- **Fix**: drawn lines keep their plan on the ground (z = 0); `generateMetroLineMeshes` flattens the plan and uses
  `elevation` alone, `deckWidth` (min 3 m), `trackCount` 1 or 2 with rails at `trackGauge`; no piers when at ground/below.
- **Verified (browser)**: trackCount, deckWidth and elevation changes visibly change the viaduct and persist after
  reload. Unit test: drawn line has z = 0 vertices.

### Station (`place_station`)
- **Broken**: a station was dropped where clicked at a fixed 12 m, only rotated towards the nearest track, so it floated
  beside the viaduct and stayed at 12 m on a 15 m deck.
- **Fix**: `findNearestTrack` now returns the closest centreline point and the deck height (metro line `elevation`, or
  double-deck `metroElevation`). Within 100 m the station is placed on the centreline, takes the track bearing and
  deck height; otherwise it stays where clicked (12 m, north) and a toast says so. Inspector shows the track and offers
  **Move onto the track** when it is off it. Changing a track's height moves the stations sitting on it (≤1 m away).
- **Verified (browser)**: snap to centreline within range, bearing taken, follows line height, "Move onto the track"
  works. Unit tests: within/outside 100 m, double-deck metro deck.
- **Follow-up (this pass)**: the station height follow-up is recorded in the same Undo step as the track height
  change (`HistoryManager.recordUpdates`, coalesced while a slider is dragged). Unit test only; not re-checked in the browser.

### Double-deck (`draw_metro_flyover`)
- **Broken**: Metro deck height slider did nothing (`flyoverFieldUpdates` dropped `metroElevation`); road deck was always
  a 4-lane arterial whatever the Road class setting.
- **Fix**: `metroElevation` is passed through; road deck lanes, divider, footpath and speed come from the Road class
  setting, as for the Flyover tool.
- **Verified (browser)**: metro deck height saved and drawn; station snaps to the metro deck. Unit tests for both.

### Utility (`draw_utility`)
- **Broken**: utility layers are hidden by default, so a freshly drawn line vanished; drawn at a fixed 0.5 m whatever the diameter.
- **Fix**: after drawing, the utility's layer is switched on with a toast; changing the type in the inspector switches on
  the new type's layer (commit 5a2a57c). Drawn at `diameterMm` (top of pipe at `depth`), plan flattened; gas is orange.
  Inspector shows top and bottom of pipe.
- **Verified (browser)**: layer auto-enables after drawing, line drawn at diameter. The type-change layer switch is
  type-checked and linted only, not browser-checked.

### Tunnel (`draw_underground`)
- **Broken**: selecting a tunnel in Design showed a generic panel with no section info and no route to the Underground tools.
- **Fix**: `AlignmentInspector`: to-scale cross-section sketch (crown/invert at the deepest vertex, dashed when the
  section is not measured), the Underground alignment editor, and a **Long-section, sections & conflicts →** button
  that activates the alignment and switches to the Underground workspace.
- **Verified (browser)**: inspector and cross-section render. See "Tunnel → Underground" below for the button.

### Demand zone (`draw_zone`)
- **Broken**: heavy rose fill hid the map; land-use mix sliders wrote `landUseMix`, which nothing reads; a gateways list
  showed `z.gateways`, which nothing fills.
- **Fix**: fill alpha 0.02 (0.06 selected); outline is a densified polyline 1 m above ground; the inspector shows area,
  buildings inside, residents/jobs, and **AM peak leaving / arriving veh/h** computed with the same function Simulate
  uses (`activityEndpoints`, StudyDemand). Land-use sliders and the gateway list removed.
- **Verified (browser)**: AM peak 230 out / 111 in veh/h shown for a test zone, matching Simulate's function. Unit test.
- **Not verified**: the outline being visible on screen in headless Chromium; see "Zone outline in headless Chromium".

### Gateway (`draw_gateway`)
- **Broken**: could snap to a flyover deck node passing above; with the network still loading it said "too far";
  Direction select wrote a field nothing reads; label text was debug-like.
- **Fix**: snaps to the nearest ground node (|z| ≤ 3 m) within the snap radius and toasts the road name and distance;
  clear error while the network loads; Direction removed; label is the name ("(not connected)" when detached).
- **Verified (browser)**: snaps to a Paud Rd node, skips flyover deck nodes. Unit tests for both.

## Zone outline in headless Chromium
See section added below (root-cause investigation).

## Tunnel → Underground
See section added below.

## Not verified / open
- Undo grouping of station follow-up: unit-tested only.
- Utility type change → layer switch: tsc/oxlint only.
