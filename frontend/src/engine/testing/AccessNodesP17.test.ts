/**
 * p17 (docs/urbanos/CITYWIDE_P16.md §9, R3): access (loading) nodes on long links (simulation/accessNodes.ts).
 *  - a two-way link is split in both directions at one node near the building; a one-way link in its one direction;
 *  - pieces keep the link's lanes, capacity and total length; the link's ends now meet its first / last piece;
 *  - trips load at the access node and route completely (two-way and one-way); free-flow times are unchanged;
 *  - the access node has no junction control, no signal; excluded keys, bridges, slip roads and short links stay whole;
 *  - buildings near a node, or with no road within reach, add nothing; syntheticAreaPlan's outline ignores access nodes.
 */
import { describe, it, expect } from 'vitest';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan, type DemandPlan } from '../simulation/StudyDemand';
import { assignTraffic } from '../simulation/staticAssignment';
import { addAccessNodes, isAccessNode } from '../simulation/accessNodes';

const LAT0 = 18.53;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.85 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, pts: [number, number][], tags: Record<string, string>, oneWay = false, extra: Partial<RoadObject['osmProvenance']> = {}, cls: RoadClassification = 'local'): RoadObject => ({
  id, type: 'road', name: tags.name ?? '', layerId: 'roads', scenarioId: 'base', coordinates: pts.map(p => pt(...p)),
  roadClass: cls, width: 7, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 30, isOneWay: oneWay, trafficCapacity: 1000, connectedJunctions: [], createdAt: '', updatedAt: '',
  osmProvenance: { osmId: Number(id.replace(/\D/g, '')) || 1, osmElementType: 'way', osmSourceId: `way/${id}`, originalTags: tags, layer: 0, bridge: false, tunnel: false, roundabout: false, ...extra },
} as RoadObject);
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);

/** A 600 m street from (0,0) to (600,0), a loop back through (600,300) - (0,300), and cross streets at both ends. */
const grid = (oneWayMain = false, mainTags: Record<string, string> = { highway: 'residential' }, mainExtra = {}) => [
  road('m1', [[0, 0], [300, 0], [600, 0]], mainTags, oneWayMain, mainExtra),
  road('e2', [[600, 0], [600, 300]], { highway: 'residential' }),
  road('n3', [[600, 300], [0, 300]], { highway: 'residential' }),
  road('w4', [[0, 300], [0, 0]], { highway: 'residential' }),
  road('x5', [[0, 0], [-200, 0]], { highway: 'residential' }),
  road('x6', [[600, 0], [800, 0]], { highway: 'residential' }),
];
const build = (roads: RoadObject[]) => {
  const map = new Map(roads.map(r => [r.id, r]));
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['e2'], rangeMeters: 5000, direction: 'both' });
  return { map, area };
};
const house = pt(300, 70); // 70 m off the street's middle, 305+ m from any junction

