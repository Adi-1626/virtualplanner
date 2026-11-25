/**
 * SYNTHETIC land-use 4-step demand (p14, docs/urbanos/DEMAND_P14.md). Label: `synthetic` everywhere it is shown; demo
 * only, never measured, never mixed with official or estimated data.
 *
 * The city model is built offline (urbanos-data/synthetic/demand-v1/scripts/build_demand.py) from the synthetic land use
 * (urbanos-data/synthetic/landuse-v1: 293,803 OSM buildings with residents and jobs reconciled to the CMP-2024 zones):
 *   1. trip generation per zone and purpose (HBW / HBE / HBO / NHB from residents, jobs, seats, retail and service jobs;
 *      freight from industrial and other jobs), balanced per purpose;
 *   2. distribution: doubly-constrained gravity, deterrence t^alpha exp(beta t) on peak network time (gamma form and alpha
 *      of the PMC DP 2011 Pune gravity model; beta fitted to the CMP-2024 mean trip length);
 *   3. mode split by trip length (CMP-2024 mode shares and mode trip lengths), occupancy (Metro DPR 2021) and PCU (IRC:106);
 *   4. time of day: hourly outbound / return profiles per purpose (directional: homes to jobs in the morning, back in the
 *      evening).
 * The asset holds the city OD exactly in factored form (T_ij = a_i b_j F(t_ij)) with the zones, the impedance, the mode
 * and hourly parameters and the main-road skeleton.
 *
 * `syntheticAreaPlan` cuts the city OD to a study area: trips with both ends in the area run between the area's buildings
 * (the heaviest building of each 250 m cell of a zone carries the cell's activity); trips with one end outside enter or
 * leave by the boundary road where their city path (shortest path on the main-road skeleton) crosses the area's outline;
 * trips with both ends outside whose city path crosses the area are through traffic between those two boundary roads.
 */
import type { StudyArea, DrivableObject } from '../simulation/StudyAreaExplorer';
import type { VehicleKind } from '../simulation/TrafficMicroSim';
import type { DemandPlan } from '../simulation/StudyDemand';
import { reachability } from '../simulation/AreaDemand';
import { osmRoadClass } from '../simulation/networkCorrections';

export const SYNTHETIC_LABEL = 'synthetic' as const;
export const DEFAULT_SYNTHETIC_DEMAND = 'pune_synthetic_demand_v1';

export type Purpose = 'HBW' | 'HBE' | 'HBO' | 'NHB' | 'FRT';
export const PURPOSES: readonly Purpose[] = ['HBW', 'HBE', 'HBO', 'NHB', 'FRT'];
export type EndAttr = 'res' | 'jobs' | 'svc' | 'seats' | 'ind';
const END_ATTRS: readonly EndAttr[] = ['res', 'jobs', 'svc', 'seats', 'ind'];
const MODES = ['walk', 'cycle', 'two_wheeler', 'auto', 'car', 'bus', 'metro'] as const;
type Mode = (typeof MODES)[number];
/** Road vehicle kinds of the person modes (walk, cycle and metro are not road vehicles). */
export const ROAD_KINDS = ['two_wheeler', 'car', 'auto', 'bus'] as const;
type RoadKind = (typeof ROAD_KINDS)[number];

export interface SyntheticZone { id: string; name: string; kind: 'internal' | 'external'; lon: number; lat: number; juris: string; res: number; jobs: number; svc: number; seats: number; ind: number }
type Coefs = Partial<Record<EndAttr, number>>;

/** The JSON asset as served (backend/observed/synthetic_demand.py). */
export interface SyntheticDemandDoc {
  schema: string; id: string; label: string; status: string; labelText: string; built: string; baseYear: number;
  zones: SyntheticZone[];
  endWeights: Record<Purpose, { P: Coefs; A: Coefs }>;
  impedance: { n: number; timeS: string; distDam: string };
  gravity: Record<Purpose, { constraint?: 'doubly' | 'production'; alpha: number; beta: number; a: string; b: string; trips: number; targetMeanKm?: number; modelMeanKm?: number }>;
  productions: Record<Purpose, string>;
  attractions: Record<Purpose, string>;
  modeSplit: { params: Record<string, { weight: Record<Mode, number>; lenKm: Record<Mode, number> }> };
  occupancy: Record<RoadKind, number>;
  pcu: Record<string, number>;
  hourly: Record<Purpose, { out: number[]; ret: number[] }>;
  skeleton: { n: number; lon: string; lat: string; from: string; to: string; timeDs: string; cls: string; classes: string[]; connectors: [number, number][][] };
  checks?: { hourlyVehicleTrips?: number[]; hourlyPcu?: number[] };
}

