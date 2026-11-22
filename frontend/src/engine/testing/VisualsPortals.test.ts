import { describe, it, expect } from 'vitest';
import { planPortals, planPortalsOnPath } from '../rendering/geometry/tunnelPortal';
import { ProceduralGeometryGenerator } from '../rendering/geometry/ProceduralGeometryGenerator';
import { VISUAL_DIMS, dim, assumedDimsFor } from '../rendering/standards/visualDims';
import type { PathPt } from '../rendering/geometry/markingPattern';
import type { RoadObject, UndergroundAlignmentObject } from '../objects/types';

const M_PER_DEG = 111_320;
const lngAt = (x: number, lat = 18.52) => 73.85 + x / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
/** East-running path with floor levels at the given x (m). */
const path = (pts: [number, number][]): PathPt[] => pts.map(([x, z]) => [lngAt(x), 18.52, z]);

function heightOf(x: number, y: number, z: number): number {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = 2 * f - f * f, b = a * (1 - f), ep2 = (a * a - b * b) / (b * b);
  const r = Math.hypot(x, y);
  const th = Math.atan2(z * a, r * b);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, r - e2 * a * Math.cos(th) ** 3);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return r / Math.cos(lat) - N;
}

describe('R7 portal placement (pure)', () => {
  it('ramp from ground to −10 m: headwall where the floor reaches −(opening + cover), boat from −0.3 m to there', () => {
    // 0 m at x=0 down to −10 m at x=200 (5 % grade), opening 5 m, cover 1 m → headwall at −6 m = x 120
    const { portals, boats } = planPortals([0, 200], [0, -10], 5, 1);
    expect(portals).toHaveLength(1);
    expect(portals[0].headwallS).toBeCloseTo(120, 6);
    expect(portals[0].facing).toBe(-1); // the open approach is behind (smaller s)
    expect(boats).toHaveLength(1);
    expect(boats[0].s0).toBeCloseTo(6, 6); // −0.3 m at 5 %
    expect(boats[0].s1).toBeCloseTo(120, 6);
  });
  it('a tunnel ramping down and up again gets two portals facing outward and two boat runs', () => {
    const { portals, boats } = planPortals([0, 200, 400, 600], [0, -10, -10, 0], 5, 1);
    expect(portals.map(p => Math.round(p.headwallS))).toEqual([120, 480]);
    expect(portals.map(p => p.facing)).toEqual([-1, 1]);
    expect(boats).toHaveLength(2);
    expect(boats[1].s0).toBeCloseTo(480, 6);
    expect(boats[1].s1).toBeCloseTo(594, 6);
  });
  it('shallow (default −0.2 m) or wholly deep stretches get no portal', () => {
    expect(planPortals([0, 100], [-0.2, -0.2], 5, 1)).toEqual({ portals: [], boats: [] });
    expect(planPortals([0, 100], [-12, -12], 5, 1).portals).toEqual([]);
    expect(planPortals([0, 100], [-12, -12], 5, 1).boats).toEqual([]);
  });
  it('works on real paths (densified, plan metres)', () => {
    const plan = planPortalsOnPath(path([[0, 0], [200, -10]]), 5, 1);
    expect(plan.portals[0].headwallS).toBeCloseTo(120, 0);
  });
});

describe('R7 portal dimensions are labelled', () => {
  it('portal and boat values are assumed (with "none found"), clearance cites IRC:54', () => {
    for (const k of ['portalHeadwallThickness', 'portalHeadwallWing', 'portalCopingDepth', 'portalCover', 'boatWallThickness', 'boatBaseThickness', 'boatParapetHeight'] as const) {
      expect(VISUAL_DIMS[k].status, k).toBe('assumed');
    }
    expect(VISUAL_DIMS.roadTunnelClearance.source).toMatch(/IRC:54/);
    expect(assumedDimsFor('underground_alignment').map(r => r.key)).toContain('portalHeadwallThickness');
    expect(assumedDimsFor('road', { portal: true }).map(r => r.key)).toContain('boatWallThickness');
    expect(assumedDimsFor('road').map(r => r.key)).not.toContain('boatWallThickness');
  });
});

const base = { layerId: 'x', scenarioId: 'base', createdAt: '', updatedAt: '' };
const gen = new ProceduralGeometryGenerator();

describe('R7 portal meshes', () => {
  it('a drawn road ramping into a cut gets one merged portal mesh: headwall top at ground + parapet + coping', () => {
    const road = { ...base, id: 'r', type: 'road', name: 'r', coordinates: path([[0, 0], [200, -10]]), roadClass: 'local', width: 8, laneCount: 2, laneWidth: 3.5,
      hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40, isOneWay: false, trafficCapacity: 1200, connectedJunctions: [] } as unknown as RoadObject;
    const portal = gen.generateMeshData(road).filter(m => m.layerId === 'portal');
    expect(portal).toHaveLength(1);
    expect(portal[0].material.materialId).toBe('concrete_pier');
    let hi = -Infinity, lo = Infinity;
    const p = portal[0].positions;
    for (let i = 0; i < p.length; i += 3) { const h = heightOf(p[i], p[i + 1], p[i + 2]); hi = Math.max(hi, h); lo = Math.min(lo, h); }
    expect(hi).toBeCloseTo(dim('boatParapetHeight') + dim('portalCopingDepth'), 1);
    expect(lo).toBeCloseTo(-(dim('roadTunnelClearance') + dim('portalCover')) - dim('boatBaseThickness'), 1);
  });
  it('an at-grade road or a shallow tunnel gets no portal', () => {
    const road = { ...base, id: 'r', type: 'road', name: 'r', coordinates: path([[0, 0], [100, 0]]), roadClass: 'local', width: 8, laneCount: 2, laneWidth: 3.5,
      hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40, isOneWay: false, trafficCapacity: 1200, connectedJunctions: [] } as unknown as RoadObject;
    expect(gen.generateMeshData(road).some(m => m.layerId === 'portal')).toBe(false);
  });
  it('cut-and-cover alignment surfacing at one end: portal; utility trunk or unknown depth: none', () => {
    const al = (kind: UndergroundAlignmentObject['alignmentKind'], d1: number | null) => ({ ...base, id: 'a', type: 'underground_alignment', name: 'a',
      coordinates: path([[0, 0], [300, 0]]), alignmentKind: kind, section: { shape: 'box', widthM: 10, heightM: 7 }, sectionCertainty: 'assumed',
      depths: [{ crownDepthM: 0, certainty: 'assumed' }, { crownDepthM: d1, certainty: 'assumed' }] }) as unknown as UndergroundAlignmentObject;
    // crown at ground (floor −7) → crown 8 m (floor −15); headwall where the floor = −(7 + 1) m
    const meshes = gen.generateMeshData(al('cut_and_cover', 8));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].layerId).toBe('portal');
    expect(gen.generateMeshData(al('utility_trunk', 8))).toEqual([]);
    expect(gen.generateMeshData(al('cut_and_cover', null))).toEqual([]);
  });
});
