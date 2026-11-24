import type { Suggestion } from './improvements';
import type { ComparisonResult, Verdict } from './ScenarioComparison';
import type { Bounds, StudyDirection } from './StudyAreaExplorer';
import type { DayType } from './timeOfDay';

/**
 * The analyse → change → re-test round trip (docs/urbanos/SIM_FLOW_P12.md): from a Simulate study, "Improve this" (or
 * "Make my own change") opens Design on a proposal with the target in view, a bar keeps the study in sight, and "Done –
 * re-test" brings the planner back to the same study, runs the proposal on the saved baseline's trips, hour and seeds,
 * and opens the comparison. This file is the engine-free part: what is kept (and survives a page reload), how a change
 * made on the way is found and judged, and the words the flow uses. The controller is shell/roundTripController.ts.
 */

export const ROUND_TRIP_VERSION = 1;
/** sessionStorage key: the round trip survives a reload of this tab, never a new browser session. */
export const ROUND_TRIP_STORAGE_KEY = 'urbanos.sim-round-trip';

/** What the planner set out to change (a suggestion of the analysis), or null for a change of their own. */
export interface TripTarget {
  kind: Suggestion['kind'];
  title: string;
  /** Roads to select in Design (the studied road, or the parallel road for a diversion). */
  roadIds: string[];
  /** Where to put the camera (a junction, or null for the road itself). */
  at: [number, number, number] | null;
  /** Open the junction at `at` in Design's junction editor. */
  junction?: boolean;
}

/** The Simulate study the trip came from: what "Return to study" restores exactly. */
export interface TripStudy {
  seedRoadIds: string[];
  /** The study's name as the panel showed it (road names, or the closed road's). */
  label: string;
  rangeMeters: number;
  direction: StudyDirection;
  hour: number;
  day: DayType;
  /** The study area's extent when the trip started (to tell a change outside it). */
  bounds: Bounds | null;
}

/** One re-test: the proposal run against the saved baseline. */
export interface TripTest {
  iteration: number;
  proposalId: string;
  proposalName: string;
  /** The suggestion it tested (kind and title), null for the planner's own change. */
  target: { kind: Suggestion['kind']; title: string } | null;
  verdict: Verdict;
  confidence: string;
  summary: string;
  /** The network the proposal run used (to tell "nothing changed since the last test"). */
  networkKey: string;
  at: string;
  /** The road-level figures of the proposal side, for "since your last test". */
  figures: { label: string; value: number | null; unit: string; higherIsBetter: boolean | null }[];
}

/** The excursion in progress: out of Simulate, changing a proposal. */
export interface TripLeg {
  id: string;
  startedAt: string;
  target: TripTarget | null;
  proposalId: string;
  proposalName: string;
  /** The flow made this proposal (Cancel → Undo deletes it; the existing city never changes). */
  createdProposal: boolean;
  /** The proposal's change set when the leg started: object id → version stamp ('×' a removed base object). */
  startSnapshot: Record<string, string>;
  /** Undo steps in the proposal's history when the leg started (Cancel → Undo goes back to it). */
  undoCountAtStart: number;
  phase: 'editing' | 'retesting';
}

export interface RoundTripState {
  v: typeof ROUND_TRIP_VERSION;
  study: TripStudy;
  leg: TripLeg | null;
  tests: TripTest[];
  /** A step of the re-test the planner should see (progress, or why it stopped); null when there is nothing to say. */
  status: { tone: 'info' | 'warn' | 'bad' | 'good'; text: string; retry?: boolean } | null;
  /** The baseline was saved by the flow itself (said once in the panel). */
  baselineSavedByFlow: boolean;
  /** Set when the page was reloaded with a leg in progress: the bar offers to resume. */
  resumed?: boolean;
}

// ── Change detection ──────────────────────────────────────────────────────

/** A minimal object view: what the flow reads of a city object. */
export interface TripObject { id: string; type: string; name?: string; updatedAt?: string; coordinates?: unknown; scenarioId?: string;
  /** Set on an existing road whose capacity a new flyover reduced (merge and weave at its ramps, BUILD_PROPAGATION.md): a side effect, not a change of its own. */
  flyoverImpact?: { flyoverId?: string } | null }

/** The change set of a proposal as id → stamp: its own objects and its changes to base objects ('×' for a removal). */
export function proposalSnapshot(own: readonly TripObject[], overlay: ReadonlyMap<string, TripObject | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of own) out[o.id] = stampOf(o);
  for (const [id, o] of overlay) out[id] = o === null ? '×' : stampOf(o);
  return out;
}
/** A stamp of an object's content without its timestamps: an undo writes the old values back with a new updatedAt, and
 *  that is no change (P12 browser check: Cancel → "Undo them" reported "1 change could not be undone" after undoing it). */
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v) ?? 'null';
const stampOf = (o: TripObject) => {
  const { updatedAt: _u, createdAt: _c, ...rest } = o as TripObject & { createdAt?: unknown };
  const text = stable(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}#${text.length}`;
};