export interface SyntheticCity {
  id: string; label: typeof SYNTHETIC_LABEL; labelText: string; n: number; zones: SyntheticZone[];
  timeS: Uint16Array; distDam: Uint16Array;
  gravity: Record<Purpose, { constraint: 'doubly' | 'production'; alpha: number; beta: number; a: Float64Array; b: Float64Array }>;
  P: Record<Purpose, Float64Array>; A: Record<Purpose, Float64Array>;
  endWeights: SyntheticDemandDoc['endWeights'];
  mode: SyntheticDemandDoc['modeSplit']['params'];
  occupancy: Record<RoadKind, number>;
  hourly: Record<Purpose, { out: number[]; ret: number[] }>;
  skeleton: Skeleton;
  /** Road-vehicle trips per person trip by kind for each OD cell (from the mode split and occupancy), built on first use. */
  vehPerPerson?: Float32Array;
}
interface Skeleton {
  n: number; lon: Float64Array; lat: Float64Array; from: Uint16Array; to: Uint16Array; time: Float64Array; cls: Uint8Array; classes: string[];
  outStart: Int32Array; outEdge: Int32Array; inStart: Int32Array; inEdge: Int32Array; connectors: [number, number][][];
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const f64 = (s: string) => new Float64Array(bytes(s).buffer);
const u16 = (s: string) => new Uint16Array(bytes(s).buffer);
const i32 = (s: string) => new Int32Array(bytes(s).buffer);

function csr(n: number, key: Uint16Array): { start: Int32Array; edge: Int32Array } {
  const start = new Int32Array(n + 1);
  for (let e = 0; e < key.length; e++) start[key[e] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n), edge = new Int32Array(key.length);
  for (let e = 0; e < key.length; e++) edge[fill[key[e]]++] = e;
  return { start, edge };
}

/** Decodes the asset; refuses one that is not labelled synthetic (it must never pass for measured or estimated data). */
export function decodeSyntheticDemand(doc: SyntheticDemandDoc): SyntheticCity {
  if (doc.label !== SYNTHETIC_LABEL || doc.status !== SYNTHETIC_LABEL) throw new Error(`${doc.id}: not labelled synthetic`);
  const n = doc.impedance.n;
  const sk = doc.skeleton;
  const from = u16(sk.from), to = u16(sk.to), tds = u16(sk.timeDs);
  const out = csr(sk.n, from), inn = csr(sk.n, to);
  const time = new Float64Array(tds.length);
  for (let e = 0; e < tds.length; e++) time[e] = tds[e] / 10;
  const lon = Float64Array.from(i32(sk.lon), v => v / 1e6), lat = Float64Array.from(i32(sk.lat), v => v / 1e6);
  const rec = <T,>(f: (p: Purpose) => T) => Object.fromEntries(PURPOSES.map(p => [p, f(p)])) as Record<Purpose, T>;
  return {
    id: doc.id, label: SYNTHETIC_LABEL, labelText: doc.labelText, n, zones: doc.zones,
    timeS: u16(doc.impedance.timeS), distDam: u16(doc.impedance.distDam),
    gravity: rec(p => ({ constraint: doc.gravity[p].constraint ?? 'doubly', alpha: doc.gravity[p].alpha, beta: doc.gravity[p].beta, a: f64(doc.gravity[p].a), b: f64(doc.gravity[p].b) })),
    P: rec(p => f64(doc.productions[p])), A: rec(p => f64(doc.attractions[p])),
    endWeights: doc.endWeights, mode: doc.modeSplit.params, occupancy: doc.occupancy, hourly: doc.hourly,
    skeleton: { n: sk.n, lon, lat, from, to, time, cls: bytes(sk.cls), classes: sk.classes, outStart: out.start, outEdge: out.edge, inStart: inn.start, inEdge: inn.edge, connectors: sk.connectors },
  };
}

/** Gravity deterrence t^alpha exp(beta t), t the network time in minutes (at least 0.5). */
export const deterrence = (tMin: number, alpha: number, beta: number) => { const t = Math.max(0.5, tMin); return Math.pow(t, alpha) * Math.exp(beta * t); };

/** Daily trips of one OD cell (person trips production -> attraction; FRT: truck trips). */
export function odCell(city: SyntheticCity, p: Purpose, i: number, j: number): number {
  const g = city.gravity[p];
  return g.a[i] * g.b[j] * deterrence(city.timeS[i * city.n + j] / 60, g.alpha, g.beta);
}

/**
 * The same model with every purpose's beta multiplied (calibration only: tuned on the calibration split of the project
 * check): the balancing factors are re-fitted (Furness) so productions and attractions still hold.
 */
export function rebalance(city: SyntheticCity, betaMult: number, iterations = 60): SyntheticCity {
  if (betaMult === 1) return city;
  const n = city.n;
  const gravity = { ...city.gravity };
  for (const p of PURPOSES) {
    const g = city.gravity[p], beta = g.beta * betaMult;
    const F = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) F[k] = deterrence(city.timeS[k] / 60, g.alpha, beta);
    const Pv = city.P[p], Av = city.A[p];
    if (g.constraint === 'production') {
      // Production-constrained (education): T_ij = P_i A_j F_ij / sum_k A_k F_ik
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += F[i * n + j] * Av[j]; a[i] = Pv[i] / Math.max(1e-30, s); }
      gravity[p] = { constraint: g.constraint, alpha: g.alpha, beta, a, b: Float64Array.from(Av) };
      continue;
    }
    let a = new Float64Array(n).fill(1), b = new Float64Array(n).fill(1);
    for (let it = 0; it < iterations; it++) {
      const na = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += F[i * n + j] * b[j] * Av[j]; na[i] = 1 / Math.max(1e-30, s); }
      a = na;
      const nb = new Float64Array(n);
      for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * Pv[i] * F[i * n + j]; nb[j] = 1 / Math.max(1e-30, s); }
      b = nb;
    }
    gravity[p] = { constraint: g.constraint, alpha: g.alpha, beta, a: a.map((x, i) => x * Pv[i]), b: b.map((x, j) => x * Av[j]) };
  }
  return { ...city, gravity, vehPerPerson: undefined };
}

