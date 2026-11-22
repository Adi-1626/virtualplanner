# UrbanOS / VirtualPlanner: Data Catalogue

This document lists every dataset in the two UrbanOS data archives. For each one it gives what the data is, where it came from, its licence, its status in the registry, and which app feature reads it.

Written Sat 2026-11-14 (IST) as a **read-only audit**. Nothing in the repo, the registry DB, or the data directories was changed to produce it.

> **Updated 2026-11-22 (IST) against `main` at `ba7a003`.** The data on disk has not changed since this audit (still 19 raw source folders and 40 derived dataset folders under `/workspace/work/urbanos-data`, re-listed 2026-11-22). Changes since: (1) a new registry dataset, `pune_infra_project_facts`, written only by the data-freshness service (§4.6); (2) the export zips named below (`urbanos-data-raw.zip`, `urbanos-data-derived.zip`) are no longer in `/workspace/work/export/`; (3) the `backend/data/osm/*` files in §4.5 exist only in the original dev checkout (`/workspace/work/virtualplanner/backend/data/osm/`), never in git, so a fresh clone must build them (`python -m osm.build_index`, `python -m feasibility.build_layers`) or rely on the Overpass proxy. Where each dataset is served and used in the app, with what you must download yourself: [DEVELOPER_HANDBOOK.md §2](DEVELOPER_HANDBOOK.md).

**Sibling docs:** [START_HERE](START_HERE.md) · [PROJECT_OVERVIEW](PROJECT_OVERVIEW.md) · [DATABASE_AND_CODE_GUIDE](DATABASE_AND_CODE_GUIDE.md) · [CURRENT_STATUS_AND_ROADMAP](CURRENT_STATUS_AND_ROADMAP.md) · [LEARNING_GUIDE](LEARNING_GUIDE.md).
**Deeper references:** [DATA_SOURCE_CATALOGUE](DATA_SOURCE_CATALOGUE.md), [DATA_RETENTION_AUDIT](DATA_RETENTION_AUDIT.md), [INFRASTRUCTURE_DATA](INFRASTRUCTURE_DATA.md), [ENVIRONMENT_DATA](ENVIRONMENT_DATA.md), [TERRAIN_AND_SUBSURFACE_DATA](TERRAIN_AND_SUBSURFACE_DATA.md), [DEM_V1_V3_COMPARISON](DEM_V1_V3_COMPARISON.md).

### Sources used for this document
| What | Where |
|---|---|
| Archive file lists and sizes | `unzip -l` of `/workspace/work/export/urbanos-data-raw.zip` (291 entries, 2,997,906,108 B) and `urbanos-data-derived.zip` (236 entries, 3,100,384,738 B) |
| Source URL, licence, dates, inputs, parameters | The `manifest.json` and `processing.json` files extracted to `/workspace/work/inspect-2026-11-14/urbanos-data/` |
| Registry | `/workspace/work/inspect-2026-11-14/virtualplanner/backend/twincity.db`, opened `mode=ro`, tables `ds_*` |
| Raster CRS | The GeoTIFF GeoKey header of each raster in the live copy `/workspace/work/urbanos-data/` (read by a pure-Python header reader; GDAL/rasterio are not installed) |
| Feature usage | `grep` of the zipped code copy (`backend/api`, `terrain/`, `envdata/`, `datasets/infra_store.py`, `coordination/`, `frontend/src`), plus the registry's own `ds_features` / `ds_feature_dependencies` tables |
| Deletions | `/workspace/work/inspect-2026-11-14/deletion_manifest.tsv` and [DATA_RETENTION_AUDIT](DATA_RETENTION_AUDIT.md) §10–§11 |

Anything marked *(inferred)* was not stated in a source file and is my reading.

---

## 1. GIS primer (for beginners, with Pune examples)

The **study box** used by every UrbanOS pipeline is longitude 73.70–74.05° E, latitude 18.40–18.70° N. It covers the PMC area plus edges of PCMC, from Katraj in the south to Bhosari in the north.

| Idea | What it means | Pune example in this data |
|---|---|---|
| **Raster** | A grid of equal cells, each holding one number. Good for things that vary smoothly over the ground. | `elevation_copdem30`: each 30 m cell holds a height in metres. The study box ranges from 519.5 m (Mula-Mutha riverbed) to 1,149.7 m (the hills on the box edge). |
| **Vector** | Points, lines and polygons, each with attributes. Good for discrete objects. | Points: 547 public toilets. Lines: 44,482 PMC sewer pipes. Polygons: 41 electoral wards (2025). |
| **CRS** (coordinate reference system) | Says what the coordinate numbers mean. **EPSG:4326** is WGS84 longitude/latitude in degrees, used by GPS, KML, GeoJSON and the web map. **EPSG:32643** is UTM zone 43N in metres, used for measuring. Pune sits inside zone 43N (72–78° E). | Shivajinagar is about (73.85° E, 18.53° N) in 4326, and about (378,000 m E, 2,049,000 m N) in 32643 *(inferred approximate values)*. Lengths, areas and slopes are computed in 32643, because one degree is not a fixed distance. |
| **Resolution** | The ground size of one raster cell. | Copernicus DEM: 1 arc-second, which is about 30 m. In UTM the pipeline resamples it to exactly 30 m × 30 m = 900 m² per cell. WorldCover and Sentinel-2 are 10 m. SoilGrids is 250 m. IMD rainfall is 0.25° (about 27 km), so only 4 cells cover the whole city. |
| **DEM / DSM / DTM** | A DEM is any elevation grid. A **DSM** (surface model) includes roofs and tree tops. A **DTM** (bare-earth) does not. | Copernicus GLO-30 and NASADEM are both **DSMs**. Over dense areas such as Peth Pune, "ground" heights include buildings. This is why every terrain product here is *screening only*. |
| **Slope** | How steep each cell is, from the height differences with its neighbours. | `slope_deg_epsg32643.tif`. Steep cells mark Parvati hill, the Katraj ghat and the Vetal tekdi ridge. |
| **Flow direction / accumulation** | **Flow direction (D8)**: each cell drains to its lowest of 8 neighbours. **Flow accumulation**: how many upstream cells drain through a cell. A high value means a channel. Above 1 km² of upstream area the pipeline calls it a "derived stream". Outlets above 10 km² define catchments. | `flowdir_d8_esri…`, `flowacc_cells…`, `streams_derived….geojson`. On a DSM these paths can follow rooftops, not the nallas. Compare them with the `pmc_nallas` layer. |
| **Building footprints** | Polygons of building outlines. Here they come from machine learning on imagery, not a survey. | Google Open Buildings v3 has 1,128,393 footprints in the box. These are merged with Microsoft and OSM footprints in `buildings_comparison`. |
| **Road centrelines** | One line along the middle of each road. Width and right of way are not included. | `pmc_road_centerline`: 25,485 lines. |
| **Utility networks** | Underground pipes as lines, and access chambers (manholes) as points. Attributes such as invert level (pipe-bottom height) let you compute depth. | PMC sewer (44,482 lines, with design invert levels). Storm-water drains (141,341 lines; only 9,187 are labelled "Storm water drains"). SWD chambers (22,771 points). Quality is ASCE 38 **QL-D** (records only, not verified in the field). |
| **Gridded rainfall** | Rain estimated on a regular grid from rain gauges and/or satellites. | IMD 0.25° daily (2000–2025). CHIRPS 0.05°, averaged over the box (1986–2025): mean 874 mm/yr, 83% of it falling Jun–Sep. This is not an IDF (design-storm) source. |
| **NDVI / land cover** | **NDVI** = (NIR − Red)/(NIR + Red) from satellite bands. It is high for vegetation and near 0 for concrete or water. **Land cover** assigns each cell a class such as built-up, tree cover or water. | Sentinel-2 NDVI for 2025-11-14 has a mean of 0.44. ESA WorldCover 2021 provides the classes at 10 m. |
| **Groundwater wells** | Monitoring wells where depth to water (m below ground level) is measured, usually quarterly. | `nwdp_groundwater_pune`: 36 wells (15 CGWB, 21 GSDA), last reading 2025-10-01. |
| **AQ stations** | Continuous ambient air-quality monitors (PM2.5, PM10, NO₂, CO, O₃) at fixed points. | `cpcb_caaqms_pune`: 7 IITM/MPCB stations (Alandi, Bhosari, Bhumkar Nagar, Dhankawadi, Hadapsar, Karve Road, Katraj Dairy), 15-minute data for 2024–25. |

