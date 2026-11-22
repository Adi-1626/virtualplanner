/**
 * Reshape commit pipeline (GEOMETRY_EDITOR_DESIGN.md §3.4, §6, §8 integration, phase 2 agent D): everything downstream of
 * a reshaped alignment stays correct — network joins and crossings, Undo of the object and the roads it split, road
 * sections, tunnel / utility depth controls at PIs with per-vertex depths derived, flyover ground line + legacy 40 m
 * ramps, and level-crossing decisions carried by distance.
 */
import { describe, it, expect } from 'vitest';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { TrafficNetworkBuilder } from '../simulation/TrafficNetworkBuilder';
import { commitGeometry, regenerateGeometry } from '../editing/geometryCommit';
import { densifyAlignment } from '../geometry/alignment/densify';
import { chainagesOf } from '../geometry/alignment/stationing';
import { defaultAlignmentSettings } from '../geometry/alignment/defaults';
import type { HorizontalAlignment } from '../geometry/alignment/types';
import { planDistM, carryCrossingDecisions, type LevelCrossing } from '../editing/levelCrossings';
import { withControlDepth, alignmentDepthControls } from '../underground/alignmentFactory';
import { utilityDepthControls, utilitySummary, withUtilityControlDepth, withUtilityZ } from '../underground/utilityModel';
import { applyFlyoverElevationProfile } from '../objects/flyoverHelper';
import type { FlyoverObject, RoadObject, UndergroundAlignmentObject, UtilityObject } from '../objects/types';

type P = [number, number, number];
const T = '2026-11-21T00:00:00.000Z';

const road = (id: string, coords: P[], extra: Partial<RoadObject> = {}): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: coords, roadClass: 'local', width: 10, laneCount: 2,
  laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40, isOneWay: false,
  trafficCapacity: 1000, connectedJunctions: [], createdAt: T, updatedAt: T, ...extra,
});

const align = (pts: [number, number][], r: number, type: 'road' | 'flyover' | 'underground_alignment' | 'utility' = 'road'): HorizontalAlignment => {
  const s = defaultAlignmentSettings({ type, roadClass: 'local', alignmentKind: 'bored_tunnel' });
  const behaviour = type === 'utility' ? 'angled' : s.behaviour;
  return { v: 1, ...s, behaviour, pis: pts.map(([lon, lat], i) => ({ lon, lat, radiusM: i === 0 || i === pts.length - 1 || behaviour === 'angled' ? 0 : r })) };
};
const lineOf = (a: HorizontalAlignment): P[] => densifyAlignment(a).coordinates.map(c => [c[0], c[1], 0]);

const setup = () => {
  const objects = new ObjectManager();
  const history = new HistoryManager(objects);
  const editing = new EditingEngine(objects, history);
  return { objects, history, editing, ctx: { objects, history, editing, scenarioId: 'base' } };
};

// Two ground roads the new road crosses (north–south), and the new road's PIs (a peak between them)
const CROSS_A: P[] = [[73.801, 18.4990, 0], [73.801, 18.5030, 0]];
const CROSS_B: P[] = [[73.803, 18.4990, 0], [73.803, 18.5030, 0]];
const PIS: [number, number][] = [[73.800, 18.5000], [73.802, 18.5020], [73.804, 18.5000]];

