import { apiGet } from '../../lib/api';
import type { TrafficNetwork } from '../objects/trafficTypes';
import { isAreaCutEnd, type StudyArea, type DrivableObject } from './StudyAreaExplorer';
import type { VehicleKind } from './TrafficMicroSim';
import { estimatedLinkFlow, zoneDensityAt, type EstimatedTrafficModel } from './EstimatedTraffic';
import { VEHICLE_TYPES } from './TrafficMicroSim';
import { roadKeys } from './roadSection';
import { strongComponents } from './graphComponents';
import { activityEndpoints, landUseVehicles, type DemandPlan, type SimulationContext, type DemandComponents, type ActivityEndpoint } from './StudyDemand';

/**
 * Study-area demand with the trips that cross the area's edge.
 *
 * The earlier estimate sent every trip made by a building in the area to
 * another building in the area (gravity, 1/d², up to 32 destinations). A study
 * area is a few kilometres across, while motorised trips in Pune average 4.7 to
 * 8.5 km (CMP 2018, Table 9), so most trips made by its buildings leave it, and
 * most traffic on its main roads comes from beyond it. Leaving both out is why
 * the main roads of an area ran nearly empty (docs/ROAD_ANALYSIS.md).
 *
 * The demand now has three parts, each labelled in the plan:
 *  1. internal: trips between places inside the area (trip-length deterrence);
 *  2. land-use <-> edge: the trips of the area's buildings that start or end
 *     beyond the edge, entering or leaving by the roads that cross it;
 *  3. through: traffic crossing the area on its arterial and collector roads,
 *     the part of the edge flow not already made by the area's own trips.
 *
 * Every number is an estimate. Sources and assumptions are in DEMAND_SOURCES.
 */

/** Mean motorised trip length by vehicle (km), CMP 2018 Table 9, overall study area. */
export const MEAN_TRIP_KM: Partial<Record<VehicleKind, number>> = { two_wheeler: 7.54, auto: 4.68, car: 8.54, bus: 6.25 };
const DEFAULT_TRIP_KM = 7.0;

/**
 * Peak-hour flow per lane and direction at the area edge (veh/h), by road class.
 *
 * Arterial: the 20 approaches of the five counted junctions on primary or
 * secondary roads in west Pune (Kokane, Panchratna, Kasturi, Ganraj, Infosys
 * Circle; backend/data/observed_counts/pune_west_2026.json) carry 867-2,679
 * veh/h, median about 1,450, on approaches of 2-3 lanes (OSM): about 500-700
 * veh/h per lane. The lower end, 500, is used.
 * Collector: no counts; assumed 300 (about 60% of the arterial value).
 * Highway (OSM trunk/motorway): no counts; the arterial value is used. Local streets get no through traffic: only
 * the trips of the buildings they serve.
 */
export const EDGE_FLOW_PER_LANE_VPH: Record<string, number> = { highway: 500, arterial: 500, collector: 300, local: 0 };

/** Through trips leave by the road they came in on this many times more readily than by another (assumption). */
export const SAME_ROAD_WEIGHT = 3;

export const DEMAND_SOURCES = [
  'Trip generation: PCMC motorised trips per person 0.87/day, peak-hour share 7.8%, PCMC mode split and occupancy (CMP 2018 Tables 6-7, p. E-5; CMP 2008 Table 4.7).',
  'Trip length: mean motorised trip lengths 7.54 km two-wheeler, 4.68 km auto, 8.54 km car, 6.25 km bus (CMP 2018 Table 9, overall study area). Their spread (Erlang, shape 2) is an assumption.',
  'Calibrated window edge flows (docs/urbanos/TRAFFIC_CALIBRATION_P9.md): used only when a file is installed in backend/data/calibrated_flows. None is shipped: on the 8 hold-out counts the window flows (unfitted or fitted to the 7 calibration counts) did worse than the class-typical flows below.',
  'City-wide estimated traffic (docs/urbanos/TRAFFIC_ESTIMATED_P10.md; label: estimated, project-level, not for decisions): each main road\'s estimated weekday volume by hour and direction, from road type, lanes, CMP-2024 zone activity and distance to the old city, fitted to real counts (calibration split). Tried as edge flows and NOT used: on the hold-out sites it did worse than the class-typical flows below.',
  'Edge flows on arterials (without the estimated traffic): 500 veh/h per lane per direction, the low end of the counted approaches at five west-Pune junctions (NICMAR 2025 / Kureshi 2026). Collector 300 veh/h per lane is an assumption and trunk roads use the arterial value; local streets carry no through traffic.',
  'Through traffic: edge-to-edge trips balanced to the edge flows (Furness), weighted by distance across the area and three times more likely to stay on the road they came in on (assumption).',
  'Vehicle mix of edge and through traffic: Gunjan Chowk classified counts (Thakur et al. 2017).',
  'Buildings: residents and jobs as imported (OpenStreetMap buildings: floors x 12 people by category). OSM rarely tags workplaces, so jobs are under-counted; trips with no destination inside the area leave it.',
] as const;

