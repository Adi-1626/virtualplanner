# Underground Mode — audit and first-time-user walkthrough (2026-11-15)

Branch `ug-audit` (from `underground-mode` = bacff72). Scope of the fixes in this branch: the Underground panel, view,
renderer, profile / section and alignment editor UI. Conflict-check logic (backend/coordination/*, ConflictCheck.tsx,
conflictClasses.ts) belongs to another work stream and is only described here.

Research input: [UNDERGROUND_RESEARCH.md](UNDERGROUND_RESEARCH.md) (§2 data model and Z rules, §5 UX, Top 12).

## 1. Inventory (as found at bacff72)

### 1.1 Entry and layout
- Workspace rail `Underground` (key 3, `ws-underground`). Engine mode is Build (same as Design), so every Design tool
  and the right-hand inspector (PropertiesPanel) stay live.
- Context panel `UndergroundContext` (shell/contexts/UndergroundContext.tsx), top to bottom:
  View (ViewControls) → Underground alignments (list / empty state + "Draw an alignment") → Profile editor of the active
  alignment (AlignmentEditor) → Conflict check (ConflictCheck) → Subsurface records (SubsurfaceRecords: datasets,
  record list, import form) → Utilities drawn in this alternative → Disclosure (flat-datum note).
- Bottom drawer tabs (UndergroundContext.tabs.tsx): Profile (ElevationProfileSvg with DEM, ProfileSvg on a flat datum
  without), Cross-section (CrossSectionSvg), Utility table, Subsurface evidence (SubsurfaceEvidenceView).
- Right inspector: PropertiesPanel → AlignmentInspector (TransitUndergroundEditors.tsx) = section sketch +
  "Long-section, sections & conflicts →" + a second AlignmentEditor; metro lines get MetroLineEditor.

### 1.2 Controls
| Control | Where | Effect |
|---|---|---|
| Ground opacity slider (default 35 %) | View | globe.translucency front/back alpha (UndergroundView) — whole globe |
| X-ray | View | translucency capped at 0.5 + depthTestAgainstTerrain off |
| Only around alignments | View | translucency.rectangle = alignment bbox (off by default; disabled with no alignment) |
| Draw an alignment / Draw another | Alignments | EditingEngine mode `draw_underground` |
| Type, cross-section shape, Ø / W×H, section certainty, set-all depth, per-vertex crown depth + certainty | Profile editor (twice: panel + inspector) | commitAlignment → history.recordUpdate + objects.update |
| Import records (AGS4/CSV/JSON) | Subsurface records | POST /api/coordination/subsurface/import |
| Draw a utility | Utilities (empty state) | mode `draw_utility` |
| Chainage slider, window ± | Cross-section tab | undergroundStore |
| Click on profile | Profile tab | sets the section chainage |

### 1.3 API calls
- `GET /api/coordination/subsurface/datasets`, `GET /api/coordination/subsurface/records` (no bbox) — useSubsurfaceRecords.
- `POST /api/terrain/profile` (DSM ground line), `POST /api/terrain/subsurface-evidence` (wells, SoilGrids, PMC sewers, boreholes).
- Conflict check: `/api/coordination/projects…/elements`, `…/detect` (ConflictCheck.tsx; other work stream).
- Objects persist through the normal object sync (`/api/objects`).

### 1.4 Data model — how X/Y/Z are stored
| Thing | X/Y | Z stored as | Reference / datum |
|---|---|---|---|
| Underground alignment (`underground_alignment`) | coordinates lon/lat (WGS84), z forced 0 | `depths[i].crownDepthM` = crown (top) depth, + down, per vertex; `certainty` per vertex; `section` (Ø or W×H) | "below ground" — in 3D the scene ground (ellipsoid 0 m, or Cesium terrain when on); in the Profile the Copernicus GLO-30 **DSM** (EGM2008, includes roofs/trees). No elevation, datum, ground-model version or z-reference stored. |
| Drawn utility (`utility`) | lon/lat, z 0 | `depth` (number, default 1.5 placeholder), `depthCertainty`, `diameterMm` | below ground; which part of the pipe (top/centre/invert) not stated (comment says cover to crown) |
| OSM metro line (`metro_line`) | lon/lat | `elevation` = −6 for `tunnel=yes`/`layer<0` (an invented placeholder), +12 for bridges | none — the −6 m is not from any source |
| OSM metro station | point | `elevation` 0 even for underground stations (Swargate) | none |
| PMC sewer / storm-drain records (backend `subsurface_records`) | GeoJSON lon/lat | `depth_m`, `z_min_m`/`z_max_m` relative to ground; sewers from published cover/invert (QL-D, datum not stated); storm drains: all depth UNKNOWN | relative to "ground"; invert *elevations* only in evidence API |
| Boreholes (imported) | point | `final_depth_m`, `ground_level_m` | collar level when given |
| Terrain / DEM | — | /api/terrain samples, m EGM2008 | Copernicus GLO-30 DSM v3, screening only |

Relation to Design objects: alignments and utilities are ordinary city objects (scenario copy-on-write, undo, versions);
Design roads/flyovers/metro/buildings appear in the profile/section as "crossings" with a vertical extent from
`verticalExtentOf` (foundation depths UNKNOWN).

## 2. Walkthrough (headless Chromium, Swargate then Karve Rd; screenshots shots/underground/audit-*.png)

Setup: Design → Study area import of `metro` for the Swargate box (local OSM index: 9 objects, 4 Purple Line tunnel
ways `tunnel=yes layer=-2`, Swargate station).

| # | Step | Observation | Problem? |
|---|---|---|---|
| 1 | Enter Underground (audit-enter) | Panel: View, "No underground alignment", "No records imported · Unknown" directly above two PMC dataset cards (9 187 and 44 482 records) each with ~12 lines of licence text. Globe translucent at 35 % everywhere. Nothing tells me what I can do. | **F1 contradiction, F2 licence wall, F3 no entry guidance** |
| 2 | Is the surface aligned? (audit-view-default) | Roads/flyovers stay in place; Purple Line tunnel drawn as a light-blue box — not visibly below ground. | **F8** (metro at invented −6 m) |
| 3 | Below ground (audit-view-below) | Camera can go under; flyovers seen from below; no depth readout, no way back except camera moves; whole globe translucent. | **F9** no depth HUD / back to surface; translucency not local |
| 4 | Inspect existing metro (audit-inspect-metro) | Inspector "Editing metro line … TRACK HEIGHT −6 m" slider (min 6), badge HYPOTHETICAL "Design values". An existing OSM tunnel shown as an editable design value with an invented depth. | **F8** |
| 5 | Inspect PMC storm drains / sewers | 0 record entities on the map (records endpoint without bbox excludes reference networks); records list empty. | **F1** (root cause below) |
| 6 | Draw proposed tunnel (audit-draw-tool, audit-draw-done) | Tool settings (type, depth, section) are not visible in Underground — they only show in Design's tool panel; the tunnel gets 15 m / Ø 6 m silently. HUD says "Set depths in Underground" while already in Underground. Row says "deepest 21.0 m" (that is the invert). | **F4** settings hidden; minor wording |
| 7 | Change Ø / depth (audit-edit, audit-tab-profile) | Works, but the same editor appears twice (panel and inspector), squeezing the map to ~690 px. | **F5 duplicate editing surface** |
| 8 | Profile tab | Good: DSM ground line, crown elevation m EGM2008 and depth below DSM per vertex, provenance. The metro tunnel crossing is not labelled as a tunnel (TYPE_LABEL says "Metro (elevated)"). | **F8** label |
| 9 | Draw a pipeline (audit-pipe) | Utility created: water, depth 1.5 m "(default)", diameter UNKNOWN; not visible from above with opaque-ish ground; list/table OK. | minor |
| 10 | Cross-section / Utility table / Evidence tabs | Work; evidence honest (no wells within 3 km, SoilGrids masked = UNKNOWN, 1 PMC sewer crossing QL-D). | OK |
| 11 | Undo/redo | Ctrl+Z undid the last action (the utility) — my first check compared alignments only; re-tested after fixes. | not a bug |
| 12 | Reload | Alignment, depths, section and utility persisted. | OK |
| 13 | Delete key | Opens the confirmation dialog (expected); delete works after confirming. | OK |
| 14 | Karve Rd | Same "No records" + storm-drain card; no records drawn. | F1 |

## 3. Findings with root cause

| ID | Finding | Root cause | Status |
|---|---|---|---|
| F1 | "No records imported · Unknown" shown while 9 187 storm-drain + 44 482 sewer records are listed; none drawn on the map | `useSubsurfaceRecords` calls `GET /subsurface/records` without a bbox; the backend deliberately excludes the bulk reference networks (`ssd_ref_*`) without a bbox, so `records=[]` while `datasets` lists them. The empty state keys on `records.length` only. | fixed (§4) |
| F2 | Licence/provenance wall per dataset card | `SubsurfaceRecords` prints publisher, full licence text, coverage, importer, sha and warnings inline | fixed (§4) |
| F3 | No obvious entry state | Empty alignment state is the only call to action; inspecting existing assets is not offered | fixed (§4) |
| F4 | Tunnel tool settings invisible in Underground | `ToolSettings` is rendered by the Design context only | fixed (§4) |
| F5 | Two editors for one alignment | `AlignmentInspector` embeds `AlignmentEditor`; the inspector opens beside the Underground panel (dual overlay) | fixed (§4) |
| F6 | Depth reference unclear / no stored datum | `UndergroundVertexDepth` has only depth + certainty; no ground elevation, datum, ground-model version or z-reference (research §2.3) | fixed (§4) |
| F7 | Existing vs proposed vs conceptual not distinguishable | Alignments have no lifecycle status; renderer encodes only certainty (alpha); no legend | fixed (§4) |
| F8 | OSM metro tunnel at an invented −6 m, edited as a "design value", labelled "Metro (elevated)" in sections | OSM import (EditingEngine) writes elevation −6 for tunnels; `verticalExtentOf` / TYPE_LABEL / MetroLineEditor assume elevated | fixed (§4) |
| F9 | Cutaway is global; no depth readout, no "back to surface" | `UndergroundView` default rectangle = whole globe; no camera HUD | fixed (§4) |
| F10 | Disclosure says "no terrain / DEM data is loaded" while the Profile uses the DSM | stale text from before DEM v3 | fixed (§4) |
| F11 | Backend conflict detection ignores Design-drawn utilities | coordination/service.py run_detection | needs backend (other work stream) |
| F12 | Underground stations imported at elevation 0 | OSM import ignores `station=subway` depth (none published) | needs design decision (Design import code) |

## 4. Fixes (branch ug-audit) and retest

Commits: 1b7e6bc (records, entry, single editor, metro tunnel, legend) · 70b650c (Z model, depth reference, lifecycle) ·
0b8538c + 5bb9d51 (cutaway) · 720c37b (finish drawing → editor) · merge of 77edeb4 (screening engine) · 5f6af8a (conflict check placement).

| ID | What changed | Retest (headless, Swargate / Karve Rd; shots/underground/fix*-*.png) |
|---|---|---|
| F1 | Records are always listed for a **work area** (250 m around the alignments, else the map view; centre box when oblique) with `?bbox=`, so the PMC networks come back and are drawn (≤4 000 polylines; colour = type, opacity = QL, no-depth records on the surface). One row per layer: count here, QL, "depth known for n of N"; water, power, gas, telecom, boreholes, foundations listed as **Not available** with who holds them (`engine/underground/recordsSummary.ts`). "Look here" re-lists. | Swargate view: sewers 2 021, storm drains 440, 2 461 drawn; Karve Rd: sewers 1 716, 1 895 drawn; six layers "Not available". No "No records imported" anywhere. |
| F2 | Each dataset = one line "publisher · data date · licence in a phrase · details"; licence text, coverage, sha, warnings behind the disclosure. | fix1-view-default |
| F3 | Get-started card: 1 see records, 2 draw tunnel / lay pipe, 3 check conflicts; Undo/Redo in the panel; primary "Check conflicts" button at the top once anything is proposed. | fix1-enter |
| F4 | While drawing in Underground the panel shows the hint, the tool settings (type, depth, section) and "Stop drawing"; finishing a line selects it and opens its editor. | fix2 draw/edit |
| F5 | In Underground the inspector shows the section sketch + "edit in the Underground panel"; the panel editor is the only editing surface (Design keeps its inspector editor). | 1 editor (was 2) |
| F6 | `UndergroundVertexDepth` keeps the typed crown depth and adds `elevationM`, `datum: 'EGM2008'`, `zRef: 'crown'`, `groundM`, `groundModel` (e.g. "Copernicus GLO-30 DSM v3 (dsv_0d0e82a8c181)"); written on every edit and once when the ground loads (no undo entry, only in the object's own alternative). A depth change drops the stale elevation and re-derives it; section/type/status/certainty edits keep it. Editor shows a "Depth reference" box (DSM incl. roofs/trees, screening) and the EGM2008 elevation under every depth. | V1 18 m below DSM 574.18 → 556.18 m EGM2008; persisted through reload; undo/redo of a depth edit OK |
| F7 | `lifecycle` (proposed default / conceptual / existing) on alignments; plan trace dashed / dotted / solid, conceptual paler; legend (status line styles, utility colours, opacity = evidence). | fix2-tunnel-3d |
| F8 | OSM tunnel metro: inspector says "Underground section… depth UNKNOWN, drawn as a placeholder" (no track-height/pier sliders, UNKNOWN badge); profile/section treat it as depth UNKNOWN (was 6 m) and label "Metro". | fix1 inspect |
| F9 | See-through ground limited to the work area by default ("See-through everywhere" opt-in); camera height/depth readout; "Look from below" (camera 8 m below ground facing the work area); "Back to surface" (highlighted when below). | below: "Camera 15 m below ground" → Back: "413 m above ground"; look-below: tunnel visible under the road (fix2-look-below) |
| F10 | Technical-details text now describes the DSM ground, its limits and PMC datum. | — |
| — | Conflict check (other stream's component) mounted unconditionally as "Check for conflicts", right after the proposal list. | utilities only: 1 object checked → 3 Requires investigation (Maha-Metro NOC), 6 Insufficient data (fix3-check) |

## 5. Not fixed / open

| Item | Why | Owner |
|---|---|---|
| F11 Design utilities in `run_detection` | backend coordination logic (the new screening endpoint does include them) | backend / coordination stream |
| F12 Underground stations at elevation 0; OSM tunnel still **rendered** at −6 m by the Design geometry generator | Design import/renderer; real depth unpublished — needs a decision: draw plan-only (dashed on surface) vs a labelled placeholder | design decision |
| Drawn utilities: depth is "cover" with no z-reference or elevation; `depth` is a non-null number (1.5 m default) | utility model is Design's; should get the same Z fields as alignments | needs design decision |
| A proposed utility is hard to see from above (thin tube 1.5 m down, outside the see-through area) | renderer LOD / surface trace for utilities | follow-up |
| 3D scene ground is the ellipsoid (Cesium ion terrain 401), Profile uses the DSM: 3D depths are relative to scene ground, Profile to DSM (labelled) | no terrain provider without an ion token | needs backend / config |
| Row summary "deepest 25.2 m" is the invert | wording only (tested string) | minor |
| PMC sewer "depth known" counts `depth_m` = published top depth (design levels, datum not stated) | as published, QL-D | data |
| Headless only: frame timing not measured here | — | — |
