import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { commitRoadFieldEdit } from '../editing/roadEdits';
import type { CityObject, RoadObject } from '../objects/types';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { isDrivable, type DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode } from '../simulation/SimulationMode';
import {
  afterReload, changedSince, decideBeforeReturn, decideInSimulate, parseTrip, proposalSnapshot, sinceLastTest, suggestionKey, summariseChanges,
  testOf, testedButGone, widerRange, outsideAreaText, ROUND_TRIP_VERSION, type RoundTripState, type TripTest,
} from '../simulation/roundTrip';
import { RoundTripController, useRoundTrip, type RoundTripDeps } from '../../shell/roundTripController';

/**
 * The Simulate → Design → Simulate round trip (docs/urbanos/SIM_FLOW_P12.md): the change detection and decisions
 * (engine-free), then the controller end to end on a real ObjectManager, HistoryManager and SimulationMode: a
 * suggestion opens a proposal (the existing city never changes), the change is re-tested on the saved baseline's
 * trips, and the edge cases (no baseline, no change, outside the area, underground only, cancel, switch, reload,
 * failure) end cleanly.
 */

const LAT0 = 18.53;
const kx = 111320 * Math.cos(LAT0 * Math.PI / 180);
type P3 = [number, number, number];
const pt = (x: number, y: number, z = 0): P3 => [73.85 + x / kx, LAT0 + y / 111320, z];
const T = '2026-11-25T00:00:00.000Z';
const road = (id: string, coords: P3[], extra: Partial<RoadObject> = {}): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: coords, roadClass: 'arterial', width: 7, laneCount: 2, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [],
  createdAt: T, updatedAt: T, ...extra,
} as RoadObject);
const baseCity = (): CityObject[] => [
  road('ew', [pt(-400, 0), pt(0, 0), pt(400, 0), pt(800, 0), pt(1200, 0)]),
  road('ns', [pt(400, -400), pt(400, 0), pt(400, 400)]),
  road('north', [pt(-400, 300), pt(400, 300), pt(1200, 300)], { roadClass: 'collector', speedLimit: 40 }),
  road('w1', [pt(-400, 0), pt(-400, 300)], { roadClass: 'local', speedLimit: 30 }),
  road('e1', [pt(1200, 0), pt(1200, 300)], { roadClass: 'local', speedLimit: 30 }),
  // Far away (about 30 km east): outside any study area here
  road('far', [pt(30000, 0), pt(31000, 0)], { name: 'Far Road' }),
];
/** Real OSM roads around Sangamwadi Bridge (as ClosedStudyRoad.test.ts) and a road far outside any study area there. */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[] };
const DECK = 'osm_208004768', OTHER = 'osm_216506271';
const FAR: RoadObject = road('far', [[74.15, 18.53, 0], [74.16, 18.53, 0]], { name: 'Far Road' });
const city = (): CityObject[] => [...structuredClone(fx.roads), FAR];
const bounds = { minLng: pt(-500, 0)[0], maxLng: pt(1300, 0)[0], minLat: pt(0, -500)[1], maxLat: pt(0, 500)[1] };

// ── Engine-free model ─────────────────────────────────────────────────────