export interface CordonPoint {
  nodeId: string;
  coordinates: [number, number, number];
  roadId: string;
  roadClass: string;
  roadName: string;
  /** Lanes arriving from outside / leaving to outside. */
  inLanes: number;
  outLanes: number;
  /** Class-typical peak-hour flow entering / leaving here (veh/h). */
  inVph: number;
  outVph: number;
  /** Where the flows come from: the calibrated window, the city-wide estimated traffic (estimated, not measured), or the class-typical flow per lane. */
  flowSource?: 'calibrated' | 'estimated' | 'class';
}

/**
 * Edge flow per lane for a road: by class, but none on slip roads and ramps
 * (OSM *_link): traffic crossing the edge is counted on the main carriageway,
 * and a ramp at the edge would count it twice.
 */
export function edgeFlowPerLane(road: DrivableObject | undefined): number {
  const hw = road?.type === 'road' ? road.osmProvenance?.originalTags?.highway ?? '' : '';
  if (hw.endsWith('_link') || hw === 'service') return 0;
  return EDGE_FLOW_PER_LANE_VPH[road?.roadClass ?? 'local'] ?? 0;
}

const segmentKey = (edgeId: string) => edgeId.replace(/_(fwd|bwd)$/, '');

/**
 * Calibrated edge flows (backend/data/calibrated_flows, docs/urbanos/TRAFFIC_CALIBRATION_P9.md): per link of one large
 * window of central Pune, the motor-vehicle volume (veh/h at the period's reference hour) of the app's own assignment
 * with the window's demand estimated from CALIBRATION counts only (ODME). A study area inside the window takes the
 * flow on each road crossing its edge from here instead of the class-typical flow per lane (the sub-area / windowing
 * method), so a road's volume no longer depends on which area was selected. Every value is an estimate.
 */
export interface CalibratedEdgeFlows {
  id: string;
  /** Window outline (lng/lat bounds): a link outside it is not covered. */
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  periods: Partial<Record<'AM_Peak' | 'PM_Peak', { refHour: number; links: Record<string, number>; calibrationSites: string[]; holdoutSites?: string[] }>>;
}

/** Edge flow of one cordon link from the calibrated window, or null where the window does not cover it. */
export function calibratedLinkFlow(flows: CalibratedEdgeFlows | null | undefined, period: string, edgeId: string, at: readonly number[]): number | null {
  const p = flows?.periods[period as 'AM_Peak' | 'PM_Peak'];
  if (!p || !flows) return null;
  const b = flows.bounds;
  // Inside the window a link with no entry carried under 5 veh/h there (entries below 5 are not stored)
  const v = p.links[edgeId];
  if (v !== undefined) return v;
  return at[0] >= b.minLng && at[0] <= b.maxLng && at[1] >= b.minLat && at[1] <= b.maxLat && isWindowLink(p.links, edgeId) ? 0 : null;
}
/** A link of the window network: its other direction or another piece of the same road is in the file. */
const windowWays = new WeakMap<Record<string, number>, Set<string>>();
function isWindowLink(links: Record<string, number>, edgeId: string): boolean {
  let ways = windowWays.get(links);
  if (!ways) { ways = new Set(Object.keys(links).map(k => k.replace(/_seg_\d+(?:\.\d+)?_(fwd|bwd)$/, ''))); windowWays.set(links, ways); }
  return ways.has(edgeId.replace(/_seg_\d+(?:\.\d+)?_(fwd|bwd)$/, ''));
}
const M_PER_DEG_LAT = 111320;
const distM = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * M_PER_DEG_LAT);

