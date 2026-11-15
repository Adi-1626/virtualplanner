# Underground Mode — visual fixes

## Charts and legend

Branch `ug-vischart` (2026-11-15). Self-contained section: other sections of this file may come from other branches.

**Legend (Underground panel → View → Legend).** Open by default (it was a collapsed disclosure, so the colours could only be
learnt by clicking lines). Now a compact colour key, `components/underground/UndergroundLegend.tsx`, grouped as:
existing records (PMC sewers, PMC storm drains, other record layers only when some are in the work area, boreholes);
OSM metro tunnel and underground stations "depth not mapped" (dashed purple, plan only); proposed alignments by kind
(bored tunnel, underground metro, cut-and-cover, utility trunk, storm drain); utilities you drew by type; line style = status
(existing, proposed, conceptual, abandoned in place, depth unknown on the surface); highlights (selected = white, the record
you flew to / other asset in a finding = amber `#fbbf24`, your object in a finding = magenta `#e879f9`).
Colours are read from the renderer's exported constants (`RECORD_COLOR`, `UTILITY_COLOR`, `EVIDENCE_ALPHA`) and
`HIGHLIGHT_CSS`; the colours the renderer keeps as private literals (alignment `KIND_COLOR`, metro purple, unknown grey,
borehole yellow) are copied in `components/underground/legendPalette.ts`, and a test reads `UndergroundRenderer.ts` and fails
if they drift. Counts: records per layer in the work area (once loaded), alignments per kind, drawn utilities per type, OSM
metro tunnel ways and underground stations in the model. One quick toggle: "Show metro layer" (the existing engine layer,
which hides elevated and tunnel metro together).
Not done (needs renderer changes, owned elsewhere): per-layer toggles for subsurface records, drawn utilities in Underground
(always drawn there) and proposed alignments, since the renderer exposes no visibility state for its data sources; and
exporting `KIND_COLOR` and the other literals from the renderer so the legend palette has a single source.

**No filesystem paths in the UI.** The Profile / Cross-section 0 m datum line showed
`terrain service unavailable (No elevation_copdem30 DEM under C:\Users\…\derived - run …)`: `/api/terrain` passed the
`DemUnavailable` text (with the server's data folder) through as the 503 detail, and the chart printed the error.
- Charts: `chartLabels.flatDatumLabel` gives a fixed reason only: "Flat datum 0 m (local DEM not loaded) — ground UNKNOWN",
  "… (terrain service unreachable)", "… (outside local DEM coverage)", "… (loading local DEM…)". The alignment and utility
  editors say "Ground level UNKNOWN (local DEM not loaded)".
- Backend: `datasets/public_text.py` (`redact_paths`, `public_path`). `/api/terrain` 503 detail is
  "Local DEM not loaded on this server (terrain dataset not processed); ground is UNKNOWN" (full text to the server log);
  422 details redacted; subsurface-evidence dataset `outputs[].path` relative to the version folder and `notes` redacted;
  coordination/screening `reason` strings redacted; `/api/coordination` dataset `file_name`, `provenance`, `warnings`
  redacted (also covers rows already stored); `pmc_import` writes relative paths; registry version files gain
  `display_path` (relative to the data directory; `path` unchanged because quality checks stat it).
- Frontend guard: `lib/redactPaths.ts` on every API client's error text (coordination, terrain, datasets, env data, infra,
  planning, feasibility, traffic, `ApiError`), the env-data overlay and constraint-layer reasons, Data catalogue files
  (`display_path`), notes and check details, env-data processing file, subsurface dataset warnings, evidence errors.
  Absolute Windows, UNC and POSIX paths become the file name or "a local folder"; URLs, `/api/…` routes, units and relative
  paths are kept.

**Crossing labels.** Overlapping "Road · depth unknown" / "Building · depth unknown" labels in the Profile and
Cross-section: `chartLabels.declutterLabels` groups identical labels within 40 px into one with a count
("Road ×3 · depth unknown"), staggers the rest over up to 3 rows with no overlap in a row (approximate glyph width), keeps
them inside the plot, and the chart header says how many labels were hidden (each crossing keeps its hover title).

Tests: `frontend/src/engine/testing/UndergroundChartsLegend.test.ts` (sanitiser, flat datum label, declutter, legend
entries/colours/counts, legend open by default, palette drift guard); `backend/tests/test_public_paths.py`.
Needs a browser check: legend layout at panel width (two-column grid), white "Selected" swatch contrast on the light theme,
label rows in the Profile/Cross-section with real Pune crossings.

## 3D view: see-through ground, X-ray, hover tooltips, station labels

