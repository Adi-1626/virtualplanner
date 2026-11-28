/**
 * p20 fix H (NODE_TURNS): turn-taking for room also at a node without a junction control (a two-arm node where one
 * road continues as another). A vehicle that has waited longer than MERGE_TURN_S for room in a lane of the exit is
 * owed that lane: the other lane of its own approach does not take the room (docs/urbanos/P20_COMBO.md).
 */
import { describe, it, expect } from 'vitest';
import type { RoadObject } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { TrafficMicroSim, NODE_TURNS, ZIP_MERGE, OD_REFERENCE_LEVEL } from '../simulation/TrafficMicroSim';

const LAT0 = 18.5;
const pt = (x: number, y: number): [number, number, number] => [73.8 + x / (111320 * Math.cos(LAT0 * Math.PI / 180)), LAT0 + y / 111320, 0];
const road = (id: string, a: [number, number], b: [number, number]): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [pt(...a), pt(...b)], roadClass: 'collector', width: 14, laneCount: 4, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40, isOneWay: false, trafficCapacity: 1000, connectedJunctions: [], createdAt: '', updatedAt: '',
});

describe('NODE_TURNS (p20 fix H)', () => {
  it('owes the exit lane to the longer-waiting vehicle at a node without a junction control', () => {
    const roads = [road('a', [-200, 0], [0, 0]), road('b', [0, 0], [200, 0])];
    const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['a'], rangeMeters: 500, direction: 'both' });
    const sim = new TrafficMicroSim(area, new Map(roads.map(r => [r.id, r])), { demandLevel: OD_REFERENCE_LEVEL, seed: 1, demandTrips: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = sim as any;
    const into = s.links.find((l: { roadId: string; to: string; lanes: unknown[] }) => l.roadId === 'a' && l.lanes.length === 2 && s.links.some((m: { roadId: string; from: string }) => m.roadId === 'b' && m.from === l.to));
    expect(into).toBeTruthy();
    const out = s.links.find((m: { roadId: string; from: string }) => m.roadId === 'b' && m.from === into.to);
    expect(s.controls.get(into.to)).toBeUndefined(); // a two-arm node: no junction control
    const truck = { waitS: 120, hold: 'room-wait', holdNext: out.index, grantLane: null, lane: 0, link: into.index, v: 0 };
    const car = { waitS: 2, hold: null, holdNext: undefined, grantLane: null, lane: 1, link: into.index, v: 0, routeIdx: 0, route: [into.index, out.index] };
    into.lanes[0].push(truck); into.lanes[1].push(car);
    const on = NODE_TURNS.enabled, zip = ZIP_MERGE.enabled;
    try {
      ZIP_MERGE.enabled = true;
      NODE_TURNS.enabled = false;
      expect(s.heldFor(out, 0, car)).toBe(false); // before: nothing owed at an uncontrolled node
      NODE_TURNS.enabled = true;
      expect(s.heldFor(out, 0, car)).toBe(true); // the truck's lane is its turn
      expect(s.heldFor(out, 1, car)).toBe(false); // the car's own lane is not owed to the truck (mapped lanes, 'room-wait')
    } finally { NODE_TURNS.enabled = on; ZIP_MERGE.enabled = zip; }
  });
});
