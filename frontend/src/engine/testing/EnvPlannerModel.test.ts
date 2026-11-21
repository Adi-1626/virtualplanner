import { describe, expect, it } from 'vitest';
import {
  airCsv, boxHolds, pointDate, requestBox, ESSENTIALS, evidenceOf, fmtArea, fmtPct, greenOf, impactCsv, lineLengthM, metaOfCoord, metaOfEnv, NAAQS_24H, plainReason,
  PLANNER_GROUPS, readoutIndex, relativeEmissions, emissionRowText, ringsOf, shortDataDate, shortLicence, shortSource, toCsv, unavailableOf,
} from '../../components/environment/envPlanner';
import { pickedId, setTip, tipFor, clearTips } from '../../components/environment/envTips';
import { redactPaths } from '../../lib/redactPaths';
import type { EnvDataLayer } from '../../lib/envDataApi';
import type { EnvironmentLayer } from '../../lib/coordinationApi';

const env = (id: string, over: Partial<EnvDataLayer> = {}): EnvDataLayer => ({
  id, group: 'vegetation', name: id, kind: 'raster', status: 'available', status_reason: '', source: 's', publisher: 'p', licence: 'L', licence_url: null,
  attribution: '', data_date: '2021', vintage_note: '', data_class: 'derived', suitability: 'screening', limitations: '', legend: null, variants: [], covers: [],
  bounds: null, processing: null, ...over,
});
const coord = (id: string, status: string, over: Partial<EnvironmentLayer> = {}) =>
  ({ id, name: id, domain: 'noise', status, source: null, data_date: null, licence: null, feature_count: null, limitations: null, recommended_sources: [], ...over }) as unknown as EnvironmentLayer;

describe('evidence: every layer is Measured, Modelled or Inferred', () => {
  it('known layers', () => {
    expect(evidenceOf('air_cpcb_caaqms').kind).toBe('measured');
    expect(evidenceOf('tree_census_2019').kind).toBe('measured');
    expect(evidenceOf('dem_streams').kind).toBe('modelled');
    expect(evidenceOf('rain_imd_025').kind).toBe('modelled');
    expect(evidenceOf('slope').kind).toBe('modelled');
    // ML classifications stay inferred (roadmap: WorldCover stays labelled inferred)
    expect(evidenceOf('landcover_worldcover2021').kind).toBe('inferred');
    expect(evidenceOf('soil_soilgrids').kind).toBe('inferred');
    expect(evidenceOf('jrc_gsw_occurrence').kind).toBe('inferred');
  });
  it('unknown layers fall back on the catalogue class, never blank', () => {
    expect(evidenceOf('x', 'observed').kind).toBe('measured');
    expect(evidenceOf('x', 'estimated').kind).toBe('modelled');
    expect(evidenceOf('x', 'inferred').label).toBe('Inferred');
    expect(evidenceOf('x', null).why).toMatch(/not recorded/);
  });
  it('every layer in a planner group has an evidence class and a plain title', () => {
    for (const g of PLANNER_GROUPS) for (const id of g.ids) expect(['measured', 'modelled', 'inferred']).toContain(evidenceOf(id).kind);
    expect(ESSENTIALS.every(id => PLANNER_GROUPS.some(g => g.ids.includes(id)))).toBe(true);
  });
});

describe('short source · date · licence line', () => {
  it('dates', () => {
    expect(shortDataDate('2011–2015 (TanDEM-X acquisitions)')).toBe('2011–2015');
    expect(shortDataDate('UNKNOWN (SoilGrids 2.0; release date not recorded)')).toBe('date UNKNOWN');
    expect(shortDataDate(null)).toBe('date UNKNOWN');
    expect(shortDataDate('Mon 2026-11-02 2:51 AM IST (UTC+05:30)')).toBe('2026-11-02');
    expect(shortDataDate('2025-11-14T05:30:00Z')).toBe('2025-11-14');
  });
  it('licences and sources carry no internal wording or paths', () => {
    expect(shortLicence('osm_water', 'ODbL 1.0 (OSM)')).toBe('ODbL 1.0');
    expect(shortLicence('x', '')).toBe('Licence UNKNOWN');
    expect(shortLicence('rain_imd_025', 'UNKNOWN — no licence stated')).toBe('Licence UNKNOWN');
    expect(shortSource('osm_water', 'OpenStreetMap via local file (feasibility:water); status computed on read')).toBe('OpenStreetMap');
    expect(shortSource('x', '/workspace/work/urbanos-data/derived/x.tif; more')).not.toMatch(/workspace/);
    const m = metaOfCoord({ id: 'osm_heritage', source: 'OpenStreetMap via local file (feasibility:heritage); status computed on read', data_date: 'Mon 2026-11-02 2:51 AM IST (UTC+05:30)', licence: 'ODbL 1.0 (OSM)' });
    expect(m).toMatchObject({ evidence: 'measured', source: 'OpenStreetMap', date: '2026-11-02', licence: 'ODbL 1.0' });
    expect(metaOfEnv(env('s2_ndvi', { data_date: '2025-11-14 (scene date, UTC)' }), '2019-11-26 (comparison scene)').date).toBe('2019-11-26');
  });
});

