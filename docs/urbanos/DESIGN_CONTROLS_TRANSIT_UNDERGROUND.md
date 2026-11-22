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
  change (`HistoryManager.recordUpdates`, coalesced while a slider is dragged). Verified (browser): Metro line lv3w
  15 → 18 → 19 m by the slider moved Station qc6v to 19 m with **one** undo entry; one Undo put both back to 15 m,
  Redo to 19 m. Unit test too.

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
- **Verified (browser)**: layer auto-enables after drawing, line drawn at diameter. Type change water → sewage
  switched the Sewage layer on (object moved to `sewage_util`).
- **Open**: layer visibility is not part of Undo: undoing that type change puts the line back on the (still hidden)
  water layer, so it disappears until the user turns the layer on.

### Tunnel (`draw_underground`)
- **Broken**: selecting a tunnel in Design showed a generic panel with no section info and no route to the Underground tools.
- **Fix**: `AlignmentInspector`: to-scale cross-section sketch (crown/invert at the deepest vertex, dashed when the
  section is not measured), the Underground alignment editor, and a **Long-section, sections & conflicts →** button
  that activates the alignment and switches to the Underground workspace.
- **Follow-up (this pass)**: the button also opens the Underground bottom drawer on its **Profile** tab (it landed on a
  closed drawer before).
- **Verified (browser)**: inspector and cross-section render; button → Underground workspace, alignment active, Profile
  tab open with its crossings. See "Tunnel → Underground" below.

### Demand zone (`draw_zone`)
- **Broken**: heavy rose fill hid the map; land-use mix sliders wrote `landUseMix`, which nothing reads; a gateways list
  showed `z.gateways`, which nothing fills.
- **Fix**: fill alpha 0.02 (0.06 selected); outline is a densified polyline 1 m above ground; the inspector shows area,
  buildings inside, residents/jobs, and **AM peak leaving / arriving veh/h** computed with the same function Simulate
  uses (`activityEndpoints`, StudyDemand). Land-use sliders and the gateway list removed.
- **Verified (browser)**: AM peak 230 out / 111 in veh/h shown for a test zone, matching Simulate's function. Unit test.
- **Verified (browser, after the base-imagery fix below)**: outline visible at 1.1 km and 10 km
  (`tr2_zone_outline_1100m.png`, `tr2_zone_labels_10km.png`). Zone labels have no `distanceDisplayCondition`, so they
  show at 10 km; no change needed. At 10 km they can overlap a nearby gateway's label (Balewadi) – cosmetic, left.

### Gateway (`draw_gateway`)
- **Broken**: could snap to a flyover deck node passing above; with the network still loading it said "too far";
  Direction select wrote a field nothing reads; label text was debug-like.
- **Fix**: snaps to the nearest ground node (|z| ≤ 3 m) within the snap radius and toasts the road name and distance;
  clear error while the network loads; Direction removed; label is the name ("(not connected)" when detached).
- **Verified (browser)**: snaps to a Paud Rd node, skips flyover deck nodes. Unit tests for both.

## Zone outline (and every ground-draped line) not on screen: root cause

Symptom: the demand-zone outline entity existed (positions, colour, `isShowing` true) but nothing was drawn in
headless Chromium. Investigated in that browser against the built app (backend :8361, static :4561):

1. **Not render requests.** The viewer does not use `requestRenderMode`; it renders continuously.
2. **Not missing GPU support.** WebGL 2 (SwiftShader), `depthTexture` true, `GroundPrimitive.isSupported` and
   `GroundPolylinePrimitive.isSupported` true.
