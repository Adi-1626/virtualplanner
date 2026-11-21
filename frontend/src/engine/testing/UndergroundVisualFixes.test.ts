import { describe, expect, it } from 'vitest';
import type { MetroLineObject, MetroStationObject, UtilityObject } from '../objects/types';
import type { SubsurfaceRecord } from '../../lib/coordinationApi';
import {
  DEPTH_NOT_MAPPED, NO_OFFICIAL_STATION_DEPTH, NO_OFFICIAL_TUNNEL_DEPTH, declutterStationLabels, metroTip, objectTip, pickObjectId, pickRecordId, recordTip, shortStationName, utilityTip,
} from '../underground/hoverInfo';
import { DEFAULT_UNDERGROUND_SETTINGS, UndergroundView, type ViewerLike } from '../underground/UndergroundView';

const rec = (over: Partial<SubsurfaceRecord> = {}): SubsurfaceRecord => ({
  id: 'r1', dataset_id: 'd1', record_type: 'utility', external_id: 'ND-CO-654', geometry: null, location_note: '', ground_level_m: null,
  final_depth_m: null, strata: [], water_strikes: [], spt: [], utility_type: 'sewer', owner: null, depth_m: 1.14, diameter_m: 0.3,
  quality_level: 'QL-D', survey_method: null, z_min_m: null, z_max_m: null, z_certainty: 'estimated', properties: {}, ...over,
} as SubsurfaceRecord);
const pipe = (over: Partial<UtilityObject> = {}): UtilityObject => ({
  id: 'u1', type: 'utility', name: 'Utility ymoz', layerId: 'water_util', scenarioId: 'alt1',
  coordinates: [[73.855, 18.5, 0], [73.856, 18.5, 0]], utilityType: 'water', depth: 1.5, capacity: 100,
  createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
} as UtilityObject);

describe('hover tooltip text', () => {
  it('resolves picked entity ids (ug:<id>:<part>, rec:<id>[:k]) and ignores the cutaway pit', () => {
    expect(pickObjectId('ug:5yxoc7xan:run0')).toBe('5yxoc7xan');
    expect(pickObjectId('ug:osm_m_way_1_in_area_x_0:label')).toBe('osm_m_way_1_in_area_x_0');
    expect(pickObjectId('ymozckl84')).toBe('ymozckl84');
    expect(pickObjectId('ug:cutaway:floor')).toBeNull();
    expect(pickObjectId('rec:ssr_sewer_1')).toBeNull();
    expect(pickRecordId('rec:ssr_sewer_7619_31098')).toBe('ssr_sewer_7619_31098');
    expect(pickRecordId('rec:ssr_sewer_7619_31098:1')).toBe('ssr_sewer_7619_31098');
    expect(pickRecordId('ug:x:plan')).toBeNull();
  });
  it('records: type, id, recorded depth or "depth not mapped", evidence and source', () => {
    const t = recordTip(rec(), 'PMC sewer network');
    expect(t.type).toBe('Sewer · existing record');
    expect(t.name).toBe('ND-CO-654');
    expect(t.depth).toContain('~1.1 m below ground as recorded');
    expect(t.depth).toContain('Ø 300 mm');
    expect(t.status).toBe('Existing · evidence QL-D · PMC sewer network');
    const s = recordTip(rec({ utility_type: 'storm_drain', depth_m: null, diameter_m: null, quality_level: null }));
    expect(s.type).toBe('Storm-water drain · existing record');
    expect(s.depth).toContain(DEPTH_NOT_MAPPED);
    expect(s.status).toContain('UNKNOWN');
    expect(recordTip(rec({ record_type: 'borehole', final_depth_m: null })).depth).toBe(DEPTH_NOT_MAPPED);
  });
  it('drawn pipes: top-of-pipe depth with the default-cover flag, status and evidence', () => {
    const t = utilityTip(pipe({ status: 'proposed', evidence: 'user-drawn' }));
    expect(t.type).toBe('Water pipe · drawn');
    expect(t.depth).toMatch(/^Top of pipe [\d.]+(–[\d.]+)? m below ground/);
    expect(t.status).toContain('Proposed · evidence user-drawn');
    expect(objectTip(pipe())?.type).toBe('Water pipe · drawn');
  });
  it('metro: unmapped tunnel / station say "depth not mapped"; elevated metro gives its deck height', () => {
    const line = { id: 'm1', type: 'metro_line', name: 'Pune Metro Line 1', coordinates: [], elevation: -6, trackCount: 2 } as unknown as MetroLineObject;
    expect(metroTip(line, true)).toMatchObject({ type: 'Metro tunnel', depth: NO_OFFICIAL_TUNNEL_DEPTH });
    expect(NO_OFFICIAL_TUNNEL_DEPTH).toBe('Depth not mapped (no official figure)');
    expect(metroTip({ ...line, elevation: 12 } as MetroLineObject, false).depth).toContain('12 m above ground');
    const st = { id: 's1', type: 'metro_station', stationName: 'Swargate', coordinates: [73.857, 18.4997, 0], elevation: 0 } as unknown as MetroStationObject;
    const t = objectTip(st, { unmappedMetro: () => ({ inferred: true }) })!;
    expect(t).toMatchObject({ type: 'Underground metro station', name: 'Swargate', depth: NO_OFFICIAL_STATION_DEPTH });
    expect(t.status).toContain('on a tunnel section');
    expect(objectTip({ id: 'b', type: 'building' } as never)).toBeNull();
  });
});