describe('commitGeometry: roads', () => {
  it('regenerates a curved road, re-inserts crossings on both roads, keeps the junction count and undoes as one step', () => {
    const { objects, history, ctx } = setup();
    objects.add(road('A', CROSS_A), true);
    objects.add(road('B', CROSS_B), true);
    const sharp = align(PIS, 0);
    objects.add(road('N', lineOf(sharp), { alignment: sharp }), true);
    const before = { A: objects.getById('A')!, B: objects.getById('B')!, N: objects.getById('N')! };

    const curved = align(PIS, 60);
    const res = commitGeometry(objects.getById('N')!, curved, ctx);
    expect(res.ok).toBe(true);
    const n = objects.getById('N') as RoadObject;
    expect(n.alignment!.pis[1].radiusM).toBe(60);
    expect(n.coordinates.length).toBeGreaterThan(densifyAlignment(sharp).coordinates.length);
    // The new line crosses A and B: each gets a vertex shared with N
    for (const id of ['A', 'B']) {
      const o = objects.getById(id) as RoadObject;
      expect(o.coordinates.length).toBe(3);
      expect(o.coordinates.some(c => n.coordinates.some(q => q[0] === c[0] && q[1] === c[1]))).toBe(true);
    }
    // Sections still cover every vertex of the regenerated line
    const secs = n.sections!;
    expect(secs[0].startNodeIndex).toBe(0);
    expect(secs[secs.length - 1].endNodeIndex).toBe(n.coordinates.length - 1);

    // Graph: the curve adds shape points only — same nodes as the same PIs drawn sharp (and committed the same way)
    const builder = new TrafficNetworkBuilder();
    const curvedNet = builder.build(objects.getAll()).network;
    const s2 = setup();
    s2.objects.add(road('A', CROSS_A), true);
    s2.objects.add(road('B', CROSS_B), true);
    s2.objects.add(road('N', lineOf(sharp), { alignment: sharp }), true);
    commitGeometry(s2.objects.getById('N')!, sharp, s2.ctx);
    const sharpNet = builder.build(s2.objects.getAll()).network;
    expect(curvedNet.nodes.size).toBe(sharpNet.nodes.size);

    // One Undo step restores N and both crossed roads
    history.undo();
    expect(objects.getById('N')!.coordinates).toEqual(before.N.coordinates);
    expect((objects.getById('N') as RoadObject).alignment!.pis[1].radiusM).toBe(0);
    expect(objects.getById('A')!.coordinates).toEqual(before.A.coordinates);
    expect(objects.getById('B')!.coordinates).toEqual(before.B.coordinates);
    history.redo();
    expect((objects.getById('N') as RoadObject).alignment!.pis[1].radiusM).toBe(60);
  });

  it('graph edge length follows the arc-based polyline (±0.5 %)', () => {
    const { objects, ctx } = setup();
    const curved = align(PIS, 80);
    objects.add(road('N', lineOf(curved), { alignment: curved }), true);
    commitGeometry(objects.getById('N')!, curved, ctx);
    const n = objects.getById('N') as RoadObject;
    const net = new TrafficNetworkBuilder().build(objects.getAll()).network;
    const total = [...net.edges.values()].filter(e => e.roadId === 'N').reduce((s, e) => s + e.length, 0);
    const polyLen = chainagesOf(n.coordinates).at(-1)!;
    // One edge chain per direction of travel: total = k × polyline length (k = 1 or 2), within 0.5 %
    const k = Math.round(total / polyLen);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(Math.abs(total / k - polyLen) / polyLen).toBeLessThan(0.005);
    // and the arc made it longer than the PI chord path minus the cut corner, shorter than the sharp corner path
    const sharpLen = chainagesOf(lineOf(align(PIS, 0))).at(-1)!;
    expect(polyLen).toBeLessThan(sharpLen);
  });

  it('refuses an OSM-imported road and an invalid (U-turn) alignment, changing nothing', () => {
    const { objects, ctx } = setup();
    objects.add(road('osm_1', [[73.8, 18.5, 0], [73.81, 18.5, 0]]), true);
    const r1 = commitGeometry(objects.getById('osm_1')!, align([[73.8, 18.5], [73.81, 18.5]], 0), ctx);
    expect(r1.ok).toBe(false);
    expect(r1.error).toBe('locked');
    const a = align([[73.8, 18.5], [73.81, 18.5], [73.8, 18.5000001]], 0);
    objects.add(road('N', [[73.8, 18.5, 0], [73.81, 18.5, 0]]), true);
    const r2 = commitGeometry(objects.getById('N')!, a, ctx);
    expect(r2.ok).toBe(false);
    expect(objects.getById('N')!.coordinates).toHaveLength(2);
  });
});

