/**
 * #3 Bus lane / BRT upgrade of a road (docs/urbanos/DESIGN_TOOLS_P7.md §3). Stored on the road (`busPriority`); the
 * road's own lanes are not rewritten, so removing the upgrade gives the road back exactly.
 *
 * Network effect (sourced, not a factor): each listed direction loses one general-traffic lane to buses — the kerb
 * lane for a bus lane, the median lane for BRT. Simulate's network gets the road with that many fewer lanes (IRC:106
 * capacity of the remaining lanes; the assignment and the micro-simulation both read lanes from the road). Buses
 * themselves are not modelled as a separate mode: bus speed / priority and mode shift are NOT modelled.
 *
 * Checks: BRT lane 3.5 m, passing lane 4 m, divider ≥ 0.5 m (≥ 1 m at crossings) (IRC:124 §6.1); dedicated bus lanes
 * recommended on RoW ≥ 30 m, two-way busway ≥ 7 m undivided (Pune USDG); at least one general lane left each way.
 */
import type { RoadObject } from '../objects/types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { roadXs } from './roadXs';

export interface BusPrioritySpec {
  kind: 'bus_lane' | 'brt';
  /** Directions given a bus lane, relative to the road's drawn direction. */
  directions: 'both' | 'forward' | 'backward';
  laneWidthM: number;
  /** Divider between the bus lane and mixed traffic (m); null = none / not entered. */
  dividerM: number | null;
  appliedAt: string;
}

export const DEFAULT_BUS_PRIORITY = (kind: BusPrioritySpec['kind']): Omit<BusPrioritySpec, 'appliedAt'> =>
  ({ kind, directions: 'both', laneWidthM: SD.brtLaneM.value, dividerM: kind === 'brt' ? SD.brtDividerM.value : null });

/** General-traffic lanes taken per direction. */
export function lanesTaken(spec: BusPrioritySpec | undefined): { fwd: number; bwd: number } {
  if (!spec) return { fwd: 0, bwd: 0 };
  return { fwd: spec.directions === 'backward' ? 0 : 1, bwd: spec.directions === 'forward' ? 0 : 1 };
}

/** Why the upgrade cannot be applied (a direction would have no general lane left), or null. */
export function busPriorityBlockReason(road: RoadObject, spec: Omit<BusPrioritySpec, 'appliedAt'>): string | null {
  if (road.type !== 'road') return 'Only roads take a bus lane.';
  const xs = roadXs(road);
  const t = lanesTaken({ ...spec, appliedAt: '' });
  if (xs.oneWay && spec.directions !== 'forward') return 'A one-way road has one direction: choose "forward" (its drawn direction).';
  if (t.fwd && xs.lanesFwd - t.fwd < 1) return `The forward direction has ${xs.lanesFwd} lane(s): a bus lane would leave no lane for general traffic.`;
  if (t.bwd && xs.lanesBwd - t.bwd < 1) return `The backward direction has ${xs.lanesBwd} lane(s): a bus lane would leave no lane for general traffic.`;
  return null;
}

/** The road as Simulate's network should see it: one fewer lane in each direction given to buses. */
export function roadForGeneralTraffic(road: RoadObject): RoadObject {
  const spec = road.busPriority;
  if (!spec) return road;
  const t = lanesTaken(spec);
  const xs = roadXs(road);
  const fwd = Math.max(1, xs.lanesFwd - t.fwd), bwd = xs.oneWay ? 0 : Math.max(1, xs.lanesBwd - t.bwd);
  const laneCount = fwd + bwd;
  const out: RoadObject = { ...road, laneCount, trafficCapacity: Math.round((road.trafficCapacity || (road.laneCount || 2) * 1000) * laneCount / Math.max(1, xs.lanesFwd + xs.lanesBwd)) };
  if (road.sections?.length) {
    out.sections = road.sections.map(s => ({
      ...s,
      carriagewayA: { ...s.carriagewayA, lanes: Math.max(1, s.carriagewayA.lanes - t.fwd) },
      ...(s.carriagewayB ? { carriagewayB: { ...s.carriagewayB, lanes: s.carriagewayB.lanes > 0 ? Math.max(1, s.carriagewayB.lanes - t.bwd) : 0 } } : {}),
    }));
  }
  return out;
}

