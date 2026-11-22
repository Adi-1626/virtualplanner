# Geometry editor — curved, editable alignments in Design (research + design, 2026-11-21)

Status: written as a design (branch `design-geometry`, from `next-phase` c09d91a); phases 1–2 were built later. What changed in branch `p5-geomfin` (grade-driven flyover ramps, elevation while drawing, delete takes back added vertices, utility depth controls) is in §11.

User request (2026-11-21): *"lets add better turning / curving of the items that need them in build mode currently we just draw them via line but we can turn, curve, angle them at any point we want while in build nor after build … realistic and usable, the current one feels using ms paint".*

Items covered: roads, flyovers, double-decks (road + metro), elevated metro lines, underground alignments (tunnels, underground metro, cut-and-cover, utility trunks, storm drains) and utility lines. Underground uses the same drawing code. Polygons (buildings, demand zones, study areas) are out of scope apart from the shared angle snap.

Labels used here: **[read]** = taken from a source I opened and read by code in this session (file and line given). **[known]** = general product knowledge, not re-opened in this session (verify before quoting it to users). **[proposed]** = this design's choice.

---

## 1. Audit: how geometry is drawn, stored, edited and used today

### 1.1 Drawing (Design tools)
- Tools: `frontend/src/components/tools.ts` (13 tools), palette `components/design/ToolPalette.tsx`, per-tool settings `components/design/ToolSettings.tsx`.
- Modes: `EditingMode` in `engine/editing/EditingEngine.ts:80`. Clicked points go into `drawingPoints: [lon,lat,z][]` (`addDrawingPoint`, l.223). That function snaps to network points (`SnapManager`) and ignores a repeated point from a double-click.
- Input: `TwinCityEngine.setupInteraction()` (`engine/TwinCityEngine.ts:544`). LEFT_CLICK adds a point. DOUBLE_CLICK or Enter (`useKeyboardShortcuts` → `finishDrawing`) finishes. Esc cancels the whole drawing.
- Preview: `updateSnapPreview` (l.~1290) draws a snap reticle and a dashed rubber band from the last point. `updateDrawPreview` (l.1386) draws the polyline.
- **What is missing (the "MS Paint" feel):**
  - Every object is a straight-segment polyline. There is no curve, fillet, arc or spiral anywhere in the code. A grep for bezier, fillet, spline or clothoid finds nothing in the drawing or geometry code.
  - There is no angle snap, ortho mode, tangent continuation, typed length or angle, or live length, bearing or deflection readout.
  - Vertex handles exist **only for the study-area outline** (`draw_point_*` and `draw_mid_*`, l.1408–1432). For roads and the other line tools you cannot drag, insert or delete a point while drawing. Right-click delete only works on `draw_point_*`.
  - Backspace and Ctrl+Z while drawing do not remove the last point. Ctrl+Z is the global history undo.
  - Snap radii are fixed in degrees (`SnapManager.ts:34–36`, 0.00015° ≈ 16 m vertex, 0.0001° ≈ 11 m edge), whatever the zoom. Zoomed in they grab too far; zoomed out they barely grab.

### 1.2 Storage
- One object model for everything: `engine/objects/types.ts`. Line objects store `coordinates: [lon,lat,z][]`.
- Backend: `city_objects.geometry_geojson` stores the coordinates as JSON. Every other field goes into `properties_json` as **free JSON** (`backend/models/models.py`, `api/router.py:22 CityObjectSchema{coordinates: List[Any], properties: Dict}`). Scenario changes (`scenario_object_changes`) and versions use the same pair.
  ⇒ **A new `alignment` field needs no schema change and no migration on the server.** It travels in `properties`.

### 1.3 Editing after drawing
- **Roads, flyovers, metro lines, tunnels, utilities: no geometry editing at all.** You can only edit properties in the inspector (lanes, speed, depth per vertex, section …). The only way to reshape is to delete and redraw.
- Demand zones: vertex drag (`edit_zone_point_*`, `commitZoneDrag` l.1129). It previews per frame and saves one history step on release. This is the pattern to reuse.
- Study area: vertex drag, midpoint-insert, right-click delete while drawing or redrawing.
- Undo/redo: `engine/history/HistoryManager.ts`. Diffs are `add`, `update(before, after)`, `delete` and `batch`, plus `recordUpdate(s)` with a coalesce key. A whole-object before/after means any new field (`alignment`) is undone for free.

