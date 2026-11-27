/**
 * p17: access (loading) nodes on long links of a study area's network.
 *
 * The area network has nodes only at junctions and way ends, so trips load at junctions: a building 30-100 m from a mapped
 * road was often 150-240 m from that road's nearest junction (fringe villages, long blocks, one-way stubs; p16 harness band
 * R3, docs/urbanos/CITYWIDE_P16.md §5). This splits a long ground-level link at the points of the road nearest to the
 * buildings that have no node within reach, so their trips load where they meet the road. A two-way link is split in both
 * directions at the same node; a one-way link gets the node on its one direction (routing then follows the one-way: an
 * origin there continues downstream, a destination is reached from upstream).
 *
 * The new nodes join two pieces of the same road: they have two arms, so no junction control or signal applies (signals
 * and priority control need three or more arms, staticAssignment.ts), and they are flagged `access` so the area outline
 * and the junction lists ignore them. A piece keeps its link's lanes, speed and capacity; its length is its share of the
 * link's. Piece ids: segment `${key}.${i}` (edges `${key}.${i}_fwd|_bwd`), i counted along the forward geometry.
 */
import type { TrafficEdge, TrafficNetwork, TrafficNode } from '../objects/trafficTypes';
import type { DrivableObject, StudyArea, StudySegment } from './StudyAreaExplorer';
import { mainComponent } from './graphComponents';

export interface AccessNodeOptions {
  /** Building positions (lng, lat): access points go where these meet the road. Absent: regular spacing on long links. */
  points?: readonly (readonly number[])[] | null;
  /** A point already within this distance of a node of the area's main network needs no access node (m). */
  triggerM?: number;
  /** Only roads within this distance of the point get its access node (m). */
  reachM?: number;
  /** Access points of one link closer than this along the road share a node, if every point stays within reach of it (m). */
  mergeM?: number;
  /** No access node within this distance of a link end or of another access node (m). */
  endGapM?: number;
  /** Links shorter than this are not split (m). */
  minLinkM?: number;
  /** Regular spacing when no points are given (m). */
  spacingM?: number;
  /** Segment keys never split (e.g. the corridor of the micro-simulation, whose keys must match the area's). */
  exclude?: ReadonlySet<string>;
  /** Links touching these nodes are not split (e.g. edited junctions, whose control is keyed to their arms). */
  skipNodes?: ReadonlySet<string>;
}

/** p17: whether the app's study area gets access nodes (SimulationMode.accessNodes); on only if the p17 harness rule passed. */
export const ACCESS_NODES_DEFAULT = false;

export const ACCESS_DEFAULTS = { triggerM: 95, reachM: 95, mergeM: 60, endGapM: 20, minLinkM: 60, spacingM: 100 } as const;

const KY = 110574;
const kx = (lat: number) => 111320 * Math.cos(lat * Math.PI / 180);
const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
type C3 = [number, number, number];

/** True for nodes added by addAccessNodes. */
export const isAccessNode = (n: TrafficNode | undefined) => !!n?.access;

/** Cumulative planar length along a polyline (m). */
function chain(coords: readonly (readonly number[])[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const k = kx((coords[i][1] + coords[i - 1][1]) / 2);
    out.push(out[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * k, (coords[i][1] - coords[i - 1][1]) * KY));
  }
  return out;
}

function pointAt(coords: readonly (readonly number[])[], ch: number[], s: number): C3 {
  for (let i = 1; i < coords.length; i++) {
    if (s <= ch[i] || i === coords.length - 1) {
      const t = ch[i] > ch[i - 1] ? Math.max(0, Math.min(1, (s - ch[i - 1]) / (ch[i] - ch[i - 1]))) : 0;
      const a = coords[i - 1], b = coords[i];
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), (a[2] ?? 0) + t * ((b[2] ?? 0) - (a[2] ?? 0))];
    }
  }
  const c = coords[coords.length - 1];
  return [c[0], c[1], c[2] ?? 0];
}

