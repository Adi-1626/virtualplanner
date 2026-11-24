import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { ObjectManager } from '../objects/ObjectManager';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode, seedKeyOf } from '../simulation/SimulationMode';

/**
 * Selecting another road in Simulate (p11 user test): the previous road's result must never be shown under the newly
 * selected road's name while that road's own analysis runs (Baba Bhide Bridge showed Satara Road's 9 km/h and 163%,
 * marked "the network changed since this result"). Real OSM roads around Sangamwadi Bridge (fixtures/sangamwadi.json),
 * as in EditRecompute.test.ts.
 */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[]; signalPoints: [number, number][] };
const DECK = 'osm_208004768';
const SECOND = 'osm_227095239'; // the bridge's westbound carriageway

describe('Simulate: selecting a second road', () => {
  it('clears the first road\'s result (not shown as "outdated"), runs the second road\'s own, and gives the first back when reselected', async () => {
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, null, () => ({ buildings: [] }),
      () => Promise.reject(new Error('no counts')), null, null);
    mode.analysisSeeds = [42];
    mode.enter();
    mode.setRange(700);
    mode.selectRoad(DECK, false);
    expect(await mode.runAnalysis()).toBeTruthy();
    const first = mode.getState().analysis;
    expect(first.status).toBe('ready');
    expect(first.seedKey).toBe(seedKeyOf([DECK]));

    mode.selectRoad(SECOND, false);
    const shown = mode.getState().analysis;
    expect(mode.getState().seedRoadIds).toEqual([SECOND]);
    expect(shown.output).toBeNull();
    expect(shown.outdated).toBeFalsy();
    expect(shown.status === 'idle' || shown.status === 'running').toBe(true);

    await mode.runAnalysis();
    const second = mode.getState().analysis;
    expect(second.status).toBe('ready');
    expect(second.seedKey).toBe(seedKeyOf([SECOND]));
    expect(second.outdated).toBeFalsy();
    expect(second.key).not.toBe(first.key);

    // Back to the first road: its kept result comes back at once, current
    mode.selectRoad(DECK, false);
    const back = mode.getState().analysis;
    expect(back.key).toBe(first.key);
    expect(back.seedKey).toBe(seedKeyOf([DECK]));
    expect(back.outdated).toBeFalsy();
    mode.dispose();
  }, 120000);

  it('selecting another road while the first road\'s analysis is computing starts the new road\'s own run (never stuck at "running")', async () => {
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, null, () => ({ buildings: [] }),
      () => Promise.reject(new Error('no counts')), null, null);
    mode.analysisSeeds = [42];
    mode.enter();
    mode.setRange(700);
    mode.selectRoad(DECK, false);
    expect(await mode.runAnalysis()).toBeTruthy();
    // Make the first road's result stale and have its re-run computing, then pick another road
    mode.selectRoad(SECOND, false);
    mode.selectRoad(DECK, false);
    const pending = mode.runAnalysis();
    for (let i = 0; i < 200 && mode.getState().analysis.status !== 'running'; i++) await new Promise(r => setTimeout(r, 10));
    om.update(SECOND, { name: 'Renamed' } as any, true); // a network change, so the kept first result is not reused
    mode.networkChanged();
    await new Promise(r => setTimeout(r, 400));
    mode.selectRoad(SECOND, false);
    await pending;
    expect(mode.getState().analysis.output).toBeNull();
    // Started on its own (maybeAutoStart), not left waiting at 'running' with no run behind it
    for (let i = 0; i < 1200 && mode.getState().analysis.status !== 'ready'; i++) await new Promise(r => setTimeout(r, 50));
    expect(mode.getState().analysis.status).toBe('ready');
    expect(mode.getState().analysis.seedKey).toBe(seedKeyOf([SECOND]));
    mode.dispose();
  }, 120000);

  it('a network change while a run waits for its counts (as on a scenario switch) does not leave the analysis at "running" with no run behind it', async () => {
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    // Counts that take a while to fail, as a slow /api fetch: every run waits on them before its job starts
    const slowCounts = () => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no counts')), 600));
    const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, null, () => ({ buildings: [] }), slowCounts, null, null);
    mode.analysisSeeds = [42];
    mode.enter();
    mode.setRange(700);
    mode.selectRoad(DECK, false);
    expect(await mode.runAnalysis()).toBeTruthy();
    const edit = (name: string) => { om.update(SECOND, { name } as any, true); mode.networkChanged(); };
    edit('A');
    // The automatic re-run starts and computes
    for (let i = 0; i < 400 && !(mode.getState().analysis.status === 'running' && mode.getState().analysis.progress > 0); i++) await new Promise(r => setTimeout(r, 10));
    expect(mode.getState().analysis.status).toBe('running');
    // A second start (e.g. the panel's) cancels it and waits for counts; meanwhile the network changes again
    const second = mode.runAnalysis();
    edit('B');
    expect(await second).toBeNull();
    for (let i = 0; i < 1200 && mode.getState().analysis.status !== 'ready'; i++) await new Promise(r => setTimeout(r, 50));
    expect(mode.getState().analysis.status).toBe('ready');
    expect(mode.getState().analysis.outdated).toBeFalsy();
    mode.dispose();
  }, 120000);
});