### 1.4 Consumers of `coordinates`: what breaks if geometry stops being a plain polyline
| Consumer | File | How it uses geometry | Impact if `coordinates` became curves (it must not) |
|---|---|---|---|
| Road finalize pipeline | `EditingEngine.finalizeDrawing` (l.648), `joinedToNetwork`, `insertJunctionIntoIntersectedRoads` (l.350), `reconstructCrossings` (l.404) | Snaps ends to network vertices, **inserts crossing vertices into the new road AND into the roads it crosses**, flags uncertain level crossings | Must run on the densified polyline. Must run again after every geometry edit |
| Traffic graph | `simulation/TrafficNetworkBuilder.ts` (l.483–590) | Splits a road's polyline only at junctions/crossings; intermediate vertices are shape points; edge length = polyline length; approach heading = last two vertices (l.632) | Densified curves: correct arc length and tangent headings. **The node count does not grow.** The pairwise segment crossing test costs more as vertices grow (see risks) |
| Road sections | `objects/roadSections.ts` (`startNodeIndex/endNodeIndex` index **vertices**), `ObjectManager.update` → `remapRoadSections` (l.645) | Lane/carriageway profile per vertex range | Indices change when the polyline is regenerated. Remap by chainage |
| Flyover / double-deck 3D | `objects/flyoverHelper.ts applyFlyoverElevationProfile` (called in `ObjectManager.add/update`) | **Resamples to 10 m** and writes ramp heights into `coordinates[i][2]`; keeps `groundCoordinates` | Already densifies. Vertical profile is a fixed **40 m ramp** (see 1.5). Regeneration must reset `groundCoordinates` |
| Bridge desk check | `simulation/BridgeFeasibilityEngine.ts` | Ramp length required = elevation / 5 % ("IRC:SP-73"), approach roads near ends, piers mid-span | Uses the polyline. Unaffected. The grade constant should follow §2.2 |
| Level crossings | `editing/levelCrossings.ts` `LevelCrossing{point,…}` | Keyed by plan **point**, not index | After a reshape, re-match by distance (≤2 m) to keep the user's decisions |
| Underground depths | `UndergroundAlignmentObject.depths[]`, `UtilityObject.depths[]` — **one entry per vertex, same order** (`types.ts`) | Profile, cross-section, renderer, hover, form table per vertex (`underground/alignmentGeometry.ts`, `utilityModel.ts`, `terrainProfile.ts`, `components/underground/AlignmentForms.tsx`, `UtilityForms.tsx`, `ElevationProfile.tsx`, `UndergroundRenderer.ts`, `ProceduralGeometryGenerator.ts:2371`) | **Biggest risk.** Densifying would turn a 3-row depth table into 60 rows and invent typed values. Typed depths must move to control points; per-vertex `depths` become derived (§3.4) |
| Backend screening / coordination | `backend/coordination/service.py` (l.58–143), `screening.py` (l.263–386 reads `depths[i]` by vertex) | Reads stored `coordinates` + `properties.depths` | Unaffected **if** `coordinates` and the per-vertex `depths` stay as derived output |
| Feasibility / site assessment | `engine/feasibility/{proposal,siteAssessment,geometry}.ts` | Polyline buffers | Unaffected |
| Station snapping | `objects/stationAlignment.ts findNearestTrack` | Nearest metro segment + bearing | Better on a densified curve (tangent bearing) |
| Renderers | `rendering/geometry/ProceduralGeometryGenerator.ts` (roads, decks l.975/1231/1350/1442), `UndergroundRenderer`, highlights | Offsets / extrudes polylines | Unaffected. Fine densification also removes the sharp-corner mitre spikes |
| Study area summary, snapping, gateway, road gaps | `studyAreaSummary.ts`, `SnapManager`, `roadGaps.ts` (inserts vertex, shifts section indices l.155) | Polyline vertices | Unaffected (derived polyline) |

**Conclusion:** every consumer reads `coordinates` as a polyline, and several also index per-vertex arrays (sections, depths, flyover ground coordinates). So the design keeps `coordinates` as a **derived densified polyline**. It adds the editable parameters as a new field, and remaps per-vertex arrays **by chainage** whenever the polyline is regenerated.

### 1.5 Vertical-geometry findings found during the audit (not asked, but they bear on flyovers and tunnels)
- The flyover 3D profile rises over a fixed **40 m** ramp to the 6 m deck (`flyoverHelper.ts`, `rampLength = 40.0`). That is a **15 % grade**.
- The desk check in the same app says a ramp needs `elevation / 5 %` = 120 m.
- IRC:SP:90-2010 §6.14 caps grade-separator gradients at **3.5 %** [read] (6 m / 3.5 % ≈ 171 m).
- So the drawn model, the check and the standard disagree. The 5 % constant cites "IRC:SP-73", which is a two-laning manual rather than the grade-separator manual. Fix it in the vertical phase (§7, phase 3) and do not quietly change existing objects (decision D5).
- **Resolved (p5-geomfin, §11.1):** the check uses 4 % / 3.3 % (IRC:SP:90-2023 §4.13, D5) and the 3D ramp is built from the same profile; as-built flyovers keep the 40 m ramp.

---

## 2. Research

### 2.1 How professional tools model and edit alignments [known]
- **Autodesk Civil 3D horizontal alignments** are a chain of **tangents, circular curves and spirals (clothoids)**, laid out "by PI" (points of intersection) with curve and spiral parameters at each PI. Fixed / floating / free elements carry the constraints. Grips: a triangular **PI grip** moves the PI and keeps the curve tangent; circular **pass-through grips** sit on curves; a **radius grip** changes R. Layout Tools insert/delete a PI and add a curve between tangents. **Design criteria** (minimum radius and transition length per design speed and superelevation table) show a **warning symbol** on elements that break them. Those warnings are flags, not approval. (Autodesk Civil 3D Help: "About Alignments", "Alignment Grip Edits", "Design Criteria" — help.autodesk.com/view/CIV3D.)
- **Bentley OpenRoads Designer** uses civil geometry rules: "Complex by PI" with radius and transition per PI, rule-based edits, and a design standards toolbar that flags a radius below the minimum for the chosen speed.
- **Vertical alignment** in both tools is **PVIs** (points of vertical intersection) with grades between them and **parabolic vertical curves** (length or K = L/A) at each PVI.
- **Web map editors.** Mapbox GL Draw `direct_select` gives vertex and midpoint handles but no curves (github.com/mapbox/mapbox-gl-draw, docs/API.md). Esri ArcGIS JS `SketchViewModel` reshape: drag a vertex, insert at a midpoint, delete a vertex. Its snapping options include feature snapping and self-snapping to right angles / parallel lines, with tooltips and typed length/direction input (developers.arcgis.com, SketchViewModel, SnappingOptions). CesiumJS has no built-in editor: the samples build handles from entities and `CallbackProperty` for live preview. That matches what TwinCityEngine already does.
- What to take from them:
  1. **PI + radius** is the editable representation (not free Béziers). Engineers think in tangents, deflections and radii, and the standards are written in radii.
  2. Separate **grips** for PI, radius and insert.
  3. **Live dimension readout** and typed values.
  4. **Design-criteria flags**, which are never approval.
  5. Densified geometry for display.

