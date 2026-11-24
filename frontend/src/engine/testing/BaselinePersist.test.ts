import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { ObjectManager } from '../objects/ObjectManager';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode, type BaselineStore, type StoredBaseline } from '../simulation/SimulationMode';
import { restoredBaselineText } from '../../components/RoadAnalysisPanel';

/**
 * The saved baseline survives a page reload (p11 gap: a reload lost the existing-city baseline, and with it the frozen
 * demand, so a proposal could only be compared after saving the baseline again from the existing city). It is kept
 * in the browser with its run inputs and the existing city's road names and lanes, and comes back for the same roads,
 * range and direction; not onto an existing city whose network changed since.
 */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[]; signalPoints: [number, number][] };
const DECK = 'osm_208004768';
const memoryStore = () => { const m = new Map<string, StoredBaseline>(); const s: BaselineStore & { m: typeof m } = { m, get: async k => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); } }; return s; };
// Mapped signals arrive a moment after the road is selected, as in the browser
const slowSignals = { signalsIn: () => new Promise<[number, number][]>(r => setTimeout(() => r(fx.signalPoints), 300)) } as any;
const session = (om: ObjectManager, store: BaselineStore, range = 700, signals: any = null) => {
  const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, signals, () => ({ buildings: [] }), () => Promise.reject(new Error('no counts')), null, null);
  mode.setBaselineStore(store);
  mode.analysisSeeds = [42];
  mode.enter();
  mode.setRange(range);
  return mode;
};

describe('the baseline is kept across a page reload', () => {
  it('saved → new session, same road: restored (same trips and seeds), and Compare runs against it', async () => {
    const store = memoryStore();
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const a = session(om, store);
    a.selectRoad(DECK, false);
    await a.runAnalysis();
    const base = (await a.captureBaseline(60))!;
    expect(base).toBeTruthy();
    expect(store.m.size).toBe(1);
    const rec = [...store.m.values()][0];
    // The roads are kept small: name, lanes and direction only
    expect(Object.keys(rec.roads[0]).sort()).toEqual(expect.arrayContaining(['id', 'isOneWay', 'laneCount', 'name', 'type']));
    expect(rec.roads.every(r => !('coordinates' in r))).toBe(true);
    a.exit?.();

    // "Reload": a new mode on the same city
    const b = session(om, store);
    b.selectRoad(DECK, false);
    await b.baselineRestore;
    const c = b.getState().comparison;
    expect(c.baseline).toBeTruthy();
    expect(c.restoredAt).toBe(rec.savedAt);
    expect(c.baseline!.inputs.demandKey).toBe(base.inputs.demandKey);
    expect(c.baseline!.inputs.seeds).toEqual(base.inputs.seeds);
    // Same city, same frozen demand and seeds: the comparison finds no change
    await b.runAnalysis();
    await b.runComparison();
    const r = b.getState().comparison.result!;
    expect(r).toBeTruthy();
    expect(r.section[0].before).toBe(r.section[0].after);
    expect(restoredBaselineText(rec.savedAt)).toMatch(/^Baseline saved .+, restored from this browser/);
  }, 240000);

  it('after a reload the mapped signals arrive after the road is selected: restored once they do (p11 browser run)', async () => {
    const store = memoryStore();
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const a = session(om, store, 700, slowSignals);
    a.selectRoad(DECK, false);
    await new Promise(r => setTimeout(r, 500));
    expect(a.getState().signals.status).toBe('ready');
    await a.runAnalysis();
    expect(await a.captureBaseline(60)).toBeTruthy();

    const b = session(om, store, 700, slowSignals);
    b.selectRoad(DECK, false);
    // Before the signals: the network differs from the baseline's (it ran with them), so not yet
    await b.baselineRestore;
    expect(b.getState().comparison.baseline).toBeNull();
    await new Promise(r => setTimeout(r, 500));
    expect(b.getState().signals.status).toBe('ready');
    await b.baselineRestore;
    expect(b.getState().comparison.baseline).toBeTruthy();
    expect(b.getState().comparison.restoredAt).toBeTruthy();
  }, 240000);

  it('not restored for another range, nor onto an existing city whose network changed', async () => {
    const store = memoryStore();
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const a = session(om, store);
    a.selectRoad(DECK, false);
    await a.runAnalysis();
    await a.captureBaseline(60);

    const other = session(om, store, 900);
    other.selectRoad(DECK, false);
    await other.baselineRestore;
    expect(other.getState().comparison.baseline).toBeNull();

    // The existing city edited since (a road deleted): the stored baseline is for another network
    const someRoad = fx.roads.find(r => r.id !== DECK && r.type === 'road')!.id;
    om.delete(someRoad, true);
    const edited = session(om, store);
    edited.selectRoad(DECK, false);
    await edited.baselineRestore;
    expect(edited.getState().comparison.baseline).toBeNull();
  }, 240000);
});
