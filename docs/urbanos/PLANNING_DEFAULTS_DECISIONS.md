# Planning defaults — decisions (2026-11-22)

UrbanOS is decision-support for Pune authorities (PMC, PCMC, Maha-Metro, PMRDA). Every default below comes from a
published standard, is shown as **screening** (never safety, feasibility, compliance or approval), and anything without a
source is labelled **assumed** or left **unknown**. Defaults apply to **new** objects; existing objects keep their stored
values. Branch `p4-defaults` (from `ba7a003`).

How sources were read: PDFs only by code (`pdftotext`). OCR (`pdftoppm` + `tesseract`) was used only for IRC:SP:90-2023
pages 39, 41 and 42, whose tables are scanned images without usable text. No news sources were used.

**About "official".** IRC codes are sold by the Indian Roads Congress (irc.nic.in catalogue lists IRC:86-2018,
IRC:SP:90-2023, IRC:65-2017, IRC:SP:41-1994), and IRC hosts no free copy. The IRC texts were read from the
Public.Resource.Org mirror (law.resource.org). That is a third-party copy of the official text, so each IRC value is marked
**"IRC text, third-party copy — unconfirmed against an IRC-issued copy"**. PMC and MoHUA documents were read from government
sites and are marked **official**.

## Sources

| Key | Document | URL | Status |
|---|---|---|---|
| IRC86 | IRC:86-2018 *Geometric Design Standards for Urban Roads and Streets* (1st revision, Nov 2018) | https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf (edition and price confirmed in the IRC catalogue https://irc.nic.in/WriteReadData/LINKS/Catalogue%20Updated%2009%20July,%20%202025%20(1)2aaca7ba-f12e-4931-8fd7-39dfb20199f6.pdf, item 70) | IRC text, third-party copy (unconfirmed) |
| SP90-23 | IRC:SP:90-2023 *Guidelines for Grade Separators and Elevated Structures* (1st revision, July 2023) — **current edition** (IRC catalogue item 194) | https://law.resource.org/pub/in/bis/irc/irc.gov.in.sp.142.2024.pdf (the file name is the mirror's; the title page reads IRC:SP:90-2023) | IRC text, third-party copy (unconfirmed) |
| SP90-10 | IRC:SP:90-2010 *Manual for Grade Separators and Elevated Structures* — **superseded** by SP90-23 | https://law.resource.org/pub/in/bis/irc/irc.gov.in.sp.090.2010.pdf | superseded |
| USDG | *Urban Street Design Guidelines, Pune*, Pune Municipal Corporation, Version I: 2016 | https://pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf | **official (PMC)** |
| CPHEEO-W | CPHEEO *Manual on Water Supply and Treatment Systems (Drink from Tap)*, Part A, Mar 2024, ch. 12 | official landing page https://mohua.gov.in/publication/manual-on-water-supply-and-treatment-systems---drink-from-tap---march-2024.php (the 61 MB PDF link now returns an HTML page); ch. 12 read from https://www.civilapps.in/files/Technical%20Publications/CPHEE/Part-A-Engineering/12-Service%20Reservoirs%20-%20Distribution%20System.pdf | third-party chapter copy; §12.9 values **confirmed** in MOHUA-ADV |
| MOHUA-ADV | MoHUA *Advisory on Water Quality in Distribution Systems* (Feb 2026), §1.3 Separation norms | https://mohua.gov.in/static/uploads/2026/03/1f50bd8f27197b40e6e472b5b86f4b8a.pdf | **official (MoHUA)** |
| SSR | Maharashtra PWD *State Schedule of Rates 2022-23* (effective 25-07-2022; still the current edition) | https://pwd.maharashtra.gov.in/en/publication/state-schedule-of-rate-2022-2023 | official — for later cost work, not used yet |

Local copies (scratch, not committed): `work/cs2-refs/irc86_2018.{pdf,txt}`, `work/cs2-refs/usdg.{pdf,txt}`,
`work/geometry-refs/irc.sp.090.2010.txt`, `work/p4-refs/irc.sp.090.2023.{pdf,txt}`,
`/workspace/work/underground-research/src/ch12.txt`.

## Decisions table

| # | Decision | Value | Source (clause, page) | Status |
|---|---|---|---|---|
| D1 | Design speeds (new alignments) | highway 80 · arterial 60 · collector 40 · local 30 km/h; flyover/double-deck = class speed; posted speed limit of new roads = design speed | IRC86 §3.2 **Table 3.1**, plain terrain (printed p. 5, PDF p. 13): urban expressway 80, arterial 60, sub-arterial 60, collector 40, local 30. IRC86 §3.3: posted speed may be **lower** than the design speed. SP90-23 §4.9 **Table 4.3** (PDF p. 39, OCR): urban grade-separator design speeds = IRC:86 Table 3.1 | IRC text (unconfirmed copy) |
| D2 | Footpath default width (new roads) | **2.0 m** (arterial, collector, local); none on highway | USDG §3.1 Footpath, p. 7 (PDF p. 20): "clear and unobstructed minimum walking zone of 2m". Floor: IRC86 §5.1 **Table 5.1** (PDF p. 15): pedestrian zone ≥ 1.8 m residential, 2.5 m commercial, 4.0 m high-intensity commercial | **official (PMC)**; IRC floor unconfirmed copy |
| D3 | Superelevation cap used by the radius screen | **4 %** surface roads (default), 7 % selectable as the non-urban option; **7 %** on flyover decks | IRC86 §8.2.1 (printed p. 26, PDF p. 34): limit 7 %, "on urban sections with frequent intersections ... desirable to limit the super elevation to 4 per cent". Radii from IRC86 §8.3 **Table 8.2** (PDF p. 37). Decks: SP90-23 §4.12.2 (PDF p. 41): 7 % if R < desirable minimum, 5 % at/above it on urban sections or major junctions, 4 % on urban sections with frequent intersections | IRC text (unconfirmed copy) |
| D4 | Transition spirals | **not in this phase** | IRC86 §8.1 / §8.5 expect spirals; required Ls reported instead (Table 8.3) | — |
| D5 | Flyover approach (ramp) gradient | **4 %** urban roads, **3.3 %** highway — screening on new/edited designs; as-built flyovers information only, never changed | SP90-23 §4.13 (PDF p. 42): urban roads "a gradient of 4 percent should be considered the maximum as per IRC:86" (= IRC86 §9.2, PDF p. 40); highways Table 4.12 (OCR) plain & rolling ruling 2.5 %, **limiting 3.3 %**, "gradient steeper than limiting gradient should be avoided". **Changed from the requested 3.5 %**: that cap is SP90-10 §6.14, superseded in July 2023; the 2023 revision has no 3.5 % rule | IRC text (unconfirmed copy) |
| D6 | Cut-and-cover fallback curve radius; flyover min flat deck | **50 m** and **50 m**, both labelled "**assumed, no official figure**"; deck check can only warn | No radius for cut-and-cover in IRC86, SP90-10, SP90-23 (its cut-and-cover clauses are about construction method, not curve geometry) or the Pune S–K DPR. No minimum deck length in SP90-10 or SP90-23 (SP90-10 §9.1 is a ≥ 15 m straight approach, a different rule) | assumed |
| D7 | Water–sewer separation (Underground checks) | **3.0 m horizontal**; **0.5 m vertical**, water main above, kept for 3 m each side of the crossing. (The IRC:98 draft 1.0 m vertical guideline stays as the stricter guideline row.) | CPHEEO-W §12.9.1 and §12.9.2 (ch. 12 p. 695), **restated in MOHUA-ADV §1.3** (official). CPHEEO-W §12.2(c) "at least one metre above the sewer lines" is seen only in the third-party chapter copy → comparison-only row C2c, **unconfirmed** | **official** (MoHUA) |
| D8 | Deleting a project | Its conflict-check findings are **archived with it**: rows kept (machine output is immutable), `archive` audit entries, removed from every active view; other projects' findings against its elements are archived too; readable at `GET /api/coordination/archived-findings?project_id=` | Product rule (decision-support audit trail) | — |
| D9 | OSM reference overlays in Design | **Hidden by default** (already so in code: shown only in Environment and Explore) | Product goal: Design shows the proposal on the baseline; constraint overlays are evidence views (Environment/Explore) and the coordination screen still uses them | — |
| D10 | CS2-inspired tools | keep standards-backed planning tools; drop game mechanics; costs later from SSR | see §D10 | — |
| D11 | Street cross-section templates, checks, upgrade (D10 items 1–3) | 5 Pune USDG templates (12/18/24/30/36 m, "A" variants) + screening checks against IRC86 / USDG; built in `p5-xsection` | see [CROSS_SECTIONS.md](CROSS_SECTIONS.md) | USDG official (PMC); IRC unconfirmed copy |

## D1 Design speeds
- `GEOMETRY_DEFAULTS.roadDesignSpeedKmh` = `{ highway: 80, arterial: 60, collector: 40, local: 30 }` (was 80/80/50/30 from
  IRC:86-1983 Table 1, superseded in 2018). The model has no sub-arterial class; IRC86 gives it the same 60 km/h as arterial.
- `highway` is treated as an **urban expressway** (Table 3.1 row 1) with IRC:86 urban criteria; the rural `irc73-rural`
  criteria stay in the engine for alignments already stored with them (IRC:73 has itself been revised to IRC:73-2023, not read).
- Flyover / double-deck design speed = the class speed (was 100/80/60/40 with no source). SP90-23 Table 4.3 reproduces
  IRC86 Table 3.1 for urban areas. A different value is set per object.
- `ROAD_CLASS_DEFAULTS.speedLimit` and `.flyoverSpeed` for new roads now equal the design speed (was 100/70/50/40 and
  100/80/60/40): IRC86 §3.3 allows the posted speed to be lower than the design speed, so a default above it is not
  defensible. This changes the simulated speed of **newly drawn** roads only; OSM roads keep their tagged or class speed.
- Criteria tables moved to IRC86 2018 wording and added rows: Table 8.2 radii (adds 20/40/70 km/h; values for 30/50/60/80
  unchanged), Table 7.1 SSD, Table 9.1 / §9.2 gradients, Table 9.2 vertical curves (adds 20 and 70 km/h). The transition
  formula is unchanged and matches IRC86 Table 8.3 (80 km/h R 250 → 85 m; 60 km/h R 150 → 65 m). IRC86 §8.5 formula
  images have no text layer; the values were checked against Table 8.3.

## D2 Footpath
- Default 2.0 m because an official PMC copy of the Pune USDG exists (pmc.gov.in). It is above the IRC86 1.8 m floor.
- `footpathWidth` is treated as the clear walking zone. USDG frontage (0.5–1 m) and multi-utility zone are extra width,
  not part of this default.
- Commercial (2.5 m) and high-intensity (4.0 m) minimums are left to the planned cross-section screening; they are not
  defaulted because the land use is not known when a road is drawn.

## D3 Superelevation
- Surface roads 4 % (IRC86 §8.2.1). 7 % stays selectable in the Alignment panel, now labelled "7 % (non-urban / deck)".
- Flyover decks 7 % for the minimum-radius screen. SP90-23 §4.12.2 allows 7 % exactly where the radius is below the
  desirable minimum, which is the case the screen tests. The 5 % and 4 % urban caps apply at or above the desirable radius.
  **Not modelled:** the desirable-minimum split itself.

## D4 Spirals (not in this phase)
Circular curves only, with a "transition not modelled" note and the transition length the curve would need (IRC86 §8.5 /
Table 8.3). Why: at urban design speeds (30–60 km/h) Table 8.3 gives "NR" (transition not required) from R 250 m at
30 km/h, 300 m at 40, 500 m at 50 and 800 m at 60 km/h, and 15–45 m below that down to R 100–150 m. Clothoids change the fit rule (T = (R+p)·tan(Δ/2)+k), the handles and the stored-geometry migration,
and the surface shape changes little. The screen never claims a curve is complete without one. Spirals stay a geometry
phase-3 item (`GEOMETRY_DEFAULTS.spiralsEnabled = false`).

## D5 Flyover approach gradient
- The requested 3.5 % came from SP90-10 §6.14 ("in any case gradient greater than 3.5 percent should not be provided").
  The current SP90-23 (July 2023) replaced it in §4.13: ruling gradient as far as possible, "steeper than limiting gradient
  should be avoided", and for urban roads "4 percent should be considered the maximum as per IRC:86". The screen therefore
  uses **4 % urban / 3.3 % highway**. A 6 m rise needs 150 m of ramp at 4 % and 182 m at 3.3 % (the old check used 120 m at
  an unsourced 5 %).
- **New or edited designs:** the ramp check passes or fails (screening). **As-built flyovers** (OSM / municipal / surveyed
  source, geometry not edited here; `isAsBuiltFlyover`) get every check as `info`. "As-built · information only" is shown,
  nothing fails, no surface-road capacity is changed, and the object is never reshaped. In today's model, existing Pune
  flyovers come in as OSM bridge roads and never enter this check at all. The guard covers any mapped flyover object.
- **Not changed:** the drawn 3D ramp shape (legacy 40 m, `flyoverHelper.ts`). It is a picture. Grade-driven ramp geometry
  stays geometry phase 3.

## D6 Assumed values
- Cut-and-cover fallback radius **50 m**, `FALLBACK_AUTO_RADIUS_LABEL = 'assumed, no official figure'`. The radius that
  governs is the one for what the box carries (road: IRC86 Table 8.2; metro: project DPR). The curve is reported "not
  checked" and the message names the 50 m as assumed.
- Flyover minimum flat deck **50 m**, labelled assumed (it was wrongly cited "IRC:SP-73", the two-laning manual). A short
  deck is now `warn` ("a prompt to look, not a blocker"), never `fail`.

## D7 Water–sewer separation
- Rules C1 (3.0 m H) and C2 (0.5 m V, water above) keep CPHEEO-W §12.9.1/§12.9.2 as source and now carry
  `confirmed_in: MoHUA Advisory ... (Feb 2026) §1.3`, shown in the rule citations.
- New comparison-only row **C2c**: 1.0 m V from CPHEEO-W §12.2(c), marked `[UNCONFIRMED: read only in a third-party chapter
  copy]`. It never sets a status.
- Effective requirement unchanged: 3.0 m H / 1.0 m V. The 1.0 m V comes from the IRC:98-2024 draft guideline row (stricter
  wins, both cited). A breach of the normative 0.5 m is a Potential conflict; one between 0.5 m and 1.0 m is Requires
  investigation (existing engine logic).
- `CONFIG_VERSION` bumped, so saved underground screenings show as stale against the new rule set.

## D8 Project deletion and findings
- **Before:** deleting a project hard-deleted its own runs and findings and kept only a one-line audit summary. Other
  projects' findings against its elements stayed in their **active** lists, reports and CSV as "a deleted project". That was
  the stale-findings bug.
- **Now:** run and finding rows are kept (immutable machine output). Audit: `archive` on `coordination_run` (this project:
  run and finding counts) and one `archive` on `coordination_conflict` per other project with findings against it.
  `_latest_runs` only takes live projects, and `_active_findings` drops findings whose side A or B is a deleted project.
  These feed project conflicts, projects summary, the PDF/DOCX report and the CSV export. Archived findings are read-only
  at `GET /api/coordination/archived-findings?project_id=…` (409 while the project exists). The delete response adds
  `findings_archived`, `findings_archived_elsewhere`. The UI delete text and Activity wording ("Findings archived — …") were
  updated.

## D9 OSM reference overlays in Design
Kept hidden in Design (`ENV_WORKSPACES = {environment, explore}`, `envPerf.ts`). Design is where a proposal is drawn on
the baseline. The OSM water / heritage / railway overlays are evidence layers, read in Environment / Explore. The
coordination screen uses them whatever is shown. A test now pins this.

## D10 CS2-inspired tools: fit for decision support
Keep (each needs a cited standard and the same screening wording):
1. **Cross-section templates** by Pune USDG street type / IRC86 (Table 5.1 footpaths, 3.5 m lanes, §5.6 medians) —
   labelled "screening template".
2. **Cross-section screening** (footpath < 1.8/2.5/4.0 m, cycle track < 2/3 m, lane < 3.5 m, median < 1.2 m, BRT < 7 m).
3. **Upgrade brush** for retrofits ("complete street" along an existing road) as a profile edit, copy-on-write.
4. **Junction design templates** per IRC:SP:41-1994 *Design of At-Grade Intersections* (in IRC catalogue; text not read
   this phase). Interchanges per IRC:92-2017 *Interchanges in Urban Areas* (not read).
5. **Roundabouts** per IRC:65-2017 *Planning and Design of Roundabouts* (not read; values to be taken from it before
   building).
6. **Bus stop / BRT placement checks**: MoUD CoP-1 §5.9 spacing, USDG stop rules, IRC:124-2017 *BRT Design Guidelines*
   (not read).
7. **Elevation while drawing** with the D5 grades and a clearance check (vertical clearance standard still to read).
8. **Pedestrian / cycle paths**: IRC86 §5, IRC:103-2022 *Pedestrian Facilities*, IRC:11-2015 cycle tracks.

Drop (game mechanics, no standard, or the wrong decision frame): money and city budget and income, upkeep as gameplay,
zoning growth and demand bars, citizen happiness, auto-traffic AI as the judge of a design (Simulate already runs SUMO with
stated assumptions), "premade" decorative intersections with no geometry rules, instant build and demolition costs, and
progression or unlocks.

Costs: **later**, only as quantities × Maharashtra PWD SSR 2022-23 rates, with item numbers and the effective date shown.
SSR 2022-23 is still the current edition. No cost readout until then (quantities only).

## What changed in code
Frontend (`frontend/src/`):
- `engine/geometry/alignment/criteria.ts`: IRC86 2018 tables and sources (Table 3.1, 8.2, 7.1, 9.1/§9.2, 9.2; §8.2.1, §8.3,
  §8.5); `IRC_SP90` marked superseded; new `IRC_SP90_2023` (§4.12.2, §4.13 / Table 4.12); `FALLBACK_AUTO_RADIUS_M` and
  `FALLBACK_AUTO_RADIUS_LABEL` moved here.
- `engine/geometry/alignment/defaults.ts`: D1 speeds, D3 caps with citations, highway → IRC:86 urban criteria.
- `engine/geometry/alignment/checks.ts`: 2018 citations; the no-criteria message names the assumed 50 m radius.
- `engine/geometry/alignment/types.ts`, `engine/editing/AlignmentEditor.ts`: citation comments.
- `engine/editing/drawConstraints.ts`: re-exports the fallback radius and its label.
- `engine/editing/EditingEngine.ts`: `ROAD_CLASS_DEFAULTS` (2.0 m footpaths; speed limit and flyover speed = design speed).
- `engine/simulation/BridgeFeasibilityEngine.ts`: `maxRampGrade(roadClass)` 4 % / 3.3 % (SP90-23 §4.13); `info` status;
  `asBuilt` option and `isAsBuiltFlyover`; deck check `warn` with assumed label; exported constants.
- `engine/objects/ObjectManager.ts` (`flyoverFeasibility(obj, { edited })`, passes `roadClass`, `asBuilt`),
  `engine/editing/geometryCommit.ts` (edits screened as designs), `engine/objects/flyoverHelper.ts` (comment).
- `components/PropertiesPanel.tsx`: `info` icon and colour, "As-built · information only".
- `components/design/AlignmentPanel.tsx`: 70 km/h option; e-max labels and tooltip; transition citation.
- `components/projects/OverviewTab.tsx`, `components/projects/projectData.ts`, `lib/planningProjects.ts`: delete wording,
  `archive` action labels.

Backend (`backend/`):
- `coordination/screening_config.py`: `MOHUA_ADV`, `confirmed_in` on C1/C2, comparison row C2c, citation passes
  `confirmed_in`, `CONFIG_VERSION` bumped.
- `api/planning_router.py`: `delete_project` archives instead of destroying findings.
- `api/coordination_router.py`: `_live_project_ids`, `_latest_runs` (live only), `_active_findings`, filters in
  `project_conflicts` / `projects_summary`, new `GET /archived-findings`.

Tests:
- Vitest: `engine/testing/PlanningDefaults.test.ts` (new), `BridgeFeasibility.test.ts`, `GeometryCriteriaChecks.test.ts`,
  `GeometryMigration.test.ts` (updated).
- Pytest: `tests/test_projects_refine.py` (delete archives findings, active views clean, archived endpoint, audit
  entries), `tests/test_underground_screening.py` (C2c comparison row, new MoHUA confirmation test).

## Open / not done
- IRC texts are third-party copies; confirm against IRC-issued copies before any external use.
- IRC:73-2023 (non-urban) is not read; the `irc73-rural` criteria still cite IRC:73-1980 and are no longer a default.
- IRC:SP:41, IRC:65, IRC:92, IRC:124, IRC:103 are not read; D10 tools must take their values from them before being built.
- The vertical clearance standard under flyovers is still not read (T3 in TRANSPORT_TOOLS_CS2_RESEARCH.md).
- Grade-driven 3D ramps, spirals and the SP90-23 5 %/7 % desirable-radius split are geometry phase 3.
