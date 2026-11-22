/**
 * #1 Junction control brush and IRC:35 junction markings (docs/urbanos/DESIGN_TOOLS_P7.md §1).
 *
 * The brush sets an imported junction's control in one click: signal, stop (priority, STOP on the minor approaches),
 * give way (priority, GIVE WAY on the minor approaches) or uncontrolled. It writes the same whole-junction edit as the
 * junction editor (JunctionEditSpec, docs/OVERHAUL.md §23), so the network model, Undo/Redo, the proposal and save /
 * reload all treat it exactly like an editor edit:
 *  - signal: the approach-wise plan (one phase per approach, the micro-simulator's 25 s green / 3 s amber / 2 s all-red),
 *    fixed time; the static assignment adds Webster's uniform delay C (1 − g/C)² / 2 and caps capacity at the Indo-HCM
 *    stop-line value (staticAssignment.ts);
 *  - stop / give way: priority to the highest-class approaches; the minor approaches yield (the model does not tell a
 *    STOP from a GIVE WAY: same gap acceptance);
 *  - uncontrolled: no control.
 *
 * Markings (data for the visuals; IRC:35-2015, IRC text, third-party copy): stop line 200 mm (§6.1.3); at a signal the
 * zebra and a stop line 1 m before it (§11.3.2); unsignalised zebra with the stop line 2–3 m before it; no crossing: stop
 * line 1.25–9 m from the intersecting carriageway (§6.1.4); STOP: double stop line, two 200 mm lines 300 mm apart
 * (§6.1.7); GIVE WAY: two broken 200 mm lines, 600 mm / 300 mm (§6.2.1); no transverse line without control (§6.1.1);
 * zebra width max(2 m, footpath) (§11.3.5); directional arrows 3.5 m (≤ 50 km/h) or 5 m (§8.1.2).
 */
import type { TrafficNetwork } from '../objects/trafficTypes';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import type { LogicalJunction } from '../simulation/junctionGroups';
import { DEFAULT_ALL_RED_S, DEFAULT_AMBER_S, DEFAULT_GREEN_S, type JunctionEditSpec, type SignalPlan } from '../simulation/junctionControl';
import { SD, type SdKey } from './sources';
import { basisOf, sdCheck, type SdCheck } from './checks';
import { frameAt, toLngLat, toXY } from './geom';

export type JunctionBrush = 'signal' | 'stop' | 'give_way' | 'uncontrolled';

export const BRUSH_LABEL: Record<JunctionBrush, string> = { signal: 'Signal', stop: 'Stop (minor roads)', give_way: 'Give way (minor roads)', uncontrolled: 'Uncontrolled' };

/** What a spec's control is, in brush terms. */
export function brushOf(spec: Pick<JunctionEditSpec, 'control' | 'minorSign'>): JunctionBrush {
  if (spec.control === 'signal') return 'signal';
  if (spec.control === 'priority') return spec.minorSign === 'stop' ? 'stop' : 'give_way';
  return 'uncontrolled';
}

/** The widest approach and the approach most nearly opposite it (within 45°). */
export function throughPair(j: LogicalJunction): string[] {
  const a = [...j.approaches].sort((x, y) => y.lanes - x.lanes || (x.id < y.id ? -1 : 1))[0];
  if (!a) return [];
  const opp = j.approaches.filter(b => b.id !== a.id).map(b => ({ b, d: Math.abs((((b.bearingDeg - a.bearingDeg) % 360) + 360) % 360 - 180) })).sort((x, y) => x.d - y.d)[0];
  return opp && opp.d <= 45 ? [a.id, opp.b.id] : [a.id];
}

const majorsOf = (j: LogicalJunction) => {
  const top = Math.max(0, ...j.approaches.map(a => a.rank));
  return j.approaches.filter(a => a.rank === top).map(a => a.id);
};

/**
 * The whole-junction edit the brush applies. Keeps what the user already set at this junction (bans, lane connections,
 * a signal plan they edited, the major approaches); sets the control. Never `asRun` (the user chose the control).
 */
