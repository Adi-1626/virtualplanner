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
