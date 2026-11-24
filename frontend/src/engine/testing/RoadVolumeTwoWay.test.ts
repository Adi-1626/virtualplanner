import { describe, it, expect } from 'vitest';
import type { RoadAnalysisResult } from '../simulation/RoadAnalysis';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { comparisonTables, byRoad } from '../simulation/comparisonTables';

/**
 * A road's volume in the comparison is its busiest stretch in each direction of travel, added: the way 'Traffic routed
 * along it' counts the studied road. The heaviest single direction listed the closed Baba Bhide Bridge (1,031 veh/h
 * south-east, 756 north-west) as 1,031 veh/h in the road table and '−1,031 veh/h' in Where traffic moved, beside
 * 'Traffic routed along it 1,787 veh/h' for the same bridge (p11 user test). A divided road (Sinhagad Road) is two
 * one-way roads of one name, so the direction is read from the link's bearing.
 */
const res = (links: Record<string, number>, vc: Record<string, number>) => ({
  areaLinkVph: new Map(Object.entries(links)), areaVc: new Map(Object.entries(vc)), areaLinkTime: undefined, junctions: [],
  assignment: { totalVehHours: 1, overCapacityLinks: 0, unroutedVph: 0 }, network: { meanTravelTimeS: 1, meanDelayS: 1, completedTrips: 1, gridlockRemovals: 0 },
}) as unknown as RoadAnalysisResult;
const road = (id: string, name: string, coordinates?: [number, number, number][]) => ({ id, name, type: 'road', ...(coordinates ? { coordinates } : {}) }) as unknown as DrivableObject;

describe('comparison road volumes', () => {
  it('add the busiest stretch of each direction; v/c stays the busiest stretch in one direction', () => {
    const roads = new Map([['br', road('br', 'Baba Bhide Bridge')], ['kr', road('kr', 'Karve Road')]]);
    const before = res({ br_seg_0_fwd: 1031, br_seg_0_bwd: 756, kr_seg_0_fwd: 500, kr_seg_0_bwd: 400, kr_seg_1_fwd: 700, kr_seg_1_bwd: 100 }, { br_seg_0: 1.68, kr_seg_0: 0.5, kr_seg_1: 0.9 });
    const after = res({ kr_seg_0_fwd: 900, kr_seg_0_bwd: 600, kr_seg_1_fwd: 700, kr_seg_1_bwd: 100 }, { kr_seg_0: 0.8, kr_seg_1: 0.9 });
    const t = comparisonTables(before, after, { before: roads, after: new Map([['kr', roads.get('kr')!]]) });
    const br = t.links.find(l => l.road === 'Baba Bhide Bridge')!;
    expect(br).toMatchObject({ vphBefore: 1787, vphAfter: 0 });
    expect(br.vcBefore).toBeCloseTo(1.68);
    // Karve Road: busiest one way 700 (stretch 1), the other way 400 (stretch 0); its heaviest single direction (700) is not its volume
    const kr = t.links.find(l => l.road === 'Karve Road')!;
    expect(kr).toMatchObject({ vphBefore: 1100, vphAfter: 1500 });
    expect(kr.vcBefore).toBeCloseTo(0.9);
    // Where traffic moved reads the same aggregation
    expect(byRoad(before, roads).get('Baba Bhide Bridge')!.vph).toBe(1787);
  });

  it('adds both carriageways of a divided road (one-way roads of one name, drawn in opposite directions)', () => {
    const ne = road('ne', 'Sinhagad Road', [[73.830, 18.490, 0], [73.840, 18.497, 0]]);
    const ne2 = road('ne2', 'Sinhagad Road', [[73.840, 18.497, 0], [73.845, 18.500, 0]]);
    const sw = road('sw', 'Sinhagad Road', [[73.8451, 18.5001, 0], [73.8301, 18.4901, 0]]);
    const roads = new Map([['ne', ne], ['ne2', ne2], ['sw', sw]]);
    const r = res({ ne_seg_0_fwd: 3000, ne2_seg_0_fwd: 3400, sw_seg_0_fwd: 2900 }, { ne_seg_0: 1.1, ne2_seg_0: 1.3, sw_seg_0: 1.2 });
    const agg = byRoad(r, roads).get('Sinhagad Road')!;
    expect(agg.vph).toBe(3400 + 2900);
    expect(agg.vc).toBeCloseTo(1.3);
  });

  it('reads the direction from the other side when a restored baseline kept its roads without their lines', () => {
    const geo = new Map([
      ['ne', road('ne', 'Karve Road', [[73.830, 18.490, 0], [73.840, 18.497, 0]])],
      ['sw', road('sw', 'Karve Road', [[73.8401, 18.4971, 0], [73.8301, 18.4901, 0]])],
    ]);
    const bare = new Map([['ne', road('ne', 'Karve Road')], ['sw', road('sw', 'Karve Road')]]);
    const r = res({ ne_seg_0_fwd: 4427, sw_seg_0_fwd: 4000 }, { ne_seg_0: 2.5, sw_seg_0: 2.4 });
    // Without lines on either side both one-way pieces read as one direction (the busier one only)
    expect(byRoad(r, bare).get('Karve Road')!.vph).toBe(4427);
    expect(byRoad(r, bare, geo).get('Karve Road')!.vph).toBe(8427);
    expect(byRoad(r, geo).get('Karve Road')!.vph).toBe(8427);
  });
});
