# UrbanOS developer handbook

For the owner and anyone who will change the code. It explains what the product is for, where every dataset came from and how the app uses it, how the code is laid out, how to run and test it on Windows and Linux, and how to do the common changes.

Written Sun 2026-11-22 (IST) against `main` at `ba7a003` (`Adi-1626/virtualplanner`). Every path, endpoint and command below was read in the code at that commit; dataset facts come from the `manifest.json` / `processing.json` files in `/workspace/work/urbanos-data/` and from a fresh database built from this commit (startup seeds + `python -m datasets.importer`). Where something could not be confirmed it says so.

Reading order: this file first, then the detailed references it links to:
[START_HERE](START_HERE.md) · [PROJECT_OVERVIEW](PROJECT_OVERVIEW.md) · [DATA_CATALOGUE](DATA_CATALOGUE.md) · [DATABASE_AND_CODE_GUIDE](DATABASE_AND_CODE_GUIDE.md) · [CURRENT_STATUS_AND_ROADMAP](CURRENT_STATUS_AND_ROADMAP.md) · [LEARNING_GUIDE](LEARNING_GUIDE.md).

---

## Contents
1. [Product goal, users and honesty rules](#1-product-goal-users-and-honesty-rules)
2. [Every dataset: origin, licence, processing, endpoint, use](#2-every-dataset)
3. [The official-only rule and the data-freshness updater](#3-the-official-only-rule-and-the-data-freshness-updater)
4. [Architecture and code map](#4-architecture-and-code-map)
5. [Running locally (Windows and Linux), tests, pitfalls](#5-running-locally-tests-and-pitfalls)
6. [How to do common tasks](#6-how-to-do-common-tasks)
7. [Known limits and open items](#7-known-limits-and-open-items)

---

## 1. Product goal, users and honesty rules

**Goal.** UrbanOS (repo VirtualPlanner; the backend still calls itself "TwinCity Backend Service" in `backend/main.py`) is a **decision-support tool for Pune's planning authorities** (PMC, PMRDA, Maha-Metro, PWD/MSRDC planners and their consultants). A planner opens a 3D map of the city, sees what is already there, sketches alternatives (a road, a flyover, a metro line, a tunnel or a buried utility), screens them against terrain, underground records, environmental layers and other agencies' projects, compares them with the existing city in a traffic model, records decisions, and exports an audited report.

It is **not a game** and not a city-builder: nothing is invented to make the picture look complete, and the outputs are evidence for a human decision, never the decision.

**Users and where they work** (`frontend/src/shell/workspaces.ts`, hotkeys Alt+1…7):

| Workspace | Planner's question |
|---|---|
| Explore | What is here? (city model, municipal layers, terrain) |
| Design | What could we build? (drawing tools, alternatives, versions, shape editor) |
| Underground | What is under the ground and how sure are we? (alignments, utilities, profile, cross-section, screening) |
| Environment | What environmental data exists here, and what would a proposal touch? |
| Simulate | How does traffic around this road change with the proposal? |
| Projects | Which projects overlap, what was decided, by whom? |
| Reports | What can I export and hand over? (also the Data catalogue and the Fact updates review queue) |

**Honesty rules, as the code enforces them.**
- **Every value says what kind of value it is.** The UI groups and badges values as *measured / modelled / inferred* (Environment panel groups) and *measured / estimated / hypothetical / unknown* (`frontend/src/engine/objects/certainty.ts`, badges in `frontend/src/components/ui/badges/`, `SourceBadge.tsx`, `dataSource.ts`). The registry stores a `data_class` per dataset version: `observed`, `inferred`, `estimated`, `derived`, `synthetic` (`backend/datasets/vocab.py`).
- **Screening, never compliance.** Every dataset is marked suitability `visualisation` or `screening`; none is `engineering` (`vocab.py` `SUITABILITY`). Geometry checks carry `SCREENING_DISCLAIMER = 'Screening only — not a design check or approval.'` (`frontend/src/engine/geometry/alignment/criteria.ts`). Underground findings are *Potential conflict / Requires investigation / Verified / Insufficient data*, never "clear" (`backend/coordination/screening.py`). Feasibility screening never declares a proposal feasible (`backend/feasibility/layers.py` docstring: an absence in OSM is `unknown`, never "clear").
- **Unknown stays unknown.** A depth that is not recorded is `null`/UNKNOWN, never 0 or a typical value (e.g. sewer depth only when both cover and invert levels exist, `backend/datasets/pipelines/infra_index.py`; OSM metro tunnels are stored at level 0 with "depth not mapped", not an invented −6 m). DEM samples outside coverage stay nodata (`backend/terrain/dem.py`).
- **The traffic model fails validation and says so.** 0 of 15 count sites within GEH 5; river screen line −30.5 % (UK TAG M3.1). The text is in `frontend/src/shell/contexts/SimulateContext.tsx` and `components/ui/badges/trafficValidation.ts`; evidence in `docs/ENGINEERING_VALIDATION.md`. Use Simulate only to compare alternatives on the same inputs.
- **Facts about projects come only from official sources** (government and agency sites). See §3.
- **Licences are respected.** Restricted data (OpenCity/PMC mirror, IMD, AutoDCR, Bhuvan) stays internal ([DATA_CATALOGUE §5](DATA_CATALOGUE.md)).

---

## 2. Every dataset

### 2.1 Where the files are

| What | Location | In git? |
|---|---|---|
| Raw originals | `<data dir>/raw/<source_id>/<YYYY-MM-DD>/` + `manifest.json` (URL, sha256, size, licence quote) | **No** |
| Processed outputs | `<data dir>/derived/<dataset_id>/<version>/` + `processing.json` (pipeline module, git commit, inputs with sha256, parameters, outputs, validation) | **No** |
| Data dir resolution | `backend/datasets/paths.py`: `URBANOS_DATA_DIR` → (aliases `URBANOS_DATA_ROOT`, `URBANOS_DATA_HOME`) → `/workspace/work/urbanos-data` if it exists → `backend/data/urbanos` (empty in a clone). `backend/envdata/paths.py` uses a *different* order (env → `backend/data/urbanos` if it has `derived/` → `/workspace/work/urbanos-data`) | — |
| OSM extract and indexes | `backend/data/osm/western-zone-latest.osm.pbf`, `osm_index.db` (`TWINCITY_OSM_INDEX`), `feasibility_layers.db` (`TWINCITY_FEAS_LAYERS`), `overpass_cache.db` | **No** (`.gitignore`: `backend/data/*`) |
| Curated traffic JSON | `backend/data/{observed_counts,observed_screenlines,observed_validation,diurnal,network_corrections}/` | **Yes** (un-ignored in `.gitignore`) |
| Official project facts seed | `docs/urbanos/pune_project_facts.json` | **Yes** |
| App database | `backend/twincity.db` (`DATABASE_URL`, default `sqlite:///./twincity.db` relative to the working directory) | **No** (`*.db`; removed from git in `cd9fa1e`) |

**On the dev machine only.** The full data store (≈2.8 GB raw + ≈2.9 GB derived, 19 raw source folders, 40 derived dataset folders) lives at `/workspace/work/urbanos-data/` in the Hark sandbox. The OSM files live in the original checkout at `/workspace/work/virtualplanner/backend/data/osm/` (pbf 222 MB, `osm_index.db` 175 MB, `feasibility_layers.db` 7.9 MB). The export zips mentioned in older docs (`urbanos-data-raw.zip`, `urbanos-data-derived.zip`) are no longer in `/workspace/work/export/`. None of this is in git, so on your own PC you must **copy** the data folder or **re-acquire** it (§2.5).

**What a fresh clone does without data.** The app starts and seeds itself, but: terrain endpoints answer that the DEM is unavailable; `/api/env-data` rows show `missing`; `/api/infra` reports the index unavailable; study areas load roads through the cached Overpass proxy instead of `osm_index.db`; the official facts dataset is empty until `python -m updater seed-baseline`.

### 2.2 Registry vocabulary
- The **Dataset Registry** is the set of `ds_*` tables (`backend/datasets/models.py`): `ds_sources`, `ds_datasets`, `ds_dataset_versions`, `ds_files`, `ds_processing_runs`, `ds_quality_checks`, `ds_features`, `ds_feature_dependencies`, `ds_update_checks`. "Registry id" below means `ds_datasets.id` (e.g. `elevation_copdem30`); the `ds_` prefix is on the tables, not the ids.
- Rows come from three places: the startup seed (`backend/datasets/seed.py`, datasets the app holds in the repo or code, the `gap_*` placeholders for missing data, and the feature→data matrix), the importer (`python -m datasets.importer` or `POST /api/datasets/import`, scans `raw/` and `derived/`), and `sync_catalogues` (mirrors `environment_layers`, `subsurface_datasets`, `td_datasets`; also runs on every `GET /api/datasets`).
- A fresh database from `ba7a003` after the importer holds 99 datasets and 76 versions (the 2026-11-14 dev database had 101 / 83 because it also kept superseded duplicates and two subsurface mirrors).
- Browse it in the app: **Reports → Data catalogue** (`frontend/src/components/data/DataCatalogueView.tsx`), API `GET /api/datasets`, `/api/datasets/{id}`, `/api/datasets/features`.
- "Official" in the tables below means *published by a government body on its own site*. The registry's own `ds_sources.official` flag is set only for `pmc_cmp2008_opencity`, `pmc_opendata_portal` and `arai_2007`, so do not read that flag as a full answer. The **official-only rule of §3 applies to the project-facts dataset**, not to these GIS datasets.

### 2.3 Datasets the app reads at run time

Dates: "retrieved" is when the file was downloaded (all raw folders 2026-11-13 IST); "content" is the period the data describes. Licence text is shortened; the quote is in each `manifest.json` and [DATA_CATALOGUE §2, §5](DATA_CATALOGUE.md).

#### Terrain and subsurface

| Registry id | Publisher · URL | Licence | Official? | Content date | Raw → derived | Processed by | Served by | Used in the app |
|---|---|---|---|---|---|---|---|---|
| `elevation_copdem30` (v3 active; v2 pending_review; v1 superseded) from raw `copernicus_dem_glo30` | ESA / Copernicus (DLR, Airbus DS), AWS mirror · https://registry.opendata.aws/copernicus-dem/ | Copernicus DEM GLO-30 free licence (attribution text required, `ATTRIBUTION` in `terrain/dem.py`) | Intergovernmental (EU/ESA), not Indian government | 2021 release | `raw/copernicus_dem_glo30/2026-11-13/` → `derived/elevation_copdem30/v3/` (`dem_copglo30_epsg32643_30m.tif`, hillshade/slope PNGs, D8 flow, derived streams, catchments) | `python -m datasets.pipelines.elevation [acquire\|process\|all]` (`backend/datasets/pipelines/elevation.py`, own numpy D8 in `_hydro.py`) | `/api/terrain/info`, `/point`, `/points`, `/profile`, `/overlays`, `/overlays/{name}.png` (`backend/terrain/dem.py`, `DEFAULT_VERSION="v3"`, override `URBANOS_DEM_VERSION`); streams/catchments via `/api/env-data/layers/{lid}/…` | Explore terrain readout and hillshade/slope overlays (`components/explore/TerrainSection.tsx`, `terrainOverlay.ts`); **Underground ground line and depth below ground** in the Profile and Cross-section (`engine/underground/terrainProfile.ts`, `groundModels.ts`); Environment derived streams/catchments. It is a **DSM** (roofs and trees included): screening only |
| `nasadem_pc` | NASA SRTM via Microsoft Planetary Computer | UNKNOWN (PC says "proprietary", LP DAAC says no restrictions) | US government (NASA) via a commercial mirror | Feb 2000 | `raw/nasadem_pc/` | read by `elevation.py process` for the Cop−NASADEM difference raster (an unlisted input, [DATA_CATALOGUE §4.1](DATA_CATALOGUE.md)) | — | Comparison only |
| `nwdp_groundwater_pune` from raw `nwdp_india_wris` | National Water Data Portal (NWIC, MoJS); producers CGWB, Maharashtra GSDA · https://nwdp.nwic.gov.in | UNKNOWN (CKAN "Other (Open)" for groundwater) | **Yes** (Government of India portal) | 1970–2025 (last reading 2025-10-01; 36 wells) | `raw/nwdp_india_wris/2026-11-13/*.csv` → `derived/nwdp_groundwater_pune/2026-11-13/` | `python -m datasets.pipelines.nwdp_groundwater --raw-date 2026-11-13` (raw fetched with `gov_fetch`) | `POST /api/terrain/subsurface-evidence` (`backend/terrain/evidence.py`) | Underground → Subsurface evidence (nearest wells, point observations, never a surface); groundwater flag in Underground screening (`coordination/screening.py` `groundwater_check`) |
| `soil_soilgrids250` from raw `soilgrids_250m_v2` | ISRIC World Soil Information · maps.isric.org WCS | CC BY 4.0 | No (international research body) | release not recorded | `raw/soilgrids_250m_v2/` → `derived/soil_soilgrids250/v1/` (0–30 cm rasters, EPSG:32643 250 m) | `python -m datasets.pipelines.soil [acquire\|process\|all]` | `/api/env-data/catalogue` + `/layers/soil_soilgrids/render.png`; `/api/terrain/subsurface-evidence` | Environment → Soil; Underground evidence (urban cells are masked → UNKNOWN) |
| `pmc_sewage_pipelines` (+ `pmc_sewage_pipelines_fgb`) from raw `opencity_pune` | Pune Municipal Corporation, mirrored by OpenCity (Oorvani Foundation) · data.opencity.in | **Conflicting** (CKAN "Public Domain", OpenCity FAQ ODbL, site T&C non-commercial): internal only | PMC data, obtained from a **non-government mirror** | design levels as published; CKAN modified 2025-11/2026-01 | `raw/opencity_pune/2026-11-13/pmc_sewage_pipeline.kmz` → `derived/pmc_sewage_pipelines/2026-11-13/*.geojson` → `derived/pmc_sewage_pipelines_fgb/v1/` | `python -m datasets.pipelines.opencity_pune derive --raw-date 2026-11-13`; `python -m datasets.pipelines.subsurface_index --src-version 2026-11-13` | `/api/infra/layers/sewer/features`; `/api/terrain/subsurface-evidence`; imported into `subsurface_records` by `coordination/pmc_import.py` | Explore municipal layer; Underground records, evidence and screening (ASCE 38 QL-D, depth = cover − invert only when both exist); Projects conflict detection |
| `pmc_stormwater_drains`, `pmc_swd_chambers`, `pmc_swd_utility_chambers` | PMC via OpenCity | as above (internal only) | PMC data via mirror | as published | `raw/opencity_pune/…` → `derived/<id>/2026-11-13/` | `opencity_pune derive` | `/api/infra/layers/{storm_drains\|swd_chambers\|swd_utility_chambers}/features`; storm drains also imported to `subsurface_records` | Explore; Underground records + screening (only the 9,187 rows labelled "Storm water drains" are storm drains; sewer-category rows are dropped, `infra_index.py`) |

#### Municipal layers (all from raw `opencity_pune`, all internal only, all served through `infra_index`)

| Registry id(s) | Content | Processed by | Served by | Used in the app |
|---|---|---|---|---|
| `pmc_nallas`, `pmc_rivers`, `water_bodies_census_pune_2023` (KML "CC Non-Commercial") | stream centrelines, river polygons (not flood lines), water-bodies census points | `opencity_pune derive` | `/api/infra/layers/{nallas\|rivers\|water_bodies}/features` | Explore; nallas/rivers are watercourse checks in Underground screening |
| `pmc_road_centerline`, `pmpml_bus_stops`, `pmpml_bus_depots` | centrelines (no width/ROW), PMPML stops and depots | `opencity_pune derive` | `/api/infra/layers/{road_centreline\|bus_stops\|bus_depots}/features` | Explore |
| `pmc_electoral_wards_2025` (active) / `_2022` / `_2017` / `_2012`, `pmc_admin_wards_2017`, `pmc_prabhag_boundary`, `pmc_zones`, `pmc_revenue_map` | boundaries and revenue parcels | `opencity_pune derive` | `/api/infra/layers/{wards_2025…\|admin_wards_2017\|prabhag\|zones\|revenue_parcels}/features` | Explore |
| `pmc_fire_stations`, `pmc_public_toilets`, `pmc_parks_gardens`, `pune_libraries`, `pmc_crematoriums`, `pmc_stps` | facilities | `opencity_pune derive` | `/api/infra/layers/{…}/features` | Explore |
| `census2011_pune_wards` | Census 2011 ward table (145 wards, no geometry) | `python -m datasets.pipelines.census2011_wards` | `/api/infra/census2011` | Explore (listed as "not mappable") |
| `infra_index` (derived, v1) | SQLite R*Tree + WKB of 24 municipal layers + merged buildings | `python -m datasets.pipelines.infra_index --version v1` (reads the derived GeoJSONs; never raw) | `/api/infra/status`, `/layers`, `/layers/{lid}/features?bbox=` (`backend/datasets/infra_store.py`, `URBANOS_INFRA_INDEX` overrides) | Explore → Municipal layers (`components/explore/MunicipalLayers.tsx`, `municipalOverlay.ts`, `lib/infraApi.ts`); Projects and Underground conflict checks (`coordination/service.py`, `screening.py`) |

#### Buildings

| Registry id | Publisher · licence | Official? | Content | Processed by | Served by | Used in the app |
|---|---|---|---|---|---|---|
| `google_open_buildings_v3` | Google Research · CC BY 4.0 or ODbL | No | ML footprints, inference May 2023 (`inferred`) | `python -m datasets.pipelines.buildings [acquire\|process\|all]` | through `infra_index` layer `buildings` | merged layer below |
| `ms_global_ml_buildings` | Microsoft · CDLA Permissive 2.0 | No | ML footprints, release 2026-08-13 (`inferred`) | same | same | same |
| `buildings_comparison` (derived v1) | Google + Microsoft + OSM merged with an agreement flag | — | heights only from an OSM `height` tag, else UNKNOWN | `buildings.py process` (also reads `osm_index.db`, an unregistered input) | `/api/infra/layers/buildings/features` | Explore buildings layer (capped in view); building footprints as a foundation proxy (depth UNKNOWN) in Projects conflicts and Underground screening |

#### Environment

| Registry id | Publisher · URL | Licence | Official? | Content date | Processed by | Served by (`backend/envdata/*`) | Used in the app |
|---|---|---|---|---|---|---|---|
| `cpcb_caaqms_pune` (from `cpcb_caaqms_station_list` + OpenCity AQ CSVs) | CPCB CCR station list (app.cpcbccr.com); 15-min data from IITM/MPCB stations mirrored by OpenCity | UNKNOWN / conflicting (OpenCity) | Government data; series via mirror | 2024–25, 7 stations | `python -m datasets.pipelines.cpcb_air_quality --raw-date 2026-11-13` (UTC → IST) | `/api/env-data/air/stations`, `/air/series` (`series.py`) | Environment → Air quality panel (`components/environment/EnvDataPanels.tsx` `AirQualityPanel`) — **measured** |
| `imd_rainfall_025_pune` (from `imd_gridded_rainfall_025`) | IMD Pune, Pai et al. 2014 · https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html | UNKNOWN (citation only): internal until verified | **Yes** | 2000–2025, 4 cells over Pune | `python -m datasets.pipelines.imd_rainfall --years 2000-2025` | `/api/env-data/rainfall/summary`, `/rainfall/daily` | Environment → Rainfall (`RainfallPanel`) — gridded estimate |
| `imd_district_rainfall_pune` (from `nwdp_india_wris`) | IMD district daily via NWDP | UNKNOWN | **Yes** | as published | `nwdp_groundwater` (rain step) | same | Environment → Rainfall |
| `rainfall_chirps_boxavg` (from `chirps_v2_climateserv`) | Climate Hazards Center UCSB via SERVIR ClimateSERV | CC0 data; API terms UNKNOWN | No | 1986–2025, box average | `python -m datasets.pipelines.chirps [acquire\|process\|all]` | same | Environment → Rainfall — **modelled** |
| `landcover_worldcover2021` (from `esa_worldcover_2021_v200` + `datameet_municipal_wards`) | ESA WorldCover / VITO; DataMeet wards | CC BY 4.0; wards CC BY-SA 2.5 IN | No | 2021, 10 m | `python -m datasets.pipelines.landcover [acquire\|process\|all]` | `/api/env-data/layers/landcover_worldcover2021/render.png`, `…/areas` (GET/POST) | Environment → land cover, class areas; green area inside a proposal footprint (`EnvImpact.tsx`) — **inferred** |
| `sentinel2_indices` (from `sentinel2_l2a_earthsearch`) | ESA Copernicus via Element 84 Earth Search | Copernicus Sentinel legal notice | No | scenes 2025-11-14 and 2019-11-26 | `python -m datasets.pipelines.sentinel2 [acquire\|process\|all]` | `/api/env-data/layers/{s2_ndvi\|s2_mndwi}/render.png` | Environment NDVI and MNDWI. NDWI/NDBI rasters unused; built-up change layer **rejected** (F1 0.457), not drawn |
| `surface_water_jrc_gsw` (from `jrc_gsw`) | EC JRC / Google | free, no restriction (cite Pekel 2016) | No | 1984–2024 | `python -m datasets.pipelines.surface_water [acquire\|process\|all]` | `/api/env-data/layers/jrc_gsw_occurrence/render.png` | Environment surface-water occurrence |
| `pmc_tree_census_2019` → `pmc_tree_census_2019_index` | PMC Tree Census 2019 via OpenCity (17 CSV parts, 4,009,623 trees) | conflicting: internal only | PMC data via mirror | 2019 | `python -m datasets.pipelines.opencity_trees --raw-date 2026-11-13`; `python -m datasets.pipelines.tree_index --input-version 2026-11-13 --version v1` | `/api/env-data/trees`, `/trees/tile`, `/trees/count`, `POST /footprint` (`trees.py`, `footprint.py`) | Environment tree layer (cached tiles, `treeTiles.ts`), trees inside a proposal footprint (+10 m) — **measured** |

Not data but listed in the Environment catalogue as blocked or missing with a reason (`backend/envdata/catalogue.py`): PMC AutoDCR flood lines (restricted, probe only), a flood hazard model (none), noise, heat, seismic.

#### Roads, city model and OSM

| Registry id | Publisher · licence | Official? | Date | Files | Built by | Served by | Used in the app |
|---|---|---|---|---|---|---|---|
| `osm_geofabrik_western_zone` | Geofabrik / © OpenStreetMap contributors · ODbL 1.0 | No (volunteer) | extract 2026-11-02 02:51 IST | `backend/data/osm/western-zone-latest.osm.pbf` | `python -m osm.build_index` downloads it (or `--no-download`, `--pbf`) | — | input |
| `osm_local_index` | same · ODbL | No | built 2026-11-02 | `backend/data/osm/osm_index.db` | `python -m osm.build_index` (`backend/osm/build_index.py`, needs `osmium`) | `/api/osm/status`, `/ways`, `/signals`, `/buildings`, `/metro` (`backend/osm/index.py`); fallback `/api/osm/overpass` (`osm/overpass.py`, cached 7 days, ≤ 2,000 upstream requests/day) | **Roads**: Design → Study area import (`engine/editing/LocalOsmIndex.ts` first, `OverpassClient.ts` fallback), traffic signals, OSM metro lines/stations for Underground and screening |
| `osm_feasibility_layers` | same · ODbL | No | built 2026-11-11 | `backend/data/osm/feasibility_layers.db` | `python -m feasibility.build_layers` | `/api/feasibility/site-data`, `/status` (`feasibility/layers.py`) | Environment → feasibility screening (water, heritage, trees, railway); absence = unknown |
| `twincity_base_osm_objects` | this app, from OSM · ODbL | — | dev DB 2026-11-05 | rows in `city_objects` | study-area imports | `/api/objects`, `/api/areas` | the existing city drawn in Explore/Design/Simulate. **A fresh database has 0 `city_objects`**: the city appears as you import study areas |
| `cesium_ion_imagery`, `cesium_world_terrain` | Cesium GS · Cesium ion ToS (streaming only, never cache or export) | No | streamed | — | — | Cesium ion (needs `VITE_CESIUM_ION_TOKEN`) | base imagery and the 3D globe terrain. Without a token the globe is the flat ellipsoid |

#### Traffic inputs (curated JSON in git, `backend/data/`)

| Registry id | Source · licence | File | Served by | Used in the app |
|---|---|---|---|---|
| `observed_counts_pune_west_2026` | NICMAR conference chapter (Journal Press India), 6 junctions · UNKNOWN | `backend/data/observed_counts/pune_west_2026.json` | `/api/observed-counts` (`backend/observed/counts.py`) | Simulate count checks, calibration |
| `mendeley_pune_2023_counts`, `pune_hourly_profile_v1` | Matange & Abraham, Mendeley Data (8 CCTV sites, 2023) · CC BY 4.0; profile compiled from it | `backend/data/diurnal/*.json` | `/api/diurnal-profile` | Simulate time of day ("Through the day") |
| `cmp2008_river_screenline` | PMC Comprehensive Mobility Plan 2008 (OpenCity mirror) · UNKNOWN | `backend/data/observed_screenlines/pune_cmp2008_river.json` | `/api/observed-screenlines` | river screen-line validation |
| `pune_network_validation_v1` | compilation of cited sources (TomTom, TraffiCure quoted values) | `backend/data/observed_validation/pune_network_validation_v1.json` | used by `analyze_validation.py` and docs | the validation result shown in the banner (hard-coded text) |
| `network_corrections_pune_west_v1` | evidenced local OSM corrections (OSM itself never edited) | `backend/data/network_corrections/pune_west_v1.json` | `/api/network-corrections` | Simulate network building |
| (user data) `td_*` tables | counts entered or imported by the planner | `twincity.db` | `/api/traffic-data/*` | Projects → Data (Traffic Data Manager) |

#### Emission factors (code constants, no files)

| Registry id | Source | Where in code | Used in the app |
|---|---|---|---|
| `hbefa4_sumo_coefficients` | HBEFA 4.2 fitted functions as implemented in Eclipse SUMO (`HelpersHBEFA4.cpp` @ `7a4786a`, 2026-01-09; SUMO is EPL-2.0) | `frontend/src/engine/emissions/hbefa4.ts` | **Emissions**: per vehicle per 0.25 s step from speed and acceleration in the corridor micro-simulation (`emissions.ts` part 1) → Simulate Emissions tab and Environment emissions change. Estimated, carries the model's validation limit |
| `arai_2007_emission_factors` | ARAI (2007) cycle-average g/km | `frontend/src/engine/emissions/emissions.ts` | area cross-check only, shown separately, never used for scenario deltas |

#### Official project facts (§3)

| Registry id | Source | Files | Written by | Served by | Used in the app |
|---|---|---|---|---|---|
| `pune_infra_project_facts` (source `updater_published_facts`) | official government/agency pages only, each fact with quote, URL, date, reviewer | `<data dir>/derived/pune_infra_project_facts/<label>/facts.json` + `provenance.json` (immutable per version; sha256 checked at read) | `python -m updater seed-baseline` (from `docs/urbanos/pune_project_facts.json` v2: 22 projects, 108 records) and `python -m updater apply` | `GET /api/updater/facts` | **Underground** hover tooltip: an approved official tunnel depth for a matched OSM metro line, shown as text with its source, never used to draw the tunnel (`frontend/src/engine/underground/reportedFacts.ts`, `components/underground/HoverTooltip.tsx`). Review queue: Reports → Data catalogue → Fact updates (`components/data/FactUpdatesPane.tsx`). Not yet consumed by the Projects workspace (Projects cites official sources in its metro NOC rule in `backend/coordination/seed.py`, a separate seed) |

### 2.4 Acquired but not used at run time
Pipeline inputs only: `chirps_v2_climateserv`, `esa_worldcover_2021_v200`, `google_open_buildings_v3`, `ms_global_ml_buildings`, `imd_gridded_rainfall_025`, `jrc_gsw`, `nasadem_pc`, `nwdp_india_wris`, `opencity_pune`, `sentinel2_l2a_earthsearch`, `soilgrids_250m_v2`, `datameet_municipal_wards`, `cpcb_caaqms_station_list`. Reference/evidence only, no consumer: `bhuvan_ogc_capabilities`, `bhuvan_wms_samples` (PNGs deleted for ToS), `pmc_autodcr_geoserver_probe`, `pmc_opendata_portal_catalogue`, `nwdp_meta` (update-monitor baseline). Placeholders with no data on purpose: 12 `gap_*` and 12 `env:*` registry rows, `pmc_portal_traffic_details`. Details: [DATA_CATALOGUE §4.3–4.4](DATA_CATALOGUE.md).

### 2.5 What you must download yourself (on your own PC)
Easiest: copy `/workspace/work/urbanos-data/` and `/workspace/work/virtualplanner/backend/data/osm/` from the dev machine to your PC and point `URBANOS_DATA_DIR` / `TWINCITY_OSM_INDEX` at them. To rebuild from the publishers instead (run from `backend/`, with `URBANOS_DATA_DIR` set):

| Need | Command | Notes |
|---|---|---|
| OSM roads index | `python -m osm.build_index` | downloads Geofabrik western-zone (~222 MB), needs `osmium` |
| Feasibility layers | `python -m feasibility.build_layers` | from the same pbf |
| DEM | `python -m datasets.pipelines.elevation all` | Copernicus tiles from AWS; NASADEM for the comparison |
| Buildings | `python -m datasets.pipelines.buildings all` | reads `osm_index.db` too |
| Land cover, soil, surface water, Sentinel-2, CHIRPS | `python -m datasets.pipelines.<landcover\|soil\|surface_water\|sentinel2\|chirps> all` | public cloud endpoints |
| IMD gridded rainfall | download yearly `.grd` files (POST `https://imdpune.gov.in/cmpg/Griddata/rainfall.php`, field `rain=<YEAR>`) into `raw/imd_gridded_rainfall_025/<date>/`, then `python -m datasets.pipelines.imd_rainfall --years 2000-2025` | see the module docstring |
| NWDP groundwater + district rain | fetch the CSVs with `python -m datasets.pipelines.gov_fetch …`, then `python -m datasets.pipelines.nwdp_groundwater --raw-date <date>` | robots crawl-delay 10 s honoured |
| OpenCity PMC files (all `pmc_*`, trees, AQ CSVs) | **manual browser download** (data.opencity.in is behind a Cloudflare human check, which the code does not bypass) into a staging folder, then `python -m datasets.pipelines.opencity_pune ingest --staging <folder>` and `… derive --raw-date <date>`; trees: `opencity_trees`, `tree_index`; AQ: `cpcb_air_quality` | licence conflict: internal only |
| Municipal index | `python -m datasets.pipelines.infra_index --version v1` then `python -m datasets.pipelines.subsurface_index` | after the PMC layers and buildings |
| Register everything | `python -m datasets.importer` (or `POST /api/datasets/import`) | idempotent |
| Official facts | `python -m updater seed-baseline --reviewer "Your Name"` | empty dataset only; otherwise `migrate-official-only` |

Each `processing.json` records the git commit and parameters of the run that made it; `python -m datasets.provenance_check` verifies hashes against the raw manifests (read-only). Upstream change checks: `python -m datasets.update_monitor [--plan] [--dry-run]` (metadata only, writes `ds_update_checks`; targets in `backend/datasets/update_targets.json`).

---

## 3. The official-only rule and the data-freshness updater

### 3.1 The rule (user rule, 2026-11-21)
"Don't get the dataset from news, unless it is from certified … make sure it takes data from reliable sources only." In code:

- **The allow-list is code, not config:** `backend/updater/official.py`. Official = any host under `gov.in` or `nic.in` (NIC registers these only to government bodies) **or** one of four verified agency domains: `punemetrorail.org`, `mahametro.org` (Maha-Metro), `sansad.in` (Parliament), `msrdc.in` (MSRDC). News sites, blogs, aggregators and contractors' releases never count. IP literals, URLs with credentials and IDN look-alikes are refused (`host_of`).
- **Every gate asks `is_official_url`:** candidate selection and ingest (`pipeline.py`: a non-official page is never fetched or stored; a redirect off the list is not stored), claim → proposal (`proposals.py`), approve/apply (`review.py`), registering a facts version (`facts.register_version`, raises `UnofficialFactError`), reading an older version (`facts.read_version` withholds non-official facts). The watch-list validator (`updater/config.py`) refuses a non-official source, publisher or any tier other than 1, and only allows source kinds `official_page` and `rss`.
- **UI mirror:** `frontend/src/lib/officialSources.ts` (same domains; `backend/tests/test_updater.py` checks they match). `FactUpdatesPane.tsx` and `reportedFacts.ts` filter again with `allOfficial`.
- **Confidence levels** (only three): `official`, `official_conflicting` (two official sources disagree), `slipped` (an official date that passed and was replaced).

### 3.2 How the updater works
```
watchlist.json sources (official pages + official RSS)
   └─ python -m updater run ── fetch.py (robots.txt, cache, ≥ 2 s per host, max 40 articles/run, 8/host)
        └─ fu_documents (official pages only) ── extract.py (deterministic patterns; optional llm.py)
             └─ fu_claims (exact quoted sentence) ── proposals.py (group by project+attribute+value; corroboration, conflicts, staleness)
                  └─ fu_proposals (pending)   ← a named reviewer approves / rejects (API or CLI)
                       └─ python -m updater apply → NEW immutable ds_dataset_versions row of pune_infra_project_facts
                            └─ GET /api/updater/facts → Underground tooltip
```
- Watch-list: `backend/updater/watchlist.json` (22 projects with aliases, attributes and `osm_name_patterns`; 5 sources: three `punemetrorail.org` pages, the PMRDA feed, the PIB RSS; settings `max_article_age_days 400`, `refetch_after_days 30`). Override with `UPDATER_WATCHLIST`.
- Attributes extracted: length (km), station count, tunnel depth (m), TBM count, tunnelling start, completion target, cost (INR crore), status (`extract.py` `ATTRIBUTES`).
- The optional LLM extractor (`updater/llm.py`) is **off** unless `UPDATER_LLM_URL`, `UPDATER_LLM_KEY` and `UPDATER_LLM_MODEL` are all set; its quotes must be exact substrings, the number must parse from the quote, and its proposals need a reviewer note.
- Tables (all additive, prefix `fu_`, `backend/updater/models.py`): `fu_runs`, `fu_documents`, `fu_claims`, `fu_proposals`, `fu_audit` (append-only by ORM events, hash-chained; `verify-audit` checks it).
- The run never writes the facts dataset; only `apply` does, through the registry's review flow. `apply --no-activate` leaves the version `pending_review` so a second person activates it (four-eyes).

### 3.3 Review flow
- **In the app:** Reports → Data catalogue → **Fact updates**. Set your name first (stored as `localStorage['td-user']`, the same self-declared name Projects and Traffic data use). Each card shows the value, how it changes the dataset, the confidence, the number of official sources, conflicts, each quote with publisher/date/link and flags. Approve (a note is required unless confidence is *official* and not LLM-only), Reject, then Apply.
- **API** (`backend/api/updater_router.py`, never fetches the web): `GET /api/updater/status`, `/proposals?status=&project=`, `POST /proposals/{id}/approve` `{reviewer, note?}`, `/proposals/{id}/reject`, `POST /apply` `{reviewer, note?, activate?}`, `POST /versions/{id}/activate`, `POST /rollback` `{version_id, reviewer, note?}`, `GET /facts`, `/versions`, `/runs`, `/audit`.

### 3.4 CLI (run from `backend/` with the same `DATABASE_URL` and `URBANOS_DATA_DIR` as the app; from `backend/updater/__main__.py`)
```
python -m updater check-config                     # validate watch-list, print the allow-list
python -m updater seed-baseline --reviewer NAME    # ONCE, empty facts dataset: load pune_project_facts.json
python -m updater migrate-official-only --reviewer NAME [--dry-run]   # existing DB: drop news pages/claims, re-seed
python -m updater run [--dry-run] [--only id,id] [--sources id,id] [--refresh] [--json report.json]
python -m updater serve [--every 24h]              # loop; minimum 1 h
python -m updater status | proposals [--status pending|approved|all] [--project id] | versions
python -m updater approve ID --reviewer NAME [--note TEXT]
python -m updater reject  ID --reviewer NAME [--note TEXT]
python -m updater apply --reviewer NAME [--note TEXT] [--no-activate]
python -m updater rollback VERSION_ID --reviewer NAME [--note TEXT]
python -m updater add-evidence URL --reviewer NAME [--project id]   # one official page you found
python -m updater evaluate [--json out.json]       # offline golden test on the seed quotes (exit 1 on a wrong value)
python -m updater verify-audit | purge-cache
```
Try it on a copy of `twincity.db` first. Scheduling (cron, Windows Task Scheduler, `serve`): [DATA_FRESHNESS_SERVICE.md §3](DATA_FRESHNESS_SERVICE.md).

### 3.5 How to add a new official fact
1. **The page is already watched:** just run `python -m updater run`; review and apply.
2. **You found one official page:** `python -m updater add-evidence <url> --reviewer "Your Name" [--project <id>]`. A URL that is not on the allow-list is refused before any request. Then approve and apply. Nothing is typed in by hand.
3. **A new official source to watch:** add it to `watchlist.json` `sources` (kind `official_page` or `rss`, an official URL, optional `page_rules` with a `project` and a regex `pattern`), then `python -m updater check-config`.
4. **A new project:** add it to `watchlist.json` `projects` (`id` lower-case/digits/underscore, at least one alias, `attributes` from `ATTRIBUTES`, `osm_name_patterns` regexes so Underground can match OSM metro names).
5. **A new agency domain** (not under gov.in/nic.in): edit `AGENCY_DOMAINS` in `backend/updater/official.py` **with** how you verified it is the agency's own site, mirror it in `frontend/src/lib/officialSources.ts`, and run `pytest tests/test_updater.py` (the mirror test fails otherwise). Never add a news domain.
6. **A new attribute:** add an extractor `x_<name>` and the entry in `ATTRIBUTES` in `extract.py`, a label in `extract.label`, golden cases in the seed if there is a verified quote, and tests.

Deeper: [DATA_FRESHNESS_SERVICE.md](DATA_FRESHNESS_SERVICE.md), [DATA_FRESHNESS_RESEARCH.md](DATA_FRESHNESS_RESEARCH.md) §11, [PUNE_PROJECT_FACTS.md](PUNE_PROJECT_FACTS.md).

---

## 4. Architecture and code map

### 4.1 Big picture
```
Browser (frontend/, React 19 + TypeScript + Vite + CesiumJS 1.143 + Zustand)
  shell/AppShell.tsx ── 7 workspace contexts (shell/contexts/*Context.tsx) + inspector + drawer + Ctrl/⌘K palette
  engine/TwinCityEngine.ts (singleton engineInstance): ObjectManager · EditingEngine · HistoryManager ·
      ScenarioManager · SimulationMode · layers · selection
  Web Workers: analysis.worker.ts (study analysis), traffic.worker.ts (network + demand rebuild),
      liveTraffic.worker.ts (live vehicles), each with an inline fallback
  lib/api.ts (API_BASE = VITE_API_BASE, apiGet/apiPost…, trackedFetch → Offline badge)
        │ HTTP JSON (CORS *; gzip ≥ 1 KB)
FastAPI (backend/main.py) ── 17 routers, 168 endpoints under /api
  services: coordination/ planning/ feasibility/ terrain/ envdata/ datasets/ observed/ traffic_data/ osm/ updater/ sumo/
  storage: SQLite twincity.db (44 tables) · backend/data/osm/*.db · URBANOS_DATA_DIR derived files (GeoTIFF, GeoJSON, FGB, SQLite R*Tree)
Offline CLIs: python -m datasets.pipelines.<name> · datasets.importer · osm.build_index · feasibility.build_layers · updater
```
The traffic model runs **in the browser**; the backend only stores run inputs/results (`POST /api/runs`). `backend/sumo/` is an optional spike; `SumoService` is a stub.

Startup (`backend/main.py`): `create_all` → `database/migrations.migrate` (additive column adds; no Alembic) → `planning.audit.install_triggers` (append-only triggers on `audit_log`, `planning_decisions`) → `seed.ensure_base_scenario` → `traffic_data.seed` → `coordination.seed` (cited clearance rules, environment catalogue) → `datasets.seed.seed_registry` → middleware (CORS `*`, gzip, `x-actor` header → audit actor; no authentication) → routers.

### 4.2 Frontend folders (`frontend/src/`)

| Folder | What lives there |
|---|---|
| `shell/` | `AppShell.tsx` (layout), `workspaces.ts` (the 7 workspaces, `modeForWorkspace`: Design/Underground → `build`, Simulate → `simulate`, else `view`), `useShellStore.ts`, `TopBar.tsx`, `CommandPalette.tsx`, `contexts/` (one context panel per workspace: `ExploreContext`, `DesignContext`, `UndergroundContext` (+ `.runtime.ts`, `.tabs.tsx`), `EnvironmentContext`, `SimulateContext` + `SimulateDrawer`, `ProjectsContext`, `ReportsContext`) |
| `components/` | inspectors and panels: `PropertiesPanel.tsx`, `JunctionPanel.tsx`, `SimulationPanel.tsx`, `RoadAnalysisPanel.tsx`, `PlanningPanel.tsx`, `TrafficDataPanel.tsx`, `FeasibilityPanel.tsx`, `Viewport3D.tsx` (creates the Cesium Viewer), `tools.ts` (**single source of truth for drawing tools**); subfolders `design/` (`ToolPalette`, `ToolSettings`, `ImportAreaPanel`, `AlignmentPanel`, `TransitUndergroundEditors`), `underground/`, `environment/`, `explore/`, `projects/`, `simulate/`, `data/` (catalogue + Fact updates), `ui/` (kit, badges, Tabs, Panel, dialogs) |
| `engine/objects/` | `types.ts` (`CityObjectType`, `RoadClassification`, object shapes), `ObjectManager.ts` (store, baseline ⊕ proposal overlay, per-object write queue, backend sync), `certainty.ts`, road/bridge/junction helpers |
| `engine/editing/` | `EditingEngine.ts` (draw modes, `ROAD_CLASS_DEFAULTS`, OSM import, study areas), `LocalOsmIndex.ts` + `OverpassClient.ts`, `SnapManager.ts`, `roadEdits.ts`, `junctionEdits.ts`, `drawConstraints.ts`, `autoConnect.ts`, **`AlignmentEditor.ts` + `AlignmentEditorView.ts`** (shape editor grips), **`geometryCommit.ts`** (reshape commit pipeline) |
| `engine/geometry/alignment/` | curved-alignment core, import from `index.ts`: `types`, `fillet` (PI + radius → arc), `densify`, `stationing`, `remap`, `fromPolyline` (lazy migration), `defaults` (design speed per class), `criteria` (IRC tables with sources), `checks` (screening flags) |
| `engine/simulation/` | `TrafficMicroSim.ts` (IDM), `SimulationMode.ts` (`captureBaseline`, `runComparison`, `recordRun`), `analysisRunner/Job/worker`, `liveTraffic*` (live stepping worker), `TrafficNetworkBuilder.ts`, `DemandMatrixCompiler.ts`, `staticAssignment.ts`, `roadParameters.ts` (urban speeds, IRC:106 capacities), `signalTiming.ts`, `timeOfDay.ts`, `networkCorrections.ts` (`osmRoadClass`) |
| `engine/underground/` | `UndergroundRenderer.ts`, `UndergroundView.ts`, `alignmentGeometry.ts`, `terrainProfile.ts`, `groundModels.ts`, `depthControls.ts`, `metroLevel.ts`, `reportedFacts.ts`, `sectionLayout.ts` |
| `engine/rendering/` | `RenderManager.ts`, `geometry/ProceduralGeometryGenerator.ts`, `renderers/*` (roads, buildings, transit, vehicles, highlights), `lod/`, `spatial/`, `cache/` — the **Cesium layer** for city objects |
| `components/explore/`, `components/environment/` | Cesium overlays for data layers: `municipalOverlay.ts`, `terrainOverlay.ts`, `envDataOverlay.ts`, `constraintOverlay.ts`, `treeLayer.ts`/`treeTiles.ts`, `staticLines.ts`, `envPerf.ts` (render-on-demand only in Environment) |
| `engine/` other | `scenarios/` (alternatives, versions), `history/HistoryManager.ts` (undo/redo diffs), `feasibility/` (client screening rules, `investigationRules.json`), `emissions/`, `calibration/`, `demand/`, `generator/` (scenario generator), `terrain/` (`groundHeight.ts`), `report/scenarioReport.ts` (not wired) |
| `lib/` | API clients: `api.ts`, `infraApi.ts`, `terrainApi.ts`, `envDataApi.ts`, `coordinationApi.ts`, `datasetsApi.ts`, `freshnessApi.ts`, `planningClient.ts`; `officialSources.ts`; `cesiumToken.ts` |
| `engine/testing/` | all 130 Vitest files (`*.test.ts`) + harnesses and fixtures (`vitest.config.ts` only collects here) |

### 4.3 Backend modules (`backend/`)

| Module | Role |
|---|---|
| `api/*.py` | routers. `router.py` (scenarios CRUD, `/objects`, `/objects/batch`, `/areas`), `scenario_router.py` (change sets, fork, materialised view, versions, restore, `/runs`, `/runs/compare`), `osm_router.py`, `observed_router.py` (4 routers), `traffic_data_router.py`, `feasibility_router.py`, `planning_router.py`, `coordination_router.py`, `datasets_router.py`, `terrain_router.py`, `infra_router.py`, `envdata_router.py`, `updater_router.py`, `sim_router.py`. Full list: [DATABASE_AND_CODE_GUIDE §2](DATABASE_AND_CODE_GUIDE.md) |
| `models/models.py` | core tables: `scenarios`, `city_objects`, `areas`, `scenario_object_changes`, `scenario_versions`, `scenario_version_changes`, `scenario_runs` |
| `coordination/` | `service.py` (project conflict detection: proposal elements vs other projects, baseline roads, OSM metro, utility records, buildings; only inserts run/conflict rows), `geometry.py` (UTM 43N, Shapely STRtree, rule evaluation), **`screening.py`** (Underground screening engine), **`screening_config.py`** (sourced rule table, `CONFIG_VERSION`), `screening_runs.py`, `screening_report.py`, `subsurface.py` (AGS4/CSV import), `pmc_import.py`, `seed.py` (clearance rules, environment catalogue, metro NOC rule) |
| `planning/` | projects, links, decisions, append-only `audit_log` (`audit.py`: SQLAlchemy hooks + SQLite triggers, `acting_as`, `current_actor`), `report.py` (project report model, `SECTION_TITLES`) |
| `feasibility/` | `layers.py`/`build_layers.py` (OSM site-data layers), `models.py` (`fs_*`), **`docgen.py`** (shared `DocModel`/`Section`/`Block` + PDF via fpdf2, DOCX via python-docx) |
| `terrain/` | `dem.py` (DEM sampling), `evidence.py` (groundwater, soil, sewers, boreholes along an alignment) |
| `envdata/` | `catalogue.py` (layer rows with licence/limitations, status computed from files), `render.py` (raster → PNG, land-cover areas), `vectors.py`, `trees.py`, `series.py`, `footprint.py`, `paths.py` |
| `datasets/` | registry (`models.py`, `registry.py`, `seed.py`, `importer.py`, `quality.py`, `provenance_check.py`, `updates.py`, `update_monitor.py`, `catalogue_doc.py`, `vocab.py`, `paths.py`), `pipelines/` (23 modules, each a CLI), `tools/` |
| `osm/` | `index.py` (local index reader), `build_index.py`, `overpass.py` (cached proxy) |
| `observed/`, `traffic_data/` | count files, screenlines, diurnal profile, network corrections, junction matching; Traffic Data Manager (vehicle classes, IRC:106 PCU sets, imports) |
| `updater/` | data-freshness service (§3) |
| `database/` | `connection.py` (`DATABASE_URL`, `SessionLocal`, `Base`, `get_db`), `migrations.py` |

### 4.4 Database (`backend/twincity.db`, SQLite, 44 tables)

| Group | Tables |
|---|---|
| City and alternatives | `scenarios` (one `base` baseline + proposals with `kind`, `baseline_id`), `city_objects` (`scenario_id` says which alternative an object belongs to; geometry as GeoJSON text, properties as JSON text), `areas` (saved study-area boxes), `scenario_object_changes` (a proposal's `modify`/`delete` of a base object — base rows are never edited), `scenario_versions`, `scenario_version_changes`, `scenario_runs` |
| Projects and audit | `planning_projects`, `planning_project_links`, `planning_decisions` (append-only), `audit_log` (append-only, hashed) |
| Coordination and underground | `project_proposal_elements`, `clearance_rules`, `coordination_runs`, `coordination_conflicts`, `subsurface_datasets`, `subsurface_records`, `subsurface_record_extents`, `environment_layers`, `underground_screening_runs`, `underground_verifications` |
| Feasibility | `fs_assessments`, `fs_evidence`, `fs_reviews`, `fs_documents` |
| Traffic data | `td_vehicle_classes`, `td_pcu_factor_sets`, `td_datasets`, `td_count_records`, `td_audit_log` |
| Dataset registry | `ds_sources`, `ds_datasets`, `ds_dataset_versions`, `ds_files`, `ds_processing_runs`, `ds_quality_checks`, `ds_features`, `ds_feature_dependencies`, `ds_update_checks` |
| Data freshness | `fu_runs`, `fu_documents`, `fu_claims`, `fu_proposals`, `fu_audit` |

JSON is stored as TEXT (`*_json`); no PostGIS/SpatiaLite (geoalchemy2 and psycopg2 are in requirements but unused). Only `fs_*` and `td_*` declare foreign keys; other links are by id convention. Column-level detail: [DATABASE_AND_CODE_GUIDE §3](DATABASE_AND_CODE_GUIDE.md).

### 4.5 Key data flows

**A. Draw → commit → screening → reports**
1. Design: `components/tools.ts` defines the tool; `EditingEngine.setMode` → clicks → `finalizeDrawing` builds the object (road class defaults from `ROAD_CLASS_DEFAULTS`, ground from `engine/terrain/groundHeight.ts`, constraints in `drawConstraints.ts`), splits crossed roads into junctions, and records one undo step (`HistoryManager`).
2. Persist: `ObjectManager` queues one write per object. New objects → `POST /api/objects` or `/api/objects/batch` (row in `city_objects` with the alternative's `scenario_id`); a proposal's change to an existing base object → `POST /api/scenarios/{sid}/changes` (`scenario_object_changes`). Reshape after drawing (`AlignmentEditor.ts`, `AlignmentPanel.tsx`) goes through `geometryCommit.ts`: regenerate (densify) → rejoin ends → T-splits → crossings (level decisions carried ≤ 2 m) → flyover ramps → road sections by chainage → tunnel/utility depths from PI controls → one `batch` diff and one undo step.
3. Versions: `ScenarioVersions.tsx` → `POST /api/scenarios/{sid}/versions` (frozen change set + simulation assumptions).
4. Underground screening: `components/underground/ConflictCheck.tsx` → `POST /api/coordination/underground/screen` → `coordination/screening.py` checks every proposed underground object against existing drawn objects, PMC sewer/storm records (`subsurface_records`), OSM metro (`osm/index.py`), buildings and nallas/rivers (`infra_store`), NWDP wells, imported boreholes, using `screening_config.RULES` widened by ASCE 38 positional tolerance → findings; the run is saved in `underground_screening_runs` (reopened via `/underground/runs/latest`, marked stale when inputs change). Report: `POST /api/coordination/underground/screen/report?format=pdf|docx|csv` (`screening_report.py` → `feasibility/docgen.py`).
5. Projects coordination: add proposal elements (`/api/coordination/projects/{pid}/elements`) → `POST /api/coordination/projects/{pid}/detect` (`coordination/service.py run_detection` with `clearance_rules`) → `coordination_conflicts` → Conflicts tab; status changes `PATCH /conflicts/{cid}/status`; export `GET /projects/{pid}/conflicts/export?format=csv`.
6. Reports: `GET /api/planning/projects/{id}/report?format=pdf|docx&requested_by=` → `planning/report.py build_model` (12 sections, from stored records only) → `docgen.render`; the export is audited. Catalogue of report endpoints: `shell/contexts/ReportsContext.tsx`.

**B. Simulate: study → save → compare**
1. Select a road in Simulate; `SimulationMode` builds the study area network (`traffic.worker.ts`: `TrafficNetworkBuilder`, `DemandMatrixCompiler`; roads from the local OSM index or Overpass; speeds/capacities from `roadParameters.ts`).
2. **Save existing city** (`RoadAnalysisPanel.tsx` → `SimulationMode.captureBaseline`): `analysisRunner.ts` starts `analysis.worker.ts` → `analysisJob.ts` (static user-equilibrium assignment for the area, corridor demand, micro-simulation over several seeds, emissions from `hbefa4.ts`). The run's frozen inputs/results are posted to `POST /api/runs` (`recordRun` → `scenario_runs`). Identical inputs reuse the earlier analysis (run fingerprint).
3. Make the change in Design (or an improvement option), then **Compare** (`runComparison`): same trips, hour and seeds on both; results in `ScenarioComparison`/`JunctionCompareCard`/`EmissionsCompare`; also recorded via `POST /api/runs`. "Through the day" runs each period (`timeOfDay.ts`, diurnal profile from `/api/diurnal-profile`).
4. Live view: `liveTrafficRun.ts` steps vehicles in `liveTraffic.worker.ts` (inline fallback), drawn by the vehicle renderers in `engine/rendering/renderers/` (beyond the 600-model cap as one batched point collection).
5. Backend-side comparison of stored runs exists (`POST /api/runs/compare`, `scenario_router.py`) but no frontend code calls it (checked 2026-11-22); the comparison you see is computed in the browser.

**C. Data → app** (examples): DEM `derived/elevation_copdem30/v3/*.tif` → `terrain/dem.py` → `/api/terrain/profile` → `lib/terrainApi.ts` → `components/underground/useTerrain.ts` → Profile chart; PMC layers → `infra_index.sqlite` → `/api/infra/layers/{lid}/features?bbox=` → `municipalOverlay.ts` (Cesium entities); official facts → `/api/updater/facts` → `reportedFacts.ts` → `HoverTooltip.tsx`.

---

## 5. Running locally, tests and pitfalls

### 5.1 Requirements
Python 3.11+ (CI uses 3.12), Node 20+ (CI uses 22), a Cesium ion token for imagery/terrain (free at ion.cesium.com). Ports: backend **8000**, frontend **5173** (Vite default). There is no dev proxy: the browser calls `VITE_API_BASE` directly and the backend allows any origin.

### 5.2 Linux / macOS
```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx          # tests (as CI does)
export URBANOS_DATA_DIR=/path/to/urbanos-data    # optional but needed for terrain/env/infra data
export TWINCITY_OSM_INDEX=/path/to/osm_index.db  # optional; else backend/data/osm/osm_index.db, else Overpass proxy
uvicorn main:app --reload --port 8000            # or: python main.py   → http://localhost:8000/docs

# frontend (second terminal)
cd frontend
cp .env.example .env    # set VITE_API_BASE=http://localhost:8000 and VITE_CESIUM_ION_TOKEN=...
npm install
npm run dev             # http://localhost:5173
```

### 5.3 Windows (PowerShell)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # cmd.exe: .venv\Scripts\activate.bat
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx
$env:URBANOS_DATA_DIR = "D:\urbanos-data"
$env:TWINCITY_OSM_INDEX = "D:\urbanos-osm\osm_index.db"
# optional, a scratch DB:  $env:DATABASE_URL = "sqlite:///C:/work/twincity.copy.db"   (forward slashes)
uvicorn main:app --reload --port 8000

cd ..\frontend
copy .env.example .env               # then edit VITE_API_BASE and VITE_CESIUM_ION_TOKEN
npm install
npm run dev
```
cmd.exe uses `set NAME=value` instead of `$env:NAME = "value"`. `osmium` is needed only for `python -m osm.build_index` and `python -m feasibility.build_layers` (no app module imports it at startup). If its wheel will not install, comment it out locally (do not commit that) and use a copied `osm_index.db` or the Overpass fallback.

### 5.4 Environment variables (all optional)
| Variable | Default / effect | Read in |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./twincity.db` (relative to the working directory: start from `backend/`) | `database/connection.py` |
| `URBANOS_DATA_DIR` (+ `URBANOS_RAW_DIR`, `URBANOS_DERIVED_DIR`) | data store root, §2.1 | `datasets/paths.py`, `envdata/paths.py` |
| `URBANOS_DEM_VERSION` | `v3` | `terrain/dem.py` |
| `URBANOS_INFRA_INDEX` | explicit `infra_index.sqlite` | `datasets/infra_store.py` |
| `URBANOS_RENDER_CACHE` | raster PNG cache (default `/tmp/urbanos-render-cache`) | `envdata/paths.py` |
| `URBANOS_IMPORT_ROOTS` | extra roots allowed for `POST /api/datasets/import` | `api/datasets_router.py` |
| `URBANOS_CLASSIFICATION_OVERRIDES`, `URBANOS_UPDATE_TARGETS` | importer overrides file; update-monitor targets | `datasets/importer.py`, `update_monitor.py` |
| `TWINCITY_OSM_INDEX` | `backend/data/osm/osm_index.db` | `osm/index.py` |
| `TWINCITY_OVERPASS_CACHE`, `TWINCITY_OVERPASS_CACHE_TTL_H`, `TWINCITY_OVERPASS_DAILY_BUDGET` | Overpass proxy cache / 7 days / 2,000 | `osm/overpass.py` |
| `TWINCITY_FEAS_LAYERS`, `TWINCITY_FEAS_FILES` | feasibility layers DB; evidence/document folder | `feasibility/layers.py`, `api/feasibility_router.py` |
| `TWINCITY_PDF_FONT_DIR` | TTF fonts for PDF (else Latin-1 fallback) | `feasibility/docgen.py` |
| `UPDATER_WATCHLIST`, `UPDATER_SEED`, `UPDATER_CACHE_DIR`, `UPDATER_LLM_URL/KEY/MODEL` | updater, §3 | `backend/updater/*` |
| `SUMO_HOME` | only for `POST /api/sim/spike` | `sumo/spike.py` |
| `VITE_API_BASE`, `VITE_CESIUM_ION_TOKEN` | frontend `.env` | `lib/api.ts`, `lib/cesiumToken.ts` |

### 5.5 Tests and checks
| Check | Command (directory) |
|---|---|
| TypeScript | `npx tsc -p tsconfig.app.json --noEmit` (`frontend/`). **Use this file**: `tsc -p .` checks nothing |
| Lint | `npx oxlint` or `npm run lint` (`frontend/`) |
| Frontend tests | `npm test` (Vitest, jsdom, only `src/engine/testing/**/*.test.ts`); one file: `npx vitest run src/engine/testing/GeometryCommit.test.ts` |
| Build | `npm run build` (`tsc -b && vite build`) |
| Backend tests | `python -m pytest tests -q` (`backend/`); pipelines: `python -m pytest datasets/tests -q` |
| Updater only | `python -m pytest tests/test_updater.py tests/test_update_monitor.py -q`; offline golden check `python -m updater evaluate` |
| Environment data only | `python -m pytest tests/test_envdata.py -q` |
| Underground screening | `python -m pytest tests/test_underground_screening.py tests/test_underground_final_pass.py -q` |

`backend/tests/conftest.py` points `DATABASE_URL` at a temporary file before the app is imported, so tests never touch your `twincity.db`. CI (`.github/workflows/ci.yml`) runs tsc + oxlint + vitest and `python seed.py` + pytest on pushes to `main`, `p0`, `phase/*` and PRs to `main`. On the shared dev machine, wrap heavy runs in `flock /workspace/work/heavy.lock …`.

### 5.6 Common pitfalls
- **Case-only filename differences break Windows and default macOS.** `validationSummary.ts` vs `ValidationSummary.tsx` once resolved to the wrong module and gave a white screen (fixed in `b5df4d1` by renaming to `trafficValidation.ts`). Never add two files whose names differ only by case; check with `git ls-files | tr A-Z a-z | sort | uniq -d`.
- **`osm_index.db` is git-ignored** (`backend/data/*`). A fresh clone has no local index: study-area import falls back to `GET /api/osm/overpass` (cached, rate-limited; slower, and the public servers can answer partially — incomplete answers are not cached). Build it with `python -m osm.build_index` or copy it.
- **Never commit `twincity.db`** (or any `*.db`, backups, data archives, `.env`). It was removed from git in `cd9fa1e` and is ignored by `*.db`; do not `git add -f` it. Schema changes go in models (+ `database/migrations.py` for added columns), seed data in the seed modules.
- **Start the backend from `backend/`.** `DATABASE_URL` is relative, so starting elsewhere silently creates a new empty `twincity.db` there.
- **Two data-root resolvers disagree** (`datasets/paths.py` vs `envdata/paths.py`). If Environment shows `missing` while Explore works, set `URBANOS_DATA_DIR` explicitly.
- **Environment series pin version folders in code** (`envdata/series.py`, e.g. `("cpcb_caaqms_pune", "2026-11-13")`); a new version folder is not picked up until you change it.
- **`GET /api/datasets` writes** (runs `sync_catalogues` and commits audit rows on every list).
- **Run the updater against a copy of the database first**; `seed-baseline` refuses a non-empty facts dataset (use `migrate-official-only`).
- **SQLite URLs on Windows** need forward slashes: `sqlite:///C:/path/db.db`.
- **The browser and server clocks are not IST.** Report file names are stamped in IST on purpose (`report_stamp`); keep it that way when adding exports.
- **No authentication.** The actor is a self-declared name (`localStorage['td-user']` or `x-actor`), so the audit log records what people typed.

---

## 6. How to do common tasks

### 6.1 Add a road type or change a standard value
Road classes are a closed TypeScript union: `RoadClassification = 'highway' | 'arterial' | 'collector' | 'local'` in `frontend/src/engine/objects/types.ts`. Because most tables are typed `Record<RoadClassification, …>`, **`tsc -p tsconfig.app.json` lists every place you must update** once you add a member. The places that carry values:

| Value | Where | Source rule |
|---|---|---|
| Lanes, divider, footpath, speed limit, flyover speed for a new drawn road | `ROAD_CLASS_DEFAULTS`, `frontend/src/engine/editing/EditingEngine.ts` (~line 73) | design defaults; width/capacity derive from lanes in `ObjectManager.syncRoadProperties` |
| OSM `highway=*` → class | `osmRoadClass()`, `frontend/src/engine/simulation/networkCorrections.ts` | |
| Urban speed defaults and the municipal ceiling | `URBAN_SPEED_CEILING_KMH`, `URBAN_DEFAULT_SPEED_KMH`, `CLASS_DEFAULT_SPEED` in `engine/simulation/roadParameters.ts` | cites MoRTH S.O. 1522(E) 2018 and the Maharashtra 2019 notification |
| Mid-block capacity | `IRC106_DSV`, `ircCategory`, `midblockCapacityPcu` in `roadParameters.ts` | IRC:106-1990 Table 2 |
| Design speed for the shape editor | `roadDesignSpeedKmh`, `flyoverDesignSpeedKmh` in `engine/geometry/alignment/defaults.ts` | |
| Minimum radius, eMax, SSD, gradients, vertical curves | `engine/geometry/alignment/criteria.ts` (`IRC86_*`, IRC:73, IRC:SP:23) | **every constant carries its source string**; add the clause, never an uncited number |
| Flyover/metro deck heights, ramp grade | `components/tools.ts` descriptions, `engine/objects/flyoverHelper.ts`, `bridgeElevation.ts` | see the IRC:SP:90 note in `3886d3b` |
| Tool itself (a new drawing tool) | `TOOLS` in `components/tools.ts` + a mode in `EditingMode` (`EditingEngine.ts`) + label in `NEW_OBJECT_LABEL` | a tool is listed only when a working mode backs it |

Then: add a Vitest case in `engine/testing/` (e.g. next to `DesignTools.test.ts`, `GeometryCriteriaChecks.test.ts`), run tsc + lint + tests. The backend stores road properties as JSON and does not validate the class list.

### 6.2 Add a check
- **Underground clearance rule:** add a row to `RULES` in `backend/coordination/screening_config.py` (`id`, `a`, `b` asset classes, `dim` H/V/3D, `value_m` or `diameter_factor`, optional `order`, `type` normative/draft_guideline/rule_of_thumb/international/no_norm, `source`, `clause`, `note`; `compare_only` for comparisons; `on_breach: "specialist"` when there is no numeric norm). Where two rows disagree the stricter applies and both are cited. Bump `CONFIG_VERSION`. Test in `backend/tests/test_underground_screening.py`. The rule table is served at `GET /api/coordination/underground/screening-config` and printed in the report.
- **Project (inter-agency) clearance rule:** seeded in `backend/coordination/seed.py` (rows in `clearance_rules`, each with its citation; official sources only for metro rules) or created at run time via `POST /api/coordination/clearance-rules`. Detection logic: `coordination/geometry.py` `applicable_rules`, `evaluate_pair`.
- **Geometry screening flag:** `frontend/src/engine/geometry/alignment/checks.ts` using values from `criteria.ts`; shown in `AlignmentPanel.tsx`. Keep the screening wording.
- **Feasibility / investigation rule:** `frontend/src/engine/feasibility/investigationRules.json` + `siteAssessment.ts`; absence of data is `unknown`.
- **Dataset quality check:** `backend/datasets/quality.py` `run_checks` (statuses pass/warn/fail/unknown/not_applicable).

### 6.3 Add a dataset
1. Download into `raw/<source_id>/<YYYY-MM-DD>/` with a `manifest.json` (URL, sha256, size, licence quote, classification). `python -m datasets.pipelines.gov_fetch --source-id … name=URL …` does this for plain public URLs.
2. Write a pipeline `backend/datasets/pipelines/<name>.py` (copy the pattern of `landcover.py` or `opencity_pune.py`: helpers in `_common.py`/`gov_common.py`, outputs in `derived/<dataset_id>/<version>/` plus `processing.json` with `pipeline`, `git_commit`, `inputs` (path + sha256 — list **every** input), `parameters`, `outputs`, `validation`, `classification`/`data_class`, `suitability`). Never modify raw files.
3. Register: `python -m datasets.importer` (or `POST /api/datasets/import`). Review the new version (`POST /api/datasets/versions/{id}/review`) and run quality checks.
4. If a feature depends on it, add the dependency in `backend/datasets/seed.py` (feature → theme/dataset) so the Data catalogue's Features tab shows readiness.
5. Serve it: a reader in the right module (`envdata/` for Environment layers — add a `Layer(...)` row in `envdata/catalogue.py` with licence, limitations and legend; `terrain/` for subsurface; or a new layer in `infra_index.py` `LAYERS` then rebuild the index), an endpoint in the matching router, a client in `frontend/src/lib/`, and the UI with a certainty badge.
6. Licence: if it is restricted, say so in the manifest and the layer row; keep it out of any public bundle. Add an update check (`update_targets.json`) if the publisher has machine-readable metadata.
7. Tests: a pipeline function test in `backend/datasets/tests/`, an API test in `backend/tests/` (see `test_envdata.py`, `test_infra_data.py`).

### 6.4 Add a report section
- **Planning project report** (`backend/planning/report.py`): add the title to `SECTION_TITLES` and append a block list to `S` in `build_model` in the same position (`assert len(S) == len(SECTION_TITLES)` enforces it). Build blocks with `feasibility/docgen.py` `Block(kind="para"|"subhead"|"bullets"|"table"|"note", …)`. Use only stored records and label every number (measured / estimated / manual / synthetic, or "model output (run …)"); write UNKNOWN, never 0, when something is missing. Test in `backend/tests/test_planning.py`; check PDF table column widths (`_col_widths`) with long words.
- **Underground screening report** (`backend/coordination/screening_report.py` `build_model`, CSV in `to_csv`): same `DocModel` renderers. Test in `test_underground_screening_report.py`.
- **Investigation Requirements Document** (`feasibility/docgen.py build_model`).
- List any new export in `frontend/src/shell/contexts/ReportsContext.tsx` (the Reports catalogue lists only endpoints that exist).

---

## 7. Known limits and open items
Verified in the code at `ba7a003` unless marked.

**Data and models**
- **Terrain is a DSM, screening only** (Copernicus GLO-30, ~30 m, EGM2008; NMAD 2.19 m against PMC manhole tops — [DEM_V1_V3_COMPARISON.md](DEM_V1_V3_COMPARISON.md)). Not for invert levels, cut/fill, drainage design or flood depth.
- **Traffic model not calibrated or validated** (0/15 GEH < 5; screen line −30.5 %); demand estimated from land use; Pune has no openly published official counts. The validation text is **hard-coded** (`SimulateContext.tsx`, `trafficValidation.ts`), not computed.
- **Underground depths are mostly unknown**: PMC levels are design values (QL-D), most pipes have no usable depth, there are no boreholes, no water-supply network, and OSM never maps metro tunnel depth (only an approved official figure appears, as text).
- **Restricted licences**: OpenCity/PMC, IMD, AutoDCR, Bhuvan, NWDP unknown — internal only.
- **Registry metadata thin** for many versions (CRS, dates, coverage, licence mostly in the manifests); NASADEM is an unlisted input to the DEM; `bhuvan_wms_samples` still `active` with only its manifest; `elevation_copdem30` v2 still `pending_review`.
- Not wired: noise, heat, seismic, flood screening, drainage model, population exposure, ground model (`ds_features.wired = 0`).
- The official facts dataset is consumed only by the Underground tooltip; Projects does not read it yet.

**Code**
- `SumoService` is a stub; only `POST /api/sim/spike` works, with `SUMO_HOME`.
- `engine/report/scenarioReport.ts` not wired.
- Two data-root resolvers; Environment series pin versions; `GET /api/datasets` has side effects.
- `environment_layers` rows say `not_imported` although `/api/env-data` serves data (only the UI merges them).
- No authentication or roles; CORS `*`; self-declared actor.
- `city_objects` and `areas` writes are not audited; `areas` grows one row per study-area box.
- Unused dependencies: `@tanstack/react-query`, `geoalchemy2`, `psycopg2-binary`.
- `OverpassClient.ts` still calls `fetch` directly (deliberate offline fallback).
- Explore caps buildings in view; the full storm-drain file is indexed only through `infra_index` (REPORTED, PHASE2_FINAL_REPORT §10).

**Open decisions** (carried from [CURRENT_STATUS_AND_ROADMAP §8](CURRENT_STATUS_AND_ROADMAP.md)): licence treatment for OpenCity/IMD/AutoDCR; accounts (Bhuvan, GSI Bhukosh, data.gov.in, OpenAQ, Copernicus Data Space); DEM v2 rejection; traffic counts source and calibration approach; Phase B cleanup.

**Good first tasks**: compute the Simulate validation text from `backend/data/observed_validation/`; make `GET /api/datasets` side-effect free with a test; add NASADEM to the elevation `processing.json` inputs; unify `datasets/paths.py` and `envdata/paths.py`; let the Projects workspace show official facts for linked projects.
