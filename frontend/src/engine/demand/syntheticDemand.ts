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
import { mainComponent, mainReach } from '../simulation/graphComponents';
import { osmRoadClass } from '../simulation/networkCorrections';
import { P14 } from '../simulation/supplyConfig';
import { p14TimeRatio } from '../simulation/indianSupply';

export const SYNTHETIC_LABEL = 'synthetic' as const;
/** v2: beta by jurisdiction (CMP-2024 Table 2-38) and the outer-cordon traffic (DEMAND_P14.md §4); v1 stays installed for reproduction. */
export const DEFAULT_SYNTHETIC_DEMAND = 'pune_synthetic_demand_v2';

/**
 * HBW..NHB person trips, FRT freight vehicle trips; v2 assets add the outer cordon (CMP-2024 Table 2-44): EXT external-
 * internal vehicle trips (factored, production-constrained from the cordon stations) and THR external-external through
 * vehicle trips (a fixed station-pair matrix, `fixedDaily`).
 */
export type Purpose = 'HBW' | 'HBE' | 'HBO' | 'NHB' | 'FRT' | 'EXT' | 'THR';
export const PURPOSES: readonly Purpose[] = ['HBW', 'HBE', 'HBO', 'NHB', 'FRT', 'EXT', 'THR'];
/** Purposes held in factored gravity form (a v1 asset has no EXT). */
type GravityPurpose = Exclude<Purpose, 'THR'>;
const GRAVITY_PURPOSES: readonly GravityPurpose[] = ['HBW', 'HBE', 'HBO', 'NHB', 'FRT', 'EXT'];
/** Purposes whose cells are vehicle trips already (split by `kindShares`, or all trucks for FRT). */
const VEHICLE_PURPOSES = new Set<Purpose>(['FRT', 'EXT', 'THR']);
export type EndAttr = 'res' | 'jobs' | 'svc' | 'seats' | 'ind';
const END_ATTRS: readonly EndAttr[] = ['res', 'jobs', 'svc', 'seats', 'ind'];
const MODES = ['walk', 'cycle', 'two_wheeler', 'auto', 'car', 'bus', 'metro'] as const;
type Mode = (typeof MODES)[number];
/** Road vehicle kinds of the person modes (walk, cycle and metro are not road vehicles). */
export const ROAD_KINDS = ['two_wheeler', 'car', 'auto', 'bus'] as const;
type RoadKind = (typeof ROAD_KINDS)[number];

export interface SyntheticZone { id: string; name: string; kind: 'internal' | 'external' | 'cordon'; lon: number; lat: number; juris: string; res: number; jobs: number; svc: number; seats: number; ind: number }
type Coefs = Partial<Record<EndAttr, number>>;

/** The JSON asset as served (backend/observed/synthetic_demand.py). */
export interface SyntheticDemandDoc {
  schema: string; id: string; label: string; status: string; labelText: string; built: string; baseYear: number;
  zones: SyntheticZone[];
  endWeights: Partial<Record<Purpose, { P: Coefs; A: Coefs }>>;
  impedance: { n: number; timeS: string; distDam: string };
  /** betaZ (v2): beta per production zone (CMP-2024 Table 2-38 trip length by jurisdiction); absent = beta everywhere */
  gravity: Partial<Record<GravityPurpose, { constraint?: 'doubly' | 'production'; alpha: number; beta: number; betaZ?: string; a: string; b: string; trips: number; targetMeanKm?: number; modelMeanKm?: number }>>;
  productions: Partial<Record<Purpose, string>>;
  attractions: Partial<Record<Purpose, string>>;
  /** v2: daily directed vehicle trips [from zone, to zone, vehicles] of purposes held as a fixed matrix (THR). */
  fixedDaily?: Partial<Record<Purpose, [number, number, number][]>>;
  /** v2: vehicle-kind shares of EXT / THR vehicle trips (CMP-2024 Tables 3-4 / 3-7 outer cordon mix). */
  kindShares?: Partial<Record<Purpose, Partial<Record<VehicleKind, number>>>>;
  modeSplit: { params: Record<string, { weight: Record<Mode, number>; lenKm: Record<Mode, number> }> };
  occupancy: Record<RoadKind, number>;
  pcu: Record<string, number>;
  hourly: Partial<Record<Purpose, { out: number[]; ret: number[] }>>;
  skeleton: { n: number; lon: string; lat: string; from: string; to: string; timeDs: string; cls: string; classes: string[]; connectors: [number, number][][] };
  checks?: { hourlyVehicleTrips?: number[]; hourlyPcu?: number[] };
}

export interface SyntheticCity {
  id: string; label: typeof SYNTHETIC_LABEL; labelText: string; n: number; zones: SyntheticZone[];
  timeS: Uint16Array; distDam: Uint16Array;
  gravity: Partial<Record<GravityPurpose, { constraint: 'doubly' | 'production'; alpha: number; beta: number; betaZ: Float64Array | null; a: Float64Array; b: Float64Array }>>;
  P: Partial<Record<Purpose, Float64Array>>; A: Partial<Record<Purpose, Float64Array>>;
  endWeights: Partial<Record<Purpose, { P: Coefs; A: Coefs }>>;
  fixed: Partial<Record<Purpose, [number, number, number][]>>;
  kindShares: Partial<Record<Purpose, Partial<Record<VehicleKind, number>>>>;
  mode: SyntheticDemandDoc['modeSplit']['params'];
  occupancy: Record<RoadKind, number>;
  hourly: Partial<Record<Purpose, { out: number[]; ret: number[] }>>;
  skeleton: Skeleton;
  /** Road-vehicle trips per person trip by kind for each OD cell (from the mode split and occupancy), built on first use. */
  vehPerPerson?: Float32Array;
  /** City road-vehicle trips per clock hour (the asset's checks.hourlyVehicleTrips), when the asset has them. */
  hourlyVeh?: number[];
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
  const gp = GRAVITY_PURPOSES.filter(p => doc.gravity[p]);
  const rec = <T,>(ps: readonly Purpose[], f: (p: Purpose) => T) => Object.fromEntries(ps.map(p => [p, f(p)])) as Partial<Record<Purpose, T>>;
  const withEnds = PURPOSES.filter(p => doc.productions[p]);
  return {
    id: doc.id, label: SYNTHETIC_LABEL, labelText: doc.labelText, n, zones: doc.zones,
    timeS: u16(doc.impedance.timeS), distDam: u16(doc.impedance.distDam),
    gravity: Object.fromEntries(gp.map(p => { const g = doc.gravity[p]!; return [p, { constraint: g.constraint ?? 'doubly', alpha: g.alpha, beta: g.beta, betaZ: g.betaZ ? f64(g.betaZ) : null, a: f64(g.a), b: f64(g.b) }]; })),
    P: rec(withEnds, p => f64(doc.productions[p]!)), A: rec(withEnds, p => f64(doc.attractions[p]!)),
    fixed: doc.fixedDaily ?? {}, kindShares: doc.kindShares ?? {},
    endWeights: doc.endWeights, mode: doc.modeSplit.params, occupancy: doc.occupancy, hourly: doc.hourly,
    skeleton: { n: sk.n, lon, lat, from, to, time, cls: bytes(sk.cls), classes: sk.classes, outStart: out.start, outEdge: out.edge, inStart: inn.start, inEdge: inn.edge, connectors: sk.connectors },
    ...(doc.checks?.hourlyVehicleTrips?.length === 24 ? { hourlyVeh: [...doc.checks.hourlyVehicleTrips] } : {}),
  };
}

