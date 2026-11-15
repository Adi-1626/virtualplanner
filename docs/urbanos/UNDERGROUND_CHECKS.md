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

## 2. Redesign (implemented, commits on `ug-checks`)

Rules aligned with `/workspace/work/underground-research/UNDERGROUND_RESEARCH.md` §3 (checks C1–C22), §4 (statuses,
wording) and Top 12. Code: `backend/coordination/screening_config.py` (rules table, the only place values live),
`backend/coordination/screening.py` (engine), `POST /api/coordination/underground/screen`, UI
`frontend/src/components/underground/{ConflictCheck.tsx, conflictClasses.ts, conflictHighlight.ts, screeningStore.ts}`.

### 2.1 Inputs (UNIT-TESTED)
- **Which side a drawn object is on**: the lifecycle the user recorded wins — utility `status`, alignment `lifecycle`.
  *proposed* and *conceptual* are checked as proposals wherever they are drawn (a proposal drawn on the base city is
  checked in every alternative); *existing* and *abandoned* (in place) are existing obstacles and are never checked as
  proposals. When no lifecycle is recorded (older objects, `unknown`), alternative membership decides: objects of the
  active alternative are proposed, baseline objects existing; in the baseline itself every drawn alignment / utility
  counts as proposed. Objects are sent by the UI as Design holds them (unsaved edits included) or read from the database
  (`objects` omitted: baseline + the alternative's own objects, its modifies and deletes applied). Proposed × proposed
  pairs are checked once.
- **Existing**: Design-drawn existing / abandoned objects (utilities, alignments, elevated `metro_line`,
  `metro_station`); utility records (PMC sewer 44,482 + storm drains 9,187 = 53,669 with geometry, plus anything
  imported); OSM metro (tunnel / viaduct / unknown-level lines, stations); building footprints (infra index, foundation
  proxy); PMC nallas + rivers; NWDP groundwater wells (3 km); imported boreholes (500 m).
- Depth model, alignments: crown per vertex, invert = crown + section height / diameter.
- Depth model, drawn utilities (Z model of `engine/underground/utilityModel.ts`, UNIT-TESTED): per vertex, top of pipe =
  `topDepthM` (derived from `depthM`, the object's `zRef` top / centre / invert and the diameter when absent), bottom =
  top + diameter (or `depthM` itself for an invert reference). Between vertices the depth is interpolated along the line,
  and a pair uses only the stretch of each line near the other (as for alignments) — never one depth for the whole line.
  A vertex with no depth is UNKNOWN and is never interpolated across. A typical-cover default (`isDefault`) is used as a
  hypothetical value and named in the finding wherever the vertices used are defaults. Older utilities without `depths`
  keep the legacy reading: one `depth` (top of pipe) for the whole line; `depthCertainty` `unknown` = depth UNKNOWN.
- Evidence → positional uncertainty: an existing / abandoned utility with evidence QL-A..QL-D takes that quality
  level's tolerance (table below). *User-drawn* existing utilities have no survey behind them: tolerance "user-drawn"
  (QL-D-like, level not usable unless every depth used is marked measured). A **proposal** (proposed / conceptual) is
  screened as design intent: *user-drawn* adds no position uncertainty (tolerance 0) — a deliberate choice, since the drawn
  line is what is being proposed; a QL recorded on a proposal is ignored and noted in the finding.
- Abandoned in place: an existing obstacle (the finding says so and lists "whether it has been removed or filled" under
  not checked).

### 2.2 Statuses (UNIT-TESTED)
Only **Potential conflict · Requires investigation · Insufficient data · Verified**. The engine assigns the first three;
**Verified** only when a person has recorded QL-A field evidence (`POST /underground/verifications`, methods trial pit /
vacuum excavation / survey of exposed asset; table `underground_verifications`, audited, insert-only) for that pair and the
fingerprint of both assets (geometry, size, depths) is unchanged — otherwise the finding says "re-verify". "No records" is
**Insufficient data** (one `data_gap` finding per object lists networks with no records: water, power, gas, telecom).
Checks that flag nothing appear in the object's checklist as "nothing found in the available data" — never a status,
never green. Banner: **"Automated screening — not an engineering assessment"**. Output never contains safe / feasible /
construction-ready / passed / compliant (tested).

Every finding carries, in fixed order: **checked**, **data used** (dataset, quality level, datum), **found** (numbers in m,
requirement with every rule cited, uncertainty added), **not checked**, **next investigation** (Indian ladder: owner
as-builts → Call Before u Dig → GPR (QL-B) → trial pits (QL-A) → Maha-Metro NOC → boreholes → specialist), plus
`measurements`, `rules`, `location`, `pair_key`, `fingerprint`.

### 2.3 Rules table (by asset-type pair; stricter wins, both cited)
| Pair | Rows used (value, direction, type, source) |
|---|---|
| water × sewer/storm | C1 3.0 m H normative (CPHEEO 2024 §12.9.1); C2 0.5 m V water above (CPHEEO §12.9.2); C2b-H 2.0 m H draft (IRC:98-2024 §3.2.3); C2b-V 1.0 m V water above (IRC draft §3.3.3) → **3.0 m H / 1.0 m V**; C20 3 m / 0.45 m international, comparison only |
| power × water | C3 0.3 m 3D normative (IS 1255 §6.3.3); C3b 1.0 m H and V draft (IRC) → **1.0 / 1.0** |
| power × gas | C3 0.3 m 3D (IS 1255) |
| power × telecom | C4 0.3 m 3D, power below (IS 1255); C4b 1.0 m H and V (IRC draft) → **1.0 / 1.0**, order enforced |
| gas × services | C5 0.3 m V, gas below (PNGRB T4S (a)); C6 0.3 m H (T4S (b)) |
| gas × building | C7 3.0 m H (T4S (g)) — a footprint closer than 3 m is a Potential conflict |
| tunnel × tunnel | C16 1 × larger diameter, rule of thumb (Maha-Metro DPR) → breach = specialist (Requires investigation) |
| tunnel × anything | C19 no Indian norm: 1 × diameter **referral distance, not a clearance** → specialist; only physical intersection = Potential conflict |
| any other pair | U0 0.3 m 3D rule of thumb (no code value found) |
| any × Metro structure | C15 20 m from edge (UDCPR 14.2.1.7, Pune Metro notice) → Requires investigation, Maha-Metro NOC |
| cover | gas 1.0 (T4S Table 3) · power 0.75 LV / 1.05 at unknown voltage (IS 1255 §6.3.2) · sewer 1.0 / storm 0.5 (CPHEEO 2013, excerpt) · water / telecom / other 0.6 (IRC draft §3.3.1) · bored tunnel 2 × D (DPR, rule of thumb); depth bands C14 → "unusual depth, verify". Below a normative minimum → Potential conflict; below guideline / rule of thumb → Requires investigation. Caveat on every cover finding: ground in 3D is a DSM, not bare earth |

Positional uncertainty (added to H thresholds, and to V where usable): QL-A 0.05 / 0.03 m; QL-B 0.3 m, V not usable;
QL-C 1.0 m; QL-D and unknown 3.0 m, V not usable; user-drawn 3.0 m (V usable only when the user marks the depth
measured: 0.3 / 0.3 m); proposed design 0. **PMC sewer levels have no datum** → their Z is relative only: "vertical not
checkable" (pairs within the horizontal threshold become Insufficient data, with the recorded relative gap shown).
Footprint width unknown (storm drains, OSM metro) → 1.0 m half-width assumed per unknown side (rule of thumb).

### 2.4 Geometry (UNIT-TESTED)
UTM 43N. STRtree (`dwithin`) over Design + OSM metro assets and one cached STRtree over all utility records. Per pair:
edge-to-edge plan distance (centreline distance − half widths − unknown-width allowance); the depth envelope of each asset
is taken only over the stretch within the threshold of the other (`test_depth_envelope_is_taken_where_they_meet`); vertical
gap from crown/invert ranges; 3D separation = hypot(plan, vertical). Clearance met when H **or** V meets requirement +
uncertainty; met but inside the uncertainty band → Requires investigation; ordering rules (water above sewer, gas below,
power below telecom) → Potential conflict when reversed. OSM pieces of one metro line are merged into one finding.

### 2.5 Other checks
Buildings (influence zone max(2 m, 1 × invert depth), Insufficient data — foundations unknown, up to 25 listed with
distances; gas C7), nallas / rivers within 5 m (Requires investigation), groundwater (base below the shallowest reading of
the last 5 years at wells within 3 km → Requires investigation; no well → listed under data gaps), boreholes (tunnels /
cut-and-cover: none within 500 m → data gap; logs not reaching the invert → Requires investigation).

### 2.6 Project coordination (backward compatible)
`run_detection` (Projects → Conflicts, `POST /projects/{pid}/detect`) gained side-B layer **`design_object`**: Design-drawn
objects of the baseline and of the scenarios the project's elements belong to (own elements' `element_ref` and
conflict-check registrations are excluded). `ENGINE_VERSION` → 1.2, so earlier runs show `engine_version_changed`.
Old classes and endpoints unchanged. The Underground UI keeps "Share … with a planning project" as a disclosure.

### 2.7 UI
Banner → one-sentence plain summary → "Show findings for" (all objects / one; the open alignment is preselected) →
status count badges (click filters) → groups by severity (Insufficient data collapsed when > 6, 40 per page) → finding
row: title, category, key numbers ("Plan distance 6.7 m (needs 6.0 m) · Vertical: not checkable", "Maha-Metro NOC") → click
= camera flies to the finding (±60 m box) and highlights proposed (magenta) + other asset / buildings (amber), lifted,
no depth test, not pickable (`conflictHighlight.ts`, engine public viewer + `simMode.flyToBounds` only) → detail in the
five fixed parts + rules applied + "Record field verification". Below: the object's checklist, **What wasn't checked**
(always visible), Data used, the rules table. Results are kept per alternative across panel remounts; edits after a check
show "check again".

### 2.8 Insufficient-data grouping and the screening report
- **Grouping** (UNIT-TESTED): every Insufficient-data finding carries `gap_group` {key, label, unit} — its shared reason:
  one dataset whose levels are unusable ("PMC storm-water drains: no depth recorded — vertical clearance not checkable",
  "PMC sewer network: levels have no stated datum — …"), the set of networks with no records ("No water supply, electricity,
  gas (CGD) or telecom records in this area"), a proposed object without depth, building foundations, cover, groundwater,
  geology. The result panel shows one expandable line per reason with its count ("501 crossings or near passes (444 cross
  in plan) · 21 proposed objects"); the 1,283-finding stress run's 1,034 Insufficient-data findings become 5 lines.
  `screeningGroups.ts` falls back to the dataset / category for results without `gap_group`.
- **Report** (UNIT-TESTED, MEASURED): `POST /api/coordination/underground/screen/report?format=pdf|docx|csv` (same body as
  `/screen`; re-runs the check on the objects given; read-only). PDF / DOCX through `feasibility/docgen.py` (fpdf2 /
  python-docx; additive `subhead` block). Contents: header (alternative name + id, date in IST and UTC, engine, rules and
  report versions, banner in every page header, disclaimer box) → summary counts with what each status means + objects →
  Potential conflict / Requires investigation / Verified in full (key numbers, location, Checked / Data used / Found / Not
  checked / Next investigation) → Insufficient data as one table per reason (≤ 150 places each in the PDF) → rules applied
  with sources and how many findings cite each → data used → what was not checked (run list + skipped objects + checklist
  "not checked" items) → next-investigation plan merged over all findings in the Indian order (as-builts → CBuD → GPR →
  trial pits → Maha-Metro NOC → boreholes → specialist; other steps after), with counts and objects. CSV (UTF-8 BOM for
  Excel): `# key,value` preamble (alternative, date, engine, rules version, banner, disclaimer, summary, rules applied, not
  checked, plan) + one row per finding with the five parts (multi-item parts joined by " | "), numbers, location, gap
  group, verification. UI: "PDF report" / "Findings CSV" in the result panel (`ug-report-pdf`, `ug-report-csv`).
  Code: `backend/coordination/screening_report.py`; tests `backend/tests/test_underground_screening_report.py`.
  Time (MEASURED, 2 CPU): 2-object Shivajinagar case 7 pages; 1,283-finding stress run PDF 0.5 MB / ~150 pages in 5.5 s
  render (+ ~2 s screening), CSV 3.1 MB in 0.07 s.

### 2.9 Saved runs (UNIT-TESTED)
- Every full check (`POST /underground/screen` without `focus_ids`) is saved in `underground_screening_runs` (created by
  `create_all`; machine output, not audited): id, alternative id, **inputs hash** (the alternative's underground / metro
  objects — geometry, properties, name; timestamps and display state ignored — plus rule overrides; same hash whether the
  UI sends them or they are read from the database), **data hash** (utility-record datasets), engine + rules versions,
  object / finding counts, summary JSON, and the whole result (findings, layers, rules, geometries) as zlib-compressed JSON
  (`result_json_gz`; the 1,283-finding run is ~0.24 MB). The newest 20 per alternative are kept. The response carries
  `run_id`, `saved_at`, `inputs_hash`.
- `POST /underground/runs/latest` {scenario_id, objects as Design holds them now} → `{run, stale, stale_reasons}`; stale
  when the objects, the utility records or the engine version changed since. `GET /underground/runs?scenario_id=` lists
  saved runs (summary only).
- UI: opening the conflict check with no result in this session loads the last saved run ("Last saved check, <date>"),
  with a **Stale** line and the reasons when it no longer matches; later edits also mark it stale. "Check again" replaces it.
- Code: `backend/coordination/screening_runs.py`, `models.UndergroundScreeningRunEntity`; tests
  `backend/tests/test_underground_screening_runs.py` (save + reopen fresh, stale on object change / add, not stale on
  timestamp-only change, stale on records / engine change, focus runs not saved, pruning, hash equivalence).

## 3. Numbers (MEASURED, copy of twincity.db + real indexes, 2 CPU sandbox)
- All 53,669 utility records (sewer + 9,187 storm drains) parsed + projected + STRtree: **0.6–0.9 s once** per data
  fingerprint (cached); full-extent tree query 5 ms.
- 3 objects near Swargate–Shivajinagar (tunnel, storm drain, water main): 2.1 s cold / 0.8–0.95 s warm.
- 15 km bored tunnel across the city: 7.2 s cold (OSM metro 2.8 s + building index 3.5 s cold reads) / **1.9 s warm**;
  854 existing assets read, 322 findings.
- 20 water mains × 3.3 km: 2.3 s cold / 1.5 s warm; 3,303 assets read, 981 findings. Tunnel + mains: 1.8–2.2 s, 1,283 findings,
  JSON 5.85 MB (geometries hoisted, 0.2 MB; text dominates).
- **gzip** (`GZipMiddleware`, minimum 1 KB, level 6, `backend/main.py`), same 1,283-finding run over HTTP on 8391: **5,854,709 B → 238,979 B on the wire (4.1 %)**; compression 49 ms (level 9: 234,099 B, 62 ms; level 1: 414,222 B, 17 ms); round trip 1.98 s identity vs 2.05 s gzip on localhost — the saving is the 5.6 MB transfer on a real network. Clients without `Accept-Encoding: gzip` get identity. Terrain PNG tiles are also passed through gzip (small, already compressed; harmless).
- Browser (headless Chromium, swiftshader, built app on 4591 + backend 8391): tunnel crossing Pune Metro Line 1 near
  Shivajinagar + a water main → check returns in 2.1–3.3 s; 5 Requires investigation (Metro crossing with NOC, two storm
  drains within the referral distance + QL-D uncertainty, cover 10 m < 2 × 6 m, nalla), 18 Insufficient data; click flies
  the camera to the finding and draws both assets. Screenshots: `/workspace/work/urbanos/shots/underground/checks_*.png`.

## 4. Tests
- `backend/tests/test_underground_screening.py` (26, SYNTHETIC): depth-range gap math; stricter-wins + both cited +
  comparison-only row + ordering; tunnel referral rules; 3D crossing clear vs potential conflict; wrong-way-round; envelope
  where they meet; uncertainty widening; no-datum → not checkable; tunnel specialist vs physical clash; Metro 20 m zone and
  NOC; ladder order; cover per type (normative / guideline / voltage / placeholder); bored-tunnel 2 × D; whole run (statuses,
  banner, Design utility included, proposed × proposed once, data gaps, forbidden words); missing depth + skipped objects;
  empty alternative; QL-A record → potential conflict → person verification → Verified → design edit → re-verify; objects
  read from the DB; `run_detection` sees a Design-drawn gas main (`design_object`).
- `frontend/src/engine/testing/UndergroundScreening.test.ts` (7): statuses / banner / no green / no forbidden words, counts
  and grouping, plain summary, key numbers, highlight targets and focus box, staleness, `sideBLabel` for `design_object`.
- Regression: `test_coordination.py`, `test_infra_data.py`, `test_terrain.py` pass with and without the real data dirs.

## 5. Open issues / not done
- The Underground panel (other agent) mounts `<ConflictCheck a={active} />` only when an alignment is open: a
  utilities-only alternative cannot reach the check. `a` is optional now — mount it unconditionally.
- Findings persisted per run (§2.9) and exported (§2.8). Saved runs are per alternative, not per user.
- Large results (≈1,000 findings) are long; grouping by severity + paging helps, but grouping Insufficient-data pairs per
  dataset would be better. Response gzip: done (see §3).
- Datum: Design depths are relative to local ground; no conversion via the DEM (research §2.3 asks for absolute Z + datum).
- Cable voltage, gas material (steel vs PE), road-crossing locations are not modelled → the stricter or voltage-dependent
  values are reported as "Requires investigation", not decided.
- Owners' own standards, protected monuments, trees, pavement, settlement and construction method are listed as not checked.
- Groundwater uses quarterly manual readings at wells ≥ hundreds of metres away; most of central Pune has no well within
  3 km → data gap.