**Data classes used by the registry** (`ds_dataset_versions.data_class`):
- **observed**: measured or published as recorded.
- **estimated**: a model or blend, such as CHIRPS or SoilGrids.
- **derived**: computed by our pipelines.
- **inferred**: ML or classifier output, such as building footprints and WorldCover.
- **synthetic**: demo seed data.

Every UrbanOS dataset is marked suitability **screening** or **visualisation**. None is cleared for engineering design.

---

## 2. Raw inventory: `urbanos-data/raw/` (19 source directories, all dated `2026-11-13`)

Registry status is the active `ds_dataset_versions` row. Sizes are bytes in the zip, rounded to MB (1 MB = 10⁶ B). The CRS for rasters was read from the GeoTIFF header. For KML, KML 2.2 requires EPSG:4326.

| Dataset dir | What it is | Source / publisher | Format | Coverage | Data date | CRS | Licence (as recorded) | Size | Registry |
|---|---|---|---|---|---|---|---|---|---|
| `bhuvan_ogc_capabilities` | WMS/WFS *GetCapabilities* XML for 4 Bhuvan servers. A list of layers only, with no map data. | NRSC/ISRO Bhuvan | XML ×5 | India-wide service metadata | retrieved 2026-11-13 | n/a | UNKNOWN; Bhuvan ToS forbid copying without NRSC authorisation (retention audit §9) | 22.9 MB | active · observed · visualisation |
| `bhuvan_wms_samples` | 10 WMS map renders (geomorphology, groundwater prospects, LULC, slope, soil, drainage, built-up). **The PNGs were deleted on 2026-11-13 for ToS reasons. Only `manifest.json` remains.** | NRSC/ISRO Bhuvan | manifest JSON only | bbox 73.70–74.05 E, 18.40–18.70 N | retrieved 2026-11-13 | requested as EPSG:4326 | UNKNOWN; watermarked, ToS-restricted | 0.02 MB on disk (registry still lists 4.82 MB) | active · derived; **10 file rows role=withdrawn** |
| `chirps_v2_climateserv` | Daily rainfall averaged over the study box, from the CHIRPS v2 0.05° grid | Climate Hazards Center (UCSB), via SERVIR ClimateSERV API | JSON ×2 | study box (area average) | 1986-01-01 to 2025-12-31 | n/a (one series; source grid is geographic 0.05°) | Data: public domain (CC0). API terms: UNKNOWN | 2.5 MB | active · estimated |
| `copernicus_dem_glo30` | 30 m surface model (DSM). Two whole 1°×1° COG tiles, N18E073 and N18E074 | ESA / Copernicus (DLR, Airbus DS), AWS mirror | GeoTIFF COG ×2 | 73–75 E, 18–19 N | 2021 release (object Last-Modified 2022-05-09) | **EPSG:4326**, 1″; vertical EGM2008 | Copernicus DEM GLO-30 free licence; attribution required | 84.8 MB | active · observed |
| `cpcb_caaqms_station_list` | All-India list of continuous AQ stations | CPCB (CCR) | PDF | India | PDF Last-Modified 2026-11-12 | not recorded | UNKNOWN | 0.04 MB | active · observed |
| `datameet_municipal_wards` | Community-traced electoral wards: PMC 2022 and PCMC | DataMeet (GitHub `Municipal_Spatial_Data`) | GeoJSON ×2 | PMC + PCMC | PMC 2022 ward set | EPSG:4326 *(inferred: GeoJSON default; not recorded)* | **CC BY-SA 2.5 India** (share-alike) | 0.43 MB | active · **inferred** |
| `esa_worldcover_2021_v200` | 10 m land-cover classes. Whole 3°×3° tile N18E072 | ESA WorldCover / VITO | GeoTIFF | 72–75 E, 18–21 N | 2021 | **EPSG:4326**, 8.33e-5° (≈10 m) | CC BY 4.0 | 125.8 MB | active · inferred (older "derived" row superseded) |
| `google_open_buildings_v3` | ML building polygons from S2 tile `3bd`, keeping rows whose centroid falls in the box (1,128,393 rows), plus score thresholds and the tile index | Google Research | CSV (WKT polygons) + CSV + GeoJSON | study box | inference May 2023 (file 2023-06-23) | EPSG:4326 *(inferred: WKT lon/lat; not recorded)* | CC BY 4.0 **or** ODbL 1.0 (user's choice) | 293.0 MB | active · inferred (older row superseded) |
| `imd_gridded_rainfall_025` | IMD daily gridded rainfall, all-India, one binary file per year | IMD Pune (Pai et al. 2014) | `.grd` binary ×26 | India, 0.25° | 2000–2025 | geographic 0.25° lat/lon grid; datum not recorded | No licence on the page (cite Pai et al. 2014); registry: UNKNOWN | 661.6 MB | active · estimated |
| `jrc_gsw` | Global Surface Water: occurrence, extent, seasonality. Tile 70E_20N, v1.5 (1984–2024) and v1.4 (1984–2021) | EC JRC / Google | GeoTIFF ×5 | 70–80 E, 10–20 N | 1984–2024 | **EPSG:4326**, 0.00025° | Copernicus, free without restriction; cite Pekel 2016 | 145.4 MB | active · derived |
| `ms_global_ml_buildings` | ML building footprints, 4 quadkey tiles (123301200–203), plus `dataset-links.csv` | Microsoft (Bing Maps) | GeoJSONL in `.csv.gz` | the 4 quadkeys around Pune | release 2026-08-13 (imagery 2014–2024) | EPSG:4326 *(inferred: GeoJSON)* | CDLA Permissive 2.0 | 57.9 MB | active · inferred (older row superseded) |
| `nasadem_pc` | NASADEM elevation, windowed to the study box. Used only as a comparison for the Copernicus DEM | NASA (SRTM Feb 2000), via Microsoft Planetary Computer | GeoTIFF ×2 | study box | Feb 2000 | **EPSG:4326**, 1″; vertical EGM96 | **UNKNOWN** (Planetary Computer says "proprietary"; LP DAAC says no restrictions) | 0.9 MB | active · observed |
| `nwdp_india_wris` | Groundwater levels (Maharashtra manual quarterly 1970–2025; CGWB MH 1991–2020 and 2021–2025) and IMD district daily rainfall | National Water Data Portal (NWIC); producers CGWB, GSDA, IMD | CSV ×4 | Maharashtra / all districts | 1970–2025 | point lat/lon, datum not recorded | GW: CKAN "Other (Open)". IMD rain: licence field empty. Registry: UNKNOWN | 117.5 MB | active · observed |
| `nwdp_meta` | CKAN `package_show` metadata for 4 NWDP packages (the baseline for update checks) | NWDP CKAN API | JSON ×4 | n/a | 2026-11-13 | n/a | UNKNOWN | 0.15 MB | active · observed · visualisation |
| `opencity_pune` | 96 files from 28 CKAN datasets. Tree census 2019 (17 CSV parts, ≈4.0 M trees), storm-water drains, nallas, rivers, SWD chambers, sewer network, STPs, wards (2012/2017/2022/2025, admin 2017, prabhag, zones), revenue map, road centreline, PMPML stops/depots/routes, amenities, AQ station CSVs (2017–23 hourly and 2024–25 15-min), census, schools, health, slums, rainfall tables | OpenCity (Oorvani Foundation) mirror. Original publishers: mostly PMC; AQ from CPCB/IITM/MPCB; water-bodies census from Jal Shakti | CSV ×72, KML ×20, KMZ ×4 | Pune (PMC) | CKAN modified 2025-11-25 to 2026-01-15; content vintages 1981–2025 | KML/KMZ EPSG:4326; CSV lat/lon | **Conflicting:** CKAN "Other (Public Domain)"; OpenCity FAQ ODbL + credit; site T&C non-commercial; water-bodies census KML "Creative Commons Non-Commercial" | 1,360.9 MB | active · observed |
| `pmc_autodcr_geoserver_probe` | A verification probe of PMC's AutoDCR GeoServer: capabilities, hit counts, 1 sample feature for each of 10 layers (DP, Red_Blue flood lines, TOD zones, Monuments, Reservation, etc.), and 4 WMS PNG renders. **No bulk download.** | PMC (iwmsgis.pmc.gov.in) | XML, JSON, PNG ×26 | PMC | 2026-11-13 | not recorded | UNKNOWN; PMC SmartGIS terms say personal / non-commercial | 1.1 MB | active · observed · visualisation |
| `pmc_opendata_portal_catalogue` | Catalogue page of the PMC open-data portal (up to 300 datasets). Downloads need a CAPTCHA form, so they were not automated. | PMC open-data portal | JSON | n/a | 2026-11-13 | n/a | NDSAP-based policy; per-dataset licence not stated | 0.12 MB | active · observed · visualisation |
| `sentinel2_l2a_earthsearch` | Sentinel-2 L2A bands B03, B04, B08, B11 and SCL, windowed to Pune, for 2 scenes, plus their STAC items | ESA Copernicus, via Element 84 Earth Search (AWS) | GeoTIFF ×10 + JSON ×2 | study window of tile 43QCA | 2019-11-26 and 2025-11-14 | **EPSG:32643**: 10 m (B11 20 m) | Copernicus Sentinel legal notice (free, full, open); attribution | 122.3 MB | active · observed |
| `soilgrids_250m_v2` | 8 soil properties × 4 depths (0–60 cm): bdod, cfvo, clay, sand, silt, soc, wv0033, wv1500 | ISRIC (SoilGrids 2.0) | GeoTIFF ×32 | study window | model release date not recorded | **Interrupted Goode Homolosine** (`+proj=igh`), 250 m (no EPSG code) | CC BY 4.0 | 0.7 MB | active · estimated |

**Raw total:** 19 directories, 2,997,906,108 B (≈3.0 GB).

Unused OpenCity material: 47 of the 96 OpenCity files (2.7 MB, all small CSV tables) are not an input to any derived dataset. These are schools, hospitals, slums, census 1981/1991/2001, streetlights, water supply, travel mode share, fire-call statistics, STP flows, drain-coverage tables, the bus-route list, the 2017–2023 hourly AQ CSVs, and PMC rainfall/temperature tables.

---

## 3. Derived inventory: `urbanos-data/derived/` (40 dataset dirs, 42 versions)

"Generated by" is the `pipeline` field in `processing.json`. **No `processing.json` records a literal command line.** The command shown is the CLI usage documented in that pipeline module's docstring (`backend/datasets/pipelines/*.py`), with the parameters recorded in `processing.json`. "Used by" is from the code grep and the registry's feature map. Statuses are from the registry.

| Dataset / version | What | Generated by (module · command) | Depends on raw | Format · CRS | Size | Registry status · class | Used by feature |
|---|---|---|---|---|---|---|---|
| `elevation_copdem30/v3` | Mosaic and clip of the DEM (4326 + 30 m UTM), hillshade, slope, filled and hydro-conditioned DEM, D8 flow direction, flow accumulation, derived streams, edge-outlet catchments, Cop−NASADEM difference, PNG overlays. Fixes v2's half-pixel mosaic shift. | `datasets.pipelines.elevation` · `python -m datasets.pipelines.elevation process` (commit b2bffe9a) | copernicus_dem_glo30 (+ nasadem_pc, see §4) | GeoTIFF COG / GeoJSON / PNG · EPSG:4326 + EPSG:32643 30 m | 41.0 MB | **active** · derived | Terrain API `/api/terrain/*` (`terrain/dem.py` `DEFAULT_VERSION="v3"`): Explore → terrain overlay; Underground → alignment profile, elevation readout. Environment → derived streams and catchments (`envdata/catalogue.py`) |
| `elevation_copdem30/v2` | Same as v3 but with its own numpy D8 replacing the GPL pysheds library; has the half-pixel shift | same module (commit fc58a15a) | copernicus_dem_glo30 | as above | 41.1 MB | **pending_review** · derived | none (not read by code) |
| `elevation_copdem30/v1` | First run (pysheds D8) | same module (commit 346e8715) | copernicus_dem_glo30 | as above (no overlays) | 39.6 MB | **superseded** · derived | none |
| `buildings_comparison/v1` | Google + Microsoft + OSM footprints merged with a conflict flag; 1 km coverage grid; stats | `datasets.pipelines.buildings` · `python -m datasets.pipelines.buildings process` | google_open_buildings_v3, ms_global_ml_buildings; + repo `backend/data/osm/osm_index.db` | FlatGeobuf EPSG:32643, GeoJSON | 622.9 MB | active · derived | Indirectly, through the `infra_index` "buildings" layer: Explore → municipal layers; Projects → building conflicts |
| `infra_index/v1` | SQLite R*Tree spatial index of 24 municipal layers plus merged buildings. Adds sewer depth = cover − invert (design values, unverified). | `datasets.pipelines.infra_index` · `python -m datasets.pipelines.infra_index --version v1` | (derived) 24 `pmc_*`/`pmpml_*`/`pune_libraries`/`water_bodies…` geojsons + `buildings_comparison/v1` | SQLite (WKB) · EPSG:4326 | 817.8 MB | active · derived | `/api/infra/*` (`datasets/infra_store.py`): Explore → Municipal layers. `coordination/pmc_import.py` + `service.py`: Projects → municipal utility conflicts, building conflicts |
| `pmc_sewage_pipelines/2026-11-13` | PMC sewer lines (44,482) with design invert and cover levels | `datasets.pipelines.opencity_pune derive` · `python -m datasets.pipelines.opencity_pune derive --raw-date 2026-11-13` | opencity_pune (`pmc_sewage_pipeline.kmz`) | GeoJSON · EPSG:4326 | 52.6 MB | active · observed | Through infra_index layer `sewer`; input to `pmc_sewage_pipelines_fgb` |
| `pmc_sewage_pipelines_fgb/v1` | The same sewer lines as a spatially indexed FlatGeobuf | `datasets.pipelines.subsurface_index` · `python -m datasets.pipelines.subsurface_index --src-version 2026-11-13` | (derived) pmc_sewage_pipelines | FlatGeobuf · EPSG:4326 | 14.5 MB | active · observed | `terrain/evidence.py`: Underground → subsurface evidence (`/api/terrain/subsurface-evidence`) |
| `pmc_stormwater_drains/2026-11-13` | Storm-water drain lines (141,341; 9,187 labelled storm drains) | opencity_pune derive (as above) | opencity_pune (KMZ) | GeoJSON · 4326 | 149.6 MB | active · observed | infra_index `storm_drains`: Explore municipal layers; Projects utility conflicts |
| `pmc_swd_chambers/2026-11-13` | Storm-water chambers (22,771 points) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 5.8 MB | active · observed | infra_index `swd_chambers`: Explore |
| `pmc_swd_utility_chambers/2026-11-13` | SWD utility chambers (4,233 points; 2,481 duplicate geometries) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 1.3 MB | active · observed | infra_index `swd_utility_chambers`: Explore |
| `pmc_nallas/2026-11-13` | Nalla (stream) centrelines (3,075) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 1.7 MB | active · observed | infra_index `nallas`: Explore |
| `pmc_rivers/2026-11-13` | River polygons (12). Not flood lines | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.07 MB | active · observed | infra_index `rivers`: Explore |
| `water_bodies_census_pune_2023/2026-11-13` | Water-bodies census points (225 in the box, of 3,680) | opencity_pune derive | opencity_pune (KML, **CC-NC**) | GeoJSON · 4326 | 0.2 MB | active · observed | infra_index `water_bodies`: Explore |
| `pmc_road_centerline/2026-11-13` | Road centrelines (25,485) | opencity_pune derive | opencity_pune (KMZ) | GeoJSON · 4326 | 19.3 MB | active · observed | infra_index `road_centreline`: Explore |
| `pmpml_bus_stops/2026-11-13` | Bus stops (4,659 in the box) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 1.6 MB | active · observed | infra_index `bus_stops`: Explore |
| `pmpml_bus_depots/2026-11-13` | Bus depots (9) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.005 MB | active · observed | infra_index `bus_depots`: Explore |
| `pmc_electoral_wards_2025/2026-11-13` | Electoral wards 2025 (41) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.13 MB | active · observed | infra_index `wards_2025`: Explore |
| `pmc_electoral_wards_2022/2026-11-13` | Electoral wards 2022 (58) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.22 MB | active · observed | infra_index `wards_2022` (flagged non-active, kept for history): Explore |
| `pmc_electoral_wards_2017/2026-11-13` | Electoral wards 2017 (41) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.09 MB | active · observed | infra_index `wards_2017` (flagged non-active, kept for history): Explore |
| `pmc_electoral_wards_2012/2026-11-13` | Electoral wards 2012 (76) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.89 MB | active · observed | infra_index `wards_2012` (flagged non-active, kept for history): Explore |
| `pmc_admin_wards_2017/2026-11-13` | Administrative wards 2017 (15) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.26 MB | active · observed | infra_index `admin_wards_2017`: Explore |
| `pmc_prabhag_boundary/2026-11-13` | Prabhag boundaries (72; vintage not stated) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.87 MB | active · observed | infra_index `prabhag`: Explore |
| `pmc_zones/2026-11-13` | PMC zones (5) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.18 MB | active · observed | infra_index `zones`: Explore |
| `pmc_revenue_map/2026-11-13` | Revenue parcels, gut/TPS (29,140) | opencity_pune derive | opencity_pune (KMZ) | GeoJSON · 4326 | 20.1 MB | active · observed | infra_index `revenue_parcels`: Explore |
| `pmc_fire_stations/2026-11-13` | Fire stations (14) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.006 MB | active · observed | infra_index `fire_stations`: Explore |
| `pmc_public_toilets/2026-11-13` | Public toilets (547) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.10 MB | active · observed | infra_index `public_toilets`: Explore |
| `pmc_parks_gardens/2026-11-13` | Parks and gardens (198) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.32 MB | active · observed | infra_index `parks`: Explore |
| `pune_libraries/2026-11-13` | Libraries (56) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.02 MB | active · observed | infra_index `libraries`: Explore |
| `pmc_crematoriums/2026-11-13` | Crematoriums and burial grounds (81) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.06 MB | active · observed | infra_index `crematoriums`: Explore |
| `pmc_stps/2026-11-13` | Sewage treatment plants, existing and proposed (20) | opencity_pune derive | opencity_pune (KML) | GeoJSON · 4326 | 0.02 MB | active · observed | infra_index `stps`: Explore |
| `census2011_pune_wards/2026-11-13` | Census 2011 ward table (145 wards). Not mappable | `datasets.pipelines.census2011_wards` · `python -m datasets.pipelines.census2011_wards` | opencity_pune (CSV) | JSON (no geometry) | 0.03 MB | active · observed | `/api/infra/census2011`: Explore → Municipal layers (listed, "not mappable") |
| `pmc_tree_census_2019/2026-11-13` | Tree census as one cleaned CSV (4,009,623 trees) | `datasets.pipelines.opencity_trees` · `python -m datasets.pipelines.opencity_trees --raw-date 2026-11-13` | opencity_pune (17 CSV parts) | CSV (lon/lat) | 466.0 MB | active · observed | Indirectly, through the index below |
| `pmc_tree_census_2019_index/v1` | Trees repacked into SQLite R*Tree + grid counts | `datasets.pipelines.tree_index` · `python -m datasets.pipelines.tree_index --input-version 2026-11-13 --version v1` | (derived) pmc_tree_census_2019 | SQLite | 457.4 MB | active (+1 superseded duplicate row) · derived | `/api/envdata/trees*` (`envdata/trees.py`): Environment → Vegetation (tree census layer) |
| `cpcb_caaqms_pune/2026-11-13` | 15-min AQ series for 7 stations (UTC converted to IST) + station points | `datasets.pipelines.cpcb_air_quality` · `--raw-date 2026-11-13` | cpcb_caaqms_station_list + opencity_pune (7 AQ CSVs, 2024–25) | CSV + GeoJSON · 4326 | 16.5 MB | active · observed | `/api/envdata/air/*` (`envdata/series.py`): Environment → Air quality |
| `imd_rainfall_025_pune/2026-11-13` | Daily rainfall for the 4 IMD cells over Pune, plus annual totals | `datasets.pipelines.imd_rainfall` · `--years 2000-2025` | imd_gridded_rainfall_025 | CSV + GeoJSON · 4326 | 1.05 MB | active · estimated | `/api/envdata/rainfall/*`: Environment → Rainfall |
| `imd_district_rainfall_pune/2026-11-13` | IMD district-average daily rainfall, Pune (86 rows) | `datasets.pipelines.nwdp_groundwater` (rain) · `--raw-date 2026-11-13` | nwdp_india_wris | CSV | 0.004 MB | active · derived | `/api/envdata/rainfall/*`: Environment → Rainfall |
| `rainfall_chirps_boxavg/v1` | CHIRPS daily box-average CSV + summary | `datasets.pipelines.chirps` · `python -m datasets.pipelines.chirps process` | chirps_v2_climateserv | CSV + JSON | 0.28 MB | active · estimated | `/api/envdata/rainfall/*`: Environment → Rainfall |
| `nwdp_groundwater_pune/2026-11-13` | Groundwater observations (2,849) at 36 wells | `datasets.pipelines.nwdp_groundwater` (gwl) · `--raw-date 2026-11-13` | nwdp_india_wris | CSV + GeoJSON · 4326 | 0.33 MB | active · observed | `terrain/evidence.py`: Underground → subsurface evidence (wells) |
| `soil_soilgrids250/v1` | 0–30 cm weighted soil rasters (clay, sand, silt, bdod, soc, cfvo, wv0033, wv1500, AWC proxy) | `datasets.pipelines.soil` · `python -m datasets.pipelines.soil process` | soilgrids_250m_v2 | GeoTIFF · EPSG:32643 250 m | 0.39 MB | active · estimated | Environment → Soil (`envdata/catalogue.py`); Underground → subsurface evidence (soil) |
| `landcover_worldcover2021/v1` | WorldCover clipped (4326 + 10 m UTM), class areas per PMC/PCMC zone | `datasets.pipelines.landcover` · `python -m datasets.pipelines.landcover process` | esa_worldcover_2021_v200 + datameet_municipal_wards | GeoTIFF · EPSG:4326 + 32643; JSON | 5.1 MB | active · inferred (older "derived" row superseded) | `/api/envdata/layers/landcover_worldcover2021/*`: Environment → Vegetation / land cover |
| `sentinel2_indices/v1` | NDVI, NDWI, MNDWI, NDBI for both scenes + built-up change raster | `datasets.pipelines.sentinel2` · `python -m datasets.pipelines.sentinel2 process` | sentinel2_l2a_earthsearch | GeoTIFF · EPSG:32643 10 m | 320.7 MB | active · derived | Environment → NDVI (Vegetation), MNDWI (Water). The built-up change layer is **status "rejected"** (F1 0.457 against WorldCover) and not drawn |
| `surface_water_jrc_gsw/v1` | GSW occurrence, extent and seasonality clipped (v1.5 and v1.4) | `datasets.pipelines.surface_water` · `python -m datasets.pipelines.surface_water process` | jrc_gsw | GeoTIFF · EPSG:4326 (+ 32643 30 m occurrence) | 0.28 MB | active · derived | Environment → Surface water occurrence |

**Derived total:** 3,100,384,738 B (≈3.1 GB). `infra_index` (818 MB), `buildings_comparison` (623 MB), the two tree datasets (923 MB) and `sentinel2_indices` (321 MB) make up about 87% of it.

---

## 4. Lineage and status summary

### 4.1 Raw → derived
```
copernicus_dem_glo30 ─┬─► elevation_copdem30 v1 (superseded) · v2 (pending_review) · v3 (ACTIVE)
nasadem_pc ───────────┘   (comparison only, see the provenance gap below)
google_open_buildings_v3 ─┐
ms_global_ml_buildings ───┼─► buildings_comparison/v1 ─┐
backend/data/osm/osm_index.db (repo) ┘                 │
opencity_pune ─► 24 pmc_*/pmpml_*/pune_libraries/water_bodies… geojsons ─┴─► infra_index/v1
             └─► pmc_sewage_pipelines ─► pmc_sewage_pipelines_fgb/v1
             └─► pmc_tree_census_2019 ─► pmc_tree_census_2019_index/v1
             └─► census2011_pune_wards
opencity_pune (7 AQ CSVs) + cpcb_caaqms_station_list ─► cpcb_caaqms_pune
imd_gridded_rainfall_025 ─► imd_rainfall_025_pune
nwdp_india_wris ─► nwdp_groundwater_pune, imd_district_rainfall_pune
chirps_v2_climateserv ─► rainfall_chirps_boxavg/v1
esa_worldcover_2021_v200 + datameet_municipal_wards ─► landcover_worldcover2021/v1
sentinel2_l2a_earthsearch ─► sentinel2_indices/v1
soilgrids_250m_v2 ─► soil_soilgrids250/v1
jrc_gsw ─► surface_water_jrc_gsw/v1
(no derived product) bhuvan_ogc_capabilities, bhuvan_wms_samples, nwdp_meta, pmc_autodcr_geoserver_probe, pmc_opendata_portal_catalogue
```

**Provenance gaps found:**
1. `elevation_copdem30` v1–v3 have NASADEM in their outputs (`diff_cop_minus_nasadem_epsg32643.tif`, `nasadem_comparison` in validation). `elevation.py process()` reads `raw/nasadem_pc`. But `processing.json` `inputs` list only the two Copernicus tiles, so NASADEM is an **unlisted input**.
2. `buildings_comparison/v1` takes `osm_index.db` from the repo, outside urbanos-data. This is already reported by `provenance_check` as "1 unregistered input" (retention audit §11.4).
3. The OpenCity manifest names a `catalogue_snapshot: opencity_pune_catalogue.json` that is not in the raw dir. A file of that name exists in the repo at `backend/datasets/pipelines/opencity_pune_catalogue.json`.

### 4.2 Registry status (verified against the DB)
| Count | Value |
|---|---|
| `ds_datasets` | 101 |
| `ds_dataset_versions` | 83: **active 76 · pending_review 1 · superseded 6** (matches the known context) |
| `data_class` across all 83 versions | observed 46 · derived 21 · estimated 9 · inferred 6 · synthetic 1 |
| `ds_files` | 438: raw 239 · derived 123 · manifest 66 · **withdrawn 10** |

- **pending_review (1):** `elevation_copdem30` v2.
- **superseded (6):**
  - `elevation_copdem30` v1 (by v3, 2026-11-14, per DEM_V1_V3_COMPARISON).
  - Four duplicate re-registrations kept with the old class, now superseded by "inferred" rows: `esa_worldcover_2021_v200`, `google_open_buildings_v3`, `ms_global_ml_buildings`, `landcover_worldcover2021/v1`.
  - `pmc_tree_census_2019_index/v1`: duplicate row from a re-run. This is the **accepted provenance exception**. The superseded row records a 1,253 B `processing.json` (sha `fff04376…`) that the 23:40 IST re-run overwrote in place. The SQLite output is byte-identical. Scans report it as 1 expected mismatch.
- **withdrawn:** the 10 `bhuvan_wms_samples` PNG file rows (paths, hashes and URLs kept; the images were deleted for ToS). The dataset/version row itself is still `active` (see the discrepancies below).

### 4.3 On disk but not used by app code
Not read at runtime by any router, feature or UI. Some are only pipeline inputs.

| Category | Datasets |
|---|---|
| Raw (pipeline input only) | chirps_v2_climateserv, esa_worldcover_2021_v200, google_open_buildings_v3, ms_global_ml_buildings, imd_gridded_rainfall_025, jrc_gsw, nasadem_pc, nwdp_india_wris, opencity_pune, sentinel2_l2a_earthsearch, soilgrids_250m_v2, datameet_municipal_wards, cpcb_caaqms_station_list |
| Raw read only for metadata | `copernicus_dem_glo30` (`terrain/dem.py` reads `spec_accuracy` from its manifest); `nwdp_meta` (baseline for `datasets.update_monitor`). Most raw ids are also update-monitor targets in `datasets/update_targets.json` |
| Raw, no consumer at all (reference / evidence only) | bhuvan_ogc_capabilities, bhuvan_wms_samples (manifest only), pmc_autodcr_geoserver_probe, pmc_opendata_portal_catalogue |
| Derived, unused | `elevation_copdem30/v1` (superseded) and `/v2` (pending); in `sentinel2_indices/v1`, the 4 NDWI and NDBI rasters are not referenced by `envdata/catalogue.py` and the `builtup_change` raster is a rejected layer. NDVI and MNDWI, both 2025 and the 2019 comparison, are used |
| Derived, used only indirectly | `buildings_comparison`, all `pmc_*`/`pmpml_*`/`pune_libraries`/`water_bodies…` geojsons (served through `infra_index`); `pmc_tree_census_2019` (served through its index); `pmc_sewage_pipelines` (through `infra_index` and the `_fgb` copy) |

### 4.4 Registry datasets with no files
- **25 with no version at all:** 12 `env:*` placeholders (air_quality, dem, drainage_network, flood_lines, geology, groundwater_levels, land_cover, land_surface_temperature, noise, seismic_zone, soil, tree_census); 12 `gap_*` placeholders for missing data (admin_wards, asi_protected_limits, boreholes, dp_road_lines, metro_structures, pmc_heritage_list, population_census, rainfall_idf, traffic_speeds, travel_demand, utilities, vehicle_fleet); and `pmc_portal_traffic_details`.
- **8 with a version but 0 file rows:**
  - Code constants or streamed: `arai_2007_emission_factors`, `hbefa4_sumo_coefficients`, `cesium_ion_imagery`, `cesium_world_terrain`.
  - Rows inside the app DB: `twincity_base_osm_objects`, `twincity_demo_seed`.
  - Coordination imports made from infra_index: `subsurface:ssd_ref_sewer_76196666cf5e`, `subsurface:ssd_ref_storm_drains_a8a0a6f90806`.
- **`bhuvan_wms_samples`:** active, but its only data files are withdrawn.

### 4.5 Registered datasets outside the two archives (repo `backend/data/`, all present on disk)
| Dataset | File | Class | Licence |
|---|---|---|---|
| `osm_geofabrik_western_zone` | `backend/data/osm/western-zone-latest.osm.pbf` (221.9 MB) | observed | ODbL 1.0 |
| `osm_local_index` | `backend/data/osm/osm_index.db` (174.7 MB) | derived | ODbL 1.0 |
| `osm_feasibility_layers` | `backend/data/osm/feasibility_layers.db` (7.9 MB) | derived | ODbL 1.0 |
| `observed_counts_pune_west_2026` | `data/observed_counts/pune_west_2026.json` | observed | UNKNOWN (NICMAR chapter) |
| `cmp2008_river_screenline` | `data/observed_screenlines/pune_cmp2008_river.json` | observed | UNKNOWN |
| `pune_network_validation_v1` | `data/observed_validation/…_v1.json` | observed | compilation; each source's own terms |
| `mendeley_pune_2023_counts` | `data/diurnal/mendeley_pune_2023_hourly.json` | observed | CC BY 4.0 |
| `pune_hourly_profile_v1` | `data/diurnal/pune_hourly_profile_v1.json` | derived | compilation |
| `network_corrections_pune_west_v1` | `data/network_corrections/pune_west_v1.json` | inferred | compilation |

These are used by Design (feasibility screening, OSM import), Explore (city model), Simulate (traffic simulation, validation) and Underground (metro clearance), according to `ds_feature_dependencies`.

---

### 4.6 Official project facts (new, 2026-11-21)
| Dataset | Where | Written by | Class / rule | Used by |
|---|---|---|---|---|
| `pune_infra_project_facts` (source id `updater_published_facts`) | `<URBANOS_DATA_DIR>/derived/pune_infra_project_facts/<label>/facts.json` + `provenance.json` (immutable; one folder per applied version) | `python -m updater seed-baseline` (first version, from `docs/urbanos/pune_project_facts.json` v2: 22 projects, 108 records, all official) and `python -m updater apply` (each reviewed change) — `backend/updater/facts.py` | Official sources only (`backend/updater/official.py`: `*.gov.in`, `*.nic.in`, punemetrorail.org, mahametro.org, sansad.in, msrdc.in); each fact carries its quote, URL and date; screening context only, never a surveyed level | `GET /api/updater/facts` → Underground hover tooltip (official tunnel depth for a matched OSM metro line, `frontend/src/engine/underground/reportedFacts.ts`); review queue in Reports → Data catalogue → Fact updates |

Not present in the sandbox data folder on 2026-11-22 (no `seed-baseline` has been run against it); it appears after the first `seed-baseline` or `migrate-official-only`.

---

## 5. Licence and restriction flags: keep internal

The verdicts follow `DATA_RETENTION_AUDIT.md` §9 and the manifests. **HIGH** means do not ship the raw files or their derivatives in any public or commercial bundle, including the export zips, without written clearance.

| Risk | Data | Why |
|---|---|---|
| **HIGH: internal only** | `raw/opencity_pune` and **everything derived from it**: all `pmc_*`, `pmpml_*`, `pune_libraries`, `census2011_pune_wards`, `water_bodies_census_pune_2023`, `pmc_tree_census_2019*`, `cpcb_caaqms_pune` (AQ CSVs come via OpenCity), and the municipal layers inside `infra_index/v1` | The licence statements conflict: CKAN says "Public Domain", the FAQ says ODbL, the site T&C says non-commercial, and the water-bodies KML is "CC Non-Commercial". `infra_index` itself records "treated NON-COMMERCIAL with attribution". The UI flags these with a warning tone |
| **HIGH: internal only** | `raw/pmc_autodcr_geoserver_probe` (including 4 WMS PNG renders, among them Red_Blue flood lines) and `raw/pmc_opendata_portal_catalogue` | No licence; PMC SmartGIS terms are personal / non-commercial with no derivatives. Bulk download pending PMC permission. Portal downloads are CAPTCHA-gated and were not bypassed |
| **HIGH: internal only** | `raw/bhuvan_ogc_capabilities` (and the manifest of the deleted `bhuvan_wms_samples`) | The Bhuvan ToS forbid copying without NRSC authorisation. The PNGs are already deleted |
| **HIGH until verified** | `raw/imd_gridded_rainfall_025`, `derived/imd_rainfall_025_pune`, `derived/imd_district_rainfall_pune` | No IMD licence recorded (only a citation request) |
| MEDIUM–HIGH | `raw/nwdp_india_wris`, `raw/nwdp_meta`, `derived/nwdp_groundwater_pune`, `raw/cpcb_caaqms_station_list` | Registry: UNKNOWN (CKAN "Other (Open)" for groundwater only) |
| MEDIUM | `raw/nasadem_pc` (and the Cop−NASADEM diff raster in elevation v1–v3) | Unresolved: Planetary Computer says "proprietary", LP DAAC says no restrictions |
| MEDIUM (share-alike) | `raw/datameet_municipal_wards`, `landcover_worldcover2021` zone areas; OSM content in `buildings_comparison`, `infra_index`, `backend/data/osm/*`, `twincity.db` | CC BY-SA 2.5 IN and ODbL: any public derivative must carry the same licence |
| LOW (attribution) | Copernicus DEM (exact attribution text required), Sentinel-2, JRC GSW, ESA WorldCover, SoilGrids, Google Open Buildings, Microsoft buildings (CDLA-P 2.0), CHIRPS (CC0; ClimateSERV API terms unknown) | Redistributable with notices |
| n/a | Cesium ion imagery and terrain | Streaming only; never cache or export |

**Note on the archives:** `urbanos-data-raw.zip` and `urbanos-data-derived.zip` contain HIGH-risk material (OpenCity, AutoDCR, Bhuvan capabilities, IMD). Both zips must stay internal.

---

## 6. Deletion manifest explained (Phase A, executed 2026-11-14)

Source: `deletion_manifest.tsv` (120 rows) and `DATA_RETENTION_AUDIT.md` §10–§11.

**Re-check today:** none of the 120 paths exists any more (0 present / 120 absent). Step totals in the TSV match §11.3 exactly: 6,562 files, 4,308,313,242 B ≈ 4.01 GiB, 0 errors. **No raw source, active derived version, or registry file was deleted.**

| Step | What | Rows | Files | Bytes | Why it was safe |
|---|---|---:|---:|---:|---|
| **A1** | OpenCity browser staging copies in `/workspace/web/downloads/` (`<uuid>-<hash>.csv/kml/kmz`, including 2 "(1)" re-downloads) | 98 | 98 | 1,513,687,252 | Each was sha256-identical to a kept file in `raw/opencity_pune/2026-11-13/`. Re-hashed before deletion |
| **A2** | `web/downloads/pune_mendeley/traffic/`: unzipped copy of `traffic.zip` | 1 | 115 | 1,812,118,340 | All 115 members byte-identical to the zip, which is **kept** (sha `648e9c33…` is in the registry). The app uses `backend/data/diurnal/mendeley_pune_2023_hourly.json` |
| **A3** | `pune_refs/pdfcoffee.html`, `pune_refs/iisc14.pdf` | 2 | 2 | 5,609 | Failed downloads: HTML error / Cloudflare pages, not the documents |
| **A4** | Git worktrees `uos-wt-qa2`, `uos-wt-qa3` | 2 | 1,505 | 23,365,932 | Clean, and every commit patch-equivalent in `urbanos-city-planning-redesign`. The `node_modules` symlink was unlinked first, so the main checkout was untouched |
| **A5** | 17 harness/scratch dirs in `/workspace/work`. Largest: `vp-junc3` (384 MB), `vp-wt-final-e2e`, `vp-shiv-e2e`, `vp-conn`, `vp-wt-scope-e2e`, `vp-wt-recompute-e2e`, `uos-terrain-e2e`, `coep2-scratch` | 17 | 4,842 | 959,136,109 | Not referenced by tracked code, docs, the registry, or the raw/derived data. No running process held them open |

**What was retained:**
- **8 doc-cited harness dirs**, pulled out of Phase A after a reference scan. Together they would have freed ≈619.6 MB, which is the gap between the planned 4,927,925,382 B and the executed 4,308,313,242 B. They are `uos-qa`, `urbanos/tools-e2e`, `vp-sev-e2e`, `vp-sev2-e2e`, `vp-shots`, `vp-wt-day-e2e`, `vp-wt-merged-e2e` and `vp-wt-verify-e2e`. They are cited in URBANOS_VERIFICATION, DESIGN_TOOLS_AND_HONESTY, OVERHAUL and ROAD_ANALYSIS. All 8 are still on disk.
- **Phase B was not executed** (≈4.3 GiB with preconditions). This covers DB snapshots such as `twincity.before-road-analysis.db`, `twincity.db.bak-2026-11-13` and `qac/`, the doc-cited `um-*`/`uos-*`/`vp-*` runs, and `derived/elevation_copdem30/v2`. The v2 deletion waits on its registry row being marked superseded or withdrawn; today it is still `pending_review`.
- **Always kept:**
  - All of `urbanos-data/raw` and all active derived versions, plus elevation v1 (superseded but kept) and v2.
  - `backend/data/**` and `backend/twincity.db`.
  - The DB backups `twincity.db.bak-2026-11-13`, `…-pre-blockers` and `…-pre-dem-v3`, and `uos-dem-compare/`.
  - The OpenCity CKAN catalogue PDFs, the Mendeley zip and docs, and the reference PDFs.

---

## 7. Discrepancies and open items found in this audit

1. **Matches the known context:**
   - DEM v3 active, v2 pending_review, v1 superseded.
   - 10 Bhuvan PNG rows withdrawn.
   - One accepted provenance exception (superseded tree-index `processing.json`).
   - Registry counts 76 / 1 / 6.
   - The 8 retained harness dirs.
   - Phase B not run.
2. **Bhuvan dataset still `active`.** The `bhuvan_wms_samples` version row is `active` with `data_class=derived` and `size_bytes=4,823,360`, but only its manifest exists. Its class is also odd for third-party renders. *Suggest* marking the version withdrawn or reclassifying it.
3. **NASADEM is an unlisted input** to every elevation version (§4.1). `provenance_check` does not catch it.
4. **The registry carries little metadata for most UrbanOS versions:**
   - `crs` is NULL on raw rows except soilgrids.
   - `observation_start/end` is NULL except census 2011.
   - `coverage_bbox_json` is set only on 6 derived versions.
   - Every raw source except the ones with a verified licence shows `licence_text = UNKNOWN` in `ds_sources`.
   The real values are in the manifests and `processing.json`.
5. **No literal commands in `processing.json`.** Re-runs depend on module docstrings plus recorded parameters and commit hashes.
6. **47 OpenCity raw files are unused** (§2), and none of the four OGC-probe sources has a consumer. Both are expected for reference material.
7. `pmc_swd_utility_chambers` has 2,481 duplicate geometries out of 4,233. They are published as-is and not yet deduplicated.
