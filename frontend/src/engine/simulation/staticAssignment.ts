import type { StudyArea, DrivableObject } from './StudyAreaExplorer';
import type { MicroDemandTrip, VehicleKind } from './TrafficMicroSim';
import { VEHICLE_TYPES, JOIN_JUNCTION_M, MAX_JUNCTION_SPAN_M, SIGNAL_AMBER_S, SIGNAL_ALL_RED_S } from './TrafficMicroSim';
import { midblockCapacityPcu, ircCategory } from './roadParameters';
import { DEFAULT_SUPPLY, type SupplyParams } from './supplyParams';
import { indoHcmSaturationFlow } from './signalTiming';
import { RESTRICTED_ENTRY_S, isAccessRestricted } from './accessRestriction';
import { compileJunctionEdits, armGreenRatio, connectedEntryLanes, turnBansFor, cycleOf, type JunctionEditSpec, type CompiledJunction, type TurnBans } from './junctionControl';
import { STARTUP_LOST_S, websterTiming } from './signalTiming';
import { nodeKey } from './junctionGroups';
import { entryCapacityPcu } from '../streetDesign/roundabout';
import type { RoundaboutEffect } from '../streetDesign/network';
import { P14, type SupplyModel, type FrictionClass } from './supplyConfig';
import { p14LinkSupply, p14TimeRatio, SIGNAL_TO_MIDBLOCK_PCU, frictionByRoad, gapCapacityPcu, controlDelayS, priorityDelayS, gaps, decelAccelS, roundaboutEntryPcu, inferredSignalPoints, approachRank, roadGroupKey, type BuildingPoint } from './indianSupply';

/**
 * Area-wide static traffic assignment (deterministic user equilibrium).
 *
 * Why (docs/OVERHAUL.md §9): the micro-simulator alone cannot carry a 2 km
 * study area's demand. Little's law puts about 28,000 veh/h x 9 min mean trip
 * time = 4,200 vehicles on the roads at once even with no congestion, against
 * the simulator's 5,000-vehicle limit, so half the demand waited outside the
 * area, the selected road ran nearly empty and every result was "demand
 * exceeds capacity". Route choice also came from one jammed run.
 *
 * The planning-standard answer (Sheffi 1985, Urban Transportation Networks,
 * ch. 5) is used for the whole area: Frank-Wolfe user equilibrium with BPR
 * link costs. It gives every road's volume and volume/capacity ratio, the
 * bottlenecks of the area, where a road's traffic comes from and goes
 * (select-link, from stored path flows) and the demand that crosses any
 * smaller sub-area, deterministically and in seconds. The micro-simulator is
 * then run on the neighbourhood of the selected road only (analysisJob.ts),
 * fed by the paths this assignment sends through it, where queues, signals
 * and spill-back are modelled vehicle by vehicle.
 *
 * Link cost: t = t0 (1 + 0.15 (x/c)^4) (BPR 1964, Traffic Assignment Manual),
 * t0 = length / free-flow speed + uniform signal delay at a signalised
 * approach (Webster: C (1 - g/C)^2 / 2). Capacity c in PCU/h = the smaller of
 * the IRC:106-1990 mid-block capacity and the stop-line capacity of a
 * signalised approach (Indo-HCM width-based saturation flow x g/C). Flows are
 * in PCU (IRC:106 factors of VEHICLE_TYPES); vehicles are carried alongside.
 * Not modelled here: queues and spill-back (a link over capacity just costs
 * more), turn bans, signal coordination. Those are what the corridor
 * micro-simulation is for.
 *
 * Access restrictions (docs/OVERHAUL.md §17): a road OpenStreetMap tags as
 * not open to the public (access, vehicle or motor_vehicle = private,
 * destination, delivery, customers, permit, residents; a campus or gated
 * service road) is used only at the start or the end of a trip, never as a
 * through route. This is the OSRM car profile's routability rule (a turn from
 * an unrestricted onto a restricted way costs max_turn_weight): entering a
 * restricted run from a public road costs RESTRICTED_ENTRY_S, a prohibitive
 * but finite cost, so a trip that can only reach its destination through one
 * still gets a route.
 */

export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
/** Assumed cycle and lost time per phase for signalised approaches in the assignment (s). The corridor simulation times signals by Webster. */
export const ASSIGN_CYCLE_S = 120;
export const ASSIGN_LOST_PER_PHASE_S = 4;
export { RESTRICTED_ACCESS, RESTRICTED_ENTRY_S, isAccessRestricted } from './accessRestriction';
/** A signal belongs to a node within this distance (m), as in the micro-simulator. */
const SIGNAL_MATCH_M = 35;
const LANE_WIDTH_M = 3.5;

/** PCU per vehicle kind in the assignment (exported read-only use; the validation harness's hypothetical PCU option swaps values in its own process). */
export const PCU: Record<string, number> = Object.fromEntries(VEHICLE_TYPES.map(t => [t.kind, t.pcu]));
/** p14: mid-block PCU per vehicle kind (Indo-HCM 2017 Table 5.2, supplyConfig.ts). */
export const PCU_P14: Record<string, number> = { ...PCU, ...P14.pcuMidblock.value };

export interface AssignLink {
  index: number;
  id: string;
  segmentKey: string;
  roadId: string;
  from: number;
  to: number;
  lengthM: number;
  lanes: number;
  /** Free-flow running time plus uniform signal delay (s). */
  t0: number;
  freeSpeedKmh: number;
  midblockPcu: number;
  /** Stop-line capacity at a signalised approach (PCU/h), else null. */
  stopLinePcu: number | null;
  gC: number | null;
  capacityPcu: number;
  /** On a road open only for local access (isAccessRestricted): usable at the start or end of a trip, not through. */
  restricted: boolean;
  /** p14 only: the road's side-friction level and the car free-flow speed (km/h) before the mixed-stream share (freeSpeedKmh is the stream speed). */
  friction?: FrictionClass;
  carFfsKmh?: number;
  /** p14 only: control at the junction this link enters when it has no signal: give-way from a minor road, right turn from the major road, roundabout entry. */
  junction?: 'minor' | 'majorRight' | 'roundabout';
  /** p16: a minor approach that only merges into one one-way carriageway (crosses nothing). */
  junctionMerge?: boolean;
  /**
   * p17 (P14.signalTimingWebster): an approach of a signal the assignment times itself: its saturation flow (mid-block PCU/h,
   * green 1), the time and stop-line capacity of the link without the junction signal (running + mid-block crossings).
   */
  signalApproach?: { satPcu: number; t0NoSignal: number; stopNoSignal: number | null };
}

export interface AssignOd { from: number; to: number; veh: number; pcu: number; kinds: Map<VehicleKind, number> }

export interface AssignmentResult {
  nodes: string[];
  nodeCoords: [number, number, number][];
  links: AssignLink[];
  volPcu: Float64Array;
  volVeh: Float64Array;
  timeS: Float64Array;
  ods: AssignOd[];
  /** Path table (link indices) and, per OD, its paths with their share of the OD flow. */
  paths: Int32Array[];
  odPaths: { pathId: number; share: number }[][];
  iterations: number;
  relativeGap: number;
  gapHistory: number[];
  unroutedVeh: number;
  elapsedMs: number;
  /** Which supply model ran (supplyConfig.ts). */
  supplyModel: SupplyModel;
  /** p14: delay at the unsignalised junction or roundabout each link enters (s/veh, included in timeS). */
  junctionDelayS?: Float64Array;
  /** p14: capacity of the junction movement each link enters (PCU/h; 0 where none), from the final conflicting flows. */
  junctionCapacityPcu?: Float64Array;
  /** p14: junctions taken as signalised with no mapped signal (indianSupply.inferredSignalPoints, and p16's warranted ones), as [lng, lat]. */
  inferredSignalPoints?: [number, number][];
  /** p16: of those, the junctions signalised by the IRC:93 volume warrant (signalWarrantScale). */
  warrantedSignalPoints?: [number, number][];
}

