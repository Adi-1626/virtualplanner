# Projects workspace audit (phase 3, 2026-11-21)

Branch `projects-refine` (worktree `wt-projects-refine`, from next-phase 3e8f65e). Scope: the Projects workspace as a first-time
city planner uses it — create / edit / delete a project, link drawn proposals, the coordination (conflict) view between
agencies' projects, Activity timeline, status, and export to Reports.

Labels: **API-REPRODUCED** (HTTP calls against the backend on a copy of the database), **BROWSER** (real clicks in headless
Chromium + SwiftShader on the built app; timings are headless), **CODE** (read in the source), **UNIT-TESTED** after the fix.
All projects, elements and names used here are **SYNTHETIC**. Backend :8388 on a copy of the env-e2e database (itself a copy of
`backend/twincity.db` with two study-area imports, 17 base metro lines / 12 stations, 1 drawn tunnel and 3 drawn utilities);
static build :4588.

Status column: OPEN (found, not yet fixed) → FIXED (commit) once fixed and verified.

## 1. Findings

| # | Area | What a planner sees / what is wrong | Root cause | Evidence | Status |
|---|---|---|---|---|---|
| A1 | Conflicts — duplicates | The Purple Line is listed twice for one tunnel: "Objects drawn in Design: Pune Metro Line 1: Purple Line" and "Existing metro (OpenStreetMap) … Purple Line" | `run_detection` reads the study-area import (base `metro_line` objects with `osmSourceId way/586112436`) as side-B `design_object` **and** the same OSM way from the local OSM index (`osm_way_586112436`). The same way imported by two study areas (clipped pieces `…_in_area_i8g6…`, `…_in_area_sid4…`) can appear a third time. Underground screening (`screening.py`) has the same pair ("… Purple Line" / "… Purple Line (OSM)") | API-REPRODUCED: tunnel across Swargate → `design:osm_m_way_586112436_in_area_i8g6bedp0_0` and `osm_way_586112436`, same for way 1195664032 | OPEN |
| A2 | Conflicts — duplicates | When both projects have run the check, a shared finding is listed twice in each project (once from A's run, once from B's run) | `GET /projects/{pid}/conflicts` returns rows of every project's latest run where the project is side A or B; the pair key is symmetric (`element|x|y`) but rows were not de-duplicated by it | CODE (`project_conflicts`) | OPEN |
| A3 | Conflicts — gap | Utilities drawn in an alternative that is **attached** to the project are not checked unless one of that alternative's objects was registered as an element; a project whose elements carry their own geometry (Underground "Share", or no scenario) only sees drawn objects of the base city | `design_object_segments` reads the base + the scenarios of the project's **elements**, not the scenarios attached to the project | CODE + API-REPRODUCED | OPEN |
| A4 | Linking proposals — wrong depths | A drawn tunnel registered from an alternative becomes kind `other` with depth UNKNOWN although the alternative holds its crown depths and section; a drawn utility with per-point depths is registered with only the shallowest top depth (the legacy summary field), so its z range is too shallow | `draftFromObject` has no `underground_alignment` mapping and reads the legacy `depth` field of utilities | CODE (`lib/planningProjects.ts`) | OPEN |
| A5 | Projects — delete | A project cannot be deleted (no button, no API) | no `DELETE /api/planning/projects/{id}` | CODE + BROWSER | OPEN |
| A6 | Projects — edit | Name, purpose and study area cannot be changed after creation (the API accepts name/description; the UI has no edit) | no UI; PATCH has no `area_id` | CODE + BROWSER | OPEN |
| A7 | Activity — lost history | One conflict check writes one audit row per finding (70 rows for one tunnel). The timeline shows "Conflict response created — potential_conflict" 70 times (no person responded), and after a few checks the project's own events (created, attachments, decisions) fall out of the newest-300 window | audit hooks record every `coordination_conflict` insert; the project timeline did not separate system inserts from people's responses; label "Conflict response" for an insert | API-REPRODUCED: 73 events after one check, 70 of them finding inserts | OPEN |
| A8 | Honesty — news-based fact | The seeded metro NOC rule (20 m) cites an Indian Express article (MahaMetro spokesperson). New rule 2026-11-21: no news-based facts in the app | `coordination/seed.py` `_S9` | CODE | OPEN |
| A9 | Lag with many projects | The project list fires 4 requests per card (project, elements, conflicts, stale); the stale check hashes every other project's elements per run. 41 projects: 164 requests, 8.4 s sequential (API-REPRODUCED). Reports does 3 per project | per-card fetches; no summary endpoint | API-REPRODUCED | OPEN |
| A10 | Status without a name | Clicking a status with no name entered silently does nothing | `onChange={s => who && act(...)}` | CODE | OPEN |
| A11 | Deleted / unknown other project | A finding shared with a project that no longer exists shows the raw id | `otherSideLabel` falls back to the id | CODE | OPEN |
| A12 | Shared finding names | "Project “B”" without the element of B that is involved | `otherSideLabel` ignores `evidence.b.name` | CODE | OPEN |
| A13 | Long finding lists | 70 findings render as 70 expanded rows with a disclosure each (37 of them building footprints) | no paging per class | API-REPRODUCED count; BROWSER | OPEN |
| A14 | Report buttons | `<a><button>` nested (invalid HTML; two focus stops per export) | OverviewTab | CODE | OPEN |
| A15 | First use | A first-time planner lands on a name box, a "New planning project" button and "No planning project yet" — no explanation of what to do next (create → attach an alternative → add elements → run the conflict check → export) | no get-started guidance | BROWSER | OPEN |

(Browser walk-through results are added in §2 as they are run.)

## 2. Browser walk-through (first-time planner)

Pending.

## 3. Fixes and verification

Pending.
