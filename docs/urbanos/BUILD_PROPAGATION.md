# Build propagation: Design changes treated as built

Branch `p6-propagate` (from `640da42`). User requirement: *"make sure the build mode is flawless and the stuff we build is
considered as built in real life, and the data and simulation adapt to it."*

This audit checks, for every buildable thing in Design, that a change made **inside a proposal** reaches every downstream
part as if it had been built, and that the existing city (Base) never changes. Results come from engine-level headless
tests (Vitest, pytest) and from reading the code; each cell names its evidence.

## Honesty notes (read first)

- **The traffic model is not validated.** It is not calibrated to counts (0 of 15 GEH < 5; screen line −30.5 %,
  `DEVELOPER_HANDBOOK.md` §7). The UK TAG M3.1 validation criteria fail without counts. "Simulate uses the build" means
  the build is in the model's network with the right lanes, speed, capacity and connections; it does **not** mean the
  predicted flows are right.
- Capacities are IRC:106-1990 Table 2 design service volumes / 0.7 (mid-block). Free-flow speeds of drawn roads are the
  speed the user set, capped at the alignment design speed (below). Emission factors are European (HBEFA 4) stand-ins.
- Underground screening is screening, not an engineering assessment. Pier foundations are screened with **pile cap size
  and pile depth UNKNOWN**: a flag means "a specialist must look", never a pass or a computed clash.
- Quantities in the report are computed from the drawn design (plan length, pier spacing), not measured.

## Matrix

Legend: **PASS** works and is tested · **FIXED** was wrong, fixed here and tested · **PASS (code)** verified by reading the
code, no new test · **N/A** the thing does not touch that part in real life · **NOT MODELLED** a real-life effect UrbanOS
does not model (listed under Remaining).

Tests: `BP` = `frontend/src/engine/testing/BuildPropagation.test.ts`, `BPy` = `backend/tests/test_build_propagation.py`.

| Buildable thing | a) Simulate network | a) stale result flagged | b) Environment | c) Underground | d) Projects / Reports | e) Base kept, switch, undo, reload |
|---|---|---|---|---|---|---|
| New road (class defaults) | **FIXED** lanes 2+2, 60 km/h, joined at both ends; capacity was undivided, now divided (BP "new road") | PASS (BP Simulate; EditRecompute) | PASS (code): emissions from the simulated comparison, "Model-based · not validated" | N/A (at-grade) | **FIXED** report lists it with length / lanes (BPy report); registrable as element (PASS code) | PASS (BP: base unchanged, base key unchanged) |
| Cross-section template / upgrade of existing road | **FIXED** template lanes reach the network; divided templates (24A–36A) were given undivided capacity (BP "template") | PASS | PASS (code) | N/A | **FIXED** report row "changes an existing object" with the USDG code | PASS (BP: base road keeps 1+1 lanes; undo gives the base network key back) |
| Curved road reshape | PASS longer line, still joined, new key (BP "curved reshape") | PASS (key changes) | PASS (code) | N/A | PASS (code): report length is the reshaped centreline | PASS (BP: undo gives the first key back) |
| Flyover (ramps from grade) | PASS joins only at its two ends, grade-separated over the cross road, own speed (BP "flyover"); **FIXED** capacity: a two-way deck was read as two one-way streets ('2-oneway', ~31 % too high) | PASS | PASS (code) | **FIXED** pier foundations screened (were not checked at all) (BPy) | **FIXED** report: deck height, pier count; **FIXED** project detection sees piers of attached alternatives (BPy) | PASS (BP: base unchanged; undo removes it) |
| Double-deck (road + metro) | PASS road deck in network, grade-separated (BP "double-deck"); **FIXED** capacity as flyover | PASS | PASS (code) | **FIXED** piers screened (BPy) | **FIXED** as flyover | PASS (BP) |
| Metro line (elevated) / station | N/A to the road network (BP "objects that do not carry road traffic"); ridership / mode shift **NOT MODELLED** | N/A | **NOT MODELLED** (no mode shift → no emission change) | PASS existing metro (20 m NOC zone); **FIXED** a *proposed* elevated metro was skipped, now its piers are screened (BPy) | **FIXED** report row with piers; element mapping PASS (code) | PASS (code; ScenarioIsolation) |
| Tunnel / underground alignment | N/A: Design has no road-tunnel tool; kinds are bored tunnel / underground metro / cut-and-cover / utility trunk / storm drain (BP) | N/A | N/A | PASS (existing screening tests) + **FIXED** now also meets drawn flyover piers (BPy) | **FIXED** report row with crown depths and section | PASS (code) |
| Utility | N/A | N/A | N/A | PASS (existing tests) | **FIXED** report row (type, diameter, depth or UNKNOWN) | PASS (code) |
| Junction edit / signal | PASS (code + `JunctionEditing.test.ts`, 29 tests): the context's junctions are the active alternative's (`TwinCityEngine.getSimulationContext`), and they are part of the run fingerprint | PASS (code) | PASS (code) | N/A | **FIXED** report row ("signalised" / "priority") | PASS (code) |
| Lane edit | PASS more lanes → more capacity (BP "lane edit"; `EditRecompute`, `EditScope`) | PASS (`EditRecompute`, `EditScope`) | PASS (code) | N/A | PASS (as "changes an existing object") | PASS (BP; `ScenarioIsolation` incl. reload from the sent changes) |
| Delete / close existing road | PASS gone from the proposal network only (BP "deleting") | PASS (BP Simulate: outdated after the closure) | PASS (code) | N/A | **FIXED** report row "removes an existing object" with its length | PASS (BP: undo gives the key back; base still has the road) |
| Switch proposal ↔ Base | PASS Simulate shows the kept base result on Base and the proposal result back on the proposal, never the other's (BP Simulate) | PASS | PASS (comparison cleared on switch, `SimulateRefine`) | PASS (screening runs are per alternative) | — | PASS |

