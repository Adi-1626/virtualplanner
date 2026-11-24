import type { StudyArea, DrivableObject } from './StudyAreaExplorer';
import { snapDemandPlan, type DemandPlan } from './StudyDemand';
import { estimatedLinkFlow, type EstimatedTrafficModel } from './EstimatedTraffic';
import { edgeFlowPerLane } from './AreaDemand';
import { areaOdProblem } from '../demand/odmeAssignment';
import { estimateOd, matrixChangeStats, modelledAt, gehOf, type OdmeCount } from '../demand/odme';
import type { AssignmentOptions } from './staticAssignment';

/**
 * Matching an area's demand to the city-wide ESTIMATED link flows (p11; label "estimated (project-level, not for
 * decisions)").
 *
 * The area demand (AreaDemand.compileAreaDemand with estimatedLandUse) is a prior: the area's own trips from the
 * estimated zone land use, trips across its edge and through traffic. Its OD cells are then scaled so that the app's
 * own user-equilibrium assignment reproduces the estimated flow on every main road of the area (each way, each
 * direction), with the Spiess (1990) gradient estimator already used for count calibration (demand/odme.ts). The
 * targets are ESTIMATES (pune_estimated_traffic_v1), never counts: the estimator sees no observed count, so no held-out
 * count can leak into it. A count compared later (validation) is compared with the result, never fitted.
 *
 * Bounded (each cell between MATCH_BOUNDS of its prior) and short (MATCH_ITERATIONS), because the targets carry the
 * estimate's own error (median 27% on the held-out counts of the dataset, TRAFFIC_ESTIMATED_P10.md §1): the aim is the
 * share of through and local traffic on each road, not an exact fit.
 */
export const MATCH_ITERATIONS = 6;
export const MATCH_BOUNDS: [number, number] = [0.33, 3];
/** Relative weights: a target counts as 1 / max(MATCH_WEIGHT_FLOOR, target) so small roads are not swamped by big ones. */
const MATCH_WEIGHT_FLOOR = 200;

export interface EstimateMatch {
  targets: number;
  meanGehBefore: number;
  meanGehAfter: number;
  within5Before: number;
  within5After: number;
  iterations: number;
  assignments: number;
  stopReason: string;
  priorVph: number;
  matchedVph: number;
  /** TAG M3.1 Table 5 matrix-change statistics (reported; the targets are estimates, not counts). */
  changeWithinTag: boolean;
  elapsedMs: number;
}

/** The area's main-road links (both directions of each way, the class-typical edge-flow roads) and their estimated flows at `hour`. */
export function estimatedTargets(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, model: EstimatedTrafficModel, hour: number, linkIndex: ReadonlyMap<string, number>): OdmeCount[] {
  const included = new Set(area.segments.map(s => s.key));
  const groups = new Map<string, { links: number[]; vph: number }>();
  for (const e of area.network.edges.values()) {
    if (!included.has(e.id.replace(/_(fwd|bwd)$/, ''))) continue;
    const road = roads.get(e.roadId);
    if (!road || edgeFlowPerLane(road) <= 0) continue;
    const li = linkIndex.get(e.id);
    if (li === undefined) continue;
    const a = area.network.nodes.get(e.fromNodeId)?.coordinates, b = area.network.nodes.get(e.toNodeId)?.coordinates;
    if (!a || !b) continue;
    const key = `${e.roadId}|${e.id.endsWith('_bwd') ? 'b' : 'f'}`;
    const g = groups.get(key) ?? groups.set(key, { links: [], vph: 0 }).get(key)!;
    g.links.push(li);
    // The way's flow in this direction (the same for every piece of it); its longest piece decides the heading
    g.vph = Math.max(g.vph, estimatedLinkFlow(model, road, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [b[0] - a[0], b[1] - a[1]], hour));
  }
  return [...groups.entries()].filter(([, g]) => g.vph >= 1).map(([id, g]) => ({ id, groups: [g.links], observed: g.vph, weight: 1 / Math.max(MATCH_WEIGHT_FLOOR, g.vph), datasetId: model.id }));
}

/** veh/h by part of the area demand (trips tagged by AreaDemand.ts); parts with no tagged trip are left as they were. */
function partTotals(trips: DemandPlan['trips']) {
  const t: Partial<Record<'internal' | 'outbound' | 'inbound' | 'through', number>> = {};
  for (const x of trips) if (x.part) t[x.part] = (t[x.part] ?? 0) + x.vehiclesPerHour;
  return t;
}

/** The prior plan with each OD cell scaled to the estimated link flows, and what the match did. Null when there is nothing to match. */
export function matchPlanToEstimates(plan: DemandPlan, area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, model: EstimatedTrafficModel, hour: number,
  assignment: AssignmentOptions = {}): { plan: DemandPlan; match: EstimateMatch } | null {
  const t0 = Date.now();
  if (!plan.trips.length) return null;
  const segs = new Set(area.segments.map(s => s.key));
  const trips = snapDemandPlan(plan, area.network, 250, segs);
  const problem = areaOdProblem(area, roads, trips, { maxIterations: 25, targetGap: 5e-3, maxMs: 4000, ...assignment });
  const counts = estimatedTargets(area, roads, model, hour, problem.linkIndex);
  if (!counts.length || !problem.prior.length) return null;
  const est = estimateOd(problem, counts, { maxIterations: MATCH_ITERATIONS, cellFactorBounds: MATCH_BOUNDS, tolerance: 0.01 });
  const g = (flow: Float64Array) => counts.map(c => gehOf(modelledAt(c, flow).value, c.observed));
  const before = g(est.priorLoad.linkFlow), after = g(est.load.linkFlow);
  const mean = (x: number[]) => x.reduce((n, v) => n + v, 0) / Math.max(1, x.length);
  const scaled = plan.trips.map((t, j) => { const c = problem.cellOfTrip[j]; return c < 0 ? { ...t } : { ...t, vehiclesPerHour: t.vehiclesPerHour * est.factors[c] }; });
  const vph = scaled.reduce((n, t) => n + t.vehiclesPerHour, 0);
  const change = matrixChangeStats(problem.prior, est.matrix, problem.cells);
  const match: EstimateMatch = {
    targets: counts.length, meanGehBefore: mean(before), meanGehAfter: mean(after), within5Before: before.filter(x => x < 5).length, within5After: after.filter(x => x < 5).length,
    iterations: est.iterations.filter(i => i.iteration > 0 && i.accepted).length, assignments: problem.assignments(), stopReason: est.stopReason,
    priorVph: plan.provenance.vehiclesPerHour, matchedVph: vph, changeWithinTag: change.every(c => c.within !== false), elapsedMs: Date.now() - t0,
  };
  // Component totals scale with their trips' share of the change (reported as veh/h of the matched plan)
  const k = plan.provenance.vehiclesPerHour > 0 ? vph / plan.provenance.vehiclesPerHour : 1;
  const comps = plan.provenance.components;
  return {
    match,
    plan: {
      trips: scaled,
      provenance: {
        ...plan.provenance, vehiclesPerHour: vph, pairCount: scaled.length,
        ...(comps ? { components: { ...comps, ...partTotals(scaled), matchScale: k, estimateMatch: match } } : {}),
        label: `${plan.provenance.label} Matched to the estimated flows of ${counts.length} main-road links in the area (OD scaling, ${match.iterations} iterations; mean GEH against the estimates ${match.meanGehBefore.toFixed(1)} -> ${match.meanGehAfter.toFixed(1)}). Estimated, project-level, not for decisions.`,
      },
    },
  };
}
