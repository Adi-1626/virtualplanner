# Underground Mode QA (2026-11-15)

End-user QA of Underground Mode on the `underground-mode` branch (f850937) plus the QA fixes listed below.
Planner-facing guide: [UNDERGROUND_WORKSPACE.md](UNDERGROUND_WORKSPACE.md); screening rules: [UNDERGROUND_CHECKS.md](UNDERGROUND_CHECKS.md).

## How it was tested

- **Build under test:** production `vite build` of this worktree (`VITE_API_BASE` = local backend), served statically; FastAPI backend on a
  **copy** of `backend/twincity.db` (the original was never touched), DEM v3 terrain service, PMC sewer / storm-drain records, local OSM index.
- **Browser:** headless Chromium (SwiftShader WebGL, 1440 × 900) driven by Playwright with **real mouse clicks and key presses** on the
  map and the panels (drawing, selecting, typing depths, Undo / Redo, Delete dialog, PDF / CSV downloads). Programmatic steps are named
  where used (one vertex move, the DOCX request, one fault injection). External tiles were fetched by the harness, not by Chromium.
- **Data:** a study area around Swargate; a proposed bored tunnel (`5yxoc7xan`, 4 vertices, 18–22 m crown); a proposed water pipe
  (`ymozckl84`, 2 vertices, default cover); an existing sewer recorded as QL-C (`9fl9zmwqr`, 450 mm, 3 vertices); one more pipe drawn
  in this round (`xyrg2yqhv`).
- **Headless caveat:** render timings are explicit `viewer.render()` calls in headless SwiftShader (CPU-side submit time). They are not
  real-browser FPS.
- Screenshots: `urbanos/shots/underground/qa-*.png` (outside the repo).

## Results by workflow

Workflows A, B and the first part of C were run by the earlier QA session (screenshots `qa-A00`–`qa-A10`, `qa-B01`–`qa-B04`,
`qa-C01`, `qa-C02`) and were not re-run here. Its fixes are in 85573ea.

### C. Lay and edit a pipe (re-run on the fixed build)

| Check | Result | Screenshot |
|---|---|---|
| Selecting a pipe from the list draws the white selected highlight (surface trace white, buried line kept) | Pass (was broken before 0fe3a25) | qa-C03-pipe-selected-highlight |
| Typing a depth (2.8 → 4.5 m at point 2) moves the buried line at once (entity −3.02 → −4.72 m); Undo and Redo redraw it (3,342 changed pixels between the two renders) | Pass | qa-C04-pipe-depth-4p5-tilted, qa-C05-pipe-depth-undo-tilted |
| Moving a vertex redraws the surface trace and the buried line; Undo puts both back. The vertex move was programmatic (history + update): there is no vertex drag for drawn utilities in any workspace | Pass (redraw); the drag tool does not exist | qa-C07a-pipe-trace-before, qa-C07-pipe-trace-moved |
| QL-C existing pipe: switching evidence relabels its depths Hypothetical → Estimated | Pass (after 7dcf9de) | qa-C06-pipe-ql-c-estimated |
| "Lay another pipe or cable" → draw 3 points → the drawing ends, the new pipe is selected, 1 m default cover is labelled "default — adjust", diameter Unknown | Pass | qa-C08-pipe-laid-via-lay-another |
| With a pipe selected, the left panel shows "Selected · Utility …" instead of the tunnel editor | Pass (after 7dcf9de) | qa-C04, qa-C08 |

### D. Check conflicts

| Check | Result | Screenshot |
|---|---|---|
| Button count = proposals by status: "Check 3 proposed objects" (tunnel + 2 proposed pipes; the existing QL-C sewer is not counted). Also 2 before the third pipe and 4 with the remote pipe in E | Pass | qa-D01-check-results |
| Banner "Automated screening — not an engineering assessment" above the button and on every report | Pass | qa-D01 |
| Statuses are Requires investigation (13) / Insufficient data (26) / Potential conflict / Verified. The panel, PDF and CSV never say safe, feasible, passed, compliant, construction-ready or "no conflict". "pass" appears only as "This is not a pass" and "near passes" (geometry) | Pass | qa-D01, qa-D02-finding-open |
| A finding opens in five parts (checked, data used, found, not checked, next); the Metro 20 m zone is flagged as a permission trigger, not a clearance | Pass | qa-D02-finding-open |
| Data-gap groups: storm drains with no depth (7), sewer levels with no datum (6), foundations unknown, Design levels with no datum, no water, power, gas or telecom records | Pass | qa-D01 |
| PDF (13 pages, 76 KB, 1.6 s), CSV (39 findings, 0.3 s), both downloaded through the UI. DOCX works through the API (200, 45 KB, 0.55 s, valid zip) but **has no button** | Pass; DOCX not in the UI | — |
| Saved run: after a reload, "Last saved check …" comes back (`runs/latest` 80–100 ms) and is not stale | Pass | qa-D03-reload-restored |
| Stale: editing a depth shows "Stale — Objects were edited after this check" at once; after another reload the server reports "Objects in this alternative changed since this check" | Pass | qa-D04-stale-after-edit, qa-D05-reload-stale-from-server |
| Timing: `POST /underground/screen` 876 ms median, 2.4 s max (5 runs; 3 proposals, 607 records in the area); 1.1–1.4 s from click to results in the UI | Pass | — |