Underground check staleness: **FIXED** — a check stayed "current" after an object was **deleted** (only newer timestamps
were compared). It now also compares the number of objects the check was sent (`run.objects_count`) (BP).

## What was wrong and what changed

1. **Divided carriageways got undivided capacity** (`engine/simulation/staticAssignment.ts`). The assignment read every
   two-way road as an undivided carriageway; only one-way OSM main roads counted as divided. A drawn arterial (2 m
   divider), a divided USDG template (24A, 30A, 36A) or an OSM road upgraded with one were all given IRC:106
   "4-undivided" capacity. Now a two-way road with a median (its first section profile, else its divider) is a divided
   carriageway pair: 4-lane sub-arterial per direction 2,071 PCU/h instead of 1,714.
2. **Flyover / double-deck decks were one-way streets** (same place). `oneWay` was `true` for every non-`road` object,
   so a two-way 4-lane deck gave each direction the '2-oneway' value (2,714 PCU/h). Decks now use their own `isOneWay`
   and divider (2,071 for the default arterial deck).
3. **Design speed did not reach Simulate** (`engine/simulation/roadParameters.ts`). Changing the alignment design speed
   in the shape editor left the simulated speed at the speed limit. A drawn road's free-flow speed is now its speed limit
   capped at its alignment design speed (defaults are equal, so nothing changes until the user lowers the design speed).
   It is a cap, not "speed = design speed": the design speed is the highest speed the geometry was checked for; the
   operating speed can be lower.
4. **Piers of drawn structures were not in the Underground check** (`backend/coordination/screening.py`,
   `screening_config.py`). Flyovers and double-decks were not read at all; a *proposed* elevated metro was dropped (only
   existing metro was read). They are now screened as `pier_foundation` assets: one point per pier, placed as the 3D view
   places them (first pier half a spacing in, then every `pierSpacing`, only where the deck is ≥ 3 m up; an elevated
   metro along its whole length). New rule **PF1** (pier foundation × any): no Indian numeric norm → referral only
   (`on_breach: specialist`), width and depth UNKNOWN. Cover is "not checked" for piers. Existing (Base-drawn) decks are
   obstacles for proposed tunnels/utilities. `CONFIG_VERSION` and `ENGINE` bumped. Frontend sends flyovers / double-decks
   with the check (`ConflictCheck.tsx`) and counts a flyover drawn in the proposal as proposed (`conflictClasses.ts`).
5. **Project detection** (`backend/coordination/service.py`) reads the same pier assets for attached alternatives
   (kind `pier`).
6. **Reports had no quantities of what an alternative builds** (`backend/planning/report.py`, new
   `backend/planning/quantities.py`). Section 4 now has, per attached alternative, "Built works in this alternative":
   one row per added / changed / removed object with plan length, lanes, level (deck height or depth), piers and detail,
   plus new-works totals (km per type, new piers) and a note that values are computed, not measured.
7. **Stale Underground result after a deletion** (`conflictClasses.isStale`, `ConflictCheck.tsx`, `coordinationApi.ts`).

## Remaining (not fixed here)

- **Metro ridership and mode shift are not modelled**: a new metro line or station does not change road demand or
  emissions. Needs a mode-choice model and transit demand data.
- **Noise and air dispersion are not modelled**: Environment shows only the relative change of traffic emissions from a
  Simulate comparison. Noise (e.g. CNOSSOS-EU / CRTN) and dispersion need a model and Pune monitoring data to check it.
- **Recompute is on request**: after a build, Simulate marks the result outdated and Environment's comparison is cleared;
  the user presses Compare / Run again. Nothing is recomputed silently, and nothing stale is shown as current.
- **Road tunnels**: there is no drawing tool for a road (vehicle) tunnel; Underground alignments are not drivable.
- **Per-chainage sections**: the network, lane edits and templates all use a road's first section profile; a road with
  different profiles along its length uses the first one throughout (consistent, but coarse).
- **Projects**: decks and roads of an attached alternative are checked only when registered as proposal elements (their
  piers are now read automatically); the Projects UI does not show quantities (the report does).
- **Pier foundations**: pile cap size, pile depth and the actual pier positions are design inputs UrbanOS does not hold.

## Overlaps with parallel branches

- `p6-qa` (browser QA of Underground / Environment / Simulate / Projects / Reports): this branch changes the Underground
  check's object set (flyovers / double-decks now sent, new finding kind `pier_foundation`, rule PF1) and its stale
  marker, and adds a table to report section 4. QA screenshots of those screens taken before the merge will differ.
- `p6-fixes` (Design UI items, incl. flyover metro clearance and road length): not touched here. The report's plan
  length (`quantities.plan_length_m`, haversine) is independent of any Design road-length display.

## Tests run

- Vitest (`--pool=threads --maxWorkers=1`): `BuildPropagation.test.ts` 11/11, plus the simulation, scenario,
  editing, underground, projects and environment files that touch the changed code (52 more files, all passing; 4 skipped
  are the pre-existing opt-in real-area tests).
- pytest: `tests/test_build_propagation.py` 8/8; whole `backend/tests` 438 passed, 3 skipped.
- `npx tsc --noEmit -p tsconfig.app.json`: clean. oxlint on changed files: clean.