const erlang2 = (dKm: number, L: number) => { const d = Math.max(0.05, dKm); return (4 * d / (L * L)) * Math.exp(-2 * d / L); };

/** Share of each mode for a trip of the cell's network length, by the production zone's jurisdiction (Bayes on CMP-2024 shares and trip lengths). */
export function modeProbs(city: SyntheticCity, i: number, j: number): Record<Mode, number> {
  const prm = city.mode[city.zones[i].juris] ?? city.mode.PMR;
  const d = city.distDam[i * city.n + j] / 100;
  const w = MODES.map(m => prm.weight[m] * erlang2(d, prm.lenKm[m]));
  const s = w.reduce((x, y) => x + y, 0);
  return Object.fromEntries(MODES.map((m, k) => [m, w[k] / s])) as Record<Mode, number>;
}

function vehPerPerson(city: SyntheticCity): Float32Array {
  if (city.vehPerPerson) return city.vehPerPerson;
  const n = city.n, K = ROAD_KINDS.length, out = new Float32Array(n * n * K);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const pr = modeProbs(city, i, j);
    ROAD_KINDS.forEach((k, x) => { out[(i * n + j) * K + x] = pr[k] / city.occupancy[k]; });
  }
  city.vehPerPerson = out;
  return out;
}

/**
 * Every directed vehicle flow of the city at a clock hour (veh/h): `from` and `to` are zone indices, `oEnd` / `dEnd` say
 * which activity carries each end (production or attraction end of the purpose). PA: production -> attraction (outbound,
 * e.g. home to work), AP: the return.
 */
export function forEachHourlyFlow(city: SyntheticCity, hour: number, cb: (from: number, to: number, p: Purpose, oEnd: 'P' | 'A', dEnd: 'P' | 'A', kind: VehicleKind, vph: number) => void, minVph = 1e-4) {
  const h = ((Math.floor(hour) % 24) + 24) % 24, n = city.n, K = ROAD_KINDS.length;
  const vpp = vehPerPerson(city);
  for (const p of PURPOSES) {
    const out = 0.5 * city.hourly[p].out[h], ret = 0.5 * city.hourly[p].ret[h];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const T = odCell(city, p, i, j);
      if (!(T > 0)) continue;
      if (p === 'FRT') {
        if (T * out >= minVph) cb(i, j, p, 'P', 'A', 'truck', T * out);
        if (T * ret >= minVph) cb(j, i, p, 'A', 'P', 'truck', T * ret);
        continue;
      }
      for (let x = 0; x < K; x++) {
        const v = T * vpp[(i * n + j) * K + x];
        if (v * out >= minVph) cb(i, j, p, 'P', 'A', ROAD_KINDS[x], v * out);
        if (v * ret >= minVph) cb(j, i, p, 'A', 'P', ROAD_KINDS[x], v * ret);
      }
    }
  }
}

/** City totals at an hour (vehicles, PCU, by kind): the check against the build script's own totals. */
export function cityHourTotals(city: SyntheticCity, hour: number, pcu: Record<string, number>): { veh: number; pcu: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  let veh = 0, pc = 0;
  forEachHourlyFlow(city, hour, (_o, _d, _p, _a, _b, k, v) => { veh += v; pc += v * (pcu[k] ?? 1); byKind[k] = (byKind[k] ?? 0) + v; }, 0);
  return { veh, pcu: pc, byKind };
}

// ── Study-area cut ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One building's trip-end weights (trip_ends.csv.gz): zone = index into city.zones. */
export interface SyntheticTripEnd { lon: number; lat: number; zone: number; res: number; jobs: number; svc: number; seats: number; ind: number }

export interface SyntheticAreaOptions {
  /** Clock hour (0-23): the plan is the demand of that hour (no further hour factor). */
  hour: number;
  /** Through traffic (both ends outside, crossing the area) on (default) or off. */
  through?: boolean;
  /** Overall scale on every trip (calibration parameter; 1 = the model as built). */
  scale?: number;
  /** Snap distance from a building to the area's roads (m), as snapDemandPlan. */
  accessM?: number;
  /** Grid cell (m) for the building trip ends of one zone. */
  cellM?: number;
  /** At most this many trip-end cells per zone (the rest join their nearest kept cell). */
  maxCellsPerZone?: number;
  /** Trips below this (veh/h) are folded into the others of their group. */
  minTripVph?: number;
}

