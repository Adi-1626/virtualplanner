import { describe, it, expect } from 'vitest';
import type { RoadAnalysisResult } from '../simulation/RoadAnalysis';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { comparisonTables, byRoad } from '../simulation/comparisonTables';

/**
 * A road's volume in the comparison is its busiest stretch with both directions together, the way 'Traffic routed
 * along it' counts the studied road. The heaviest single direction listed the closed Baba Bhide Bridge (1,031 veh/h
 * south-east, 756 north-west) as 1,031 veh/h in the road table and '−1,031 veh/h' in Where traffic moved, beside
 * 'Traffic routed along it 1,787 veh/h' for the same bridge (p11 user test).
 */
const res = (links: Record<string, number>, vc: Record<string, number>) => ({
  areaLinkVph: new Map(Object.entries(links)), areaVc: new Map(Object.entries(vc)), areaLinkTime: undefined, junctions: [],
  assignment: { totalVehHours: 1, overCapacityLinks: 0, unroutedVph: 0 }, network: { meanTravelTimeS: 1, meanDelayS: 1, completedTrips: 1, gridlockRemovals: 0 },
}) as unknown as RoadAnalysisResult;
const road = (id: string, name: string) => ({ id, name, type: 'road' }) as unknown as DrivableObject;

describe('comparison road volumes', () => {
  it('sum both directions of a stretch and take the busiest stretch; v/c stays per direction', () => {
    const roads = new Map([['br', road('br', 'Baba Bhide Bridge')], ['kr', road('kr', 'Karve Road')]]);
    const before = res({ br_seg_0_fwd: 1031, br_seg_0_bwd: 756, kr_seg_0_fwd: 500, kr_seg_0_bwd: 400, kr_seg_1_fwd: 700, kr_seg_1_bwd: 100 }, { br_seg_0: 1.68, kr_seg_0: 0.5, kr_seg_1: 0.9 });
    const after = res({ kr_seg_0_fwd: 900, kr_seg_0_bwd: 600, kr_seg_1_fwd: 700, kr_seg_1_bwd: 100 }, { kr_seg_0: 0.8, kr_seg_1: 0.9 });
    const t = comparisonTables(before, after, { before: roads, after: new Map([['kr', roads.get('kr')!]]) });
    const br = t.links.find(l => l.road === 'Baba Bhide Bridge')!;
    expect(br).toMatchObject({ vphBefore: 1787, vphAfter: 0 });
    expect(br.vcBefore).toBeCloseTo(1.68);
    // Karve Road: stretch 0 carries 900 both ways, stretch 1 800; its heaviest single direction (700) is not its volume
    const kr = t.links.find(l => l.road === 'Karve Road')!;
    expect(kr).toMatchObject({ vphBefore: 900, vphAfter: 1500 });
    expect(kr.vcBefore).toBeCloseTo(0.9);
    // Where traffic moved reads the same aggregation
    expect(byRoad(before, roads).get('Baba Bhide Bridge')!.vph).toBe(1787);
  });
});