describe('metro station label declutter', () => {
  it('shortens OSM station names to the station name', () => {
    expect(shortStationName('District Court (Purple Line)')).toBe('District Court');
    expect(shortStationName('District Court Metro Station')).toBe('District Court');
    expect(shortStationName('Kasba Peth कसबा पेठ')).toBe('Kasba Peth');
    expect(shortStationName('Civil Court')).toBe('Civil Court');
    expect(shortStationName(undefined)).toBe('');
    expect(shortStationName('Subway Station 7944597694')).toBe('');
  });
  it('merges an interchange into one label and staggers close neighbours (Pune: District Court, Kasba Peth, Mandai)', () => {
    const labels = declutterStationLabels([
      { id: 'a', name: 'District Court (Aqua Line)', lon: 73.8577478, lat: 18.5267201 },
      { id: 'b', name: 'District Court (Purple Line)', lon: 73.8568986, lat: 18.5267856 },
      { id: 'c', name: 'District Court (Pink Line)', lon: 73.8560123, lat: 18.5283954 },
      { id: 'd', name: 'Civil Court', lon: 73.8572, lat: 18.5272 },
      { id: 'e', name: 'Kasba Peth कसबा पेठ', lon: 73.8596235, lat: 18.5213749 },
      { id: 'f', name: 'Mandai', lon: 73.8570097, lat: 18.5128979 },
      { id: 'g', name: '', lon: 73.858, lat: 18.51 },
      { id: 'h', name: 'Swargate', lon: 73.8574604, lat: 18.4997453 },
    ]);
    expect(labels.map(l => l.text)).toEqual(['District Court / Civil Court', 'Kasba Peth', 'Mandai', 'Swargate']);
    expect(labels[0].ids.sort()).toEqual(['a', 'b', 'c', 'd']);
    // Kasba Peth is ~650 m from District Court: below its point; Mandai ~960 m from Kasba Peth: back above
    expect(labels[0].offsetY).toBeLessThan(0);
    expect(labels[1].offsetY).toBeGreaterThan(0);
    expect(labels.every((l, i) => i === 0 || l.text !== labels[i - 1].text)).toBe(true);
  });
});