export interface AssignmentOptions {
  signalPoints?: readonly (readonly [number, number])[];
  /** Edits to imported junctions (junctionControl.ts): their signal plans, connected lanes and banned turns. */
  junctionEdits?: readonly JunctionEditSpec[];
  maxIterations?: number;
  targetGap?: number;
  /** Stop after this long (ms) and report the gap reached. */
  maxMs?: number;
  /** p13 tuned (estimated) supply parameters; absent = the defaults (DEFAULT_SUPPLY), the pre-p13 behaviour. */
  supply?: Readonly<SupplyParams> | null;
  /** p14: the Indian urban supply model (supplyConfig.ts, docs/urbanos/SUPPLY_P14.md); absent or 'p13' = the model as before. */
  supplyModel?: SupplyModel;
  /** p14: OSM building centroids for the side-friction inference (indianSupply.frictionByRoad); absent = access points only. */
  buildings?: readonly BuildingPoint[] | null;
  /**
   * p14 (DEMAND_P14.md §4): perceived-cost factor on residential, living_street and service roads in ROUTE CHOICE only
   * (a link-type generalised-cost factor, as SATURN / VISUM link types carry): through routes prefer the road hierarchy,
   * trips that start or end on such a street still use it. Reported link times stay real times. Absent or 1 = off.
   */
  localCostFactor?: number;
  /**
   * p16 (p14 supply only): signals by IRC:93-1985 volume warrant (P14.signalWarrant). The factor from this hour's flows to
   * the flows of the 8th busiest hour of the day (the warrant asks for its volumes in each of any 8 hours); absent or ≤ 0 =
   * off. Unsignalised junctions whose scaled flows meet Warrant 1 or 2 are run as signalised, like the inferred signals.
   */
  signalWarrantScale?: number;
  /**
   * p17 (p14 supply only): 'webster' = the assignment times its signals as the micro-simulation (P14.signalTimingWebster);
   * 'fixed' = IRC:93's 120 s maximum cycle with equal greens (p13-p16). Absent = P14.signalTimingWebster (off: the p17
   * harness rule, docs/urbanos/P17_FIXES.md).
   */
  signalTiming?: 'webster' | 'fixed';
}

/** OSM classes the local-road perceived-cost factor applies to. */
export const LOCAL_ACCESS_HIGHWAYS: ReadonlySet<string> = new Set(['residential', 'living_street', 'service']);

const M_PER_DEG_LAT = 111320;
const distM = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * M_PER_DEG_LAT);
const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');

/** A two-way carriageway with a median: the road's (first) section profile, else its divider flag. */
function hasMedian(road: DrivableObject | undefined): boolean {
  if (!road) return false;
  const sec = road.type === 'road' ? road.sections?.[0] : undefined;
  return sec ? !!sec.hasMedian && (sec.medianWidth ?? 0) > 0 : !!road.hasDivider && (road.dividerWidth ?? 0) > 0;
}