describe('commitGeometry: crossing vertices left in other roads', () => {
  // N first crosses A and B; reshaped, it still crosses A (elsewhere) but no longer reaches B
  const AWAY: [number, number][] = [[73.800, 18.5000], [73.8015, 18.5020], [73.8025, 18.5000]];

  it('a drawn road records the vertices it put into the roads it crosses (never their own vertices)', () => {
    const { objects, editing } = setup();
    objects.add(road('A', CROSS_A), true);
    objects.add(road('B', CROSS_B), true);
    editing.setMode('draw_road');
    for (const [lon, lat] of PIS) editing.addDrawingPoint([lon, lat, 0]);
    editing.finalizeDrawing('base');
    const n = objects.getAll().find(o => o.type === 'road' && o.id !== 'A' && o.id !== 'B') as RoadObject;
    const rec = n.addedNetworkVertices!;
    expect(rec.map(v => v.roadId).sort()).toEqual(['A', 'B']);
    for (const v of rec) {
      const other = objects.getById(v.roadId) as RoadObject;
      expect(other.coordinates).toHaveLength(3);
      expect(other.coordinates[1].slice(0, 2)).toEqual(v.point);
      expect((v.roadId === 'A' ? CROSS_A : CROSS_B).some(c => c[0] === v.point[0] && c[1] === v.point[1])).toBe(false);
    }
  });

  it('a reshape removes the stale ones (crossing moved / gone), keeps the roads own vertices, and undoes as one step', () => {
    const { objects, history, ctx } = setup();
    objects.add(road('A', CROSS_A), true);
    objects.add(road('B', CROSS_B), true);
    const sharp = align(PIS, 0);
    objects.add(road('N', lineOf(sharp), { alignment: sharp }), true);
    commitGeometry(objects.getById('N')!, align(PIS, 60), ctx);
    const oldA = (objects.getById('A') as RoadObject).coordinates[1];
    expect((objects.getById('B') as RoadObject).coordinates).toHaveLength(3);
    expect((objects.getById('N') as RoadObject).addedNetworkVertices).toHaveLength(2);
    const mid = { A: objects.getById('A')!, B: objects.getById('B')!, N: objects.getById('N')! };

    const res = commitGeometry(objects.getById('N')!, align(AWAY, 0), ctx);
    expect(res.ok).toBe(true);
    const a = objects.getById('A') as RoadObject, b = objects.getById('B') as RoadObject, n = objects.getById('N') as RoadObject;
    // B: N no longer reaches it, its crossing vertex is gone and B is exactly as mapped
    expect(b.coordinates).toEqual(CROSS_B);
    // A: the old crossing vertex is gone, the new crossing has its vertex (shared with N); A's ends untouched
    expect(a.coordinates).toHaveLength(3);
    expect(a.coordinates.some(c => planDistM(c, oldA) < 0.05)).toBe(false);
    expect(a.coordinates[0]).toEqual(CROSS_A[0]);
    expect(a.coordinates[2]).toEqual(CROSS_A[1]);
    expect(n.coordinates.some(q => planDistM(q, a.coordinates[1]) < 0.01)).toBe(true);
    // The record now lists only the new one
    expect(n.addedNetworkVertices).toHaveLength(1);
    expect(n.addedNetworkVertices![0].roadId).toBe('A');
    expect(planDistM(n.addedNetworkVertices![0].point, a.coordinates[1])).toBeLessThan(0.05);

    history.undo();
    expect(objects.getById('A')!.coordinates).toEqual(mid.A.coordinates);
    expect(objects.getById('B')!.coordinates).toEqual(mid.B.coordinates);
    expect(objects.getById('N')!.coordinates).toEqual(mid.N.coordinates);
  });

  it('keeps a vertex another road joined at since, and never removes vertices it did not add', () => {
    const { objects, ctx } = setup();
    // A carries a mapped vertex of its own away from the crossing
    const A3: P[] = [[73.801, 18.4990, 0], [73.801, 18.5005, 0], [73.801, 18.5030, 0]];
    objects.add(road('A', A3), true);
    objects.add(road('B', CROSS_B), true);
    const sharp = align(PIS, 0);
    objects.add(road('N', lineOf(sharp), { alignment: sharp }), true);
    commitGeometry(objects.getById('N')!, align(PIS, 60), ctx);
    const pB = (objects.getById('B') as RoadObject).coordinates[1];
    // Another road ends on B's crossing vertex (joined there later)
    objects.add(road('C', [[pB[0], pB[1], 0], [pB[0] + 0.001, pB[1], 0]]), true);
    commitGeometry(objects.getById('N')!, align(AWAY, 0), ctx);
    const b = objects.getById('B') as RoadObject;
    expect(b.coordinates).toHaveLength(3);
    expect(b.coordinates[1]).toEqual(pB);
    expect((objects.getById('N') as RoadObject).addedNetworkVertices!.some(v => v.roadId === 'B')).toBe(true);
    // A's own mapped vertices are all still there
    const a = objects.getById('A') as RoadObject;
    for (const c of A3) expect(a.coordinates.some(q => q[0] === c[0] && q[1] === c[1])).toBe(true);
  });

  it('a road drawn before the record existed changes nothing in other roads on reshape', () => {
    const { objects, ctx } = setup();
    objects.add(road('A', CROSS_A), true);
    objects.add(road('B', CROSS_B), true);
    const sharp = align(PIS, 0);
    objects.add(road('N', lineOf(sharp), { alignment: sharp }), true);
    commitGeometry(objects.getById('N')!, align(PIS, 60), ctx);
    const { addedNetworkVertices: _drop, ...legacy } = objects.getById('N') as RoadObject;
    void _drop;
    objects.update('N', legacy as RoadObject, false, true);
    objects.update('N', { addedNetworkVertices: undefined } as Partial<RoadObject>, true);
    const bBefore = (objects.getById('B') as RoadObject).coordinates;
    commitGeometry(objects.getById('N')!, align(AWAY, 0), ctx);
    expect((objects.getById('B') as RoadObject).coordinates).toEqual(bBefore);
  });
});