export function brushSpec(j: LogicalJunction, current: JunctionEditSpec | null, brush: JunctionBrush): JunctionEditSpec {
  const base: JunctionEditSpec = current ? structuredClone(current) : {
    junctionId: j.id, label: j.label, nodeKeys: [...j.nodeKeys],
    arms: [...j.approaches, ...j.exits].map(a => ({ id: a.id, kind: a.kind, label: a.label, keys: [...a.keys], chainKeys: [...a.chainKeys], lanes: a.lanes })),
    control: 'none', bannedMovements: [], laneConnections: {},
  };
  delete base.asRun;
  const approachWise: SignalPlan = { amberS: DEFAULT_AMBER_S, allRedS: DEFAULT_ALL_RED_S, phases: j.approaches.map(a => ({ greenS: DEFAULT_GREEN_S, arms: [a.id] })) };
  const approachIds = new Set(j.approaches.map(a => a.id));
  const planOk = (p: SignalPlan | undefined) => !!p && p.phases.length > 0 && j.approaches.every(a => p.phases.some(ph => ph.arms.includes(a.id))) && p.phases.every(ph => ph.arms.every(x => approachIds.has(x)));
  if (brush === 'signal') {
    base.control = 'signal';
    if (!planOk(base.signal)) base.signal = approachWise;
    base.pedestrianCrossings = current?.pedestrianCrossings ?? true;
    delete base.minorSign;
  } else if (brush === 'stop' || brush === 'give_way') {
    base.control = 'priority';
    base.minorSign = brush;
    if (!(base.majorArms ?? []).some(x => approachIds.has(x))) base.majorArms = majorsOf(j);
    // Every approach of the same class: no minor road to sign. The widest approach and the one opposite it (within 45°)
    // are taken as the major road, and said so in the inspector (the user can change it in the junction editor)
    if (base.majorArms!.filter(x => approachIds.has(x)).length >= j.approaches.length && j.approaches.length > 2) base.majorArms = throughPair(j);
  } else {
    base.control = 'none';
    delete base.minorSign;
  }
  return base;
}

// ── Markings ───────────────────────────────────────────────────────────────

export type MarkingKind = 'stop_line' | 'double_stop_line' | 'give_way_line' | 'zebra' | 'arrow' | 'stop_word' | 'give_way_triangle';

export interface MarkingItem {
  kind: MarkingKind;
  armId: string;
  /** Plan line across the approach lanes (stop / give-way lines, zebra centreline) or along the lane (arrow), lng/lat. */
  line: [number, number, number][];
  /** Width of the painted line (stop line 0.2 m) or of the zebra along the road (m). */
  widthM: number;
  /** Dash and gap (m) for a broken line, else null. */
  dashM: number | null;
  gapM: number | null;
  /** Second line of a double marking: gap between the two (m). */
  doubleGapM: number | null;
  /** The values it was drawn with and their sources. */
  sources: SdKey[];
}

export interface MarkingsResult {
  items: MarkingItem[];
  /** What could not be placed from the data (e.g. an approach with no stretch in the network). */
  notes: string[];
}

const LANE_M = 3.5;

/** Width of an approach carriageway (m) from its lanes; median half-width from the road when divided. */
function approachGeometry(road: DrivableObject | undefined, lanes: number) {
  const sec = road?.type === 'road' ? road.sections?.[0] : undefined;
  const laneW = (sec?.carriagewayA?.laneWidth ?? road?.laneWidth ?? LANE_M) || LANE_M;
  const median = sec ? (sec.hasMedian ? sec.medianWidth ?? 0 : 0) : road?.hasDivider ? road.dividerWidth ?? 0 : 0;
  const footpath = sec ? sec.carriagewayA?.leftRoadside?.footpathWidth ?? 0 : road?.hasFootpath ? road.footpathWidth ?? 0 : 0;
  return { widthM: Math.max(1, lanes) * laneW, laneW, medianHalfM: median / 2, footpathM: footpath, oneWay: !!road?.isOneWay };
}

