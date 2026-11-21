/**
 * Planner-facing model of the Environment workspace (docs/urbanos/ENVIRONMENT_WORKSPACE.md, ENVIRONMENT_AUDIT.md).
 * Pure (no Cesium, no DOM), unit-tested in src/engine/testing/EnvPlannerModel.test.ts:
 * - how each layer is known (Measured / Modelled / Inferred) and why,
 * - a plain title and a one-line "what it shows" per layer,
 * - a short source · date · licence line (the full text stays under the row's details),
 * - the "not available yet" list (noise, heat, exposure … with what would be needed),
 * - deterministic proposal indicators (trees and green area in a footprint) and their CSV,
 * - relative emissions change from a before/after comparison (model-based, never absolute totals here),
 * - CSV text and chart readouts for the air-quality and rainfall records.
 */
import type { DataClass, EnvDataLayer, LandcoverAreas } from '../../lib/envDataApi';
import type { EnvironmentLayer } from '../../lib/coordinationApi';
import { redactPaths } from '../../lib/redactPaths';

// ── how a layer is known ───────────────────────────────────────────────────────
export type Evidence = 'measured' | 'modelled' | 'inferred';
export const EVIDENCE_LABEL: Record<Evidence, string> = { measured: 'Measured', modelled: 'Modelled', inferred: 'Inferred' };
export const EVIDENCE_HELP: Record<Evidence, string> = {
  measured: 'Observed by a sensor, a survey or a mapper at a place and time. Can still be old, incomplete or have gaps.',
  modelled: 'Computed by a model or an interpolation from other data (terrain routing, gridded rainfall, a traffic model). As good as its inputs and method.',
  inferred: 'Classified or predicted by a statistical / machine-learning model from imagery or samples. Plausible, not checked on the ground here.',
};

const EVIDENCE_BY_ID: Record<string, { kind: Evidence; why: string }> = {
  air_cpcb_caaqms: { kind: 'measured', why: 'continuous monitoring stations (CPCB / MPCB / IITM), 15-min values as published' },
  tree_census_2019: { kind: 'measured', why: 'PMC field census of individual trees, 2019' },
  rain_nwdp_district: { kind: 'measured', why: 'IMD district daily totals from rain gauges' },
  s2_ndvi: { kind: 'measured', why: 'index computed pixel by pixel from one Sentinel-2 scene (surface reflectance)' },
  s2_mndwi: { kind: 'measured', why: 'index computed pixel by pixel from one Sentinel-2 scene (surface reflectance)' },
  rain_imd_025: { kind: 'modelled', why: 'IMD gauge readings interpolated onto a 0.25° (~27 km) grid' },
  rain_chirps: { kind: 'modelled', why: 'satellite estimate blended with gauges (CHIRPS), averaged over the study box' },
  dem_streams: { kind: 'modelled', why: 'water routed downhill (D8) over a 30 m surface model that includes buildings and trees; not mapped drains' },
  dem_catchments: { kind: 'modelled', why: 'drainage areas computed (D8) from a 30 m surface model' },
  slope: { kind: 'modelled', why: 'computed from a 30 m surface model (DSM): building and tree edges show as steep' },
  landcover_worldcover2021: { kind: 'inferred', why: 'machine-learning classification of 2021 Sentinel-1/2 imagery (ESA WorldCover)' },
  jrc_gsw_occurrence: { kind: 'inferred', why: 'water / not-water classification of every Landsat image 1984–2024 (JRC)' },
  soil_soilgrids: { kind: 'inferred', why: 'machine-learning prediction at 250 m from soil samples and covariates (SoilGrids)' },
  osm_water: { kind: 'measured', why: 'mapped by OpenStreetMap volunteers; completeness unknown' },
  osm_heritage: { kind: 'measured', why: 'mapped by OpenStreetMap volunteers; not the ASI / PMC heritage lists' },
  osm_railway: { kind: 'measured', why: 'mapped by OpenStreetMap volunteers' },
  osm_metro: { kind: 'measured', why: 'mapped by OpenStreetMap volunteers; depths and deck levels not mapped' },
  osm_trees: { kind: 'measured', why: 'mapped by OpenStreetMap volunteers; sparse in Pune' },
};
const EVIDENCE_BY_CLASS: Record<DataClass, Evidence> = { observed: 'measured', derived: 'modelled', estimated: 'modelled', inferred: 'inferred', synthetic: 'modelled' };