/** Nearest position on a polyline: [distance m, chainage m]. */
function project(coords: readonly (readonly number[])[], ch: number[], p: readonly number[]): [number, number] {
  let best = Infinity, bs = 0;
  const k = kx(p[1]);
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - p[0]) * k, ay = (coords[i - 1][1] - p[1]) * KY, bx = (coords[i][0] - p[0]) * k, by = (coords[i][1] - p[1]) * KY;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) { best = d; bs = ch[i - 1] + t * (ch[i] - ch[i - 1]); }
  }
  return [best, bs];
}

/** The part of a polyline between two chainages, with the cut points interpolated. */
function slice(coords: readonly (readonly number[])[], ch: number[], s0: number, s1: number): C3[] {
  const out: C3[] = [pointAt(coords, ch, s0)];
  for (let i = 1; i < coords.length - 1; i++) if (ch[i] > s0 + 1e-6 && ch[i] < s1 - 1e-6) out.push([coords[i][0], coords[i][1], coords[i][2] ?? 0]);
  out.push(pointAt(coords, ch, s1));
  return out;
}

/** A ground-level street link that buildings front onto: not a flyover, bridge, tunnel, motorway or slip road. */
function frontable(road: DrivableObject | undefined, coords: readonly (readonly number[])[]): boolean {
  if (!road || road.type !== 'road') return false;
  const prov = road.osmProvenance;
  const hw = prov?.originalTags?.highway ?? '';
  if (/^motorway/.test(hw) || /_link$/.test(hw)) return false;
  if (prov && (prov.bridge || prov.tunnel || (prov.layer ?? 0) !== 0)) return false;
  return coords.every(c => Math.abs(c[2] ?? 0) <= 3);
}

/**
 * The area with access nodes on its long links (a new StudyArea; the input is not changed). Returns the input when no
 * link needs one.
 */