describe('commitGeometry: level crossing decisions', () => {
  it('carries a decision to a crossing within 2 m of the old point on the same road, and not to a new one', () => {
    const prev: LevelCrossing[] = [{ roadId: 'X', point: [73.8, 18.5, 0], otherZ: 0, decision: 'separate', reason: 'r' }];
    const near: LevelCrossing = { roadId: 'X', point: [73.80001, 18.5, 0], otherZ: 0, decision: 'unconfirmed', reason: 'new' };
    const far: LevelCrossing = { roadId: 'X', point: [73.8001, 18.5, 0], otherZ: 0, decision: 'unconfirmed', reason: 'new' };
    const other: LevelCrossing = { roadId: 'Y', point: [73.8, 18.5, 0], otherZ: 0, decision: 'unconfirmed', reason: 'new' };
    expect(planDistM(prev[0].point, near.point)).toBeLessThan(2);
    expect(planDistM(prev[0].point, far.point)).toBeGreaterThan(2);
    const out = carryCrossingDecisions(prev, [near, far, other]);
    expect(out.map(c => c.decision)).toEqual(['separate', 'unconfirmed', 'unconfirmed']);
    expect(out[0].reason).toBe('new');
  });

  it('keeps "separate" for a bridge-tagged road the reshaped road still crosses at the same place', () => {
    const { objects, ctx } = setup();
    const bridge = road('BR', CROSS_A, { osmProvenance: { osmId: 1, osmType: 'way', originalTags: { bridge: 'yes', layer: '1' }, layer: 1 } as never });
    objects.add(bridge, true);
    // Keep the bridge on the ground so the heights are within 3 m (uncertain → flagged)
    objects.update('BR', { coordinates: CROSS_A }, true);
    const a0 = align([[73.800, 18.5010], [73.8030, 18.5010]], 0);
    objects.add(road('N', lineOf(a0), { alignment: a0 }), true);
    const first = commitGeometry(objects.getById('N')!, a0, ctx);
    expect(first.ok).toBe(true);
    const flags = (objects.getById('N') as RoadObject).levelCrossings ?? [];
    expect(flags.some(f => f.roadId === 'BR')).toBe(true);
    objects.update('N', { levelCrossings: flags.map(f => ({ ...f, decision: 'separate' as const })) }, true);
    // Move the far end only: the crossing with BR stays where it was
    const a1 = align([[73.800, 18.5010], [73.8035, 18.5010]], 0); // longer, same line through BR
    commitGeometry(objects.getById('N')!, a1, ctx);
    const after = (objects.getById('N') as RoadObject).levelCrossings ?? [];
    expect(after.find(f => f.roadId === 'BR')?.decision).toBe('separate');
  });
});