export function evidenceOf(id: string, dataClass?: DataClass | null): { kind: Evidence; label: string; why: string } {
  const e = EVIDENCE_BY_ID[id];
  const kind = e?.kind ?? (dataClass ? EVIDENCE_BY_CLASS[dataClass] : 'measured');
  return { kind, label: EVIDENCE_LABEL[kind], why: e?.why ?? (dataClass ? `catalogue class: ${dataClass}` : 'how it was made is not recorded') };
}

// ── plain titles ───────────────────────────────────────────────────────────────
export const PLAIN: Record<string, { title: string; what: string }> = {
  landcover_worldcover2021: { title: 'Land cover (2021)', what: 'What covers the ground in 10 m squares: trees, built-up, grass, crops, water. Not land use or zoning.' },
  s2_ndvi: { title: 'Greenness (NDVI)', what: 'How green the vegetation was on one satellite date. Higher = denser, healthier plants.' },
  tree_census_2019: { title: 'Trees (PMC census 2019)', what: 'Individual trees counted by PMC in 2019, with species and girth. Zoom in to see single trees.' },
  osm_trees: { title: 'Trees (OpenStreetMap)', what: 'Trees mapped by volunteers. Sparse in Pune; the PMC census is far more complete.' },
  jrc_gsw_occurrence: { title: 'Surface water history', what: 'How often each spot was seen as water in satellite images, 1984–2024.' },
  s2_mndwi: { title: 'Water index (MNDWI)', what: 'Open water on one satellite date. Higher = more likely water.' },
  osm_water: { title: 'Rivers, nallas & lakes (OSM)', what: 'Water bodies and waterways mapped by volunteers.' },
  dem_streams: { title: 'Flow paths (computed)', what: 'Where rain would run downhill, computed from a terrain model. Not a map of drains or nallas.' },
  dem_catchments: { title: 'Catchments (computed)', what: 'Areas that drain to the same exit of the study box, computed from a terrain model.' },
  soil_soilgrids: { title: 'Soil properties (0–30 cm)', what: 'Predicted topsoil clay, sand, silt, carbon, density and water capacity at 250 m. Not a borehole.' },
  slope: { title: 'Slope', what: 'Steepness of the ground surface from a 30 m model. Buildings and trees show as steep edges.' },
  air_cpcb_caaqms: { title: 'Air-quality stations', what: 'Where the continuous monitors are. Pick one under "Records" to see its readings.' },
  osm_heritage: { title: 'Heritage places (OSM)', what: 'Historic places mapped by volunteers. The official ASI / PMC lists are not included.' },
  osm_railway: { title: 'Railways (OSM)', what: 'Railway lines mapped by volunteers (not metro).' },
  osm_metro: { title: 'Metro lines & stations', what: 'Metro alignments in the city model (from OpenStreetMap).' },
  rain_imd_025: { title: 'Rainfall, IMD grid', what: 'Daily rainfall on a ~27 km grid, 2000–2025. Shown as charts under "Records".' },
  rain_chirps: { title: 'Rainfall, CHIRPS', what: 'Satellite-gauge rainfall averaged over the study box, 1986–2025. Chart under "Records".' },
  rain_nwdp_district: { title: 'Rainfall, Pune district', what: 'IMD district daily totals as published. Listed under "Records".' },
};
/** What one legend entry stands for, where a categorical legend has no numeric unit. */
export const LEGEND_UNITS: Record<string, string> = {
  landcover_worldcover2021: 'Classes, 10 m squares (no unit)', tree_census_2019: '1 dot = 1 tree; cluster size grows with the tree count',
  dem_streams: 'Lines = computed flow paths with ≥ 1 km² draining into them', dem_catchments: 'Areas draining to one exit; km² inside the study box',
  air_cpcb_caaqms: 'Dots = monitor locations (no values on the map)',
};

export const plainTitle = (id: string, fallback: string) => PLAIN[id]?.title ?? fallback;

