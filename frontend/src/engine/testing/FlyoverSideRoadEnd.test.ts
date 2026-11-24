import { describe, it, expect } from 'vitest';
import type { RoadObject } from '../objects/types';
import { TrafficNetworkBuilder } from '../simulation/TrafficNetworkBuilder';

/**
 * p11 user test, Katraj Chowk flyover: a side lane (Khashaba Jadhav Path) ends on Satara Road 0.6 m inside the line of a
 * flyover drawn along Satara Road. The drawing rightly does not flag it as a crossing (it is the lane's own end, on the
 * road below), but the network builder joined the lane to the ramp at ~1 m height, so ~700 veh/h used the lane to get
 * on and off the flyover mid-ramp.
 */
const base = { layerId: 'roads', scenarioId: 'base', width: 7, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, connectedJunctions: [], createdAt: '', updatedAt: '' };
const road = (id: string, coordinates: [number, number, number][], extra: Partial<RoadObject> = {}): RoadObject =>
  ({ ...base, id, type: 'road', name: id, coordinates, roadClass: 'arterial', laneCount: 2, speedLimit: 50, isOneWay: false, trafficCapacity: 2000, ...extra } as RoadObject);

function scene(laneEndOffsetDeg: number) {
  // Ground road N-S, flyover drawn along it from y=18.4548 to y=18.4462 (ramps 0 → 6 m over 165 m)
  const ground = road('satara', [[73.8587, 18.4560, 0], [73.8587, 18.4542, 0], [73.8587, 18.4450, 0]]);
  const fly = { ...road('fly', [[73.8587, 18.4548, 0.25], [73.8587, 18.4542, 1.1], [73.8587, 18.4520, 4], [73.8587, 18.4500, 6], [73.8587, 18.4470, 3], [73.8587, 18.4462, 0.25]], { isOneWay: true }), type: 'flyover', elevation: 6, pierSpacing: 30 } as unknown as RoadObject;
  // The lane ends on the ground road at y=18.4542, crossing the flyover line by laneEndOffsetDeg
  const lane = road('lane', [[73.8587 + laneEndOffsetDeg, 18.4542, 0], [73.8537, 18.4542, 0]]);
  return new TrafficNetworkBuilder().build([ground, fly, lane]).network;
}
const nodesJoining = (net: ReturnType<typeof scene>, a: string, b: string) => [...net.nodes.values()].filter(n => {
  const roads = new Set([...n.incomingSegments, ...n.outgoingSegments].map(id => net.edges.get(id)?.roadId));
  return roads.has(a) && roads.has(b);
});

describe('drawn flyover over the end of a side road', () => {
  it('a side road ending (within 1 m) under the ramp line is not joined to the ramp', () => {
    const net = scene(0.0000057); // lane end 0.6 m east of the line, so its first segment (going west) crosses it
    expect(nodesJoining(net, 'lane', 'fly')).toHaveLength(0);
    expect(nodesJoining(net, 'lane', 'satara').length).toBeGreaterThan(0);
  });
  it('the flyover still joins the ground road at its two ends', () => {
    const net = scene(0.0000057);
    expect(nodesJoining(net, 'fly', 'satara').length).toBeGreaterThanOrEqual(2);
  });
});