/** Where roads cross the area's edge, with their lanes and class-typical flows. */
export function cordonOf(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, calibrated?: { flows: CalibratedEdgeFlows | null; period: string },
  estimated?: { model: EstimatedTrafficModel | null; hour: number; edgeScale?: number }): CordonPoint[] {
  const net = area.network;
  // City-wide estimated flow on one directed link at the period's reference hour (null without the model)
  const est = (e: { roadId: string; fromNodeId: string; toNodeId: string }, at: readonly number[]): number | null => {
    const road = roads.get(e.roadId);
    // Local streets keep no through traffic (as the class-typical flows): their estimated volume is access traffic, which
    // the area's own buildings make; edge-to-edge trips on them would be counted twice
    if (!estimated?.model || !road || edgeFlowPerLane(road) <= 0) return null;
    const a = net.nodes.get(e.fromNodeId)?.coordinates, b = net.nodes.get(e.toNodeId)?.coordinates;
    if (!a || !b) return null;
    // Only part of a road's traffic crosses the area: the rest starts or ends inside it, where central Pune has no land use
    // in the project; the share (areaEdgeScale) is fitted on the calibration crossings (TRAFFIC_ESTIMATED_P10.md §4)
    // With the zone land use inside the area (estimatedLandUse) the whole estimated flow crosses the edge (edgeScale 1): the
    // area's own trips then take their share of it and only the rest is through traffic
    return estimatedLinkFlow(estimated.model, road, at, [b[0] - a[0], b[1] - a[1]], estimated.hour) * (estimated.edgeScale ?? estimated.model.areaEdgeScale ?? 1);
  };
  const included = new Set(area.segments.map(s => s.key));
  const out: CordonPoint[] = [];
  const seen = new Set<string>(), cut = new Set<string>();
  for (const b of area.boundary) {
    const node = net.nodes.get(b.nodeId);
    if (!node) continue;
    let inLanes = 0, outLanes = 0, inVph = 0, outVph = 0, usedCalibrated = false, usedEstimated = false;
    let best: { roadId: string; rank: number } | null = null;
    const rank: Record<string, number> = { highway: 4, arterial: 3, collector: 2, local: 1 };
    const visit = (ids: string[], dir: 'in' | 'out') => {
      for (const id of ids) {
        const e = net.edges.get(id);
        if (!e || included.has(segmentKey(id))) continue;
        const cls = roads.get(e.roadId)?.roadClass ?? 'local';
        const lanes = Math.max(1, e.lanes || 1);
        const cal = calibrated ? calibratedLinkFlow(calibrated.flows, calibrated.period, id, node.coordinates) : null;
        const es = cal === null ? est(e, node.coordinates) : null;
        const vph = cal ?? es ?? lanes * edgeFlowPerLane(roads.get(e.roadId));
        if (cal !== null) usedCalibrated = true;
        if (es !== null) usedEstimated = true;
        if (dir === 'in') { inLanes += lanes; inVph += vph; } else { outLanes += lanes; outVph += vph; }
        const r = rank[cls] ?? 1;
        if (!best || r > best.rank) best = { roadId: e.roadId, rank: r };
      }
    };
    visit(node.incomingSegments, 'in');
    visit(node.outgoingSegments, 'out');
    // An edge with no outside road (a cut end) carries nothing until a gateway is placed there
    if (!best || (inLanes === 0 && outLanes === 0)) continue;
    const road = roads.get((best as { roadId: string }).roadId);
    seen.add(b.nodeId);
    out.push({ nodeId: b.nodeId, coordinates: [...node.coordinates] as [number, number, number], roadId: (best as { roadId: string }).roadId,
      roadClass: road?.roadClass ?? 'local', roadName: road?.name || 'Unnamed road', inLanes, outLanes, inVph, outVph, flowSource: usedCalibrated ? 'calibrated' : usedEstimated ? 'estimated' : 'class' });
  }
  // Roads cut where they cross a mapped area's boundary ("Map Selected Area") go on outside it:
  // traffic enters and leaves there too, by the road's own lanes
  for (const e of net.edges.values()) {
    if (!included.has(segmentKey(e.id))) continue;
    const road = roads.get(e.roadId);
    for (const [nodeId, dir] of [[e.fromNodeId, 'in'], [e.toNodeId, 'out']] as const) {
      const node = net.nodes.get(nodeId);
      if (!node || !isAreaCutEnd(road, node.coordinates)) continue;
      // Another road meeting at the cut point means the network goes on there
      if (node.incomingSegments.length + node.outgoingSegments.length > (e.direction === 'forward' ? 1 : 2)) continue;
      let p = out.find(x => x.nodeId === nodeId);
      if (!p) {
        if (seen.has(nodeId)) continue;
        p = { nodeId, coordinates: [...node.coordinates] as [number, number, number], roadId: e.roadId, roadClass: road?.roadClass ?? 'local', roadName: road?.name || 'Unnamed road', inLanes: 0, outLanes: 0, inVph: 0, outVph: 0, flowSource: 'class' };
        out.push(p);
        cut.add(nodeId);
      }
      if (!cut.has(nodeId)) continue;
      const lanes = Math.max(1, e.lanes || 1);
      // The cut road's own link carries the window's flow across the cut (in: this link; out: this link)
      const cal = calibrated ? calibratedLinkFlow(calibrated.flows, calibrated.period, e.id, node.coordinates) : null;
      const es = cal === null ? est(e, node.coordinates) : null;
      const vph = cal ?? es ?? lanes * edgeFlowPerLane(road);
      if (cal !== null) p.flowSource = 'calibrated';
      else if (es !== null && p.flowSource !== 'calibrated') p.flowSource = 'estimated';
      if (dir === 'in') { p.inLanes += lanes; p.inVph += vph; } else { p.outLanes += lanes; p.outVph += vph; }
    }
  }
  return out;
}

/**
 * Directed reachability between road nodes: strongly connected components
 * (iterative Tarjan), then reachable components per origin component over the
 * condensed graph, memoised. Most of a road network is one component, so this
 * costs one pass plus a few small searches.
 */
export { mainComponent, strongComponents } from './graphComponents';

export function reachability(adj: ReadonlyMap<string, string[]>): (from: string, to: string) => boolean {
  const comp = strongComponents(adj);
  const dag = new Map<number, Set<number>>();
  adj.forEach((outs, v) => { for (const w of outs) { const a = comp.get(v)!, b = comp.get(w)!; if (a !== b) (dag.get(a) ?? dag.set(a, new Set()).get(a)!).add(b); } });
  const memo = new Map<number, Set<number>>();
  const reachableFrom = (c: number) => {
    let r = memo.get(c);
    if (r) return r;
    r = new Set([c]);
    const st = [c];
    while (st.length) for (const d of dag.get(st.pop()!) ?? []) if (!r.has(d)) { r.add(d); st.push(d); }
    memo.set(c, r);
    return r;
  };
  return (from, to) => {
    const a = comp.get(from), b = comp.get(to);
    return a !== undefined && b !== undefined && reachableFrom(a).has(b);
  };
}