/**
 * p16: factor from the city's vehicle trips at `hour` to those of the 8th busiest hour of the day (IRC:93-1985 asks for its
 * warrant volumes in each of any 8 hours of an average day; staticAssignment signalWarrantScale). Null without an hourly profile.
 */
export function eighthHourScale(city: SyntheticCity, hour: number): number | null {
  const h = city.hourlyVeh;
  if (!h || h.length !== 24) return null;
  const v = h[((Math.floor(hour) % 24) + 24) % 24];
  const eighth = [...h].sort((a, b) => b - a)[7];
  return v > 0 ? eighth / v : null;
}

/** Gravity deterrence t^alpha exp(beta t), t the network time in minutes (at least 0.5). */
export const deterrence = (tMin: number, alpha: number, beta: number) => { const t = Math.max(0.5, tMin); return Math.pow(t, alpha) * Math.exp(beta * t); };

/** Daily trips of one OD cell (person trips production -> attraction; FRT: truck trips). */
export function odCell(city: SyntheticCity, p: Purpose, i: number, j: number): number {
  const g = city.gravity[p as GravityPurpose];
  if (!g) return 0;
  return g.a[i] * g.b[j] * deterrence(city.timeS[i * city.n + j] / 60, g.alpha, g.betaZ ? g.betaZ[i] : g.beta);
}

/**
 * The same model with every purpose's beta multiplied (calibration only: tuned on the calibration split of the project
 * check): the balancing factors are re-fitted (Furness) so productions and attractions still hold.
 */