/** A signalised mid-block crossing applies to a link passing within this distance of it (m). */
const MIDBLOCK_MATCH_M = 5;
function pointSegM(p: readonly number[], a: readonly number[], b: readonly number[]) {
  const kx = M_PER_DEG_LAT * Math.cos(p[1] * Math.PI / 180);
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * M_PER_DEG_LAT, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export const bprTime = (t0: number, x: number, c: number, alpha = BPR_ALPHA, beta = BPR_BETA) => t0 * (1 + alpha * Math.pow(Math.max(0, x) / Math.max(1, c), beta));

/** The area's links as an assignment network, with free-flow times and capacities. */
export function buildAssignmentNetwork(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, signalPoints?: readonly (readonly [number, number])[], junctionEdits?: readonly JunctionEditSpec[], supply: Readonly<SupplyParams> = DEFAULT_SUPPLY,
  p14: { buildings?: readonly BuildingPoint[] | null; webster?: boolean } | null = null) {
  const included = new Set(area.segments.map(s => s.key));
  const edges = [...area.network.edges.values()].filter(e => included.has(segKey(e.id)));
  const nodeIndex = new Map<string, number>();
  const nodes: string[] = [];
  const nodeCoords: [number, number, number][] = [];
  const idx = (id: string) => {
    let i = nodeIndex.get(id);
    if (i === undefined) { i = nodes.length; nodeIndex.set(id, i); nodes.push(id); nodeCoords.push([...(area.network.nodes.get(id)?.coordinates ?? [0, 0, 0])] as [number, number, number]); }
    return i;
  };
  // Signalised nodes: within SIGNAL_MATCH_M of a mapped signal and where 3+ distinct stretches meet
  const arms = new Map<string, Set<string>>();
  for (const e of edges) for (const n of [e.fromNodeId, e.toNodeId]) (arms.get(n) ?? arms.set(n, new Set()).get(n)!).add(segKey(e.id));
  const signalNear = (id: string) => {
    if (!signalPoints?.length) return false;
    const c = area.network.nodes.get(id)?.coordinates;
    if (!c) return false;
    return signalPoints.some(p => distM(p, c) < SIGNAL_MATCH_M);
  };
  // Edited junctions (docs/OVERHAUL.md §23) are controlled as edited, not by the mapped signals
  const compiled = compileJunctionEdits(area.network, junctionEdits);
  const editedAt = new Map<string, CompiledJunction>();
  // An edit that keeps the engine's own control (asRun) leaves the signals as they were
  for (const c of compiled) if (!c.controlAsRun) for (const n of c.nodeIds) editedAt.set(n, c);
  // Roundabouts drawn in Design (streetDesign/roundabout.ts) replace the junction's control: no signal (mapped or edited),
  // IRC:65 Table 9.1 entry capacity on its approaches (riding on the arm roads as streetEffects)
  const rbAt = new Map<string, RoundaboutEffect>();
  for (const e of edges) {
    const fx = (roads.get(e.roadId) as { streetEffects?: { roundabouts?: RoundaboutEffect[] } } | undefined)?.streetEffects?.roundabouts;
    if (!fx?.length) continue;
    for (const n of [e.fromNodeId, e.toNodeId]) {
      const c = area.network.nodes.get(n)?.coordinates;
      if (!c) continue;
      const k = nodeKey(c);
      const rb = fx.find(r => r.nodeKeys.includes(k));
      if (rb) rbAt.set(n, rb);
    }
  }
  for (const n of rbAt.keys()) editedAt.delete(n);
  const signalised = new Set<string>();
  const signalCandidate = (id: string) => !editedAt.has(id) && !rbAt.has(id) && (arms.get(id)?.size ?? 0) >= 3;
  if (p14 && P14.signalOneJunction.value) {
    for (const id of signalJunctionNodes(area, roads, edges, arms, signalPoints)) if (signalCandidate(id)) signalised.add(id);
  } else {
    for (const id of arms.keys()) if (signalCandidate(id) && signalNear(id)) signalised.add(id);
  }
  // Approaches per signalised node: links ending there whose start is not itself signalised (not an internal link of the junction)
  const approaches = new Map<string, number>();
  for (const e of edges) if (signalised.has(e.toNodeId) && !signalised.has(e.fromNodeId)) approaches.set(e.toNodeId, (approaches.get(e.toNodeId) ?? 0) + 1);

  const friction = p14 ? frictionByRoad(area, roads, p14.buildings) : null;
  // p14: Indo-HCM saturation flows are in signal PCUs (Table 6.3); the link flows are in mid-block PCUs (Table 5.2)
  const satPcu = p14 ? SIGNAL_TO_MIDBLOCK_PCU : 1;
  const links: AssignLink[] = edges.map((e, index) => {
    const road = roads.get(e.roadId);
    const lanes = Math.max(1, e.lanes || 1);
    // Every drivable object carries its own one-way flag: a two-way flyover / double-deck deck is two directions of one
    // structure, not two one-way streets (before, every deck was read as a one-way street: IRC:106 '2-oneway', about a
    // third above the divided-road value; docs/urbanos/BUILD_PROPAGATION.md)
    const oneWay = road ? !!road.isOneWay : true;
    const hw = road?.type === 'road' ? road.osmProvenance?.originalTags?.highway ?? '' : '';
    // One-way main roads are taken to be carriageways of divided roads (OSM maps those as two one-way ways); one-way minor roads as one-way streets (assumption).
    // A two-way road or deck with a median (a drawn arterial, a divided cross-section template, a deck with a divider) is a divided carriageway pair.
    const divided = oneWay ? /^(motorway|trunk|primary|secondary)/.test(hw) : hasMedian(road);
    const sup = friction ? p14LinkSupply(road, lanes, !oneWay && !divided, e.speedLimit || 30, friction.get(e.roadId)?.cls ?? 'low') : null;
    const midblockPcu = (sup ? sup.capacityPcu : midblockCapacityPcu(road, lanes, !oneWay && !divided, divided)) * supply.capacityFactor;
    // p14: the link's free-flow speed is the mixed stream's (car FFS x s0); its running time t0 is at that speed
    const speed = sup ? Math.max(8, sup.streamKmh * supply.speedFactor[ircCategory(road)]) : Math.max(10, (e.speedLimit || 30) * supply.speedFactor[ircCategory(road)]);
    let stopLinePcu: number | null = null, gC: number | null = null, sigDelay = 0, timedApproach = 0, junctionSig = 0;
    const edited = editedAt.get(e.toNodeId);
    if (edited) {
      // An approach of an edited signal: its green from the plan (effective green = green + amber - start-up lost time, per phase serving it),
      // saturation flow from the entry lanes that feed an exit
      const arm = edited.nodeIds.has(e.fromNodeId) ? undefined : edited.approachOfEdge.get(e.id) ?? edited.chainOfEdge.get(e.id);
      const plan = edited.spec.signal;
      const ratio = arm ? armGreenRatio(edited, arm) : null;
      if (arm && plan && ratio !== null) {
        const cyc = cycleOf(plan);
        const phasesServing = plan.phases.filter(p => p.arms.includes(arm)).length;
        gC = Math.max(0.02, Math.min(1, ratio + phasesServing * (plan.amberS - STARTUP_LOST_S) / cyc));
        stopLinePcu = indoHcmSaturationFlow(connectedEntryLanes(edited.spec, arm, lanes) * LANE_WIDTH_M) * gC * supply.signalSatFactor * satPcu;
        sigDelay = cyc * (1 - gC) ** 2 / 2;
      }
    } else if (signalised.has(e.toNodeId) && !signalised.has(e.fromNodeId)) {
      const n = Math.min(4, Math.max(2, approaches.get(e.toNodeId) ?? 2));
      const cyc = supply.cycleS;
      gC = Math.max(0.1, (cyc - n * ASSIGN_LOST_PER_PHASE_S) / cyc / n);
      stopLinePcu = indoHcmSaturationFlow(lanes * LANE_WIDTH_M) * gC * supply.signalSatFactor * satPcu;
      sigDelay = cyc * (1 - gC) ** 2 / 2;
      if (p14 && (p14.webster ?? P14.signalTimingWebster.value)) { timedApproach = indoHcmSaturationFlow(lanes * LANE_WIDTH_M) * supply.signalSatFactor * satPcu; junctionSig = sigDelay; }
    }
    // Roundabout entry (IRC:65 Table 9.1, Qc assumed): capacity per entry lane x entry lanes (no more than the approach has)
    const rb = rbAt.get(e.toNodeId);
    if (rb && !rbAt.has(e.fromNodeId)) {
      const perLane = entryCapacityPcu(rb.icdM, rb.qcPcu);
      if (perLane != null) stopLinePcu = Math.min(stopLinePcu ?? Infinity, perLane * Math.max(1, Math.min(lanes, rb.entryLanes)));
    }
    // Signalised mid-block crossings on this road (streetDesign/crossings.ts): a two-phase signal where the link passes the crossing
    const mid = (road as { streetEffects?: { midblockSignals?: { point: [number, number]; gC: number; cycleS: number }[] } } | undefined)?.streetEffects?.midblockSignals;
    let midStop: number | null = null;
    if (mid?.length) for (const m of mid) {
      if (!e.coordinates.some((c, i) => i > 0 && pointSegM(m.point, e.coordinates[i - 1], c) < MIDBLOCK_MATCH_M)) continue;
      midStop = Math.min(midStop ?? Infinity, indoHcmSaturationFlow(lanes * LANE_WIDTH_M) * m.gC * satPcu);
      stopLinePcu = Math.min(stopLinePcu ?? Infinity, indoHcmSaturationFlow(lanes * LANE_WIDTH_M) * m.gC * satPcu);
      gC = Math.min(gC ?? 1, m.gC);
      sigDelay += m.cycleS * (1 - m.gC) ** 2 / 2;
    }
    const t0 = e.length / (speed / 3.6) + sigDelay;
    // p17: the junction signal's part is re-timed in the assignment (retimeSignals); keep the link without it
    const signalApproach = timedApproach > 0 ? { satPcu: timedApproach, t0NoSignal: t0 - junctionSig, stopNoSignal: midStop } : undefined;
    return { index, id: e.id, segmentKey: segKey(e.id), roadId: e.roadId, from: idx(e.fromNodeId), to: idx(e.toNodeId), lengthM: e.length, lanes,
      t0, freeSpeedKmh: speed, midblockPcu, stopLinePcu, gC, capacityPcu: Math.min(midblockPcu, stopLinePcu ?? Infinity), restricted: isAccessRestricted(road),
      ...(signalApproach ? { signalApproach } : {}),
      ...(sup ? { friction: sup.friction, carFfsKmh: sup.carFfsKmh } : {}) };
  });
  const control = p14 ? junctionControlP14(area, roads, edges, links, arms, signalised, editedAt, rbAt) : null;
  // Outgoing links per node (CSR)
  const outStart = new Int32Array(nodes.length + 1);
  for (const l of links) outStart[l.from + 1]++;
  for (let i = 0; i < nodes.length; i++) outStart[i + 1] += outStart[i];
  const outLinks = new Int32Array(links.length);
  const fill = outStart.slice(0, nodes.length);
  for (const l of links) outLinks[fill[l.from]++] = l.index;
  // Banned turns of edited junctions, over the numbered graph
  const bans = turnBansFor(compiled, nodes, links.map(l => l.id), Int32Array.from(links, l => l.from), Int32Array.from(links, l => l.to));
  return { nodes, nodeIndex, nodeCoords, links, outStart, outLinks, signalised, bans: bans && !bans.empty ? bans : null, control, friction };
}

/**
 * p17 (P14.signalOneJunction): the nodes the signal points control. Each point controls the nearest junction (3+ stretches)
 * whose centre is within SIGNAL_MATCH_M, a junction being the nodes joined by stretches shorter than JOIN_JUNCTION_M (at
 * most MAX_JUNCTION_SPAN_M across), as TrafficMicroSim.joinJunctions / junctionsWithSignals; plus the 3+-stretch nodes
 * within SIGNAL_MATCH_M of the point where only roads of that junction meet (the other carriageway of a divided crossing).
 */
function signalJunctionNodes(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, edges: readonly { id: string; roadId: string; fromNodeId: string; toNodeId: string; length: number }[],
  arms: Map<string, Set<string>>, signalPoints: readonly (readonly [number, number])[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!signalPoints?.length) return out;
  const coord = (id: string) => area.network.nodes.get(id)?.coordinates;
  const span = (ids: string[]) => {
    const cs = ids.map(id => coord(id)!), lats = cs.map(c => c[1]), lngs = cs.map(c => c[0]);
    return Math.hypot((Math.max(...lngs) - Math.min(...lngs)) * M_PER_DEG_LAT * Math.cos(lats[0] * Math.PI / 180), (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT);
  };
  const junctionOf = new Map<string, string>(), members = new Map<string, string[]>();
  const find = (id: string) => junctionOf.get(id) ?? id;
  for (const e of [...edges].filter(e => e.length < JOIN_JUNCTION_M).sort((a, b) => a.length - b.length)) {
    if (!coord(e.fromNodeId) || !coord(e.toNodeId)) continue;
    const a = find(e.fromNodeId), b = find(e.toNodeId);
    if (a === b) continue;
    const merged = [...(members.get(a) ?? [a]), ...(members.get(b) ?? [b])];
    if (span(merged) > MAX_JUNCTION_SPAN_M) continue;
    members.set(a, merged); members.delete(b);
    for (const m of merged) junctionOf.set(m, a);
  }
  const groupsAt = new Map<string, Set<string>>();
  for (const e of edges) { const g = roadGroupKey(roads.get(e.roadId), e.roadId); for (const n of [e.fromNodeId, e.toNodeId]) (groupsAt.get(n) ?? groupsAt.set(n, new Set()).get(n)!).add(g); }
  const junctions = new Map<string, { ids: string[]; c: [number, number] }>();
  for (const [id, s] of arms) {
    const c = coord(id);
    if (!c) continue;
    const j = find(id);
    if (junctions.has(j)) continue;
    const ids = (members.get(j) ?? [j]).filter(m => coord(m));
    if (!ids.some(m => (arms.get(m)?.size ?? 0) >= 3) && s.size < 3) continue;
    const cs = ids.map(m => coord(m)!);
    junctions.set(j, { ids, c: [cs.reduce((t, p) => t + p[0], 0) / cs.length, cs.reduce((t, p) => t + p[1], 0) / cs.length] });
  }
  const list = [...junctions.values()].filter(j => j.ids.some(m => (arms.get(m)?.size ?? 0) >= 3));
  for (const p of signalPoints) {
    let best: { ids: string[]; c: [number, number] } | null = null, bd = SIGNAL_MATCH_M;
    for (const j of list) { if (Math.abs(j.c[0] - p[0]) > 0.001 || Math.abs(j.c[1] - p[1]) > 0.001) continue; const d = distM(p, j.c); if (d < bd) { bd = d; best = j; } }
    if (!best) continue;
    for (const m of best.ids) out.add(m);
    const roadsOf = new Set(best.ids.flatMap(m => [...(groupsAt.get(m) ?? [])]));
    for (const [id, s] of arms) {
      if (s.size < 3 || out.has(id)) continue;
      const c = coord(id);
      if (!c || Math.abs(c[0] - p[0]) > 0.001 || Math.abs(c[1] - p[1]) > 0.001 || distM(p, c) >= SIGNAL_MATCH_M) continue;
      const g = groupsAt.get(id);
      if (g && [...g].every(k => roadsOf.has(k))) out.add(id);
    }
  }
  return out;
}

/**
 * p16: an unnamed divided road becoming a two-way one (or splitting): exactly three stretches meet, two of them one-way
 * (one arriving, one leaving) and one two-way, all of one OSM class. Nothing crosses there.
 */
function carriagewayTransition(node: string, edges: readonly { id: string; roadId: string; fromNodeId: string; toNodeId: string }[], roads: ReadonlyMap<string, DrivableObject>): boolean {
  const touching = edges.filter(e => e.fromNodeId === node || e.toNodeId === node);
  const byRoad = new Map<string, typeof touching>();
  for (const e of touching) (byRoad.get(e.roadId) ?? byRoad.set(e.roadId, []).get(e.roadId)!).push(e);
  if (byRoad.size !== 3) return false;
  const cls = new Set<string>();
  let inOneWay = 0, outOneWay = 0, twoWay = 0;
  for (const [id, es] of byRoad) {
    const r = roads.get(id);
    cls.add(((r?.type === 'road' ? r.osmProvenance?.originalTags?.highway : undefined) ?? 'drawn').replace(/_link$/, ''));
    if (r && !r.isOneWay) { twoWay++; continue; }
    if (es.some(e => e.toNodeId === node)) inOneWay++;
    if (es.some(e => e.fromNodeId === node)) outOneWay++;
  }
  return cls.size === 1 && twoWay === 1 && inOneWay === 1 && outOneWay === 1;
}

/**
 * p14: control at junctions without a signal (docs/urbanos/SUPPLY_P14.md §3). A node where 3+ stretches meet, with no
 * signal, no edited control and no drawn roundabout, is
 *  - a roundabout entry when a mapped junction=roundabout ring passes it: every link entering it from outside the ring
 *    gives way to the ring flow arriving there (IRC:65 Table 9.1, ICD from the ring's length / pi);
 *  - else a priority junction: the approaches of the best IRC category are the major road (their right-turning share
 *    yields to the opposing major flow), the others are minor approaches yielding to all major flow; when every approach
 *    has the same category the junction is uncontrolled and each approach yields to the others' flow.
 * Conflicting flows are read from the current link flows at each assignment iteration (diagonalisation: Sheffi 1985 §8.2).
 */
function junctionControlP14(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, edges: readonly { id: string; roadId: string; fromNodeId: string; toNodeId: string; length: number }[], links: AssignLink[],
  arms: Map<string, Set<string>>, signalised: Set<string>, editedAt: Map<string, unknown>, rbAt: Map<string, unknown>) {
  const L = links.length;
  const kind = new Int8Array(L); // 0 none, 1 minor, 2 major right, 3 roundabout entry
  const conflicts: number[][] = Array.from({ length: L }, () => []);
  const icd = new Float64Array(L);
  const merge = new Uint8Array(L);
  const mergeOut = new Int32Array(L).fill(-1);
  const outgoing = new Map<string, number[]>();
  edges.forEach((e, i) => (outgoing.get(e.fromNodeId) ?? outgoing.set(e.fromNodeId, []).get(e.fromNodeId)!).push(i));
  const isRing = (roadId: string) => { const r = roads.get(roadId); return r?.type === 'road' && !!r.osmProvenance?.roundabout; };
  // Rings: OSM roundabout ways joined at shared ends; ICD = ring length / pi
  const ringOfRoad = new Map<string, number>(), ringLen: number[] = [];
  {
    const parent = new Map<string, string>();
    const find = (a: string): string => { let p = parent.get(a) ?? a; while (p !== (parent.get(p) ?? p)) p = parent.get(p)!; parent.set(a, p); return p; };
    const roadIds = [...new Set(edges.filter(e => isRing(e.roadId)).map(e => e.roadId))];
    const endKey = (c: readonly number[]) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
    const byEnd = new Map<string, string>();
    for (const id of roadIds) {
      const c = roads.get(id)!.coordinates;
      for (const p of [c[0], c[c.length - 1]]) { const k = endKey(p); const o = byEnd.get(k); if (o) parent.set(find(id), find(o)); else byEnd.set(k, id); }
    }
    const idx = new Map<string, number>();
    for (const id of roadIds) {
      const root = find(id);
      if (!idx.has(root)) { idx.set(root, ringLen.length); ringLen.push(0); }
      const c = roads.get(id)!.coordinates;
      let m = 0;
      for (let i = 1; i < c.length; i++) m += Math.hypot((c[i][0] - c[i - 1][0]) * 111320 * Math.cos(c[i][1] * Math.PI / 180), (c[i][1] - c[i - 1][1]) * 111320);
      ringLen[idx.get(root)!] += m;
      ringOfRoad.set(id, idx.get(root)!);
    }
  }
  const incoming = new Map<string, number[]>();
  edges.forEach((e, i) => (incoming.get(e.toNodeId) ?? incoming.set(e.toNodeId, []).get(e.toNodeId)!).push(i));
  // p16: the roads (by name / ref) at each node: where only one road meets itself (a divided carriageway pair becoming one
  // two-way road, a carriageway splitting) nothing crosses, so there is no junction control (before, Mula Rd and Station Rd
  // at such a transition ran as an uncontrolled crossing whose approaches yielded to each other: hours of delay at 09:00)
  const groupsAt = new Map<string, Set<string>>();
  for (const e of edges) { const g = roadGroupKey(roads.get(e.roadId), e.roadId); for (const n of [e.fromNodeId, e.toNodeId]) (groupsAt.get(n) ?? groupsAt.set(n, new Set()).get(n)!).add(g); }
  for (const [node, ins] of incoming) {
    if ((arms.get(node)?.size ?? 0) < 3 || signalised.has(node) || editedAt.has(node) || rbAt.has(node)) continue;
    if ((groupsAt.get(node)?.size ?? 0) === 1 && !groupsAt.get(node)!.values().next().value!.startsWith('id:')) continue;
    if (carriagewayTransition(node, edges, roads)) continue;
    const ring = ins.filter(i => isRing(edges[i].roadId));
    if (ring.length) {
      const ringId = ringOfRoad.get(edges[ring[0]].roadId) ?? -1;
      for (const i of ins) {
        if (isRing(edges[i].roadId)) continue;
        kind[i] = 3; conflicts[i] = ring; icd[i] = ringId >= 0 ? ringLen[ringId] / Math.PI : 30;
      }
      continue;
    }
    // Priority: the approaches of the best rank (IRC category, ramps below their class) are the major road
    const rank = ins.map(i => approachRank(roads.get(edges[i].roadId)));
    const best = Math.min(...rank);
    const majors = ins.filter((_, k) => rank[k] === best);
    const oneWay = (i: number) => { const r = roads.get(edges[i].roadId); return r ? !!r.isOneWay : true; };
    if (majors.length === ins.length) {
      // Equal roads: two one-way carriageways merging are not a crossing (no control); otherwise uncontrolled, each yields to the others
      if (ins.length <= 2 && ins.every(oneWay)) continue;
      for (const i of ins) { kind[i] = 1; conflicts[i] = ins.filter(j => j !== i); }
      continue;
    }
    for (const i of ins) {
      if (majors.includes(i)) {
        // A right turn across the opposing major flow: only where an opposing major approach exists
        const opp = majors.filter(j => j !== i);
        if (opp.length) { kind[i] = 2; conflicts[i] = opp; }
      } else {
        kind[i] = 1; conflicts[i] = majors;
        // Merging into one one-way carriageway, crossing nothing
        if (majors.length === 1 && oneWay(majors[0])) {
          merge[i] = 1;
          const outs = outgoing.get(node) ?? [];
          if (outs.length === 1) mergeOut[i] = outs[0];
        }
      }
    }
  }
  kind.forEach((k, i) => { if (k) links[i].junction = k === 1 ? 'minor' : k === 2 ? 'majorRight' : 'roundabout'; if (merge[i]) links[i].junctionMerge = true; });
  void area;
  return { kind, conflicts, icd, merge, mergeOut };
}

class Heap {
  private k = new Float64Array(1024); private v = new Int32Array(1024); size = 0;
  push(key: number, val: number) {
    if (this.size === this.k.length) { const k = new Float64Array(this.size * 2); k.set(this.k); this.k = k; const v = new Int32Array(this.size * 2); v.set(this.v); this.v = v; }
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0], key = this.k[--this.size], val = this.v[this.size];
    let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= this.size) break; if (c + 1 < this.size && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= key) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
  topKey() { return this.k[0]; }
}

/**
 * Frank-Wolfe user-equilibrium assignment of the trips on the area network.
 * Deterministic: the same inputs give the same flows.
 */
export function assignTraffic(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, trips: readonly MicroDemandTrip[], o: AssignmentOptions = {}): AssignmentResult {
  if (o.supplyModel !== 'p14' || !(o.signalWarrantScale && o.signalWarrantScale > 0)) return assignOnce(area, roads, trips, o);
  // p16: a short assignment, the junctions whose flows meet the IRC:93 warrant become signalised, again (up to `rounds`),
  // then the full assignment with them
  const t0 = Date.now();
  const w = P14.signalWarrant.value;
  const warranted: [number, number][] = [];
  for (let round = 0; round < w.rounds; round++) {
    const pts = [...(o.signalPoints ?? []), ...warranted];
    const a = assignOnce(area, roads, trips, { ...o, signalPoints: pts, maxIterations: Math.min(w.afterIterations, o.maxIterations ?? 60) });
    const add = warrantedJunctions(a, o.signalWarrantScale);
    if (!add.length) break;
    warranted.push(...add);
  }
  const r = assignOnce(area, roads, trips, { ...o, signalPoints: [...(o.signalPoints ?? []), ...warranted] });
  return { ...r, elapsedMs: Date.now() - t0, inferredSignalPoints: [...(r.inferredSignalPoints ?? []), ...warranted], warrantedSignalPoints: warranted };
}

/**
 * p16: unsignalised priority / uncontrolled junctions (p14 control) whose flows x `scale` meet IRC:93-1985 Warrant 1 or 2
 * (P14.signalWarrant): major street = its approaches (or, where every approach ranks equally, the two busiest), minor =
 * the busiest other approach; lanes from those approaches. Merges of one-way carriageways and roundabout entries are not
 * candidates. Returns the junctions' points.
 */
export function warrantedJunctions(a: AssignmentResult, scale: number): [number, number][] {
  const w = P14.signalWarrant.value;
  const byNode = new Map<number, number[]>();
  a.links.forEach(l => { if (l.junction === 'minor' || l.junction === 'majorRight') (byNode.get(l.to) ?? byNode.set(l.to, []).get(l.to)!).push(l.index); });
  // Major approaches are the links that enter the node without a 'minor' control (majorRight or none)
  const into = new Map<number, number[]>();
  a.links.forEach(l => (into.get(l.to) ?? into.set(l.to, []).get(l.to)!).push(l.index));
  const out: [number, number][] = [];
  for (const [node] of byNode) {
    const ins = into.get(node) ?? [];
    if (ins.length < 2) continue;
    const vol = (i: number) => a.volVeh[i] * scale;
    const minors = ins.filter(i => a.links[i].junction === 'minor'), majors = ins.filter(i => a.links[i].junction !== 'minor');
    let maj: number[], min: number[];
    if (majors.length) { maj = majors; min = minors; }
    else { const s = [...ins].sort((x, y) => vol(y) - vol(x)); maj = s.slice(0, 2); min = s.slice(2); }
    // A slip road merging into one carriageway is not a signal candidate
    if (!min.length || min.every(i => a.links[i].junctionMerge)) continue;
    const majorVeh = maj.reduce((t, i) => t + vol(i), 0);
    const mi = min.reduce((b, i) => (vol(i) > vol(b) ? i : b), min[0]);
    const majorLanes = Math.max(...maj.map(i => a.links[i].lanes)) >= 2 ? 1 : 0, minorLanes = a.links[mi].lanes >= 2 ? 1 : 0;
    const w1 = majorVeh >= w.w1Major[majorLanes] && vol(mi) >= w.w1Minor[minorLanes];
    const w2 = majorVeh >= w.w2Major[majorLanes] && vol(mi) >= w.w2Minor[minorLanes];
    if (w1 || w2) { const c = a.nodeCoords[node]; out.push([c[0], c[1]]); }
  }
  return out;
}

function assignOnce(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, trips: readonly MicroDemandTrip[], o: AssignmentOptions = {}): AssignmentResult {
  const t0 = Date.now();
  const supply = o.supply ?? DEFAULT_SUPPLY;
  const p14 = o.supplyModel === 'p14';
  const inferred = p14 ? inferredSignalPoints(area, roads, o.signalPoints) : null;
  const signalPoints = inferred?.length ? [...(o.signalPoints ?? []), ...inferred] : o.signalPoints;
  const net = buildAssignmentNetwork(area, roads, signalPoints, o.junctionEdits, supply, p14 ? { buildings: o.buildings, webster: o.signalTiming ? o.signalTiming === 'webster' : undefined } : null);
  const alpha = supply.bprAlpha, beta = supply.bprBeta;
  const pcuOf = p14 ? PCU_P14 : PCU;
  const { links, outStart, outLinks, nodes } = net;
  const L = links.length, N = nodes.length;
  // OD pairs (by node), vehicles and PCU, kinds kept for the corridor demand
  const odIndex = new Map<string, number>();
  const ods: AssignOd[] = [];
  let unroutedVeh = 0;
  for (const t of trips) {
    const f = net.nodeIndex.get(t.fromNodeId), d = net.nodeIndex.get(t.toNodeId);
    if (f === undefined || d === undefined || f === d) { unroutedVeh += t.vehiclesPerHour; continue; }
    const key = f + '>' + d;
    let i = odIndex.get(key);
    if (i === undefined) { i = ods.length; odIndex.set(key, i); ods.push({ from: f, to: d, veh: 0, pcu: 0, kinds: new Map() }); }
    const od = ods[i];
    od.veh += t.vehiclesPerHour; od.pcu += t.vehiclesPerHour * (pcuOf[t.kind] ?? 1);
    od.kinds.set(t.kind, (od.kinds.get(t.kind) ?? 0) + t.vehiclesPerHour);
  }
  const byOrigin = new Map<number, number[]>();
  ods.forEach((od, i) => (byOrigin.get(od.from) ?? byOrigin.set(od.from, []).get(od.from)!).push(i));
  const origins = [...byOrigin.keys()];

  const x = new Float64Array(L), xv = new Float64Array(L), y = new Float64Array(L), yv = new Float64Array(L), cost = new Float64Array(L);
  // Search states per node: 0 = on public roads, 1 = on a restricted run entered at the trip's start or paid for
  const S = links.some(l => l.restricted) ? 2 : 1;
  const restricted = Uint8Array.from(links, l => (l.restricted ? 1 : 0));
  const dist = new Float64Array(N * S), pred = new Int32Array(N * S), predState = new Int32Array(N * S);
  const cap = links.map(l => l.capacityPcu), base = links.map(l => l.t0);
  // p17 (P14.signalTimingWebster): signals timed as the corridor micro-simulation times them (Webster, Indo-HCM saturation
  // flow, approach-wise phases, amber + all-red, the minimum green), at the cycle cap supply.cycleS (IRC:93 §22.2: 120 s);
  // re-timed from the current flows at RETIME_AT iterations, then held (iterative optimisation-assignment, Allsop 1974)
  const timedAt = new Map<number, number[]>();
  links.forEach((l, i) => { if (l.signalApproach) (timedAt.get(l.to) ?? timedAt.set(l.to, []).get(l.to)!).push(i); });
  /** Returns the largest change of a green ratio. */
  const retimeSignals = (flow: Float64Array) => {
    let change = 0;
    for (const ins of timedAt.values()) {
      const n = Math.min(4, Math.max(2, ins.length));
      const y = new Array(n).fill(0);
      ins.forEach((i, k) => { y[k % n] = Math.max(y[k % n], flow[i] / Math.max(1, links[i].signalApproach!.satPcu)); });
      const d = websterTiming(y.map(v => ({ flow: v, saturationFlow: 1 })), { amberS: SIGNAL_AMBER_S, allRedS: SIGNAL_ALL_RED_S, maxCycleS: supply.cycleS });
      ins.forEach((i, k) => {
        const l = links[i], sa = l.signalApproach!;
        const g = Math.max(0.02, Math.min(1, d.effectiveGreensS[k % n] / d.cycleS));
        const stop = Math.min(sa.satPcu * g, sa.stopNoSignal ?? Infinity);
        change = Math.max(change, Math.abs(g - (l.gC ?? 0)));
        l.gC = g; l.stopLinePcu = stop; l.capacityPcu = Math.min(l.midblockPcu, stop); l.t0 = sa.t0NoSignal + d.cycleS * (1 - g) ** 2 / 2;
        cap[i] = l.capacityPcu; base[i] = l.t0;
      });
    }
    return change;
  };
  // Re-timed at these iterations and whenever the assignment has converged on timings that the flows would change
  // (at most MAX_RETIMES times; settled once no green ratio moves by more than 0.005)
  const RETIME_AT = new Set([3, 6, 10, 15, 20, 30]), MAX_RETIMES = 8;
  let retimes = 0, timingSettled = !timedAt.size;
  if (timedAt.size) retimeSignals(new Float64Array(L));
  const retime = () => { retimes++; if (retimeSignals(x) < 0.005) timingSettled = true; else timingSettled = false; };
  const pathKey = new Map<string, number>();
  const paths: Int32Array[] = [];
  const odPaths: Map<number, number>[] = ods.map(() => new Map());
  const reachable = new Uint8Array(ods.length);
  const heap = new Heap();
  const scratch: number[] = [];

  // With banned turns the search runs over (node, restricted run, link the path entered a junction by): see turnSearch
  const turnSearch = net.bans ? bannedTurnSearch(net.bans, N, S, links, outStart, outLinks) : null;
  /** All-or-nothing load on the current costs; returns each OD's path id (or -1). */
  const allOrNothing = (target: Float64Array, targetVeh: Float64Array): Int32Array => {
    target.fill(0); targetVeh.fill(0);
    if (turnSearch) {
      const chosen = new Int32Array(ods.length).fill(-1);
      for (const orig of origins) {
        const tree = turnSearch(orig, cost);
        for (const oi of byOrigin.get(orig)!) {
          const od = ods[oi];
          const p = tree(od.to);
          if (!p) continue;
          reachable[oi] = 1;
          for (const li of p) { target[li] += od.pcu; targetVeh[li] += od.veh; }
          const key = p.join(',');
          let pid = pathKey.get(key);
          if (pid === undefined) { pid = paths.length; pathKey.set(key, pid); paths.push(Int32Array.from(p)); }
          chosen[oi] = pid;
        }
      }
      return chosen;
    }
    const chosen = new Int32Array(ods.length).fill(-1);
    for (const orig of origins) {
      dist.fill(Infinity); pred.fill(-1);
      // A trip starts on a restricted run only where every road out of its origin is restricted (it starts inside)
      let startState = 0;
      if (S === 2 && outStart[orig + 1] > outStart[orig]) {
        startState = 1;
        for (let k = outStart[orig]; k < outStart[orig + 1]; k++) if (!restricted[outLinks[k]]) { startState = 0; break; }
      }
      const start = orig * S + startState;
      dist[start] = 0; heap.size = 0; heap.push(0, start);
      while (heap.size) {
        const dk = heap.topKey(), us = heap.pop();
        if (dk > dist[us]) continue;
        const u = S === 2 ? us >> 1 : us, inRestricted = S === 2 && (us & 1) === 1;
        for (let k = outStart[u]; k < outStart[u + 1]; k++) {
          const li = outLinks[k], r = restricted[li];
          const vs = links[li].to * S + r;
          const nd = dk + cost[li] + (r && !inRestricted ? RESTRICTED_ENTRY_S : 0);
          if (nd < dist[vs]) { dist[vs] = nd; pred[vs] = li; predState[vs] = us; heap.push(nd, vs); }
        }
      }
      for (const oi of byOrigin.get(orig)!) {
        const od = ods[oi];
        let end = od.to * S;
        if (S === 2 && dist[end + 1] < dist[end]) end++;
        if (!Number.isFinite(dist[end])) continue;
        reachable[oi] = 1;
        scratch.length = 0;
        for (let vs = end; vs !== start; vs = predState[vs]) scratch.push(pred[vs]);
        scratch.reverse();
        for (const li of scratch) { target[li] += od.pcu; targetVeh[li] += od.veh; }
        const key = scratch.join(',');
        let pid = pathKey.get(key);
        if (pid === undefined) { pid = paths.length; pathKey.set(key, pid); paths.push(Int32Array.from(scratch)); }
        chosen[oi] = pid;
      }
    }
    return chosen;
  };
  // p14: free-flow time (running at the stream's free speed + signal delay) x the Indo-HCM curve, plus the delay at
  // the unsignalised junction or roundabout the link enters (capacity from the conflicting flows of the current iteration)
  const ctl = net.control;
  const s0 = P14.vdf.value.s0, rShare = P14.majorRightShare.value;
  const mergeParams = { ...P14.unsigMinor.value, tcBase: P14.unsigMinor.value.tcBase * P14.mergeGapRatio.value, fLV: P14.unsigMinor.value.fLV * P14.mergeGapRatio.value };
  const jCap = new Float64Array(L), jDelay = p14 ? new Float64Array(L) : undefined;
  // p18 (P14.priorityGapDelay): conflicting flow and critical gap of each priority approach
  const gapDelay = P14.priorityGapDelay.value, jVc = new Float64Array(L);
  const tcMinor = gaps(P14.unsigMinor.value).tc, tcMerge = gaps(mergeParams).tc, tcRight = gaps(P14.unsigMajorRight.value).tc;
  const updateJunctions = (flow: Float64Array) => {
    if (!ctl) return;
    for (let i = 0; i < L; i++) {
      const k = ctl.kind[i];
      if (!k) continue;
      let vc = 0;
      for (const j of ctl.conflicts[i]) vc += flow[j];
      jVc[i] = vc;
      jCap[i] = k === 1 ? gapCapacityPcu(vc, ctl.merge[i] ? mergeParams : P14.unsigMinor.value) : k === 2 ? gapCapacityPcu(vc, P14.unsigMajorRight.value) : roundaboutEntryPcu(ctl.icd[i], vc) * Math.min(2, Math.max(1, links[i].lanes));
      // p16: a merge into one carriageway shares its downstream capacity when both streams are heavy (limited priority /
      // zip merging: the merging stream is never starved below its share of the carriageway it joins)
      const o = ctl.mergeOut[i];
      if (k === 1 && ctl.merge[i] && o >= 0 && P14.mergeSharing.value) {
        const vi = flow[i], tot = vi + vc;
        if (tot > 0) jCap[i] = Math.max(jCap[i], cap[o] * vi / tot);
      }
    }
  };
  // p17: the deceleration-acceleration term at each approach's stream free-flow speed (P14.decelAccelS)
  const dA = Float64Array.from(links, l => decelAccelS(l.freeSpeedKmh));
  const junctionDelay = (i: number, v: number) => {
    const k = ctl ? ctl.kind[i] : 0;
    if (!k) return 0;
    if (gapDelay && k !== 3) {
      const tc = k === 2 ? tcRight : ctl!.merge[i] ? tcMerge : tcMinor;
      return k === 2 ? rShare * priorityDelayS(rShare * v, jCap[i], jVc[i], tc, undefined, dA[i]) : priorityDelayS(v, jCap[i], jVc[i], tc, undefined, dA[i]);
    }
    return k === 2 ? rShare * controlDelayS(rShare * v, jCap[i], undefined, dA[i]) : controlDelayS(v, jCap[i], undefined, dA[i]);
  };
  // t0 runs at the stream's free speed (car FFS x s0), so the Indo-HCM ratio (relative to car FFS) times s0 is its congestion part
  const linkCost = p14
    ? (i: number, v: number) => base[i] * p14TimeRatio(v / Math.max(1, cap[i])) * s0 + junctionDelay(i, v)
    : (i: number, v: number) => bprTime(base[i], v, cap[i], alpha, beta);
  // Route choice runs on perceived cost (real time x the local-road factor); results report real times
  const lf = o.localCostFactor && o.localCostFactor !== 1 ? o.localCostFactor : 1;
  const perc = new Float64Array(L).fill(1);
  if (lf !== 1) links.forEach((l, i) => { const r = roads.get(l.roadId); const hw = r?.type === 'road' ? r.osmProvenance?.originalTags?.highway ?? '' : ''; if (LOCAL_ACCESS_HIGHWAYS.has(hw)) perc[i] = lf; });
  const setCosts = (flow: Float64Array) => { for (let i = 0; i < L; i++) cost[i] = linkCost(i, flow[i]) * perc[i]; };

  // Initial all-or-nothing on free-flow costs
  updateJunctions(x);
  setCosts(x);
  const first = allOrNothing(x, xv);
  first.forEach((pid, oi) => { if (pid >= 0) odPaths[oi].set(pid, 1); });
  const maxIt = o.maxIterations ?? 60, targetGap = o.targetGap ?? 1e-3, maxMs = o.maxMs ?? 20000;
  const gapHistory: number[] = [];
  let it = 0, gap = Infinity;
  for (it = 1; it <= maxIt; it++) {
    if (timedAt.size && retimes < MAX_RETIMES && RETIME_AT.has(it)) retime();
    updateJunctions(x);
    setCosts(x);
    const chosen = allOrNothing(y, yv);
    // Relative gap: (current total cost - shortest-path cost) / current total cost
    let tc = 0, sp = 0;
    for (let i = 0; i < L; i++) { tc += x[i] * cost[i]; sp += y[i] * cost[i]; }
    gap = tc > 0 ? (tc - sp) / tc : 0;
    gapHistory.push(gap);
    if (gap < targetGap && timedAt.size && retimes < MAX_RETIMES && !timingSettled && it < maxIt) { retime(); continue; }
    if (gap < targetGap || Date.now() - t0 > maxMs) break;
    // Line search (bisection on the derivative of the Beckmann objective)
    let lo = 0, hi = 1;
    for (let s = 0; s < 24; s++) {
      const m = (lo + hi) / 2;
      let g = 0;
      for (let i = 0; i < L; i++) { const d = y[i] - x[i]; if (d !== 0) g += d * linkCost(i, x[i] + m * d) * perc[i]; }
      if (g > 0) hi = m; else lo = m;
    }
    const lambda = (lo + hi) / 2;
    if (lambda <= 1e-9) break;
    for (let i = 0; i < L; i++) { x[i] += lambda * (y[i] - x[i]); xv[i] += lambda * (yv[i] - xv[i]); }
    chosen.forEach((pid, oi) => {
      if (pid < 0) return;
      const m = odPaths[oi];
      m.forEach((w, k) => m.set(k, w * (1 - lambda)));
      m.set(pid, (m.get(pid) ?? 0) + lambda);
    });
  }
  updateJunctions(x);
  setCosts(x);
  if (jDelay) for (let i = 0; i < L; i++) jDelay[i] = junctionDelay(i, x[i]);
  ods.forEach((od, oi) => { if (!reachable[oi]) unroutedVeh += od.veh; });
  return {
    nodes, nodeCoords: net.nodeCoords, links, volPcu: x, volVeh: xv, timeS: lf === 1 ? Float64Array.from(cost) : Float64Array.from(cost, (c, i) => c / perc[i]), ods,
    paths, odPaths: odPaths.map(m => [...m].filter(([, w]) => w > 1e-4).map(([pathId, share]) => ({ pathId, share }))),
    iterations: Math.min(it, maxIt), relativeGap: gap, gapHistory, unroutedVeh, elapsedMs: Date.now() - t0,
    supplyModel: p14 ? 'p14' : 'p13', ...(jDelay ? { junctionDelayS: jDelay, junctionCapacityPcu: jCap } : {}), ...(inferred ? { inferredSignalPoints: inferred } : {}),
  };
}

/**
 * One-to-all shortest paths that make no banned turn (TurnBans), with the same
 * restricted-run rule as the plain search. States: per node, S restricted
 * states times (1 + the junction's entry links that take part in a ban); only
 * nodes of junctions with bans get more than S. Returns a function from an
 * origin and the link costs to a path lookup by destination.
 */
function bannedTurnSearch(bans: TurnBans, N: number, S: number, links: readonly AssignLink[], outStart: Int32Array, outLinks: Int32Array) {
  const L = links.length;
  // Entry links per junction (those in a banned pair), numbered within the junction
  const entryLocal = new Map<number, number>();
  const entriesOf = new Map<number, number[]>();
  for (const key of bans.banned) {
    const a = Math.floor(key / L);
    const k = bans.nodeJunction[links[a].to];
    const list = entriesOf.get(k) ?? entriesOf.set(k, []).get(k)!;
    if (!entryLocal.has(a)) { entryLocal.set(a, list.length); list.push(a); }
  }
  const width = new Int32Array(N), base = new Int32Array(N + 1);
  for (let n = 0; n < N; n++) { const k = bans.nodeJunction[n]; width[n] = 1 + (k >= 0 ? entriesOf.get(k)?.length ?? 0 : 0); base[n + 1] = base[n] + S * width[n]; }
  const total = base[N];
  const stateNode = new Int32Array(total), stateR = new Uint8Array(total), stateE = new Int32Array(total);
  for (let n = 0; n < N; n++) for (let r = 0; r < S; r++) for (let e = 0; e < width[n]; e++) { const st = base[n] + r * width[n] + e; stateNode[st] = n; stateR[st] = r; stateE[st] = e - 1; }
  const restricted = Uint8Array.from(links, l => (l.restricted ? 1 : 0));
  const dist = new Float64Array(total), pred = new Int32Array(total), predState = new Int32Array(total);
  const heap = new Heap();
  return (orig: number, cost: Float64Array) => {
    dist.fill(Infinity); pred.fill(-1);
    let startR = 0;
    if (S === 2 && outStart[orig + 1] > outStart[orig]) {
      startR = 1;
      for (let k = outStart[orig]; k < outStart[orig + 1]; k++) if (!restricted[outLinks[k]]) { startR = 0; break; }
    }
    const start = base[orig] + startR * width[orig];
    dist[start] = 0; heap.size = 0; heap.push(0, start);
    while (heap.size) {
      const dk = heap.topKey(), us = heap.pop();
      if (dk > dist[us]) continue;
      const u = stateNode[us], inRestricted = S === 2 && stateR[us] === 1;
      const eLocal = stateE[us], ku = bans.nodeJunction[u];
      const entry = eLocal >= 0 ? entriesOf.get(ku)![eLocal] : -1;
      for (let k = outStart[u]; k < outStart[u + 1]; k++) {
        const li = outLinks[k];
        const ne = bans.step(entry, li);
        if (ne === -2) continue;
        const v = links[li].to, r = S === 2 ? restricted[li] : 0;
        const local = ne >= 0 ? entryLocal.get(ne) ?? -1 : -1;
        const vs = base[v] + r * width[v] + (local + 1 < width[v] ? local + 1 : 0);
        const nd = dk + cost[li] + (r && !inRestricted ? RESTRICTED_ENTRY_S : 0);
        if (nd < dist[vs]) { dist[vs] = nd; pred[vs] = li; predState[vs] = us; heap.push(nd, vs); }
      }
    }
    return (to: number): number[] | null => {
      let end = -1;
      for (let st = base[to]; st < base[to + 1]; st++) if (dist[st] < (end < 0 ? Infinity : dist[end])) end = st;
      if (end < 0 || !Number.isFinite(dist[end])) return null;
      const p: number[] = [];
      for (let vs = end; vs !== start; vs = predState[vs]) p.push(pred[vs]);
      return p.reverse();
    };
  };
}

/** Per link, the share of its stored path flow, for links in `linkSet`: who uses them (select-link analysis). */
export function selectLink(res: AssignmentResult, linkSet: ReadonlySet<number>) {
  const linkVeh = new Float64Array(res.links.length);
  const byOd: { od: number; veh: number }[] = [];
  res.odPaths.forEach((ps, oi) => {
    let veh = 0;
    for (const { pathId, share } of ps) {
      const p = res.paths[pathId];
      let uses = false;
      for (const li of p) if (linkSet.has(li)) { uses = true; break; }
      if (!uses) continue;
      const f = share * res.ods[oi].veh;
      veh += f;
      for (const li of p) linkVeh[li] += f;
    }
    if (veh > 0) byOd.push({ od: oi, veh });
  });
  return { linkVeh, byOd };
}

/**
 * p18: whether the corridor micro-simulation gets the flow that can reach it (analysisJob). A static assignment loads links
 * above their capacity (v/c > 1), which no real road passes: the excess waits upstream. Quasi-dynamic assignment with
 * residual point queues (Bliemer, Raadsen, Smits, Zhou & Bell 2014, Transp. Res. B 68:363-384, doi 10.1016/j.trb.2014.07.001) keeps the static route
 * choice and caps each link's outflow at its capacity; a path's flow past a bottleneck falls by the bottleneck's pass ratio
 * min(1, capacity / demand) (proportional node model). Here the tightest upstream bottleneck outside the sub-area sets a
 * path's flow into the sub-area; the vehicles held there are reported (`held`), never dropped silently.
 */
export const SUBAREA_METER = { enabled: true };

/** Per link: min(1, capacity / flow), capacity the tightest of mid-block, signal stop line and unsignalised movement (PCU/h). */
export function upstreamPassRatio(res: AssignmentResult): Float64Array {
  return Float64Array.from(res.links, (l, i) => {
    let cap = l.capacityPcu;
    if (l.stopLinePcu) cap = Math.min(cap, l.stopLinePcu);
    const j = res.junctionCapacityPcu?.[i] ?? 0;
    if (j > 0) cap = Math.min(cap, j);
    const v = res.volPcu[i];
    return v > cap && cap > 0 ? cap / v : 1;
  });
}

/**
 * The demand that crosses a sub-area: every stored path cut to its runs of
 * links inside `insideSegments`, as trips from where it enters to where it
 * leaves (coordinates, so they snap onto the sub-area's own network), with
 * the links it takes inside. Vehicle kinds keep their OD shares.
 */
export function subareaDemand(res: AssignmentResult, insideSegments: ReadonlySet<string>, hourFactor = 1, opts: { meter?: boolean; held?: { vph: number } } = {}) {
  const agg = new Map<string, { from: number; to: number; via: number[]; kinds: Map<VehicleKind, number> }>();
  // p18 (SUBAREA_METER): the flow a path brings to the sub-area is what its upstream links outside the sub-area can pass
  const alpha = opts.meter ? upstreamPassRatio(res) : null;
  let held = 0;
  res.odPaths.forEach((ps, oi) => {
    const od = res.ods[oi];
    for (const { pathId, share } of ps) {
      const p = res.paths[pathId];
      let run: number[] = [], pass = 1;
      const flush = () => {
        if (!run.length) return;
        const from = res.links[run[0]].from, to = res.links[run[run.length - 1]].to;
        const key = run.join(',');
        const e = agg.get(key) ?? agg.set(key, { from, to, via: [...run], kinds: new Map() }).get(key)!;
        od.kinds.forEach((v, k) => { e.kinds.set(k, (e.kinds.get(k) ?? 0) + v * share * hourFactor * pass); held += v * share * hourFactor * (1 - pass); });
        run = [];
      };
      for (const li of p) {
        if (insideSegments.has(res.links[li].segmentKey)) run.push(li);
        else { flush(); if (alpha) pass = Math.min(pass, alpha[li]); }
      }
      flush();
    }
  });
  if (opts.held) opts.held.vph = held;
  const trips: { from: [number, number, number]; to: [number, number, number]; vehiclesPerHour: number; kind: VehicleKind; viaLinkIds: string[] }[] = [];
  for (const e of agg.values()) {
    if (e.from === e.to) continue;
    e.kinds.forEach((vph, kind) => { if (vph > 1e-3) trips.push({ from: res.nodeCoords[e.from], to: res.nodeCoords[e.to], vehiclesPerHour: vph, kind, viaLinkIds: e.via.map(i => res.links[i].id) }); });
  }
  return trips;
}
