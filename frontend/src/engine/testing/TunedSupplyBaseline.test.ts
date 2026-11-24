import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { ObjectManager } from '../objects/ObjectManager';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode, STUDY_CHANGED, type BaselineStore, type StoredBaseline } from '../simulation/SimulationMode';
import { TUNED_SUPPLY, TUNED_SUPPLY_DEFAULT_ON } from '../calibration/tunedSupply';

/**
 * p13: switching between the default and the tuned (estimated) traffic parameters forces a new baseline. The switch is
 * part of the study (like the roads, range and direction): its notice is not cleared when the area is re-explored, and a
 * baseline saved with one setting is not restored onto the other after a reload.
 */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[] };
const DECK = 'osm_208004768';
const memoryStore = () => { const m = new Map<string, StoredBaseline>(); const s: BaselineStore & { m: typeof m } = { m, get: async k => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); } }; return s; };
const session = (om: ObjectManager, store: BaselineStore) => {
  const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, null, () => ({ buildings: [] }), () => Promise.reject(new Error('no counts')), null, null);
  mode.setBaselineStore(store);
  mode.analysisSeeds = [42];
  mode.enter();
  mode.setRange(700);
  return mode;
};

describe('tuned (estimated) parameters and the baseline', () => {
  it('the setting starts as the recorded decision says', () => {
    const mode = session(new ObjectManager(), memoryStore());
    expect(mode.getState().supplySet).toBe(TUNED_SUPPLY_DEFAULT_ON && TUNED_SUPPLY ? 'tuned' : 'default');
    expect(mode.activeSupply()).toBe(TUNED_SUPPLY_DEFAULT_ON ? TUNED_SUPPLY : null);
  });

  it.skipIf(!TUNED_SUPPLY)('switching keeps the baseline stale until switched back, and a baseline is restored only onto its own setting', async () => {
    const store = memoryStore();
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const a = session(om, store);
    const start = a.useTunedSupply;
    a.selectRoad(DECK, false);
    await a.runAnalysis();
    expect(await a.captureBaseline(60)).toBeTruthy();
    a.setTunedSupply(!start);
    expect(a.getState().supplySet).toBe(!start ? 'tuned' : 'default');
    expect(a.getState().comparison.staleReason).toBe(STUDY_CHANGED.supply);
    // The re-analysis with the other parameters must not clear the notice (the study key carries the setting)
    await a.runAnalysis();
    await new Promise(r => setTimeout(r, 50));
    expect(a.getState().comparison.staleReason).toBe(STUDY_CHANGED.supply);
    // Back to the baseline's setting: the notice goes
    a.setTunedSupply(start);
    expect(a.getState().comparison.staleReason).toBeNull();
    expect(a.getState().comparison.baseline).toBeTruthy();
    a.exit?.();

    // Reload with the other setting: the saved baseline is not restored
    const b = session(om, store);
    b.setTunedSupply(!start);
    b.selectRoad(DECK, false);
    await new Promise(r => setTimeout(r, 50));
    await b.baselineRestore;
    expect(b.getState().comparison.baseline).toBeNull();
    // and with its own setting it is
    const c = session(om, store);
    c.selectRoad(DECK, false);
    await new Promise(r => setTimeout(r, 50));
    await c.baselineRestore;
    expect(c.getState().comparison.baseline).toBeTruthy();
  }, 240000);
});