export function busPriorityChecks(road: RoadObject, spec: Omit<BusPrioritySpec, 'appliedAt'>): SdCheck[] {
  const out: SdCheck[] = [];
  const xs = roadXs(road);
  out.push(sdCheck({ id: 'bus-lane-width', name: spec.kind === 'brt' ? 'BRT lane width' : 'Bus lane width', status: spec.laneWidthM < SD.brtLaneM.value - 1e-6 ? 'fail' : 'pass',
    actual: r2(spec.laneWidthM), required: SD.brtLaneM.value,
    text: spec.laneWidthM < SD.brtLaneM.value - 1e-6 ? `${fmtM(spec.laneWidthM)} is below the 3.5 m one-way BRT lane.` : `${fmtM(spec.laneWidthM)} — no flag against the 3.5 m one-way BRT lane (4 m where a passing lane is needed).`,
    basis: basisOf('brtLaneM', 'brtPassingLaneM') }));
  if (spec.kind === 'brt') {
    const d = spec.dividerM;
    out.push(sdCheck({ id: 'bus-lane-divider', name: 'Divider from mixed traffic', status: d == null ? 'unknown' : d < SD.brtDividerM.value - 1e-6 ? 'fail' : d < SD.brtDividerAtCrossingM.value - 1e-6 ? 'warn' : 'pass',
      actual: d, required: SD.brtDividerM.value,
      text: d == null ? 'Divider width not entered.' : d < 0.5 - 1e-6 ? `${fmtM(d)} is below the 0.5 m minimum divider.`
        : d < 1 - 1e-6 ? `${fmtM(d)} meets 0.5 m; it must widen to at least 1 m at street crossing points.` : `${fmtM(d)} — no flag against 0.5 m (1 m at crossings).`,
      basis: basisOf('brtDividerM', 'brtDividerAtCrossingM') }));
    if (spec.directions === 'both' && (d == null || d <= 0)) out.push(sdCheck({ id: 'bus-lane-two-way', name: 'Two-way busway width', status: 2 * spec.laneWidthM < SD.busLaneTwoWayMinM.value - 1e-6 ? 'fail' : 'pass',
      actual: r2(2 * spec.laneWidthM), required: SD.busLaneTwoWayMinM.value,
      text: `Two-way busway ${fmtM(2 * spec.laneWidthM)} against Pune USDG's 7 m minimum undivided for two-way bus flow.`, basis: basisOf('busLaneTwoWayMinM') }));
  }
  const row = road.availableRowM;
  out.push(sdCheck({ id: 'bus-lane-row', name: 'Right-of-way for a dedicated bus lane', status: row == null ? 'unknown' : row < SD.busLaneRowMinM.value - 1e-6 ? 'warn' : 'pass',
    actual: row ?? null, required: SD.busLaneRowMinM.value,
    text: row == null ? `Available right-of-way not recorded (drawn strips ${fmtM(xs.drawnWidthM)}, not the RoW); USDG recommends dedicated bus lanes on RoW ≥ 30 m.`
      : row < 30 ? `Available RoW ${fmtM(row)} is below the 30 m USDG recommends for dedicated bus lanes.` : `Available RoW ${fmtM(row)} — no flag against USDG 30 m.`,
    basis: basisOf('busLaneRowMinM') }));
  const t = lanesTaken({ ...spec, appliedAt: '' });
  const left = { fwd: xs.lanesFwd - t.fwd, bwd: xs.oneWay ? null : xs.lanesBwd - t.bwd };
  out.push(sdCheck({ id: 'bus-lane-general', name: 'General-traffic lanes left', status: left.fwd < 1 || (left.bwd != null && left.bwd < 1) ? 'fail' : 'info', actual: left.fwd + (left.bwd ?? 0), required: null, unit: 'lanes',
    text: `Simulate's network keeps ${left.fwd} lane(s) forward${left.bwd != null ? ` and ${left.bwd} backward` : ''} for general traffic (from ${xs.lanesFwd}${left.bwd != null ? ` + ${xs.lanesBwd}` : ''}). Buses are not modelled as their own mode: bus speed and mode shift are not in the result.`,
    basis: 'UrbanOS network model (IRC:106 capacity of the remaining lanes)' }));
  return out;
}

/** Applies (or removes, spec null) the upgrade as one Undo step. In a proposal, a base road is copied on write. */
export function commitBusPriority(objects: { update(id: string, u: Partial<RoadObject>): void }, history: { recordUpdate(b: any, a: any, d?: string): void },
  road: RoadObject, spec: Omit<BusPrioritySpec, 'appliedAt'> | null, now = new Date().toISOString()): { ok: true } | { ok: false; reason: string } {
  if (spec) { const why = busPriorityBlockReason(road, spec); if (why) return { ok: false, reason: why }; }
  const updates: Partial<RoadObject> = { busPriority: spec ? { ...spec, appliedAt: now } : undefined };
  history.recordUpdate(road, { ...road, ...updates }, spec ? `${spec.kind === 'brt' ? 'BRT' : 'Bus lane'} on ${road.name || road.id}` : `Remove bus lane from ${road.name || road.id}`);
  objects.update(road.id, updates);
  return { ok: true };
}