### 2.2 Indian standards and project values [read]
Source files (downloaded and text-extracted by code, kept internally only): `/workspace/projects/9a2e71ab-c310-4b58-b434-419a1f7ffeae/work/geometry-refs/` — IRC:86-1983, IRC:73-1980 (1990 reprint), IRC:38-1988, IRC:SP:23-1993, IRC:SP:90-2010 (from law.resource.org/pub/in/bis/irc/), Pune Metro Swargate–Katraj Revised Final DPR (punemetrorail.org).

**Urban roads — IRC:86-1983** (Geometric design standards for urban roads in plains)
- Table 1 design speeds: **Arterial 80, Sub-arterial 60, Collector 50, Local 30 km/h**. Lower values in the central business area, higher in suburbs (§4.1–4.3; `irc.086.1983.txt` l.479–500). IRC:SP:90 §6.10 repeats the table.
- §10.1: curves should be "a circular portion flanked by spiral transitions at both ends".
- §10.2.1: superelevation e = V²/225R, **limited to 7 %; desirably 4 % on urban sections with frequent intersections**.
- §10.3: R_min = V²/(127(e+f)), f = 0.15. **Table 10 minimum radii (m):**

  | V (km/h) | e = 7 % | e = 4 % |
  |---|---|---|
  | 30 | 30 | 40 |
  | 50 | 90 | 105 |
  | 60 | 130 | 150 |
  | 80 | 230 | 265 |

  (l.1141–1180. The formula reproduces the table: 80 km/h, 7 % → 229 m.)
- §10.5.2 minimum transition length = larger of **Ls = 0.0215 V³ / (C R)**, with C = 80/(75+V) bounded 0.5–0.8, and **Ls = 2.7 V² / R** (rate of change of superelevation 1 in 150, e = 7 %). Table 11 gives values, for example 80 km/h: R 250 → 85 m, R 400 → 55 m, R 1000 → 30 m. Small curves are "NR" (transition not required) (l.1205–1307).
- §9 Table 8 safe stopping sight distance: 30→30, 50→60, 60→80, 80→120 m.
- §11.2 gradient: **4 % maximum for urban roads**, 2 % desirable with slow traffic. Table 13 minimum gradient 0.5 % desirable / 0.3 % absolute on kerbed pavements.
- §11.3 Table 14 vertical curves: max grade change with no curve / min length: 30 km/h 1.5 % / 15 m; 50: 1.0 % / 30 m; 60: 0.8 % / 40 m; 80: 0.6 % / 50 m.
- §11.4 summit curves are square parabolas sized for stopping sight distance. §11.5 valley curves are sized for headlight distance, or 0.5 g comfort where lit.

**Rural highways — IRC:73-1980.** Same R = V²/127(e+f), f = 0.15. Max superelevation 7 % in plain/rolling terrain (l.1447). Table 19 gradients plain/rolling: ruling 3.3 %, limiting 5 %, exceptional 6.7 % (l.2032–2044). **Table 16 (ruling / absolute minimum radii) is a rotated scan and OCR failed, so it was not read.** For the `highway` class this design uses the formula, labelled "computed from IRC:73 formula" (100 km/h, e = 7 % → 358 m), not a table value.

**Horizontal curve design — IRC:38-1988** (design tables for circular and transition curves). Downloaded. It is a 417-page scan with almost no text layer and was not OCR'd (speed rule). IRC:SP:90 §6.16 points to it for the design of horizontal curves on grade separators. Clothoid formulas (§3.3) are the standard ones in it [known].

**Grade separators / flyovers — IRC:SP:90-2010.** §6.13.2 superelevation ≤ 7 %, 4 % on urban sections with frequent intersections. **§6.14 gradient "in any case greater than 3.5 percent should not be provided"**. §6.15 vertical curves per IRC:SP:23. §6.16 circular curves with spiral transitions, design per IRC:38. §6.18 minimum radius at right-angle T-junctions 9 m. §9.1 approaches need ≥ 15 m straight at each end of a straight stilted portion (`irc.sp.090.2010.txt` l.2221–2360, 3100–3120).

**Vertical curves — IRC:SP:23-1993.** Table 4 sight distances, Table 7 minimum vertical-curve lengths (adds 40 km/h 1.2 % / 20 m and 100 km/h 0.5 % / 60 m to IRC:86 Table 14). Summit/valley curves are square parabolas. Valley comfort ≤ 0.3 m/s² radial acceleration (l.560–1255). Summit length for stopping sight distance when L > S: L = N S² / 4.4 (eye 1.2 m, object 0.15 m). The OCR of the formula line is garbled; the constant follows from (√(2·1.2)+√(2·0.15))² = 4.4.

**Metro — Pune Metro Swargate–Katraj Revised Final DPR (21-12-2022), underground section** (`pune_sk_dpr.txt` l.1628–1680). These are **project design values, not a national code**:
- Max design speed 90 km/h.
- Minimum radius in running track: **limiting 120 m, preferential 225 m**. Absolute minimum **120 m, 200 m in TBM section**.
- **Minimum curve radius at stations 1000 m**. Cant 125 / 110 mm, cant deficiency 100 / 85 mm.
- Gradient desirable max **3 %, 4 % where unavoidable**. Tunnel minimum 0.5 % desirable / 0.25 % absolute. Stations ≤ 0.2 %.
- Vertical curve radius 2500 m desirable / **1500 m absolute**. Constant grade between vertical curves ≥ 50 m desirable / 25 m absolute.
- §5.2.5 transitions: length 0.44 × (cant or deficiency, mm) minimum, 0.72 × desirable. No transition/vertical-curve overlap. Curve between transitions ≥ 25 m.
- **Not found**: RDSO or MoHUA national metro minimum radii, and elevated-section values (the DPR table is for the underground section). For elevated metro, the screen uses the same 120 / 225 m, labelled "project value (Pune S–K DPR, underground section), elevated not stated".

