# Design workspace — refinement notes (2026-11-15)

Scope of this file's sections written by the study-area work (branch `dr-studyarea`): **Points layer**, **Study Area**, **Data sources (Overpass fallback and cache)**. The control inventory of the individual drawing tools is written by the design-tools work; the full data-source research (licences, coverage, API limits of every source) is in [DESIGN_DATA_SOURCES.md](DESIGN_DATA_SOURCES.md).

## Points layer ("Junction points")

**What the user saw.** Thousands of yellow / green / orange / red / purple dots joined by white arrow lines over the whole city (screenshots of 2026-11-15, Explore and Underground). These came from one layer: `traffic_network_debug`, labelled "Show Traffic Network" in Explore → Layers → Simulation (`engine/rendering/renderers/TrafficNetworkVisualizer.ts`). It drew **one Cesium Entity per traffic-network node** (coloured by how many road ids meet: yellow dead end, green 2, orange 3, red 4, purple 5+) **plus one arrow-polyline Entity per directed edge**. With the full Pune base network loaded (18,273 road pieces) that is **90,736 entities**. It was off by default but nothing remembered the choice and nothing in Design exposed it; once switched on (it sits in the layer tree of every workspace) it stayed on for the session.

**Change.**
- Renamed **Junction points**, moved to Explore → Transport (next to "Junctions & signals") and added as a toggle in **Design → Map** (with a colour legend and the live point count). Tooltip says what it shows and why it is off.
- **Off by default; choice remembered** on the device (`localStorage` key `urbanos.layer.traffic_network_debug.visible`, `engine/layers/LayerManager.ts`, `PERSISTED_LAYERS`).
- **Off really means nothing is created**: the point collection is removed and destroyed (`TrafficNetworkVisualizer.clear()`), and no network is requested while the layer is off.
- **On is cheap**: one `PointPrimitiveCollection` (a single draw call) instead of entities; only real junctions are drawn (T, X, 5+ arms, roundabout entries, dead ends) — plain link nodes (two pieces joined end to end, which were the green majority) and the arrow edges are no longer drawn. Arms are counted as distinct neighbouring nodes, so a side road joining the middle of another road is now a T (the old count by road id called it a 2-way link). Points shrink with distance and are hidden above 9 km.

**Measured** (same machine, same data copy of `twincity.db`: 20,732 objects, Explore, top-down view over Karve Road at 2.5 km; headless Chromium + SwiftShader software GL on a shared 2-CPU box, so absolute frame times are pessimistic and noisy — compare before/after only):