export function rebalance(city: SyntheticCity, betaMult: number, iterations = 60): SyntheticCity {
  if (betaMult === 1) return city;
  const n = city.n;
  const gravity = { ...city.gravity };
  for (const p of GRAVITY_PURPOSES) {
    // The outer-cordon traffic (EXT) is anchored to the cordon counts, not a calibration parameter
    const g = city.gravity[p];
    if (!g || p === 'EXT') continue;
    const beta = g.beta * betaMult, betaZ = g.betaZ ? g.betaZ.map(x => x * betaMult) : null;
    const F = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) F[k] = deterrence(city.timeS[k] / 60, g.alpha, betaZ ? betaZ[Math.floor(k / n)] : beta);
    const Pv = city.P[p]!, Av = city.A[p]!;
    if (g.constraint === 'production') {
      // Production-constrained (education): T_ij = P_i A_j F_ij / sum_k A_k F_ik
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += F[i * n + j] * Av[j]; a[i] = Pv[i] / Math.max(1e-30, s); }
      gravity[p] = { constraint: g.constraint, alpha: g.alpha, beta, betaZ, a, b: Float64Array.from(Av) };
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
    gravity[p] = { constraint: g.constraint, alpha: g.alpha, beta, betaZ, a: a.map((x, i) => x * Pv[i]), b: b.map((x, j) => x * Av[j]) };
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
  // Fixed matrices (THR): daily directed vehicle trips x the hour's share of the day, split by kind
  for (const p of PURPOSES) {
    const list = city.fixed[p], hp = city.hourly[p];
    if (!list || !hp) continue;
    const share = hp.out[h];
    const ks = Object.entries(city.kindShares[p] ?? { car: 1 }) as [VehicleKind, number][];
    for (const [i, j, daily] of list) for (const [k, s] of ks) { const v = daily * share * s; if (v >= minVph) cb(i, j, p, 'P', 'A', k, v); }
  }
  for (const p of GRAVITY_PURPOSES) {
    if (!city.gravity[p] || !city.hourly[p]) continue;
    const out = 0.5 * city.hourly[p]!.out[h], ret = 0.5 * city.hourly[p]!.ret[h];
    const ks = VEHICLE_PURPOSES.has(p) ? (p === 'FRT' && !city.kindShares.FRT ? [['truck', 1]] as [VehicleKind, number][] : Object.entries(city.kindShares[p] ?? { truck: 1 }) as [VehicleKind, number][]) : null;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const T = odCell(city, p, i, j);
      if (!(T > 0)) continue;
      if (ks) {
        for (const [k, s] of ks) {
          if (T * out * s >= minVph) cb(i, j, p, 'P', 'A', k, T * out * s);
          if (T * ret * s >= minVph) cb(j, i, p, 'A', 'P', k, T * ret * s);
        }
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
  /**
   * p15 gateway loading: when set, a boundary road whose entering (or leaving) traffic exceeds this multiple of its
   * capacity hands the excess to the other boundary roads near it with spare capacity that reach the trip's other end
   * (see `balanceGateways`). Absent: the p14 behaviour (each city path enters at the boundary road nearest its crossing).
   */
  gatewayBalance?: number;
  /**
   * p15 how far (m) `gatewayBalance` may move traffic from an over-capacity boundary road: default GATEWAY_DIVERT_MAX_M
   * (nearby roads only, distance decay GATEWAY_DIVERT_DECAY_M); Infinity (JSON: 0 or any value ≤ 0) spreads the excess
   * over every boundary road of that side that reaches the trip's other end, in proportion to its spare capacity.
   */
  gatewayReachM?: number;
  /**
   * p15 congestion-aware city paths: when set (iterations, e.g. 4), the city paths that decide where traffic from beyond
   * enters and leaves the area, and which zone pairs pass through it, come from a city-wide capacity-restrained
   * assignment of the hour's OD on the main-road skeleton (method of successive averages, `congestedSkeletonTimes`):
   * a zone pair's traffic is split over the paths of the iterations. Absent: the p14 behaviour (one uncongested path).
   */
  cityCongestion?: number;
  /**
   * p16: the speed-flow curve of the city-wide skeleton loading (`cityCongestion`): 'bpr' (default, the p15 assumption
   * 0.15 / 4) or 'p14', the p14 Indo-HCM curve the area assignment itself uses (SUPPLY_P14.md §1.4), normalised so the
   * skeleton's peak running time holds at v/c 0.75 (Indo-HCM Table 5.7 LOS C/D boundary, 59 % of FFS, about the
   * CMP-2024 network speed of 25 km/h against urban free-flow speeds: the assumed reference load of those times).
   */
  cityVdf?: 'bpr' | 'p14';
  /**
   * p16 gateway metering: a boundary road delivers into the area at most this multiple of its capacity (lanes x
   * gatewayLaneCapacityPcu) per hour; the excess entering traffic (inbound and through) is held outside the area this hour
   * (it queues upstream, beyond the area, as it would on the real network) and reported as `heldOutsideVph`. Applied after
   * gateway loading. Absent: everything is loaded.
   */
  gatewayMeter?: number;
}

/** p15: capacity of a boundary road per lane (PCU/h) by its highest road class rank (4 highway, 3 arterial, 2 collector, 1 local). */
export function gatewayLaneCapacityPcu(rank: number): number {
  const c = P14.laneCapacityPcu.value;
  // Indo-HCM 2017 Table 5.4: divided 4-lane for highways and arterials, two-lane undivided for collectors; local access
  // roads at half the two-lane value (ASSUMED: no Indo-HCM value for access streets)
  return rank >= 3 ? c.divided4 : rank === 2 ? c.undivided2 : c.undivided2 / 2;
}
/** p15: how far (m) traffic is moved from an over-capacity boundary road to another one, and the distance decay (ASSUMED). */
export const GATEWAY_DIVERT_MAX_M = 3000, GATEWAY_DIVERT_DECAY_M = 1000;
/** p15: an over-capacity boundary road's trip is moved to at most this many other boundary roads (ASSUMED; bounds the plan size). */
export const GATEWAY_SPREAD_K = 4;

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
  /** p15: share of the city-assignment iterations whose path crosses the area (absent: 1 where entry >= 0). */
  entryW?: Float32Array;
  /** Which skeleton times the paths were built on ('free' or `${hour}:${iterations}`). */
  timesKey?: string;
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
/** A city path counts as through traffic only if it runs at least this far inside the area's outline (assumption). */
export const MIN_THROUGH_INSIDE_M = 600;

/**
 * p15: capacity per direction (PCU/h) of a main-road skeleton link by OSM class (ASSUMED typical Pune carriageways:
 * motorway / trunk 3 lanes, primary 2, secondary 1.5, tertiary 1, at Indo-HCM 2017 Table 5.4 lane capacities).
 */
export function skeletonCapacityPcu(cls: string): number {
  const c = P14.laneCapacityPcu.value;
  if (cls.endsWith('_link')) return c.undivided2;
  if (cls === 'motorway' || cls === 'trunk') return 3 * c.divided6;
  if (cls === 'primary') return 2 * c.divided4;
  if (cls === 'secondary') return 1.5 * c.divided4;
  return c.undivided2;
}
/** BPR (US BPR 1964, international; ASSUMED here) on the skeleton's peak running time: t = t_peak (1 + 0.15 (v/c)^4). */
const SKELETON_BPR = { alpha: 0.15, beta: 4 };
/** p16: the p14 curve's time ratio at the skeleton's reference load v/c 0.75 (see SyntheticAreaOptions.cityVdf). */
const P14_REF_RATIO = p14TimeRatio(0.75);
const congestedCache = new WeakMap<SyntheticCity, Map<string, Float64Array[]>>();

/** One all-or-nothing loading of the zone OD (PCU/h, n x n) on the skeleton with link times `t`; returns link flows. */
function skeletonAon(city: SyntheticCity, od: Float64Array, t: Float64Array): Float64Array {
  const sk = city.skeleton, n = city.n, N = sk.n, flow = new Float64Array(sk.from.length);
  const dist = new Float64Array(N), pred = new Int32Array(N), done = new Uint8Array(N), load = new Float64Array(N);
  const order: number[] = [];
  for (let o = 0; o < n; o++) {
    let any = false;
    for (let d = 0; d < n; d++) if (od[o * n + d] > 0 && d !== o) { any = true; break; }
    if (!any) continue;
    dist.fill(Infinity); pred.fill(-1); done.fill(0); load.fill(0); order.length = 0;
    const heap = new MinHeap();
    for (const [node, c] of city.skeleton.connectors[o]) if (c < dist[node]) { dist[node] = c; heap.push(c, node); }
    while (heap.size) {
      const [du, u] = heap.pop();
      if (done[u] || du > dist[u]) continue;
      done[u] = 1; order.push(u);
      for (let k = sk.outStart[u]; k < sk.outStart[u + 1]; k++) {
        const e = sk.outEdge[k], v = sk.to[e], nd = du + t[e];
        if (nd < dist[v]) { dist[v] = nd; pred[v] = e; heap.push(nd, v); }
      }
    }
    for (let d = 0; d < n; d++) {
      const q = od[o * n + d];
      if (!(q > 0) || d === o) continue;
      let best = -1, bt = Infinity;
      for (const [node, c] of city.skeleton.connectors[d]) if (dist[node] + c < bt) { bt = dist[node] + c; best = node; }
      if (best >= 0) load[best] += q;
    }
    for (let k = order.length - 1; k >= 0; k--) {
      const v = order[k], e = pred[v];
      if (e < 0 || !(load[v] > 0)) continue;
      flow[e] += load[v]; load[sk.from[e]] += load[v];
    }
  }
  return flow;
}

/**
 * p15: link times of the main-road skeleton for each iteration of a city-wide method-of-successive-averages assignment of
 * the hour's vehicle OD (PCU, Indo-HCM mid-block PCUs; intrazonal trips not loaded). Element k is the times iteration k's
 * all-or-nothing paths used (element 0: the uncongested peak running times), so the MSA flows are the average of the
 * iterations' path flows and each zone pair's traffic splits evenly over its iteration paths. Cached per city and hour.
 */
export function congestedSkeletonTimes(city: SyntheticCity, hour: number, iterations: number, vdf: 'bpr' | 'p14' = 'bpr'): Float64Array[] {
  const h = ((Math.floor(hour) % 24) + 24) % 24, key = `${h}:${iterations}${vdf === 'p14' ? ':p14' : ''}`;
  let m = congestedCache.get(city);
  if (!m) { m = new Map(); congestedCache.set(city, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const sk = city.skeleton, n = city.n, pcu = P14.pcuMidblock.value as Record<string, number>;
  const od = new Float64Array(n * n);
  forEachHourlyFlow(city, h, (o, d, _p, _oe, _de, kind, v) => { if (o !== d) od[o * n + d] += v * (pcu[kind] ?? 1); });
  const cap = Float64Array.from(sk.cls, c => skeletonCapacityPcu(sk.classes[c] ?? 'tertiary'));
  const times: Float64Array[] = [sk.time];
  const x = new Float64Array(sk.from.length);
  for (let k = 1; k < Math.max(1, iterations); k++) {
    const y = skeletonAon(city, od, times[k - 1]);
    for (let e = 0; e < x.length; e++) x[e] += (y[e] - x[e]) / k;
    times.push(Float64Array.from(sk.time, (t0, e) => t0 * (vdf === 'p14' ? p14TimeRatio(x[e] / cap[e]) / P14_REF_RATIO : 1 + SKELETON_BPR.alpha * Math.pow(x[e] / cap[e], SKELETON_BPR.beta))));
  }
  m.set(key, times);
  return times;
}

/** City paths (main-road skeleton) relative to the area: where each zone pair's path enters and leaves it. */
export function areaPaths(city: SyntheticCity, outline: [number, number][], gateways: Gateway[], timesList: readonly Float64Array[] = [city.skeleton.time], timesKey = 'free'): AreaPaths {
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
  // Length of each skeleton link (m), for how far a city path runs inside the area
  const linkM = new Float64Array(sk.from.length);
  for (let e = 0; e < linkM.length; e++) { const u = sk.from[e], v = sk.to[e]; linkM[e] = distM([sk.lon[u], sk.lat[u]], [sk.lon[v], sk.lat[v]]); }
  const one = (tm: Float64Array) => {
  const entry = new Int32Array(n * n).fill(-1), exit = new Int32Array(n * n).fill(-1);
  const inbound = new Int32Array(n).fill(-1), outbound = new Int32Array(n).fill(-1);
  const dist = new Float64Array(N), ent = new Int32Array(N), ext = new Int32Array(N), done = new Uint8Array(N), inLen = new Float64Array(N);
  // Arrival at each zone through its connectors
  const conn = sk.connectors;
  for (let o = 0; o < n; o++) {
    dist.fill(Infinity); ent.fill(-1); ext.fill(-1); done.fill(0); inLen.fill(0);
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
        const e = sk.outEdge[k], v = sk.to[e], nd = du + tm[e];
        if (nd < dist[v]) {
          dist[v] = nd;
          ent[v] = ent[u] >= 0 ? ent[u] : (!inside[u] && inside[v] ? e : -1);
          ext[v] = inside[u] && !inside[v] ? e : ext[u];
          inLen[v] = inLen[u] + linkM[e] * ((inside[u] + inside[v]) / 2);
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
      // A path that only clips a corner of the area's outline does not use its roads: through traffic needs a real run inside
      if (!enters || (!startsInside && !inside[best] && inLen[best] < MIN_THROUGH_INSIDE_M)) continue;
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
        const e = sk.inEdge[k], v = sk.from[e], nd = du + tm[e];
        if (nd < dist[v]) { dist[v] = nd; ext[v] = e; heap.push(nd, v); }
      }
    }
    outbound[d] = found >= 0 && ext[found] >= 0 ? crossingDist(ext[found], 'out') : pick(zonePt(d), 'out', 3);
  }
  return { entry, exit, inbound, outbound };
  };
  const runs = timesList.map(one);
  if (runs.length === 1) return { ...runs[0], dists, gateways, outline, timesKey };
  // p15: a zone pair's traffic splits evenly over the iterations' paths (MSA); through traffic only for the iterations
  // whose path crosses the area (entryW), entry and exit mixed separately
  const K = runs.length, mixMemo = new Map<string, number>();
  const mix = (ids: number[]): number => {
    if (!ids.length) return -1;
    if (ids.every(x => x === ids[0])) return ids[0];
    const key = [...ids].sort((x, y) => x - y).join(',');
    const m = mixMemo.get(key);
    if (m !== undefined) return m;
    const acc = new Map<number, number>();
    for (const id of ids) for (const [gi, sh] of dists[id] ?? []) acc.set(gi, (acc.get(gi) ?? 0) + sh / ids.length);
    const id = dists.length;
    dists.push([...acc.entries()]);
    mixMemo.set(key, id);
    return id;
  };
  const entry = new Int32Array(n * n).fill(-1), exit = new Int32Array(n * n).fill(-1), entryW = new Float32Array(n * n);
  const inbound = new Int32Array(n), outbound = new Int32Array(n);
  const ids: number[] = [], xs: number[] = [];
  for (let z = 0; z < n; z++) {
    ids.length = 0; for (const r of runs) if (r.inbound[z] >= 0) ids.push(r.inbound[z]);
    inbound[z] = mix(ids);
    ids.length = 0; for (const r of runs) if (r.outbound[z] >= 0) ids.push(r.outbound[z]);
    outbound[z] = mix(ids);
  }
  for (let c = 0; c < n * n; c++) {
    ids.length = 0; xs.length = 0;
    for (const r of runs) if (r.entry[c] >= 0 && r.exit[c] >= 0) { ids.push(r.entry[c]); xs.push(r.exit[c]); }
    if (!ids.length) continue;
    entry[c] = mix(ids); exit[c] = mix(xs); entryW[c] = ids.length / K;
  }
  return { entry, exit, entryW, inbound, outbound, dists, gateways, outline, timesKey };
}

type EndType = string; // a purpose end's coefficient signature, e.g. "res:1"
interface Cell { zone: number; point: [number, number, number]; nodeO: string; nodeD: string; attrs: Record<EndAttr, number>; act: number }

/** The study-area cut of the city OD at one hour: building-level trip ends inside, boundary roads for the rest. */
export function syntheticAreaPlan(city: SyntheticCity, area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, ends: readonly SyntheticTripEnd[], opts: SyntheticAreaOptions,
  cache?: { paths?: AreaPaths }): DemandPlan | null {
  const accessM = opts.accessM ?? 250, cellM = opts.cellM ?? 250, maxCells = opts.maxCellsPerZone ?? 16, minVph = opts.minTripVph ?? 0.05, scale = opts.scale ?? 1;
  const net = area.network, included = new Set(area.segments.map(s => s.key));
  const nodeIds = new Set<string>();
  for (const e of net.edges.values()) if (included.has(segKey(e.id))) { nodeIds.add(e.fromNodeId); nodeIds.add(e.toNodeId); }
  const nodes = [...nodeIds].map(id => net.nodes.get(id)!).filter(Boolean);
  if (nodes.length < 2) return null;
  // p17: the outline is the junctions' (access nodes on links do not move the area's edge, nor which buildings are in it)
  const outline = hull(nodes.filter(nd => !nd.access).map(nd => [nd.coordinates[0], nd.coordinates[1]] as [number, number]));
  if (outline.length < 3) return null;
  const gateways = areaGateways(area, roads);

  // Snap grid (ground-level nodes only, as snapDemandPlan)
  const G = 0.003, grid = new Map<string, typeof nodes>();
  for (const nd of nodes) { if (Math.abs(nd.coordinates[2] || 0) > 3) continue; const k = `${Math.floor(nd.coordinates[0] / G)}:${Math.floor(nd.coordinates[1] / G)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(nd); }
  // p16: the area's main network (largest strongly connected component); a building whose nearest node is on a small
  // fragment loads at the nearest node of the main network within the access distance (as snapDemandPlan does)
  const fwd = new Map<string, string[]>();
  for (const e of net.edges.values()) if (included.has(segKey(e.id))) (fwd.get(e.fromNodeId) ?? fwd.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
  const main = mainComponent(fwd), reach = mainReach(fwd, main);
  // p16 fix 3: the nearest node is kept for the direction it serves (origin: reaches the main network; destination: reached
  // from it); only the direction it cannot serve loads at the nearest main-network node (was: any node outside the main
  // component moved for both directions)
  const snap = (x: number, y: number): [string, string] | null => {
    const cx = Math.floor(x / G), cy = Math.floor(y / G);
    let best: string | null = null, bd = accessM, bestMain: string | null = null, bm = accessM;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const nd of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      const d = distM([x, y], nd.coordinates);
      if (d < bd) { bd = d; best = nd.id; }
      if (main?.has(nd.id) && d < bm) { bm = d; bestMain = nd.id; }
    }
    if (!best) return bestMain ? [bestMain, bestMain] : null;
    const o = !reach || reach.toMain.has(best) ? best : bestMain ?? best, d = !reach || reach.fromMain.has(best) ? best : bestMain ?? best;
    return [o, d];
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
    const nodes2 = snap(b.lon, b.lat);
    if (!nodes2) { buildingsNoRoad++; continue; }
    const [nodeO, nodeD] = nodes2;
    buildingsIn++;
    const key = `${b.zone}:${Math.floor(b.lon / dLng)}:${Math.floor(b.lat / dLat)}`;
    let c = cellsByKey.get(key);
    if (!c) { c = { zone: b.zone, point: [b.lon, b.lat, 0], nodeO, nodeD, attrs: { res: 0, jobs: 0, svc: 0, seats: 0, ind: 0 }, act: 0, bestAct: -1 }; cellsByKey.set(key, c); }
    for (const a of END_ATTRS) c.attrs[a] += b[a];
    c.act += act;
    if (act > c.bestAct) { c.bestAct = act; c.point = [b.lon, b.lat, 0]; c.nodeO = nodeO; c.nodeD = nodeD; }
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
  for (const p of PURPOSES) for (const side of ['P', 'A'] as const) { const c = city.endWeights[p]?.[side]; if (c) endTypes.set(sig(c), c); }
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
  const cc = opts.cityCongestion && opts.cityCongestion > 1 ? Math.round(opts.cityCongestion) : 0;
  const timesKey = cc ? `${((Math.floor(opts.hour) % 24) + 24) % 24}:${cc}${opts.cityVdf === 'p14' ? ':p14' : ''}` : 'free';
  const paths = cache?.paths && (cache.paths.timesKey ?? 'free') === timesKey && cache.paths.outline.length === outline.length && cache.paths.outline.every((p, i) => p[0] === outline[i][0] && p[1] === outline[i][1]) ? cache.paths
    : areaPaths(city, outline, gateways, cc ? congestedSkeletonTimes(city, opts.hour, cc, opts.cityVdf ?? 'bpr') : [city.skeleton.time], timesKey);
  if (cache) cache.paths = paths;

  // 3. Flows of the hour, split by where their ends are
  const n = city.n;
  const II = new Map<string, number>(), IE = new Map<string, number>(), EI = new Map<string, number>(), EE = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const etOf = (p: Purpose, side: 'P' | 'A') => sig(city.endWeights[p]?.[side] ?? {});
  const through = opts.through !== false;
  // p15 check: intrazonal trips (same zone at both ends) that cross the area's edge (one end in the area, one in the rest of the zone)
  let intrazonalEdge = 0;
  forEachHourlyFlow(city, opts.hour, (o, d, p, oEnd, dEnd, kind, vph) => {
    const eo = etOf(p, oEnd), ed = etOf(p, dEnd);
    const so = share.get(`${o}|${eo}`) ?? 0, sd = share.get(`${d}|${ed}`) ?? 0;
    const v = vph * scale;
    if (o === d) intrazonalEdge += v * (so * (1 - sd) + (1 - so) * sd);
    if (so > 0 && sd > 0) add(II, `${o}|${eo}|${d}|${ed}|${kind}`, v * so * sd);
    if (so > 0 && sd < 1) add(IE, `${o}|${eo}|${paths.outbound[d]}|${kind}`, v * so * (1 - sd));
    if (sd > 0 && so < 1) add(EI, `${paths.inbound[o]}|${d}|${ed}|${kind}`, v * (1 - so) * sd);
    if (through && so < 1 && sd < 1 && o !== d) {
      const en = paths.entry[o * n + d], ex = paths.exit[o * n + d];
      if (en >= 0 && ex >= 0) add(EE, `${en}|${ex}|${kind}`, v * (1 - so) * (1 - sd) * (paths.entryW ? paths.entryW[o * n + d] : 1));
    }
  });

  // 4. Expand into trips between buildings and boundary roads, on routes the area's roads allow
  const canReach = reachability(fwd);
  const trips = new Map<string, PlanTrip>();
  const comp = { internal: 0, outbound: 0, inbound: 0, through: 0, noEdgeRoute: 0 };
  const noRoute = { internal: 0, outbound: 0, inbound: 0, through: 0 };
  const gwDist = (id: number) => paths.dists[id] ?? [];
  const emit = (part: 'internal' | 'outbound' | 'inbound' | 'through', kind: VehicleKind, total: number,
    pieces: { from: [number, number, number]; to: [number, number, number]; fromNode: string; toNode: string; w: number }[]) => {
    let ok = pieces.filter(x => x.fromNode !== x.toNode && canReach(x.fromNode, x.toNode));
    // A boundary road the area's roads cannot reach (or leave) from here, e.g. the other carriageway of a divided road:
    // the nearest boundary roads to the intended ones that can (the trip keeps its side of the area)
    if (!ok.length && part !== 'internal') ok = pieces.map(repairPiece(part)).filter((x): x is NonNullable<typeof x> => !!x);
    const sw = ok.reduce((s, x) => s + x.w, 0);
    if (!(sw > 0)) { comp.noEdgeRoute += total; noRoute[part] += total; return; }
    // Small pieces are folded into the others of the group (the group's total is kept)
    let kept = ok.filter(x => total * x.w / sw >= minVph);
    if (!kept.length) kept = [ok.reduce((a, b) => (b.w > a.w ? b : a))];
    const kw = kept.reduce((s, x) => s + x.w, 0);
    for (const x of kept) {
      const v = total * x.w / kw;
      const key = `${x.from.join(',')}>${x.to.join(',')}>${kind}`;
      const t = trips.get(key);
      if (t) t.vehiclesPerHour += v; else trips.set(key, { from: [...x.from], to: [...x.to], vehiclesPerHour: v, kind, part, fromNode: x.fromNode, toNode: x.toNode });
    }
    comp[part] += total;
  };
  type Piece = { from: [number, number, number]; to: [number, number, number]; fromNode: string; toNode: string; w: number };
  const ins = paths.gateways.filter(g => g.inLanes > 0), outs = paths.gateways.filter(g => g.outLanes > 0);
  const nearestTo = (list: Gateway[], p: readonly number[], k: number) => [...list].sort((a, b) => distM(a.point, p) - distM(b.point, p)).slice(0, k);
  // p16 fix: when none of the nearest boundary roads works (they all sit on a fragment off the area's main network, e.g.
  // a one-way spur or the far carriageway at the edge: Nagar Rd p16_27, 4,194 veh/h through left out at 09:00), the
  // nearest boundary road on the main network (largest strongly connected component; every pair of its nodes connects)
  const mainIns = main ? ins.filter(g => main.has(g.nodeId)) : [], mainOuts = main ? outs.filter(g => main.has(g.nodeId)) : [];
  const repairPiece = (part: 'outbound' | 'inbound' | 'through') => (x: Piece): Piece | null => {
    if (part === 'outbound') { const g = nearestTo(outs, x.to, 12).find(c => c.nodeId !== x.fromNode && canReach(x.fromNode, c.nodeId)) ?? nearestTo(mainOuts, x.to, 1).find(c => c.nodeId !== x.fromNode && canReach(x.fromNode, c.nodeId)); return g ? { ...x, to: g.point, toNode: g.nodeId } : null; }
    if (part === 'inbound') { const g = nearestTo(ins, x.from, 12).find(c => c.nodeId !== x.toNode && canReach(c.nodeId, x.toNode)) ?? nearestTo(mainIns, x.from, 1).find(c => c.nodeId !== x.toNode && canReach(c.nodeId, x.toNode)); return g ? { ...x, from: g.point, fromNode: g.nodeId } : null; }
    let best: Piece | null = null, bd = Infinity;
    for (const a of nearestTo(ins, x.from, 6)) for (const b of nearestTo(outs, x.to, 6)) {
      if (a.nodeId === b.nodeId || !canReach(a.nodeId, b.nodeId)) continue;
      const d = distM(a.point, x.from) + distM(b.point, x.to);
      if (d < bd) { bd = d; best = { ...x, from: a.point, fromNode: a.nodeId, to: b.point, toNode: b.nodeId }; }
    }
    if (!best) {
      const a = nearestTo(mainIns, x.from, 1)[0], b = nearestTo(mainOuts, x.to, 1)[0];
      if (a && b && a.nodeId !== b.nodeId) best = { ...x, from: a.point, fromNode: a.nodeId, to: b.point, toNode: b.nodeId };
    }
    return best;
  };
  const cellsOf = (z: number, et: string) => cellShares.get(`${z}|${et}`) ?? [];
  const gwPieces = (id: number, side: 'in' | 'out') => gwDist(id).map(([gi, s]) => ({ g: paths.gateways[gi], s })).filter(x => (side === 'in' ? x.g.inLanes : x.g.outLanes) > 0);
  for (const [k, v] of II) {
    const [o, eo, d, ed, kind] = k.split('|');
    const A = cellsOf(+o, eo), B = cellsOf(+d, ed);
    const pieces = [];
    for (const a of A) for (const b of B) pieces.push({ from: a.cell.point, to: b.cell.point, fromNode: a.cell.nodeO, toNode: b.cell.nodeD, w: a.s * b.s });
    emit('internal', kind as VehicleKind, v, pieces);
  }
  for (const [k, v] of IE) {
    const [o, eo, gid, kind] = k.split('|');
    const pieces = [];
    for (const a of cellsOf(+o, eo)) for (const g of gwPieces(+gid, 'out')) pieces.push({ from: a.cell.point, to: g.g.point, fromNode: a.cell.nodeO, toNode: g.g.nodeId, w: a.s * g.s });
    emit('outbound', kind as VehicleKind, v, pieces.length ? pieces : fallbackPieces(cellsOf(+o, eo), paths.gateways, 'out'));
  }
  for (const [k, v] of EI) {
    const [gid, d, ed, kind] = k.split('|');
    const pieces = [];
    for (const g of gwPieces(+gid, 'in')) for (const b of cellsOf(+d, ed)) pieces.push({ from: g.g.point, to: b.cell.point, fromNode: g.g.nodeId, toNode: b.cell.nodeD, w: g.s * b.s });
    emit('inbound', kind as VehicleKind, v, pieces.length ? pieces : fallbackPieces(cellsOf(+d, ed), paths.gateways, 'in'));
  }
  // p16: a city path whose entry and exit both resolve to the same boundary node only grazes the area's edge (it never
  // drives on the area's roads): not an area trip, reported as edgeOnly (it was counted as "left out, no drivable way")
  let edgeOnly = 0;
  for (const [k, v] of EE) {
    const [ein, eout, kind] = k.split('|');
    const pieces = [];
    let same = 0;
    for (const a of gwPieces(+ein, 'in')) for (const b of gwPieces(+eout, 'out')) {
      if (a.g.nodeId === b.g.nodeId) { same++; continue; }
      pieces.push({ from: a.g.point, to: b.g.point, fromNode: a.g.nodeId, toNode: b.g.nodeId, w: a.s * b.s });
    }
    if (!pieces.length && same > 0) { edgeOnly += v; continue; }
    emit('through', kind as VehicleKind, v, pieces);
  }
  const balance = opts.gatewayBalance && opts.gatewayBalance > 0 ? balanceGateways(trips, paths.gateways, canReach, opts.gatewayBalance, 3, opts.gatewayReachM ?? GATEWAY_DIVERT_MAX_M) : null;
  const held = opts.gatewayMeter && opts.gatewayMeter > 0 ? meterGateways(trips, paths.gateways, opts.gatewayMeter) : null;
  const list = [...trips.values()].filter(t => t.vehiclesPerHour > 1e-6).map(({ fromNode: _f, toNode: _t, ...t }) => t);
  const vph = list.reduce((s, t) => s + t.vehiclesPerHour, 0);
  if (!(vph > 0)) return null;
  const f = (x: number) => Math.round(x).toLocaleString('en-IN');
  const hh = `${String(((Math.floor(opts.hour) % 24) + 24) % 24).padStart(2, '0')}:00`;
  const pct = (x: number) => Math.round(100 * x / Math.max(1e-9, comp.internal + comp.outbound + comp.inbound + comp.through));
  const label = `SYNTHETIC demand at ${hh} (${city.id}, label: synthetic; land-use 4-step model on synthetic land use reconciled to the CMP-2024 zones; demo only, not measured, not for decisions): `
    + `${f(vph)} veh/h, ${f(comp.internal)} between the area's buildings (${pct(comp.internal)}%), ${f(comp.outbound + comp.inbound)} between its buildings and beyond its edge (${pct(comp.outbound + comp.inbound)}%), `
    + (through ? `${f(comp.through)} through, crossing it on its city route (${pct(comp.through)}%).` : 'through traffic switched off.')
    + (comp.noEdgeRoute >= 1 ? ` ${f(comp.noEdgeRoute)} veh/h left out (no drivable way on the area's roads).` : '')
    + (scale !== 1 ? ` Scaled ×${scale.toFixed(2)} (calibration parameter).` : '')
    + (held && held.heldVph >= 1 ? ` ${f(held.heldVph)} veh/h held beyond the area's edge (more than its boundary roads deliver in the hour).` : '')
    + (balance && balance.movedVph >= 1 ? ` ${f(balance.movedVph)} veh/h moved from over-capacity boundary roads to ${opts.gatewayReachM !== undefined && !(opts.gatewayReachM > 0 && Number.isFinite(opts.gatewayReachM)) ? 'other' : 'nearby'} ones.` : '');
  return {
    trips: list,
    provenance: {
      source: 'synthetic', label, period: opts.hour < 12 ? 'AM_Peak' : 'PM_Peak', vehiclesPerHour: vph, pairCount: list.length,
      components: { internal: comp.internal, outbound: comp.outbound, inbound: comp.inbound, through: comp.through, outsideArea: 0, noEdgeRoute: comp.noEdgeRoute, cordonPoints: gateways.length, throughIncluded: through },
      synthetic: { ...(balance ? { gatewayBalance: balance } : {}), ...(held ? { heldOutsideVph: held.heldVph, meteredGateways: held.gateways } : {}), intrazonalEdgeVph: intrazonalEdge, noRouteByPart: noRoute, edgeOnlyVph: edgeOnly, datasetId: city.id, label: SYNTHETIC_LABEL, hour: ((Math.floor(opts.hour) % 24) + 24) % 24, buildingsIn, buildingsNoRoad, cells: [...cellsByZone.values()].reduce((s, l) => s + l.length, 0), zonesIn: cellsByZone.size, scale },
    },
  };
}

type PlanTrip = { from: [number, number, number]; to: [number, number, number]; vehiclesPerHour: number; kind: VehicleKind; part: 'internal' | 'outbound' | 'inbound' | 'through'; fromNode: string; toNode: string };

/**
 * p15 gateway loading (DEMO_P15.md): the city path is an uncongested shortest path on the main-road skeleton, so every
 * zone pair whose path crosses the area at one place enters at the same boundary road (at Hinjewadi 19,275 of 35,395
 * veh/h at one point). Upstream of the area that traffic would spread over the parallel roads as the main one fills. Here:
 * per side (entering, leaving), a boundary road loaded above `factor` × its capacity (lanes × gatewayLaneCapacityPcu)
 * keeps traffic up to that and hands the excess to the other boundary roads within GATEWAY_DIVERT_MAX_M with spare
 * capacity, in proportion to spare capacity × exp(−distance / GATEWAY_DIVERT_DECAY_M), only where the area's roads lead
 * from the new boundary road to the trip's other end. Traffic with nowhere to go stays (no trip is dropped; totals kept).
 */
export function balanceGateways(trips: Map<string, PlanTrip>, gateways: readonly Gateway[], canReach: (a: string, b: string) => boolean, factor: number, passes = 3, reachM: number = GATEWAY_DIVERT_MAX_M): { movedVph: number; overloadedIn: number; overloadedOut: number } {
  const pcu = P14.pcuMidblock.value as Record<string, number>;
  // reach ≤ 0 or Infinity: every boundary road, distance decay GATEWAY_DIVERT_MAX_M (nearby roads first, farther ones as
  // those fill); otherwise within reach, decay GATEWAY_DIVERT_DECAY_M × reach / GATEWAY_DIVERT_MAX_M
  const all = !(reachM > 0) || !Number.isFinite(reachM);
  const decayM = all ? GATEWAY_DIVERT_MAX_M : GATEWAY_DIVERT_DECAY_M * reachM / GATEWAY_DIVERT_MAX_M;
  const byNode = new Map<string, Gateway>();
  for (const g of gateways) byNode.set(g.nodeId, g);
  let movedVph = 0;
  const over = { in: 0, out: 0 };
  for (const side of ['in', 'out'] as const) {
    const capOf = (g: Gateway) => factor * (side === 'in' ? g.inLanes : g.outLanes) * gatewayLaneCapacityPcu(g.rank);
    const endOf = (t: PlanTrip) => (side === 'in' ? (t.part === 'inbound' || t.part === 'through' ? t.fromNode : null) : (t.part === 'outbound' || t.part === 'through' ? t.toNode : null));
    for (let pass = 0; pass < passes; pass++) {
      const load = new Map<string, number>(), at = new Map<string, PlanTrip[]>();
      for (const t of trips.values()) {
        const n = endOf(t);
        if (!n || !byNode.has(n) || !(t.vehiclesPerHour > 0)) continue;
        load.set(n, (load.get(n) ?? 0) + t.vehiclesPerHour * (pcu[t.kind] ?? 1));
        (at.get(n) ?? at.set(n, []).get(n)!).push(t);
      }
      const spare = new Map<string, number>();
      for (const g of gateways) { const c = capOf(g); if (c > 0) spare.set(g.nodeId, c - (load.get(g.nodeId) ?? 0)); }
      const overloaded = [...load.entries()].map(([n, l]) => ({ g: byNode.get(n)!, l })).filter(x => x.l > capOf(x.g) + 1).sort((a, b) => (b.l - capOf(b.g)) - (a.l - capOf(a.g)));
      if (pass === 0) over[side] = overloaded.length;
      if (!overloaded.length) break;
      let movedThisPass = 0;
      for (const { g, l } of overloaded) {
        const cands = gateways.filter(c => c !== g && (spare.get(c.nodeId) ?? 0) > 0 && (all || distM(c.point, g.point) <= reachM));
        if (!cands.length) continue;
        let excess = l - Math.max(0, capOf(g)); // PCU/h to move
        const keep = Math.max(0, capOf(g)) / l;
        for (const t of at.get(g.nodeId) ?? []) {
          if (!(excess > 0)) break;
          const other = side === 'in' ? t.toNode : t.fromNode;
          const p = pcu[t.kind] ?? 1;
          // The GATEWAY_SPREAD_K best candidates (spare capacity × distance decay) that reach the trip's other end: bounded
          // so the plan does not multiply into one trip per boundary road (p15: that ran the 09:00 eval out of memory)
          const ranked = cands.filter(c => c.nodeId !== other && (spare.get(c.nodeId) ?? 0) > 0)
            .map(c => ({ c, w: (spare.get(c.nodeId) ?? 0) * Math.exp(-distM(c.point, g.point) / decayM) })).sort((a, b) => b.w - a.w);
          const pick: typeof ranked = [];
          for (const x of ranked) { if (pick.length >= GATEWAY_SPREAD_K) break; if (side === 'in' ? canReach(x.c.nodeId, other) : canReach(other, x.c.nodeId)) pick.push(x); }
          if (!pick.length) continue;
          const ok = pick.map(x => x.c), w = pick.map(x => x.w);
          const sw = w.reduce((a, b) => a + b, 0);
          if (!(sw > 0)) continue;
          // Move this trip's share of the excess, never more than the candidates' spare capacity
          const room = ok.reduce((a, c) => a + (spare.get(c.nodeId) ?? 0), 0);
          let mv = Math.min(t.vehiclesPerHour * (1 - keep), excess / p, room / p);
          if (!(mv > 1e-6)) continue;
          let done = 0;
          ok.forEach((c, k) => {
            const v = Math.min(mv * w[k] / sw, (spare.get(c.nodeId) ?? 0) / p);
            if (!(v > 1e-9)) return;
            spare.set(c.nodeId, (spare.get(c.nodeId) ?? 0) - v * p);
            const from = side === 'in' ? c.point : t.from, to = side === 'in' ? t.to : c.point;
            const fromNode = side === 'in' ? c.nodeId : t.fromNode, toNode = side === 'in' ? t.toNode : c.nodeId;
            const key = `${from.join(',')}>${to.join(',')}>${t.kind}`;
            const e = trips.get(key);
            if (e) e.vehiclesPerHour += v; else trips.set(key, { from: [...from], to: [...to], vehiclesPerHour: v, kind: t.kind, part: t.part, fromNode, toNode });
            done += v;
          });
          mv = done;
          t.vehiclesPerHour -= mv;
          excess -= mv * p;
          movedThisPass += mv;
        }
      }
      movedVph += movedThisPass;
      if (movedThisPass < 1) break;
    }
  }
  return { movedVph, overloadedIn: over.in, overloadedOut: over.out };
}

/**
 * p16 gateway metering (SyntheticAreaOptions.gatewayMeter): entering traffic (inbound and through) above `factor` x a
 * boundary road's capacity is held outside the area this hour, every trip entering there scaled by the same share.
 */
export function meterGateways(trips: Map<string, PlanTrip>, gateways: readonly Gateway[], factor: number): { heldVph: number; gateways: number } {
  const pcu = P14.pcuMidblock.value as Record<string, number>;
  const byNode = new Map<string, Gateway>();
  for (const g of gateways) byNode.set(g.nodeId, g);
  const load = new Map<string, number>(), at = new Map<string, PlanTrip[]>();
  for (const t of trips.values()) {
    if (t.part !== 'inbound' && t.part !== 'through') continue;
    if (!byNode.has(t.fromNode) || !(t.vehiclesPerHour > 0)) continue;
    load.set(t.fromNode, (load.get(t.fromNode) ?? 0) + t.vehiclesPerHour * (pcu[t.kind] ?? 1));
    (at.get(t.fromNode) ?? at.set(t.fromNode, []).get(t.fromNode)!).push(t);
  }
  let heldVph = 0, n = 0;
  for (const [node, l] of load) {
    const g = byNode.get(node)!, cap = factor * g.inLanes * gatewayLaneCapacityPcu(g.rank);
    if (!(cap > 0) || l <= cap) continue;
    const keep = cap / l;
    n++;
    for (const t of at.get(node)!) { heldVph += t.vehiclesPerHour * (1 - keep); t.vehiclesPerHour *= keep; }
  }
  return { heldVph, gateways: n };
}

/** Where a zone's path gives no boundary road with lanes on that side: the boundary roads of that side, nearest first. */
function fallbackPieces(cells: { cell: Cell; s: number }[], gateways: Gateway[], side: 'in' | 'out') {
  // Boundary roads of collector rank or above; where the area has none on that side (a fringe village reached only by
  // local roads, p16), every boundary road of that side rather than leaving the trips out
  const sideGs = gateways.filter(g => (side === 'in' ? g.inLanes : g.outLanes) > 0);
  const ranked = sideGs.filter(g => g.rank >= 2);
  const gs = ranked.length ? ranked : sideGs;
  const pieces: { from: [number, number, number]; to: [number, number, number]; fromNode: string; toNode: string; w: number }[] = [];
  for (const c of cells) {
    const near = [...gs].sort((a, b) => distM(c.cell.point, a.point) - distM(c.cell.point, b.point)).slice(0, 2);
    for (const g of near) pieces.push(side === 'out'
      ? { from: c.cell.point, to: g.point, fromNode: c.cell.nodeO, toNode: g.nodeId, w: c.s / near.length }
      : { from: g.point, to: c.cell.point, fromNode: g.nodeId, toNode: c.cell.nodeD, w: c.s / near.length });
  }
  return pieces;
}

/** Parses trip_ends rows as served: [lon, lat, zone, res, jobs, svc, seats, ind]. */
export function tripEndsFromRows(rows: readonly (readonly number[])[]): SyntheticTripEnd[] {
  return rows.map(r => ({ lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] }));
}
