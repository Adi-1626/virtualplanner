import { describe, it, expect } from 'vitest';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer, type StudyArea } from '../simulation/StudyAreaExplorer';
import { TrafficMicroSim, STEP_S, OD_REFERENCE_LEVEL, type MicroDemandTrip } from '../simulation/TrafficMicroSim';

/**
 * The neighbourhood's mean speed agrees with its trip times (p11 user test, S2 Bhide closure: "Mean speed in the
 * neighbourhood 2.4 km/h" beside a mean trip time of 216 s). The figure was a snapshot of the vehicles on the network
 * at the end of the run (mostly standing in queues), taken from the first seed only. It is now the completed trips'
 * distance over their time, the same trips as the trip time.
 */
const LAT0 = 18.5;
const pt = (x: number, y: number): [number, number, number] => [73.8 + x / (111320 * Math.cos(LAT0 * Math.PI / 180)), LAT0 + y / 111320, 0];
const road = (id: string, a: [number, number], b: [number, number], cls: RoadClassification): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [pt(...a), pt(...b)], roadClass: cls, width: 10, laneCount: 2, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40, isOneWay: false, trafficCapacity: 1000, connectedJunctions: [], createdAt: '', updatedAt: '',
});
const nodeAt = (area: StudyArea, x: number, y: number) => {
  const [lng, lat] = pt(x, y);
  let best = '', bd = Infinity;
  area.network.nodes.forEach(n => { const d = Math.hypot(n.coordinates[0] - lng, n.coordinates[1] - lat); if (d < bd) { bd = d; best = n.id; } });
  return best;
};

function run(vph: number) {
  const roads = [road('w', [-800, 0], [0, 0], 'arterial'), road('e', [0, 0], [800, 0], 'arterial'), road('n', [0, 0], [0, 400], 'collector'), road('s', [0, 0], [0, -400], 'collector')];
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['w'], rangeMeters: 1200, direction: 'both' });
  const W = nodeAt(area, -800, 0), E = nodeAt(area, 800, 0), N = nodeAt(area, 0, 400), S = nodeAt(area, 0, -400);
  const trips: MicroDemandTrip[] = [{ fromNodeId: W, toNodeId: E, vehiclesPerHour: vph, kind: 'car' }, { fromNodeId: N, toNodeId: S, vehiclesPerHour: vph / 2, kind: 'car' }];
  const sim = new TrafficMicroSim(area, new Map(roads.map(r => [r.id, r])), { demandLevel: OD_REFERENCE_LEVEL, seed: 7, demandTrips: trips, removeStuckVehicles: false, signalPoints: [[pt(0, 0)[0], pt(0, 0)[1]]] });
  for (let i = 0; i < 900 / STEP_S; i++) sim.step();
  return sim.getMetrics();
}

describe('neighbourhood mean speed = completed trips\' distance over their time', () => {
  for (const vph of [300, 2400]) {
    it(`${vph} veh/h through a signal: speed × trip time ≈ the trips' length (1.6 km and 0.8 km), not a queue snapshot`, () => {
      const m = run(vph);
      expect(m.completedTrips).toBeGreaterThan(20);
      expect(m.tripSpeedKmh).not.toBeNull();
      // Two thirds of the trips are 1,600 m, a third 800 m: mean length about 1,333 m (± queueing order)
      const impliedLengthM = m.tripSpeedKmh! / 3.6 * m.meanTravelTimeS!;
      expect(impliedLengthM).toBeGreaterThan(700);
      expect(impliedLengthM).toBeLessThan(1700);
      expect(m.tripSpeedKmh!).toBeLessThanOrEqual(40 * 1.1);
      if (vph > 1000) expect(m.tripSpeedKmh!).toBeGreaterThan(m.meanSpeedKmh ?? 0);
    });
  }
});