3. **Two separate effects:**
   - *Harness-only:* in this headless setup `requestAnimationFrame` gives 0 frames (3 s with the default render loop:
     0 `postRender` events) and each explicit `viewer.render()` takes ~8 s. Entity geometry is built asynchronously
     (web workers, then several frames to finish), so right after an edit `dataSourceDisplay.ready` was false and *no*
     entity polyline showed, clamped or not. After ~20 explicit renders it was ready and non-clamped entity lines
     (and the zone's 1 m outline) were drawn (`tr2_probe_lines_after_frames.png`). A `PolylineCollection` (synchronous)
     showed at once (`tr2_probe_lines.png`). Real browsers run rAF, so this is test-harness only.
   - *App bug (any browser without base imagery):* even when ready, **clamped** polylines, `GroundPolylinePrimitive`
     and `GroundPrimitive` polygons drew nothing (`tr2_probe_ground.png`). A minimal Cesium page in the *same* browser
     drew all three (`tr2_minimal_cesium_ground.png`), so it was not SwiftShader. In the app the globe had
     `_tilesToRender = 0` and its level-0 tiles stuck in LOADING: the base imagery layer (Cesium ion) had failed with
     HTTP 401, stays `ready = false` with no provider, and Cesium 1.143 keeps every globe tile waiting for it. The globe
     was never drawn (the sky showed between the roads), and ground primitives classify the globe surface, so with no
     surface they show nothing. Removing that layer at runtime made the tiles load and all ground lines/polygons
     appear (`tr2_probe_ground_failed_layer_removed.png`).
- **Fix** (`lib/baseImageryErrors.ts` `dropFailedBaseLayer`, wired in `Viewport3D.tsx`): when the base layer's
  provider fails, it is removed from the imagery collection; the bare globe is drawn in a plain dark colour
  (#12161c) with ground atmosphere off (Cesium's navy base under the atmosphere reads as bright blue water); both are
  restored when the base-layer picker adds another base layer. The existing "No base imagery" notice is unchanged.
  Unit test in `QaSideBAndImagery.test.ts`.
  *Superseded by p8-basemap (2026-11-22)*: the failed layer is now replaced through the base-layer picker by the next
  source (ion → OpenStreetMap → none, `lib/baseMap.ts`), which removes it the same way; the bare ground is a neutral
  grey-beige / muted grey per visual style instead of #12161c. See DEVELOPER_HANDBOOK §4.6 "Base map".
- **Verified (browser)**: after the fix, imagery layers 0, globe drawn, road drawing preview (clamped) and zone outline
  visible (`tr2_road_preview_and_zone_outline.png`). This affects every user without a working ion token or offline:
  saved-area outlines, drawing previews and ground polygons were invisible for them too.
- **Consequence to know**: with the globe drawn, the saved study-area fills (`#0284c7`, alpha 0.12, ground polygons in
  `TwinCityEngine.syncSavedAreasWithCesium`) now show in headless too: the test DB has 1,324 of them
  ("Roads loaded for a study area"), stacked into a solid blue sheet over most of the map. That is the "blue blocks
  like water" issue from the brief (the Study Area work owns that renderer); not changed here.
- The zone outline stays a non-clamped line 1 m above ground (works with or without a drawn globe).

## Tunnel → Underground (long-section, conflict check)

Tunnel "Bored tunnel #eghr" (314 m, crown 16 m, Ø 6 m) near Karve Road, with two drawn utilities nearby.
- **Long-section (Profile)**: 6 model crossings, including **Utility thcm (gas) at ch 202 m, top 3.2 m, bottom 4.1 m below
  ground (hypothetical)**; the water utility does not cross the tunnel in plan, correctly absent. Plus 3 PMC sewer
  crossings (QL-D). Screenshots `tr2_underground_profile_crossings.png`, `tr2_tunnel_button_opens_profile.png`.
- **Conflict check**: needed a planning project (none in the test DB): created "QA Karve tunnel screening (synthetic)"
  in the DB *copy* only. Run: 22 potential conflicts, 2 vertically separated, 1 no-conflict: base roads, OSM / ML
  building footprints, **imported PMC sewer records** (two vertically separated by 14.4 m / 13.7 m), OSM metro layer.
  **Drawn Design utilities are not in the conflict check**: the backend (`backend/coordination/service.py`,
  `run_detection`) checks project elements, base roads, OSM metro, buildings and imported subsurface records only.
  The card says so ("imported utility records"), so it is honest, but a drawn utility shows in the long-section and
  not in the conflict list. Screenshot `tr2_underground_conflict_check.png`.

## Not verified / open
- Drawn utilities in the backend conflict check (above): needs a backend change (add `utility` city objects of the
  project's scenario to `run_detection`) plus tests. Not done.
- Utility layer visibility not restored by Undo (above).
- Backend persistence after the grouped Undo (station + track) not re-read from the API this pass.
- In Underground, the Design inspector stays open on the right next to the Underground profile editor (same alignment
  edited in two places). Works, but redundant.
- The Underground "Subsurface records" card said "No records imported" while PMC sewer/storm-drain datasets are listed
  under it and the check used them (seen in `tr2_underground_conflict_check.png`); not investigated.
- Headless harness: call `viewer.render()` repeatedly (rAF gives no frames) before judging whether an entity draws.
