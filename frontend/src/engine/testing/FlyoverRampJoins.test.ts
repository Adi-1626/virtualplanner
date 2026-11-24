import { describe, it, expect } from 'vitest';
import { getFlyoverConnectionStatus, rampJoins } from '../objects/flyoverHelper';
import type { TrafficNetwork } from '../objects/trafficTypes';

/**
 * p11 user test (Katraj Chowk flyover): the end ramp was joined to Satara Road, but the connection check took the last
 * node within 6 m (a side lane's) and the inspector could not say which roads the ramps join.
 */
const node = (id: string, c: [number, number, number], inc: string[], out: string[]) => [id, { id, coordinates: c, incomingSegments: inc, outgoingSegments: out }] as const;
const edge = (id: string, roadId: string, from: string, to: string) => [id, { id, roadId, fromNodeId: from, toNodeId: to, coordinates: [], length: 50 }] as const;

function net(): TrafficNetwork {
  return {
    nodes: new Map([
      node('s', [73.8587, 18.4548, 0], ['satN'], ['fly1', 'satS']),
      node('m', [73.8590, 18.4500, 6], ['fly1'], ['fly2']),
      node('e', [73.8591582, 18.4461891, 0], ['fly2', 'satS2'], ['satS3']),
      // a side lane's node 3 m away, listed after the ramp's own node
      node('lane', [73.8591582 + 0.00003, 18.4461891, 0], ['laneIn'], []),
      node('far', [73.86, 18.44, 0], [], ['laneIn']),
    ]),
    edges: new Map([
      edge('fly1', 'fly', 's', 'm'), edge('fly2', 'fly', 'm', 'e'),
      edge('satN', 'satara_n', 'far', 's'), edge('satS', 'satara', 's', 'far'), edge('satS2', 'satara', 'far', 'e'), edge('satS3', 'satara_s', 'e', 'far'),
      edge('laneIn', 'lane6', 'far', 'lane'),
    ]),
  } as unknown as TrafficNetwork;
}
const flyover = { id: 'fly', coordinates: [[73.8587, 18.4548, 0.25], [73.8590, 18.4500, 6], [73.8591582, 18.4461891, 0.25]] };
const names: Record<string, string> = { satara: 'Satara Road', satara_n: 'Satara Road', satara_s: 'Satara Road', lane6: 'Lane Number 6' };

describe('flyover ramp joins', () => {
  it('reports the node the ramp uses, not a side lane node close by', () => {
    const c = getFlyoverConnectionStatus(flyover, net());
    expect(c.connected).toBe(true);
    expect(c.endNodeId).toBe('e');
    expect(c.startNodeId).toBe('s');
  });
  it('names the roads each ramp joins, without the flyover itself', () => {
    const n = net();
    const j = rampJoins('fly', getFlyoverConnectionStatus(flyover, n), n, id => names[id] ?? id);
    expect(j.start).toEqual(['Satara Road']);
    expect(j.end).toEqual(['Satara Road']);
  });
  it('no network yet: nothing joined is claimed', () => {
    expect(rampJoins('fly', {}, null, id => id)).toEqual({ start: [], end: [] });
  });
});