const M_PER_DEG = 111320;
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * M_PER_DEG * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * M_PER_DEG);
const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
const CLASS_RANK: Record<string, number> = { highway: 4, arterial: 3, collector: 2, local: 1 };
/** How readily a boundary road takes traffic from beyond the area, per lane (main roads 1; ramps and service roads a little). */
const GATEWAY_CLASS_WEIGHT: Record<string, number> = { highway: 1, arterial: 1, collector: 0.6, local: 0.15 };

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function inPolygon(x: number, y: number, poly: readonly [number, number][]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], c = poly[j];
    if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}
/** Where segment a-b first meets the polygon outline (parameter along a-b), or the midpoint if no edge is found. */
function crossingPoint(a: readonly number[], b: readonly number[], poly: readonly [number, number][]): [number, number] {
  let best = 0.5, found = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i];
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = q[0] - p[0], sy = q[1] - p[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-15) continue;
    const t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / den, u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!found || Math.abs(t - 0.5) < Math.abs(best - 0.5))) { best = t; found = true; }
  }
  return [a[0] + best * (b[0] - a[0]), a[1] + best * (b[1] - a[1])];
}

interface Gateway { nodeId: string; point: [number, number, number]; inLanes: number; outLanes: number; rank: number; weight: number; roadName: string }
type Dist = [number, number][]; // [gateway index, share]

class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v, topK = k[0], topV = v[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; let mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; } if (r < n && k[r] < mk) { m = r; }
        if (m === i) break; k[i] = k[m]; v[i] = v[m]; i = m; }
      k[i] = lk; v[i] = lv;
    }
    return [topK, topV];
  }
}

/** Route structure of the city paths relative to one area (built once per area; about a second for the whole city). */
export interface AreaPaths {
  /** Per OD zone pair (o * n + d): gateway distribution id where the path enters (-1: never enters), and where it leaves (-1: never leaves / no path). */
  entry: Int32Array; exit: Int32Array;
  /** Per zone: the distribution for trips from the zone into the area (inbound) and from the area to the zone (outbound). */
  inbound: Int32Array; outbound: Int32Array;
  dists: Dist[];
  gateways: Gateway[];
  outline: [number, number][];
}

/** Boundary roads of the area from its own (included) links: lanes entering and leaving at each boundary node. */
export function areaGateways(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>): Gateway[] {
  const net = area.network, included = new Set(area.segments.map(s => s.key));
  const out: Gateway[] = [];
  const seen = new Set<string>();
  for (const b of area.boundary) {
    if (seen.has(b.nodeId)) continue;
    seen.add(b.nodeId);
    const node = net.nodes.get(b.nodeId);
    if (!node) continue;
    let inLanes = 0, outLanes = 0, rank = 0, weight = 0, name = '';
    const visit = (ids: readonly string[], side: 'in' | 'out') => {
      for (const id of ids) {
        const e = net.edges.get(id);
        if (!e || !included.has(segKey(id))) continue;
        const road = roads.get(e.roadId);
        const hw = road?.type === 'road' ? road.osmProvenance?.originalTags?.highway ?? '' : '';
        const cls = road?.roadClass ?? (hw ? osmRoadClass(hw) : 'local');
        const lanes = Math.max(1, e.lanes || 1);
        const w = (hw.endsWith('_link') || hw === 'service' ? 0.1 : GATEWAY_CLASS_WEIGHT[cls] ?? 0.15) * lanes;
        if (side === 'in') inLanes += lanes; else outLanes += lanes;
        weight = Math.max(weight, w);
        if ((CLASS_RANK[cls] ?? 1) > rank) { rank = CLASS_RANK[cls] ?? 1; name = road?.name || 'Unnamed road'; }
      }
    };
    // Entering traffic drives away from the boundary node on the area's links; leaving traffic arrives on them
    visit(node.outgoingSegments, 'in');
    visit(node.incomingSegments, 'out');
    if (!inLanes && !outLanes) continue;
    out.push({ nodeId: node.id, point: [...node.coordinates] as [number, number, number], inLanes, outLanes, rank, weight, roadName: name });
  }
  return out;
}

const SKELETON_RANK = (cls: string) => CLASS_RANK[osmRoadClass(cls)] ?? 2;