const tunnel = (pts: [number, number][], depths: (number | null)[]): UndergroundAlignmentObject => {
  const a = align(pts, 0, 'underground_alignment');
  const coords = lineOf(a);
  return {
    id: 'T1', type: 'underground_alignment', name: 'T1', layerId: 'underground', scenarioId: 'base', coordinates: coords, alignment: a,
    alignmentKind: 'bored_tunnel', section: { shape: 'circular', diameterM: 6 }, sectionCertainty: 'hypothetical',
    depths: depths.map(d => ({ crownDepthM: d, certainty: d === null ? 'unknown' : 'estimated' })),
    lifecycle: 'proposed', createdAt: T, updatedAt: T,
  } as UndergroundAlignmentObject;
};

describe('commitGeometry: a confirmed junction', () => {
  it('is made again after a reshape (shared vertex on both roads)', () => {
    const { objects, editing, ctx } = setup();
    objects.add(road('BR', CROSS_A, { osmProvenance: { osmId: 1, osmType: 'way', originalTags: { bridge: 'yes', layer: '1' }, layer: 1 } as never }), true);
    objects.update('BR', { coordinates: CROSS_A }, true);
    const a0 = align([[73.800, 18.5010], [73.8030, 18.5010]], 0);
    objects.add(road('N', lineOf(a0), { alignment: a0 }), true);
    commitGeometry(objects.getById('N')!, a0, ctx);
    const i = ((objects.getById('N') as RoadObject).levelCrossings ?? []).findIndex(f => f.roadId === 'BR');
    expect(i).toBeGreaterThanOrEqual(0);
    editing.resolveLevelCrossing('N', i, 'junction');
    commitGeometry(objects.getById('N')!, align([[73.800, 18.5010], [73.8035, 18.5010]], 0), ctx);
    const n = objects.getById('N') as RoadObject, br = objects.getById('BR') as RoadObject;
    expect(n.levelCrossings!.find(f => f.roadId === 'BR')!.decision).toBe('junction');
    expect(br.coordinates.some(c => n.coordinates.some(q => planDistM(c, q) < 0.01))).toBe(true);
  });
});