describe('round trip model', () => {
  it('finds what changed in a proposal and where it is', () => {
    const a = proposalSnapshot([{ id: 'n1', type: 'road', updatedAt: '1', coordinates: [[0, 0], [1, 1]] }], new Map([['ew', { id: 'ew', type: 'road', updatedAt: '1' }]]));
    const b = proposalSnapshot([{ id: 'n1', type: 'road', updatedAt: '2', coordinates: [[0, 0], [1, 1]] }, { id: 'u1', type: 'utility', updatedAt: '1' }], new Map([['ew', null]]));
    expect(changedSince(a, b)).toEqual(['ew', 'n1', 'u1']);
    expect(changedSince(a, a)).toEqual([]);
    const objs: Record<string, any> = {
      ew: { id: 'ew', type: 'road', name: 'ew', coordinates: [pt(0, 0), pt(400, 0)] },
      far: { id: 'far', type: 'road', name: 'Far Road', coordinates: [pt(30000, 0), pt(31000, 0)] },
      u1: { id: 'u1', type: 'utility', coordinates: [pt(0, 0)] },
      b1: { id: 'b1', type: 'building', coordinates: [pt(0, 0)] },
    };
    expect(summariseChanges(['ew', 'far', 'u1'], id => objs[id], bounds)).toMatchObject({ total: 3, network: 2, inArea: 1, underground: 1, outsideNames: ['Far Road'] });
    // A removal with no copy left counts as a change in the area (never hides a closure)
    expect(summariseChanges(['gone'], () => undefined, bounds)).toMatchObject({ network: 1, inArea: 1 });
    expect(decideBeforeReturn(summariseChanges(['far'], id => objs[id], bounds))).toEqual({ action: 'outside-area', names: ['Far Road'] });
    expect(decideBeforeReturn(summariseChanges(['far'], id => objs[id], bounds), { outsideAccepted: true })).toEqual({ action: 'run' });
    expect(decideBeforeReturn(summariseChanges(['u1'], id => objs[id], bounds))).toEqual({ action: 'underground-only' });
    expect(decideBeforeReturn(summariseChanges(['b1'], id => objs[id], bounds))).toEqual({ action: 'run' });
    expect(decideBeforeReturn(summariseChanges([], id => objs[id], bounds))).toEqual({ action: 'nothing-changed' });
    expect(outsideAreaText(['Far Road'], 2000)).toBe('Far Road is outside the 2 km study area, so this study\'s simulation would not see it.');
    expect(widerRange(2000, [500, 1000, 2000, 3000, 5000])).toBe(3000);
    expect(widerRange(5000, [500, 1000, 2000, 3000, 5000])).toBeNull();
  });

  it('decides in Simulate: compare, nothing to compare, or nothing new since the last test', () => {
    const base = { isProposal: true, networkKey: 'k2', baselineNetworkKey: 'k1', lastTestedNetworkKey: null, lastResultShown: false };
    expect(decideInSimulate(base)).toEqual({ action: 'compare' });
    expect(decideInSimulate({ ...base, networkKey: 'k1' })).toEqual({ action: 'same-as-baseline' });
    expect(decideInSimulate({ ...base, lastTestedNetworkKey: 'k2', lastResultShown: true })).toEqual({ action: 'same-as-last-test' });
    // The last result is gone (e.g. invalidated): run again even on the same network
    expect(decideInSimulate({ ...base, lastTestedNetworkKey: 'k2', lastResultShown: false })).toEqual({ action: 'compare' });
    expect(decideInSimulate({ ...base, isProposal: false })).toEqual({ action: 'need-proposal' });
  });

  it('matches suggestions across runs by kind and title without their figures; lists tested ones no longer flagged', () => {
    expect(suggestionKey({ kind: 'widen', title: 'Add a lane' })).toBe(suggestionKey({ kind: 'widen', title: 'Add a lane' }));
    expect(suggestionKey({ kind: 'signal', title: 'Retime the signal at X 12' })).toBe(suggestionKey({ kind: 'signal', title: 'Retime the signal at X 15' }));
    const t = (i: number, title: string, verdict: TripTest['verdict'] = 'better'): TripTest => ({ iteration: i, proposalId: 'p', proposalName: 'P', target: { kind: 'widen', title }, verdict, confidence: 'low', summary: '', networkKey: `k${i}`, at: T,
      figures: [{ label: 'Time to drive it', value: 300 - i * 30, unit: 's', higherIsBetter: false }, { label: 'Speed on it', value: 10 + i, unit: 'km/h', higherIsBetter: true }] });
    const tests = [t(1, 'Add a lane'), t(2, 'Add a lane', 'mixed')];
    expect(testOf(tests, { kind: 'widen', title: 'Add a lane' })!.iteration).toBe(2);
    expect(testOf(tests, { kind: 'signal', title: 'Add a lane' })).toBeNull();
    expect(testedButGone(tests, [])).toHaveLength(1);
    expect(testedButGone(tests, [{ kind: 'widen', title: 'Add a lane' }])).toHaveLength(0);
    const since = sinceLastTest(tests[0], tests[1]);
    expect(since[0]).toMatchObject({ label: 'Time to drive it', before: 270, after: 240, good: true });
    expect(since[1]).toMatchObject({ label: 'Speed on it', before: 11, after: 12, good: true });
  });

  it('reads back a stored trip only when it is whole; after a reload a re-test in progress is back to editing', () => {
    expect(parseTrip(null)).toBeNull();
    expect(parseTrip('{bad')).toBeNull();
    expect(parseTrip(JSON.stringify({ v: 99 }))).toBeNull();
    expect(parseTrip(JSON.stringify({ v: ROUND_TRIP_VERSION, study: { seedRoadIds: [] }, tests: [] }))).toBeNull();
    const ok: RoundTripState = { v: ROUND_TRIP_VERSION, study: { seedRoadIds: ['ns'], label: 'ns', rangeMeters: 2000, direction: 'both', hour: 9, day: 'weekday', bounds },
      leg: { id: 'l', startedAt: T, target: null, proposalId: 'p', proposalName: 'P', createdProposal: true, startSnapshot: {}, undoCountAtStart: 0, phase: 'retesting' },
      tests: [], status: { tone: 'info', text: 'running' }, baselineSavedByFlow: false };
    const r = afterReload(parseTrip(JSON.stringify(ok))!);
    expect(r.leg!.phase).toBe('editing');
    expect(r.status).toBeNull();
    expect(r.resumed).toBe(true);
  });
});