/** Erlang-2 survival: share of trips with mean length L longer than r. */
const longerThan = (rKm: number, meanKm: number) => { const x = 2 * rKm / meanKm; return (1 + x) * Math.exp(-x); };
/** Erlang-2 deterrence (density shape) for a trip of d km with mean length L. */
const deterrence = (dKm: number, meanKm: number) => { const d = Math.max(0.1, dKm); return d * Math.exp(-2 * d / meanKm); };

/** Convex hull (lng/lat), for the area's outline. */
function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const RAYS = 16;
/** Distances (km) from a point to the area outline along RAYS directions. */
function rayDistancesKm(point: readonly number[], outline: [number, number][]): number[] {
  const kx = M_PER_DEG_LAT * Math.cos(point[1] * Math.PI / 180);
  const poly = outline.map(([x, y]) => [(x - point[0]) * kx, (y - point[1]) * M_PER_DEG_LAT]);
  const out: number[] = [];
  for (let k = 0; k < RAYS; k++) {
    const a = (2 * Math.PI * k) / RAYS, dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (x1 * ey - y1 * ex) / den, u = (x1 * dy - y1 * dx) / den;
      if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    out.push(Number.isFinite(best) ? best / 1000 : 0);
  }
  return out;
}

/** Share of an endpoint's trips (mean length L km) that cross the area's edge. */
export function externalShare(point: readonly number[], outline: [number, number][], meanKm: number): number {
  if (outline.length < 3) return 1;
  const rays = rayDistancesKm(point, outline);
  return rays.reduce((n, r) => n + longerThan(r, meanKm), 0) / rays.length;
}

export interface AreaDemandOptions {
  /** Leave out traffic crossing the area (land-use trips only), to see what the area's own buildings make. */
  through?: boolean;
  /** Snap distance from a trip end to the area's roads (m). */
  accessM?: number;
  /** Calibrated window edge flows (null/undefined: class-typical flows per lane everywhere). */
  calibratedEdgeFlows?: CalibratedEdgeFlows | null;
  /** City-wide estimated traffic (EstimatedTraffic.ts): edge flows road by road where no calibrated window covers the link. */
  estimatedTraffic?: EstimatedTrafficModel | null;
  /**
   * Trips that start and end inside the area from the estimated CMP-2024 zone population and employment (p11,
   * docs/urbanos/SIM_USER_TEST_P11.md §1): where the project holds less activity than the zones imply, the rest is added on
   * the area's streets, and the edge flows are taken whole (the area's own trips take their share, the rest is through).
   * Needs `estimatedTraffic` with zones.
   */
  estimatedLandUse?: boolean;
}

/** Cell size (m) of the estimated land use spread over an area's streets. */
export const LAND_USE_CELL_M = 250;

/**
 * Peak-hour OD demand for a study area: internal, land-use <-> edge and
 * through trips (see the module comment). Coordinates, not node ids, so the
 * same demand can be replayed after a road edit.
 */
