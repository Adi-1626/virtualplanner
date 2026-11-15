import { describe, expect, it } from 'vitest';
import type { UtilityObject } from '../objects/types';
import {
  TYPICAL_COVER, initialUtilityDepths, topDepthFrom, utilityExtentAt, utilitySummary, utilityZ, withAllUtilityDepths,
  withUtilityGroundReference, withUtilityType, withUtilityVertexDepth, withUtilityZ,
} from '../underground/utilityModel';
import { verticalExtentOf } from '../underground/alignmentGeometry';

const legacy = (over: Partial<UtilityObject> = {}): UtilityObject => ({
  id: 'u1', type: 'utility', name: 'Pipe', layerId: 'water_util', scenarioId: 'alt1',
  coordinates: [[73.855, 18.5, 0], [73.856, 18.5, 0], [73.857, 18.5, 0]], utilityType: 'water', depth: 1.5, capacity: 100,
  createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
} as UtilityObject);

describe('utility Z model', () => {
  it('migrates a legacy utility on read: placeholder depth → Unknown, top-of-pipe, user-drawn, proposed in an alternative', () => {
    const z = utilityZ(legacy({ depthCertainty: 'unknown' }));
    expect(z.migrated).toBe(true);
    expect(z.depths.every(d => d.depthM === null && d.certainty === 'unknown')).toBe(true);
    expect([z.zRef, z.status, z.evidence]).toEqual(['top', 'proposed', 'user-drawn']);
    // a stated depth without certainty: hypothetical in a proposal, unknown on the base city (screening reads it the same way)
    expect(utilityZ(legacy()).depths[0]).toMatchObject({ depthM: 1.5, certainty: 'hypothetical' });
    const base = utilityZ(legacy({ scenarioId: 'base' }));
    expect([base.depths[0].certainty, base.status]).toEqual(['unknown', 'unknown']);
  });

  it('a new line takes the typical cover of its type as a labelled default, never as measured', () => {
    const d = initialUtilityDepths(2, 'electricity', null, 'measured');
    expect(d).toEqual([{ depthM: TYPICAL_COVER.electricity.coverM, certainty: 'hypothetical', isDefault: true }, { depthM: 0.9, certainty: 'hypothetical', isDefault: true }]);
    expect(initialUtilityDepths(1, 'gas', 2.4, 'measured')).toEqual([{ depthM: 2.4, certainty: 'measured' }]);
  });

  it('derives top-of-pipe from centre / invert only when the diameter is known; legacy depth = shallowest top', () => {
    expect(topDepthFrom(2, 'invert', 0.6)).toBe(1.4);
    expect(topDepthFrom(2, 'centre', 0.6)).toBe(1.7);
    expect(topDepthFrom(2, 'invert', null)).toBeNull();
    let u = withUtilityZ(legacy(), { zRef: 'invert', diameterMm: 600, depths: [{ depthM: 2.5, certainty: 'estimated' }, { depthM: 2.0, certainty: 'measured' }, { depthM: 3, certainty: 'hypothetical' }] });
    expect(u.depths!.map(d => d.topDepthM)).toEqual([1.9, 1.4, 2.4]);
    expect([u.depth, u.depthCertainty]).toEqual([1.4, 'hypothetical']);
    // diameter unknown: no top can be derived → the screening engine sees depthCertainty 'unknown' (= no depth)
    u = withUtilityZ(u, { diameterMm: null });
    expect(u.depthCertainty).toBe('unknown');
    expect(utilitySummary(u).minTopM).toBeNull();
  });

  it('changing the evidence relabels depths that carry the old evidence\'s usual certainty (QL-C existing → Estimated), keeps hand-set ones and defaults', () => {
    let u = withUtilityZ(legacy(), { depths: [{ depthM: 1.5, certainty: 'hypothetical' }, { depthM: 2, certainty: 'measured' }, { depthM: 1, certainty: 'hypothetical', isDefault: true }] });
    expect(u.evidence).toBe('user-drawn');
    u = withUtilityZ(u, { status: 'existing', evidence: 'QL-C' });
    expect(u.depths!.map(d => d.certainty)).toEqual(['estimated', 'measured', 'hypothetical']);
    u = withUtilityZ(u, { evidence: 'QL-A' });
    expect(u.depths!.map(d => d.certainty)).toEqual(['measured', 'measured', 'hypothetical']);
    u = withUtilityZ(u, { evidence: 'QL-A' });   // no change of evidence → nothing relabelled
    expect(u.depths![0].certainty).toBe('measured');
  });

  it('editing a vertex clears its default flag and stale elevation; type change only moves defaults', () => {
    let u = withUtilityZ(legacy(), { depths: initialUtilityDepths(3, 'water', null, 'hypothetical') });
    u = withUtilityGroundReference(u, [560, 561, null], 'DSM test');
    expect(u.depths!.map(d => d.elevationM)).toEqual([559, 560, null]);
    u = withUtilityVertexDepth(u, 1, { depthM: 2.2 });
    expect(u.depths![1]).toEqual(expect.objectContaining({ depthM: 2.2, certainty: 'hypothetical' }));
    expect(u.depths![1].isDefault).toBeUndefined();
    expect(u.depths![1].elevationM).toBeUndefined();
    u = withUtilityType(u, 'electricity');
    expect(u.depths!.map(d => d.depthM)).toEqual([0.9, 2.2, 0.9]);
    u = withAllUtilityDepths(u, 1.2, 'estimated');
    expect(u.depths!.every(d => d.depthM === 1.2 && !d.isDefault && d.certainty === 'estimated')).toBe(true);
    const l = legacy();
    expect(withUtilityGroundReference(l, [1, 2, 3], 'x')).toBe(l);   // viewing never rewrites a legacy object
  });

  it('a default stays the typical cover to the TOP of the pipe when the reference or diameter changes', () => {
    let u = withUtilityZ(legacy(), { depths: initialUtilityDepths(3, 'water', null, 'hypothetical') });
    u = withUtilityZ(u, { zRef: 'invert' });
    expect(u.depths!.map(d => [d.depthM, d.topDepthM])).toEqual([[1, null], [1, null], [1, null]]);   // diameter unknown → top Unknown
    u = withUtilityZ(u, { diameterMm: 300 });
    expect(u.depths!.map(d => [d.depthM, d.topDepthM])).toEqual([[1.3, 1], [1.3, 1], [1.3, 1]]);
    u = withUtilityVertexDepth(u, 0, { depthM: 2 });
    u = withUtilityType(u, 'electricity');
    expect(u.depths!.map(d => d.topDepthM)).toEqual([1.7, 0.9, 0.9]);
  });

  it('profile / section extent interpolates per-vertex depths at the crossing, with the stated reference', () => {
    const u = withUtilityZ(legacy(), { zRef: 'top', diameterMm: 300, depths: [{ depthM: 1, certainty: 'estimated' }, { depthM: 3, certainty: 'estimated' }, { depthM: null, certainty: 'unknown' }] });
    const seg = utilityExtentAt(u, 0).topM;
    expect(seg).toBe(1);
    const mid = utilityExtentAt(u, 52.8);   // ~half of the first 105.6 m segment
    expect(mid.topM).toBeCloseTo(2, 1);
    expect(mid.bottomM).toBeCloseTo(2.3, 1);
    expect(utilityExtentAt(u, 160).topM).toBeNull();
    const e = verticalExtentOf(u, 52.8)!;
    expect(e.topDepthM).toBeCloseTo(2, 1);
    expect(e.note).toContain('top of pipe');
  });
});