/** Ids added, changed or removed between two snapshots of a proposal's change set. */
export function changedSince(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter(id => before[id] !== after[id]).sort();
}

/** Types that are part of the road network the traffic model builds (others never change a traffic result). */
const NETWORK_TYPES = new Set(['road', 'flyover', 'metro_flyover', 'junction', 'street_element']);
/** Types drawn below ground: Simulate does not see them. */
const UNDERGROUND_TYPES = new Set(['underground_alignment', 'utility']);
/** Types that change demand (land use), not the network. */
const DEMAND_TYPES = new Set(['building', 'zone', 'gateway']);
/** metro_line, metro_station: transit, not modelled in road traffic (BUILD_PROPAGATION.md). */

export interface ChangeSummary {
  total: number;
  /** Changes that reach the traffic network (roads, flyovers, junctions, street elements). */
  network: number;
  /** Of those: junctions (a junction drawn or an existing junction's control edited) and street elements; the rest are roads. */
  junctions?: number;
  streetElements?: number;
  /** New objects drawn in the proposal, by type (a flyover, a road), counted apart from changes to existing ones. */
  added?: Record<string, number>;
  /** Existing roads changed only as a side effect of a new flyover in this change set (merge loss at its ramps). */
  sideEffects?: number;
  /** Network changes with any point inside the study area. */
  inArea: number;
  underground: number;
  demand: number;
  other: number;
  /** Names of network changes outside the study area (for the warning). */
  outsideNames: string[];
}

function points(c: unknown, out: number[][] = []): number[][] {
  if (!Array.isArray(c)) return out;
  if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') { out.push(c as number[]); return out; }
  for (const x of c) points(x, out);
  return out;
}

/** Whether any point of `coords` lies inside `b` (padded by `padM` metres). */
export function touchesBounds(coords: unknown, b: Bounds, padM = 50): boolean {
  const dLat = padM / 111320, dLng = padM / (111320 * Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180));
  return points(coords).some(([x, y]) => x >= b.minLng - dLng && x <= b.maxLng + dLng && y >= b.minLat - dLat && y <= b.maxLat + dLat);
}

/**
 * What the changed objects are: network / underground / demand, and whether the network changes reach the study area.
 * `lookup` returns the object as the proposal shows it now, or (for a removal) as it was; a removal with no copy left
 * is counted as a network change in the area (it cannot be placed, and leaving it out would hide a closure).
 */
export function summariseChanges(ids: readonly string[], lookup: (id: string) => TripObject | undefined, bounds: Bounds | null, isExisting?: (id: string) => boolean): ChangeSummary {
  const s: ChangeSummary = { total: ids.length, network: 0, junctions: 0, streetElements: 0, added: {}, sideEffects: 0, inArea: 0, underground: 0, demand: 0, other: 0, outsideNames: [] };
  const inSet = new Set(ids);
  for (const id of ids) {
    const o = lookup(id);
    if (!o) { s.network++; s.inArea++; continue; }
    if (UNDERGROUND_TYPES.has(o.type)) s.underground++;
    else if (DEMAND_TYPES.has(o.type)) s.demand++;
    else if (NETWORK_TYPES.has(o.type)) {
      s.network++;
      const existing = isExisting?.(id) ?? false;
      // A flyover drawn in this leg lowers the capacity of the roads at its ramps (merge and weave, BUILD_PROPAGATION.md): one change,
      // not "16 road changes" (P12 browser test)
      const side = existing && !!o.flyoverImpact?.flyoverId && inSet.has(o.flyoverImpact.flyoverId);
      if (side) s.sideEffects!++;
      else if (o.type === 'junction') s.junctions!++;
      else if (o.type === 'street_element') s.streetElements!++;
      else if (isExisting && !existing) s.added![o.type] = (s.added![o.type] ?? 0) + 1;
      if (!bounds || touchesBounds(o.coordinates, bounds)) s.inArea++;
      else if (side) continue;
      else if (o.name && !s.outsideNames.includes(o.name)) s.outsideNames.push(o.name);
      else if (!o.name && !s.outsideNames.includes('an unnamed road')) s.outsideNames.push('an unnamed road');
    } else s.other++;
  }
  return s;
}

/** What "Done – re-test" should do with what was changed. */
export type RetestDecision =
  | { action: 'run' }
  | { action: 'outside-area'; names: string[] }
  | { action: 'underground-only' }
  | { action: 'nothing-changed' };