// ── Controller, end to end on the engine ──────────────────────────────────

afterEach(() => { vi.restoreAllMocks(); useRoundTrip.setState({ trip: null, changes: null, ask: null, baseActive: false }); });

function setup(o: { stored?: string | null; createFails?: boolean } = {}) {
  const om = new ObjectManager();
  for (const k of Object.getOwnPropertyNames(ObjectManager.prototype).filter(n => /^sync(Post|Delete|Changes)/.test(n))) {
    if (typeof (om as any)[k] === 'function') vi.spyOn(om as any, k).mockResolvedValue(undefined);
  }
  (om as any).deletedOsm = new Set<string>();
  om.addMultiple(city(), true);
  const history = new HistoryManager(om);
  const scen = new Map<string, { id: string; name: string; isBase?: boolean }>([['base', { id: 'base', name: 'Current City', isBase: true }]]);
  let active = 'base';
  const scenCbs: (() => void)[] = [];
  const roadsOf = () => filterObjectsForScenario(om.viewOf(active), active).filter(isDrivable) as DrivableObject[];
  const mode = new SimulationMode(roadsOf, null, null, () => ({ buildings: [], scenarioId: active }), () => Promise.reject(new Error('no counts')), null, null);
  mode.analysisSeeds = [42];
  mode.setBaselineStore({ get: async () => undefined, put: async () => {} });
  om.onChange(() => mode.networkChanged());
  const setActive = (id: string) => { if (id === active || !scen.has(id)) return; active = id; om.setActiveScenario(id); history.scopeChanged(); mode.networkChanged(); scenCbs.forEach(cb => cb()); };
  let appMode = 'view', workspace = 'explore', locked = false, stored: string | null = o.stored ?? null, n = 0;
  const modeCbs: (() => void)[] = [];
  const calls: string[] = [];
  const deps: RoundTripDeps = {
    sim: mode as unknown as RoundTripDeps['sim'],
    scenarios: { getActiveScenarioId: () => active, get: id => scen.get(id), setActiveScenario: setActive, onChange: cb => { scenCbs.push(cb); return () => {}; } },
    objects: om as unknown as RoundTripDeps['objects'],
    history,
    createProposal: async name => { if (o.createFails) throw new Error('backend offline'); const id = `scn_t${++n}`; scen.set(id, { id, name }); setActive(id); return { id, name }; },
    deleteProposal: async id => { scen.delete(id); om.dropScenario(id); history.clearScope(id); if (active === id) setActive('base'); },
    goTo: ws => { workspace = ws; calls.push(`goTo:${ws}`); if (ws === 'simulate') { appMode = 'simulate'; mode.enter(); } else { mode.exit(); appMode = 'build'; } modeCbs.forEach(cb => cb()); },
    workspace: () => workspace,
    appMode: () => appMode,
    onAppMode: cb => { modeCbs.push(cb); return () => {}; },
    setSimulateTab: t => calls.push(`tab:${t}`),
    focusInDesign: (t, ids) => calls.push(`focus:${t ? t.kind : 'own'}:${(t?.roadIds ?? ids).join(',')}`),
    setEditingLocked: l => { locked = l; },
    storage: { get: () => stored, set: v => { stored = v; } },
    now: () => T,
    sleep: () => Promise.resolve(),
  };
  const rt = new RoundTripController(deps);
  const study = async () => {
    workspace = 'simulate'; appMode = 'simulate'; mode.enter(); mode.setRange(700); mode.selectRoad(DECK, false);
    await mode.whenSettled(); await mode.runAnalysis();
  };
  const widen = () => commitRoadFieldEdit(om as any, history as any, om.getById(DECK) as RoadObject, 'lanesForward', 3, 'carriageway' as any);
  const baseCanon = () => JSON.stringify(om.viewOf('base').map(x => [x.id, x.updatedAt, (x as RoadObject).laneCount]).sort());
  return { om, history, mode, rt, deps, calls, study, widen, baseCanon, setActive, scen, active: () => active, locked: () => locked, stored: () => stored, workspace: () => workspace };
}