### E. Error recovery

| Check | Result | Screenshot |
|---|---|---|
| Backend stopped → "The check could not run: Failed to fetch"; earlier results stay with their Stale marker; records show "Could not load records … UNKNOWN until this loads. Retry"; no crash | Pass (wording could be friendlier) | qa-E01-backend-down |
| Backend restarted → Retry and Check again work (1.1 s) | Pass | — |
| Injected HTTP 500 on `/underground/screen` → "The check could not run: 500: QA injected failure"; the next check works | Pass | qa-E02-injected-500 |
| Empty area (a pipe drawn about 16 km west, outside the records): only Insufficient data (2). Checklist says "nothing found in the available data" and "no water, power, gas or telecom records in this area", never "clear" | Pass | qa-E03-empty-area-pipe-check |
| Undo of the remote pipe's draw removes it (and from the DB copy) | Pass | — |
| Delete `ymozckl84` (Delete → confirm dialog) → gone from the list, the map (0 entities) and the DB; Undo brings it back with its depths (2.2 / 1.0 m); Redo deletes it again; Undo restores it | Pass | qa-E04-pipe-deleted, qa-E05-pipe-delete-undone |

### F. Design regression (after leaving Underground)

| Check | Result | Screenshot |
|---|---|---|
| Underground layers (cutaway, records, buried lines) are hidden in Design; drawn utilities show as Design lines | Pass | qa-F01-design-after-underground |
| Draw a road (2 clicks + double-click): 18,273 → 18,274 roads, split at existing junctions | Pass | qa-F02-design-road-drawn-selected |
| Select the road with a click, change the forward lanes 2 → 3 in the inspector (lanes 2 → 4, width 10 → 17 m); Undo restores it; Undo / Redo of the draw works | Pass | qa-F03-design-road-edited |
| Study area tool (polygon, 4 clicks): "Study area 4", 0.3 km², 104 new objects loaded, summary with ESTIMATED badge; Done returns to Select | Pass | qa-F04-design-study-area |
| Layers: Design "Junction points" on/off; Explore Buildings layer off/on (LayerManager true → false → true) | Pass | qa-F05-design-layer-toggle |

### G. Imported metro tunnel (fix d)

| Check | Result | Screenshot |
|---|---|---|
| Clicking the OSM metro tunnel (Purple Line, tunnel=yes) shows Tracks "Not mapped" and Tunnel width "Not mapped" as read-only; no Tracks / Deck width inputs | Pass (after 7dcf9de) | qa-G01-osm-metro-tunnel-readonly |

## Console, errors, timings

- **Console errors:** 0 unexpected. All were caused on purpose: 3 × `ERR_CONNECTION_REFUSED` with the backend stopped and 1 × HTTP 500
  injected by the harness. Cesium ion 401 (no token) is filtered and handled by the "No base imagery" notice.
- **5xx responses:** 1, the injected one. The backend log has 0 real 5xx.
- **API timings (browser `responseEnd`, ms, median / max, n):** `GET /api/objects` 2474 / 2557 (2, full load); `POST …/underground/screen`
  876 / 2374 (5); `POST …/screen/report` 544 / 1504 (3); `GET …/subsurface/records` 461 / 3835 (5; the max is the 4,000-record box in
  E); `POST /api/objects` 642 / 963 (37); `POST …/runs/latest` 90 / 100 (2); `POST /api/terrain/profile` 87 / 276 (5);
  `GET …/subsurface/datasets` 85 / 99 (5). Page reload to an interactive map: 4.7 s.
- **Headless render medians (SwiftShader, explicit `viewer.render()`, 15 frames; not real-browser FPS):** Design top-down 7.2 ms (p90
  8.8), 201 primitives, 645 entities. Underground top-down 4.1 ms (p90 6.9), 201 primitives, 647 entities. Underground tilted at 120 m
  13.8 ms (p90 101), 546 primitives.

## Bugs found and fixed in this round