describe('ground opacity default on every entry', () => {
  const fake = (): ViewerLike => ({
    scene: {
      globe: { translucency: { enabled: false, frontFaceAlpha: 1, backFaceAlpha: 1, rectangle: 'R0', backFaceAlphaByDistance: 'NFS' }, undergroundColor: 'BLACK', depthTestAgainstTerrain: true },
      screenSpaceCameraController: { enableCollisionDetection: true },
      backgroundColor: 'SPACE', skyBox: { show: true }, skyAtmosphere: { show: true }, sun: { show: true }, moon: { show: true },
    },
  });
  const deps = { rectangle: (d: unknown) => (d ? 'RECT' : 'MAX'), tint: () => 'SLATE', backdrop: () => 'DARK' };
  it('a slider left at 0 % (or X-ray / local mode) in an earlier visit does not carry over to the next entry', () => {
    const v = fake();
    const uv = new UndergroundView(deps);
    uv.enter(v);
    uv.update({ groundOpacity: 0, xray: true, seeThroughEverywhere: false, rectangleDeg: [1, 2, 3, 4] });
    uv.leave();
    uv.enter(v);
    expect(uv.getSettings()).toEqual({ ...DEFAULT_UNDERGROUND_SETTINGS, rectangleDeg: [1, 2, 3, 4] });
    expect(DEFAULT_UNDERGROUND_SETTINGS.groundOpacity).toBeGreaterThanOrEqual(0.35);
    expect(DEFAULT_UNDERGROUND_SETTINGS.groundOpacity).toBeLessThanOrEqual(0.4);
    expect(DEFAULT_UNDERGROUND_SETTINGS.seeThroughEverywhere).toBe(true);
    expect(v.scene.globe.translucency.frontFaceAlpha).toBe(0.35);
  });
  it('never draws the globe back face, hides sky / stars behind the ground, and restores everything on leave', () => {
    const v = fake();
    const before = JSON.stringify(v);
    const uv = new UndergroundView(deps);
    uv.enter(v);
    for (const op of [0, 0.35, 1]) {
      uv.update({ groundOpacity: op });
      expect(v.scene.globe.translucency.backFaceAlpha).toBe(0);
      expect(v.scene.globe.translucency.backFaceAlphaByDistance).toBeUndefined();
    }
    expect(v.scene.backgroundColor).toBe('DARK');
    expect(v.scene.skyBox?.show).toBe(false);
    expect(v.scene.skyAtmosphere?.show).toBe(false);
    uv.leave();
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe('leave() restores values Cesium copies into its own objects', () => {
  it('saves copies of the rectangle and underground colour, not the live objects apply() overwrites', () => {
    class Box { constructor(public w: number) {} clone() { return new Box(this.w); } }
    const rect = new Box(-3.14);
    const globe = {
      translucency: { enabled: false, frontFaceAlpha: 1, backFaceAlpha: 1, get rectangle() { return rect; }, set rectangle(r: unknown) { rect.w = (r as Box).w; } },
      undergroundColor: 'BLACK', depthTestAgainstTerrain: false,
    };
    const v = { scene: { globe, screenSpaceCameraController: { enableCollisionDetection: true } } } as unknown as ViewerLike;
    const uv = new UndergroundView({ rectangle: d => new Box(d ? d[0] : -3.14), tint: () => 'SLATE' });
    uv.enter(v);
    uv.update({ rectangleDeg: [1.29, 0, 2, 1], seeThroughEverywhere: false });
    expect(rect.w).toBe(1.29);
    uv.leave();
    expect(rect.w).toBe(-3.14);
  });
});

describe('legend group toggles', () => {
  it('hide / show a renderer group and notify listeners once per change', async () => {
    const { UndergroundRenderer } = await import('../underground/UndergroundRenderer');
    const r = new UndergroundRenderer();
    let n = 0;
    r.onVisibilityChange(() => { n++; });
    expect(r.isGroupVisible('records')).toBe(true);
    r.setGroupVisible('records', false);
    r.setGroupVisible('records', false);
    expect(r.isGroupVisible('records')).toBe(false);
    expect(r.isGroupVisible('utilities')).toBe(true);
    r.setGroupVisible('records', true);
    expect(n).toBe(2);
  });
});