describe('not available yet', () => {
  it('lists unimported, blocked and not-wired indicators with plain reasons', () => {
    const u = unavailableOf(
      [coord('noise', 'not_imported', { limitations: 'Not imported — UNKNOWN.' }), coord('land_cover', 'not_imported'), coord('osm_water', 'available'),
        coord('drainage_network', 'not_imported', { limitations: 'Not imported — UNKNOWN. No open PMC network with inverts found (EGR §C).' })],
      [env('landcover_worldcover2021', { covers: ['land_cover'] }), env('flood_lines_pmc', { status: 'blocked', status_reason: 'Restricted. Request route: docs/urbanos/MISSING_DATA_AND_COLLECTION_PLAN.md item 2.' }),
        env('s2_ndvi', { status: 'missing', status_reason: 'Expected file not found in the data folder: s2/ndvi.tif' })]);
    const ids = u.map(x => x.id);
    expect(ids).toEqual(expect.arrayContaining(['noise', 'drainage_network', 'flood_lines_pmc', 's2_ndvi', 'exposure']));
    expect(ids).not.toContain('land_cover');   // covered by the real dataset
    expect(ids).not.toContain('osm_water');
    expect(u.find(x => x.id === 'noise')?.why).toBe('No dataset has been imported yet.');
    expect(u.find(x => x.id === 'drainage_network')?.why).toBe('No open PMC network with inverts found.');
    expect(u.find(x => x.id === 'flood_lines_pmc')?.why).not.toMatch(/docs\/|\.md/);
    expect(u.find(x => x.id === 's2_ndvi')?.status).toBe('not on disk');
    expect(u.find(x => x.id === 'exposure')?.needs).toMatch(/population/i);
  });
  it('plainReason strips paths and doc references', () => {
    expect(plainReason('Expected file not found: /workspace/work/urbanos-data/derived/a/b.tif (run it)')).not.toMatch(/workspace/);
    expect(plainReason(null)).toBe('No dataset has been imported yet.');
  });
});

describe('proposal indicators', () => {
  it('green area sums vegetated WorldCover classes; outside coverage is UNKNOWN, not zero', () => {
    const a = { scope: 'p', area_km2: 0.02, pixels: 200, nodata_pixels: 0, method: '', classes: [
      { value: 10, label: 'Tree cover', color: '', km2: 0.0052, pct: 26 }, { value: 30, label: 'Grassland', color: '', km2: 0.0005, pct: 2.5 },
      { value: 50, label: 'Built-up', color: '', km2: 0.0139, pct: 69.5 }] };
    const g = greenOf(a);
    expect(g.greenM2).toBeCloseTo(5700); expect(g.treeCoverM2).toBeCloseTo(5200); expect(g.areaM2).toBeCloseTo(19600);
    expect(greenOf({ ...a, classes: [] })).toMatchObject({ greenM2: null, outside: true });
    expect(greenOf(null).greenM2).toBeNull();
  });
  it('formats, length, rings and CSV', () => {
    expect(fmtArea(null)).toBe('UNKNOWN'); expect(fmtArea(5700)).toBe('5,700 m²'); expect(fmtArea(250000)).toBe('25 ha');
    expect(lineLengthM([[73.8517, 18.5204], [73.8617, 18.5204]])).toBeGreaterThan(1050);
    expect(lineLengthM([[73.8517, 18.5204], [73.8617, 18.5204]])).toBeLessThan(1060);
    expect(ringsOf({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [0, 1], [0, 0]]], [[[2, 2], [3, 2], [2, 3], [2, 2]]]] })).toHaveLength(2);
    const csv = impactCsv({ name: 'Road "A", east', type: 'road', lengthM: 1054.2, widthM: 19,
      footprint: { trees: 118, rare: 0, greenM2: 5700, treeCoverM2: 5200, areaM2: 19600 }, buffer: { trees: null, rare: null, greenM2: 10000, treeCoverM2: 9500, areaM2: 40900 } }, '2026-11-21T00:00:00Z');
    expect(csv).toContain('"Road ""A"", east"');
    expect(csv).toMatch(/census trees,118,UNKNOWN,trees/);
    expect(csv).toMatch(/not an environmental impact assessment/);
  });
});