describe('regenerateGeometry: tunnel depth controls', () => {
  const PTS: [number, number][] = [[73.80, 18.50], [73.805, 18.503], [73.81, 18.50]];

  it('keeps typed depths at the PIs, derives every vertex, and an unknown control makes its side unknown', () => {
    const t = tunnel(PTS, [10, 20, null]);
    const curved = { ...t.alignment!, pis: t.alignment!.pis.map((p, i) => (i === 1 ? { ...p, radiusM: 300 } : p)) };
    const r = regenerateGeometry(t, curved);
    expect(r.ok).toBe(true);
    const o = r.object as UndergroundAlignmentObject;
    expect(o.depths!.length).toBe(o.coordinates.length);
    expect(o.coordinates.length).toBeGreaterThan(3);
    expect(o.depthControls!.map(c => c.crownDepthM)).toEqual([10, 20, null]);
    expect(o.depths![0].crownDepthM).toBe(10);
    // first half: between 10 and 20, estimated; second half (towards the unknown end): unknown, never 0
    const ch = chainagesOf(o.coordinates);
    const mid = ch.at(-1)! / 2;
    for (let i = 1; i < o.depths!.length - 1; i++) {
      const d = o.depths![i];
      if (ch[i] < mid - 60) { expect(d.crownDepthM).toBeGreaterThanOrEqual(10); expect(d.crownDepthM).toBeLessThanOrEqual(20); expect(d.certainty).toBe('estimated'); }
      if (ch[i] > mid + 60) { expect(d.crownDepthM).toBeNull(); expect(d.certainty).toBe('unknown'); }
    }
    expect(o.depths!.at(-1)!.crownDepthM).toBeNull();
  });

  it('a dragged PI keeps its typed depth; an inserted PI gets the old line depth, marked interpolated', () => {
    const t = tunnel(PTS, [10, 20, 10]);
    const moved = { ...t.alignment!, pis: t.alignment!.pis.map((p, i) => (i === 1 ? { ...p, lat: p.lat + 0.001 } : p)) };
    const r = regenerateGeometry(t, moved).object as UndergroundAlignmentObject;
    expect(r.depthControls!.map(c => c.crownDepthM)).toEqual([10, 20, 10]);
    const ins = { ...t.alignment!, pis: [t.alignment!.pis[0], { lon: 73.8025, lat: 18.5015, radiusM: 0 }, ...t.alignment!.pis.slice(1)] };
    const r2 = regenerateGeometry(t, ins).object as UndergroundAlignmentObject;
    expect(r2.depthControls!.length).toBe(4);
    expect(r2.depthControls![0].crownDepthM).toBe(10);
    expect(r2.depthControls![2].crownDepthM).toBe(20);
    expect(r2.depthControls![1].crownDepthM!).toBeGreaterThan(10);
    expect(r2.depthControls![1].crownDepthM!).toBeLessThan(20);
    expect((r2.depthControls![1] as { derived?: boolean }).derived).toBe(true);
  });

  it('a legacy tunnel (no alignment) migrates without losing a typed depth at a dropped collinear vertex', () => {
    const legacy: UndergroundAlignmentObject = {
      ...tunnel(PTS, [10, 20, 10]), alignment: undefined,
      coordinates: [[73.80, 18.50, 0], [73.8025, 18.5015, 0], [73.805, 18.503, 0], [73.81, 18.50, 0]],
      depths: [{ crownDepthM: 10, certainty: 'estimated' }, { crownDepthM: 25, certainty: 'measured' }, { crownDepthM: 20, certainty: 'estimated' }, { crownDepthM: 10, certainty: 'estimated' }],
    };
    // The editor's migration keeps vertex 1 as a PI (its typed 25 m differs from the interpolation): drag PI 2 a little
    const a = align([[73.80, 18.50], [73.8025, 18.5015], [73.8051, 18.503], [73.81, 18.50]], 0, 'underground_alignment');
    const r = regenerateGeometry(legacy, a).object as UndergroundAlignmentObject;
    expect(r.depthControls!.map(c => c.crownDepthM)).toEqual([10, 25, 20, 10]);
    expect(r.depthControls![1].certainty).toBe('measured');
  });

  it('PI depth edits re-derive the vertices (form helpers)', () => {
    const t = tunnel(PTS, [10, 20, 10]);
    const curved = { ...t.alignment!, pis: t.alignment!.pis.map((p, i) => (i === 1 ? { ...p, radiusM: 300 } : p)) };
    const o = regenerateGeometry(t, curved).object as UndergroundAlignmentObject;
    const e = withControlDepth(o, 2, { crownDepthM: 30 });
    expect(alignmentDepthControls(e)!.map(c => c.crownDepthM)).toEqual([10, 20, 30]);
    expect(e.depths!.length).toBe(e.coordinates.length);
    expect(e.depths!.at(-1)!.crownDepthM).toBe(30);
  });
});