// ── short meta line ────────────────────────────────────────────────────────────
const SHORT_LICENCE: Record<string, string> = {
  landcover_worldcover2021: 'CC BY 4.0', soil_soilgrids: 'CC BY 4.0',
  s2_ndvi: 'Copernicus open data', s2_mndwi: 'Copernicus open data', jrc_gsw_occurrence: 'Copernicus open data',
  dem_streams: 'Copernicus DEM licence', dem_catchments: 'Copernicus DEM licence', slope: 'Copernicus DEM licence',
  tree_census_2019: 'Public domain (OpenCity) · internal use', air_cpcb_caaqms: 'Public domain (OpenCity) · internal use',
  rain_chirps: 'Public domain (CC0)', rain_imd_025: 'Licence UNKNOWN', rain_nwdp_district: 'Licence UNKNOWN',
};
const SHORT_SOURCE: Record<string, string> = {
  landcover_worldcover2021: 'ESA WorldCover', s2_ndvi: 'Sentinel-2 (ESA)', s2_mndwi: 'Sentinel-2 (ESA)', jrc_gsw_occurrence: 'EC JRC',
  dem_streams: 'Copernicus DEM, computed by UrbanOS', dem_catchments: 'Copernicus DEM, computed by UrbanOS', slope: 'Copernicus DEM, computed by UrbanOS',
  soil_soilgrids: 'ISRIC SoilGrids', tree_census_2019: 'PMC via OpenCity', air_cpcb_caaqms: 'CPCB / MPCB / IITM via OpenCity',
  rain_imd_025: 'IMD Pune', rain_chirps: 'CHC, UC Santa Barbara', rain_nwdp_district: 'IMD via NWDP',
};

/** "2011–2015 (TanDEM-X acquisitions)" → "2011–2015"; "UNKNOWN (…)" → "date UNKNOWN"; ISO stamps → the date part. */
export function shortDataDate(s: string | null | undefined): string {
  if (!s || /^unknown/i.test(s.trim())) return 'date UNKNOWN';
  const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
  if (iso) return iso[1];
  const word = /\b(\d{4}-\d{2}-\d{2})\b.*\b(?:AM|PM)\b/.exec(s);
  if (word) return word[1];
  return s.split(' (')[0].trim() || 'date UNKNOWN';
}