/** City paths (main-road skeleton) relative to the area: where each zone pair's path enters and leaves it. */
export function areaPaths(city: SyntheticCity, outline: [number, number][], gateways: Gateway[]): AreaPaths {
  const sk = city.skeleton, n = city.n, N = sk.n;
  const inside = new Uint8Array(N);
  for (let v = 0; v < N; v++) inside[v] = inPolygon(sk.lon[v], sk.lat[v], outline) ? 1 : 0;
  const dists: Dist[] = [];
  const memo = new Map<string, number>();
  const pick = (point: readonly number[], side: 'in' | 'out', rank: number): number => {
    const key = `${side}:${rank}:${point[0].toFixed(4)}:${point[1].toFixed(4)}`;
    const m = memo.get(key);
    if (m !== undefined) return m;
    const cand = gateways.map((g, gi) => ({ gi, g, lanes: side === 'in' ? g.inLanes : g.outLanes })).filter(c => c.lanes > 0);
    let dist: Dist = [];
    if (cand.length) {
      // Nearest boundary road of the path's class or above; a lower class costs extra distance (a main road's traffic stays on main roads)
      const scored = cand.map(c => ({ ...c, s: (distM(point, c.g.point) + 50) * (1 + 0.7 * Math.max(0, rank - c.g.rank)) / Math.max(0.05, c.g.weight) ** 0.5 }))
        .sort((a, b) => a.s - b.s);
      const keep = scored.filter(c => c.s <= scored[0].s * 1.5).slice(0, 3);
      const w = keep.map(c => 1 / c.s), sw = w.reduce((x, y) => x + y, 0);
      dist = keep.map((c, k) => [c.gi, w[k] / sw]);
    }
    const id = dists.length;
    dists.push(dist);
    memo.set(key, id);
    return id;
  };
  const edgeGw = new Map<number, number>();
  const crossingDist = (e: number, side: 'in' | 'out') => {
    const k = side === 'in' ? e : -1 - e;
    let id = edgeGw.get(k);
    if (id === undefined) {
      const u = sk.from[e], v = sk.to[e];
      const pt = crossingPoint([sk.lon[u], sk.lat[u]], [sk.lon[v], sk.lat[v]], outline);
      id = pick(pt, side, SKELETON_RANK(sk.classes[sk.cls[e]]));
      edgeGw.set(k, id);
    }
    return id;
  };
  const zonePt = (z: number) => [city.zones[z].lon, city.zones[z].lat];
  const entry = new Int32Array(n * n).fill(-1), exit = new Int32Array(n * n).fill(-1);
  const inbound = new Int32Array(n).fill(-1), outbound = new Int32Array(n).fill(-1);
  const dist = new Float64Array(N), ent = new Int32Array(N), ext = new Int32Array(N), done = new Uint8Array(N);
  // Arrival at each zone through its connectors
  const conn = sk.connectors;
  for (let o = 0; o < n; o++) {
    dist.fill(Infinity); ent.fill(-1); ext.fill(-1); done.fill(0);
    const heap = new MinHeap();
    let startsInside = false;
    for (const [node, t] of conn[o]) { if (t < dist[node]) { dist[node] = t; heap.push(t, node); } if (inside[node]) startsInside = true; }
    let firstInside = -1;
    while (heap.size) {
      const [du, u] = heap.pop();
      if (done[u] || du > dist[u]) continue;
      done[u] = 1;
      if (firstInside < 0 && inside[u]) firstInside = u;
      for (let k = sk.outStart[u]; k < sk.outStart[u + 1]; k++) {
        const e = sk.outEdge[k], v = sk.to[e], nd = du + sk.time[e];
        if (nd < dist[v]) {
          dist[v] = nd;
          ent[v] = ent[u] >= 0 ? ent[u] : (!inside[u] && inside[v] ? e : -1);
          ext[v] = inside[u] && !inside[v] ? e : ext[u];
          heap.push(nd, v);
        }
      }
    }
    // Inbound: where the zone's traffic to the area first enters it
    inbound[o] = startsInside || firstInside < 0 || ent[firstInside] < 0 ? pick(zonePt(o), 'in', 3) : crossingDist(ent[firstInside], 'in');
    for (let d = 0; d < n; d++) {
      if (d === o) continue;
      let best = -1, bt = Infinity;
      for (const [node, t] of conn[d]) if (dist[node] + t < bt) { bt = dist[node] + t; best = node; }
      if (best < 0) continue;
      const enters = startsInside || ent[best] >= 0;
      if (!enters) continue;
      entry[o * n + d] = startsInside ? pick(zonePt(o), 'in', 3) : crossingDist(ent[best], 'in');
      exit[o * n + d] = inside[best] ? pick(zonePt(d), 'out', 3) : ext[best] >= 0 ? crossingDist(ext[best], 'out') : pick(zonePt(d), 'out', 3);
    }
  }
  // Outbound: from the area to each zone, where its path last leaves the area (reverse search from the zone)
  for (let d = 0; d < n; d++) {
    dist.fill(Infinity); done.fill(0); ext.fill(-1);
    const heap = new MinHeap();
    let endsInside = false;
    for (const [node, t] of conn[d]) { if (t < dist[node]) { dist[node] = t; heap.push(t, node); } if (inside[node]) endsInside = true; }
    let found = -1;
    if (!endsInside) while (heap.size) {
      const [du, u] = heap.pop();
      if (done[u] || du > dist[u]) continue;
      done[u] = 1;
      if (inside[u]) { found = u; break; }
      for (let k = sk.inStart[u]; k < sk.inStart[u + 1]; k++) {
        const e = sk.inEdge[k], v = sk.from[e], nd = du + sk.time[e];
        if (nd < dist[v]) { dist[v] = nd; ext[v] = e; heap.push(nd, v); }
      }
    }
    outbound[d] = found >= 0 && ext[found] >= 0 ? crossingDist(ext[found], 'out') : pick(zonePt(d), 'out', 3);
  }
  return { entry, exit, inbound, outbound, dists, gateways, outline };
}

