# Underground screening / conflict checks (2026-11-15)

Branch `ug-checks` (from `underground-mode` = bacff72). Owner: screening engine (backend `coordination/*`) and its result UI
(`components/underground/ConflictCheck.tsx`, `conflictClasses.ts`, coordination API client).

Labels used below: **READ** (code read this session), **MEASURED** (run here, numbers given), **UNIT-TESTED** (pytest / vitest).

## 1. Audit of the engine as found (bacff72)

### 1.1 Entry point and flow (READ)
- UI: Underground → active alignment → "Conflict check" (`ConflictCheck.tsx`). It requires a **planning project** and a
  **user name**, registers the alignment as a `project_proposal_elements` row (own GeoJSON geometry + profile; updated in
  place on later checks), then calls `POST /api/coordination/projects/{pid}/detect`.
- Backend: `coordination/service.py::run_detection(project)` checks **every element of that project** against side-B layers
  and writes a `coordination_runs` row + one `coordination_conflicts` row per finding (insert-only; status carried forward).

### 1.2 What is checked, against which data (READ)
| Side B layer | Source | Depth used | Width |
|---|---|---|---|
| `project_element` | elements of **other planning projects** | as entered | as entered |
| `baseline_road` | `city_objects` scenario `base`, type `road` | surface: z_max = 0, structure depth UNKNOWN | `width` property or UNKNOWN |
| `osm_metro` | local OSM index (`railway=subway/construction/station`); tunnel/layer<0 → `metro_tunnel`, bridge/layer>0 → viaduct | UNKNOWN (OSM has none) | UNKNOWN |
| `subsurface_utility` | `subsurface_records` (imported CSV/JSON + PMC sewer 44,482 + PMC storm drains 9,187, all QL-D) | sewer: z range from published invert/cover levels (design levels, unverified); storm drains: UNKNOWN | diameter (sewer) / UNKNOWN (storm) |
| `building` | infra index footprints (OSM + Microsoft + Google ML) | foundation UNKNOWN; height from OSM tag | footprint polygon |

**Not used at all:** objects drawn in Design — `utility` objects (depth, diameter), other `underground_alignment`
objects (tunnels, underground metro, trunks, storm drains), elevated `metro_line` / `metro_station` (pier foundations), in
the same alternative or in the baseline. **Known gap confirmed:** a pipe drawn in Design straight through a proposed
tunnel is never reported. Other alignments of the same alternative are only checked if each was separately registered in
the *same* project (pairs inside one project are not compared at all — `others` excludes the own project).
Also not used: boreholes, groundwater (NWDP wells are on disk and shown in *Subsurface evidence* but not in the check),
DEM, soil, depth / cover rules, PMC nallas/rivers.

### 1.3 Geometry method (READ)
- 2.5D. Plan: exact 2D distance between footprints in UTM 43N (EPSG:32643, Shapely), footprint = centreline buffered by
  width/2 (flat caps); width UNKNOWN → bare centreline flagged `width_known=false`.
- Alignments are split per vertex; each segment's z range is the **envelope of the whole segment** (both ends + inner
  profile points) — not the depth at the crossing, so a long sloping segment can show overlap where there is none.
- Vertical: interval arithmetic on z ranges (gap = A.z_min − B.z_max or B.z_min − A.z_max). Required vertical clearance =
  max(engineering rules, element clearance) — **no engineering clearance is seeded**, so vertical adequacy is always
  UNKNOWN and the horizontal test is physical overlap only.
- Spatial index: Shapely STRtree per layer, query radius = max(screening radius 50 m, largest rule distance) + 1 m.
  Utility records are pre-filtered by the extent side table; buildings queried per element box from the infra index.
- No 3D separation is reported; no positional tolerance by quality level.

### 1.4 Statuses and wording (READ)
`conflict` · `potential_conflict` · `vertically_separated` · `no_conflict_within_available_data` · `unknown_no_coverage`.
Honest (no "clear"/"safe"), but:
- does not map to the mission vocabulary (Verified / Potential conflict / Insufficient data / Requires investigation);
- a finding says what was found and why, but **not** what was not checked or which investigation comes next;
- "Vertically separated" reads as a pass to a non-engineer although adequacy is UNKNOWN;
- the run has no statement that automated screening is not engineering approval (only the UI footnote says so);
- permission distances (MahaMetro NOC 20 m, AMASR) are side notes, not a status.

### 1.5 UI (READ)
Flat list sorted by class (max 100), plan distance / vertical gap / certainty, two reasons. No grouping by severity, no
"what wasn't checked", no fly-to or highlight of the two assets, project + name required before anything happens.

## 2. Redesign (implemented in this branch — see §3 onward when filled)

Planned:
1. **Inputs**: every proposed underground object of the alternative (alignments + Design-drawn utilities) vs existing:
   PMC sewer / storm records, OSM metro tunnels / stations / lines, Design-drawn existing (baseline) objects, building
   footprints (foundation proxies, depth UNKNOWN), NWDP groundwater wells, imported boreholes. Proposed-vs-proposed pairs
   inside the alternative too.
2. **Checks**: true 3D clearance (crown/invert from depth + section at the stretch where the two assets come within the
   clearance distance), horizontal distance via STRtree, metro protection zone, building foundations ("Insufficient
   data"), cover / depth constraints per asset type (labelled rule-of-thumb defaults, one config module), groundwater and
   geology only where data exists, otherwise "not checked".
3. **Result model**: status ∈ {Verified, No conflict found in available data, Potential conflict, Insufficient data,
   Requires investigation}; every finding carries what was checked, data used (dataset + quality level), what was found
   (distances in m), what was NOT checked, next investigation.
4. **UI**: summary counts, grouped by severity, click → fly to + highlight both assets, "what wasn't checked" visible.