describe('p17: access nodes on long links', () => {
  it('two-way link: one node near the building, both directions split, lengths and lanes kept', () => {
    const { map, area } = build(grid());
    const before = [...area.network.edges.values()].filter(e => e.roadId === 'm1');
    const a = addAccessNodes(area, map, { points: [house] });
    expect(a.accessNodes).toBe(1);
    const acc = [...a.network.nodes.values()].filter(isAccessNode);
    expect(acc).toHaveLength(1);
    expect(distM(house, acc[0].coordinates)).toBeLessThan(72);
    const after = [...a.network.edges.values()].filter(e => e.roadId === 'm1');
    expect(after).toHaveLength(before.length * 2);
    for (const dir of ['_fwd', '_bwd']) {
      const orig = before.find(e => e.id.endsWith(dir))!;
      const pieces = after.filter(e => e.id.endsWith(dir));
      expect(pieces.reduce((s, e) => s + e.length, 0)).toBeCloseTo(orig.length, 6);
      expect(pieces.every(e => e.lanes === orig.lanes && e.capacity === orig.capacity)).toBe(true);
      // the pieces chain from the link's start to its end through the access node
      const first = pieces.find(e => e.fromNodeId === orig.fromNodeId)!, last = pieces.find(e => e.toNodeId === orig.toNodeId)!;
      expect(first.toNodeId).toBe(acc[0].id);
      expect(last.fromNodeId).toBe(acc[0].id);
      expect(a.network.nodes.get(orig.fromNodeId)!.outgoingSegments).toContain(first.id);
      expect(a.network.nodes.get(orig.fromNodeId)!.outgoingSegments).not.toContain(orig.id);
      expect(a.network.nodes.get(orig.toNodeId)!.incomingSegments).toContain(last.id);
    }
    // the same physical piece has the same segment key in both directions, and the segments list carries it
    const keys = new Set(after.map(e => e.id.replace(/_(fwd|bwd)$/, '')));
    expect(keys.size).toBe(2);
    expect(a.segments.filter(s => s.roadId === 'm1').map(s => s.key).sort()).toEqual([...keys].sort());
    // the input is not changed
    expect([...area.network.nodes.values()].some(isAccessNode)).toBe(false);
  });

  it('trips load at the access node and route completely, free-flow times unchanged, no junction control there', () => {
    const { map, area } = build(grid());
    const a = addAccessNodes(area, map, { points: [house] });
    const plan: DemandPlan = { trips: [{ from: house, to: pt(800, 0), vehiclesPerHour: 300, kind: 'car' }, { from: pt(-200, 0), to: house, vehiclesPerHour: 300, kind: 'car' }],
      provenance: { source: 'synthetic', label: 't', period: 'AM_Peak', vehiclesPerHour: 600, pairCount: 2 } };
    const inc = new Set(a.segments.map(s => s.key));
    const trips = snapDemandPlan(plan, a.network, 250, inc, { preferMainNetwork: true });
    const acc = [...a.network.nodes.values()].find(isAccessNode)!;
    expect(trips[0].fromNodeId).toBe(acc.id);
    expect(trips[1].toNodeId).toBe(acc.id);
    const r = assignTraffic(a, map, trips, { supplyModel: 'p14', signalPoints: [pt(300, 0)], maxIterations: 20 });
    expect(r.unroutedVeh).toBe(0);
    // no control or signal at the access node (two arms), even with a mapped signal point on it
    const atAcc = r.links.filter(l => l.junction && a.network.edges.get(l.id)?.toNodeId === acc.id);
    expect(atAcc).toEqual([]);
    expect(r.links.filter(l => a.network.edges.get(l.id)?.toNodeId === acc.id).every(l => l.stopLinePcu === null)).toBe(true);
    // free-flow time of the whole street is the same split or not
    const z = (ar: typeof area) => assignTraffic(ar, map, [], { supplyModel: 'p14', signalPoints: [], maxIterations: 1 }).links.filter(l => l.roadId === 'm1' && l.id.endsWith('_fwd')).reduce((s, l) => s + l.t0, 0);
    expect(z(a)).toBeCloseTo(z(area), 6);
  });

  it('one-way link: the access node is on its one direction; origins go downstream, destinations come from upstream', () => {
    const { map, area } = build(grid(true));
    const a = addAccessNodes(area, map, { points: [house] });
    expect(a.accessNodes).toBe(1);
    const acc = [...a.network.nodes.values()].find(isAccessNode)!;
    expect(acc.incomingSegments).toHaveLength(1);
    expect(acc.outgoingSegments).toHaveLength(1);
    const plan: DemandPlan = { trips: [{ from: house, to: pt(-200, 0), vehiclesPerHour: 200, kind: 'car' }, { from: pt(800, 0), to: house, vehiclesPerHour: 200, kind: 'car' }],
      provenance: { source: 'synthetic', label: 't', period: 'AM_Peak', vehiclesPerHour: 400, pairCount: 2 } };
    const trips = snapDemandPlan(plan, a.network, 250, new Set(a.segments.map(s => s.key)), { preferMainNetwork: true });
    expect(trips[0].fromNodeId).toBe(acc.id);
    expect(trips[1].toNodeId).toBe(acc.id);
    const r = assignTraffic(a, map, trips, { supplyModel: 'p14', signalPoints: [], maxIterations: 20 });
    expect(r.unroutedVeh).toBe(0);
  });

  it('nothing added: building near a junction, no road within reach, excluded key, bridge, slip road', () => {
    const { map, area } = build(grid());
    expect(addAccessNodes(area, map, { points: [pt(20, 40)] })).toBe(area);
    expect(addAccessNodes(area, map, { points: [pt(300, 150)] })).toBe(area); // 150 m from every road
    const key = area.segments.find(s => s.roadId === 'm1')!.key;
    expect(addAccessNodes(area, map, { points: [house], exclude: new Set([key]) })).toBe(area);
    const b = build(grid(false, { highway: 'residential' }, { bridge: true }));
    expect(addAccessNodes(b.area, b.map, { points: [house] })).toBe(b.area);
    const s = build(grid(false, { highway: 'primary_link' }));
    expect(addAccessNodes(s.area, s.map, { points: [house] })).toBe(s.area);
  });

  it('buildings along a street share nodes only while each stays within reach', () => {
    const { map, area } = build(grid());
    const many = [pt(150, 60), pt(170, 60), pt(400, 90), pt(450, 90)];
    const a = addAccessNodes(area, map, { points: many });
    const acc = [...a.network.nodes.values()].filter(isAccessNode);
    for (const p of many) expect(Math.min(...acc.map(n => distM(p, n.coordinates)))).toBeLessThanOrEqual(95.5);
    expect(acc.length).toBeLessThanOrEqual(3);
  });
});