describe('regenerateGeometry: utilities', () => {
  it('derives per-vertex depths from PI controls, keeps defaults as defaults, and counts defaults per point', () => {
    const a = align([[73.80, 18.50], [73.805, 18.503], [73.81, 18.50]], 0, 'utility');
    const coords = lineOf(a);
    let u = {
      id: 'U1', type: 'utility', name: 'U1', layerId: 'utilities-water', scenarioId: 'alt', coordinates: coords, alignment: a,
      utilityType: 'water', depth: 1.5, depthCertainty: 'hypothetical', diameterMm: 300, capacity: 100, createdAt: T, updatedAt: T,
    } as unknown as UtilityObject;
    u = withUtilityZ(u, { zRef: 'top', status: 'proposed', evidence: 'user-drawn', depths: coords.map(() => ({ depthM: 1.0, certainty: 'hypothetical' as const, isDefault: true })) });
    u = withUtilityControlDepth(u, 1, { depthM: 3 });
    expect(utilityDepthControls(u)!.map(c => c.depthM)).toEqual([1.0, 3, 1.0]);
    // Reshape: insert a bend
    const ins = { ...a, pis: [a.pis[0], { lon: 73.8025, lat: 18.5015, radiusM: 0 }, ...a.pis.slice(1)] };
    const r = regenerateGeometry(u, ins).object as UtilityObject;
    expect(r.depths!.length).toBe(r.coordinates.length);
    expect(r.depthControls!.length).toBe(4);
    expect(r.depthControls![2].depthM).toBe(3);
    expect(r.depth).toBeCloseTo(Math.min(...r.depths!.map(d => d.topDepthM ?? Infinity)), 6);
    const s = utilitySummary(r);
    expect(s.points).toBe(4);
    expect(s.defaults).toBe(2); // the two ends; the typed bend and the interpolated new bend are not defaults
  });
});

describe('commitGeometry: flyovers (legacy 40 m ramps)', () => {
  it('resets the ground line so the profile follows the new plan, with ramps still 40 m', () => {
    const { objects, ctx } = setup();
    const a = align([[73.80, 18.50], [73.805, 18.502], [73.81, 18.50]], 0, 'flyover');
    const fly = {
      id: 'F1', type: 'flyover', name: 'F1', layerId: 'roads', scenarioId: 'base', coordinates: lineOf(a), alignment: a, roadClass: 'local',
      width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40,
      isOneWay: false, elevation: 6, pierSpacing: 30, createdAt: T, updatedAt: T,
    } as unknown as FlyoverObject;
    objects.add(fly, true);
    const nBefore = objects.getById('F1')!.coordinates.length;
    // Move the middle PI: same number of PIs, so the resampled line may keep its vertex count — the ground must follow anyway
    const moved = { ...a, pis: a.pis.map((p, i) => (i === 1 ? { ...p, lat: p.lat + 0.0005, radiusM: 150 } : p)) };
    const res = commitGeometry(objects.getById('F1')!, moved, ctx);
    expect(res.ok).toBe(true);
    const f = objects.getById('F1') as FlyoverObject & { groundCoordinates: P[] };
    expect(nBefore).toBeGreaterThan(2);
    expect(f.groundCoordinates.length).toBe(f.coordinates.length);
    f.groundCoordinates.forEach((g, i) => { expect(g[0]).toBe(f.coordinates[i][0]); expect(g[1]).toBe(f.coordinates[i][1]); expect(g[2]).toBe(0); });
    // The plan passes the moved PI's curve, not the old corner
    const oldCorner = [73.805, 18.502];
    expect(Math.min(...f.coordinates.map(c => planDistM(c, oldCorner)))).toBeGreaterThan(20);
    // Legacy ramp: full deck height from 40 m along, 0.25 m clearance at the foot
    const ch = chainagesOf(f.coordinates);
    expect(f.coordinates[0][2]).toBeCloseTo(0.25, 6);
    f.coordinates.forEach((c, i) => { if (ch[i] >= 40 && ch[i] <= ch.at(-1)! - 40) expect(c[2]).toBeCloseTo(6, 6); });
    expect((f as { feasibilityResult?: unknown }).feasibilityResult).toBeTruthy();
  });

  it('applyFlyoverElevationProfile rebuilds the ground when a vertex moved but the count did not', () => {
    const f: any = { coordinates: [[73.80, 18.50, 0], [73.8002, 18.50, 0], [73.8004, 18.50, 0]], elevation: 6 };
    applyFlyoverElevationProfile(f);
    const n = f.coordinates.length;
    // Move one vertex in plan, keep the elevated z: the old ground must not be reused
    f.coordinates = f.coordinates.map((c: number[], i: number) => (i === 1 ? [c[0], c[1] + 0.00001, c[2]] : c));
    applyFlyoverElevationProfile(f);
    expect(f.coordinates.length).toBe(n);
    expect(f.groundCoordinates[1][1]).toBeCloseTo(18.50001, 9);
  });
});
