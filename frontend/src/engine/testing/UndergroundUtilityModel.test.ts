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