/**
 * Before leaving Design: a leg with network changes only outside the study area is warned about (the simulation of
 * this area would not see them); a leg with underground changes only has nothing the traffic model reads. A leg with
 * no change at all still returns and re-tests when the proposal differs from the last test (an earlier change, or a
 * switch to another proposal): that is decided in Simulate, where the network is known (decideInSimulate).
 */
export function decideBeforeReturn(s: ChangeSummary, opts: { outsideAccepted?: boolean } = {}): RetestDecision {
  if (s.total === 0) return { action: 'nothing-changed' };
  if (s.network === 0 && s.demand === 0 && s.underground > 0) return { action: 'underground-only' };
  if (s.network > 0 && s.inArea === 0 && s.demand === 0 && !opts.outsideAccepted) return { action: 'outside-area', names: s.outsideNames };
  return { action: 'run' };
}

/** Back in Simulate, with the network of the active proposal known. */
export type SimulateDecision =
  | { action: 'compare' }
  | { action: 'same-as-baseline' }
  | { action: 'same-as-last-test' }
  | { action: 'need-proposal' };

export function decideInSimulate(o: { isProposal: boolean; networkKey: string; baselineNetworkKey: string | null; lastTestedNetworkKey: string | null; lastResultShown: boolean }): SimulateDecision {
  if (!o.isProposal) return { action: 'need-proposal' };
  if (o.baselineNetworkKey !== null && o.networkKey === o.baselineNetworkKey) return { action: 'same-as-baseline' };
  if (o.lastResultShown && o.lastTestedNetworkKey === o.networkKey) return { action: 'same-as-last-test' };
  return { action: 'compare' };
}

// ── Suggestions and tests ─────────────────────────────────────────────────

/** Kinds of suggestion that describe a change Design can make. */
export const IMPROVABLE = new Set<Suggestion['kind']>(['junction', 'signal', 'widen', 'divert']);

/** A suggestion's identity across runs: its kind and title without the figures that change with each run. */
export const suggestionKey = (s: { kind: string; title: string }) => `${s.kind}:${s.title.replace(/[\d.,%]+/g, '#').trim().toLowerCase()}`;

/** The latest test of this suggestion, if one was run. */
export function testOf(tests: readonly TripTest[], s: { kind: string; title: string }): TripTest | null {
  const k = suggestionKey(s);
  for (let i = tests.length - 1; i >= 0; i--) if (tests[i].target && suggestionKey(tests[i].target!) === k) return tests[i];
  return null;
}

/** Suggestions tested earlier that the latest run no longer makes (the problem they answered is gone or moved). */
export function testedButGone(tests: readonly TripTest[], current: readonly { kind: string; title: string }[]): TripTest[] {
  const now = new Set(current.map(suggestionKey));
  const seen = new Set<string>();
  const out: TripTest[] = [];
  for (let i = tests.length - 1; i >= 0; i--) {
    const t = tests[i];
    if (!t.target) continue;
    const k = suggestionKey(t.target);
    if (seen.has(k) || now.has(k)) { seen.add(k); continue; }
    seen.add(k);
    out.push(t);
  }
  return out;
}

const VERDICT_WORD: Record<Verdict, string> = { better: 'Better', worse: 'Worse', mixed: 'Mixed', no_change: 'No clear change' };
export const verdictWord = (v: Verdict) => VERDICT_WORD[v];

/** The road-level figures a test keeps (proposal side), for the comparison with the next test. */
export function figuresOf(c: ComparisonResult): TripTest['figures'] {
  return c.section.map(d => ({ label: d.label, value: d.after, unit: d.unit ?? '', higherIsBetter: !d.lowerIsBetter }));
}

/** Change of each road-level figure from the previous test to this one (both against the same baseline). */
export function sinceLastTest(prev: TripTest, now: TripTest): { label: string; before: number; after: number; change: number; unit: string; good: boolean | null }[] {
  const out: { label: string; before: number; after: number; change: number; unit: string; good: boolean | null }[] = [];
  for (const f of now.figures) {
    const p = prev.figures.find(x => x.label === f.label);
    if (!p || p.value === null || f.value === null) continue;
    const change = p.value === 0 ? (f.value === 0 ? 0 : Infinity) : f.value / p.value - 1;
    if (!Number.isFinite(change)) continue;
    const good = Math.abs(change) < 0.05 || f.higherIsBetter === null ? null : (change > 0) === f.higherIsBetter;
    out.push({ label: f.label, before: p.value, after: f.value, change, unit: f.unit, good });
  }
  return out;
}

// ── Words ─────────────────────────────────────────────────────────────────

/** What the bar says the planner is changing. */
export function legHeadline(leg: Pick<TripLeg, 'target'>): string {
  return leg.target ? `Trying: ${leg.target.title}` : 'Making your own change';
}