export function addAccessNodes(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, opts: AccessNodeOptions = {}): StudyArea & { accessNodes?: number } {
  const o = { ...ACCESS_DEFAULTS, ...opts };
  const net = area.network;
  const included = new Set(area.segments.map(s => s.key));
  const edgesOf = new Map<string, TrafficEdge[]>();
  for (const e of net.edges.values()) { const k = segKey(e.id); if (included.has(k)) (edgesOf.get(k) ?? edgesOf.set(k, []).get(k)!).push(e); }

  // Splittable segments
  const cand: { seg: StudySegment; ch: number[] }[] = [];
  for (const seg of area.segments) {
    if (o.exclude?.has(seg.key) || seg.lengthM < o.minLinkM) continue;
    const es = edgesOf.get(seg.key);
    if (!es?.length || es.some(e => o.skipNodes?.has(e.fromNodeId) || o.skipNodes?.has(e.toNodeId))) continue;
    if (!frontable(roads.get(seg.roadId), seg.coordinates)) continue;
    cand.push({ seg, ch: chain(seg.coordinates) });
  }
  if (!cand.length) return area;

  // Access chainages per segment
  const at = new Map<string, number[]>();
  if (o.points) {
    const G = 0.002; // ≈ 210 m cells
    const cell = (x: number, y: number) => `${Math.floor(x / G)}:${Math.floor(y / G)}`;
    // The main network (largest strongly connected component): a node off it (a one-way spur, a fragment) cannot serve
    // both directions of a building's trips, so the trips load at the main network (StudyDemand.snapDemandPlan); the
    // access node goes on a main-network link, where it serves both directions (a one-way link of the main network too:
    // its access node is reached from upstream and reaches downstream)
    const fwd = new Map<string, string[]>();
    for (const es of edgesOf.values()) for (const e of es) (fwd.get(e.fromNodeId) ?? fwd.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
    const main = mainComponent(fwd);
    const nodeGrid = new Map<string, C3[]>();
    const used = new Set<string>();
    for (const es of edgesOf.values()) for (const e of es) { used.add(e.fromNodeId); used.add(e.toNodeId); }
    for (const id of used) { const n = net.nodes.get(id); if (!n || Math.abs(n.coordinates[2] || 0) > 3 || (main && !main.has(id))) continue; const k = cell(n.coordinates[0], n.coordinates[1]); (nodeGrid.get(k) ?? nodeGrid.set(k, []).get(k)!).push(n.coordinates); }
    const onMain = (c: { seg: StudySegment }) => !main || edgesOf.get(c.seg.key)!.every(e => main.has(e.fromNodeId) && main.has(e.toNodeId));
    const segGrid = new Map<string, number[]>();
    cand.forEach((c, i) => {
      if (!onMain(c)) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of c.seg.coordinates) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      for (let x = Math.floor(x0 / G); x <= Math.floor(x1 / G); x++) for (let y = Math.floor(y0 / G); y <= Math.floor(y1 / G); y++) (segGrid.get(`${x}:${y}`) ?? segGrid.set(`${x}:${y}`, []).get(`${x}:${y}`)!).push(i);
    });
    const raw = new Map<number, [number, number][]>();
    for (const p of o.points) {
      const cx = Math.floor(p[0] / G), cy = Math.floor(p[1] / G), k = kx(p[1]);
      let dn = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const n of nodeGrid.get(`${cx + dx}:${cy + dy}`) ?? []) dn = Math.min(dn, Math.hypot((n[0] - p[0]) * k, (n[1] - p[1]) * KY));
      if (dn <= o.triggerM) continue;
      let best = -1, bd = o.reachM, bs = 0;
      const seen = new Set<number>();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of segGrid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const [d, s] = project(cand[i].seg.coordinates, cand[i].ch, p);
        if (d < bd) { bd = d; best = i; bs = s; }
      }
      // Only where the road is clearly nearer than any node (else the node already serves the building as well)
      if (best < 0 || bd >= dn - 10) continue;
      (raw.get(best) ?? raw.set(best, []).get(best)!).push([bs, bd]);
    }
    for (const [i, list] of raw) {
      const L = cand[i].ch[cand[i].ch.length - 1];
      if (L <= 2 * o.endGapM) continue;
      list.sort((a, b) => a[0] - b[0]);
      const place = (j: number, k: number) => Math.max(o.endGapM, Math.min(L - o.endGapM, (list[j][0] + list[k][0]) / 2));
      const fits = (j: number, k: number) => { const s = place(j, k); for (let m = j; m <= k; m++) if (Math.hypot(list[m][1], list[m][0] - s) > o.reachM) return false; return true; };
      const out: number[] = [];
      for (let j = 0; j < list.length;) {
        let k = j;
        while (k + 1 < list.length && list[k + 1][0] - list[j][0] <= o.mergeM && fits(j, k + 1)) k++;
        const s = place(j, k);
        if (!out.length || s - out[out.length - 1] >= o.endGapM) out.push(s);
        j = k + 1;
      }
      if (out.length) at.set(cand[i].seg.key, out);
    }
  } else {
    for (const c of cand) {
      const L = c.ch[c.ch.length - 1], n = Math.ceil(L / o.spacingM);
      if (n < 2) continue;
      at.set(c.seg.key, Array.from({ length: n - 1 }, (_, i) => L * (i + 1) / n));
    }
  }
  if (!at.size) return area;

  // Split
  const nodes = new Map(net.nodes);
  const edges = new Map<string, TrafficEdge>();
  const cloneNode = (id: string) => {
    const n = nodes.get(id)!;
    const c: TrafficNode = { ...n, incomingSegments: [...n.incomingSegments], outgoingSegments: [...n.outgoingSegments], allowedMovements: n.allowedMovements.map(m => ({ ...m })) };
    nodes.set(id, c);
    return c;
  };
  const touched = new Set<string>();
  const node = (id: string) => { if (!touched.has(id)) { touched.add(id); return cloneNode(id); } return nodes.get(id)!; };
  const segByKey = new Map(cand.map(c => [c.seg.key, c]));
  const newSegs = new Map<string, StudySegment[]>();
  let added = 0;
  for (const [key, ss] of at) {
    const { seg, ch } = segByKey.get(key)!;
    const L = ch[ch.length - 1];
    const pts = ss.map(s => pointAt(seg.coordinates, ch, s));
    const ids = pts.map((_, i) => `${key}~a${i}`);
    pts.forEach((p, i) => { nodes.set(ids[i], { id: ids[i], coordinates: p, incomingSegments: [], outgoingSegments: [], hasSignals: false, allowedMovements: [], access: true }); touched.add(ids[i]); added++; });
    const bounds = [0, ...ss, L];
    newSegs.set(key, bounds.slice(1).map((s1, i) => ({ ...seg, key: `${key}.${i}`, coordinates: slice(seg.coordinates, ch, bounds[i], s1), lengthM: seg.lengthM * (s1 - bounds[i]) / Math.max(1e-9, L) })));
    for (const e of edgesOf.get(key)!) {
      const ech = chain(e.coordinates), EL = ech[ech.length - 1];
      const suffix = e.id.slice(key.length); // '_fwd' | '_bwd'
      // Chainage of each access point along this edge; edges running against the segment's geometry meet them in reverse
      const es = pts.map(p => project(e.coordinates, ech, p)[1]);
      const order = es.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
      const d2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      const reversed = d2(e.coordinates[0], seg.coordinates[0]) > d2(e.coordinates[0], seg.coordinates[seg.coordinates.length - 1]);
      const seq = [e.fromNodeId, ...order.map(([, i]) => ids[i]), e.toNodeId];
      const sb = [0, ...order.map(([s]) => s), EL];
      const pieceIds: string[] = [];
      for (let j = 0; j + 1 < seq.length; j++) {
        const phys = reversed ? seq.length - 2 - j : j;
        const id = `${key}.${phys}${suffix}`;
        pieceIds.push(id);
        const coords = j === 0 ? slice(e.coordinates, ech, 0, sb[1]) : j === seq.length - 2 ? slice(e.coordinates, ech, sb[j], EL) : slice(e.coordinates, ech, sb[j], sb[j + 1]);
        coords[0] = j === 0 ? coords[0] : [...nodes.get(seq[j])!.coordinates] as C3;
        coords[coords.length - 1] = j === seq.length - 2 ? coords[coords.length - 1] : [...nodes.get(seq[j + 1])!.coordinates] as C3;
        edges.set(id, { ...e, id, fromNodeId: seq[j], toNodeId: seq[j + 1], coordinates: coords, length: e.length * (sb[j + 1] - sb[j]) / Math.max(1e-9, EL) });
        node(seq[j]).outgoingSegments.push(id);
        node(seq[j + 1]).incomingSegments.push(id);
      }
      // The link's ends now meet its first / last piece
      const a = node(e.fromNodeId), b = node(e.toNodeId);
      a.outgoingSegments = a.outgoingSegments.filter(x => x !== e.id);
      b.incomingSegments = b.incomingSegments.filter(x => x !== e.id);
      for (const m of a.allowedMovements) if (m.toSegmentId === e.id) m.toSegmentId = pieceIds[0];
      for (const m of b.allowedMovements) if (m.fromSegmentId === e.id) m.fromSegmentId = pieceIds[pieceIds.length - 1];
    }
  }
  // Edges in the network's order, split links replaced by their pieces in place
  const network: TrafficNetwork = { nodes, edges: new Map() };
  for (const [id, e] of net.edges) {
    const k = segKey(id);
    if (!at.has(k) || !included.has(k)) { network.edges.set(id, e); continue; }
    const suffix = id.slice(k.length);
    for (let i = 0; i <= at.get(k)!.length; i++) { const p = edges.get(`${k}.${i}${suffix}`); if (p) network.edges.set(p.id, p); }
  }
  const segments = area.segments.flatMap(s => newSegs.get(s.key) ?? [s]);
  return { ...area, segments, network, stats: { ...area.stats, segments: segments.length }, accessNodes: added };
}