| State | Entities in data sources | Point primitives | Mean frame time | FPS |
|---|---|---|---|---|
| Before, layer off | 0 | 0 | 86.5 ms | 11.6 |
| Before, layer on (the user's state) | 90,736 | 0 | 202.8 ms | 4.9 |
| After, layer off (default) | _see below_ | | | |
| After, layer on | | | | |

## Study Area

**History — why it seemed gone.**
- 2026-10-08 (`1efcca9`, "simulation v1.1"): the toolbar tool `import_osm` was **"Create Study Area and Import Infrastructure"** (short "Draw area", Globe icon).
- 2026-11-02 (`af5a98d`): renamed "Draw Area and Map Selected Area (import infrastructure)" and given "Map Selected Area" (cut roads at the boundary).
- 2026-11-13 (`90e71dd`, UrbanOS palette): renamed **"Import area (OSM)"**, short "Import area", Download icon, moved into the **last** palette group "Data" below Gateway, and its flow became draw → "Map Selected Area" → **name dialog with checkboxes** → full-screen blurred modal. The engine still worked, but the tool no longer looked like "draw a study area" and was easy to miss.
- On a fresh clone (the user's Windows PC) `backend/data/osm/osm_index.db` is not in the repository (gitignored, 167 MB). `/api/osm/status` answers `available:false`, and every category went from the **browser straight to the public Overpass servers** with no cache and no explanation; when they were busy the result was a per-category error in small text, so the import looked broken.
- Saved areas were drawn as filled `#0284c7` polygons (12 %, 30 % selected). The user's database holds **1,324 saved areas, of which ~1,300 are identical "Roads loaded for a study area" boxes** (`area_osmroads_*`) recorded again on every Simulate road top-up. Stacked, their 12 % fills became the opaque blue blocks that "look like water bodies".

**Now.**
- Tool **"Study area"** (SquareDashed icon) in its own group directly under Select.
- Flow: choose **Polygon** (click corners, double-click to finish) or **Rectangle** (two clicks) → the outline is saved as a study area and **all data loads automatically**, no dialog: roads (cut at the boundary by default), mapped traffic signals, buildings, metro lines and stations. Options (collapsed): name, which data, "Keep whole roads crossing the edge".
- **States**: data-source line before drawing (local index with data date, or "No local index · live OpenStreetMap (Overpass), cached by the backend" + the one-command build); inline progress card with category, step and Cancel, plus a small non-blocking pill at the bottom of the map (no full-screen modal, no blur); error banner with Try again and the index-build hint; partial results list the failed categories with Retry.
- **Summary** (`engine/editing/studyAreaSummary.ts`, counted from the project's objects inside the polygon, so it also works for a saved area selected later): area km², road km and pieces (by OSM highway class under a disclosure), junctions (**estimated/derived**: vertices where ≥3 road arms meet), traffic signals (null — "load data to count" — until loaded this session, never a fake 0), buildings, metro km / stations, elevated road km; source per category (local index with data date / Overpass live or cached with date) and "© OSM contributors (ODbL)".
- Imported objects are ordinary project objects (`osm_*` roads with `osmProvenance`, buildings, metro), so Select, lane / junction editing and Simulate act on them. Actions on a selected area: Zoom to, Reload, Edit boundary, Delete (objects kept).
- **Visual**: study areas are thin amber outlines (`#fbbf24`), **2 px dashed** when not selected, **3 px solid** when selected; the interior is transparent (selected: 3 % tint, which also makes it clickable). The drawing preview is a 2 px line, not a 30 % yellow fill. `area_osmroads_*` bookkeeping boxes are **never drawn**, and an identical box is no longer recorded twice (existing duplicate rows are left in the database, untouched). Demand-zone fills lowered from 8 % / 25 % to 3 % / 6 % (preview 20 % → 3 %); the outline carries the shape.

## Data sources (Overpass fallback and cache)

Order used by the Study area import (and by signal loading):
1. **Local OSM index** (`backend/osm/index.py`, `/api/osm/*`) when it exists and covers the area. Build it once: **`cd backend && python -m osm.build_index`** (downloads Geofabrik's India Western Zone extract, ~220 MB, and builds `backend/data/osm/osm_index.db` for the Pune box 73.55,18.30–74.20,18.85; needs `osmium` from `requirements.txt`). Re-run to refresh.
2. **Backend Overpass proxy** `GET /api/osm/overpass?data=<QL>` (`backend/osm/overpass.py`): disk cache (SQLite `backend/data/osm/overpass_cache.db`, gitignored, 7 days, `TWINCITY_OVERPASS_CACHE[_TTL_H]`), one upstream request at a time ≥1 s apart, daily budget 2,000 (`TWINCITY_OVERPASS_DAILY_BUDGET`; the public guideline is ≈10,000 requests and 1 GB per day), identifying User-Agent, mirrors tried in turn with 429/503/504 + Retry-After cool-downs, incomplete answers (`remark` timeout / runtime error / out of memory) never cached. Response header `X-Overpass-Cache: hit|miss`. When every mirror fails it answers 502 `{detail:{upstream:true,…}}` and the browser does **not** repeat the request against the mirrors.
3. **Public Overpass mirrors directly from the browser**, only when the backend is unreachable (or too old to have the proxy); labelled "live, not cached".

`/api/osm/status` now always includes `buildCommand`, `reason` (when there is no index) and the proxy's status (endpoints, cache entries, budget used). Policy note: the Overpass manual lists "an app … relying on the public instances as backend" as problematic, so the local index stays the primary source and Overpass is the occasional fallback.

## Known limits
- _filled in at the end of the work_