export function compileAreaDemand(context: SimulationContext, area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, options: AreaDemandOptions = {}): DemandPlan | null {
  const period = context.period ?? 'AM_Peak';
  const accessM = options.accessM ?? 250;
  const net: TrafficNetwork = area.network;
  const includedNodes = new Set<string>();
  const included = new Set(area.segments.map(s => s.key));
  for (const e of net.edges.values()) if (included.has(segmentKey(e.id))) { includedNodes.add(e.fromNodeId); includedNodes.add(e.toNodeId); }
  const nodes = [...includedNodes].map(id => net.nodes.get(id)!).filter(Boolean);

  // A trip end belongs to the area when one of its ground-level roads is within reach
  const grid = new Map<string, typeof nodes>();
  const cell = (lng: number, lat: number) => `${Math.floor(lng / 0.003)}:${Math.floor(lat / 0.003)}`;
  for (const n of nodes) { const k = cell(n.coordinates[0], n.coordinates[1]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(n); }
  const snap = (p: readonly number[]) => {
    const cx = Math.floor(p[0] / 0.003), cy = Math.floor(p[1] / 0.003);
    let best: (typeof nodes)[number] | null = null, bd = accessM;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const n of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      if (Math.abs((n.coordinates[2] || 0) - (p[2] || 0)) > 3) continue;
      const d = distM(p, n.coordinates);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  const b = area.bounds;
  const padLat = 250 / M_PER_DEG_LAT, padLng = padLat / Math.cos((b.minLat + b.maxLat) / 2 * Math.PI / 180);
  const { origins, destinations } = activityEndpoints(context, { minLng: b.minLng - padLng, maxLng: b.maxLng + padLng, minLat: b.minLat - padLat, maxLat: b.maxLat + padLat });
  // Edge flows of the estimated traffic are taken at the period's reference hour (09:00 / 19:00, timeOfDay.COUNT_HOURS); the
  // hour factor then scales the plan to the clock hour with the same Pune profile the dataset uses
  const landUseModel = options.estimatedLandUse && options.estimatedTraffic?.zones?.rows?.length ? options.estimatedTraffic : null;
  const cordon = cordonOf(area, roads, options.calibratedEdgeFlows ? { flows: options.calibratedEdgeFlows, period } : undefined,
    options.estimatedTraffic ? { model: options.estimatedTraffic, hour: period === 'PM_Peak' ? 19 : 9, ...(landUseModel ? { edgeScale: 1 } : {}) } : undefined);
  const calibratedPoints = cordon.filter(c => c.flowSource === 'calibrated').length;
  const estimatedPoints = cordon.filter(c => c.flowSource === 'estimated').length;
  if (!cordon.length && !origins.length && !destinations.length) return null;
  // Directed reachability on the area's roads: an edge trip is only sent where it can actually drive
  const fwd = new Map<string, string[]>(), bwd = new Map<string, string[]>();
  for (const e of net.edges.values()) {
    if (!included.has(segmentKey(e.id))) continue;
    (fwd.get(e.fromNodeId) ?? fwd.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
    (bwd.get(e.toNodeId) ?? bwd.set(e.toNodeId, []).get(e.toNodeId)!).push(e.fromNodeId);
  }
  const reach = (start: string, adj: Map<string, string[]>) => {
    const seenN = new Set([start]), stack = [start];
    while (stack.length) for (const n of adj.get(stack.pop()!) ?? []) if (!seenN.has(n)) { seenN.add(n); stack.push(n); }
    return seenN;
  };
  const canReach = reachability(fwd);
  const fromEntry = new Map(cordon.filter(c => c.inLanes > 0).map(c => [c.nodeId, reach(c.nodeId, fwd)]));
  const toExit = new Map(cordon.filter(c => c.outLanes > 0).map(c => [c.nodeId, reach(c.nodeId, bwd)]));
  const outline = hull(cordon.length >= 3 ? cordon.map(c => [c.coordinates[0], c.coordinates[1]]) : nodes.map(n => [n.coordinates[0], n.coordinates[1]]));

  // Trip ends of the area's activity, merged per road node they reach
  type End = { nodeId: string; point: [number, number, number]; vehicles: Map<VehicleKind, number>; gateway: boolean };
  // Frontage per node: half the length of the local and collector stretches meeting there (where zone activity lives)
  const frontage = new Map<string, number>();
  for (const e of net.edges.values()) {
    if (!included.has(segmentKey(e.id)) || e.id.endsWith('_bwd')) continue;
    const cls = roads.get(e.roadId)?.roadClass ?? 'local';
    if (cls !== 'local' && cls !== 'collector') continue;
    for (const id of [e.fromNodeId, e.toNodeId]) frontage.set(id, (frontage.get(id) ?? 0) + e.length / 2);
  }
  const inPolygon = (p: readonly number[], poly: readonly (readonly number[])[]) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], c = poly[j];
      if ((a[1] > p[1]) !== (c[1] > p[1]) && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) r = !r;
    }
    return r;
  };
  const merge = (list: ActivityEndpoint[]) => {
    const byNode = new Map<string, End>();
    let dropped = 0;
    const addTo = (n: (typeof nodes)[number], e: ActivityEndpoint, share: number) => {
      const end = byNode.get(n.id) ?? byNode.set(n.id, { nodeId: n.id, point: [...n.coordinates] as [number, number, number], vehicles: new Map(), gateway: false }).get(n.id)!;
      for (const [k, v] of e.vehicles) end.vehicles.set(k, (end.vehicles.get(k) ?? 0) + v * share);
    };
    for (const e of list) {
      // A residual zone's activity is spread over the streets inside it, not put at its centroid
      if (e.spread && e.spread.length >= 3) {
        const inside = nodes.filter(n => (frontage.get(n.id) ?? 0) > 0 && inPolygon(n.coordinates, e.spread!));
        const total = inside.reduce((x, n) => x + frontage.get(n.id)!, 0);
        if (total > 0) { for (const n of inside) addTo(n, e, frontage.get(n.id)! / total); continue; }
      }
      const n = snap(e.point);
      if (!n) { dropped += e.flow; continue; }
      // Gateways stay separate: their flows already cross the edge
      const key = e.gateway ? `g:${e.id}` : n.id;
      const end = byNode.get(key) ?? byNode.set(key, { nodeId: n.id, point: [...n.coordinates] as [number, number, number], vehicles: new Map(), gateway: !!e.gateway }).get(key)!;
      for (const [k, v] of e.vehicles) end.vehicles.set(k, (end.vehicles.get(k) ?? 0) + v);
    }
    return { ends: [...byNode.values()], dropped };
  };
  // Estimated zone land use (CMP-2024 population + employment, kernel-spread): the activity the project does not hold here
  let landUse: NonNullable<DemandComponents['landUse']> | null = null;
  if (landUseModel && outline.length >= 3) {
    landUse = { residents: 0, employees: 0, originVph: 0, destinationVph: 0, projectOriginVph: 0, projectDestinationVph: 0, cells: 0, noStreet: 0 };
    const lat0 = (b.minLat + b.maxLat) / 2, dLat = LAND_USE_CELL_M / M_PER_DEG_LAT, dLng = dLat / Math.cos(lat0 * Math.PI / 180);
    const cellKm2 = (LAND_USE_CELL_M / 1000) ** 2;
    const lots = nodes.filter(n => (frontage.get(n.id) ?? 0) > 0);
    const byCell = new Map<string, (typeof nodes)[number]>();
    for (const n of lots) {
      const k = `${Math.floor((n.coordinates[0] - b.minLng) / dLng)}:${Math.floor((n.coordinates[1] - b.minLat) / dLat)}`;
      const cur = byCell.get(k);
      if (!cur || frontage.get(n.id)! > frontage.get(cur.id)!) byCell.set(k, n);
    }
    const cells: { node: (typeof nodes)[number]; pop: number; emp: number }[] = [];
    for (let i = 0; b.minLng + i * dLng < b.maxLng; i++) for (let j = 0; b.minLat + j * dLat < b.maxLat; j++) {
      const c = [b.minLng + (i + 0.5) * dLng, b.minLat + (j + 0.5) * dLat];
      if (!inPolygon(c, outline)) continue;
      const d = zoneDensityAt(landUseModel, c[0], c[1]);
      if (!d) continue;
      const pop = d.pop * cellKm2, emp = d.emp * cellKm2;
      landUse.residents += pop; landUse.employees += emp;
      // The cell's busiest street end, else the nearest street within 400 m (a river, a hill or a campus has none)
      let node = byCell.get(`${i}:${j}`);
      if (!node) { let bd = 400; for (const n of lots) { const dd = distM(c, n.coordinates); if (dd < bd) { bd = dd; node = n; } } }
      if (!node) { landUse.noStreet += pop + emp; continue; }
      cells.push({ node, pop, emp });
    }
    // Only what the project's own buildings and zones do not already make here is added (in vehicles, per end)
    const inArea = (e: ActivityEndpoint) => !e.gateway && inPolygon(e.point, outline);
    landUse.projectOriginVph = origins.filter(inArea).reduce((n, e) => n + e.flow, 0);
    landUse.projectDestinationVph = destinations.filter(inArea).reduce((n, e) => n + e.flow, 0);
    const full = cells.map(c => landUseVehicles(c.pop, c.emp, period));
    const tot = (role: 'origin' | 'destination') => full.reduce((n, v) => n + (v ? v[role].reduce((x, [, y]) => x + y, 0) : 0), 0);
    const oTot = tot('origin'), dTot = tot('destination');
    const fo = oTot > 0 ? Math.max(0, oTot - landUse.projectOriginVph) / oTot : 0, fd = dTot > 0 ? Math.max(0, dTot - landUse.projectDestinationVph) / dTot : 0;
    cells.forEach((c, k) => {
      const v = full[k];
      if (!v) return;
      const o = v.origin.map(([kind, x]) => [kind, x * fo] as [VehicleKind, number]), d = v.destination.map(([kind, x]) => [kind, x * fd] as [VehicleKind, number]);
      const of = o.reduce((n, [, x]) => n + x, 0), df = d.reduce((n, [, x]) => n + x, 0);
      const point = [...c.node.coordinates] as [number, number, number];
      if (of > 0) origins.push({ id: `lu:${k}`, point, flow: of, vehicles: o });
      if (df > 0) destinations.push({ id: `lu:${k}`, point, flow: df, vehicles: d });
      landUse!.originVph += of; landUse!.destinationVph += df;
    });
    landUse.cells = cells.length;
  }
  const prod = merge(origins), attr = merge(destinations);

  const trips: DemandPlan['trips'] = [];
  const components: DemandComponents = { internal: 0, outbound: 0, inbound: 0, through: 0, outsideArea: prod.dropped + attr.dropped, noEdgeRoute: 0, ...(landUse ? { landUse } : {}) };
  // A closed network (no road crosses the edge) is the whole modelled world: every trip stays inside it
  const share = (point: readonly number[], L: number) => cordon.length ? externalShare(point, outline, L) : 0;
  const usedIn = new Map<string, number>(), usedOut = new Map<string, number>();
  const push = (from: [number, number, number], to: [number, number, number], vph: number, kind: VehicleKind, part: 'internal' | 'outbound' | 'inbound' | 'through') => {
    if (vph > 1e-6 && distM(from, to) > 1) trips.push({ from: [...from], to: [...to], vehiclesPerHour: vph, kind, part });
  };
  const MAX_INTERNAL = 24, MAX_EDGE = 12;
  const attrTotal = (e: End) => [...e.vehicles.values()].reduce((n, v) => n + v, 0);
  const edgeWeights = (point: readonly number[], meanKm: number, side: 'in' | 'out', nodeId: string) => {
    const w = cordon.filter(c => side === 'out' ? toExit.get(c.nodeId)?.has(nodeId) : fromEntry.get(c.nodeId)?.has(nodeId)).map(c => ({ c, w: (side === 'out' ? c.outLanes : c.inLanes) * Math.max(60, side === 'out' ? c.outVph / Math.max(1, c.outLanes) : c.inVph / Math.max(1, c.inLanes)) * Math.exp(-distM(point, c.coordinates) / 1000 / meanKm) }))
      .filter(x => x.w > 0).sort((p, q) => q.w - p.w).slice(0, MAX_EDGE);
    const sum = w.reduce((n, x) => n + x.w, 0);
    return sum > 0 ? w.map(x => ({ c: x.c, share: x.w / sum })) : [];
  };

  // 1 + 2a: trips made by the area's productions (homes in the AM peak, jobs in the PM peak)
  for (const o of prod.ends) {
    for (const [kind, vph] of o.vehicles) {
      const L = MEAN_TRIP_KM[kind] ?? DEFAULT_TRIP_KM;
      // Only destinations the origin can drive to: a one-way street or a cut-off piece is not reached by drawing a line to it
      const options2 = attr.ends.filter(d => canReach(o.nodeId, d.nodeId)).map(d => ({ d, w: attrTotal(d) * deterrence(distM(o.point, d.point) / 1000, L) })).filter(x => x.w > 0 && distM(o.point, x.d.point) > 1)
        .sort((p, q) => q.w - p.w).slice(0, MAX_INTERNAL);
      const wSum = options2.reduce((n, x) => n + x.w, 0);
      const ext = wSum > 0 ? (o.gateway ? 0 : share(o.point, L)) : 1;
      for (const { d, w } of options2) { push(o.point, d.point, vph * (1 - ext) * w / wSum, kind, 'internal'); components.internal += vph * (1 - ext) * w / wSum; }
      const exits = edgeWeights(o.point, L, 'out', o.nodeId);
      if (!exits.length) components.noEdgeRoute! += vph * ext;
      for (const { c, share } of exits) {
        push(o.point, c.coordinates, vph * ext * share, kind, 'outbound');
        components.outbound += vph * ext * share;
        usedOut.set(c.nodeId, (usedOut.get(c.nodeId) ?? 0) + vph * ext * share);
      }
    }
  }
  // 2b: trips attracted by the area from beyond its edge
  for (const d of attr.ends) {
    for (const [kind, vph] of d.vehicles) {
      const L = MEAN_TRIP_KM[kind] ?? DEFAULT_TRIP_KM;
      if (d.gateway) continue; // reached from the area's own trips only
      const ext = share(d.point, L);
      const entries = edgeWeights(d.point, L, 'in', d.nodeId);
      if (!entries.length) components.noEdgeRoute! += vph * ext;
      for (const { c, share } of entries) {
        push(c.coordinates, d.point, vph * ext * share, kind, 'inbound');
        components.inbound += vph * ext * share;
        usedIn.set(c.nodeId, (usedIn.get(c.nodeId) ?? 0) + vph * ext * share);
      }
    }
  }
  // 3: through traffic on the main roads: the edge flow the area's own trips do not account for
  if (options.through !== false) {
    const rows = cordon.map(c => Math.max(0, c.inVph - (usedIn.get(c.nodeId) ?? 0)));
    const cols = cordon.map(c => Math.max(0, c.outVph - (usedOut.get(c.nodeId) ?? 0)));
    const n = cordon.length;
    // Seed: crossing the area is the point of a through trip, so farther pairs weigh more; never back out where it came in.
    // Through traffic mostly stays on its road: an exit on the same named road or route weighs SAME_ROAD_WEIGHT times more (assumption).
    const keysOf = cordon.map(c => roadKeys(roads.get(c.roadId)));
    const seed: number[][] = cordon.map((a, i) => cordon.map((c, j) => {
      if (i === j || rows[i] <= 0 || cols[j] <= 0 || !fromEntry.get(a.nodeId)?.has(c.nodeId)) return 0;
      const d = distM(a.coordinates, c.coordinates);
      if (d < 300 || a.roadId === c.roadId && d < 600) return 0;
      const same = [...keysOf[i]].some(k => keysOf[j].has(k));
      return (d / 1000) * (same ? SAME_ROAD_WEIGHT : 1);
    }));
    const m = seed.map(r => [...r]);
    for (let it = 0; it < 30; it++) {
      for (let i = 0; i < n; i++) { const s = m[i].reduce((x, y) => x + y, 0); if (s > 0) for (let j = 0; j < n; j++) m[i][j] *= rows[i] / s; }
      for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += m[i][j]; if (s > 0) for (let i = 0; i < n; i++) m[i][j] *= cols[j] / s; }
    }
    // Rows and columns cannot both be met when entry and exit flows differ: trim so that neither an entry nor an exit
    // carries more than its edge flow (scaling a column down never pushes a row back up)
    for (let i = 0; i < n; i++) { const s = m[i].reduce((x, y) => x + y, 0); if (s > rows[i]) for (let j = 0; j < n; j++) m[i][j] *= rows[i] / s; }
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += m[i][j]; if (s > cols[j]) for (let i = 0; i < n; i++) m[i][j] *= cols[j] / s; }
    const mix = VEHICLE_TYPES.filter(t => t.share > 0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = m[i][j];
      if (v < 0.5) continue;
      components.through += v;
      for (const t of mix) push(cordon[i].coordinates, cordon[j].coordinates, v * t.share, t.kind, 'through');
    }
  }
  const total = trips.reduce((n, t) => n + t.vehiclesPerHour, 0);
  // Through traffic switched off where the area's own buildings make no trips: the case the user asked for has no
  // traffic, which is a result (every road empty), not a failure. Null (no demand at all) only when through traffic
  // would not add any either (docs/OVERHAUL.md §27.7: Sangamwadi deck, 1 km, an error state naming a wrong cause)
  if (total <= 0 && (options.through !== false || !cordon.length)) return null;
  if (total <= 0) {
    return {
      trips: [],
      provenance: {
        source: 'project-estimate',
        label: 'Estimated peak-hour demand: trips of the area\'s buildings only, through traffic switched off. The project holds no buildings or zones with activity here, so there are no trips: 0 veh/h. Switch through traffic back on to see the traffic crossing the area.',
        period, vehiclesPerHour: 0, pairCount: 0,
        components: { ...components, cordonPoints: cordon.length, calibratedCordonPoints: calibratedPoints, estimatedCordonPoints: estimatedPoints, throughIncluded: false },
      },
    };
  }
  const breakdown = demandBreakdownText(components, total);
  const own = components.internal + components.outbound + components.inbound >= 0.5;
  return {
    trips,
    provenance: {
      source: 'project-estimate',
      label: `Estimated peak-hour demand: ${own ? 'trips of the area\'s buildings (CMP 2018 Pune rates and trip lengths) plus ' : ''}traffic crossing the edge ${calibratedPoints
        ? `at flows from the central-Pune window calibrated to ${options.calibratedEdgeFlows!.periods[period as 'AM_Peak' | 'PM_Peak']?.calibrationSites.length ?? 0} 2008 counts (${calibratedPoints} of ${cordon.length} edge roads; the rest at class-typical flows)`
        : estimatedPoints
          ? `at the city-wide estimated flows (${options.estimatedTraffic!.id}, ${options.estimatedTraffic!.label}; ${estimatedPoints} of ${cordon.length} edge roads), calibrated to estimated data`
          : 'on main roads at counted Pune arterial flows'}${landUse ? `; trips of the estimated CMP-2024 zone population and employment not held by the project (${Math.round(landUse.residents).toLocaleString('en-IN')} residents, ${Math.round(landUse.employees).toLocaleString('en-IN')} jobs here; estimated, project-level, not for decisions)` : ''}. ${breakdown} Not measured on these roads.`,
      period, vehiclesPerHour: total, pairCount: trips.length,
      components: { ...components, cordonPoints: cordon.length, calibratedCordonPoints: calibratedPoints, estimatedCordonPoints: estimatedPoints, throughIncluded: options.through !== false },
    },
  };
}