/**
 * The IRC:35 transverse markings, zebras and arrows of a junction under a control (`spec`), placed on the approaches
 * of the logical junction `j` in network `net`. Geometry: the stop line is set back from the junction node by half the
 * widest other arm (the conflict area edge) plus the IRC:35 offsets; lines run from the centre line (or the median
 * edge) to the kerb on the left of the travel direction (India drives on the left); one-way approaches span the whole
 * carriageway.
 */
export function junctionMarkings(j: LogicalJunction, net: TrafficNetwork, roads: ReadonlyMap<string, DrivableObject>, spec: Pick<JunctionEditSpec, 'control' | 'minorSign' | 'majorArms' | 'pedestrianCrossings'>): MarkingsResult {
  const items: MarkingItem[] = [], notes: string[] = [];
  const brush = brushOf(spec);
  const zebras = spec.pedestrianCrossings ?? spec.control === 'signal';
  const majors = new Set(spec.majorArms ?? []);
  // Half the widest carriageway at the junction: the edge of the conflict area, measured from the node
  const widths = [...j.approaches, ...j.exits].map(a => {
    const road = roads.get(a.roadIds[0]);
    const g = approachGeometry(road, a.lanes);
    return (g.oneWay ? g.widthM : 2 * g.widthM + 2 * g.medianHalfM);
  });
  const halfBox = Math.max(3, ...widths) / 2;
  if (brush === 'uncontrolled' && !zebras) notes.push('No transverse markings at an uncontrolled junction: IRC:35 §6.1.1 uses stop lines only with a signal, a zebra or a STOP sign.');

  for (const a of j.approaches) {
    const e = a.edgeIds.map(id => net.edges.get(id)).find(Boolean);
    if (!e || e.coordinates.length < 2) { notes.push(`${a.label}: no stretch in the network here, nothing placed.`); continue; }
    const road = roads.get(e.roadId);
    const g = approachGeometry(road, e.lanes || a.lanes);
    const node = net.nodes.get(e.toNodeId)?.coordinates ?? e.coordinates[e.coordinates.length - 1];
    const f = frameAt(node);
    const prev = toXY(f, e.coordinates[e.coordinates.length - 2]);
    const L = Math.hypot(prev[0], prev[1]);
    if (L < 1e-6) { notes.push(`${a.label}: zero-length stretch, nothing placed.`); continue; }
    // u: unit vector of travel (towards the node); n: left normal
    const u = [-prev[0] / L, -prev[1] / L], n = [-u[1], u[0]];
    const across0 = g.oneWay ? -g.widthM / 2 : g.medianHalfM, across1 = g.oneWay ? g.widthM / 2 : g.medianHalfM + g.widthM;
    /** A line across the approach lanes at `back` metres before the node. */
    const across = (back: number): [number, number, number][] => [across0, across1].map(o => toLngLat(f, [-u[0] * back + n[0] * o, -u[1] * back + n[1] * o]));
    const minor = spec.control === 'priority' && !majors.has(a.id);
    let back = halfBox;
    if (zebras) {
      const zw = Math.max(SD.zebraMinWidthM.value, g.footpathM || 0);
      items.push({ kind: 'zebra', armId: a.id, line: across(back + zw / 2), widthM: zw, dashM: SD.zebraStripeM.value, gapM: SD.zebraStripeM.value, doubleGapM: null, sources: ['zebraMinWidthM', 'zebraStripeM'] });
      back += zw;
    }
    if (brush === 'signal') {
      back += zebras ? SD.stopLineSetbackSignalM.value : SD.stopLineNoZebraMinM.value;
      items.push({ kind: 'stop_line', armId: a.id, line: across(back + SD.stopLineUrbanM.value / 2), widthM: SD.stopLineUrbanM.value, dashM: null, gapM: null, doubleGapM: null,
        sources: zebras ? ['stopLineUrbanM', 'stopLineSetbackSignalM'] : ['stopLineUrbanM', 'stopLineNoZebraMinM'] });
      back += SD.stopLineUrbanM.value;
    } else if (minor && spec.minorSign === 'stop') {
      back += zebras ? SD.stopLineBeforeZebraMinM.value : SD.stopLineNoZebraMinM.value;
      items.push({ kind: 'double_stop_line', armId: a.id, line: across(back + SD.stopLineUrbanM.value / 2), widthM: SD.stopLineUrbanM.value, dashM: null, gapM: null, doubleGapM: SD.doubleStopLineGapM.value,
        sources: ['stopLineUrbanM', 'doubleStopLineGapM', zebras ? 'stopLineBeforeZebraMinM' : 'stopLineNoZebraMinM'] });
      back += 2 * SD.stopLineUrbanM.value + SD.doubleStopLineGapM.value;
      // STOP word 2.5–15 m behind the marking (IRC:35 §6.1.7): placed at 2.5 m
      items.push({ kind: 'stop_word', armId: a.id, line: across(back + 2.5), widthM: 0, dashM: null, gapM: null, doubleGapM: null, sources: [] });
    } else if (minor) {
      back += zebras ? SD.stopLineBeforeZebraMinM.value : SD.stopLineNoZebraMinM.value;
      items.push({ kind: 'give_way_line', armId: a.id, line: across(back + SD.stopLineUrbanM.value / 2), widthM: SD.stopLineUrbanM.value, dashM: SD.giveWayDashM.value, gapM: SD.giveWayGapM.value, doubleGapM: SD.doubleStopLineGapM.value,
        sources: ['giveWayDashM', 'giveWayGapM'] });
      back += 2 * SD.stopLineUrbanM.value + SD.doubleStopLineGapM.value;
      items.push({ kind: 'give_way_triangle', armId: a.id, line: across(back + 2.5), widthM: 0, dashM: null, gapM: null, doubleGapM: null, sources: [] });
    } else if (zebras) {
      // A major approach (or an uncontrolled one) with a zebra: the stop line 2–3 m before it (IRC:35 §11.3.2)
      back += SD.stopLineBeforeZebraMinM.value;
      items.push({ kind: 'stop_line', armId: a.id, line: across(back + SD.stopLineUrbanM.value / 2), widthM: SD.stopLineUrbanM.value, dashM: null, gapM: null, doubleGapM: null, sources: ['stopLineUrbanM', 'stopLineBeforeZebraMinM'] });
      back += SD.stopLineUrbanM.value;
    }
    // Directional arrows, one per approach lane, at an assumed 10 m behind the last transverse marking (signals and minor approaches)
    if (brush === 'signal' || minor) {
      const speed = road?.speedLimit ?? 50;
      const len = speed <= 50 ? SD.arrowLen50M.value : SD.arrowLen100M.value;
      const lanes = Math.max(1, e.lanes || a.lanes);
      for (let k = 0; k < lanes; k++) {
        const o = across0 + (k + 0.5) * (across1 - across0) / lanes;
        const b0 = back + SD.arrowSetbackM.value, b1 = b0 + len;
        items.push({ kind: 'arrow', armId: a.id, line: [b1, b0].map(b => toLngLat(f, [-u[0] * b + n[0] * o, -u[1] * b + n[1] * o])), widthM: 0, dashM: null, gapM: null, doubleGapM: null,
          sources: [speed <= 50 ? 'arrowLen50M' : 'arrowLen100M', 'arrowSetbackM'] });
      }
    }
  }
  return { items, notes };
}

