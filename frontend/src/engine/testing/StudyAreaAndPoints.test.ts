import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cesium from 'cesium';
import { junctionPointKind, TrafficNetworkVisualizer } from '../rendering/renderers/TrafficNetworkVisualizer';
import { summariseStudyArea, polygonAreaKm2 } from '../editing/studyAreaSummary';
import { areaFromBoundary } from '../editing/studyAreaImport';
import { OverpassClient } from '../editing/OverpassClient';
import { LayerManager } from '../layers/LayerManager';
import type { TrafficEdge, TrafficNode } from '../objects/trafficTypes';

// A small network: node c is a T where road B ends at the middle of road A (A is two segments a–c, c–d)
const node = (id: string, segs: string[]): TrafficNode => ({ id, coordinates: [73.8, 18.5, 0], incomingSegments: segs, outgoingSegments: [], hasSignals: false, allowedMovements: [] });
const edge = (id: string, roadId: string, from: string, to: string): TrafficEdge => ({ id, roadId, fromNodeId: from, toNodeId: to, coordinates: [], length: 1, lanes: 1, direction: 'forward', speedLimit: 30, capacity: 100 });
const edges = new Map<string, TrafficEdge>([
  ['A_seg_0_fwd', edge('A_seg_0_fwd', 'A', 'a', 'c')],
  ['A_seg_1_fwd', edge('A_seg_1_fwd', 'A', 'c', 'd')],
  ['B_seg_0_fwd', edge('B_seg_0_fwd', 'B', 'b', 'c')],
  ['B_seg_0_bwd', edge('B_seg_0_bwd', 'B', 'c', 'b')],
]);

describe('Junction points layer', () => {
  it('classifies by arms, so a side road joining mid-road is a T; plain link nodes get no point', () => {
    expect(junctionPointKind(node('c', ['A_seg_0_fwd', 'A_seg_1_fwd', 'B_seg_0_fwd', 'B_seg_0_bwd']), edges)).toBe('t_junction');
    expect(junctionPointKind(node('a', ['A_seg_0_fwd']), edges)).toBe('dead_end');
    // two pieces end to end: a link, not a junction
    const link = new Map([['P_seg_0_fwd', edge('P_seg_0_fwd', 'P', 'x', 'm')], ['Q_seg_0_fwd', edge('Q_seg_0_fwd', 'Q', 'm', 'y')]]);
    expect(junctionPointKind(node('m', ['P_seg_0_fwd', 'Q_seg_0_fwd']), link)).toBeNull();
    // a roundabout entry (3 arms, one road is a roundabout) vs a plain ring vertex (2 arms)
    expect(junctionPointKind(node('c', ['A_seg_0_fwd', 'A_seg_1_fwd', 'B_seg_0_fwd']), edges, id => id === 'A')).toBe('roundabout');
    expect(junctionPointKind(node('m', ['P_seg_0_fwd', 'Q_seg_0_fwd']), link, () => true)).toBeNull();
  });

  it('creates one point collection when on and destroys it when off (nothing is created while off)', () => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const viewer: any = { isDestroyed: () => false, scene: { requestRender: vi.fn(), primitives: { add: (p: unknown) => { added.push(p); return p; }, remove: (p: unknown) => { removed.push(p); return true; } } } };
    vi.mocked(cesium.PointPrimitiveCollection).mockImplementation(function (this: any) { this.add = vi.fn(); this.length = 0; } as any);
    const vis = new TrafficNetworkVisualizer();
    vis.setViewer(viewer);
    const nodes = new Map([['c', node('c', ['A_seg_0_fwd', 'A_seg_1_fwd', 'B_seg_0_fwd'])], ['a', node('a', ['A_seg_0_fwd'])], ['d', node('d', ['A_seg_1_fwd'])], ['b', node('b', ['B_seg_0_fwd'])]]);
    vis.render({ nodes, edges });
    expect(added).toHaveLength(1);           // a single primitive, not an entity per node
    expect(vis.pointCount).toBe(4);           // T + three dead ends
    vis.clear();
    expect(removed).toHaveLength(1);
    expect(vis.pointCount).toBe(0);
  });

  it('is off by default and the choice is remembered on this device', () => {
    localStorage.removeItem('urbanos.layer.traffic_network_debug.visible');
    const a = new LayerManager();
    expect(a.isVisible('traffic_network_debug')).toBe(false);
    expect(a.get('traffic_network_debug')!.name).toBe('Junction points');
    a.setVisibility('traffic_network_debug', true);
    expect(new LayerManager().isVisible('traffic_network_debug')).toBe(true);
    a.setVisibility('traffic_network_debug', false);
    expect(new LayerManager().isVisible('traffic_network_debug')).toBe(false);
    localStorage.removeItem('urbanos.layer.traffic_network_debug.visible');
  });
});