/**
 * The demand line of the report and the panel: what share of the trips start or end in the area and what share only
 * cross it. Parts that are zero are left out; when the area's own trips are all zero it says so and why (p11 user
 * test, S3: "0 internal, 0 to/from beyond the edge, 30193 through veh/h" for an area that was all through traffic).
 */
export function demandBreakdownText(c: { internal: number; outbound: number; inbound: number; through: number; noEdgeRoute?: number }, total: number): string {
  const f = (v: number) => Math.round(v).toLocaleString('en-IN');
  const edge = c.outbound + c.inbound;
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const left = (c.noEdgeRoute ?? 0) >= 1 ? ` ${f(c.noEdgeRoute!)} veh/h of the area's trips are left out (no drivable way to the edge).` : '';
  if (internal0(c.internal) && internal0(edge)) {
    return `All ${f(total)} veh/h is through traffic: it enters and leaves by the roads crossing the edge. No trips start or end in the area, ${(c.noEdgeRoute ?? 0) >= 1 ? `because the area's own ${f(c.noEdgeRoute!)} veh/h have no drivable way to the edge and are left out` : 'because the project holds no buildings or zones with activity here'}, so local access traffic is missing.`;
  }
  const parts: string[] = [];
  if (!internal0(c.internal)) parts.push(`${f(c.internal)} within the area (${pct(c.internal)}%)`);
  if (!internal0(edge)) parts.push(`${f(edge)} between the area and beyond its edge (${pct(edge)}%)`);
  parts.push(internal0(c.through) ? 'no through traffic' : `${f(c.through)} through, crossing it (${pct(c.through)}%)`);
  return `${f(total)} veh/h in all: ${parts.join(', ')}.${left}`;
}
const internal0 = (v: number) => !(v >= 0.5);

/** The calibrated window shipped with the app (backend/data/calibrated_flows). */
export const DEFAULT_CALIBRATED_EDGE_FLOWS = 'pune_central_window_v1';
export async function fetchCalibratedEdgeFlows(id = DEFAULT_CALIBRATED_EDGE_FLOWS): Promise<CalibratedEdgeFlows> {
  // Not shipped (TRAFFIC_CALIBRATION_P9.md): ask what is installed first, so its absence is not a failed request in the console
  const installed = await apiGet<{ files: string[] }>('/api/calibrated-flows');
  if (!installed.files.includes(id)) throw new Error(`calibrated-flow file ${id} is not installed`);
  const doc = await apiGet<{ id: string; window: { bounds: CalibratedEdgeFlows['bounds'] }; periods: CalibratedEdgeFlows['periods'] }>(`/api/calibrated-flows/${encodeURIComponent(id)}`);
  if (!doc?.window?.bounds || !doc.periods) throw new Error(`Calibrated flows ${id}: no window or periods`);
  return { id: doc.id, bounds: doc.window.bounds, periods: doc.periods };
}