/** How many changes so far, in words. */
export function changeCountText(s: ChangeSummary): string {
  if (s.total === 0) return 'No change yet';
  const parts: string[] = [];
  const junctions = s.junctions ?? 0, elements = s.streetElements ?? 0, side = s.sideEffects ?? 0;
  const added = Object.entries(s.added ?? {});
  const roads = s.network - junctions - elements - side - added.reduce((n, [, k]) => n + k, 0);
  const n = (k: number, w: string) => `${k} ${w} change${k === 1 ? '' : 's'}`;
  const NEW: Record<string, [string, string]> = { flyover: ['flyover', 'flyovers'], metro_flyover: ['metro flyover', 'metro flyovers'], road: ['road', 'roads'] };
  for (const [type, k] of added) { const w = NEW[type] ?? [type.replace(/_/g, ' '), `${type.replace(/_/g, ' ')}s`]; parts.push(`${k} new ${k === 1 ? w[0] : w[1]}`); }
  if (roads > 0) parts.push(n(roads, 'road'));
  if (junctions) parts.push(n(junctions, 'junction'));
  if (elements) parts.push(n(elements, 'street element'));
  if (s.demand) parts.push(`${s.demand} land-use change${s.demand === 1 ? '' : 's'}`);
  if (s.underground) parts.push(`${s.underground} underground`);
  if (s.other) parts.push(`${s.other} other`);
  const text = parts.join(', ');
  return side ? `${text || 'No change of its own'} (${side} road${side === 1 ? '' : 's'} it joins adjusted for merging at its ramps)` : text;
}

export function outsideAreaText(names: readonly string[], rangeMeters: number): string {
  const what = names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '') : 'Your change';
  return `${what} ${names.length > 1 ? 'are' : 'is'} outside the ${rangeMeters >= 1000 ? `${rangeMeters / 1000} km` : `${rangeMeters} m`} study area, so this study's simulation would not see ${names.length > 1 ? 'them' : 'it'}.`;
}

export const UNDERGROUND_ONLY_TEXT = 'These changes are below ground (a tunnel alignment or a utility). The traffic model reads only the road network, so they cannot change this study\'s result. Nothing to re-test.';
export const NOTHING_CHANGED_TEXT = 'You made no change since leaving Simulate.';
export const SAME_AS_BASELINE_TEXT = 'This proposal has no road change against the existing city that the traffic model can see, so there is nothing to compare. Make a change in Design, or pick another proposal.';
export const SAME_AS_LAST_TEXT = 'Nothing changed since your last test: the comparison below is still current.';
export const BASE_ACTIVE_TEXT = 'You are on the existing city (Base). While you test a change from Simulate, the existing city stays as it is: switch back to the proposal to keep editing.';

/** The next larger study distance that may take in a change outside the area (null: already the largest). */
export function widerRange(current: number, options: readonly number[]): number | null {
  return options.find(m => m > current) ?? null;
}

// ── Storage (sessionStorage: survives a reload of this tab only) ────────────

export interface TripStorage { get(): string | null; set(v: string | null): void }

export const sessionTripStorage: TripStorage = {
  get: () => { try { return globalThis.sessionStorage?.getItem(ROUND_TRIP_STORAGE_KEY) ?? null; } catch { return null; } },
  set: v => { try { if (v === null) globalThis.sessionStorage?.removeItem(ROUND_TRIP_STORAGE_KEY); else globalThis.sessionStorage?.setItem(ROUND_TRIP_STORAGE_KEY, v); } catch { /* storage full or blocked: the trip lives in memory only */ } },
};

/** A stored round trip, or null when there is none or it is not one this build can read (never half a trip). */
export function parseTrip(raw: string | null): RoundTripState | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as RoundTripState;
    if (!t || t.v !== ROUND_TRIP_VERSION || !t.study || !Array.isArray(t.study.seedRoadIds) || !t.study.seedRoadIds.length || !Array.isArray(t.tests)) return null;
    if (t.leg && (typeof t.leg.proposalId !== 'string' || !t.leg.startSnapshot)) return null;
    return t;
  } catch { return null; }
}

/**
 * After a reload: a leg that was re-testing stopped with the page (the run is gone), so it is back to editing, and the
 * bar offers to resume. Progress text from the old page is dropped.
 */
export function afterReload(t: RoundTripState): RoundTripState {
  return { ...t, leg: t.leg ? { ...t.leg, phase: 'editing' } : null, status: null, resumed: !!t.leg };
}

/**
 * Esc in Simulate: clear the study (then leave the mode), as always, except while a re-test from Design runs on the
 * study, when Esc must not pull the study from under it ('hold').
 */
export function simulateEscape(o: { legPhase: TripLeg['phase'] | null; hasStudy: boolean }): 'hold' | 'clear-study' | 'leave' {
  if (o.legPhase === 'retesting') return 'hold';
  return o.hasStudy ? 'clear-study' : 'leave';
}