describe('Study area summary', () => {
  // ~1.06 km x 1.11 km box at Swargate
  const area = areaFromBoundary('area_t', 'Swargate', [[73.855, 18.495, 0], [73.865, 18.495, 0], [73.865, 18.505, 0], [73.855, 18.505, 0]]);
  const road = (id: string, coords: number[][], tags: Record<string, string> = { highway: 'primary' }, extra: object = {}) =>
    ({ id, type: 'road', coordinates: coords.map(c => [c[0], c[1], 0]), roadClass: 'arterial', osmProvenance: { osmId: 1, originalTags: tags, layer: 0, bridge: false, tunnel: false, roundabout: false }, ...extra }) as any;

  it('counts road km inside (cut at the edge), derived junctions, buildings, metro and signals', () => {
    const objects = [
      road('r1', [[73.850, 18.500], [73.860, 18.500], [73.870, 18.500]], { highway: 'primary', lanes: '4' }),          // crosses the box E–W: ~1.05 km inside
      road('r2', [[73.860, 18.495], [73.860, 18.500]], { highway: 'residential' }), // ends at r1's middle vertex: a T
      road('r3', [[73.860, 18.500], [73.860, 18.504]], { highway: 'residential' }), // continues north: now an X (4 arms)
      road('far', [[73.900, 18.600], [73.901, 18.601]]),
      { id: 'b1', type: 'building', coordinates: [[73.857, 18.497, 0], [73.858, 18.497, 0], [73.858, 18.498, 0], [73.857, 18.497, 0]] },
      { id: 'b2', type: 'building', coordinates: [[73.950, 18.497, 0], [73.951, 18.497, 0], [73.951, 18.498, 0], [73.950, 18.497, 0]] },
      { id: 'm1', type: 'metro_line', coordinates: [[73.856, 18.490, 12], [73.856, 18.510, 12]] },
      { id: 's1', type: 'metro_station', coordinates: [73.856, 18.501, 12] },
    ] as any[];
    const s = summariseStudyArea(area, objects, [[73.860, 18.500], [73.99, 18.0]]);
    expect(s.roads).toBe(3);
    expect(s.roadKm).toBeGreaterThan(1.95);
    expect(s.roadKm).toBeLessThan(2.15);    // 1.06 (r1 inside the box) + 0.56 + 0.44
    expect(s.roadKmByClass[0].cls).toBe('primary');
    expect(s.junctions).toBe(1);
    expect(s.buildings).toBe(1);
    expect(s.metroStations).toBe(1);
    expect(s.metroKm).toBeGreaterThan(1.0);
    expect(s.metroKm).toBeLessThan(1.2);
    expect(s.signals).toBe(1);
    expect(s.lanesTaggedPct).toBe(51);       // only r1 (1.06 of 2.06 km) has a lanes tag: the rest is estimated
    expect(s.maxspeedTaggedPct).toBe(0);
    expect(s.areaKm2).toBeGreaterThan(1.1);
    expect(s.areaKm2).toBeLessThan(1.25);
  });

  it('does not invent a signal count before the data was loaded', () => {
    expect(summariseStudyArea(area, []).signals).toBeNull();
    expect(polygonAreaKm2([[0, 0], [1, 0]])).toBe(0);
  });
});

describe('Overpass client with the backend proxy', () => {
  const noSleep = () => Promise.resolve();
  beforeEach(() => vi.restoreAllMocks());

  it('uses the backend proxy first and labels a cached answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ elements: [1] }), { status: 200, headers: { 'X-Overpass-Cache': 'hit', 'X-Overpass-Fetched-At': '2026-11-15T08:00:00+00:00' } }));
    const c = new OverpassClient({ endpoints: ['http://api.test/api/osm/overpass', 'https://a.test/x'], proxyEndpoints: ['http://api.test/api/osm/overpass'], fetchImpl, sleep: noSleep });
    expect(await c.query('[out:json];')).toEqual({ elements: [1] });
    expect(c.lastAnswer).toMatchObject({ via: 'backend', cache: 'hit' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not repeat against the public mirrors what the proxy already tried', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ detail: { upstream: true, message: 'No Overpass server answered: a: busy' } }), { status: 502 }));
    const c = new OverpassClient({ endpoints: ['http://api.test/api/osm/overpass', 'https://a.test/x'], proxyEndpoints: ['http://api.test/api/osm/overpass'], fetchImpl, sleep: noSleep });
    await expect(c.query('[out:json];')).rejects.toThrow(/Overpass\) is unavailable/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the public servers when the backend is unreachable', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [2] }), { status: 200 }));
    const c = new OverpassClient({ endpoints: ['http://api.test/api/osm/overpass', 'https://a.test/x'], proxyEndpoints: ['http://api.test/api/osm/overpass'], fetchImpl, sleep: noSleep });
    expect(await c.query('[out:json];')).toEqual({ elements: [2] });
    expect(c.lastAnswer).toMatchObject({ via: 'direct', host: 'a.test' });
  });
});