Reported on Windows Chrome (Pune, Swargate area). Verified in headless Chromium (SwiftShader, 1440 × 900) with real
mouse moves and clicks on a production build; screenshots `urbanos/shots/underground/vis-*.png` (outside the repo). Real
GPU / Windows Chrome was not available.

| # | What was wrong | Root cause | Fix |
|---|---|---|---|
| 1 | At 0 % ground opacity the far side of the Earth (Greenland / North America) showed through the cutaway | `backFaceAlpha` was set to the same value as `frontFaceAlpha`, so the inside of the hollow globe was drawn; the sky box / atmosphere sat behind it | `globe.translucency.backFaceAlpha = 0` (and the `…ByDistance` scalars cleared) at every opacity; scene background a dark neutral `#0b1120`, sky box, atmosphere, sun and moon hidden while in Underground; in the local mode a dark cutaway pit (floor ≥ 45 m and 10 m below the deepest drawn invert, walls, light rim) under the window. All restored on leave |
| 1 | Ground opacity was 0 % on entry for the user | No stored setting exists: the view settings lived in a module singleton for the whole tab, so a slider left at 0 % on an earlier visit came back on the next entry | Every entry into Underground re-applies the defaults (35 %, see-through everywhere on, X-ray off); the work-area rectangle is kept. Nothing is persisted, so there are no stale saved values to migrate |
| 1 | Leaving Underground kept its translucency rectangle and underground colour in Design | Cesium's setters copy into the object the getter returns, so the saved "previous" values were the live objects that apply() then overwrote | `enter()` saves clones |
| 2 | Local see-through showed the world map / far side inside the window; buried lines outside it were drawn over opaque ground | as 1, and the terrain depth test was off whenever the ground was translucent | "See-through everywhere" on by default; the ground is depth-tested unless X-ray is on, so outside the window the city is solid and inside it the pit is a clean subsurface box |
| 3 | X-ray had no visible effect | X-ray only capped the opacity at 50 % and turned off a depth test that translucency had already turned off | X-ray = buried objects drawn through solid ground (terrain depth test off, no forced translucency) and surface buildings faded to 15 % (RenderManager type opacity cap; the user's layer opacities are untouched; cleared on leave) |
| 4 | No hover information | — | `HoverTooltip` (mouse move only, throttled 120 ms, skipped while a button is held or a draw tool is on, hidden when the camera moves): one `scene.pick`, a drill pick 8 deep only when the top hit is not an underground asset. Resolves `ug:<id>:<part>` and `rec:<id>` ids (`hoverInfo.ts`); shows type, name, depth / elevation or "Depth not mapped", status and evidence |
| 5 | Purple station labels stacked (District Court Pink / Purple / Aqua, Civil Court, Kasba Peth, Mandai) | One label per OSM station node, each "<name>: Underground station — depth not mapped", ~45 characters | Station name only (line suffix, "Metro Station" and the second script removed; unnamed import placeholders get none); stations within 250 m share one label ("District Court / Civil Court"); neighbours within 900 m alternate above / below; scale and fade by distance; tunnel label from 3 km only and not within 300 m of a station. The ~400 m tunnel-label dedupe is kept |

Also: the renderer exports its alignment / metro / unknown-depth / borehole / selected colours and `legendPalette.ts`
imports them (the drift test now checks identity); the legend's Show records / alignments / drawn utilities toggles hide the
renderer's data sources (reset on leaving Underground; the to-scale utility meshes drawn by the main renderer are not
affected).

**Verification (headless).** Entry: 35 %, see-through everywhere on, `backFaceAlpha` 0, depth test on. 0 / 35 / 100 %
before and after (`vis-before-op*`, `vis-after-op*`); local window with pit (`vis-local-cutaway-op35`, 3 pit entities;
0 under X-ray); X-ray at 100 % (`vis-after-xray-op100` vs `vis-after-noxray-op100`); tooltips on a PMC sewer, a drawn water
pipe, the Purple Line tunnel, Swargate station and the bored tunnel (`vis-tip-*`); station labels after loading the
District Court–Mandai area (`vis-labels-district-1300m`). Design afterwards: globe translucency, rectangle, underground
colour, background, sky and collision identical to before entering Underground; buildings opaque (`vis-design-after`).
Hover pick cost in SwiftShader: first pick ~2–12 s (pick shader compile), then 20–40 ms for a single pick and 0.2–2 s for a
drill pick — CPU rendering, not representative of a GPU. Tests: `UndergroundVisualFixes.test.ts` (tooltip text, pick-id
resolution, label declutter, defaults on re-entry, back face, restore, legend toggles).

**Not verified:** real Windows Chrome / GPU (look, frame rate, hover latency); labels from below ground converge at the
horizon ("Look from below"); PMC records drawn in Underground stay visible in Design after a visit (unchanged behaviour).