describe('emissions: relative change only', () => {
  it('drops absolute values and the idling row', () => {
    const r = relativeEmissions([{ label: 'CO₂', change: -0.042, agreement: { same: 3, of: 3 } }, { label: 'Time vehicles stood still (engine idling)', change: 0.1 }]);
    expect(r).toEqual([{ label: 'CO₂', change: -0.042, agreement: { same: 3, of: 3 } }]);
    expect(Object.keys(r[0])).not.toContain('before');
    expect(fmtPct(-0.042)).toBe('−4.2 %'); expect(fmtPct(0.1)).toBe('+10.0 %'); expect(fmtPct(null)).toBe('UNKNOWN');
    expect(relativeEmissions(undefined)).toEqual([]);
  });
  it('reads like Simulate: under 0.5 % is "no change", agreement counts runs', () => {
    expect(emissionRowText({ label: 'PM', change: 0.0042, agreement: { same: 1, of: 3 } })).toEqual({ pct: 'no change', runs: '' });
    expect(emissionRowText({ label: 'CO₂', change: 0.009, agreement: { same: 3, of: 3 } })).toEqual({ pct: '+0.9 %', runs: '3/3 runs' });
    expect(emissionRowText({ label: 'NOx', change: null })).toEqual({ pct: 'UNKNOWN', runs: '' });
  });
});

describe('records', () => {
  it('CSV escapes and keeps sample counts', () => {
    expect(toCsv([['a,b', 'c"d', null]])).toBe('"a,b","c""d",\n');
    const c = airCsv({ station_id: 'site_292', label: 'PM2.5', unit: 'µg/m³', agg: 'day', points: [{ t: '2024-01-01T00:00:00+05:30', v: 41.3, n: 96 }] }, 'Karve Road, Pune');
    expect(c).toContain('"Karve Road, Pune"'); expect(c).toContain('2024-01-01T00:00:00+05:30,41.3,96');
    expect(NAAQS_24H.pm25_ugm3).toBe(60); expect(NAAQS_24H.co_mgm3).toBeUndefined();
  });
  it('bucket labels from the series timestamps', () => {
    expect(pointDate('Mon 2024-01-01 12:00 AM IST (UTC+05:30)', 'day')).toBe('2024-01-01');
    expect(pointDate('Mon 2024-01-01 12:00 AM IST (UTC+05:30)', 'month')).toBe('2024-01');
    expect(pointDate('2024-11-05T00:00:00+05:30', 'day')).toBe('2024-11-05');
    expect(pointDate('n/a', 'day')).toBe('n/a');
  });
  it('chart readout index', () => {
    expect(readoutIndex(0, 0.5)).toBe(-1); expect(readoutIndex(11, 0.5)).toBe(5); expect(readoutIndex(11, -1)).toBe(0); expect(readoutIndex(11, 2)).toBe(10);
  });
});

describe('OSM overlays are fetched for the view, not the whole city', () => {
  const cov = [73.55, 18.3, 74.2, 18.85];
  it('pads the view and clips to coverage', () => {
    const r = requestBox([73.85, 18.49, 73.87, 18.51], cov)!;
    expect(r.from).toBe('camera view');
    expect(r.bbox[0]).toBeCloseTo(73.84); expect(r.bbox[2]).toBeCloseTo(73.88);
    expect(requestBox([10, 10, 10.1, 10.1], cov)).toBeNull();
    expect(requestBox([73.0, 18.0, 74.5, 19.0], cov)!.from).toBe('layer coverage');   // zoomed out
    expect(requestBox(null, cov)!.bbox).toEqual(cov);
  });
  it('redraws only when the view leaves the drawn box', () => {
    expect(boxHolds([73.84, 18.48, 73.88, 18.52], [73.85, 18.49, 73.87, 18.51])).toBe(true);
    expect(boxHolds([73.84, 18.48, 73.88, 18.52], [73.83, 18.49, 73.87, 18.51])).toBe(false);
    expect(boxHolds(null, [0, 0, 1, 1])).toBe(false);
  });
});

describe('hover tooltips', () => {
  it('registered tips, OSM fallbacks, nothing for city objects', () => {
    setTip('env_overlay_tree_1', { type: 'Tree · PMC census 2019', name: 'Neem', detail: 'girth 120 cm', evidence: 'Measured' });
    expect(tipFor(pickedId({ id: { id: 'env_overlay_tree_1' } }))?.name).toBe('Neem');
    expect(tipFor('env_overlay_water_way_5', 'Mula')?.type).toMatch(/Water/);
    expect(tipFor('env_overlay_heritage_node_9', null)?.name).toBe('Unnamed in OSM');
    expect(tipFor('r1')).toBeNull(); expect(tipFor(null)).toBeNull();
    clearTips('env_overlay_tree_'); expect(tipFor('env_overlay_tree_1')).toBeNull();
    expect(pickedId({ id: 'x' })).toBe('x'); expect(pickedId(undefined)).toBeNull();
  });
  it('no tip text carries a filesystem path', () => {
    const t = tipFor('env_overlay_railway_way_1', 'Line')!;
    for (const s of Object.values(t)) expect(redactPaths(String(s))).toBe(String(s));
  });
});
