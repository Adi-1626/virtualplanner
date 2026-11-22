/**
 * #2 Pedestrian crossings: zebra, raised (table-top) or signalised mid-block, with an optional refuge island
 * (docs/urbanos/DESIGN_TOOLS_P7.md §2).
 *
 * Checks (screening): width ≥ max(2 m, footpath) (IRC:35 §11.3.5); raised crossing ≥ 3 m (IRC:86 §5.1.2); a crossing
 * longer than 10.5 m in one go needs a refuge ≥ 1.2 m (IRC:35 §11.3.3; Pune USDG ≥ 1 m, ≥ 3 m for wheelchairs; IRC:86:
 * roads of 4+ lanes refuge ≥ 3 m); spacing to the next crossing on the same road 50–200 m (IRC:86 §5.1.2), ≤ 150 m on a
 * BRT corridor (USDG); a mid-block signal not closer than 300 m to another cross-walk and no kerb parking 75 m either
 * side (IRC:93 §5.4); pedestrian warrant ≥ 150 ped/h (IRC:93 Warrant 3) — unknown without a count.
 *
 * Network effect: only the signalised crossing changes the model: a two-phase signal whose pedestrian green is
 * length / 1.2 m/s + 7 s (IRC:93 §22.1) in an assumed 60 s cycle (a design input), with the app's 3 s amber + 2 s
 * all-red per phase. The road's links through the crossing get Webster's uniform delay C (1 − g/C)² / 2 and the stop-line
 * capacity cap (Indo-HCM saturation flow × g/C), as a signalised junction approach. A zebra or a raised crossing is not
 * given a capacity or speed change: the pedestrian volume that drives it is not known and no Indian factor was read.
 */
import type { CityObject, RoadObject, StreetElementObject } from '../objects/types';
import type { CrossingSpec } from './types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { roadXs } from './roadXs';

export const DEFAULT_CROSSING: CrossingSpec = { crossingType: 'zebra', widthM: 3, lengthM: null, refuge: false, refugeWidthM: null, signalCycleS: null, pedsPerHour: null };

/** Length to cross (m): the carriageway kerb to kerb, less a refuge when one is drawn (the longest single run). */
export function crossingRuns(c: CrossingSpec, road: RoadObject | null): { totalM: number | null; longestRunM: number | null } {
  const total = c.lengthM ?? (road ? roadXs(road).carriagewayM : null);
  if (total == null) return { totalM: null, longestRunM: null };
  if (!c.refuge) return { totalM: total, longestRunM: total };
  const xs = road ? roadXs(road) : null;
  // A refuge in the median splits the crossing into the two directions' carriageways
  const run = xs && !xs.oneWay ? Math.max(xs.lanesFwd, xs.lanesBwd) * xs.laneW : Math.max(0, (total - (c.refugeWidthM ?? 0)) / 2);
  return { totalM: total, longestRunM: run };
}

/** Two-phase mid-block signal timing (IRC:93 §22.1 pedestrian green; assumed cycle; app amber / all-red). */
export function midblockSignal(c: CrossingSpec, road: RoadObject | null): { cycleS: number; pedGreenS: number; vehGreenS: number; gC: number; delayS: number; cycleAssumed: boolean } | null {
  if (c.crossingType !== 'signalised') return null;
  const { longestRunM } = crossingRuns(c, road);
  const L = longestRunM ?? (road ? roadXs(road).carriagewayM : 7);
  const cycleAssumed = !(c.signalCycleS && c.signalCycleS > 0);
  const cycleS = cycleAssumed ? SD.pedSignalCycleS.value : c.signalCycleS!;
  const inter = SD.amberS.value + SD.allRedS.value;
  const pedGreenS = L / SD.pedWalkSpeedMps.value + SD.pedReactionS.value;
  const vehGreenS = Math.max(5, cycleS - pedGreenS - 2 * inter);
  // Effective green for vehicles = green + amber − start-up lost time (2 s, staticAssignment's STARTUP_LOST_S)
  const gC = Math.max(0.05, Math.min(1, (vehGreenS + SD.amberS.value - 2) / cycleS));
  return { cycleS, pedGreenS: r2(pedGreenS), vehGreenS: r2(vehGreenS), gC: r2(gC), delayS: r2(cycleS * (1 - gC) ** 2 / 2), cycleAssumed };
}

const crossingsOn = (roadId: string, objects: readonly CityObject[], selfId: string) =>
  objects.filter((o): o is StreetElementObject => o.type === 'street_element' && o.kind === 'crossing' && o.id !== selfId && o.anchor?.roadId === roadId);