type EndType = string; // a purpose end's coefficient signature, e.g. "res:1"
interface Cell { zone: number; point: [number, number, number]; nodeId: string; attrs: Record<EndAttr, number>; act: number }

/** The study-area cut of the city OD at one hour: building-level trip ends inside, boundary roads for the rest. */
export function syntheticAreaPlan(city: SyntheticCity, area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, ends: readonly SyntheticTripEnd[], opts: SyntheticAreaOptions,
  cache?: { paths?: AreaPaths }): DemandPlan | null {
  const accessM = opts.accessM ?? 250, cellM = opts.cellM ?? 250, maxCells = opts.maxCellsPerZone ?? 16, minVph = opts.minTripVph ?? 0.05, scale = opts.scale ?? 1;
  const net = area.network, included = new Set(area.segments.map(s => s.key));
  const nodeIds = new Set<string>();
  for (const e of net.edges.values()) if (included.has(segKey(e.id))) { nodeIds.add(e.fromNodeId); nodeIds.add(e.toNodeId); }
  const nodes = [...nodeIds].map(id => net.nodes.get(id)!).filter(Boolean);
  if (nodes.length < 2) return null;
  const outline = hull(nodes.map(nd => [nd.coordinates[0], nd.coordinates[1]] as [number, number]));
  if (outline.length < 3) return null;
  const gateways = areaGateways(area, roads);

  // Snap grid (ground-level nodes only, as snapDemandPlan)
  const G = 0.003, grid = new Map<string, typeof nodes>();
  for (const nd of nodes) { if (Math.abs(nd.coordinates[2] || 0) > 3) continue; const k = `${Math.floor(nd.coordinates[0] / G)}:${Math.floor(nd.coordinates[1] / G)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(nd); }
  const snap = (x: number, y: number): string | null => {
    const cx = Math.floor(x / G), cy = Math.floor(y / G);
    let best: string | null = null, bd = accessM;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const nd of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      const d = distM([x, y], nd.coordinates);
      if (d < bd) { bd = d; best = nd.id; }
    }
    return best;
  };

  // 1. Building trip ends inside the area, grouped per zone into cells (the heaviest building carries the cell)
  const lat0 = (area.bounds.minLat + area.bounds.maxLat) / 2;
  const dLat = cellM / M_PER_DEG, dLng = dLat / Math.cos(lat0 * Math.PI / 180);
  const cellsByKey = new Map<string, Cell & { bestAct: number }>();
  let buildingsIn = 0, buildingsNoRoad = 0;
  for (const b of ends) {
    if (b.lon < area.bounds.minLng - 0.003 || b.lon > area.bounds.maxLng + 0.003 || b.lat < area.bounds.minLat - 0.003 || b.lat > area.bounds.maxLat + 0.003) continue;
    if (!inPolygon(b.lon, b.lat, outline)) continue;
    const act = b.res + b.jobs + b.seats + b.ind;
    if (!(act > 0) || b.zone < 0 || b.zone >= city.n) continue;
    const nodeId = snap(b.lon, b.lat);
    if (!nodeId) { buildingsNoRoad++; continue; }
    buildingsIn++;
    const key = `${b.zone}:${Math.floor(b.lon / dLng)}:${Math.floor(b.lat / dLat)}`;
    let c = cellsByKey.get(key);
    if (!c) { c = { zone: b.zone, point: [b.lon, b.lat, 0], nodeId, attrs: { res: 0, jobs: 0, svc: 0, seats: 0, ind: 0 }, act: 0, bestAct: -1 }; cellsByKey.set(key, c); }
    for (const a of END_ATTRS) c.attrs[a] += b[a];
    c.act += act;
    if (act > c.bestAct) { c.bestAct = act; c.point = [b.lon, b.lat, 0]; c.nodeId = nodeId; }
  }
  // At most maxCells per zone: the rest join the nearest kept cell of their zone
  const cellsByZone = new Map<number, Cell[]>();
  for (const c of cellsByKey.values()) (cellsByZone.get(c.zone) ?? cellsByZone.set(c.zone, []).get(c.zone)!).push(c);
  for (const [z, list] of cellsByZone) {
    list.sort((a, b) => b.act - a.act);
    const kept = list.slice(0, maxCells);
    for (const c of list.slice(maxCells)) {
      let best = kept[0], bd = Infinity;
      for (const k of kept) { const d = distM(c.point, k.point); if (d < bd) { bd = d; best = k; } }
      for (const a of END_ATTRS) best.attrs[a] += c.attrs[a];
      best.act += c.act;
    }
    cellsByZone.set(z, kept);
  }
  const wOf = (attrs: Record<EndAttr, number>, c: Coefs) => END_ATTRS.reduce((s, a) => s + (c[a] ?? 0) * attrs[a], 0);
  const sig = (c: Coefs): EndType => END_ATTRS.filter(a => c[a]).map(a => `${a}:${c[a]}`).join(',');
  const endTypes = new Map<EndType, Coefs>();
  for (const p of PURPOSES) for (const side of ['P', 'A'] as const) endTypes.set(sig(city.endWeights[p][side]), city.endWeights[p][side]);
  // Share of each zone's end weight inside the area, and the cells that carry it
  const share = new Map<string, number>(); // `${zone}|${endType}`
  const cellShares = new Map<string, { cell: Cell; s: number }[]>();
  for (const [z, list] of cellsByZone) for (const [et, coefs] of endTypes) {
    const tot = wOf(city.zones[z] as unknown as Record<EndAttr, number>, coefs);
    const inside = list.reduce((s, c) => s + wOf(c.attrs, coefs), 0);
    if (!(inside > 0) || !(tot > 0)) continue;
    share.set(`${z}|${et}`, Math.min(1, inside / tot));
    cellShares.set(`${z}|${et}`, list.map(c => ({ cell: c, s: wOf(c.attrs, coefs) / inside })).filter(x => x.s > 0));
  }

  // 2. City paths relative to the area
  const paths = cache?.paths && cache.paths.outline.length === outline.length && cache.paths.outline.every((p, i) => p[0] === outline[i][0] && p[1] === outline[i][1]) ? cache.paths : areaPaths(city, outline, gateways);
  if (cache) cache.paths = paths;

  // 3. Flows of the hour, split by where their ends are
  const n = city.n;
  const II = new Map<string, number>(), IE = new Map<string, number>(), EI = new Map<string, number>(), EE = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const etOf = (p: Purpose, side: 'P' | 'A') => sig(city.endWeights[p][side]);
  const through = opts.through !== false;
  forEachHourlyFlow(city, opts.hour, (o, d, p, oEnd, dEnd, kind, vph) => {
    const eo = etOf(p, oEnd), ed = etOf(p, dEnd);
    const so = share.get(`${o}|${eo}`) ?? 0, sd = share.get(`${d}|${ed}`) ?? 0;
    const v = vph * scale;
    if (so > 0 && sd > 0) add(II, `${o}|${eo}|${d}|${ed}|${kind}`, v * so * sd);
    if (so > 0 && sd < 1) add(IE, `${o}|${eo}|${paths.outbound[d]}|${kind}`, v * so * (1 - sd));
    if (sd > 0 && so < 1) add(EI, `${paths.inbound[o]}|${d}|${ed}|${kind}`, v * (1 - so) * sd);
    if (through && so < 1 && sd < 1 && o !== d) {
      const en = paths.entry[o * n + d], ex = paths.exit[o * n + d];
      if (en >= 0 && ex >= 0) add(EE, `${en}|${ex}|${kind}`, v * (1 - so) * (1 - sd));
    }
  });

  // 4. Expand into trips between buildings and boundary roads, on routes the area's roads allow
  const fwd = new Map<string, string[]>();
  for (const e of net.edges.values()) if (included.has(segKey(e.id))) (fwd.get(e.fromNodeId) ?? fwd.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
  const canReach = reachability(fwd);
  const trips = new Map<string, { from: [number, number, number]; to: [number, number, number]; vehiclesPerHour: number; kind: VehicleKind; part: 'internal' | 'outbound' | 'inbound' | 'through' }>();
  const comp = { internal: 0, outbound: 0, inbound: 0, through: 0, noEdgeRoute: 0 };
  const gwDist = (id: number) => paths.dists[id] ?? [];
  const emit = (part: 'internal' | 'outbound' | 'inbound' | 'through', kind: VehicleKind, total: number,
    pieces: { from: [number, number, number]; to: [number, number, number]; fromNode: string; toNode: string; w: number }[]) => {
    const ok = pieces.filter(x => x.fromNode !== x.toNode && canReach(x.fromNode, x.toNode));
    const sw = ok.reduce((s, x) => s + x.w, 0);
    if (!(sw > 0)) { comp.noEdgeRoute += total; return; }
    // Small pieces are folded into the others of the group (the group's total is kept)
    let kept = ok.filter(x => total * x.w / sw >= minVph);
    if (!kept.length) kept = [ok.reduce((a, b) => (b.w > a.w ? b : a))];
    const kw = kept.reduce((s, x) => s + x.w, 0);
    for (const x of kept) {
      const v = total * x.w / kw;
      const key = `${x.from.join(',')}>${x.to.join(',')}>${kind}`;
      const t = trips.get(key);
      if (t) t.vehiclesPerHour += v; else trips.set(key, { from: [...x.from], to: [...x.to], vehiclesPerHour: v, kind, part });
    }
    comp[part] += total;
  };
  const cellsOf = (z: number, et: string) => cellShares.get(`${z}|${et}`) ?? [];
  const gwPieces = (id: number, side: 'in' | 'out') => gwDist(id).map(([gi, s]) => ({ g: paths.gateways[gi], s })).filter(x => (side === 'in' ? x.g.inLanes : x.g.outLanes) > 0);
  for (const [k, v] of II) {
    const [o, eo, d, ed, kind] = k.split('|');
    const A = cellsOf(+o, eo), B = cellsOf(+d, ed);
    const pieces = [];
    for (const a of A) for (const b of B) pieces.push({ from: a.cell.point, to: b.cell.point, fromNode: a.cell.nodeId, toNode: b.cell.nodeId, w: a.s * b.s });
    emit('internal', kind as VehicleKind, v, pieces);
  }
  for (const [k, v] of IE) {
    const [o, eo, gid, kind] = k.split('|');
    const pieces = [];
    for (const a of cellsOf(+o, eo)) for (const g of gwPieces(+gid, 'out')) pieces.push({ from: a.cell.point, to: g.g.point, fromNode: a.cell.nodeId, toNode: g.g.nodeId, w: a.s * g.s });
    emit('outbound', kind as VehicleKind, v, pieces.length ? pieces : fallbackPieces(cellsOf(+o, eo), paths.gateways, 'out'));
  }
  for (const [k, v] of EI) {
    const [gid, d, ed, kind] = k.split('|');
    const pieces = [];
    for (const g of gwPieces(+gid, 'in')) for (const b of cellsOf(+d, ed)) pieces.push({ from: g.g.point, to: b.cell.point, fromNode: g.g.nodeId, toNode: b.cell.nodeId, w: g.s * b.s });
    emit('inbound', kind as VehicleKind, v, pieces.length ? pieces : fallbackPieces(cellsOf(+d, ed), paths.gateways, 'in'));
  }
  for (const [k, v] of EE) {
    const [ein, eout, kind] = k.split('|');
    const pieces = [];
    for (const a of gwPieces(+ein, 'in')) for (const b of gwPieces(+eout, 'out')) {
      if (a.g.nodeId === b.g.nodeId) continue;
      pieces.push({ from: a.g.point, to: b.g.point, fromNode: a.g.nodeId, toNode: b.g.nodeId, w: a.s * b.s });
    }
    emit('through', kind as VehicleKind, v, pieces);
  }
  const list = [...trips.values()].filter(t => t.vehiclesPerHour > 1e-6);
  const vph = list.reduce((s, t) => s + t.vehiclesPerHour, 0);
  if (!(vph > 0)) return null;
  const f = (x: number) => Math.round(x).toLocaleString('en-IN');
  const hh = `${String(((Math.floor(opts.hour) % 24) + 24) % 24).padStart(2, '0')}:00`;
  const pct = (x: number) => Math.round(100 * x / Math.max(1e-9, comp.internal + comp.outbound + comp.inbound + comp.through));
  const label = `SYNTHETIC demand at ${hh} (${city.id}, label: synthetic; land-use 4-step model on synthetic land use reconciled to the CMP-2024 zones; demo only, not measured, not for decisions): `
    + `${f(vph)} veh/h, ${f(comp.internal)} between the area's buildings (${pct(comp.internal)}%), ${f(comp.outbound + comp.inbound)} between its buildings and beyond its edge (${pct(comp.outbound + comp.inbound)}%), `
    + (through ? `${f(comp.through)} through, crossing it on its city route (${pct(comp.through)}%).` : 'through traffic switched off.')
    + (comp.noEdgeRoute >= 1 ? ` ${f(comp.noEdgeRoute)} veh/h left out (no drivable way on the area's roads).` : '')
    + (scale !== 1 ? ` Scaled ×${scale.toFixed(2)} (calibration parameter).` : '');
  return {
    trips: list,
    provenance: {
      source: 'synthetic', label, period: opts.hour < 12 ? 'AM_Peak' : 'PM_Peak', vehiclesPerHour: vph, pairCount: list.length,
      components: { internal: comp.internal, outbound: comp.outbound, inbound: comp.inbound, through: comp.through, outsideArea: 0, noEdgeRoute: comp.noEdgeRoute, cordonPoints: gateways.length, throughIncluded: through },
      synthetic: { datasetId: city.id, label: SYNTHETIC_LABEL, hour: ((Math.floor(opts.hour) % 24) + 24) % 24, buildingsIn, buildingsNoRoad, cells: [...cellsByZone.values()].reduce((s, l) => s + l.length, 0), zonesIn: cellsByZone.size, scale },
    },
  };
}

/** Where a zone's path gives no boundary road with lanes on that side: the boundary roads of that side, nearest first. */
function fallbackPieces(cells: { cell: Cell; s: number }[], gateways: Gateway[], side: 'in' | 'out') {
  const gs = gateways.filter(g => (side === 'in' ? g.inLanes : g.outLanes) > 0 && g.rank >= 2);
  const pieces: { from: [number, number, number]; to: [number, number, number]; fromNode: string; toNode: string; w: number }[] = [];
  for (const c of cells) {
    const near = [...gs].sort((a, b) => distM(c.cell.point, a.point) - distM(c.cell.point, b.point)).slice(0, 2);
    for (const g of near) pieces.push(side === 'out'
      ? { from: c.cell.point, to: g.point, fromNode: c.cell.nodeId, toNode: g.nodeId, w: c.s / near.length }
      : { from: g.point, to: c.cell.point, fromNode: g.nodeId, toNode: c.cell.nodeId, w: c.s / near.length });
  }
  return pieces;
}

/** Parses trip_ends rows as served: [lon, lat, zone, res, jobs, svc, seats, ind]. */
export function tripEndsFromRows(rows: readonly (readonly number[])[]): SyntheticTripEnd[] {
  return rows.map(r => ({ lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] }));
}