const WIDEN = { kind: 'widen' as const, title: 'Add a lane', evidence: '', why: '', action: { label: 'Select the road in Design', roadIds: [DECK], at: null } };

describe('round trip controller (real ObjectManager, HistoryManager, SimulationMode)', () => {
  it('Improve this → change in a new proposal → Done: the baseline is saved first, the change is re-tested on its trips, the base never changes', async () => {
    const s = setup();
    await s.study();
    const base0 = s.baseCanon();
    expect(await s.rt.start(WIDEN)).toBe(true);
    const t = useRoundTrip.getState().trip!;
    expect(t.baselineSavedByFlow).toBe(true);
    expect(s.mode.getState().comparison.baseline!.scenarioId).toBe('base');
    expect(t.leg!.createdProposal).toBe(true);
    expect(t.leg!.proposalName).toContain('Add a lane');
    expect(s.active()).toBe(t.leg!.proposalId);
    expect(s.calls).toContain('goTo:design');
    expect(s.calls).toContain(`focus:widen:${DECK}`);
    // The study is kept while away
    expect(s.mode.getState().seedRoadIds).toEqual([DECK]);

    s.widen();
    const ch = s.rt.currentChanges();
    expect(ch.network).toBeGreaterThanOrEqual(1);
    expect(ch.inArea).toBe(ch.network);
    await s.rt.finish();
    const after = useRoundTrip.getState().trip!;
    expect(after.leg).toBeNull();
    expect(after.status!.tone).toBe('good');
    expect(after.tests).toHaveLength(1);
    expect(after.tests[0]).toMatchObject({ iteration: 1, target: { kind: 'widen', title: 'Add a lane' } });
    const c = s.mode.getState().comparison;
    expect(c.result).toBeTruthy();
    expect(c.current!.scenarioId).toBe(after.tests[0].proposalId);
    // Same frozen demand, hour and seeds as the baseline
    expect(c.current!.demandKey).toBe(c.baseline!.demandKey);
    expect(c.current!.inputs.seeds).toEqual(c.baseline!.inputs.seeds);
    expect(s.calls).toContain('tab:improve');
    expect(s.baseCanon()).toBe(base0);

    // Second round trip on the same study: compared with the same original baseline, numbered 2
    const baselineKey = c.baseline!.networkKey;
    expect(await s.rt.start(WIDEN)).toBe(true);
    expect(useRoundTrip.getState().trip!.leg!.createdProposal).toBe(false); // the proposal on show is reused
    // Another road inside the study area
    const inside = s.mode.getState().area!.segments.map(x => s.om.getById(x.roadId) as RoadObject).find(r => !!r && r.type === 'road' && r.id !== DECK && !r.isOneWay && r.roadClass !== 'local')!;
    commitRoadFieldEdit(s.om as any, s.history as any, inside, 'lanesForward', (inside.sections?.[0]?.carriagewayA?.lanes ?? 1) + 1, 'carriageway' as any);
    await s.rt.finish();
    const two = useRoundTrip.getState().trip!;
    expect(useRoundTrip.getState().ask, JSON.stringify(two.status)).toBeNull();
    expect(two.tests.map(x => x.iteration)).toEqual([1, 2]);
    expect(s.mode.getState().comparison.baseline!.networkKey).toBe(baselineKey);
    expect(s.baseCanon()).toBe(base0);
  }, 120_000);

  it('Done with no change: nothing to compare against the existing city, no run, the leg ends', async () => {
    const s = setup();
    await s.study();
    await s.rt.start(null);
    const run = vi.spyOn(s.mode, 'runComparison');
    await s.rt.finish();
    const t = useRoundTrip.getState().trip!;
    expect(t.leg).toBeNull();
    expect(t.status!.text).toMatch(/no change since leaving Simulate.*nothing to compare/i);
    expect(run).not.toHaveBeenCalled();
  }, 60_000);

  it('a change outside the study area asks first; underground-only changes are not re-tested', async () => {
    const s = setup();
    await s.study();
    await s.rt.start(null);
    commitRoadFieldEdit(s.om as any, s.history as any, s.om.getById('far') as RoadObject, 'lanesForward', 2, 'carriageway' as any);
    await s.rt.finish();
    expect(useRoundTrip.getState().ask).toEqual({ kind: 'outside', names: ['Far Road'] });
    expect(useRoundTrip.getState().trip!.leg!.phase).toBe('editing');
    s.rt.dismissAsk();
    expect(useRoundTrip.getState().ask).toBeNull();
    s.history.undo();
    s.om.add({ id: 'ut1', type: 'utility', name: 'Water main', layerId: 'utilities', scenarioId: s.active(), coordinates: [[73.854, 18.532, -3], [73.855, 18.532, -3]], createdAt: T, updatedAt: T } as unknown as CityObject, true);
    await s.rt.finish();
    expect(useRoundTrip.getState().ask).toEqual({ kind: 'underground' });
    await s.rt.finish({ noRetest: true });
    expect(useRoundTrip.getState().trip!.leg).toBeNull();
    expect(s.workspace()).toBe('simulate');
  }, 60_000);

  it('Cancel → Undo deletes the proposal the flow made; Cancel → Undo in an existing proposal undoes back to the start', async () => {
    const s = setup();
    await s.study();
    const base0 = s.baseCanon();
    await s.rt.start(WIDEN);
    const pid = useRoundTrip.getState().trip!.leg!.proposalId;
    s.widen();
    s.rt.cancel();
    expect(useRoundTrip.getState().ask).toEqual({ kind: 'cancel' });
    await s.rt.cancelWith('undo');
    expect(s.scen.has(pid)).toBe(false);
    expect(s.active()).toBe('base');
    expect(useRoundTrip.getState().trip!.leg).toBeNull();
    expect(useRoundTrip.getState().trip!.status!.text).toMatch(/deleted/);
    expect(s.baseCanon()).toBe(base0);

    // An existing proposal: its earlier change stays, the leg's change is undone
    s.scen.set('scn_mine', { id: 'scn_mine', name: 'Mine' });
    s.setActive('scn_mine');
    commitRoadFieldEdit(s.om as any, s.history as any, s.om.getById(OTHER) as RoadObject, 'lanesForward', 2, 'carriageway' as any);
    s.deps.goTo('simulate');
    await s.mode.whenSettled();
    await s.rt.start(WIDEN);
    expect(useRoundTrip.getState().trip!.leg!.createdProposal).toBe(false);
    s.widen();
    s.rt.cancel();
    await s.rt.cancelWith('undo');
    expect(JSON.stringify((s.om.getById(DECK) as RoadObject).sections)).toBe(JSON.stringify((s.om.viewOf('base').find(x => x.id === DECK) as RoadObject).sections));
    // The proposal's earlier change (before the leg) stays
    expect(JSON.stringify((s.om.getById(OTHER) as RoadObject).sections)).not.toBe(JSON.stringify((s.om.viewOf('base').find(x => x.id === OTHER) as RoadObject).sections));
    expect(useRoundTrip.getState().trip!.status!.text).toMatch(/were undone/);
    expect(s.baseCanon()).toBe(base0);
  }, 120_000);

  it('Base during a leg is read-only; another proposal takes the leg; the trip survives a reload', async () => {
    const s = setup();
    await s.study();
    await s.rt.start(null);
    const pid = useRoundTrip.getState().trip!.leg!.proposalId;
    s.setActive('base');
    expect(useRoundTrip.getState().baseActive).toBe(true);
    expect(s.locked()).toBe(true);
    s.rt.switchBackToProposal();
    expect(s.active()).toBe(pid);
    expect(s.locked()).toBe(false);
    s.scen.set('scn_other', { id: 'scn_other', name: 'Other' });
    s.setActive('scn_other');
    expect(useRoundTrip.getState().trip!.leg!.proposalId).toBe('scn_other');
    expect(useRoundTrip.getState().trip!.leg!.proposalName).toBe('Other');

    // Reload: a new controller reads the stored trip; it offers to resume
    const stored = s.stored();
    expect(stored).toBeTruthy();
    s.rt.dispose();
    useRoundTrip.setState({ trip: null });
    const s2 = setup({ stored });
    const t2 = useRoundTrip.getState().trip!;
    expect(t2.resumed).toBe(true);
    expect(t2.leg!.proposalId).toBe('scn_other');
    expect(t2.study.seedRoadIds).toEqual([DECK]);
    // The proposal does not exist in this session: the resume ends the leg with a plain reason, nothing stuck
    s2.deps.goTo('design');
    await s2.rt.finish();
    expect(useRoundTrip.getState().trip!.leg).toBeNull();
    expect(useRoundTrip.getState().trip!.status).toMatchObject({ tone: 'bad' });
    expect(useRoundTrip.getState().trip!.status!.text).toMatch(/no longer exists/);
  }, 120_000);

  it('a failed step goes back to editing with the reason (no stuck progress); a proposal that cannot be made changes nothing', async () => {
    const s = setup();
    await s.study();
    await s.rt.start(null);
    s.widen();
    vi.spyOn(s.mode, 'whenSettled').mockResolvedValue(false);
    await s.rt.finish();
    const t = useRoundTrip.getState().trip!;
    expect(t.leg!.phase).toBe('editing');
    expect(t.status).toMatchObject({ tone: 'bad', retry: true });
    vi.restoreAllMocks();
    vi.spyOn(s.mode, 'runComparison').mockResolvedValue(null);
    await s.rt.finish();
    expect(useRoundTrip.getState().trip!.leg!.phase).toBe('editing');
    expect(useRoundTrip.getState().trip!.status!.text).toMatch(/did not finish/);

    const f = setup({ createFails: true });
    await f.study();
    const base0 = f.baseCanon();
    expect(await f.rt.start(WIDEN)).toBe(false);
    expect(useRoundTrip.getState().trip!.leg).toBeNull();
    expect(useRoundTrip.getState().trip!.status!.text).toMatch(/could not be created.*not changed/);
    expect(f.baseCanon()).toBe(base0);
  }, 120_000);
});
