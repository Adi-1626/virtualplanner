# Projects workspace audit (phase 3, 2026-11-21)

Branch `projects-refine` (worktree `wt-projects-refine`, from next-phase 3e8f65e). Scope: the Projects workspace as a first-time
city planner uses it — create / edit / delete a project, link drawn proposals, the coordination (conflict) view between
agencies' projects, Activity timeline, status, and export to Reports.

Labels: **API-REPRODUCED** (HTTP calls against the backend on a copy of the database), **BROWSER** (real clicks in headless
Chromium + SwiftShader on the built app; timings are headless), **CODE** (read in the source), **UNIT-TESTED** after the fix.
All projects, elements and names used here are **SYNTHETIC**. Backend :8388 on a copy of the env-e2e database (itself a copy of
`backend/twincity.db` with two study-area imports, 17 base metro lines / 12 stations, 1 drawn tunnel and 3 drawn utilities);
static build :4588.

Status column: OPEN (found, not yet fixed) → FIXED (commit) once fixed and verified. All 19 are FIXED (2026-11-21).

## 1. Findings

| # | Area | What a planner sees / what is wrong | Root cause | Evidence | Status |
|---|---|---|---|---|---|
| A1 | Conflicts — duplicates | The Purple Line is listed twice for one tunnel: "Objects drawn in Design: Pune Metro Line 1: Purple Line" and "Existing metro (OpenStreetMap) … Purple Line" | `run_detection` reads the study-area import (base `metro_line` objects with `osmSourceId way/586112436`) as side-B `design_object` **and** the same OSM way from the local OSM index (`osm_way_586112436`). The same way imported by two study areas (clipped pieces `…_in_area_i8g6…`, `…_in_area_sid4…`) can appear a third time. Underground screening (`screening.py`) has the same pair ("… Purple Line" / "… Purple Line (OSM)") | API-REPRODUCED: tunnel across Swargate → `design:osm_m_way_586112436_in_area_i8g6bedp0_0` and `osm_way_586112436`, same for way 1195664032 | FIXED (dad5add, c8dedab) |
| A2 | Conflicts — duplicates | When both projects have run the check, a shared finding is listed twice in each project (once from A's run, once from B's run) | `GET /projects/{pid}/conflicts` returns rows of every project's latest run where the project is side A or B; the pair key is symmetric (`element|x|y`) but rows were not de-duplicated by it | CODE (`project_conflicts`) | FIXED (dad5add) |
| A3 | Conflicts — gap | Utilities drawn in an alternative that is **attached** to the project are not checked unless one of that alternative's objects was registered as an element; a project whose elements carry their own geometry (Underground "Share", or no scenario) only sees drawn objects of the base city | `design_object_segments` reads the base + the scenarios of the project's **elements**, not the scenarios attached to the project | CODE + API-REPRODUCED | FIXED (dad5add) |
| A4 | Linking proposals — wrong depths | A drawn tunnel registered from an alternative becomes kind `other` with depth UNKNOWN although the alternative holds its crown depths and section; a drawn utility with per-point depths is registered with only the shallowest top depth (the legacy summary field), so its z range is too shallow | `draftFromObject` has no `underground_alignment` mapping and reads the legacy `depth` field of utilities | CODE (`lib/planningProjects.ts`) | FIXED (de09fdd) |
| A5 | Projects — delete | A project cannot be deleted (no button, no API) | no `DELETE /api/planning/projects/{id}` | CODE + BROWSER | FIXED (dad5add API, de09fdd UI, 81e1bcf palette) |
| A6 | Projects — edit | Name, purpose and study area cannot be changed after creation (the API accepts name/description; the UI has no edit) | no UI; PATCH has no `area_id` | CODE + BROWSER | FIXED (dad5add API, de09fdd UI) |
| A7 | Activity — lost history | One conflict check writes one audit row per finding (70 rows for one tunnel). The timeline shows "Conflict response created — potential_conflict" 70 times (no person responded), and after a few checks the project's own events (created, attachments, decisions) fall out of the newest-300 window | audit hooks record every `coordination_conflict` insert; the project timeline did not separate system inserts from people's responses; label "Conflict response" for an insert | API-REPRODUCED: 73 events after one check, 70 of them finding inserts | FIXED (dad5add, de09fdd) |
| A8 | Honesty — news-based fact | The seeded metro NOC rule (20 m) cites an Indian Express article (MahaMetro spokesperson). New rule 2026-11-21: no news-based facts in the app | `coordination/seed.py` `_S9` | CODE | FIXED (dad5add, 9c9acf2: UDCPR 2020 cl. 14.2.1.7 + Maha-Metro notice 9549/2026) |
| A9 | Lag with many projects | The project list fires 4 requests per card (project, elements, conflicts, stale); the stale check hashes every other project's elements per run. 41 projects: 164 requests, 8.4 s sequential (API-REPRODUCED). Reports does 3 per project | per-card fetches; no summary endpoint | API-REPRODUCED | FIXED (dad5add endpoint, de09fdd UI) |
| A10 | Status without a name | Clicking a status with no name entered silently does nothing | `onChange={s => who && act(...)}` | CODE | FIXED (de09fdd) |
| A11 | Deleted / unknown other project | A finding shared with a project that no longer exists shows the raw id | `otherSideLabel` falls back to the id | CODE | FIXED (de09fdd) |
| A12 | Shared finding names | "Project “B”" without the element of B that is involved | `otherSideLabel` ignores `evidence.b.name` | CODE | FIXED (de09fdd) |
| A13 | Long finding lists | 70 findings render as 70 expanded rows with a disclosure each (37 of them building footprints) | no paging per class | API-REPRODUCED count; BROWSER | FIXED (de09fdd) |
| A14 | Report buttons | `<a><button>` nested (invalid HTML; two focus stops per export) | OverviewTab | CODE | FIXED (de09fdd) |
| A15 | First use | A first-time planner lands on a name box, a "New planning project" button and "No planning project yet" — no explanation of what to do next (create → attach an alternative → add elements → run the conflict check → export) | no get-started guidance | BROWSER | FIXED (de09fdd) |
| A16 | First use with other agencies | The *Get started* card disappears as soon as any project exists — a new planner whose colleagues at another agency already made projects never sees it (BROWSER: `get-started` absent on first open with 2 other projects, proj-01-first-use) | shown only when `projects.length === 0` | BROWSER + CODE (`PlanningPanel.tsx`) | FIXED (7de96c1) |
| A17 | Two "Your projects" | The right panel titled "Your projects — 38 things you have built" lists drawn objects (roads, buildings), while **Projects** holds planning projects: same word, unrelated things (CODE_UI_AUDIT §4) | InfoPanel title | BROWSER + CODE (`InfoPanel.tsx`) | FIXED (eb1582f): renamed "Your drawn works", subtitle points to Projects |
| A18 | Jargon | Activity rows end in "[request field]", "[record field]" (the audit log's `actor_source` code); the report's audit table shows "[request_field]"; changed fields shown as `status_by`; Reports card says "Inputs: 1 alternatives" | raw codes and fixed plurals in `RecordsTabs.tsx:225`, `report.py`, `ReportsContext.tsx` | BROWSER (proj-05-activity, proj-06-reports) | FIXED (e6ad8b6, 0f6a04d) |
| A19 | Report omits coordination | The project PDF/DOCX had no proposal elements and no conflict-check results; once added, the PDF broke words in narrow columns ("UNKNO/WN", "SYNTHE/TIC") | report model had no section; shared `docgen._col_widths` sized columns by total length only | CODE + API (pdftotext) | FIXED (3c3c77b section 7; 070b50f column widths fit the longest word) |


## 2. Browser walk-through (first-time planner)

BROWSER, headless Chromium + SwiftShader, built app :4588, backend :8388 on the DB copy. Timings are **headless**. Screenshots in
`/workspace/work/urbanos/shots/projects/`.

| Step | Result | Shot |
|---|---|---|
| Open Projects as a new planner while 2 other projects exist | Before: no *Get started* (A16). After: card shown with "The 2 projects listed below were created under other names"; *Hide* removes it; the planner who owns a project does not see it | proj-01-first-use (before), proj-14-get-started-with-other-projects |
| Create, edit name | Created in 2.7 s; Next steps ticks; edit recorded in Activity | proj-02-overview-after-edit |
| Attach alternative; Add proposal elements with the 11 kV cable unticked | 3 works listed with depth ranges (tunnel −15.5 to −9.0 m); "Add 2 elements"; cable stays a drawing | proj-03-add-elements-cable-unticked |
| Run the conflict check | 9.8 s; 135 findings; the gas main of agency B named; Purple Line listed **once** per element ("2 OSM pieces, nearest shown") | proj-04-conflicts, proj-04b-conflicts-purple-line-once |
| Activity | Before: "… [request field]" (A18). After: name only; where it came from is a tooltip; "No name recorded" | proj-05-activity (before), proj-15-activity-plain-words |
| Reports | Before: "Inputs: 1 alternatives". After: "Inputs: 1 alternative · 0 datasets …" | proj-06-reports (before), proj-16-reports-plurals |
| Export PDF / DOCX | 200, valid PDF / DOCX; section 7 present (pdftotext); no source codes; no mid-word breaks after 070b50f | — |
| Delete a throwaway project | Button disabled until the name is typed; list and API agree | proj-07-delete-confirm |
| Right panel in Explore | "Your drawn works" (A17); "Your projects" no longer on screen | proj-13-drawn-works |
| w7 backend down | List says "could not be loaded … Nothing was changed" with *Try again*; after restart, *Try again* lists both projects (the first retry 3 s after restart was too early: the first summary call after a cold start is slow, inferred) | proj-08-backend-down |
| w8 42 projects (40 SYNTHETIC load projects) | List in **1.0 s headless**, **1 request** (`projects-summary`); search, status filter, sort by open conflicts work | proj-09-list-41-projects |
| w9 smoke | Design: road drawn (18,275 → 18,276); Underground: see-through 40 %; Environment: panel loads, no catalogue error; console clean | proj-10/11/12-smoke-* |

## 3. Fixes and verification

| # | Fix | Verification |
|---|---|---|
| A1–A3 | One finding per OSM metro line and element (study-area import = OSM line); shared findings de-duplicated by pair key with responses kept; drawn objects of every attached alternative compared (and part of staleness) | pytest (`test_projects_refine.py`); BROWSER Purple Line once |
| A4 | Drawn tunnels map to tunnel/metro tunnel/utility/drainage with a per-point profile; utilities use per-point depths and diameter | vitest `ProjectsRefine.test.ts` |
| A5, A6 | `DELETE` and `PATCH area_id`; Edit and typed-name Delete in Overview; palette handles a deleted project | pytest + vitest; BROWSER |
| A7 | Finding inserts kept out of the timeline (counted instead); response vs insert worded apart | pytest + vitest; BROWSER |
| A8 | Metro NOC rule cites UDCPR 2020 cl. 14.2.1.7 + Maha-Metro notice 9549/2026; no news citation (scan test) | pytest |
| A9 | `GET /api/coordination/projects-summary`; list and Reports use it | w8: 1 request, 1.0 s headless for 42 projects |
| A10–A15 | Status needs a name (says so); deleted project / element names; 15 findings per class + *Show all*; plain links; Get started + Next steps | vitest; BROWSER |
| A16 | `showGetStarted`: shown until the planner (by self-declared name, case/spacing ignored) has a project, or presses *Hide* | vitest; BROWSER |
| A17 | InfoPanel renamed "Your drawn works" (it lists objects drawn in the open alternative, per CODE_UI_AUDIT §4); Environment hint and docs updated | BROWSER |
| A18 | `actorText`: no `actor_source` codes on screen or in the report audit table; field names without underscores; `plural()` for Reports inputs and the shared-finding count | vitest + pytest; BROWSER |
| A19 | Report section 7 (elements, latest check with stale verdict, class counts, up to 40 conflict / potential-conflict findings, UNKNOWN never 0, findings raised by other projects); PDF column widths fit the longest word | pytest (DOCX text + pdftotext, no broken words); live export |

Gates on this branch: tsc 0 errors; oxlint 0 errors (8 warnings, pre-existing); vite build OK; targeted vitest
(`ProjectsRefine` 24, `ProjectsWorkspace` 10) and targeted pytest (projects_refine, planning, feasibility, underground screening
report: 39) pass. Full vitest and full pytest were skipped at the coordinator's request; they run once on the merged tree.

Uncertainty: names are self-declared, so "the planner's own projects" (A16) is a name match, not an identity; the 070b50f width
change is in the shared `feasibility/docgen.py` and also affects feasibility and Underground PDFs (their tests pass).