/** Licence short form: known ids, else the text before the first ';' / '(' (≤ 40 chars). */
export function shortLicence(id: string, licence: string | null | undefined): string {
  if (SHORT_LICENCE[id]) return SHORT_LICENCE[id];
  const t = (licence ?? '').trim();
  if (!t || /^unknown/i.test(t)) return 'Licence UNKNOWN';
  if (/odbl/i.test(t)) return 'ODbL 1.0';
  const s = t.split(/[;(]/)[0].trim();
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** "OpenStreetMap via local file (feasibility:water); status computed on read" → "OpenStreetMap" (no internal wording). */
export function shortSource(id: string, source: string | null | undefined, publisher?: string | null): string {
  if (SHORT_SOURCE[id]) return SHORT_SOURCE[id];
  const t = redactPaths((publisher || source || '').trim()) ?? '';
  if (/openstreetmap/i.test(t)) return 'OpenStreetMap';
  return t.split(/[;(]/)[0].trim() || 'source UNKNOWN';
}

export interface MetaLine { evidence: Evidence; evidenceLabel: string; why: string; source: string; date: string; licence: string }
export function metaOfEnv(l: Pick<EnvDataLayer, 'id' | 'data_class' | 'source' | 'publisher' | 'data_date' | 'licence'>, variantDate?: string | null): MetaLine {
  const e = evidenceOf(l.id, l.data_class);
  return { evidence: e.kind, evidenceLabel: e.label, why: e.why, source: shortSource(l.id, l.source, l.publisher), date: shortDataDate(variantDate ?? l.data_date), licence: shortLicence(l.id, l.licence) };
}
export function metaOfCoord(l: Pick<EnvironmentLayer, 'id' | 'source' | 'data_date' | 'licence'>): MetaLine {
  const e = evidenceOf(l.id, null);
  return { evidence: e.kind, evidenceLabel: e.label, why: e.why, source: shortSource(l.id, l.source), date: shortDataDate(l.data_date), licence: shortLicence(l.id, l.licence) };
}

// ── what is not available ──────────────────────────────────────────────────────
export interface Unavailable { id: string; title: string; why: string; needs: string; status: 'not imported' | 'blocked' | 'rejected' | 'not on disk' }
/** Indicators the registry lists as not wired (wired=0) and no catalogue carries: listed so their absence is explicit. */
export const NOT_WIRED: Unavailable[] = [
  { id: 'exposure', title: 'Population exposure', status: 'not imported', why: 'No ward-level population is loaded, and there is no noise or air-dispersion model to expose people to.',
    needs: 'Census 2011 ward population (or a newer count) and a validated noise / air model.' },
];
const NEEDS: Record<string, string> = {
  noise: 'MPCB / CPCB noise monitoring data, or a noise model with traffic counts.',
  land_surface_temperature: 'Landsat / ECOSTRESS land-surface temperature scenes, processed for Pune.',
  geology: 'GSI Bhukosh geology (account needed).',
  seismic_zone: 'IS 1893 zone map (Pune is listed in zone III).',
  groundwater_levels: 'CGWB / GSDA well levels.',
  drainage_network: 'PMC storm-water network with sizes and invert levels.',
  flood_lines_pmc: 'PMC permission for the AutoDCR red / blue flood lines.',
  flood_model: 'Statutory flood lines, a bare-earth terrain model, drain inverts and design rainfall (IDF).',
};

export function unavailableOf(coord: EnvironmentLayer[], env: EnvDataLayer[]): Unavailable[] {
  const covered = new Set(env.flatMap(l => l.covers));
  const out: Unavailable[] = [];
  for (const l of coord) {
    if (l.status === 'available' || covered.has(l.id)) continue;
    out.push({ id: l.id, title: l.name, status: 'not imported', why: redactPaths(l.limitations?.replace(/^Not imported — UNKNOWN\.?\s*/, '') || 'Not imported; UNKNOWN.') ?? '', needs: NEEDS[l.id] ?? 'A source is listed under its details.' });
  }
  for (const l of env) {
    if (l.status === 'available') continue;
    out.push({ id: l.id, title: l.name, status: l.status === 'missing' ? 'not on disk' : l.status, why: redactPaths(l.status_reason) ?? '', needs: NEEDS[l.id] ?? (l.status === 'missing' ? 'Run its pipeline on this server.' : '') });
  }
  for (const n of NOT_WIRED) if (!out.some(o => o.id === n.id)) out.push(n);
  return out;
}

// ── planner groups ─────────────────────────────────────────────────────────────
export type PlannerGroupId = 'green' | 'water' | 'ground' | 'air' | 'protected';
export const PLANNER_GROUPS: { id: PlannerGroupId; label: string; question: string; ids: string[] }[] = [
  { id: 'green', label: 'Green cover & trees', question: 'What grows here?', ids: ['landcover_worldcover2021', 'tree_census_2019', 's2_ndvi', 'osm_trees'] },
  { id: 'water', label: 'Water & drainage', question: 'Where is water, and where would rain run?', ids: ['osm_water', 'dem_streams', 'jrc_gsw_occurrence', 's2_mndwi', 'dem_catchments'] },
  { id: 'ground', label: 'Ground', question: 'How steep, what soil?', ids: ['slope', 'soil_soilgrids'] },
  { id: 'air', label: 'Air', question: 'Where is air measured?', ids: ['air_cpcb_caaqms'] },
  { id: 'protected', label: 'Heritage & rail', question: 'What must a proposal respect?', ids: ['osm_heritage', 'osm_railway', 'osm_metro'] },
];
/** The layers "Show the essentials" turns on: one per question a first look needs (fast, readable together). */
export const ESSENTIALS = ['landcover_worldcover2021', 'tree_census_2019', 'dem_streams', 'air_cpcb_caaqms'] as const;

// ── proposal indicators (deterministic) ────────────────────────────────────────
/** WorldCover classes counted as green (vegetated) area. */
export const GREEN_CLASSES: Record<number, string> = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 90: 'Herbaceous wetland' };
export const IMPACT_BUFFER_M = 10;

export interface ImpactArea { trees: number | null; rare: number | null; treeError?: string; greenM2: number | null; treeCoverM2: number | null; areaM2: number | null; lcError?: string; outside?: boolean }
export interface ImpactResult { name: string; type: string; lengthM: number; widthM: number; footprint: ImpactArea; buffer: ImpactArea }

export function greenOf(a: LandcoverAreas | null): { greenM2: number | null; treeCoverM2: number | null; areaM2: number | null; outside: boolean } {
  if (!a) return { greenM2: null, treeCoverM2: null, areaM2: null, outside: false };
  if (a.classes.length === 0) return { greenM2: null, treeCoverM2: null, areaM2: null, outside: true };   // UNKNOWN, not zero
  const km2 = (v: number) => a.classes.filter(c => c.value === v).reduce((s, c) => s + c.km2, 0);
  const green = Object.keys(GREEN_CLASSES).reduce((s, k) => s + km2(+k), 0);
  return { greenM2: green * 1e6, treeCoverM2: km2(10) * 1e6, areaM2: a.classes.reduce((s, c) => s + c.km2, 0) * 1e6, outside: false };
}

/** Polyline length in metres (haversine). */
export function lineLengthM(coords: number[][]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const p1 = a[1] * Math.PI / 180, p2 = b[1] * Math.PI / 180, dp = p2 - p1, dl = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    s += 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }
  return s;
}

export const fmtArea = (m2: number | null): string => m2 == null ? 'UNKNOWN'
  : m2 >= 1e5 ? `${(m2 / 1e4).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha` : `${Math.round(m2).toLocaleString()} m²`;

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

export function impactCsv(r: ImpactResult, at: string): string {
  const v = (x: number | null) => (x == null ? 'UNKNOWN' : Math.round(x));
  return toCsv([
    ['UrbanOS environmental screening indicators — screening only, not an environmental impact assessment'],
    ['proposal', r.name], ['type', r.type], ['length_m', Math.round(r.lengthM)], ['width_m', r.widthM], ['computed_at', at],
    [],
    ['indicator', 'footprint (centreline ± width/2)', `footprint + ${IMPACT_BUFFER_M} m each side`, 'unit', 'source', 'evidence'],
    ['census trees', v(r.footprint.trees), v(r.buffer.trees), 'trees', 'PMC Tree Census 2019 (via OpenCity)', 'Measured (2019; felled/planted since not reflected)'],
    ['rare census trees', v(r.footprint.rare), v(r.buffer.rare), 'trees', 'PMC Tree Census 2019 is_rare flag', 'Measured (2019)'],
    ['green area (tree, shrub, grass, crop, wetland)', v(r.footprint.greenM2), v(r.buffer.greenM2), 'm²', 'ESA WorldCover 2021, 10 m', 'Inferred (ML classification)'],
    ['tree cover', v(r.footprint.treeCoverM2), v(r.buffer.treeCoverM2), 'm²', 'ESA WorldCover 2021, 10 m', 'Inferred (ML classification)'],
    ['area counted', v(r.footprint.areaM2), v(r.buffer.areaM2), 'm²', 'pixel centres in the polygon × 100 m²', ''],
    [],
    ['A Trees Act survey and a site visit are still required. Footprint is approximate (centreline ± width/2).'],
  ]);
}

// ── emissions: relative change only ────────────────────────────────────────────
export interface EmissionDelta { label: string; change: number | null; agreement?: { same: number; of: number } }
/** Percent change rows from a before/after comparison; absolute totals are never returned (they live in Simulate). */
export function relativeEmissions(deltas: { label: string; change: number | null; agreement?: { same: number; of: number } }[] | undefined | null): EmissionDelta[] {
  return (deltas ?? []).filter(d => !/idling/i.test(d.label)).map(d => ({ label: d.label, change: d.change, agreement: d.agreement }));
}
export const fmtPct = (c: number | null) => c == null ? 'UNKNOWN' : `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c * 100).toFixed(1)} %`;

// ── records: CSV and chart readout ─────────────────────────────────────────────
/** India NAAQS 2009 24-hour limits (µg/m³; CO is 1-hour/8-hour only, so none here), for reading a daily chart. Not a compliance check. */
export const NAAQS_24H: Record<string, number> = { pm25_ugm3: 60, pm10_ugm3: 100, no2_ugm3: 80, so2_ugm3: 80 };

export function airCsv(s: { station_id: string; label: string; unit: string; agg: string; points: { t: string; v: number; n: number }[] }, stationName: string): string {
  return toCsv([
    ['station', stationName], ['station_id', s.station_id], ['parameter', s.label], ['unit', s.unit], ['aggregation', `${s.agg} mean of published 15-min values`],
    ['source', 'CPCB CCR via OpenCity (CPCB / MPCB / IITM); measured; no gap filling'],
    [],
    ['time', `${s.label} (${s.unit})`, 'samples_in_bucket'],
    ...s.points.map(p => [p.t, p.v, p.n]),
  ]);
}

export function rainCsv(cell: { cell_lon: number; cell_lat: number; annual: { year: number; mm: number; qa_flag: string | null }[] }): string {
  return toCsv([
    ['IMD 0.25° gridded rainfall, cell', `${cell.cell_lon.toFixed(2)}E ${cell.cell_lat.toFixed(2)}N`],
    ['source', 'IMD Pune gridded daily (Pai et al. 2014); modelled (gauge interpolation); licence UNKNOWN; descriptive only, not IDF'],
    [],
    ['year', 'annual_total_mm', 'qa_flag_as_stored'],
    ...cell.annual.map(a => [a.year, a.mm, a.qa_flag ?? '']),
  ]);
}

/** Index of the series point under a pointer at fraction `x` (0..1) of the chart width. */
export function readoutIndex(n: number, x: number): number {
  if (n <= 0) return -1;
  return Math.max(0, Math.min(n - 1, Math.round(x * (n - 1))));
}
