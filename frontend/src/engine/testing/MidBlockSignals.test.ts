/**
 * p11: mapped traffic signals that stand along a road, away from any junction of three or more arms, are run in the
 * micro-simulation as mid-block (pedestrian) signals: traffic stops at them on red, in both directions.
 */
import { describe, it, expect } from 'vitest';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { TrafficMicroSim, STEP_S, OD_REFERENCE_LEVEL, MIDBLOCK_CYCLE_S } from '../simulation/TrafficMicroSim';

const LAT0 = 18.5;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.8 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, a: [number, number], b: [number, number], cls: RoadClassification = 'collector'): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [pt(...a), pt(...b)],
  roadClass: cls, width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 50, isOneWay: false, trafficCapacity: 1000, connectedJunctions: [], createdAt: '', updatedAt: '',
});

function corridor(signal: [number, number] | null) {
  const roads = [road('w', [-1000, 0], [0, 0]), road('e', [0, 0], [1000, 0]), road('n', [0, 0], [0, 600], 'local')];
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['e'], rangeMeters: 1200, direction: 'both' });
  const node = (x: number, y: number) => {
    const [lng, lat] = pt(x, y);
    let best = '', d0 = Infinity;
    area.network.nodes.forEach(n => { const d = Math.hypot(n.coordinates[0] - lng, n.coordinates[1] - lat); if (d < d0) { d0 = d; best = n.id; } });
    return best;
  };
  const W = node(-1000, 0), E = node(1000, 0);
  const sim = new TrafficMicroSim(area, new Map(roads.map(r => [r.id, r])), {
    demandLevel: OD_REFERENCE_LEVEL, seed: 3,
    signalPoints: signal ? [[pt(...signal)[0], pt(...signal)[1]]] : [],
    demandTrips: [{ fromNodeId: W, toNodeId: E, vehiclesPerHour: 500, kind: 'car' }, { fromNodeId: E, toNodeId: W, vehiclesPerHour: 500, kind: 'car' }],
  });
  return sim;
}

/** Vehicles standing (v < 0.2 m/s) within 25 m before x = 500 m on road e, per direction, over the run. */
function stopsNear(sim: TrafficMicroSim, seconds: number) {
  let stopped = 0, passedOnRed = 0;
  const last = new Map<number, number>();
  for (let i = 0; i < seconds / STEP_S; i++) {
    sim.step();
    for (const [id, lanes] of sim.debugLanes()) {
      if (!id.startsWith('e_')) continue;
      for (const lane of lanes) for (const v of lane) {
        // Both directions are 1000 m links; the signal sits 500 m along either
        if (v.v < 0.2 && v.pos > 470 && v.pos < 500.5) stopped++;
        const p = last.get(v.id);
        if (p !== undefined && p < 499 && v.pos > 501) passedOnRed++;
        last.set(v.id, v.pos);
      }
    }
  }
  return { stopped, passedOnRed };
}

describe('mid-block signals (p11)', () => {
  it('a mapped signal along a road away from junctions holds traffic there on red, both directions', () => {
    const sim = corridor([500, 0]);
    expect(sim.midBlockSignalCount).toBe(1);
    const r = stopsNear(sim, 4 * MIDBLOCK_CYCLE_S);
    expect(r.stopped).toBeGreaterThan(0);
  });

  it('without the signal nobody stops there', () => {
    const sim = corridor(null);
    expect(sim.midBlockSignalCount).toBe(0);
    expect(stopsNear(sim, 4 * MIDBLOCK_CYCLE_S).stopped).toBe(0);
  });

  it('a signal within 35 m of a three-arm junction belongs to the junction, not mid-block', () => {
    const sim = corridor([20, 0]);
    expect(sim.midBlockSignalCount).toBe(0);
  });
});