describe('OSM metro with an unmapped depth (F12)', () => {
  const line = (over: Record<string, unknown> = {}) => ({ id: 'm1', type: 'metro_line', name: 'Purple Line', layerId: 'metro', coordinates: [[73.857, 18.497, -6], [73.858, 18.502, -6]], trackCount: 2, trackGauge: 1.435, deckWidth: 8, elevation: -6, pierSpacing: 30, tags: { tunnel: 'yes', layer: '-2' }, createdAt: '', updatedAt: '', ...over }) as unknown as import('../objects/types').MetroLineObject;
  const station = (over: Record<string, unknown> = {}) => ({ id: 's1', type: 'metro_station', name: 'Swargate', layerId: 'metro', coordinates: [73.8581, 18.5021, 0], stationName: 'Swargate', length: 140, width: 20, height: 8, elevation: 0, capacity: 1, originalOsmTags: { railway: 'station', station: 'subway' }, createdAt: '', updatedAt: '', ...over }) as unknown as import('../objects/types').MetroStationObject;
  it('a tunnel=yes / layer<0 line is plan-only; an elevated one is not', async () => {
    const { isUnmappedMetroTunnel } = await import('../underground/metroLevel');
    expect(isUnmappedMetroTunnel(line())).toBe(true);
    expect(isUnmappedMetroTunnel(line({ elevation: 12, tags: { bridge: 'yes' } }))).toBe(false);
  });
  it('a level-less OSM station on a tunnel section is an underground station (inferred); away from it, or drawn, it is not', async () => {
    const { unmappedUndergroundStation } = await import('../underground/metroLevel');
    expect(unmappedUndergroundStation(station(), [line()])).toMatchObject({ inferred: true });
    expect(unmappedUndergroundStation(station({ coordinates: [73.80, 18.50, 0] }), [line()])).toBeNull();
    expect(unmappedUndergroundStation(station({ originalOsmTags: undefined }), [line()])).toBeNull();
    expect(unmappedUndergroundStation(station({ originalOsmTags: { location: 'underground' } }), [])).toMatchObject({ inferred: false });
  });
});