**Utilities.** No public Indian minimum bend radius was found for the drawn utility types. Utilities get angled bends with a deflection readout and **no radius check** (unknown is never shown as a pass).

### 2.3 Snapping and constraints (what users expect from CAD/GIS) [known + proposed]
- **Angle snap**: hold Shift to snap the new segment's bearing to 15° steps. 45° and 90° fall out of that.
- **Relative angle**: Alt+Shift snaps the deflection from the previous tangent in 15° steps, so 0° is "continue straight".
- **Tangent continuation**: when a line starts on the end of an existing road, offer the road's end bearing as a guide line. A PI that lands within 8 px of the guide sits exactly on it, so the new line continues smoothly.
- **Perpendicular / along-edge guides** at an edge snap.
- **Typed length**: digits while drawing set the length of the current segment, and Tab switches to the bearing. This is the Esri/AutoCAD "dynamic input" pattern.
- **Snap tolerance in screen pixels** (about 10 px), converted to metres from the camera height, replacing the fixed-degree radii.

---

## 3. Chosen model [proposed]

### 3.1 New field on line objects (additive, stored in `properties`)
```ts
// engine/geometry/alignment/types.ts
export type CurveBehaviour = 'curved' | 'angled';      // angled = PIs only, radius always 0
export interface AlignmentPI {
  lon: number; lat: number;
  radiusM: number;          // 0 = sharp angle point (no curve). Ignored at the two end PIs.
  spiralInM?: number;       // phase 3; absent = 0 (pure circular)
  spiralOutM?: number;
  radiusSource?: 'auto' | 'user';   // auto = the auto-fillet value; user = typed or dragged
}
export interface HorizontalAlignment {
  v: 1;
  behaviour: CurveBehaviour;
  pis: AlignmentPI[];               // ≥ 2; first and last are the start/end points
  designSpeedKmh: number | null;    // null = not set → checks say "no design speed set"
  designSpeedSource: 'class-default' | 'user';
  eMax: 0.04 | 0.07;                // superelevation cap used by the screen (IRC:86 §10.2.1)
  criteria: 'irc86-urban' | 'irc73-rural' | 'metro-pune-sk-dpr' | 'none';
}
// On RoadObject, FlyoverObject, MetroFlyoverObject, MetroLineObject, UndergroundAlignmentObject, UtilityObject:
alignment?: HorizontalAlignment;    // absent = legacy polyline (unchanged behaviour)
```
`coordinates` stays and is always **derived**:
`coordinates = pipeline(densify(alignment))`. The pipeline is what `finalizeDrawing` already does for the type: `joinedToNetwork` end snaps, crossing insertion, flyover profile, z = 0 on the ground. Objects without `alignment` behave exactly as today.

### 3.2 Geometry (pure functions, local plane)
- Project with the existing equirectangular `projectorFor/toXY/toLonLat` (`underground/alignmentGeometry.ts:56`). The error is negligible over a city-scale object.
- For each interior PI i: deflection Δ (signed), tangent length **T = R·tan(Δ/2)**, arc length **L = R·Δ**. TC and CT sit on the incoming and outgoing tangents at distance T from the PI.
- **Fit rule.** On each tangent, T(i) + T(i+1) ≤ the PI-to-PI distance (later with spirals: + Ls/2 terms). If a typed or dragged R does not fit, clamp to the largest R that fits. Show "radius reduced to 84 m to fit between points" and keep `radiusSource:'user'` with the requested value in the readout, so the user knows.
- Δ < 0.5° → no curve (straight through). Δ ≥ 179° → refuse (a U-turn needs two PIs).
- **Densify**: arcs with chord sagitta ≤ 0.10 m (step s = √(8·R·0.10)), capped at 10 m per step; tangents keep only their end points. Examples: R 300 m, Δ 90° → 48 vertices; R 30 m, Δ 90° → 20 vertices.
- **Spirals (phase 3)**: clothoid, A² = R·Ls. Shift p ≈ Ls²/24R, k ≈ Ls/2, T = (R+p)·tan(Δ/2) + k. Points by the Fresnel series. Default Ls is IRC:86 §10.5.2, or the metro DPR rule.
- **Chainage helpers**: `stationOf(vertex)`, `pointAt(ch)`, `tangentAt(ch)`, `curveElements()` (a table of tangent/arc/spiral with start/end chainage, R, Δ, L) for the panel, checks and remaps.

### 3.3 Auto-fillet while drawing
Every new interior PI of a `curved` object gets an automatic radius `R_auto`:
- `R_auto = max(R_min(design speed, eMax), …)`, clamped by the fit rule.
- If even R_min does not fit (points too close for the speed), use the largest that fits and flag it. Example: a local road at 30 km/h uses R ≥ 40 m (4 %); an arterial at 80 km/h uses ≥ 265 m.
- The user can turn auto-fillet off (toolbar toggle, or hold Ctrl while clicking) for a sharp angle point, or type R.

