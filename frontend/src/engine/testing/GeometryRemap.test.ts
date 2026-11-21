import { describe, expect, it } from 'vitest';
import { alignmentFromPolyline, densifyAlignment, interpolateDepths, rematchCrossings, remapSectionsByChainage } from '../geometry/alignment';
import { hasCompleteSectionCoverage } from '../objects/roadSections';
import type { UndergroundVertexDepth } from '../objects/types';
import type { UtilityVertexDepth } from '../underground/utilityModel';
import { lonLatFromXY, pisFromXY } from './geometryTestHelpers';

type Sec = { startNodeIndex: number; endNodeIndex: number; tag: string };
const coords = (pts: [number, number][]) => lonLatFromXY(pts).map(([lon, lat]) => [lon, lat, 0] as [number, number, number]);

describe('remap road sections by chainage', () => {
  it('keeps profiles in order with full coverage after a curve is added at the middle PI', () => {
    const old = coords([[0, 0], [100, 0], [100, 100]]);
    const sections: Sec[] = [{ startNodeIndex: 0, endNodeIndex: 1, tag: 'A' }, { startNodeIndex: 1, endNodeIndex: 2, tag: 'B' }];
    const curved = densifyAlignment({ behaviour: 'curved', pis: pisFromXY([[0, 0], [100, 0], [100, 100]], 60) }).coordinates;
    const out = remapSectionsByChainage(sections, old, curved);
    expect(out.map(s => s.tag)).toEqual(['A', 'B']);
    expect(hasCompleteSectionCoverage(out as never, curved.length)).toBe(true);
    const mid = out[1].startNodeIndex;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(curved.length - 2);
  });

  it('collapses sections that land on the same vertex, keeping the later one', () => {
    const old = coords([[0, 0], [1, 0], [2, 0], [100, 0]]);
    const sections: Sec[] = [
      { startNodeIndex: 0, endNodeIndex: 1, tag: 'A' }, { startNodeIndex: 1, endNodeIndex: 2, tag: 'B' }, { startNodeIndex: 2, endNodeIndex: 3, tag: 'C' },
    ];
    const out = remapSectionsByChainage(sections, old, coords([[0, 0], [100, 0]]));
    expect(out).toEqual([{ startNodeIndex: 0, endNodeIndex: 1, tag: 'C' }]);
    expect(remapSectionsByChainage([], old, old)).toEqual([]);
  });
});

describe('derived depths by chainage', () => {
  it('copies typed controls, interpolates between them, worst certainty, unknown propagates', () => {
    const controls: UndergroundVertexDepth[] = [
      { crownDepthM: 10, certainty: 'measured', elevationM: 550 },
      { crownDepthM: 20, certainty: 'estimated' },
      { crownDepthM: null, certainty: 'unknown' },
    ];
    const out = interpolateDepths(controls, [0, 100, 200], [0, 25, 100, 150, 200, 210], 'crownDepthM');
    expect(out[0]).toEqual(controls[0]);
    expect(out[0].derived).toBeUndefined();
    expect(out[1]).toEqual({ crownDepthM: 12.5, certainty: 'estimated', derived: true });
    expect(out[2]).toEqual(controls[1]);
    expect(out[3]).toEqual({ crownDepthM: null, certainty: 'unknown', derived: true });
    expect(out[4]).toEqual(controls[2]);
    expect(out[5]).toEqual({ crownDepthM: null, certainty: 'unknown', derived: true });
    // no typed value invented: every non-derived entry is one of the controls
    expect(out.filter(d => !d.derived)).toEqual(controls);
  });

  it('utility depths (depthM) keep isDefault only when both controls are defaults', () => {
    const c: UtilityVertexDepth[] = [
      { depthM: 1, certainty: 'hypothetical', isDefault: true },
      { depthM: 2, certainty: 'hypothetical', isDefault: true },
      { depthM: 3, certainty: 'measured' },
    ];
    const out = interpolateDepths(c, [0, 10, 20], [5, 15], 'depthM');
    expect(out[0]).toEqual({ depthM: 1.5, certainty: 'hypothetical', isDefault: true, derived: true });
    expect(out[1]).toEqual({ depthM: 2.5, certainty: 'hypothetical', derived: true });
  });

  it('end to end: migrated tunnel + curve → one depth per densified vertex', () => {
    const line = coords([[0, 0], [200, 0], [200, 200]]);
    const depths: UndergroundVertexDepth[] = [{ crownDepthM: 12, certainty: 'measured' }, { crownDepthM: 18, certainty: 'estimated' }, { crownDepthM: 15, certainty: 'measured' }];
    const m = alignmentFromPolyline(line, { typedDepthAt: i => depths[i].crownDepthM });
    const controls = m.keptIndices.map(i => depths[i]);
    m.alignment.pis[1].radiusM = 80;
    const d = densifyAlignment(m.alignment);
    const out = interpolateDepths(controls, d.piChainagesM, d.chainagesM, 'crownDepthM');
    expect(out.length).toBe(d.coordinates.length);
    expect(out[0]).toEqual(depths[0]);
    expect(out[out.length - 1]).toEqual(depths[2]);
    expect(out.every(x => x.crownDepthM !== null && x.crownDepthM >= 12 && x.crownDepthM <= 18)).toBe(true);
  });
});

describe('level crossing decisions re-matched by distance', () => {
  it('keeps a decision within 2 m on the same road, otherwise the crossing is new', () => {
    const [p, near, far] = lonLatFromXY([[0, 0], [1, 1], [3, 0]]);
    const prev = [{ roadId: 'r1', point: [p[0], p[1], 0] as [number, number, number], decision: 'grade_separated' }];
    const next = [
      { roadId: 'r1', point: [near[0], near[1], 0] as [number, number, number], decision: 'unconfirmed' },
      { roadId: 'r1', point: [far[0], far[1], 0] as [number, number, number], decision: 'unconfirmed' },
      { roadId: 'r2', point: [p[0], p[1], 0] as [number, number, number], decision: 'unconfirmed' },
    ];
    expect(rematchCrossings(prev, next).map(c => c.decision)).toEqual(['grade_separated', 'unconfirmed', 'unconfirmed']);
  });
});