| Bug | Fix | Commit |
|---|---|---|
| Selected-pipe white highlight and trace / depth edits never redrew: entities were removed while Cesium events were suspended, and re-adding the same id cancelled the removal, so the visualizer kept the old entity | Clear before `suspendEvents()` in all four UndergroundRenderer collections | 0fe3a25 |
| No way to add a second utility once one existed | "Lay another pipe or cable" button | 0fe3a25 |
| Legend had no abandoned or "metro, depth not mapped" entries; "Existing (records)" was wrong for drawn existing pipes | Legend entries: Existing, Abandoned in place, Metro depth not mapped | 0fe3a25 |
| Profile / Cross-section hover said "top -12.0 m" for a roof | `fmtDepth`: "x m above ground / at ground / x m below ground / Unknown" | 0fe3a25 |
| (a) The tunnel editor stayed in the left panel while a pipe was selected, so two editors showed at once | A selected drawn utility replaces the alignment editor with a short note pointing to the inspector | 7dcf9de |
| (b) An existing QL-C pipe showed its depths as Hypothetical | Changing the evidence relabels depths that still carry the old evidence's usual certainty (QL-A → Measured; QL-B/C/D → Estimated; user-drawn → Hypothetical). Hand-set certainties and typical-cover defaults are kept. Unit test added | 7dcf9de |
| (c) `municipalOverlay.ts` used the same suspend-then-clear pattern (same bug: on a camera move, features with the same id kept the old entity) | Clear before suspending | 7dcf9de |
| (d) The OSM metro tunnel showed Tracks / Deck width as editable | Read-only rows ("Not mapped", or the OSM `tracks` tag) for imported metro tunnels | 7dcf9de |

The screening engine was not changed.

## Open issues

1. **Faint record lines under the 35% ground:** PMC sewer and storm-drain lines are hard to see through the default 35% ground. X-ray
   or a lower opacity helps.
2. **The station centre can't be clicked:** an underground station is picked only by its outline or label, not its middle.
3. **Unhelpful default names:** "Utility ymoz", "Bored tunnel #5yxo" and "Road sdvl" do not say what or where an object is
   (better: "Water main, Shankarshet Rd").
4. **The engine's blue utility line is drawn on top:** the Design / engine polyline for a drawn utility shows above the Underground
   rendering (qa-C03 / qa-C07), so a pipe appears twice in plan.
5. **Not measured:** real-browser FPS (GPU), and the live public Overpass API (local OSM index used).
6. **3D ground vs the Profile:** the 3D scene ground is the flat ellipsoid (no terrain service in 3D), while the Profile and editor use
   the DSM. Depths below ground agree, but elevations differ between the two views. The panel discloses this.
7. **No vertex drag for drawn utilities** (or tunnels) on the map. A trace can only be redrawn. Only zones and in-progress drawings
   have drag handles.
8. **No DOCX button:** the API makes DOCX but the panel offers only PDF and CSV.
9. **Summary and badges count different things:** the summary sentence counts all proposals ("13 … 26"), while the status badges
   follow "Show findings for", which defaults to the active tunnel (7 / 16). This can read as a contradiction.
10. **Records area is a box, not a buffer:** "Within 250 m of your alignments" is the box around all objects plus 250 m. One far
    pipe (E) stretched it to 4,000 records (the draw cap) and 3.8 s.
11. **Raw error text:** "Failed to fetch" is shown as-is. A plain "server could not be reached" would be clearer, and the header still
    said "Online" with the backend down.
12. **Existing data isn't migrated:** pipes saved as QL-C before 7dcf9de keep Hypothetical depths until their evidence is changed again.
13. **Report file names use the server's UTC clock** (`…-1425.pdf` for 19:55 IST). The report body shows both IST and UTC.

## Final end-user pass (2026-11-21, headless Chromium, DB copy, real clicks)

Branch `underground-final` (from c09d91a). All timings and visuals are headless; real Windows Chrome was not measured.

**Passed:** pick area and "See existing records"; draw a tunnel (3 clicks) and a water pipe (2 clicks); typed depths and diameter; Undo/Redo; blank depth stored as Unknown (never 0); Check conflicts with five-part finding detail and gap groups; Look from below (labels capped at 1.2 km near/below ground, no horizon pile-up); Back to surface; Cross-section tab; PDF (6 pages), DOCX and CSV downloads via the buttons (no imported-metro duplicate, no forbidden words); reload keeps depths, diameter and last saved check; backend down shows "Offline" with a plain message.

**Found and fixed:** "unknown to unknown" in findings (now "depth unknown"); imported OSM metro tunnel screened as "Elevated metro (drawn)" and counted twice (Design copy + OSM-index copy are one asset); double full stop in the records error text; study-area import wrote an invented −6 m for metro tunnels (now level 0 with `tunnel=yes`; old −6 m objects still recognised); PMC records stayed visible in Design (now Underground only); "Show drawn utilities" missed the full-size pipe models; summary sentence count now matches the badges; DOCX report button added; report file names in IST.

**Noted, not changed:** the Purple Line gives two findings for two separate OSM ways; the metro NOC rule shows "[notice UNVERIFIED]" (honest label from the screening config); the 4th click of the polygon study-area tool did not register in the headless harness (harness quirk, not investigated).

**Moved:** vertex drag on drawn tunnels/utilities is not implemented here; it is part of the geometry editor work (`GEOMETRY_EDITOR_DESIGN.md`, Phase 2 reshape editor).

**Not re-checked in this pass:** deeper Environment/Simulate behaviour after switching (only record visibility and globe state); backend restart recovery; "depth unknown" wording in a fresh report from the new backend (covered by pytest).