export function crossingChecks(el: StreetElementObject, objects: readonly CityObject[]): SdCheck[] {
  const c = el.crossing ?? DEFAULT_CROSSING;
  const road = (el.anchor ? objects.find(o => o.id === el.anchor!.roadId && o.type === 'road') : null) as RoadObject | null;
  const xs = road ? roadXs(road) : null;
  const out: SdCheck[] = [];

  // Width (IRC:35 §11.3.5: not less than the footpath, minimum 2.0 m)
  const fp = xs ? Math.max(xs.footpathLeftM, xs.footpathRightM) : 0;
  const need = Math.max(SD.zebraMinWidthM.value, fp);
  out.push(sdCheck({ id: 'crossing-width', name: 'Crossing width', status: c.widthM < need - 1e-6 ? 'fail' : 'pass', actual: r2(c.widthM), required: r2(need),
    text: c.widthM < need - 1e-6 ? `${fmtM(c.widthM)} is below ${fp > SD.zebraMinWidthM.value ? `the footpath width (${fmtM(fp)})` : 'the 2.0 m minimum'}.` : `${fmtM(c.widthM)} — no flag against max(2.0 m, footpath ${fmtM(fp)}).`,
    basis: basisOf('zebraMinWidthM') }));
  if (c.crossingType === 'raised') out.push(sdCheck({ id: 'crossing-raised-width', name: 'Raised crossing width', status: c.widthM < SD.raisedCrossingMinWidthM.value - 1e-6 ? 'fail' : 'pass',
    actual: r2(c.widthM), required: SD.raisedCrossingMinWidthM.value,
    text: c.widthM < 3 - 1e-6 ? `${fmtM(c.widthM)} is below the 3 m minimum of a raised crosswalk (ramps 1:8 for vehicles).` : `${fmtM(c.widthM)} — no flag against the 3 m raised crosswalk (ramps 1:8 for vehicles).`,
    basis: basisOf('raisedCrossingMinWidthM', 'raisedRampSlope') }));

  // Refuge (IRC:35 §11.3.3; USDG §4.1.2; IRC:86 §5.1.2)
  const runs = crossingRuns(c, road);
  if (runs.longestRunM == null) out.push(sdCheck({ id: 'crossing-refuge', name: 'Refuge island', status: 'unknown', actual: null, required: SD.refugeTriggerLengthM.value,
    text: 'The length to cross is not known (no road under the crossing).', basis: basisOf('refugeTriggerLengthM') }));
  else if (runs.longestRunM > SD.refugeTriggerLengthM.value + 1e-6) out.push(sdCheck({ id: 'crossing-refuge', name: 'Refuge island', status: 'fail', actual: r2(runs.longestRunM), required: SD.refugeTriggerLengthM.value,
    text: `${fmtM(runs.longestRunM)} to cross in one go is more than 10.5 m${c.refuge ? ' even with the refuge' : ''}: a refuge island of at least 1.2 m is needed.`, basis: basisOf('refugeTriggerLengthM', 'refugeMinWidthM') }));
  else out.push(sdCheck({ id: 'crossing-refuge', name: 'Refuge island', status: 'pass', actual: r2(runs.longestRunM), required: SD.refugeTriggerLengthM.value,
    text: `${fmtM(runs.longestRunM)} in one go — no flag against 10.5 m.`, basis: basisOf('refugeTriggerLengthM') }));
  if (c.refuge) {
    const w = c.refugeWidthM;
    const lanes = xs ? xs.lanesFwd + xs.lanesBwd : 0;
    if (w == null) out.push(sdCheck({ id: 'crossing-refuge-width', name: 'Refuge width', status: 'unknown', actual: null, required: SD.refugeMinWidthM.value, text: 'Refuge width not entered.', basis: basisOf('refugeMinWidthM') }));
    else out.push(sdCheck({ id: 'crossing-refuge-width', name: 'Refuge width', status: w < SD.refugeMinWidthM.value - 1e-6 ? 'fail' : w < SD.refugeWheelchairM.value - 1e-6 ? 'warn' : 'pass',
      actual: r2(w), required: SD.refugeMinWidthM.value,
      text: w < SD.refugeMinWidthM.value - 1e-6 ? `${fmtM(w)} is below the 1.2 m minimum refuge (IRC:35).`
        : w < SD.refugeWheelchairM.value - 1e-6 ? `${fmtM(w)} meets 1.2 m (IRC:35) but is below 3 m, the width USDG gives for wheelchair access${lanes >= 4 ? ' and IRC:86 asks on roads of 4+ lanes' : ''}.`
        : `${fmtM(w)} — no flag against 1.2 m (IRC:35) or 3 m (USDG wheelchair access; IRC:86 for 4+ lanes).`,
      basis: basisOf('refugeMinWidthM', 'refugeWheelchairM', 'refuge4LaneM') }));
  }

  // Spacing to the next crossing on the same road
  if (road && el.anchor) {
    const others = crossingsOn(road.id, objects, el.id).map(o => Math.abs((o.anchor!.chainageM) - el.anchor!.chainageM)).sort((a, b) => a - b);
    const near = others[0];
    const brt = road.busPriority?.kind === 'brt';
    const maxGap = brt ? SD.brtCrossingSpacingM.value : SD.midblockSpacingMaxM.value;
    if (near == null) out.push(sdCheck({ id: 'crossing-spacing', name: 'Spacing to the next crossing', status: 'info', actual: null, required: maxGap,
      text: `No other crossing drawn on ${road.name || 'this road'}; IRC:86 places mid-block crossings every 50–200 m by street type${brt ? ' (USDG: every 150 m on a BRT corridor)' : ''}. Junction crossings and mapped zebras are not counted.`,
      basis: basisOf('midblockSpacingMinM', ...(brt ? ['brtCrossingSpacingM' as const] : [])) }));
    else out.push(sdCheck({ id: 'crossing-spacing', name: 'Spacing to the next crossing', status: near > maxGap + 1e-6 ? 'warn' : near < SD.midblockSpacingMinM.value - 1e-6 ? 'info' : 'pass', actual: Math.round(near), required: maxGap,
      text: near > maxGap + 1e-6 ? `${Math.round(near)} m to the next drawn crossing is more than ${maxGap} m${brt ? ' (USDG BRT corridor)' : ' (IRC:86 50–200 m)'}.`
        : near < SD.midblockSpacingMinM.value - 1e-6 ? `${Math.round(near)} m to the next drawn crossing is closer than the 50 m low end of IRC:86's range.`
        : `${Math.round(near)} m to the next drawn crossing — within IRC:86 50–200 m${brt ? ' and USDG 150 m' : ''}.`,
      basis: basisOf('midblockSpacingMinM', ...(brt ? ['brtCrossingSpacingM' as const] : [])) }));
    if (c.crossingType === 'signalised') out.push(sdCheck({ id: 'crossing-signal-spacing', name: 'Mid-block signal spacing', status: near != null && near < SD.pedSignalCrossingSpacingM.value - 1e-6 ? 'warn' : near == null ? 'info' : 'pass',
      actual: near == null ? null : Math.round(near), required: SD.pedSignalCrossingSpacingM.value, unit: 'm',
      text: near != null && near < 300 ? `A mid-block signal ${Math.round(near)} m from another drawn crossing: IRC:93 asks for at least 300 m to another established cross-walk, and no kerb parking 75 m either side.`
        : `IRC:93: at least 300 m to another cross-walk${near != null ? ` (${Math.round(near)} m drawn)` : ' (none drawn on this road; mapped ones are not counted)'}; no kerb parking 75 m before and after.`,
      basis: basisOf('pedSignalCrossingSpacingM', 'pedSignalNoParkingM') }));
  }

  // Pedestrian warrant for a mid-block signal (IRC:93 Warrant 3)
  if (c.crossingType === 'signalised') {
    const p = c.pedsPerHour;
    out.push(sdCheck({ id: 'crossing-ped-warrant', name: 'Pedestrian warrant (IRC:93 Warrant 3)', status: p == null ? 'unknown' : p < SD.pedWarrantPedsPerH.value ? 'warn' : 'info', unit: 'ped/h',
      actual: p ?? null, required: SD.pedWarrantPedsPerH.value,
      text: p == null ? 'No pedestrian count entered: IRC:93 Warrant 3 needs ≥ 150 ped/h on the crossing and ≥ 600 veh/h on the major street, for each of any 8 hours.'
        : p < 150 ? `${p} ped/h entered is below the 150 ped/h of IRC:93 Warrant 3.` : `${p} ped/h entered reaches 150 ped/h (IRC:93 Warrant 3 also needs ≥ 600 veh/h, each of any 8 hours — not screened here).`,
      basis: basisOf('pedWarrantPedsPerH', 'pedWarrantVeh') }));
    const t = midblockSignal(c, road);
    if (t) out.push(sdCheck({ id: 'crossing-signal-timing', name: 'Mid-block signal in the model', status: 'info', actual: t.gC, required: null, unit: 'g/C',
      text: `Pedestrian green ${t.pedGreenS} s (${runs.longestRunM != null ? fmtM(runs.longestRunM) : 'length'} / 1.2 m/s + 7 s), vehicle green ${t.vehGreenS} s in a ${t.cycleS} s cycle${t.cycleAssumed ? ' (assumed — enter the design cycle)' : ''}: Simulate gives the road g/C ${t.gC} and ${t.delayS} s uniform delay through the crossing.`,
      basis: basisOf('pedWalkSpeedMps', 'pedReactionS', 'pedSignalCycleS', 'amberS', 'allRedS') }));
  } else out.push(sdCheck({ id: 'crossing-model', name: 'Effect in Simulate', status: 'info', actual: null, required: null, unit: '',
    text: `A ${c.crossingType === 'raised' ? 'raised' : 'zebra'} crossing does not change the road's capacity or speed in the model: the pedestrian volume is not known and no Indian capacity factor was read. It is in the report.`,
    basis: 'UrbanOS model scope' }));
  return out;
}
