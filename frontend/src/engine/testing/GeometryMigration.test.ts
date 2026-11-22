import { describe, expect, it } from 'vitest';
import { alignmentFromPolyline, defaultAlignmentSettings, densifyAlignment, geometryLockReason } from '../geometry/alignment';
import { lonLatFromXY } from './geometryTestHelpers';

const z3 = (pts: [number, number][]) => lonLatFromXY(pts).map(([lon, lat]) => [lon, lat, 6] as [number, number, number]);

describe('migration of old polylines to PIs with radius 0', () => {
  it('a 10 m-resampled flyover recovers its clicked corners and reproduces the identical shape', () => {
    const pts: [number, number][] = [];
    for (let x = 0; x <= 200; x += 10) pts.push([x, 0]);
    for (let y = 10; y <= 150; y += 10) pts.push([200, y]);
    const coords = z3(pts);
    const r = alignmentFromPolyline(coords);
    expect(r.keptIndices).toEqual([0, 20, 35]);
    expect(r.roundTripOk).toBe(true);
    expect(r.maxDeviationM).toBeLessThan(0.001);
    expect(r.alignment.pis.every(p => p.radiusM === 0)).toBe(true);
    const regen = densifyAlignment(r.alignment).coordinates;
    expect(regen.map(c => [c[0], c[1]])).toEqual(r.keptIndices.map(i => [coords[i][0], coords[i][1]]));
  });

  it('a clicked polyline with real corners round-trips exactly', () => {
    const coords = z3([[0, 0], [80, 35], [130, 160], [300, 175]]);
    const r = alignmentFromPolyline(coords);
    expect(r.keptIndices).toEqual([0, 1, 2, 3]);
    expect(densifyAlignment(r.alignment).coordinates.map(c => [c[0], c[1]])).toEqual(coords.map(c => [c[0], c[1]]));
  });

  it('round-trip guard: a vertex off the line by more than 1 mm keeps every vertex', () => {
    const coords = z3([[0, 0], [50, 0.02], [100, 0]]);
    const r = alignmentFromPolyline(coords);
    expect(r.roundTripOk).toBe(false);
    expect(r.keptIndices).toEqual([0, 1, 2]);
  });

  it('exact repeated points are dropped, not turned into coincident PIs', () => {
    const coords = z3([[0, 0], [50, 0], [50, 0], [50, 60]]);
    const r = alignmentFromPolyline(coords);
    expect(r.keptIndices).toEqual([0, 1, 3]);
    expect(densifyAlignment(r.alignment).ok).toBe(true);
  });

  it('typed depths are never dropped', () => {
    const coords = z3([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]);
    // vertex 2 typed 5 m where the straight interpolation would give 3 m → kept; vertex 1 then no longer matches (3 vs 4) → kept too
    const depths = [3, 3, 5, null, 3];
    const r = alignmentFromPolyline(coords, { typedDepthAt: i => depths[i] });
    expect(r.keptIndices).toEqual([0, 1, 2, 4]); // 2 kept (5 ≠ 3); then 1 kept (3 ≠ 4 between 0 and 2)
    const lin = [2, 3, 4];
    expect(alignmentFromPolyline(z3([[0, 0], [10, 0], [20, 0]]), { typedDepthAt: i => lin[i] }).keptIndices).toEqual([0, 2]);
    // neighbour unknown → the typed value cannot be interpolated → kept
    const gap = [null, 4, 2];
    expect(alignmentFromPolyline(z3([[0, 0], [10, 0], [20, 0]]), { typedDepthAt: i => gap[i] }).keptIndices).toEqual([0, 1, 2]);
  });

  it('settings are applied to the migrated alignment', () => {
    const s = defaultAlignmentSettings({ type: 'utility' });
    const r = alignmentFromPolyline(z3([[0, 0], [10, 0], [10, 10]]), { settings: s });
    expect(r.alignment.behaviour).toBe('angled');
    expect(r.alignment.v).toBe(1);
  });
});

describe('geometry lock (OSM-imported stays locked)', () => {
  it('locks OSM roads, imported metro and records; user-drawn objects may convert', () => {
    expect(geometryLockReason({ type: 'road', id: 'road_1', osmProvenance: { osmId: 1 } })).toBe('osm-import');
    expect(geometryLockReason({ type: 'road', id: 'osm_123' })).toBe('osm-import');
    expect(geometryLockReason({ type: 'metro_line', id: 'osm_m_5' })).toBe('imported-metro');
    expect(geometryLockReason({ type: 'metro_line', id: 'm1', tags: { railway: 'subway' } })).toBe('imported-metro');
    expect(geometryLockReason({ type: 'underground_alignment', id: 'u1', lifecycle: 'existing' })).toBe('from-records');
    expect(geometryLockReason({ type: 'utility', id: 'w1', status: 'existing' })).toBe('from-records');
    expect(geometryLockReason({ type: 'road', id: 'road_2' })).toBeNull();
    expect(geometryLockReason({ type: 'utility', id: 'w2', status: 'proposed' })).toBeNull();
  });
});

describe('defaults (one config, not yet confirmed by the user)', () => {
  it('per type', () => {
    // D1 IRC:86-2018 Table 3.1 (plain): expressway 80, arterial 60, collector 40, local 30; D3 e 4 % surface, 7 % deck
    expect(defaultAlignmentSettings({ type: 'road', roadClass: 'arterial' })).toMatchObject({ behaviour: 'curved', designSpeedKmh: 60, eMax: 0.04, criteria: 'irc86-urban', designSpeedSource: 'class-default' });
    expect(defaultAlignmentSettings({ type: 'road', roadClass: 'collector' }).designSpeedKmh).toBe(40);
    expect(defaultAlignmentSettings({ type: 'road', roadClass: 'local' }).designSpeedKmh).toBe(30);
    expect(defaultAlignmentSettings({ type: 'road', roadClass: 'highway' })).toMatchObject({ designSpeedKmh: 80, eMax: 0.04, criteria: 'irc86-urban' });
    expect(defaultAlignmentSettings({ type: 'flyover', roadClass: 'highway' })).toMatchObject({ designSpeedKmh: 80, eMax: 0.07 });
    expect(defaultAlignmentSettings({ type: 'metro_flyover', roadClass: 'arterial' })).toMatchObject({ designSpeedKmh: 60, eMax: 0.07 });
    expect(defaultAlignmentSettings({ type: 'flyover', roadClass: 'collector' }).designSpeedKmh).toBe(40);
    expect(defaultAlignmentSettings({ type: 'flyover', roadClass: 'local' }).designSpeedKmh).toBe(30);
    expect(defaultAlignmentSettings({ type: 'metro_line' }).criteria).toBe('metro-pune-sk-dpr');
    expect(defaultAlignmentSettings({ type: 'underground_alignment', alignmentKind: 'bored_tunnel' }).criteria).toBe('metro-pune-sk-dpr');
    expect(defaultAlignmentSettings({ type: 'underground_alignment', alignmentKind: 'storm_drain' })).toMatchObject({ behaviour: 'angled', criteria: 'none', designSpeedKmh: null });
    expect(defaultAlignmentSettings({ type: 'utility' })).toMatchObject({ behaviour: 'angled', criteria: 'none' });
  });
});