/** Counts per marking kind (report / inspector). */
export function markingCounts(items: readonly MarkingItem[]): Partial<Record<MarkingKind, number>> {
  const out: Partial<Record<MarkingKind, number>> = {};
  for (const m of items) out[m.kind] = (out[m.kind] ?? 0) + 1;
  return out;
}

// ── Signal warrant screen (IRC:93-1985 Warrants 1 and 2) ───────────────────

export interface ApproachVolume { armId: string; vehPerHour: number }

/**
 * Screens a signal against IRC:93-1985 Warrant 1 (minimum vehicular volume, Table 2) and Warrant 2 (interruption of
 * continuous traffic, Table 3). The warrants need the volumes "for each of any 8 hours of an average day" from counts;
 * the model gives one modelled peak hour that is not validated against counts, so the best this says is whether the
 * modelled peak hour reaches the thresholds. Without volumes the warrant is 'unknown'. The 70 % rural / high-speed
 * reduction (§3.3, §4.2) is not applied (urban Pune, > 2.5 lakh population).
 */
export function signalWarrantChecks(j: Pick<LogicalJunction, 'approaches'>, spec: Pick<JunctionEditSpec, 'control' | 'majorArms'>, volumes: readonly ApproachVolume[] | null): SdCheck[] {
  const basis = basisOf('warrant1Major1', 'warrant2Major1', 'warrantHours');
  if (!volumes?.length) return [sdCheck({ id: 'signal-warrant', name: 'Signal warrant (IRC:93 Warrants 1–2)', status: 'unknown', unit: 'veh/h',
    text: 'No approach volumes: run Simulate (modelled peak hour) or enter 8 hours of counts. IRC:93 warrants need the volumes for each of any 8 hours of an average day.', basis })];
  const vol = new Map(volumes.map(v => [v.armId, v.vehPerHour]));
  const top = Math.max(0, ...j.approaches.map(a => a.rank));
  const major = new Set(spec.majorArms?.length ? spec.majorArms : j.approaches.filter(a => a.rank === top).map(a => a.id));
  const maj = j.approaches.filter(a => major.has(a.id)), min = j.approaches.filter(a => !major.has(a.id));
  if (!min.length) return [sdCheck({ id: 'signal-warrant', name: 'Signal warrant (IRC:93 Warrants 1–2)', status: 'unknown', unit: 'veh/h',
    text: 'Every approach is a major approach here, so there is no minor street for the IRC:93 warrants.', basis })];
  const majTotal = maj.reduce((n, a) => n + (vol.get(a.id) ?? 0), 0);
  const minHigh = Math.max(...min.map(a => vol.get(a.id) ?? 0));
  const majLanes = Math.max(1, ...maj.map(a => a.lanes)), minLanes = Math.max(1, ...min.map(a => a.lanes));
  const w1 = { maj: majLanes >= 2 ? SD.warrant1Major2.value : SD.warrant1Major1.value, min: minLanes >= 2 ? SD.warrant1Minor2.value : SD.warrant1Minor1.value };
  const w2 = { maj: majLanes >= 2 ? SD.warrant2Major2.value : SD.warrant2Major1.value, min: minLanes >= 2 ? SD.warrant2Minor2.value : SD.warrant2Minor1.value };
  const meets1 = majTotal >= w1.maj && minHigh >= w1.min, meets2 = majTotal >= w2.maj && minHigh >= w2.min;
  const r = (n: number) => Math.round(n);
  const what = `Modelled peak hour: major street ${r(majTotal)} veh/h (both approaches), higher minor approach ${r(minHigh)} veh/h. Warrant 1 needs ${w1.maj} / ${w1.min}, Warrant 2 ${w2.maj} / ${w2.min} (${majLanes >= 2 ? '2+' : '1'} major lane(s), ${minLanes >= 2 ? '2+' : '1'} minor lane(s)).`;
  const caveat = 'The warrants need 8 hours of counts; the model is one peak hour and is not validated against counts.';
  if (meets1 || meets2) return [sdCheck({ id: 'signal-warrant', name: 'Signal warrant (IRC:93 Warrants 1–2)', status: 'info', actual: r(majTotal), required: w1.maj, unit: 'veh/h',
    text: `${what} The modelled peak hour reaches Warrant ${meets1 ? '1' : '2'}${meets1 && meets2 ? ' and 2' : ''}. ${caveat}`, basis })];
  return [sdCheck({ id: 'signal-warrant', name: 'Signal warrant (IRC:93 Warrants 1–2)', status: spec.control === 'signal' ? 'warn' : 'info', actual: r(majTotal), required: w1.maj, unit: 'veh/h',
    text: `${what} Even the modelled peak hour is below both warrants${spec.control === 'signal' ? ', so a signal here may not be warranted by volume (Warrants 3–5: pedestrians, crash record, combination — not screened)' : ''}. ${caveat}`, basis })];
}