### 3.4 Per-vertex data becomes control-based (underground, utilities, sections)
- **Underground and utility depths.** Typed depths become **control depths at PIs** (`depthControls[]`, one per PI, same structure as today's `UndergroundVertexDepth` / `UtilityVertexDepth`).
  - The per-vertex `depths[]` array stays but is **derived**: linear interpolation by chainage between the controls. That is exactly what the profile, renderer and screening already assume between vertices.
  - Derived entries carry `derived: true` and certainty = the worse of the two bracketing controls. An unknown neighbour gives unknown, never zero.
  - The backend keeps reading `depths[i]` per vertex without a change. The depth table in `AlignmentForms` / `UtilityForms` lists **PIs**, not densified vertices.
- **Road sections.** Regeneration calls `remapRoadSections` with chainage-based anchors (a new `originalIndices` from chainage), not coordinate equality.
- **Flyover `groundCoordinates`.** Reset on regeneration so `applyFlyoverElevationProfile` rebuilds them (today it rebuilds only if the length differs).
- **Level crossings.** After the pipeline re-runs, keep a previous decision when a new crossing lies ≤ 2 m from the old point with the same other road. Otherwise the crossing is new and unconfirmed.

### 3.5 Migration of existing objects (lazy, lossless)
- Nothing is rewritten on load. An object without `alignment` renders and simulates as today.
- On the **first geometry edit** (select → Edit shape) of a user-drawn line object, make PIs from its `coordinates`:
  - Run Douglas–Peucker at **0.05 m** on the plan points. This removes collinear points, such as the flyover's 10 m resampling and crossing vertices inserted on straight segments, and recovers the clicked corners.
  - Each PI gets **radius 0**, so the shape is identical and the user sees no jump.
  - Depth controls come from the depths at the kept vertices. Typed values stay typed; dropped vertices whose typed depth differs from the interpolated one by > 1 cm are **kept as PIs**, so no typed value is lost.
  - Round-trip check: polyline → PIs → polyline within 1 mm, else keep all vertices as PIs.
- **OSM-imported roads** (`osmProvenance`), imported metro and records are **not** converted. They are mapped survey-like geometry; only their properties are edited, as today. Their vertices could get plain vertex edit later (decision D6).

---

## 4. UX [proposed]

### 4.1 While drawing (roads, flyovers, double-decks, metro, tunnels, utilities)
- **Click** = add PI. The preview immediately shows the filleted curve (thin yellow), the PI as a small square, and the tangent lines dashed.
- **Live readout** next to the cursor and in the HUD: segment length (m), bearing (°), deflection at the last PI (°, L/R), auto radius (m), and the check state for that radius (✓ ≥ min, ⚠ below min). An example while placing the third point: `124 m · 37° · Δ 28° R ↺ 265 m`.
- **Shift** = snap the bearing to 15° steps (0/45/90 included). **Alt+Shift** = snap the deflection to 15° relative to the previous tangent (0° = straight on).
- **Tangent guide** when starting on a road end (snaps within 8 px). Perpendicular guide at an edge snap.
- **Type a number** = length of the current segment. **Tab** → bearing. **Enter** = apply / finish. **R** then a number = radius at the last PI.
- **Ctrl while clicking** = sharp angle point (R = 0) for this PI. A toolbar toggle "Auto-curve" sets the default.
- **Backspace / Ctrl+Z while drawing** = remove the last PI (drawing-local; the global undo stack is untouched until finish). Esc = cancel.
- Handles on placed PIs: drag to move, right-click to delete. This is the study-area pattern extended to every line tool.
- Double-click / Enter / HUD **Finish** = finish. A **flyover / double-deck** preview also shows ramp lengths at the 3.5 % default (phase 3).
- `utility` and `angled` underground kinds: the same flow without the fillet. The readout shows the bend angle.

### 4.2 After drawing (Select → object → "Edit shape", or double-click the line)
- **Handles**:
  - **PI grip** (square): drag; the curves follow, and R is kept, clamped if needed.
  - **Midpoint grip** (small circle on each tangent): drag inserts a PI.
  - **Radius grip** (diamond at the arc midpoint): drag along the PI bisector to change R; the readout shows R live; Shift snaps R to 5 m steps.
  - **End grips**: drag; re-snap to the network on release.
- **Right-click PI** → Delete point · Make sharp corner (R = 0) · Convert to curve (R = auto) · Set radius…
- **Geometry panel** (inspector section "Alignment"): one row per PI with chainage, deflection, R (editable), T, arc length and check. Also design speed (editable, with its source), eMax 4 % / 7 %, criteria set, total length, and minimum radius used. Editing a cell = one undo step.
- Drag preview is a lightweight polyline primitive per frame: no backend write, no network rebuild, as with zone drags. **Release** commits.
- **Esc during a drag** puts the shape back.
- Proposals: an edit of a base object is copy-on-write into the proposal, as every update already is.

### 4.3 Validation (screening, never approval)
Shown in the readout, in the panel rows and as a small ⚠ marker on the map at the curve:
- **Radius below the minimum** for the design speed and eMax. Roads: IRC:86 Table 10, or the IRC:73 formula for `highway`. Metro: Pune DPR (120 limiting / 225 preferential / 200 TBM / 1000 at stations when a station lies on the curve).
  Text example: "R 180 m is below 230 m (80 km/h, e 7 %, IRC:86 Table 10). Screening only — not a design check or approval."
- **Transition not modelled** on every curve while spirals are off. IRC:86 §10.1 and IRC:SP:90 §6.16 expect spiral transitions, so the panel shows the IRC:86 §10.5.2 minimum Ls the curve would need. It never claims compliance.
- **Radius reduced to fit** (fit rule). **Curves overlap / no tangent between them**. Metro: curve between transitions < 25 m, or straight < 25 m (DPR §5.2.5).
- **Vertical (phase 3).** Flyover gradient > 3.5 % (IRC:SP:90 §6.14). Urban road > 4 % (IRC:86 §11.2). Grade change > the Table 14 / SP:23 Table 7 limit without a vertical curve, or a curve shorter than the minimum length. Metro tunnel grade > 3 % (warn) / 4 % (flag), < 0.25 % (drainage), vertical radius < 1500 m (Pune DPR).
- **No design speed set** → "not checked", never ✓.
- Every message names its source and says **"screening"**. There is no green "compliant" state; the best state is "no flag found".

---

## 5. Behaviour per object type [proposed]
| Object | Behaviour | Default design speed / criteria | Vertical |
|---|---|---|---|
| `road` (drawn) | curved, auto-fillet | from road class: arterial 80, collector 50, local 30 (IRC:86 Table 1), highway 100 (IRC:73 formula) — **D1** | flat (ground) |
| `flyover`, `metro_flyover` | curved | flyover speed of the class (`ROAD_CLASS_DEFAULTS.flyoverSpeed`: 100/80/60/40) — **D1**; eMax 7 % per SP:90 §6.13.2 — **D2** | phase 3: grade-driven ramps (3.5 % default), parabolic vertical curves |
| `metro_line` (elevated) | curved | metro-pune-sk-dpr (120/225, 1000 at stations) | fixed deck height (unchanged) |
| `underground_alignment` underground_metro / bored_tunnel | curved | metro-pune-sk-dpr; TBM 200 m | depth controls at PIs; phase 3 PVI + grade checks |
| `underground_alignment` cut_and_cover | curved | metro / none by use | depth controls |
| `underground_alignment` utility_trunk / storm_drain | angled (bends), optional radius | none (no public minimum found) | depth controls |
| `utility` | angled only | none | depth controls |
| OSM / imported objects | not converted | — | — |
| building, zone, study area | polygon vertices as today + shared Shift angle snap | — | — |

---

## 6. Undo/redo integration
- **Drawing**: PIs live in `EditingEngine` as `drawingPIs` (replacing `drawingPoints` for line tools). Backspace / Ctrl+Z pop locally. Finishing pushes one `batch`: the new object, the crossing splits of other roads and the flyover ramp-capacity updates. This is unchanged from today, apart from the object now carrying `alignment`.
- **Geometry edit** (drag release, panel cell, context-menu action): one `batch` diff named "Reshape <name>". It holds `update(before, after)` for the object (alignment + regenerated coordinates + remapped sections / depths / crossings) plus updates for every other road the pipeline split or un-split.
  - Coalesce key `"<id>:shape"` only for repeated panel edits of the same cell within 1 s; drags are one step each.
  - Undo restores whole objects, so `alignment` and `coordinates` always come back together.
- The traffic graph rebuild follows the existing coalesced worker request (DESIGN_WORKSPACE.md: one rebuild in flight).

---

## 7. Phased implementation plan (2–3 parallel agents, separate files)

**Phase 0 — contract (one agent, ~30 min, before the others start).** Commit `engine/geometry/alignment/types.ts`: the types of §3.1, plus the exported signatures of the phase-1 functions with `throw new Error('not implemented')` bodies. Add the additive optional `alignment?` and `depthControls?` fields in `engine/objects/types.ts`. This is the only shared file; nobody edits it afterwards without saying so in their report.

**Phase 1 — core + drawing (parallel)**
| Agent | Owns (creates/edits) | Delivers |
|---|---|---|
| **A — geometry core** (pure TS, no UI) | `engine/geometry/alignment/{fillet,densify,stationing,fromPolyline,criteria,checks,remap}.ts` + `*.test.ts` | fillet + fit rule, densify, chainage helpers, DP migration with round-trip guard, criteria tables (IRC:86 T10, T14, SP:23 T7, SP:90, DPR values, each with a source string), `checkAlignment()` → flags, `remapByChainage()` for sections, depths and crossings |
| **B — drawing UX** | `engine/editing/drawConstraints.ts` (new: angle snap, tangent guide, typed length, pixel snap tolerance), `engine/editing/EditingEngine.ts` (drawingPIs, finalize stores `alignment`), `engine/TwinCityEngine.ts` (`setupInteraction`, `updateSnapPreview`, `updateDrawPreview`, PI handles while drawing), `components/design/DrawReadout.tsx` (new HUD readout), `hooks/useKeyboardShortcuts.ts` (Backspace/Ctrl+Z while drawing, digits/Tab/R), `components/ui/ShortcutsOverlay.tsx` | draw with auto-fillet, Shift/Alt+Shift snap, readout, local undo. Uses A's API through the phase-0 contract (stub until A lands) |

**Phase 2 — editing after drawing + consumers (parallel, after phase 1 merges)**
| Agent | Owns | Delivers |
|---|---|---|
| **C — shape editor** | `engine/editing/AlignmentEditor.ts` (new: handles, drag state, preview primitive, commit), a small delegating hook in `TwinCityEngine.setupInteraction` (only C edits TwinCityEngine in this phase), `components/design/AlignmentPanel.tsx` (new: PI table, design speed, eMax), its mount in the inspector (`components/PropertiesPanel.tsx`, one insertion) | PI / midpoint / radius / end grips, context menu, numeric panel, Esc cancel, map ⚠ markers |
| **D — commit pipeline + consumers** | `engine/editing/geometryCommit.ts` (new: regenerate → `joinedToNetwork` → crossings → profile → remap → one batch), `engine/objects/flyoverHelper.ts` (reset ground coordinates on regenerate), `engine/underground/alignmentFactory.ts` + `utilityModel.ts` (depth controls ↔ derived depths), `components/underground/AlignmentForms.tsx` + `UtilityForms.tsx` (table per PI), `engine/editing/levelCrossings.ts` (decision re-match) | everything downstream stays correct after a reshape; backend unchanged |

**Phase 3 — spirals and vertical (parallel)**
- **A2**: clothoids in `fillet.ts` / `densify.ts`, default Ls rules, "transition not modelled" flag removed when Ls > 0.
- **E**: vertical profile `engine/geometry/vertical/{profile,checks}.ts` (PVI + grade + parabolic curves), grade-driven flyover ramps behind a per-object `verticalModel: 'legacy-40m' | 'grade'` flag (D5), the `BridgeFeasibilityEngine` grade constant to 3.5 % with the SP:90 citation, underground PVI checks, and a profile editor extension in `components/underground/ElevationProfile.tsx`.

## 8. Test plan
- **Unit (A, vitest, `--maxWorkers=1`)**:
  - T = R·tan(Δ/2) and L = RΔ to 1e-9.
  - Tangent continuity at TC/CT (heading difference < 1e-6 rad).
  - Sagitta ≤ 0.10 m and step ≤ 10 m.
  - R = 0 is an identity (output == input PIs).
  - Fit-rule clamp value; Δ < 0.5° gives no curve; U-turn refused.
  - DP migration: a polyline round-trips within 1 mm; a 10 m-resampled flyover recovers its clicked corners; typed depths are never dropped.
  - Chainage remap of sections and depths, with derived certainty = worst of the neighbours and unknown propagating.
  - Criteria tables equal IRC:86 Table 10 / 14 and the DPR numbers exactly; the formula check (80 km/h, 7 % → 229 m).
  - Angle snap at 15°/45°/90° and relative snap.
- **Integration (D)**:
  - Draw a road with a fillet across two OSM roads. Expect: graph edge length = arc-based polyline length ±0.5 %, junction node count unchanged against the same line drawn straight, crossings inserted on both roads.
  - Reshape → crossings recomputed; Undo restores the object **and** both crossed roads (`/api/objects` matches).
  - Sections survive a reshape. Underground: `depths.length === coordinates.length` always.
  - Backend pytest: `screening.py` results identical for a legacy object and its migrated (R = 0) twin.
  - `alignment` round-trips through POST/GET `/api/objects` and scenario changes.
- **Headless E2E (real clicks, labelled headless, inside the flock rules)**:
  - Draw 3 PIs with Shift; read back bearings that are multiples of 15°.
  - Drag a radius grip: R changes, the readout matches the stored value.
  - Insert and delete a PI; Ctrl+Z / Ctrl+Y; reload persists.
  - A radius below the minimum shows the screening flag text.
  - Tunnel depth table lists PIs only.
  - Up to 5 screenshots.
- **Gates**: `tsc -p tsconfig.app.json --noEmit` 0, oxlint 0 errors, vite build, the touched vitest files, the existing suites (DesignTools, EditingWorkflow, EditRecompute, HistoryManager, FlyoverTraffic, NetworkEditIsolation, BridgeFeasibility, underground tests).

## 9. Risks
1. **Vertex growth → crossing-test cost.** `TrafficNetworkBuilder` tests segment pairs for each road pair in a grid cell. Densified curves add about 20–50 vertices per curve. Mitigations: keep tangents to their end points; sagitta 0.10 m; measure graph build time on the 18k-road DB copy before and after (headless, labelled).
2. **Crossing churn on reshape.** Old crossing vertices stay on other roads as harmless shape points; a node exists only where both roads share the point. Verify that no stale junction remains. Junction objects attached to the moved road need re-validation (show "junction no longer on road X").
3. **Per-vertex depth semantics (underground)**: the highest-risk change. D's tests must prove that no typed value is invented, moved or dropped.
4. **Flyover legacy profile.** Switching to grade-driven ramps changes existing flyovers' 3D shape and ramp capacity effects, so keep it opt-in per object (D5).
5. **Proposals**: a reshape that splits base roads creates copy-on-write overrides for each of them. Same as drawing today, but a drag-heavy session makes many overrides; commit only on release.
6. **Honesty**: the radius, grade and transition flags must never read as compliance. Wording is reviewed against DESIGN_TOOLS_AND_HONESTY.md.
7. **Sources not fully read**: IRC:73 Table 16 (rotated scan) and IRC:38 (scan) were not read. The highway minimum radius is formula-derived and labelled so. National metro (RDSO/MoHUA) values were not found; the Pune S–K DPR values are project values for the underground section.
8. **Licences**: the IRC texts are copyrighted (public.resource.org copies). Cite clause numbers; do not ship the PDFs or long extracts in the repo.

## 10. Decisions needed from the user
> **Decided 2026-11-22** (D1–D5): see PLANNING_DEFAULTS_DECISIONS.md — IRC:86-2018 speeds, 4 % surface / 7 % deck, no spirals this phase, flyover grade 4 % urban / 3.3 % highway per IRC:SP:90-2023 §4.13 (the 3.5 % SP:90-2010 cap is superseded).

- **D1 Default design speeds**: IRC:86 urban (arterial 80, collector 50, local 30). For the `highway` class, 100 km/h (rural IRC:73) or 80? Flyovers: keep the current flyover speeds 100/80/60/40?
- **D2 Superelevation cap for the screen**: 4 % (IRC:86 "urban sections with frequent intersections") for surface roads and 7 % for flyover decks (recommended), or 7 % everywhere?
- **D3 Spirals in phase 1?** Recommendation: **no**. Circular curves first, with a "transition not modelled" note and the required Ls shown; clothoids in phase 3. (Spirals make the fit rule and handles harder; the curve shape changes little at urban radii.)
- **D4 Utilities and utility trunks**: angled bends only (recommended), or allow a radius?
- **D5 Flyover ramps**: move existing and new flyovers to grade-driven ramps (3.5 % → about 171 m for a 6 m deck, longer than today's 40 m), or new ones only?
- **D6 OSM-imported roads**: leave their geometry locked (recommended), or allow plain vertex moves later?
- **D7 Shift semantics**: absolute 15° bearings (recommended), with Alt+Shift relative to the previous tangent?

---

## 11. Changes in branch `p5-geomfin` (2026-11-22)

Built on `cbff478`. Every value below is screening, never a design check or approval. Sources are those of
PLANNING_DEFAULTS_DECISIONS.md (IRC texts are third-party copies, unconfirmed against IRC-issued copies).

### 11.1 Flyover ramps from the deck height and the grade (D5)
- **One profile** (`engine/geometry/vertical/flyoverRamp.ts`, `flyoverRampProfile` / `flyoverOffsetAt`) feeds the 3D
  heights (`objects/flyoverHelper.ts applyFlyoverElevationProfile`) and the desk check (`simulation/BridgeFeasibilityEngine.ts`).
  `maxRampGrade` moved there (re-exported from the engine).
- **Shape per ramp:** square-parabola vertical curve (0 → g) of length Lv, the grade g, a second curve (g → 0) onto the
  deck. g = 4 % on urban roads, 3.3 % on a highway (IRC:SP:90-2023 §4.13). Lv = the IRC:86-2018 Table 9.2 minimum length
  for the design speed (the row at or above it; IRC:SP:23-1993 Table 7 at 100 km/h). Design speed = the alignment's, else
  the deck speed (= class design speed for new flyovers, D1). Ramp length per end = max(H/g, Lv) + Lv; steepest point = g.
  Example: 6 m deck, arterial 60 km/h → 150 m + 40 m = 190 m each end (was a fixed 40 m, a 15 % grade).
- **Too short a line:** the deck height is kept and each ramp is squeezed into half the line (curves scaled with it); the
  modelled grade is then steeper than g, and the check fails with that grade ("the 3D model squeezes each ramp into N m, a
  X % grade"). Nothing is hidden or silently flattened.
- **Check changes:** the ramp-grade check now reads the ramps where the 3D model draws them (on the drawn alignment) instead
  of the length of mapped approach roads near each end. `rampLengthRequired` includes the vertical curves (190 m for the
  example), `rampGradeLength` is H/g (150 m), `rampLengthAvailable` is the modelled ramp per end, `rampProfile` the profile.
  The deck-length check uses the same ramp length (2 × ramp + the assumed 50 m deck, warn only). Inspector line: "Ramp
  needed: N m each end · Modelled: N m · X %".
- **As-built flyovers** (`isAsBuiltFlyover`: OSM / municipal / surveyed, geometry not edited) keep the legacy 40 m
  smoothstep ramp (`model: 'legacy-40m'`) and the information-only screen. An edited one becomes a design.
- **Stored objects:** the profile used is stored on the object as `rampProfile` (derived). Heights made earlier with the
  40 m ramp and no stored ground line are read back with the exact legacy formula, then re-profiled. Drawn (non-as-built)
  flyovers saved before this branch get the grade ramp the next time their profile is applied (load / edit).
- **Traffic graph:** with long ramps a flyover sits 0–3 m up over a long stretch, so the builder's near-miss rule (a vertex
  within 6 m and 3 m of a road joins it) made junctions the crossing classifier had kept apart (property test
  `ramp-foot`). A drawn flyover / double-deck now joins other roads only at its two ends or through the X-crossing check
  (which honours level decisions) — `TrafficNetworkBuilder isDrawnStructure`.
- **Not modelled:** sight-distance length of the vertical curves (IRC:SP:23 summit/valley formulas), the clearance under
  the deck, spirals.

### 11.2 Elevation while drawing (D10 item 7)
- **Road tool:** PageUp / PageDown raise / lower the next point by 1 m (Shift: 0.5 m), 0–30 m above ground. The height is
  kept for the following points and goes back to the ground for each new road. A point snapped to a road keeps that
  road's height (shown as "(road)").
- **Flyover / double-deck tools:** the same keys set the deck height of the new structure (1–30 m, default 6 m, was fixed
  6 m); the double-deck's metro deck stays ≥ 6 m above it (12 m at the default). The per-point height does not apply to
  flyovers: their heights come from the ramp profile (§11.1).
- **Readout** (`components/design/DrawReadout.tsx`, `drawConstraints.ts roadVerticalReadout / deckVerticalReadout`):
  road → "↑ h m · grade ±x %" from the last point to the cursor (PI to PI, plan distance) and the steepest placed segment;
  flyover → "deck h m · ramps N m each · ramp grade x %" on the line drawn so far. A grade over 4 % / 3.3 % shows
  "⚠ … Screening only — not a design check or approval." Keys are listed in the shortcuts overlay.

### 11.3 Delete takes back added vertices
`history/HistoryManager.ts deleteWithHistory`: deleting a drawn road / flyover / double-deck removes the vertices its
crossings and end junctions put into other roads (`addedNetworkVertices`), with `pruneStaleAddedVertices` and its safety
rules (only vertices we added, still exactly there, not an end, not a section boundary, not used by another object or
record in the scenario). Same Undo step as the delete (with the flyover's ramp-capacity give-back); Undo restores the
road and the vertices, Redo removes them again. An object without the record changes nothing in other roads.

### 11.4 Utility depth controls
A newly drawn utility stored per-vertex depths only, so its PI depth controls were derived (same gap tunnels had before
`c624274`). It now stores `depthControls` at its PIs (the drawing depth, or the type's typical cover marked as a default)
with per-vertex depths derived from them (`EditingEngine.finalizeDrawingPoints` → `withUtilityZ(…, { controls })`).

### 11.5 Tests
`FlyoverRamp.test.ts` (new), `DrawElevation.test.ts` (new), `BridgeFeasibility.test.ts`, `GeometryCommit.test.ts`
(grade-ramp reshape, delete prunes added vertices), `DrawConstraints.test.ts` (utility depth controls).
